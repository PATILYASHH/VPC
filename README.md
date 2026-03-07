# VPC - Virtual PC Control

Web-based OS-style VPS management dashboard with PostgreSQL management (BanaDB), server monitoring, file gallery, API key management, and more.

## Tech Stack

- **Backend:** Node.js, Express, PostgreSQL (`pg`)
- **Frontend:** React 18, Vite, TailwindCSS, Radix UI, Zustand, React Query
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx

---

## Fresh VPS Setup (Ubuntu 22.04)

### 1. Install System Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install Nginx
apt install -y nginx

# Install Certbot for SSL
apt install -y certbot python3-certbot-nginx

# Start and enable services
systemctl enable postgresql && systemctl start postgresql
systemctl enable nginx && systemctl start nginx
```

### 2. Setup PostgreSQL Database

```bash
sudo -u postgres psql << 'SQL'
CREATE USER vpc_admin WITH PASSWORD 'YOUR_STRONG_PASSWORD_HERE';
CREATE DATABASE vpc OWNER vpc_admin;
GRANT ALL PRIVILEGES ON DATABASE vpc TO vpc_admin;
\c vpc
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

### 3. Clone and Install Project

```bash
# Create directory
mkdir -p /var/www/vpc

# Clone repo
git clone https://github.com/YOUR_USERNAME/VPC.git /var/www/vpc
cd /var/www/vpc

# Install all dependencies (root + backend + frontend)
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 4. Configure Environment

```bash
# Copy example env and edit it
cp backend/.env.example backend/.env
nano backend/.env
```

Update these values in `backend/.env`:

```env
NODE_ENV=production
PORT=8001

# PostgreSQL (use the password you set in step 2)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vpc
DB_USER=vpc_admin
DB_PASSWORD=YOUR_STRONG_PASSWORD_HERE

# JWT (generate a random string: openssl rand -hex 32)
JWT_SECRET=YOUR_RANDOM_64_CHAR_STRING
JWT_EXPIRES_IN=24h

# Initial admin credentials
VPC_ADMIN_USERNAME=admin
VPC_ADMIN_EMAIL=admin@yourdomain.com
VPC_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD

# Backup directory
BACKUP_DIR=/var/backups/vpc

# Frontend URL (your domain)
FRONTEND_URL=https://vpc.yourdomain.com
```

### 5. Run Migrations and Seed Admin

```bash
cd /var/www/vpc

# Create required directories
mkdir -p /var/backups/vpc
mkdir -p uploads/gallery

# Run database migrations
cd backend && node db/run-migrations.js && cd ..

# Create initial admin user
cd backend && node db/seed-admin.js && cd ..
```

### 6. Build Frontend

```bash
cd /var/www/vpc/frontend
npx vite build
cd ..
```

### 7. Setup Nginx

```bash
# Copy nginx config
cp deploy/nginx-vpc.conf /etc/nginx/sites-available/vpc

# Edit the config - replace vpc.yourdomain.com with your actual domain
nano /etc/nginx/sites-available/vpc

# Enable the site
ln -s /etc/nginx/sites-available/vpc /etc/nginx/sites-enabled/vpc

# Remove default site (optional)
rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
nginx -t && systemctl reload nginx
```

### 8. Setup SSL (HTTPS)

```bash
certbot --nginx -d vpc.yourdomain.com
```

### 9. Start Application with PM2

```bash
cd /var/www/vpc
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
```

Your VPC dashboard is now live at `https://vpc.yourdomain.com`

---

## Deploying Updates

Run these commands on your VPS whenever you push new code:

```bash
cd /var/www/vpc
git pull origin main
npm install
cd backend && npm install && cd ..
cd frontend && npm install && npx vite build && cd ..
cd backend && node db/run-migrations.js && cd ..
pm2 restart vpc
```

Or use the deploy script:

```bash
cd /var/www/vpc
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

---

## Quick Reference Commands

| Action | Command |
|--------|---------|
| Start app | `pm2 start deploy/ecosystem.config.js` |
| Stop app | `pm2 stop vpc` |
| Restart app | `pm2 restart vpc` |
| View logs | `pm2 logs vpc` |
| View status | `pm2 status` |
| Run migrations | `cd backend && node db/run-migrations.js` |
| Seed admin | `cd backend && node db/seed-admin.js` |
| Build frontend | `cd frontend && npx vite build` |
| Nginx reload | `nginx -t && systemctl reload nginx` |
| SSL renew | `certbot renew` |

---

## Project Structure

```
VPC/
├── app.js                    # Entry point (production server)
├── package.json              # Root package.json
├── backend/
│   ├── server.js             # Express app setup
│   ├── .env                  # Environment config (not in git)
│   ├── .env.example          # Example env file
│   ├── middleware/
│   │   └── auth.js           # JWT auth + permission middleware
│   ├── routes/
│   │   ├── auth.js           # Login / TOTP
│   │   ├── users.js          # Admin user management
│   │   ├── servers.js        # Server monitoring
│   │   ├── databases.js      # PostgreSQL management
│   │   ├── banadb.js         # BanaDB projects + storage
│   │   ├── banaApi.js        # BanaDB REST API
│   │   ├── gallery.js        # Gallery + bucket viewer
│   │   ├── backups.js        # Database backups
│   │   ├── apiKeys.js        # API key management
│   │   └── ...
│   ├── services/             # Business logic
│   ├── db/
│   │   ├── run-migrations.js # Migration runner
│   │   └── seed-admin.js     # Admin seeder
│   └── migrations/           # SQL migration files (001-017)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── apps/         # App windows (Gallery, VpcAuth, etc.)
│   │   │   ├── banadb/       # BanaDB components
│   │   │   └── desktop/      # Desktop shell (taskbar, launcher)
│   │   ├── stores/           # Zustand stores
│   │   └── lib/              # Utilities, app registry
│   └── dist/                 # Built frontend (production)
├── deploy/
│   ├── setup.sh              # Fresh VPS setup script
│   ├── deploy.sh             # Update deployment script
│   ├── ecosystem.config.js   # PM2 config
│   └── nginx-vpc.conf        # Nginx config
├── uploads/                  # Uploaded files (gallery)
└── downloads/                # Downloadable files
```

---

## Ports

| Service | Port |
|---------|------|
| VPC App (Node.js) | 8001 |
| PostgreSQL | 5432 |
| Nginx HTTP | 80 |
| Nginx HTTPS | 443 |
