-- AI Agent: users, memory, conversations

CREATE TABLE IF NOT EXISTS ai_agent_users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(200),
  greeting VARCHAR(500),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_memory (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES ai_agent_users(id) ON DELETE CASCADE,
  category VARCHAR(50) DEFAULT 'general',
  fact TEXT NOT NULL,
  source VARCHAR(20) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agent_conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES ai_agent_users(id) ON DELETE SET NULL,
  role VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_memory_user ON ai_agent_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_agent_conversations(user_id, created_at DESC);
