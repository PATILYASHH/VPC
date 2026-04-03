<p align="center">
  <a href="https://github.com/PATILYASHH/VPC">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./imgs/logo-light.svg" />
      <img alt="VPC" src="./imgs/logo-dark.svg" height="60" />
    </picture>
  </a>
</p>

<h4 align="center">
  <a href="#quick-start">Quick Start</a> |
  <a href="#downloads">Downloads</a> |
  <a href="#features">Features</a> |
  <a href="#self-hosting">Self-Hosting</a> |
  <a href="#contributing">Contributing</a>
</h4>

<div align="center">
  <h2>
    An open-source, OS-style dashboard for managing your entire server infrastructure.
  </h2>
</div>

<br />
<p align="center">
  <a href="https://github.com/PATILYASHH/VPC/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  </a>
  <a href="https://github.com/PATILYASHH/VPC/releases">
    <img alt="Release" src="https://img.shields.io/github/v/release/PATILYASHH/VPC?label=version" />
  </a>
  <a href="https://github.com/PATILYASHH/VPC/stargazers">
    <img alt="Stars" src="https://img.shields.io/github/stars/PATILYASHH/VPC?style=social" />
  </a>
</p>

<p align="center">
  <img src="./imgs/VPC-image.png" alt="VPC Desktop" width="100%" />
</p>

---

## What is VPC?

VPC (Virtual PC Control) is a **web-based desktop environment** for managing your VPS. Instead of juggling terminals, dashboards, and tools — you get a single OS-like interface with windowed apps, a taskbar, and a launcher. Everything your server needs, in one place.

Think of it as **your server's operating system in the browser**.

<br />


---

## Downloads

### VPC Sync - VS Code Extension

Sync your local code with VPSHub repositories directly from VS Code. Push, pull, commit, branch — Git-like VCS built into your editor.

