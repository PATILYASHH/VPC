CREATE TABLE IF NOT EXISTS integration_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_name VARCHAR(255) NOT NULL,
    system_type VARCHAR(100),
    base_url VARCHAR(500),
    status VARCHAR(50) DEFAULT 'unknown'
        CHECK (status IN ('connected', 'disconnected', 'error', 'degraded', 'unknown')),
    last_ping_at TIMESTAMPTZ,
    total_requests_today INTEGER DEFAULT 0,
    total_errors_today INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER DEFAULT 0,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_stats_hourly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES integration_stats(id) ON DELETE CASCADE,
    hour_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    avg_response_ms INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_int_stats_name ON integration_stats(system_name);
CREATE INDEX IF NOT EXISTS idx_int_hourly_lookup ON integration_stats_hourly(integration_id, hour_start DESC);
