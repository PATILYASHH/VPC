-- NOTIFY API keys, scoped per project (mirrors db_api_keys).
-- role:
--   client - embedded in the Android APK (decompilable, semi-public).
--            Can only register/connect/subscribe. Never allowed to send.
--   server - backend-to-backend key, must never ship in a client binary.
--            Required to call /send and read delivery status.
CREATE TABLE IF NOT EXISTS notify_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES notify_projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'client' CHECK (role IN ('client','server')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  encrypted_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notify_api_keys_project ON notify_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_notify_api_keys_hash ON notify_api_keys(key_hash);
