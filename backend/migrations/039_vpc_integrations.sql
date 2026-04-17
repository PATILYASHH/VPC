-- Integrations platform: connect GitHub, Supabase, Docker, Cloudflare, Slack, Discord, SMTP
CREATE TABLE IF NOT EXISTS vpc_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL CHECK (type IN ('github', 'supabase', 'docker', 'cloudflare', 'slack', 'discord', 'smtp')),
  name VARCHAR(255) NOT NULL,
  config JSONB DEFAULT '{}',
  credentials_key VARCHAR(100),
  status VARCHAR(50) DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_checked_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_integrations_type ON vpc_integrations(type);
