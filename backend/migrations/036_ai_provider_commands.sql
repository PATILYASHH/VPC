-- AI terminal commands
INSERT INTO allowed_commands (command, description, category, risk_level) VALUES
  ('vpc ai ask <question>',    'Ask AI a quick question',           'ai', 'low'),
  ('vpc ai sql <description>', 'Generate SQL from natural language', 'ai', 'medium'),
  ('vpc ai summarize logs',    'AI summary of recent logs',         'ai', 'low'),
  ('vpc ai providers',         'List available AI providers',       'ai', 'low'),
  ('vpc ai use <provider>',    'Set default AI provider',           'ai', 'low')
ON CONFLICT (command) DO NOTHING;
