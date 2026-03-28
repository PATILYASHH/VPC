-- VPSHub collaborators - repository access control
CREATE TABLE IF NOT EXISTS vpshub_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES vpshub_repositories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES vpc_admins(id),
  permission VARCHAR(20) DEFAULT 'read' CHECK (permission IN ('read', 'write', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, user_id)
);
