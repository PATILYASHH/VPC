-- BanaDB Projects
CREATE TABLE IF NOT EXISTS bana_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  db_name VARCHAR(100) UNIQUE NOT NULL,
  db_user VARCHAR(100) UNIQUE NOT NULL,
  db_password TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  storage_limit_mb INTEGER DEFAULT 500,
  max_connections INTEGER DEFAULT 10,
  created_by UUID REFERENCES vpc_admins(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bana_projects_slug ON bana_projects(slug);
CREATE INDEX IF NOT EXISTS idx_bana_projects_status ON bana_projects(status);
