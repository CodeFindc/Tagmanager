package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(db *Database) *Store { return &Store{pool: db.Pool} }

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) FindUserByEmail(ctx context.Context, email string) (user domain.User, passwordHash string, err error) {
	var pwdChangedAt *time.Time
	err = s.pool.QueryRow(ctx, `SELECT id,email,password_hash,role,must_change_password,password_changed_at,created_at FROM users WHERE email=lower($1)`, strings.TrimSpace(email)).Scan(&user.ID, &user.Email, &passwordHash, &user.Role, &user.MustChangePassword, &pwdChangedAt, &user.CreatedAt)
	user.PasswordChangedAt = pwdChangedAt
	return
}

func (s *Store) CreateUser(ctx context.Context, email, passwordHash string, role domain.Role, mustChangePassword bool) (domain.User, error) {
	var user domain.User
	var pwdChangedAt *time.Time
	err := s.pool.QueryRow(ctx, `INSERT INTO users(email,password_hash,role,must_change_password) VALUES(lower($1),$2,$3,$4) RETURNING id,email,role,must_change_password,password_changed_at,created_at`, strings.TrimSpace(email), passwordHash, role, mustChangePassword).Scan(&user.ID, &user.Email, &user.Role, &user.MustChangePassword, &pwdChangedAt, &user.CreatedAt)
	user.PasswordChangedAt = pwdChangedAt
	return user, err
}

func (s *Store) ListUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,email,role,must_change_password,password_changed_at,created_at FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []domain.User{}
	for rows.Next() {
		var user domain.User
		var pwdChangedAt *time.Time
		if err := rows.Scan(&user.ID, &user.Email, &user.Role, &user.MustChangePassword, &pwdChangedAt, &user.CreatedAt); err != nil {
			return nil, err
		}
		user.PasswordChangedAt = pwdChangedAt
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) UpdateUserRole(ctx context.Context, id string, role domain.Role) (domain.User, error) {
	var user domain.User
	var pwdChangedAt *time.Time
	err := s.pool.QueryRow(ctx, `UPDATE users SET role=$2 WHERE id=$1 RETURNING id,email,role,must_change_password,password_changed_at,created_at`, id, role).Scan(&user.ID, &user.Email, &user.Role, &user.MustChangePassword, &pwdChangedAt, &user.CreatedAt)
	user.PasswordChangedAt = pwdChangedAt
	return user, err
}

func (s *Store) UpdateUserPassword(ctx context.Context, id string, newPasswordHash string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET password_hash=$2, must_change_password=false, password_changed_at=now() WHERE id=$1`, id, newPasswordHash)
	return err
}

func (s *Store) ListNamespaces(ctx context.Context) ([]domain.Namespace, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,name,description,candidate_threshold,created_at FROM tag_namespaces ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Namespace{}
	for rows.Next() {
		var item domain.Namespace
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.CandidateThreshold, &item.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) CreateNamespace(ctx context.Context, name, description string, threshold int) (domain.Namespace, error) {
	var result domain.Namespace
	err := s.pool.QueryRow(ctx, `INSERT INTO tag_namespaces(name,description,candidate_threshold) VALUES($1,$2,$3) RETURNING id,name,description,candidate_threshold,created_at`, name, description, threshold).Scan(&result.ID, &result.Name, &result.Description, &result.CandidateThreshold, &result.CreatedAt)
	return result, err
}

func (s *Store) ListTags(ctx context.Context, namespaceID, query string, limit int) ([]domain.Tag, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `SELECT t.id,t.namespace_id,t.canonical_name,t.normalized_name,t.description,t.status,t.version,COALESCE(json_agg(a.alias_name) FILTER (WHERE a.id IS NOT NULL),'[]') FROM tags t LEFT JOIN tag_aliases a ON a.tag_id=t.id WHERE t.namespace_id=$1 AND t.status='published' AND ($2='' OR t.canonical_name ILIKE '%' || $2 || '%') GROUP BY t.id ORDER BY t.canonical_name LIMIT $3`, namespaceID, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Tag{}
	for rows.Next() {
		var item domain.Tag
		var aliases []byte
		if err := rows.Scan(&item.ID, &item.NamespaceID, &item.CanonicalName, &item.NormalizedName, &item.Description, &item.Status, &item.Version, &aliases); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(aliases, &item.Aliases)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) ListPool(ctx context.Context, namespaceID string) ([]domain.PoolEntry, int, error) {
	var threshold int
	if err := s.pool.QueryRow(ctx, `SELECT candidate_threshold FROM tag_namespaces WHERE id=$1`, namespaceID).Scan(&threshold); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id,namespace_id,raw_sample,normalized_name,occurrence_count,first_seen_at,last_seen_at FROM candidate_pool_entries WHERE namespace_id=$1 AND resolved_at IS NULL ORDER BY last_seen_at DESC`, namespaceID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	result := []domain.PoolEntry{}
	for rows.Next() {
		var item domain.PoolEntry
		if err := rows.Scan(&item.ID, &item.NamespaceID, &item.RawSample, &item.NormalizedName, &item.OccurrenceCount, &item.FirstSeenAt, &item.LastSeenAt); err != nil {
			return nil, 0, err
		}
		result = append(result, item)
	}
	return result, threshold, rows.Err()
}

