-- Fork & Environment support for db_projects
ALTER TABLE db_projects ADD COLUMN IF NOT EXISTS forked_from UUID REFERENCES db_projects(id) ON DELETE SET NULL;
ALTER TABLE db_projects ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'production';

CREATE INDEX IF NOT EXISTS idx_db_projects_forked_from ON db_projects(forked_from);
CREATE INDEX IF NOT EXISTS idx_db_projects_environment ON db_projects(environment);