| Platform | Download |
|----------|----------|
| VS Code | [vpc-sync-8.0.0.vsix](https://github.com/PATILYASHH/VPC/raw/main/downloads/vpc-sync.vsix) |

Install manually:
```bash
code --install-extension vpc-sync-8.0.0.vsix
```

### VPC CLI

Pull database migrations from VPSHub into your local projects.

| Platform | Download |
|----------|----------|
| Node.js (18+) | [vpc-sync-cli.tar.gz](https://github.com/PATILYASHH/VPC/raw/main/downloads/vpc-sync-cli.tar.gz) |

Install:
```bash
npm install -g ./vpc-sync-cli.tar.gz
```

---

## Features

### Desktop Environment

A real desktop experience in your browser. Drag, resize, minimize, and multitask across windowed apps — just like a native OS.

- Windowed multitasking with drag-and-drop
- Taskbar with running app indicators
- App launcher grid
- Fullscreen mode
- Theme customization

<br />

### VPSHub - Code Collaboration

A self-hosted code platform with repositories, pull requests, issues, and deployment pipelines.

- Create and manage Git-like repositories
- Pull requests with merge, review, and comment
- Issue tracking with labels
- Branch management and commit history
- File tree browsing with syntax highlighting
- AI-powered code review (via Claude)
- Smart merge conflict resolution

<br />

### DB - Database Management

Full PostgreSQL management with project isolation, API generation, and schema versioning.

- Create isolated database projects
- Auto-generated REST APIs per project
- SQL editor with query execution
- Schema migrations with PR workflow
- Storage buckets (S3-style file storage)
- Auth system per project (users, JWT)
- API key management (anon, service, pull)
- Supabase import support

<br />

### Web Hosting

Deploy and host websites directly from your VPC.

- One-click site deployment
- Custom domain support with SSL
- Slug-based public URLs
- Linked to VPSHub repos for auto-deploy

<br />

### Server Management

Monitor and control your server infrastructure.

- **Server Manager** - Real-time process and resource monitoring
- **Database Manager** - PostgreSQL browser and query tool
- **Terminal** - Execute commands directly from the browser
- **Logs Viewer** - Application log monitoring and search
- **Backup Manager** - Scheduled database backups with restore
- **Gallery** - File browser with upload, preview, and bucket management

<br />

### Security

- JWT authentication with TOTP (2FA) support
- Role-based access control (RBAC)
- Per-user app permissions
- API key management with scoped access
- IP restriction middleware
- Full action audit logging

<br />

### VS Code Integration

The **VPC Sync** extension brings VPSHub into your editor:

- Push and pull code from VPSHub repos
- Stage, commit, and branch — all from VS Code's Source Control panel
- Auto-sync on configurable intervals
- PAT token authentication

<br />

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TailwindCSS, Radix UI, Zustand, React Query |
| **Backend** | Node.js, Express, PostgreSQL |
| **Auth** | JWT, TOTP, bcrypt |
| **AI** | Anthropic Claude (code review, PR analysis) |
| **Process Manager** | PM2 |
| **Reverse Proxy** | Nginx |
| **Extension** | VS Code SCM Provider API |
| **CLI** | Node.js |

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/PATILYASHH/VPC.git
cd VPC

# Install dependencies
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your database credentials

# Run migrations and seed admin
cd backend && node db/run-migrations.js && node db/seed-admin.js && cd ..

# Build frontend
cd frontend && npx vite build && cd ..

# Start
node app.js
```

Open `http://localhost:8001` and log in with your admin credentials.

---

## Self-Hosting

Full deployment guide for Ubuntu 22.04 VPS.

### Prerequisites

- Ubuntu 22.04+ (or any Linux with systemd)
- Node.js 20+
- PostgreSQL 14+
- Nginx
- A domain name (optional, for SSL)

### 1. Install Dependencies

```bash
apt update && apt upgrade -y

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PostgreSQL + Nginx + Certbot
apt install -y postgresql postgresql-contrib nginx certbot python3-certbot-nginx

# PM2
npm install -g pm2

# Enable services
systemctl enable postgresql nginx
systemctl start postgresql nginx
```

### 2. Setup Database

```bash
sudo -u postgres psql << 'SQL'
CREATE USER vpc_admin WITH PASSWORD 'YOUR_STRONG_PASSWORD';
CREATE DATABASE vpc OWNER vpc_admin;
GRANT ALL PRIVILEGES ON DATABASE vpc TO vpc_admin;
\c vpc
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

### 3. Install VPC

```bash
mkdir -p /var/www/vpc
git clone https://github.com/PATILYASHH/VPC.git /var/www/vpc
cd /var/www/vpc

npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 4. Configure

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

```env
NODE_ENV=production
PORT=8001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vpc
DB_USER=vpc_admin
DB_PASSWORD=YOUR_STRONG_PASSWORD
JWT_SECRET=your_random_64_char_string
JWT_EXPIRES_IN=24h
VPC_ADMIN_USERNAME=admin
VPC_ADMIN_EMAIL=admin@yourdomain.com
VPC_ADMIN_PASSWORD=your_admin_password
BACKUP_DIR=/var/backups/vpc
FRONTEND_URL=https://vpc.yourdomain.com
```

### 5. Build and Run

```bash
# Create directories
mkdir -p /var/backups/vpc uploads/gallery

# Run migrations + seed admin
cd backend && node db/run-migrations.js && node db/seed-admin.js && cd ..

# Build frontend
cd frontend && npx vite build && cd ..

# Start with PM2
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup
```

### 6. Nginx + SSL

```bash
cp deploy/nginx-vpc.conf /etc/nginx/sites-available/vpc
# Edit: replace vpc.yourdomain.com with your domain
nano /etc/nginx/sites-available/vpc

ln -s /etc/nginx/sites-available/vpc /etc/nginx/sites-enabled/vpc
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# SSL
certbot --nginx -d vpc.yourdomain.com
```

Your VPC is live at `https://vpc.yourdomain.com`

---

## Updating

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
./deploy/deploy.sh
```

---

## Project Structure

```
VPC/
├── app.js                       # Entry point
├── backend/
│   ├── server.js                # Express app
│   ├── routes/                  # API routes
│   ├── services/                # Business logic
│   ├── middleware/               # Auth, rate limiting, permissions
│   ├── migrations/              # SQL migrations (001-035)
│   └── db/                      # Migration runner, admin seeder
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── desktop/         # Desktop shell, taskbar, launcher
│       │   ├── apps/            # App windows
│       │   ├── db/              # Database management UI
│       │   └── vpshub/          # Code collaboration UI
│       ├── stores/              # Zustand state management
│       └── lib/                 # Utilities, app registry
├── vscode-extension/            # VPC Sync VS Code extension
├── cli/                         # vpc-pull CLI tool
├── deploy/                      # PM2, Nginx, setup scripts
├── downloads/                   # Extension + CLI packages
└── uploads/                     # User files
```

---

## PM2 Commands

| Action | Command |
|--------|---------|
| Start | `pm2 start deploy/ecosystem.config.js` |
| Stop | `pm2 stop vpc` |
| Restart | `pm2 restart vpc` |
| Logs | `pm2 logs vpc` |
| Status | `pm2 status` |

---

## Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Built with care by <a href="https://github.com/PATILYASHH">PATILYASHH</a>
</p>
