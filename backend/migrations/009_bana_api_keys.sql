-- BanaDB API Keys (per-project)
CREATE TABLE IF NOT EXISTS bana_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES bana_projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'anon' CHECK (role IN ('anon','service')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bana_api_keys_project ON bana_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_bana_api_keys_hash ON bana_api_keys(key_hash);
