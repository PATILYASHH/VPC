-- Mark one integration per type as the default reusable connection
ALTER TABLE vpc_integrations
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;

-- One default per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_vpc_integrations_default_per_type
  ON vpc_integrations(type) WHERE is_default = TRUE;

-- Track which apps reference which integration (audit + reverse-lookup)
CREATE TABLE IF NOT EXISTS vpc_integration_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES vpc_integrations(id) ON DELETE CASCADE,
  app_id VARCHAR(100) NOT NULL,
  resource_kind VARCHAR(100),
  resource_id VARCHAR(255),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (integration_id, app_id, resource_kind, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_uses_app ON vpc_integration_uses(app_id);
CREATE INDEX IF NOT EXISTS idx_integration_uses_integration ON vpc_integration_uses(integration_id);