func (s *Store) ImportTags(ctx context.Context, namespaceID, idempotencyKey, sourceName, actorID string, tags []string, initialSeed bool, normalize func(string) string) (domain.ImportResult, error) {
	if len(tags) == 0 {
		return domain.ImportResult{}, fmt.Errorf("at least one tag is required")
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.ImportResult{}, err
	}
	defer tx.Rollback(ctx)
	var existing domain.ImportResult
	err = tx.QueryRow(ctx, `SELECT id,total_count,matched_count,pooled_count,invalid_count FROM import_batches WHERE idempotency_key=$1`, idempotencyKey).Scan(&existing.ID, &existing.TotalCount, &existing.MatchedCount, &existing.PooledCount, &existing.InvalidCount)
	if err == nil {
		return existing, tx.Commit(ctx)
	}
	if err != pgx.ErrNoRows {
		return domain.ImportResult{}, err
	}
	var batchID string
	if err = tx.QueryRow(ctx, `INSERT INTO import_batches(namespace_id,idempotency_key,source_name,created_by) VALUES($1,$2,$3,$4) RETURNING id`, namespaceID, idempotencyKey, sourceName, actorID).Scan(&batchID); err != nil {
		return domain.ImportResult{}, err
	}
	result := domain.ImportResult{ID: batchID, TotalCount: len(tags)}
	for line, raw := range tags {
		normalized := normalize(raw)
		status := "pooled"
		var matchedID *string
		message := ""
		if normalized == "" {
			status = "invalid"
			result.InvalidCount++
			message = "empty after normalization"
		} else {
			var tagID string
			matchErr := tx.QueryRow(ctx, `SELECT id FROM tags WHERE namespace_id=$1 AND normalized_name=$2 AND status='published' UNION ALL SELECT tag_id FROM tag_aliases WHERE namespace_id=$1 AND normalized_name=$2 LIMIT 1`, namespaceID, normalized).Scan(&tagID)
			if matchErr == nil {
				status = "matched"
				matchedID = &tagID
				result.MatchedCount++
			} else if matchErr == pgx.ErrNoRows {
				result.PooledCount++
				_, err = tx.Exec(ctx, `INSERT INTO candidate_pool_entries(namespace_id,raw_sample,normalized_name) VALUES($1,$2,$3) ON CONFLICT(namespace_id,normalized_name) DO UPDATE SET occurrence_count=candidate_pool_entries.occurrence_count+1,last_seen_at=now()`, namespaceID, raw, normalized)
				if err != nil {
					return domain.ImportResult{}, err
				}
			} else {
				return domain.ImportResult{}, matchErr
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO import_items(batch_id,line_number,raw_tag,normalized_tag,status,matched_tag_id,error_message) VALUES($1,$2,$3,$4,$5,$6,$7)`, batchID, line+1, raw, normalized, status, matchedID, message)
		if err != nil {
			return domain.ImportResult{}, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE import_batches SET matched_count=$2,pooled_count=$3,invalid_count=$4 WHERE id=$1`, batchID, result.MatchedCount, result.PooledCount, result.InvalidCount)
	if err != nil {
		return domain.ImportResult{}, err
	}
	var threshold, count int
	if err = tx.QueryRow(ctx, `SELECT candidate_threshold FROM tag_namespaces WHERE id=$1`, namespaceID).Scan(&threshold); err != nil {
		return domain.ImportResult{}, err
	}
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM candidate_pool_entries WHERE namespace_id=$1 AND resolved_at IS NULL`, namespaceID).Scan(&count); err != nil {
		return domain.ImportResult{}, err
	}
	result.Threshold = threshold
	result.OpenCandidates = count
	shouldConsolidate := initialSeed || count >= threshold
	if !shouldConsolidate {
		result.ConsolidationStatus = "not_triggered"
		result.ConsolidationMessage = fmt.Sprintf("未解决候选 %d / 阈值 %d，未达到触发条件", count, threshold)
		return result, tx.Commit(ctx)
	}
	snapshot, buildErr := s.poolSnapshotTx(ctx, tx, namespaceID)
	if buildErr != nil {
		return domain.ImportResult{}, buildErr
	}
	trigger := "threshold"
	jobType := "pool_window"
	if initialSeed {
		trigger = "initial_seed"
		jobType = "initial_seed"
	}
	jobID, status, message, consErr := s.enqueueConsolidation(ctx, tx, namespaceID, threshold, trigger, jobType, snapshot)
	if consErr != nil {
		return domain.ImportResult{}, consErr
	}
	result.JobID = jobID
	result.ConsolidationStatus = status
	result.ConsolidationMessage = message
	return result, tx.Commit(ctx)
}

// enqueueConsolidation freezes a pool window and enqueues a job.
// If an active window already blocks the partial unique index, it reclaims stale
// running/failed work when safe, otherwise reports already_active with the existing job id.
func (s *Store) enqueueConsolidation(ctx context.Context, tx pgx.Tx, namespaceID string, threshold int, trigger, jobType string, snapshot []byte) (jobID, status, message string, err error) {
	var windowID string
	err = tx.QueryRow(ctx, `INSERT INTO pool_windows(namespace_id,threshold,trigger_reason,input_snapshot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, namespaceID, threshold, trigger, snapshot).Scan(&windowID)
	if err != nil && err != pgx.ErrNoRows {
		return "", "", "", err
	}
	if windowID != "" {
		err = tx.QueryRow(ctx, `INSERT INTO consolidation_jobs(namespace_id,pool_window_id,job_type) VALUES($1,$2,$3) RETURNING id`, namespaceID, windowID, jobType).Scan(&jobID)
		if err != nil {
			return "", "", "", err
		}
		return jobID, "created", "已创建汇总任务，等待 worker 调用模型", nil
	}

	// Active window exists — inspect and recover stale states left by crashes / enum bugs.
	var activeWindowID, windowStatus string
	if err = tx.QueryRow(ctx, `SELECT id, status::text FROM pool_windows WHERE namespace_id=$1 AND status IN ('frozen','generating','awaiting_review') ORDER BY created_at DESC LIMIT 1`, namespaceID).Scan(&activeWindowID, &windowStatus); err != nil {
		if err == pgx.ErrNoRows {
			err = tx.QueryRow(ctx, `INSERT INTO pool_windows(namespace_id,threshold,trigger_reason,input_snapshot) VALUES($1,$2,$3,$4) RETURNING id`, namespaceID, threshold, trigger, snapshot).Scan(&windowID)
			if err != nil {
				return "", "", "", err
			}
			err = tx.QueryRow(ctx, `INSERT INTO consolidation_jobs(namespace_id,pool_window_id,job_type) VALUES($1,$2,$3) RETURNING id`, namespaceID, windowID, jobType).Scan(&jobID)
			if err != nil {
				return "", "", "", err
			}
			return jobID, "created", "已创建汇总任务，等待 worker 调用模型", nil
		}
		return "", "", "", err
	}

	if windowStatus == "awaiting_review" {
		_ = tx.QueryRow(ctx, `SELECT id::text FROM consolidation_jobs WHERE pool_window_id=$1 ORDER BY created_at DESC LIMIT 1`, activeWindowID).Scan(&jobID)
		return jobID, "already_active", "该域已有待审核窗口，请先在审核中心处理后再触发新的归并", nil
	}

	var existingJobID, jobStatus string
	jobErr := tx.QueryRow(ctx, `SELECT id::text, status::text FROM consolidation_jobs WHERE pool_window_id=$1 ORDER BY created_at DESC LIMIT 1`, activeWindowID).Scan(&existingJobID, &jobStatus)
	if jobErr != nil && jobErr != pgx.ErrNoRows {
		return "", "", "", jobErr
	}

	// Reclaim jobs stuck in running (classic symptom after status enum cast failures).
	if jobErr == nil && jobStatus == "running" {
		if _, err = tx.Exec(ctx, `UPDATE consolidation_jobs SET status='retryable_failed'::job_status, error_message=CASE WHEN error_message='' THEN 'reclaimed on import: was stuck running' ELSE error_message END, run_after=now(), completed_at=NULL WHERE id=$1`, existingJobID); err != nil {
			return "", "", "", err
		}
		return existingJobID, "reclaimed", "发现卡住的 running 任务，已重新入队，worker 将重试调用模型", nil
	}

	// Dead end: failed job still holding a frozen/generating window with no pending proposal — release and create fresh.
	if jobErr == nil && jobStatus == "failed" {
		var pending int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM consolidation_proposals WHERE pool_window_id=$1 AND status='pending_review'`, activeWindowID).Scan(&pending); err != nil {
			return "", "", "", err
		}
		if pending == 0 {
			if _, err = tx.Exec(ctx, `UPDATE pool_windows SET status='failed'::pool_window_status, updated_at=now() WHERE id=$1`, activeWindowID); err != nil {
				return "", "", "", err
			}
			err = tx.QueryRow(ctx, `INSERT INTO pool_windows(namespace_id,threshold,trigger_reason,input_snapshot) VALUES($1,$2,$3,$4) RETURNING id`, namespaceID, threshold, trigger, snapshot).Scan(&windowID)
			if err != nil {
				return "", "", "", err
			}
			err = tx.QueryRow(ctx, `INSERT INTO consolidation_jobs(namespace_id,pool_window_id,job_type) VALUES($1,$2,$3) RETURNING id`, namespaceID, windowID, jobType).Scan(&jobID)
			if err != nil {
				return "", "", "", err
			}
			return jobID, "created", "已释放失败窗口并重新创建汇总任务", nil
		}
	}

	if existingJobID != "" && (jobStatus == "queued" || jobStatus == "retryable_failed") {
		_, _ = tx.Exec(ctx, `UPDATE consolidation_jobs SET run_after=now() WHERE id=$1`, existingJobID)
		return existingJobID, "already_active", fmt.Sprintf("该域已有汇总任务（状态 %s），等待 worker 处理，不会重复创建", jobStatus), nil
	}

	if existingJobID != "" {
		return existingJobID, "already_active", fmt.Sprintf("该域已有活跃窗口（窗口 %s / 任务 %s），不会重复触发", windowStatus, jobStatus), nil
	}
	return "", "already_active", fmt.Sprintf("该域已有活跃窗口（%s）但找不到关联任务，请检查 consolidation_jobs", windowStatus), nil
}

func (s *Store) poolSnapshotTx(ctx context.Context, tx pgx.Tx, namespaceID string) ([]byte, error) {
	rows, err := tx.Query(ctx, `SELECT id,normalized_name,occurrence_count FROM candidate_pool_entries WHERE namespace_id=$1 AND resolved_at IS NULL ORDER BY last_seen_at LIMIT 500`, namespaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []map[string]any{}
	for rows.Next() {
		var id, name string
		var count int
		if err := rows.Scan(&id, &name, &count); err != nil {
			return nil, err
		}
		entries = append(entries, map[string]any{"id": id, "name": name, "occurrences": count})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return json.Marshal(entries)
}
