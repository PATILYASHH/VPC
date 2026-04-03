#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  VPC - Virtual PC Control                                    ║
# ║  One-line installer for Ubuntu/Debian VPS                    ║
# ║                                                              ║
# ║  Usage: curl -fsSL https://raw.githubusercontent.com/        ║
# ║         PATILYASHH/VPC/main/install.sh | sudo bash           ║
# ╚══════════════════════════════════════════════════════════════╝

set -e

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Banner ───────────────────────────────────────────────────
clear
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ██╗   ██╗██████╗  ██████╗"
echo "  ██║   ██║██╔══██╗██╔════╝"
echo "  ██║   ██║██████╔╝██║     "
echo "  ╚██╗ ██╔╝██╔═══╝ ██║     "
echo "   ╚████╔╝ ██║     ╚██████╗"
echo "    ╚═══╝  ╚═╝      ╚═════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Virtual PC Control${NC} — Your server's OS in the browser"
echo ""
echo -e "  ${BLUE}https://github.com/PATILYASHH/VPC${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Check root ───────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run as root (sudo)${NC}"
  exit 1
fi

# ─── Check OS ─────────────────────────────────────────────────
if ! command -v apt &> /dev/null; then
  echo -e "${RED}Error: This installer requires Ubuntu/Debian (apt)${NC}"
  exit 1
fi

# ─── Ask configuration ───────────────────────────────────────
echo -e "${BOLD}Setup Configuration${NC}"
echo ""

# Port
read -p "  Web port [8001]: " VPC_PORT
VPC_PORT=${VPC_PORT:-8001}

# Admin credentials
echo ""
echo -e "  ${YELLOW}Admin Account${NC}"
read -p "  Username [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}

read -p "  Email [admin@vpc.local]: " ADMIN_EMAIL
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@vpc.local}

