-- VPC VCS: Custom version control metadata tables
-- Refs and commits are indexed here for fast queries (source of truth is filesystem)

CREATE TABLE IF NOT EXISTS vpshub_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  name VARCHAR(500) NOT NULL,
  target_hash VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, name)
);

CREATE INDEX IF NOT EXISTS idx_vpshub_refs_repo ON vpshub_refs(repo_id);

CREATE TABLE IF NOT EXISTS vpshub_commits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  hash VARCHAR(64) NOT NULL,
  tree_hash VARCHAR(64) NOT NULL,
  author_name VARCHAR(255),
  author_email VARCHAR(255),
  author_date TIMESTAMPTZ,
  committer_name VARCHAR(255),
  committer_email VARCHAR(255),
  committer_date TIMESTAMPTZ,
  message TEXT,
  body TEXT,
  parent_hashes VARCHAR(64)[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_vpshub_commits_repo ON vpshub_commits(repo_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_commits_hash ON vpshub_commits(hash);
CREATE INDEX IF NOT EXISTS idx_vpshub_commits_date ON vpshub_commits(repo_id, author_date DESC);
