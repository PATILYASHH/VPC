-- Pull Keys: extend role constraint + cursor tracking

-- Allow 'pull' as a valid API key role
ALTER TABLE bana_api_keys DROP CONSTRAINT IF EXISTS bana_api_keys_role_check;
ALTER TABLE bana_api_keys ADD CONSTRAINT bana_api_keys_role_check
  CHECK (role IN ('anon', 'service', 'pull'));

-- Pull cursor tracking: stores last-pulled change ID per pull key
CREATE TABLE IF NOT EXISTS bana_pull_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES bana_api_keys(id) ON DELETE CASCADE,
  project_id UUID REFERENCES bana_projects(id) ON DELETE CASCADE,
  last_change_id BIGINT DEFAULT 0,
  last_pulled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(api_key_id)
);

CREATE INDEX IF NOT EXISTS idx_bana_pull_cursors_project ON bana_pull_cursors(project_id);
CREATE INDEX IF NOT EXISTS idx_bana_pull_cursors_key ON bana_pull_cursors(api_key_id);
