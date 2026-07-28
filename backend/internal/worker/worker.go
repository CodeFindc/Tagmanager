package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/codefun/tagmanager/backend/internal/llm"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Worker struct {
	pool        *pgxpool.Pool
	llm         llm.Client
	logger      *slog.Logger
	maxAttempts int
}

func New(pool *pgxpool.Pool, client llm.Client, logger *slog.Logger, maxAttempts int) *Worker {
	if maxAttempts <= 0 {
		maxAttempts = 3
	}
	return &Worker{pool: pool, llm: client, logger: logger, maxAttempts: maxAttempts}
}

func (w *Worker) Run(ctx context.Context) error {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		if err := w.ProcessOne(ctx); err != nil {
			w.logger.Error("process consolidation job", "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

type claimedJob struct {
	ID               string
	NamespaceID      string
	WindowID         string
	JobType          string
	ParentProposalID *string
}

func (w *Worker) ProcessOne(ctx context.Context) error {
	job, ok, err := w.claim(ctx)
	if err != nil || !ok {
		return err
	}
	var namespaceName string
	var snapshot []byte
	if err = w.pool.QueryRow(ctx, `SELECT name FROM tag_namespaces WHERE id=$1`, job.NamespaceID).Scan(&namespaceName); err != nil {
		return w.fail(ctx, job.ID, job.WindowID, err)
	}
	if err = w.pool.QueryRow(ctx, `SELECT input_snapshot FROM pool_windows WHERE id=$1`, job.WindowID).Scan(&snapshot); err != nil {
		return w.fail(ctx, job.ID, job.WindowID, err)
	}
	feedback := ""
	if job.ParentProposalID != nil {
		_ = w.pool.QueryRow(ctx, `SELECT COALESCE(reviewer_feedback,'') FROM consolidation_proposals WHERE id=$1`, *job.ParentProposalID).Scan(&feedback)
	}
	if _, err = w.pool.Exec(ctx, `UPDATE pool_windows SET status='generating'::pool_window_status,updated_at=now() WHERE id=$1`, job.WindowID); err != nil {
		return w.fail(ctx, job.ID, job.WindowID, err)
	}
	var entries []llm.InputEntry
	if err = json.Unmarshal(snapshot, &entries); err != nil {
		return w.fail(ctx, job.ID, job.WindowID, err)
	}
	output, err := w.llm.Consolidate(ctx, llm.ConsolidationRequest{NamespaceName: namespaceName, Feedback: feedback, Entries: entries})
	if err != nil {
		return w.fail(ctx, job.ID, job.WindowID, err)
	}
	if err = validateOutput(output, entries); err != nil {
		return w.fail(ctx, job.ID, job.WindowID, err)
	}
	return w.persistProposal(ctx, job.ID, job.NamespaceID, job.WindowID, output)
}

func (w *Worker) claim(ctx context.Context) (claimedJob, bool, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return claimedJob{}, false, err
	}
	defer tx.Rollback(ctx)
	var job claimedJob
	err = tx.QueryRow(ctx, `WITH next AS (SELECT id FROM consolidation_jobs WHERE status IN ('queued'::job_status,'retryable_failed'::job_status) AND run_after<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE consolidation_jobs j SET status='running'::job_status,attempt=attempt+1,started_at=now() FROM next WHERE j.id=next.id RETURNING j.id,j.namespace_id,j.pool_window_id,j.job_type,j.parent_proposal_id`).Scan(&job.ID, &job.NamespaceID, &job.WindowID, &job.JobType, &job.ParentProposalID)
	if err == pgx.ErrNoRows {
		return claimedJob{}, false, tx.Commit(ctx)
	}
	if err != nil {
		return claimedJob{}, false, err
	}
	return job, true, tx.Commit(ctx)
}

func validateOutput(output domain.ConsolidationOutput, entries []llm.InputEntry) error {
	known := map[string]bool{}
	for _, entry := range entries {
		known[entry.ID] = true
	}
	seen := map[string]bool{}
	for _, tag := range output.Tags {
		if tag.CanonicalName == "" {
			return fmt.Errorf("empty canonical name")
		}
		for _, id := range tag.CoveredIDs {
			if !known[id] {
				return fmt.Errorf("unknown candidate entry %s", id)
			}
			if seen[id] {
				return fmt.Errorf("candidate entry %s is mapped more than once", id)
			}
			seen[id] = true
		}
	}
	return nil
}

func determineFailStatus(attempt, maxAttempts int) string {
	if attempt >= maxAttempts {
		return "failed"
	}
	return "retryable_failed"
}

func (w *Worker) fail(ctx context.Context, jobID, windowID string, cause error) error {
	// CASE bare string literals type as text; PostgreSQL will not assign text to job_status without an explicit cast.
	_, err := w.pool.Exec(ctx, `UPDATE consolidation_jobs SET status=(CASE WHEN attempt >= $3 THEN 'failed' ELSE 'retryable_failed' END)::job_status,error_message=$2,run_after=now()+LEAST(300, (2 ^ LEAST(attempt, 10)) * 10) * interval '1 second',completed_at=now() WHERE id=$1`, jobID, cause.Error(), w.maxAttempts)
	if err != nil {
		return fmt.Errorf("mark job failed after %v: %w", cause, err)
	}
	if _, err = w.pool.Exec(ctx, `UPDATE pool_windows SET status='failed'::pool_window_status,updated_at=now() WHERE id=$1`, windowID); err != nil {
		return fmt.Errorf("mark window failed after %v: %w", cause, err)
	}
	// Keep the original processing error so Run() logs the root cause, not a nil success from status bookkeeping.
	return cause
}

func (w *Worker) persistProposal(ctx context.Context, jobID, namespaceID, windowID string, output domain.ConsolidationOutput) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var proposalID string
	if err = tx.QueryRow(ctx, `INSERT INTO consolidation_proposals(namespace_id,pool_window_id,job_id) VALUES($1,$2,$3) RETURNING id`, namespaceID, windowID, jobID).Scan(&proposalID); err != nil {
		return err
	}
	for _, tag := range output.Tags {
		aliases, _ := json.Marshal(tag.Aliases)
		var proposalTagID string
		if err = tx.QueryRow(ctx, `INSERT INTO proposal_tags(proposal_id,canonical_name,normalized_name,description,aliases,rationale,confidence) VALUES($1,$2,lower($2),$3,$4,$5,$6) RETURNING id`, proposalID, tag.CanonicalName, tag.Description, aliases, tag.Rationale, tag.Confidence).Scan(&proposalTagID); err != nil {
			return err
		}
		for _, entryID := range tag.CoveredIDs {
			if _, err = tx.Exec(ctx, `INSERT INTO proposal_mappings(proposal_tag_id,candidate_pool_entry_id) VALUES($1,$2)`, proposalTagID, entryID); err != nil {
				return err
			}
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE consolidation_jobs SET status='succeeded'::job_status,completed_at=now() WHERE id=$1`, jobID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE pool_windows SET status='awaiting_review'::pool_window_status,updated_at=now() WHERE id=$1`, windowID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
