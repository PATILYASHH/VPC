const ALLOWED_SERVICES = ['erp', 'nginx'];

const SERVICE_MAP = {
  erp: { type: 'pm2', processName: 'erp' },
  nginx: { type: 'system', serviceName: 'nginx' },
};

module.exports = { ALLOWED_SERVICES, SERVICE_MAP };
