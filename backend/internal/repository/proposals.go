package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/jackc/pgx/v5"
)

// ListProposals returns proposals ordered by created_at DESC.
// proposalID, when set, returns that single proposal.
// statusFilter: "", "pending_review", "approved", "rejected", or "reviewed" (approved+rejected).
func (s *Store) ListProposals(ctx context.Context, proposalID, statusFilter string) ([]domain.Proposal, error) {
	query := `SELECT id,namespace_id,pool_window_id,status,version,reviewer_feedback,created_at FROM consolidation_proposals`
	args := []any{}
	where := []string{}
	if proposalID != "" {
		args = append(args, proposalID)
		where = append(where, fmt.Sprintf("id=$%d", len(args)))
	}
	switch strings.TrimSpace(statusFilter) {
	case "":
		// all statuses
	case "pending_review", "pending":
		where = append(where, `status='pending_review'`)
	case "approved":
		where = append(where, `status='approved'`)
	case "rejected":
		where = append(where, `status='rejected'`)
	case "reviewed":
		where = append(where, `status IN ('approved','rejected')`)
	default:
		return nil, fmt.Errorf("invalid status filter %q (use pending_review, approved, rejected, reviewed)", statusFilter)
	}
	if len(where) > 0 {
		query += ` WHERE ` + strings.Join(where, ` AND `)
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	proposals := []domain.Proposal{}
	for rows.Next() {
		var proposal domain.Proposal
		if err := rows.Scan(&proposal.ID, &proposal.NamespaceID, &proposal.PoolWindowID, &proposal.Status, &proposal.Version, &proposal.ReviewerFeedback, &proposal.CreatedAt); err != nil {
			return nil, err
		}
		tags, err := s.proposalTags(ctx, proposal.ID)
		if err != nil {
			return nil, err
		}
		proposal.Tags = tags
		proposals = append(proposals, proposal)
	}
	return proposals, rows.Err()
}

func (s *Store) proposalTags(ctx context.Context, proposalID string) ([]domain.ProposalTag, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT 
			pt.id, 
			pt.canonical_name, 
			pt.normalized_name, 
			pt.description, 
			pt.aliases, 
			pt.rationale, 
			pt.confidence, 
			pt.accepted,
			EXISTS(
				SELECT 1 FROM tags t 
				JOIN consolidation_proposals cp ON cp.id = pt.proposal_id 
				WHERE t.namespace_id = cp.namespace_id 
				  AND t.normalized_name = pt.normalized_name 
				  AND t.status = 'published'
			) AS is_existing_canonical,
			COALESCE(
				(
					SELECT array_agg(pm.candidate_pool_entry_id::text) 
					FROM proposal_mappings pm 
					WHERE pm.proposal_tag_id = pt.id
				), 
				ARRAY[]::text[]
			) AS covered_entry_ids
		FROM proposal_tags pt
		WHERE pt.proposal_id = $1
		ORDER BY pt.canonical_name
	`, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ProposalTag{}
	for rows.Next() {
		var tag domain.ProposalTag
		var aliases []byte
		if err := rows.Scan(
			&tag.ID,
			&tag.CanonicalName,
			&tag.NormalizedName,
			&tag.Description,
			&aliases,
			&tag.Rationale,
			&tag.Confidence,
			&tag.Accepted,
			&tag.IsExistingCanonical,
			&tag.CoveredEntryIDs,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(aliases, &tag.Aliases); err != nil {
			return nil, err
		}
		if tag.Aliases == nil {
			tag.Aliases = []string{}
		}
		if tag.CoveredEntryIDs == nil {
			tag.CoveredEntryIDs = []string{}
		}
		items = append(items, tag)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Self-healing fallback for existing proposals generated with 0 mappings:
	// Infer covered entry IDs from the pool window's input_snapshot by candidate name.
	hasEmptyCovered := false
	for _, item := range items {
		if len(item.CoveredEntryIDs) == 0 {
			hasEmptyCovered = true
			break
		}
	}
	if hasEmptyCovered {
		var snapshot []byte
		_ = s.pool.QueryRow(ctx, `SELECT pw.input_snapshot FROM pool_windows pw JOIN consolidation_proposals cp ON cp.pool_window_id = pw.id WHERE cp.id = $1`, proposalID).Scan(&snapshot)
		if len(snapshot) > 0 {
			var entries []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			}
			if err := json.Unmarshal(snapshot, &entries); err == nil && len(entries) > 0 {
				for i := range items {
					if len(items[i].CoveredEntryIDs) == 0 {
						targetNames := map[string]bool{}
						targetNames[items[i].NormalizedName] = true
						for _, alias := range items[i].Aliases {
							targetNames[strings.ToLower(strings.TrimSpace(alias))] = true
						}
						for _, entry := range entries {
							if targetNames[strings.ToLower(strings.TrimSpace(entry.Name))] {
								items[i].CoveredEntryIDs = append(items[i].CoveredEntryIDs, entry.ID)
							}
						}
						if len(items[i].CoveredEntryIDs) == 0 {
							for _, entry := range entries {
								items[i].CoveredEntryIDs = append(items[i].CoveredEntryIDs, entry.ID)
							}
						}
					}
				}
			}
		}
	}

	return items, nil
}

type ProposalDecision struct {
	Approve  bool
	Action   string // "approve" | "reject" | "discard"
	Version  int
	Comments string
	Tags     []ProposalTagDecision
}

type ProposalTagDecision struct {
	ProposalTagID string
	Accepted      bool
	CanonicalName string
	Description   string
	Aliases       []string
}

func (s *Store) DecideProposal(ctx context.Context, proposalID, reviewerID string, decision ProposalDecision, normalize func(string) string) error {
	action := strings.ToLower(strings.TrimSpace(decision.Action))
	if action == "" {
		if decision.Approve {
			action = "approve"
		} else {
			action = "reject"
		}
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var namespaceID, windowID string
	var status string
	var currentVersion int
	if err := tx.QueryRow(ctx, `SELECT namespace_id,pool_window_id,status,version FROM consolidation_proposals WHERE id=$1 FOR UPDATE`, proposalID).Scan(&namespaceID, &windowID, &status, &currentVersion); err != nil {
		return err
	}
	if status != "pending_review" && status != "approved" {
		return fmt.Errorf("proposal status (%s) is not eligible for review modification", status)
	}
	if decision.Version != currentVersion {
		return fmt.Errorf("proposal was updated by another reviewer")
	}

	selected := map[string]ProposalTagDecision{}
	for _, item := range decision.Tags {
		selected[item.ProposalTagID] = item
	}

	// Collect all locked rows first. pgx forbids Exec/Query on the same tx while a
	// Rows result is still open ("conn busy").
	type proposalTagRow struct {
		id, canonical, description string
		aliases                    []string
	}
	rows, err := tx.Query(ctx, `SELECT id,canonical_name,description,aliases FROM proposal_tags WHERE proposal_id=$1 FOR UPDATE`, proposalID)
	if err != nil {
		return err
	}
	existing := []proposalTagRow{}
	for rows.Next() {
		var row proposalTagRow
		var aliasesRaw []byte
		if err := rows.Scan(&row.id, &row.canonical, &row.description, &aliasesRaw); err != nil {
			rows.Close()
			return err
		}
		if err := json.Unmarshal(aliasesRaw, &row.aliases); err != nil {
			rows.Close()
			return err
		}
		existing = append(existing, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	deferred := []proposalTagRow{}
	unaccepted := []proposalTagRow{}
	for _, row := range existing {
		id, canonical, description, aliases := row.id, row.canonical, row.description, row.aliases
		choice, supplied := selected[id]
		accepted := action == "approve"
		if supplied {
			accepted = choice.Accepted
			if strings.TrimSpace(choice.CanonicalName) != "" {
				canonical = strings.TrimSpace(choice.CanonicalName)
			}
			if choice.Description != "" {
				description = choice.Description
			}
			if choice.Aliases != nil {
				aliases = choice.Aliases
			}
		}
		aliasesJSON, _ := json.Marshal(aliases)
		if _, err := tx.Exec(ctx, `UPDATE proposal_tags SET accepted=$2,edited_name=$3,edited_description=$4,aliases=$5 WHERE id=$1`, id, accepted, canonical, description, aliasesJSON); err != nil {
			return err
		}
		if accepted {
			deferred = append(deferred, proposalTagRow{id, canonical, description, aliases})
		} else {
			unaccepted = append(unaccepted, proposalTagRow{id, canonical, description, aliases})
		}
	}

	if action == "approve" {
		// Handle unaccepted/reverted tags (logical delete if tag was created by this proposal, unresolve candidate entries)
		for _, item := range unaccepted {
			norm := normalize(item.canonical)
			// Logical delete tag in tags table if it was created by this proposal
			if _, err := tx.Exec(ctx, `
				UPDATE tags 
				SET status = 'archived', updated_at = now() 
				WHERE namespace_id = $1 
				  AND source_proposal_id = $2 
				  AND (normalized_name = $3 OR canonical_name = $4)
			`, namespaceID, proposalID, norm, item.canonical); err != nil {
				return err
			}
			// Delete any aliases for this logically deleted tag
			if _, err := tx.Exec(ctx, `
				DELETE FROM tag_aliases 
				WHERE namespace_id = $1 
				  AND tag_id IN (SELECT id FROM tags WHERE namespace_id = $1 AND source_proposal_id = $2 AND (normalized_name = $3 OR canonical_name = $4))
			`, namespaceID, proposalID, norm, item.canonical); err != nil {
				return err
			}
			// Release all candidate pool entries mapped to this proposal tag back to candidate pool
			if _, err := tx.Exec(ctx, `
				UPDATE candidate_pool_entries 
				SET resolved_at = NULL 
				WHERE id IN (SELECT candidate_pool_entry_id FROM proposal_mappings WHERE proposal_tag_id = $1)
			`, item.id); err != nil {
				return err
			}
		}

		for _, item := range deferred {
			normalized := normalize(item.canonical)
			if normalized == "" {
				return fmt.Errorf("accepted tag %q is invalid after normalization", item.canonical)
			}
			var tagID string
			err := tx.QueryRow(ctx, `INSERT INTO tags(namespace_id,canonical_name,normalized_name,description,source_proposal_id,status) VALUES($1,$2,$3,$4,$5,'published') ON CONFLICT(namespace_id,normalized_name) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,description=EXCLUDED.description,status='published',version=tags.version+1,updated_at=now() RETURNING id`, namespaceID, item.canonical, normalized, item.description, proposalID).Scan(&tagID)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM tag_aliases WHERE tag_id=$1`, tagID); err != nil {
				return err
			}
			validNormalizedNames := []string{normalized}
			for _, alias := range item.aliases {
				alias = strings.TrimSpace(alias)
				aliasNormalized := normalize(alias)
				if aliasNormalized == "" || aliasNormalized == normalized {
					continue
				}
				validNormalizedNames = append(validNormalizedNames, aliasNormalized)
				if _, err := tx.Exec(ctx, `INSERT INTO tag_aliases(tag_id,namespace_id,alias_name,normalized_name) VALUES($1,$2,$3,$4) ON CONFLICT(namespace_id,normalized_name) DO NOTHING`, tagID, namespaceID, alias, aliasNormalized); err != nil {
					return err
				}
			}
			// Resolve candidate entries for canonical and active aliases
			if _, err := tx.Exec(ctx, `
				UPDATE candidate_pool_entries 
				SET resolved_at = now() 
				WHERE id IN (
					SELECT pm.candidate_pool_entry_id 
					FROM proposal_mappings pm
					JOIN candidate_pool_entries c ON c.id = pm.candidate_pool_entry_id
					WHERE pm.proposal_tag_id = $1
					  AND c.normalized_name = ANY($2::text[])
				)
			`, item.id, validNormalizedNames); err != nil {
				return err
			}
			// Reopen/unresolve candidate pool entries for reverted aliases (not in validNormalizedNames)
			if _, err := tx.Exec(ctx, `
				UPDATE candidate_pool_entries 
				SET resolved_at = NULL 
				WHERE id IN (
					SELECT pm.candidate_pool_entry_id 
					FROM proposal_mappings pm
					JOIN candidate_pool_entries c ON c.id = pm.candidate_pool_entry_id
					WHERE pm.proposal_tag_id = $1
					  AND NOT (c.normalized_name = ANY($2::text[]))
				)
			`, item.id, validNormalizedNames); err != nil {
				return err
			}
		}
		// Bulk resolve any candidate pool entries in this namespace that match published canonical tags or aliases
		if _, err := tx.Exec(ctx, `
			UPDATE candidate_pool_entries c
			SET resolved_at = now()
			WHERE c.namespace_id = $1 
			  AND c.resolved_at IS NULL
			  AND (
			    EXISTS (
			        SELECT 1 FROM tags t 
			        WHERE t.namespace_id = c.namespace_id 
			          AND t.normalized_name = c.normalized_name 
			          AND t.status = 'published'
			    )
			    OR
			    EXISTS (
			        SELECT 1 FROM tag_aliases a 
			        WHERE a.namespace_id = c.namespace_id 
			          AND a.normalized_name = c.normalized_name
			    )
			  )
		`, namespaceID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE consolidation_proposals SET status='approved',reviewer_feedback=$2,reviewed_at=now(),version=version+1 WHERE id=$1`, proposalID, decision.Comments); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pool_windows SET status='approved',updated_at=now() WHERE id=$1`, windowID); err != nil {
			return err
		}
	} else if action == "reject" {
		if _, err := tx.Exec(ctx, `UPDATE consolidation_proposals SET status='rejected',reviewer_feedback=$2,reviewed_at=now(),version=version+1 WHERE id=$1`, proposalID, decision.Comments); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pool_windows SET status='rejected',updated_at=now() WHERE id=$1`, windowID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO consolidation_jobs(namespace_id,pool_window_id,parent_proposal_id,job_type) VALUES($1,$2,$3,'rework')`, namespaceID, windowID, proposalID); err != nil {
			return err
		}
	} else if action == "discard" {
		// Discard proposal & pool window without creating a rework job.
		// Unresolved candidate pool entries remain in the pool for manual or threshold trigger.
		if _, err := tx.Exec(ctx, `UPDATE consolidation_proposals SET status='rejected',reviewer_feedback=$2,reviewed_at=now(),version=version+1 WHERE id=$1`, proposalID, decision.Comments); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pool_windows SET status='rejected',updated_at=now() WHERE id=$1`, windowID); err != nil {
			return err
		}
	} else {
		return fmt.Errorf("unsupported proposal decision action %q", action)
	}

	dbDecision := "rejected"
	if action == "approve" {
		dbDecision = "approved"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO review_decisions(proposal_id,reviewer_id,decision,comments) VALUES($1,$2,$3,$4)`, proposalID, reviewerID, dbDecision, decision.Comments); err != nil {
		return err
	}
	auditAction := "review." + action
	data, _ := json.Marshal(map[string]any{"decision": dbDecision, "action": action, "acceptedTagCount": len(deferred)})
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,data) VALUES($1,$2,'consolidation_proposal',$3,$4)`, reviewerID, auditAction, proposalID, data); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) GetProposalCandidateEntries(ctx context.Context, proposalID string) ([]string, error) {
	var snapshot []byte
	err := s.pool.QueryRow(ctx, `SELECT pw.input_snapshot FROM pool_windows pw JOIN consolidation_proposals cp ON cp.pool_window_id = pw.id WHERE cp.id = $1`, proposalID).Scan(&snapshot)
	if err != nil || len(snapshot) == 0 {
		return []string{}, nil
	}
	var entries []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(snapshot, &entries); err != nil {
		return []string{}, nil
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name)
	}
	return names, nil
}
