-- NOTIFY devices: one row per Android install that has registered with a
-- notify project. push_token is a server-issued opaque handle (NOT an FCM
-- token — NOTIFY has no Firebase dependency) used to target a device.
CREATE TABLE IF NOT EXISTS notify_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES notify_projects(id) ON DELETE CASCADE,
  device_id VARCHAR(64) NOT NULL,
  platform VARCHAR(20) NOT NULL DEFAULT 'android',
  app_version VARCHAR(50),
  sdk_version VARCHAR(20),
  os_version VARCHAR(20),
  device_model VARCHAR(100),
  push_token VARCHAR(128) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','unregistered','stale')),
  last_seen_at TIMESTAMPTZ,
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_notify_devices_project ON notify_devices(project_id);
CREATE INDEX IF NOT EXISTS idx_notify_devices_token ON notify_devices(push_token);
CREATE INDEX IF NOT EXISTS idx_notify_devices_status ON notify_devices(project_id, status);
