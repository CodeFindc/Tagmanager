CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('admin', 'reviewer', 'operator');
CREATE TYPE tag_status AS ENUM ('published', 'archived');
CREATE TYPE import_item_status AS ENUM ('matched', 'pooled', 'invalid');
CREATE TYPE pool_window_status AS ENUM ('frozen', 'generating', 'awaiting_review', 'approved', 'rejected', 'failed');
CREATE TYPE job_type AS ENUM ('initial_seed', 'pool_window', 'rework');
CREATE TYPE job_status AS ENUM ('queued', 'running', 'succeeded', 'retryable_failed', 'failed');
CREATE TYPE proposal_status AS ENUM ('pending_review', 'approved', 'rejected');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'operator',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tag_namespaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    candidate_threshold INTEGER NOT NULL DEFAULT 50 CHECK (candidate_threshold > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id UUID NOT NULL REFERENCES tag_namespaces(id),
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status tag_status NOT NULL DEFAULT 'published',
    version INTEGER NOT NULL DEFAULT 1,
    source_proposal_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(namespace_id, normalized_name)
);
CREATE INDEX tags_namespace_status_name_idx ON tags(namespace_id, status, canonical_name);

CREATE TABLE tag_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    namespace_id UUID NOT NULL REFERENCES tag_namespaces(id),
    alias_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(namespace_id, normalized_name)
);

CREATE TABLE import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id UUID NOT NULL REFERENCES tag_namespaces(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    source_name TEXT NOT NULL DEFAULT '',
    total_count INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    pooled_count INTEGER NOT NULL DEFAULT 0,
    invalid_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    raw_tag TEXT NOT NULL,
    normalized_tag TEXT NOT NULL DEFAULT '',
    status import_item_status NOT NULL,
    matched_tag_id UUID REFERENCES tags(id),
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(batch_id, line_number)
);

CREATE TABLE candidate_pool_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id UUID NOT NULL REFERENCES tag_namespaces(id),
    raw_sample TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    UNIQUE(namespace_id, normalized_name)
);
CREATE INDEX candidate_pool_open_idx ON candidate_pool_entries(namespace_id, resolved_at, last_seen_at);

CREATE TABLE pool_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id UUID NOT NULL REFERENCES tag_namespaces(id),
    threshold INTEGER NOT NULL,
    trigger_reason TEXT NOT NULL,
    status pool_window_status NOT NULL DEFAULT 'frozen',
    input_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pool_windows_active_unique ON pool_windows(namespace_id) WHERE status IN ('frozen', 'generating', 'awaiting_review');

CREATE TABLE consolidation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id UUID NOT NULL REFERENCES tag_namespaces(id),
    pool_window_id UUID REFERENCES pool_windows(id),
    parent_proposal_id UUID,
    job_type job_type NOT NULL,
    status job_status NOT NULL DEFAULT 'queued',
    attempt INTEGER NOT NULL DEFAULT 0,
    prompt_version TEXT NOT NULL DEFAULT 'v1',
    error_message TEXT NOT NULL DEFAULT '',
    run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX consolidation_jobs_queue_idx ON consolidation_jobs(status, run_after) WHERE status IN ('queued', 'retryable_failed');

CREATE TABLE consolidation_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace_id UUID NOT NULL REFERENCES tag_namespaces(id),
    pool_window_id UUID NOT NULL REFERENCES pool_windows(id),
    job_id UUID NOT NULL UNIQUE REFERENCES consolidation_jobs(id),
    status proposal_status NOT NULL DEFAULT 'pending_review',
    version INTEGER NOT NULL DEFAULT 1,
    reviewer_feedback TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE proposal_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES consolidation_proposals(id) ON DELETE CASCADE,
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    aliases JSONB NOT NULL DEFAULT '[]',
    rationale TEXT NOT NULL DEFAULT '',
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    accepted BOOLEAN,
    edited_name TEXT,
    edited_description TEXT
);

CREATE TABLE proposal_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_tag_id UUID NOT NULL REFERENCES proposal_tags(id) ON DELETE CASCADE,
    candidate_pool_entry_id UUID NOT NULL REFERENCES candidate_pool_entries(id),
    UNIQUE(proposal_tag_id, candidate_pool_entry_id)
);

ALTER TABLE tags ADD CONSTRAINT tags_source_proposal_fkey FOREIGN KEY (source_proposal_id) REFERENCES consolidation_proposals(id);
ALTER TABLE consolidation_jobs ADD CONSTRAINT jobs_parent_proposal_fkey FOREIGN KEY (parent_proposal_id) REFERENCES consolidation_proposals(id);

CREATE TABLE review_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES consolidation_proposals(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    decision proposal_status NOT NULL,
    comments TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
