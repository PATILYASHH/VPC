-- VPC Sync: Migration tracking and schema snapshots

CREATE TABLE IF NOT EXISTS vpc_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES bana_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name VARCHAR(500),
  sql_up TEXT NOT NULL,
  sql_down TEXT,
  checksum VARCHAR(64),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rolled_back', 'failed')),
  applied_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  applied_by VARCHAR(100),
  source VARCHAR(50) DEFAULT 'pull' CHECK (source IN ('pull', 'push', 'manual')),
  change_ids JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_migrations_project ON vpc_migrations(project_id);
CREATE INDEX IF NOT EXISTS idx_vpc_migrations_version ON vpc_migrations(project_id, version);

CREATE TABLE IF NOT EXISTS vpc_schema_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES bana_projects(id) ON DELETE CASCADE,
  migration_id UUID REFERENCES vpc_migrations(id),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_schema_snapshots_project ON vpc_schema_snapshots(project_id);
