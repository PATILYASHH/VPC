-- Store Supabase connection for ongoing sync
ALTER TABLE bana_projects ADD COLUMN IF NOT EXISTS supabase_connection TEXT;
ALTER TABLE bana_projects ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE bana_projects ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT NULL;
