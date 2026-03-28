-- Link VPSHub repos to Web Hosting projects for auto-deploy
ALTER TABLE vpshub_repositories
  ADD COLUMN IF NOT EXISTS linked_hosting_id UUID REFERENCES web_hosting_projects(id) ON DELETE SET NULL;
