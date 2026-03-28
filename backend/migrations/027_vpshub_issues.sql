-- VPSHub Issues
CREATE TABLE IF NOT EXISTS vpshub_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  issue_number INTEGER NOT NULL,
  title VARCHAR(500) NOT NULL,
  body TEXT DEFAULT '',
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  author_id UUID NOT NULL REFERENCES vpc_admins(id),
  closed_by UUID REFERENCES vpc_admins(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, issue_number)
);

-- Labels
CREATE TABLE IF NOT EXISTS vpshub_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6b7280',
  description VARCHAR(255) DEFAULT '',
  UNIQUE(repo_id, name)
);

-- Issue-label junction
CREATE TABLE IF NOT EXISTS vpshub_issue_labels (
  issue_id UUID NOT NULL REFERENCES vpshub_issues(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES vpshub_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);

-- Add FK from comments to issues
ALTER TABLE vpshub_comments
  ADD CONSTRAINT fk_vpshub_comments_issue
  FOREIGN KEY (issue_id) REFERENCES vpshub_issues(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vpshub_issues_repo ON vpshub_issues(repo_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_issues_status ON vpshub_issues(status);
CREATE INDEX IF NOT EXISTS idx_vpshub_issues_author ON vpshub_issues(author_id);
