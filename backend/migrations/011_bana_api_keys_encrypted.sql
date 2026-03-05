-- Add encrypted_key column to store recoverable API keys (shown in dashboard like Supabase)
ALTER TABLE bana_api_keys ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