while true; do
  read -sp "  Password (min 6 chars): " ADMIN_PASS
  echo ""
  if [ ${#ADMIN_PASS} -ge 6 ]; then
    break
  fi
  echo -e "  ${RED}Password too short, try again${NC}"
done

# Domain (optional)
echo ""
read -p "  Domain name (optional, press Enter to skip): " DOMAIN

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Generate secrets ─────────────────────────────────────────
DB_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)

# ─── Step 1: System packages ─────────────────────────────────
echo -e "${CYAN}[1/8]${NC} Installing system dependencies..."
apt update -qq > /dev/null 2>&1
apt install -y -qq curl git build-essential > /dev/null 2>&1
echo -e "  ${GREEN}✓${NC} System packages"

# ─── Step 2: Node.js ─────────────────────────────────────────
echo -e "${CYAN}[2/8]${NC} Installing Node.js 20..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y -qq nodejs > /dev/null 2>&1
fi
npm install -g pm2 > /dev/null 2>&1
echo -e "  ${GREEN}✓${NC} Node.js $(node -v) + PM2"

# ─── Step 3: PostgreSQL ──────────────────────────────────────
echo -e "${CYAN}[3/8]${NC} Setting up PostgreSQL..."
if ! command -v psql &> /dev/null; then
  apt install -y -qq postgresql postgresql-contrib > /dev/null 2>&1
fi
systemctl enable postgresql > /dev/null 2>&1
systemctl start postgresql

# Create DB user and database
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='vpc_admin'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER vpc_admin WITH PASSWORD '${DB_PASS}';" > /dev/null 2>&1

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='vpc'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE vpc OWNER vpc_admin;" > /dev/null 2>&1

sudo -u postgres psql -d vpc -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" > /dev/null 2>&1
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE vpc TO vpc_admin;" > /dev/null 2>&1
echo -e "  ${GREEN}✓${NC} PostgreSQL ready"

# ─── Step 4: Nginx ────────────────────────────────────────────
echo -e "${CYAN}[4/8]${NC} Installing Nginx..."
if ! command -v nginx &> /dev/null; then
  apt install -y -qq nginx > /dev/null 2>&1
fi
systemctl enable nginx > /dev/null 2>&1
systemctl start nginx
echo -e "  ${GREEN}✓${NC} Nginx ready"

# ─── Step 5: Clone VPC ───────────────────────────────────────
echo -e "${CYAN}[5/8]${NC} Downloading VPC..."
VPC_DIR="/var/www/vpc"
mkdir -p "$VPC_DIR"
mkdir -p /var/backups/vpc

if [ -d "$VPC_DIR/.git" ]; then
  cd "$VPC_DIR" && git pull origin main > /dev/null 2>&1
else
  git clone https://github.com/PATILYASHH/VPC.git "$VPC_DIR" > /dev/null 2>&1
fi
echo -e "  ${GREEN}✓${NC} VPC downloaded to ${VPC_DIR}"

# ─── Step 6: Install & Build ─────────────────────────────────
echo -e "${CYAN}[6/8]${NC} Installing dependencies & building..."
cd "$VPC_DIR"
npm install --silent > /dev/null 2>&1
cd backend && npm install --silent > /dev/null 2>&1 && cd ..
cd frontend && npm install --silent > /dev/null 2>&1 && cd ..

# Create .env
cat > backend/.env << ENVEOF
NODE_ENV=production
PORT=${VPC_PORT}

DB_HOST=localhost
DB_PORT=5432
DB_NAME=vpc
DB_USER=vpc_admin
DB_PASSWORD=${DB_PASS}

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h

VPC_ADMIN_USERNAME=${ADMIN_USER}
VPC_ADMIN_EMAIL=${ADMIN_EMAIL}
VPC_ADMIN_PASSWORD=${ADMIN_PASS}

ENABLE_IP_RESTRICTION=false
FRONTEND_URL=http://localhost:${VPC_PORT}

BACKUP_DIR=/var/backups/vpc

ANTHROPIC_API_KEY=
ENVEOF

# Run migrations & seed
cd backend && node db/run-migrations.js > /dev/null 2>&1 && cd ..
cd backend && node db/seed-admin.js > /dev/null 2>&1 && cd ..

# Build frontend
cd frontend && npx vite build > /dev/null 2>&1 && cd ..
echo -e "  ${GREEN}✓${NC} Built successfully"

# ─── Step 7: Nginx config ────────────────────────────────────
echo -e "${CYAN}[7/8]${NC} Configuring Nginx..."

if [ -n "$DOMAIN" ]; then
  SERVER_NAME="$DOMAIN"
else
  SERVER_NAME="_"
fi

cat > /etc/nginx/sites-available/vpc << NGINXEOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:${VPC_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/vpc /etc/nginx/sites-enabled/vpc
rm -f /etc/nginx/sites-enabled/default
nginx -t > /dev/null 2>&1 && systemctl reload nginx
echo -e "  ${GREEN}✓${NC} Nginx configured"

# ─── Step 8: Start with PM2 ──────────────────────────────────
echo -e "${CYAN}[8/8]${NC} Starting VPC..."
cd "$VPC_DIR"
pm2 delete vpc > /dev/null 2>&1 || true
pm2 start deploy/ecosystem.config.js > /dev/null 2>&1
pm2 save > /dev/null 2>&1
pm2 startup -u root --hp /root > /dev/null 2>&1 || true
echo -e "  ${GREEN}✓${NC} VPC is running"

# ─── SSL (if domain provided) ────────────────────────────────
if [ -n "$DOMAIN" ]; then
  echo ""
  echo -e "${CYAN}[SSL]${NC} Setting up HTTPS for ${DOMAIN}..."
  apt install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email > /dev/null 2>&1 && \
    echo -e "  ${GREEN}✓${NC} SSL certificate installed" || \
    echo -e "  ${YELLOW}⚠${NC} SSL failed — run manually: certbot --nginx -d ${DOMAIN}"
fi

# ─── Done ─────────────────────────────────────────────────────
IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}${BOLD}  VPC installed successfully!${NC}"
echo ""
echo -e "  ${BOLD}Access your VPC:${NC}"
if [ -n "$DOMAIN" ]; then
  echo -e "    ${CYAN}https://${DOMAIN}${NC}"
fi
echo -e "    ${CYAN}http://${IP}${NC}"
echo ""
echo -e "  ${BOLD}Login credentials:${NC}"
echo -e "    Username:  ${YELLOW}${ADMIN_USER}${NC}"
echo -e "    Password:  ${YELLOW}${ADMIN_PASS}${NC}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    pm2 logs vpc          — View logs"
echo -e "    pm2 restart vpc       — Restart VPC"
echo -e "    pm2 status            — Check status"
echo -e "    cd ${VPC_DIR} && ./deploy/deploy.sh  — Update"
echo ""
echo -e "  ${BOLD}Files:${NC}"
echo -e "    Config:  ${VPC_DIR}/backend/.env"
echo -e "    Nginx:   /etc/nginx/sites-available/vpc"
echo -e "    Backups: /var/backups/vpc"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
