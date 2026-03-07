CREATE TABLE IF NOT EXISTS web_hosting_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  project_type VARCHAR(20) NOT NULL DEFAULT 'static',
  git_url TEXT,
  git_token TEXT,
  git_branch VARCHAR(100) DEFAULT 'main',
  deploy_path TEXT,
  node_entry_point VARCHAR(255) DEFAULT 'index.js',
  node_port INTEGER,
  pm2_name VARCHAR(100),
  build_command VARCHAR(500),
  install_command VARCHAR(500) DEFAULT 'npm install',
  output_dir VARCHAR(255),
  env_vars JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'stopped',
  last_deploy_at TIMESTAMPTZ,
  last_deploy_log TEXT,
  created_by UUID REFERENCES vpc_admins(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_hosting_slug ON web_hosting_projects(slug);
CREATE INDEX IF NOT EXISTS idx_web_hosting_status ON web_hosting_projects(status);
