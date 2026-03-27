-- Add Telegram chat ID to users for Jarvis Telegram access
ALTER TABLE ai_agent_users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_users_telegram ON ai_agent_users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Add attribution to memory (who said it, not who it's scoped to)
-- Memory is now SHARED — all users see all memories
ALTER TABLE ai_agent_memory ADD COLUMN IF NOT EXISTS attributed_to VARCHAR(100);

-- Track Telegram bot polling offset
-- Stored in vpc_settings as 'jarvis_telegram_offset'
