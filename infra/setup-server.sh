#!/usr/bin/env bash
# Script de provisionamento do servidor (Ubuntu/Debian)
# Execute como root ou com sudo APÓS criar a VM no provedor Free Tier.
# Uso: sudo bash infra/setup-server.sh

set -euo pipefail

APP_USER="${APP_USER:-deploy}"
APP_DIR="${APP_DIR:-/var/www/projeto-aplicado}"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "==> Atualizando pacotes"
apt-get update -y
apt-get upgrade -y

echo "==> Instalando pacotes base"
apt-get install -y curl gnupg2 ca-certificates ufw fail2ban nginx

echo "==> Instalando Node.js ${NODE_MAJOR}.x"
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y nodejs
node -v
npm -v

echo "==> Criando usuário de deploy (se não existir)"
if ! id "$APP_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$APP_USER"
fi

echo "==> Preparando diretório da aplicação"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Configurando UFW (least privilege)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose

echo "==> Configurando Fail2Ban (SSH: 4 falhas / ban 24h)"
cat >/etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 86400
findtime = 600
maxretry = 4
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 4
bantime = 86400
EOF

systemctl enable fail2ban
systemctl restart fail2ban
fail2ban-client status sshd || true

echo "==> Endurecendo SSH (desabilita senha — confirme que sua chave já funciona!)"
SSHD_CONFIG="/etc/ssh/sshd_config"
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%s)"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD_CONFIG"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' "$SSHD_CONFIG"
systemctl reload ssh || systemctl reload sshd

echo "==> Instalando Certbot (snap — versão recente com suporte a IP)"
apt-get install -y snapd
snap install core
snap refresh core
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot

echo "==> Unit systemd da aplicação"
cat >/etc/systemd/system/projeto-aplicado.service <<EOF
[Unit]
Description=Projeto Aplicado UNCISAL
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo ""
echo "Provisionamento base concluído."
echo "Próximos passos:"
echo "  1) Copie o código para ${APP_DIR} (ou use o GitHub Actions)"
echo "  2) Crie ${APP_DIR}/.env a partir de .env.example"
echo "  3) npm ci --omit=dev && systemctl enable --now projeto-aplicado"
echo "  4) Aplique infra/nginx.conf e rode: certbot --nginx ..."
echo "  5) Para PQC no Nginx, veja infra/nginx-pqc.conf e docs no README"
