-- Track user downloads for smart upload conflict detection
CREATE TABLE IF NOT EXISTS vpshub_user_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES vpc_admins(id) ON DELETE CASCADE,
  branch VARCHAR(255) NOT NULL DEFAULT 'main',
  commit_hash VARCHAR(128) NOT NULL,
  downloaded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (repo_id, user_id, branch)
);

CREATE INDEX IF NOT EXISTS idx_vpshub_downloads_repo ON vpshub_user_downloads(repo_id);
