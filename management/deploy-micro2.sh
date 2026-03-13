#!/bin/bash
# Deploy management stack to Micro 2 (Registrar, AMD 1GB)
# Run from A1.Flex: bash management/deploy-micro2.sh
set -euo pipefail

MICRO2="micro2"
REMOTE_DIR="/home/ubuntu/management"

echo "=== Deploying management stack to Micro 2 ==="

# 1. Ensure Docker is installed and running
echo "[1/6] Checking Docker..."
ssh $MICRO2 "docker --version" || {
  echo "Installing Docker..."
  ssh $MICRO2 "sudo apt-get update -qq && sudo apt-get install -y -qq docker.io docker-compose-v2 && sudo usermod -aG docker ubuntu && sudo systemctl enable --now docker"
  echo "Docker installed. You may need to reconnect for group changes."
}

# 2. Ensure Cockpit is installed
echo "[2/6] Checking Cockpit..."
ssh $MICRO2 "systemctl is-active cockpit.socket 2>/dev/null" || {
  echo "Installing Cockpit..."
  ssh $MICRO2 "sudo apt-get install -y -qq cockpit && sudo systemctl enable --now cockpit.socket"
}

# 3. Create remote directory
echo "[3/6] Setting up remote directory..."
ssh $MICRO2 "mkdir -p $REMOTE_DIR/olivetin"

# 4. Copy config files
echo "[4/6] Copying configs..."
scp -P 2222 management/docker-compose.micro2.yml $MICRO2:$REMOTE_DIR/docker-compose.yml

# OliveTin config for Micro 2 (local-only actions)
ssh $MICRO2 "cat > $REMOTE_DIR/olivetin/config.yaml" << 'OLIVETIN_EOF'
listenAddressSingleHTTPFrontend: 0.0.0.0:1337
logLevel: INFO
showFooter: false
pageTitle: Micro 2 Management

actions:
  - title: Nginx Status
    icon: monitor
    shell: systemctl status nginx --no-pager -l | head -15
    timeout: 10
    popupOnStart: execution-dialog

  - title: Reload Nginx
    icon: refresh
    shell: sudo nginx -t && sudo systemctl reload nginx && echo "OK"
    timeout: 10
    popupOnStart: execution-dialog

  - title: System Status
    icon: heart
    shell: |
      echo "=== Memory ===" && free -h
      echo "=== Disk ===" && df -h /
      echo "=== Uptime ===" && uptime
      echo "=== Services ===" && systemctl is-active nginx cockpit.socket docker fail2ban
    timeout: 10
    popupOnStart: execution-dialog

  - title: fail2ban Status
    icon: shield
    shell: sudo fail2ban-client status
    timeout: 10
    popupOnStart: execution-dialog

  - title: View Nginx Access Log (last 30)
    icon: file-text
    shell: sudo tail -30 /var/log/nginx/access.log
    timeout: 10
    popupOnStart: execution-dialog

  - title: View Auth Log (last 30)
    icon: file-text
    shell: sudo tail -30 /var/log/auth.log
    timeout: 10
    popupOnStart: execution-dialog

  - title: CrowdSec Decisions
    icon: shield
    shell: docker exec crowdsec cscli decisions list 2>/dev/null || echo "No decisions"
    timeout: 10
    popupOnStart: execution-dialog

  - title: Update System Packages
    icon: download
    shell: sudo apt-get update -qq && sudo apt-get upgrade -y 2>&1 | tail -10
    timeout: 300
    popupOnStart: execution-dialog
OLIVETIN_EOF

# 5. Open firewall for Cockpit (9090) from VCN only
echo "[5/6] Configuring firewall..."
ssh $MICRO2 "sudo ufw allow from 10.0.0.0/8 to any port 9090 proto tcp comment 'Cockpit from VCN' 2>/dev/null || true"

# 6. Start containers
echo "[6/6] Starting management containers..."
ssh $MICRO2 "cd $REMOTE_DIR && sg docker -c 'docker compose up -d'" 2>&1

echo ""
echo "=== Deployment complete ==="
echo "Cockpit:  https://<micro2-ip>:9090 (VCN only)"
echo "OliveTin: http://127.0.0.1:1337 (localhost only, proxy via nginx)"
echo ""
echo "Next: Add nginx proxy for OliveTin if external access needed."
