-- Add permissions column to vpc_admins
-- permissions JSONB: { "all": true } for full access, or { "servers": true, "databases": true, ... } for specific
ALTER TABLE vpc_admins ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"all": true}';

-- Set existing admins to have all permissions (they were already full-access)
UPDATE vpc_admins SET permissions = '{"all": true}' WHERE permissions IS NULL;
