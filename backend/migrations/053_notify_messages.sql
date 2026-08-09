-- NOTIFY messages: one row per send call (a single POST /send may fan out
-- to many devices — see notify_deliveries for the per-device rows).
CREATE TABLE IF NOT EXISTS notify_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES notify_projects(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('device','topic','broadcast')),
  target_value VARCHAR(255),
  title VARCHAR(255),
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  ttl_seconds INTEGER NOT NULL DEFAULT 259200,
  collapse_key VARCHAR(100),
  created_by_key_id UUID REFERENCES notify_api_keys(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','expired')),
  target_device_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notify_messages_project ON notify_messages(project_id, created_at DESC);
