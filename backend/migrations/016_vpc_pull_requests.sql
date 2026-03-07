-- VPC Sync: Pull Request system for migration review workflow

CREATE TABLE IF NOT EXISTS vpc_pull_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES bana_projects(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  sql_content TEXT NOT NULL,
  sql_down TEXT,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'testing', 'merged', 'closed', 'conflict')),
  sandbox_result JSONB,
  conflict_result JSONB,
  submitted_by VARCHAR(100) DEFAULT 'vpcsync',
  reviewed_by VARCHAR(100),
  merged_by VARCHAR(100),
  migration_id UUID REFERENCES vpc_migrations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  merged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vpc_pull_requests_project ON vpc_pull_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_vpc_pull_requests_status ON vpc_pull_requests(project_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vpc_pull_requests_number ON vpc_pull_requests(project_id, pr_number);
