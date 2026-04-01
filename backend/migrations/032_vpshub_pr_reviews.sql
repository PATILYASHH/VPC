-- VPSHub pull request reviews
CREATE TABLE IF NOT EXISTS vpshub_pr_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES vpshub_pull_requests(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES vpc_admins(id),
  status VARCHAR(30) NOT NULL CHECK (status IN ('approved', 'changes_requested', 'commented')),
  body TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpshub_pr_reviews_pr ON vpshub_pr_reviews(pr_id);
CREATE INDEX IF NOT EXISTS idx_vpshub_pr_reviews_reviewer ON vpshub_pr_reviews(reviewer_id);
