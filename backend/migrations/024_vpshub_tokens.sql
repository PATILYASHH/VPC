-- VPSHub personal access tokens for git HTTP auth
CREATE TABLE IF NOT EXISTS vpshub_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vpc_admins(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  token_prefix VARCHAR(15) NOT NULL,
  scopes JSONB DEFAULT '["repo"]',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpshub_tokens_user ON vpshub_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_tokens_hash ON vpshub_tokens(token_hash);
