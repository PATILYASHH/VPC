-- NOTIFY topic subscriptions: simple string-topic pub/sub for V1 targeting
-- (e.g. "all users of feature X"). Attribute-based segments are a later
-- milestone, not built here.
CREATE TABLE IF NOT EXISTS notify_topic_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES notify_projects(id) ON DELETE CASCADE,
  device_id UUID REFERENCES notify_devices(id) ON DELETE CASCADE,
  topic VARCHAR(255) NOT NULL,
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (device_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_notify_topic_subs_topic ON notify_topic_subscriptions(project_id, topic);
