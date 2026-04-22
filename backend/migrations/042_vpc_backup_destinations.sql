-- External backup destinations (Supabase, S3, etc.)
CREATE TABLE IF NOT EXISTS vpc_backup_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(32) NOT NULL, -- 'supabase' | 's3' (future)
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- For supabase: { url, service_role_key (encrypted), bucket, sync_data, sync_schema }
  schedule_cron VARCHAR(64),        -- standard 5-field cron, NULL disables
  interval_minutes INTEGER,         -- simple alternative to cron (e.g. every 60 min)
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(24),      -- 'success' | 'failed' | 'running'
  last_run_error TEXT,
  last_run_bytes BIGINT,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES vpc_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_backup_destinations_enabled ON vpc_backup_destinations(enabled);
CREATE INDEX IF NOT EXISTS idx_vpc_backup_destinations_next_run ON vpc_backup_destinations(next_run_at);

-- Audit trail per-destination
CREATE TABLE IF NOT EXISTS vpc_backup_destination_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES vpc_backup_destinations(id) ON DELETE CASCADE,
  backup_id UUID REFERENCES backups(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL,       -- 'success' | 'failed' | 'running'
  bytes_uploaded BIGINT,
  remote_path TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vpc_backup_dest_runs_dest ON vpc_backup_destination_runs(destination_id, started_at DESC);
