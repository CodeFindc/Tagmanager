package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(db *Database) *Store { return &Store{pool: db.Pool} }

func (s *Store) FindUserByEmail(ctx context.Context, email string) (id, passwordHash string, role domain.Role, err error) {
	err = s.pool.QueryRow(ctx, `SELECT id,email,password_hash,role FROM users WHERE email=lower($1)`, strings.TrimSpace(email)).Scan(&id, &email, &passwordHash, &role)
	return
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

func (s *Store) ListTags(ctx context.Context, namespaceID, query string) ([]domain.Tag, error) {
	rows, err := s.pool.Query(ctx, `SELECT t.id,t.namespace_id,t.canonical_name,t.normalized_name,t.description,t.status,t.version,COALESCE(json_agg(a.alias_name) FILTER (WHERE a.id IS NOT NULL),'[]') FROM tags t LEFT JOIN tag_aliases a ON a.tag_id=t.id WHERE t.namespace_id=$1 AND t.status='published' AND ($2='' OR t.canonical_name ILIKE '%' || $2 || '%') GROUP BY t.id ORDER BY t.canonical_name`, namespaceID, query)
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
	shouldConsolidate := initialSeed || count >= threshold
	if shouldConsolidate {
		var windowID string
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
		err = tx.QueryRow(ctx, `INSERT INTO pool_windows(namespace_id,threshold,trigger_reason,input_snapshot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, namespaceID, threshold, trigger, snapshot).Scan(&windowID)
		if err != nil && err != pgx.ErrNoRows {
			return domain.ImportResult{}, err
		}
		if windowID != "" {
			err = tx.QueryRow(ctx, `INSERT INTO consolidation_jobs(namespace_id,pool_window_id,job_type) VALUES($1,$2,$3) RETURNING id`, namespaceID, windowID, jobType).Scan(&result.JobID)
			if err != nil {
				return domain.ImportResult{}, err
			}
		}
	}
	return result, tx.Commit(ctx)
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
