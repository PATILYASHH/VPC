-- Track each pipeline promotion run (snapshot + stages) for auditing & rollback
CREATE TABLE IF NOT EXISTS vpc_pipeline_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES vpc_pipelines(id) ON DELETE CASCADE,
  initiated_by UUID REFERENCES vpc_admins(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending', -- pending|running|success|failed|rolled_back
  stages JSONB DEFAULT '[]'::jsonb,              -- array of {name, status, started_at, completed_at, error?, details?}
  backup_id UUID,                                 -- prod DB snapshot taken before promotion (for rollback)
  schema_diff JSONB,
  applied_sql TEXT,
  deployed_sites JSONB DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vpc_pipeline_promotions_pipeline ON vpc_pipeline_promotions(pipeline_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_vpc_pipeline_promotions_status ON vpc_pipeline_promotions(status);

-- Integration visibility (fix #7)
ALTER TABLE vpc_integrations ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES vpc_admins(id) ON DELETE SET NULL;
ALTER TABLE vpc_integrations ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'shared'; -- private|shared
CREATE INDEX IF NOT EXISTS idx_vpc_integrations_owner ON vpc_integrations(created_by);

-- Key rotation (fix #6) — tag each encrypted blob with the key version that produced it
ALTER TABLE vpc_settings ADD COLUMN IF NOT EXISTS enc_key_version SMALLINT DEFAULT 1;
