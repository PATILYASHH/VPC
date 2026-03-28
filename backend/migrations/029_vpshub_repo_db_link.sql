-- Link VPSHub repos to BanaDB projects for auto-migration
ALTER TABLE vpshub_repositories
  ADD COLUMN IF NOT EXISTS linked_project_id UUID REFERENCES bana_projects(id) ON DELETE SET NULL;

-- Track which migrations from a repo have been applied
CREATE TABLE IF NOT EXISTS vpshub_repo_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES bana_projects(id) ON DELETE CASCADE,
  file_path VARCHAR(1000) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed', 'skipped')),
  error_message TEXT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpshub_repo_migrations_repo ON vpshub_repo_migrations(repo_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_repo_migrations_project ON vpshub_repo_migrations(project_id);
