-- Star/lock DB projects: starred projects cannot be deleted (guards against
-- accidental drops). Users must unstar first before deleting.

ALTER TABLE db_projects
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS starred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS starred_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_db_projects_starred ON db_projects(is_starred) WHERE is_starred = TRUE;
