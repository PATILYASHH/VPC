-- Add domain verification support to web hosting projects
ALTER TABLE web_hosting_projects ADD COLUMN IF NOT EXISTS domain_verify_token VARCHAR(64);
ALTER TABLE web_hosting_projects ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN NOT NULL DEFAULT FALSE;
