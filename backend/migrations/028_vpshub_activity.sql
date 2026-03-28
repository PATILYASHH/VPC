-- VPSHub Activity Feed
CREATE TABLE IF NOT EXISTS vpshub_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES vpc_admins(id),
  action VARCHAR(50) NOT NULL,
  -- e.g. 'push', 'pr_opened', 'pr_merged', 'pr_closed', 'issue_opened', 'issue_closed', 'comment'
  ref_type VARCHAR(20),  -- 'pull_request', 'issue', 'branch', 'tag'
  ref_id UUID,
  ref_number INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpshub_activity_repo ON vpshub_activity(repo_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_activity_actor ON vpshub_activity(actor_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_activity_created ON vpshub_activity(created_at DESC);
