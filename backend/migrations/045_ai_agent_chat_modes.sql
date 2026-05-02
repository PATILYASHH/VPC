-- AI Agent: per-user chat mode (read | read_write) + scope allocation
-- + pending approvals + generated document tracking.

CREATE TABLE IF NOT EXISTS ai_agent_chat_settings (
  user_id INTEGER PRIMARY KEY REFERENCES ai_agent_users(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'read_write' CHECK (mode IN ('read', 'read_write')),
  allowed_hosting_ids INTEGER[] DEFAULT NULL,   -- NULL = all
  allowed_db_ids INTEGER[] DEFAULT NULL,        -- NULL = all
  allowed_repo_ids INTEGER[] DEFAULT NULL,      -- NULL = all
  scope_enabled BOOLEAN DEFAULT FALSE,          -- false = no scope filter applied
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_pending_approvals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES ai_agent_users(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES ai_agent_conversations(id) ON DELETE CASCADE,
  tool_name VARCHAR(50) NOT NULL,
  params JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_user ON ai_agent_pending_approvals(user_id, status);

CREATE TABLE IF NOT EXISTS ai_agent_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES ai_agent_users(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES ai_agent_conversations(id) ON DELETE SET NULL,
  filename VARCHAR(255) NOT NULL,
  format VARCHAR(20) NOT NULL,
  byte_size BIGINT,
  title VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_documents_user ON ai_agent_documents(user_id, created_at DESC);
