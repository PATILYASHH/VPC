#!/bin/bash
# VPC Initial VPS Setup Script
# Run this on a fresh Ubuntu 22.04 VPS
# Usage: chmod +x setup.sh && sudo ./setup.sh

set -e

echo "=== VPC VPS Setup ==="

# Update system
apt update && apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2
npm install -g pm2

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install nginx
apt install -y nginx

# Install certbot for SSL
apt install -y certbot python3-certbot-nginx

# Start and enable services
systemctl enable postgresql
systemctl start postgresql
systemctl enable nginx
systemctl start nginx

# Create VPC database and user
echo "=== Setting up PostgreSQL ==="
sudo -u postgres psql << 'SQL'
CREATE USER vpc_admin WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE vpc OWNER vpc_admin;
GRANT ALL PRIVILEGES ON DATABASE vpc TO vpc_admin;
\c vpc
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

# Create directory structure
mkdir -p /var/www/vpc
mkdir -p /var/backups/vpc

echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Clone your VPC repo to /var/www/vpc"
echo "2. Copy backend/.env.example to backend/.env and fill in values"
echo "3. Run: cd /var/www/vpc && npm run postinstall"
echo "4. Run: cd /var/www/vpc && npm run migrate"
echo "5. Run: cd /var/www/vpc && npm run seed"
echo "6. Run: cd /var/www/vpc && npm run build"
echo "7. Copy deploy/nginx-vpc.conf to /etc/nginx/sites-available/vpc"
echo "8. ln -s /etc/nginx/sites-available/vpc /etc/nginx/sites-enabled/vpc"
echo "9. Update server_name in nginx config with your domain"
echo "10. Run: certbot --nginx -d vpc.yourdomain.com"
echo "11. Run: pm2 start deploy/ecosystem.config.js"
echo "12. Run: pm2 save && pm2 startup"
