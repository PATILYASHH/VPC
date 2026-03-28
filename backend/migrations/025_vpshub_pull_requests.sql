-- VPSHub Code Pull Requests
CREATE TABLE IF NOT EXISTS vpshub_pull_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT '',
  source_branch VARCHAR(255) NOT NULL,
  target_branch VARCHAR(255) NOT NULL DEFAULT 'main',
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'merged', 'closed')),
  author_id UUID NOT NULL REFERENCES vpc_admins(id),
  merged_by UUID REFERENCES vpc_admins(id),
  merged_at TIMESTAMPTZ,
  merge_commit_sha VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_vpshub_prs_repo ON vpshub_pull_requests(repo_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_prs_status ON vpshub_pull_requests(status);
CREATE INDEX IF NOT EXISTS idx_vpshub_prs_author ON vpshub_pull_requests(author_id);
