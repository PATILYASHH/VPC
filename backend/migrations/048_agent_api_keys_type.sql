-- Agent API key types:
--   bot    - full VPC Bot access (tools gated by permissions), key prefix vpcbot_
--   claude - direct Claude CLI access only (/ask), no bot/tools, key prefix vpccli_

ALTER TABLE agent_api_keys ADD COLUMN IF NOT EXISTS key_type VARCHAR(10) NOT NULL DEFAULT 'bot';
