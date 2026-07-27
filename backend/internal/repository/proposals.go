package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListProposals(ctx context.Context, proposalID string) ([]domain.Proposal, error) {
	query := `SELECT id,namespace_id,pool_window_id,status,version,reviewer_feedback,created_at FROM consolidation_proposals`
	args := []any{}
	if proposalID != "" {
		query += ` WHERE id=$1`
		args = append(args, proposalID)
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
	rows, err := s.pool.Query(ctx, `SELECT id,canonical_name,normalized_name,description,aliases,rationale,confidence,accepted FROM proposal_tags WHERE proposal_id=$1 ORDER BY canonical_name`, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ProposalTag{}
	for rows.Next() {
		var tag domain.ProposalTag
		var aliases []byte
		if err := rows.Scan(&tag.ID, &tag.CanonicalName, &tag.NormalizedName, &tag.Description, &aliases, &tag.Rationale, &tag.Confidence, &tag.Accepted); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(aliases, &tag.Aliases); err != nil {
			return nil, err
		}
		mappingRows, err := s.pool.Query(ctx, `SELECT candidate_pool_entry_id FROM proposal_mappings WHERE proposal_tag_id=$1`, tag.ID)
		if err != nil {
			return nil, err
		}
		for mappingRows.Next() {
			var id string
			if err := mappingRows.Scan(&id); err != nil {
				mappingRows.Close()
				return nil, err
			}
			tag.CoveredEntryIDs = append(tag.CoveredEntryIDs, id)
		}
		if err := mappingRows.Err(); err != nil {
			mappingRows.Close()
			return nil, err
		}
		mappingRows.Close()
		items = append(items, tag)
	}
	return items, rows.Err()
}

type ProposalDecision struct {
	Approve  bool
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
	if status != "pending_review" {
		return fmt.Errorf("proposal is no longer pending review")
	}
	if decision.Version != currentVersion {
		return fmt.Errorf("proposal was updated by another reviewer")
	}

	selected := map[string]ProposalTagDecision{}
	for _, item := range decision.Tags {
		selected[item.ProposalTagID] = item
	}
	rows, err := tx.Query(ctx, `SELECT id,canonical_name,description,aliases FROM proposal_tags WHERE proposal_id=$1 FOR UPDATE`, proposalID)
	if err != nil {
		return err
	}
	deferred := []struct {
		id, canonical, description string
		aliases                    []string
	}{}
	for rows.Next() {
		var id, canonical, description string
		var aliasesRaw []byte
		if err := rows.Scan(&id, &canonical, &description, &aliasesRaw); err != nil {
			rows.Close()
			return err
		}
		var aliases []string
		if err := json.Unmarshal(aliasesRaw, &aliases); err != nil {
			rows.Close()
			return err
		}
		choice, supplied := selected[id]
		accepted := decision.Approve
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
		if _, err := tx.Exec(ctx, `UPDATE proposal_tags SET accepted=$2,edited_name=$3,edited_description=$4 WHERE id=$1`, id, accepted, canonical, description); err != nil {
			rows.Close()
			return err
		}
		if accepted {
			deferred = append(deferred, struct {
				id, canonical, description string
				aliases                    []string
			}{id, canonical, description, aliases})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	if decision.Approve {
		for _, item := range deferred {
			normalized := normalize(item.canonical)
			if normalized == "" {
				return fmt.Errorf("accepted tag %q is invalid after normalization", item.canonical)
			}
			var tagID string
			err := tx.QueryRow(ctx, `INSERT INTO tags(namespace_id,canonical_name,normalized_name,description,source_proposal_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(namespace_id,normalized_name) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,description=EXCLUDED.description,version=tags.version+1,updated_at=now() RETURNING id`, namespaceID, item.canonical, normalized, item.description, proposalID).Scan(&tagID)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM tag_aliases WHERE tag_id=$1`, tagID); err != nil {
				return err
			}
			for _, alias := range item.aliases {
				alias = strings.TrimSpace(alias)
				aliasNormalized := normalize(alias)
				if aliasNormalized == "" || aliasNormalized == normalized {
					continue
				}
				if _, err := tx.Exec(ctx, `INSERT INTO tag_aliases(tag_id,namespace_id,alias_name,normalized_name) VALUES($1,$2,$3,$4) ON CONFLICT(namespace_id,normalized_name) DO NOTHING`, tagID, namespaceID, alias, aliasNormalized); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(ctx, `UPDATE candidate_pool_entries SET resolved_at=now() WHERE id IN (SELECT candidate_pool_entry_id FROM proposal_mappings WHERE proposal_tag_id=$1)`, item.id); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE consolidation_proposals SET status='approved',reviewer_feedback=$2,reviewed_at=now(),version=version+1 WHERE id=$1`, proposalID, decision.Comments); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pool_windows SET status='approved',updated_at=now() WHERE id=$1`, windowID); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `UPDATE consolidation_proposals SET status='rejected',reviewer_feedback=$2,reviewed_at=now(),version=version+1 WHERE id=$1`, proposalID, decision.Comments); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pool_windows SET status='rejected',updated_at=now() WHERE id=$1`, windowID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO consolidation_jobs(namespace_id,pool_window_id,parent_proposal_id,job_type) VALUES($1,$2,$3,'rework')`, namespaceID, windowID, proposalID); err != nil {
			return err
		}
	}
	statusValue := "approved"
	if !decision.Approve {
		statusValue = "rejected"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO review_decisions(proposal_id,reviewer_id,decision,comments) VALUES($1,$2,$3,$4)`, proposalID, reviewerID, statusValue, decision.Comments); err != nil {
		return err
	}
	data, _ := json.Marshal(map[string]any{"decision": statusValue, "acceptedTagCount": len(deferred)})
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,data) VALUES($1,$2,'consolidation_proposal',$3,$4)`, reviewerID, "review."+statusValue, proposalID, data); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
