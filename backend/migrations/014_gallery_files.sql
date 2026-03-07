-- Gallery / File Manager
CREATE TABLE IF NOT EXISTS gallery_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(500) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  file_path VARCHAR(1000) NOT NULL,
  file_size BIGINT DEFAULT 0,
  mime_type VARCHAR(255),
  category VARCHAR(50) DEFAULT 'others' CHECK (category IN ('images', 'docs', 'videos', 'others')),
  folder VARCHAR(500) DEFAULT '/',
  uploaded_by UUID REFERENCES vpc_admins(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gallery_files_category ON gallery_files(category);
CREATE INDEX IF NOT EXISTS idx_gallery_files_folder ON gallery_files(folder);
