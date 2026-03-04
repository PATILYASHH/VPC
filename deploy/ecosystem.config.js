module.exports = {
  apps: [
    {
      name: 'vpc',
      script: 'app.js',
      cwd: '/var/www/vpc',
      env: {
        NODE_ENV: 'production',
        PORT: 8001,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
