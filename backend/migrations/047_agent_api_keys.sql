-- Agent API Keys: user-generated keys for remote bot access (chat with the
-- VPC bot / Claude CLI from outside the dashboard).
-- permissions: which data the key is allowed to touch
--   view         - read-only tools (health, logs, files, listings)
--   edit         - mutating tools (write/edit files, scripts, deploys, pm2)
--   delete       - destructive operations (DELETE/DROP/TRUNCATE SQL, rm)
--   repositories - git operations, deploys, site creation
--   database     - run SQL, db health, create databases
--   claude       - direct Claude (CLI) access via /api/agent/v1/ask
-- store_history: when FALSE (default) chat via this key is NOT saved to
-- ai_agent_conversations — calls stay untracked in VPC history.

CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(64) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{"view": true, "edit": false, "delete": false, "repositories": false, "database": false, "claude": false}',
  store_history BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  total_requests INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES vpc_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash ON agent_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_active ON agent_api_keys(is_active);
