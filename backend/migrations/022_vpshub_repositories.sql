-- VPSHub repositories - git repository hosting
CREATE TABLE IF NOT EXISTS vpshub_repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES vpc_admins(id),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  default_branch VARCHAR(255) DEFAULT 'main',
  visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  is_fork BOOLEAN DEFAULT false,
  forked_from UUID REFERENCES vpshub_repositories(id),
  size_bytes BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_vpshub_repos_owner ON vpshub_repositories(owner_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_repos_slug ON vpshub_repositories(slug);
