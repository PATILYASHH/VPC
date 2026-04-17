-- Pipeline: groups related repos, databases, and hosting sites with environment tracking
CREATE TABLE IF NOT EXISTS vpc_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  color VARCHAR(20) DEFAULT 'blue',
  created_by UUID REFERENCES vpc_admins(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_pipelines_slug ON vpc_pipelines(slug);

CREATE TABLE IF NOT EXISTS vpc_pipeline_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES vpc_pipelines(id) ON DELETE CASCADE,
  resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('repo', 'db', 'hosting')),
  resource_id UUID NOT NULL,
  environment VARCHAR(20) NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'beta')),
  display_order INTEGER DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pipeline_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_vpc_pipeline_resources_pipeline ON vpc_pipeline_resources(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_vpc_pipeline_resources_env ON vpc_pipeline_resources(pipeline_id, environment);

-- Pipeline activity feed
CREATE TABLE IF NOT EXISTS vpc_pipeline_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES vpc_pipelines(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  resource_type VARCHAR(20),
  resource_name VARCHAR(255),
  environment VARCHAR(20),
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_pipeline_activity_pipeline ON vpc_pipeline_activity(pipeline_id, created_at DESC);

-- Pipeline settings
ALTER TABLE vpc_pipelines ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
