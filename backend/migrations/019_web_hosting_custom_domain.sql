-- Add custom domain support to web hosting projects
ALTER TABLE web_hosting_projects ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_hosting_custom_domain
  ON web_hosting_projects(custom_domain)
  WHERE custom_domain IS NOT NULL AND custom_domain != '';
