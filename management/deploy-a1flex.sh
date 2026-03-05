#!/bin/bash
# Deploy management stack on A1.Flex (main server, 24GB)
# Run from repo root: bash management/deploy-a1flex.sh
set -euo pipefail

MGMT_DIR="/home/ubuntu/projects/zent-server/management"

echo "=== Deploying management stack on A1.Flex ==="

# 1. Ensure Cockpit is installed
echo "[1/5] Checking Cockpit..."
systemctl is-active cockpit.socket 2>/dev/null || {
  echo "Installing Cockpit..."
  sudo apt-get install -y -qq cockpit
  sudo systemctl enable --now cockpit.socket
}

# 2. Open firewall for Cockpit from VCN only
echo "[2/5] Configuring firewall..."
sudo ufw allow from 10.0.0.0/8 to any port 9090 proto tcp comment 'Cockpit from VCN' 2>/dev/null || true

# 3. Start management containers
echo "[3/5] Starting management stack..."
cd "$MGMT_DIR"
docker compose -f docker-compose.a1flex.yml up -d

# 4. Wait for Grafana to start
echo "[4/5] Waiting for Grafana..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3100/api/health > /dev/null 2>&1; then
    echo "Grafana is ready!"
    break
  fi
  sleep 2
done

# 5. Add nginx proxy for Grafana + OliveTin
echo "[5/5] Checking nginx proxy config..."
if ! grep -q "manage.3aka.com" /etc/nginx/sites-enabled/* 2>/dev/null; then
  echo ""
  echo "NOTE: Add nginx proxy for manage.3aka.com manually:"
  echo "  - Grafana: proxy_pass http://127.0.0.1:3100"
  echo "  - OliveTin: proxy_pass http://127.0.0.1:1337 at /olivetin/"
  echo "  - Or use Cloudflare Tunnel for zero-trust access"
fi

echo ""
echo "=== Deployment complete ==="
echo "Cockpit:    https://193.123.36.192:9090 (VCN only)"
echo "Grafana:    http://127.0.0.1:3100 (default: admin/changeme)"
echo "OliveTin:   http://127.0.0.1:1337"
echo "Prometheus: http://127.0.0.1:9090"
echo ""
echo "Set GRAFANA_ADMIN_PASSWORD in .env before production use!"
