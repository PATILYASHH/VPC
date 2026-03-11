-- System-wide settings (key-value store for config like API keys)
CREATE TABLE IF NOT EXISTS vpc_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  is_secret BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(100)
);
