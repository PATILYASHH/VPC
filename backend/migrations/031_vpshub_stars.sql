-- VPSHub repository stars
CREATE TABLE IF NOT EXISTS vpshub_stars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES vpc_admins(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vpshub_stars_repo ON vpshub_stars(repo_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_stars_user ON vpshub_stars(user_id);

-- Add star_count cache column to repositories
ALTER TABLE vpshub_repositories ADD COLUMN IF NOT EXISTS star_count INTEGER DEFAULT 0;
