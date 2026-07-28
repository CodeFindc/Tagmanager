package repository

import (
	"context"
	"fmt"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/jackc/pgx/v5"
)

const consolidationJobSelect = `
SELECT
  j.id,
  j.namespace_id,
  j.job_type::text,
  j.status::text,
  j.attempt,
  j.error_message,
  j.created_at,
  j.started_at,
  j.completed_at,
  j.run_after,
  COALESCE(j.pool_window_id::text, ''),
  COALESCE(w.status::text, ''),
  COALESCE(w.trigger_reason, ''),
  COALESCE(w.threshold, 0),
  COALESCE(jsonb_array_length(w.input_snapshot), 0),
  p.id::text,
  p.status::text,
  j.parent_proposal_id::text
FROM consolidation_jobs j
LEFT JOIN pool_windows w ON w.id = j.pool_window_id
LEFT JOIN consolidation_proposals p ON p.job_id = j.id
`

func scanConsolidationJob(row pgx.Row) (domain.ConsolidationJobView, error) {
	var job domain.ConsolidationJobView
	var proposalID, proposalStatus, parentProposalID *string
	err := row.Scan(
		&job.ID,
		&job.NamespaceID,
		&job.JobType,
		&job.Status,
		&job.Attempt,
		&job.ErrorMessage,
		&job.CreatedAt,
		&job.StartedAt,
		&job.CompletedAt,
		&job.RunAfter,
		&job.PoolWindowID,
		&job.WindowStatus,
		&job.TriggerReason,
		&job.Threshold,
		&job.SnapshotCount,
		&proposalID,
		&proposalStatus,
		&parentProposalID,
	)
	if err != nil {
		return domain.ConsolidationJobView{}, err
	}
	job.ProposalID = proposalID
	job.ProposalStatus = proposalStatus
	job.ParentProposalID = parentProposalID
	return job, nil
}

// ListConsolidationJobs returns recent consolidation jobs for a namespace (newest first).
func (s *Store) ListConsolidationJobs(ctx context.Context, namespaceID string, limit int) ([]domain.ConsolidationJobView, error) {
	if namespaceID == "" {
		return nil, fmt.Errorf("namespaceId is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, consolidationJobSelect+`
WHERE j.namespace_id=$1
ORDER BY j.created_at DESC
LIMIT $2`, namespaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ConsolidationJobView{}
	for rows.Next() {
		job, err := scanConsolidationJob(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, job)
	}
	return items, rows.Err()
}

// GetConsolidationJob returns a single job view by id.
func (s *Store) GetConsolidationJob(ctx context.Context, jobID string) (domain.ConsolidationJobView, error) {
	job, err := scanConsolidationJob(s.pool.QueryRow(ctx, consolidationJobSelect+` WHERE j.id=$1`, jobID))
	if err == pgx.ErrNoRows {
		return domain.ConsolidationJobView{}, fmt.Errorf("job not found")
	}
	return job, err
}
