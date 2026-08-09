-- NOTIFY: push notification projects (mirrors db_projects — one isolated
-- notification namespace per Android app a VPC user is building).
CREATE TABLE IF NOT EXISTS notify_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  android_package_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  max_devices INTEGER NOT NULL DEFAULT 10000,
  max_queue_per_device INTEGER NOT NULL DEFAULT 100,
  default_ttl_seconds INTEGER NOT NULL DEFAULT 259200,
  created_by UUID REFERENCES vpc_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notify_projects_slug ON notify_projects(slug);
CREATE INDEX IF NOT EXISTS idx_notify_projects_status ON notify_projects(status);
