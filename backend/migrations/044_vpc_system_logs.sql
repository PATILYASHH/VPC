-- Central system-level error/event log (separate from per-admin action_logs)
CREATE TABLE IF NOT EXISTS vpc_system_logs (
  id BIGSERIAL PRIMARY KEY,
  level VARCHAR(16) NOT NULL,        -- debug|info|warn|error|fatal
  source VARCHAR(64) NOT NULL,       -- subsystem: pipeline, backup, integration, etc.
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_system_logs_level_time ON vpc_system_logs(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vpc_system_logs_source ON vpc_system_logs(source);
CREATE INDEX IF NOT EXISTS idx_vpc_system_logs_created ON vpc_system_logs(created_at DESC);
