-- VPSHub PR & Issue Comments (shared table)
CREATE TABLE IF NOT EXISTS vpshub_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  -- Polymorphic: either pr_id or issue_id is set
  pr_id UUID REFERENCES vpshub_pull_requests(id) ON DELETE CASCADE,
  issue_id UUID,  -- FK added in 027 migration
  author_id UUID NOT NULL REFERENCES vpc_admins(id),
  body TEXT NOT NULL,
  -- For inline PR comments
  file_path VARCHAR(1000),
  line_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpshub_comments_pr ON vpshub_comments(pr_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_comments_issue ON vpshub_comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_comments_author ON vpshub_comments(author_id);
