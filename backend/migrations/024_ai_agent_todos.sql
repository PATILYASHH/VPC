-- Jarvis TODO/task tracking
CREATE TABLE IF NOT EXISTS ai_agent_todos (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending',  -- pending, in_progress, done, blocked
  priority VARCHAR(10) DEFAULT 'normal', -- low, normal, high, urgent
  assigned_by VARCHAR(100),              -- who gave this task
  assigned_to VARCHAR(100),              -- who should do it (Jarvis, Yash, Sir)
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
