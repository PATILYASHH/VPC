-- NOTIFY deliveries: one row per (message, target device). This single
-- table doubles as the outbox, the offline queue, and the retry log —
-- deliberately, rather than three parallel tables. Status lifecycle:
--   queued     -> no live socket yet, or not attempted
--   sent       -> pushed to a live socket, awaiting client ack
--   delivered  -> client acked
--   failed     -> exceeded max retry attempts
--   expired    -> ttl elapsed before delivery, or evicted (queue full)
--   superseded -> a newer message with the same collapse_key replaced it
CREATE TABLE IF NOT EXISTS notify_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES notify_messages(id) ON DELETE CASCADE,
  device_id UUID REFERENCES notify_devices(id) ON DELETE CASCADE,
  project_id UUID REFERENCES notify_projects(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','expired','superseded')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notify_deliveries_device_status ON notify_deliveries(device_id, status);
CREATE INDEX IF NOT EXISTS idx_notify_deliveries_retry ON notify_deliveries(status, next_attempt_at) WHERE status IN ('queued','sent');
CREATE INDEX IF NOT EXISTS idx_notify_deliveries_project ON notify_deliveries(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notify_deliveries_message ON notify_deliveries(message_id);
