-- Device authorization codes for VS Code extension sign-in (OAuth-style device flow)
CREATE TABLE IF NOT EXISTS vpc_device_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code VARCHAR(64) NOT NULL UNIQUE,
  user_code VARCHAR(16) NOT NULL UNIQUE,
  client_name VARCHAR(255),
  status VARCHAR(24) NOT NULL DEFAULT 'pending', -- pending | approved | denied | expired
  user_id UUID REFERENCES vpc_admins(id) ON DELETE SET NULL,
  issued_token_id UUID REFERENCES vpshub_tokens(id) ON DELETE SET NULL,
  plaintext_once TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_device_codes_user_code ON vpc_device_codes(user_code);
CREATE INDEX IF NOT EXISTS idx_vpc_device_codes_device_code ON vpc_device_codes(device_code);
CREATE INDEX IF NOT EXISTS idx_vpc_device_codes_expires ON vpc_device_codes(expires_at);
