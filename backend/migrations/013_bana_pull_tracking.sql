-- Pull tracking flag on projects
ALTER TABLE bana_projects ADD COLUMN IF NOT EXISTS pull_tracking_enabled BOOLEAN DEFAULT false;
ALTER TABLE bana_projects ADD COLUMN IF NOT EXISTS pull_tracking_installed_at TIMESTAMPTZ;
