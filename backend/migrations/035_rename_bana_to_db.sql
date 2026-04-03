-- Rename BanaDB tables to DB
-- This migration renames all bana_* tables and indexes to db_*
-- API keys and data are preserved - only table/index names change

-- Rename tables
ALTER TABLE IF EXISTS bana_projects RENAME TO db_projects;
ALTER TABLE IF EXISTS bana_api_keys RENAME TO db_api_keys;
ALTER TABLE IF EXISTS bana_pull_cursors RENAME TO db_pull_cursors;

-- Rename indexes
ALTER INDEX IF EXISTS idx_bana_projects_slug RENAME TO idx_db_projects_slug;
ALTER INDEX IF EXISTS idx_bana_projects_status RENAME TO idx_db_projects_status;
ALTER INDEX IF EXISTS idx_bana_api_keys_project RENAME TO idx_db_api_keys_project;
ALTER INDEX IF EXISTS idx_bana_api_keys_hash RENAME TO idx_db_api_keys_hash;

-- Update allowed_commands category
UPDATE allowed_commands SET category = 'db' WHERE category = 'banadb';

-- Update permission references in vpc_admins (JSON column)
-- Replace 'banadb' permission key with 'db' so existing admins keep access
UPDATE vpc_admins
SET permissions = (permissions::text)::jsonb - 'banadb' || '{"db": true}'::jsonb
WHERE permissions::text LIKE '%banadb%';
