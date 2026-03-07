CREATE TABLE IF NOT EXISTS allowed_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command VARCHAR(500) NOT NULL UNIQUE,
    description VARCHAR(500),
    category VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    risk_level VARCHAR(20) DEFAULT 'low'
        CHECK (risk_level IN ('low', 'medium', 'high')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO allowed_commands (command, description, category, risk_level) VALUES
    ('vpc status',         'Show all service statuses',       'system',   'low'),
    ('vpc uptime',         'Show system uptime',              'system',   'low'),
    ('vpc disk',           'Show disk usage summary',         'system',   'low'),
    ('vpc memory',         'Show memory usage',               'system',   'low'),
    ('vpc logs erp',       'Tail ERP application logs',       'logs',     'low'),
    ('vpc logs nginx',     'Tail nginx access/error logs',    'logs',     'low'),
    ('vpc restart erp',    'Restart ERP application',         'system',   'medium'),
    ('vpc restart nginx',  'Restart nginx web server',        'system',   'medium'),
    ('vpc db status',      'Show PostgreSQL connection info',  'database', 'low'),
    ('vpc db size',        'Show database size',              'database', 'low'),
    ('vpc db query <sql>', 'Run SQL on the main VPC database', 'database', 'high'),
    ('vpc backup now',     'Run an immediate database backup', 'database', 'medium'),
    ('vpc network ports',  'List open ports',                 'network',  'low'),
    ('vpc bana list',                    'List all BanaDB projects',              'banadb', 'low'),
    ('vpc bana <slug> info',             'Show project info and DB size',         'banadb', 'low'),
    ('vpc bana <slug> tables',           'List tables with sizes and owners',     'banadb', 'low'),
    ('vpc bana <slug> size',             'Show table sizes in project',           'banadb', 'low'),
    ('vpc bana <slug> sql <query>',      'Run SQL on a BanaDB project database', 'banadb', 'high'),
    ('vpc bana <slug> fix-ownership',    'Fix table ownership for project',       'banadb', 'medium')
ON CONFLICT (command) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_commands_active ON allowed_commands(is_active) WHERE is_active = true;
