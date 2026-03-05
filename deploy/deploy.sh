#!/bin/bash
# VPC Deployment Script
# Run this to deploy updates
# Usage: chmod +x deploy.sh && ./deploy.sh

set -e

APP_DIR="/var/www/vpc"

echo "=== Deploying VPC ==="

cd $APP_DIR

# Pull latest code
git pull origin main

# Install dependencies (root first, then backend + frontend via postinstall)
npm install --production
cd backend && npm install --production && cd ..
cd frontend && npm install && cd ..

# Run migrations
cd backend && node db/run-migrations.js && cd ..

# Build frontend
cd frontend && npx vite build && cd ..

# Restart application
pm2 restart vpc

echo "=== Deployment complete ==="
