#!/usr/bin/env bash
# setup-tunnel.sh — configurar Cloudflare Tunnel para Brisas do Pinhal
#
# PRÉ-REQUISITO: pinhaldorei.net deve estar gerido pelo Cloudflare
#   (nameservers apontados para Cloudflare em dash.cloudflare.com)
#
# Executar com: bash deploy/setup-tunnel.sh

set -e

TUNNEL_NAME="brisas-api"
HOSTNAME="api.brisas.pinhaldorei.net"
LOCAL_SERVICE="http://localhost:8000"
CF_DIR="$HOME/.cloudflared"

echo "=== 1/5  Instalar cloudflared ==="
if command -v cloudflared &>/dev/null; then
    echo "    já instalado: $(cloudflared --version)"
else
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
        | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
https://pkg.cloudflare.com/cloudflared any main" \
        | sudo tee /etc/apt/sources.list.d/cloudflared.list
    sudo apt-get update -q
    sudo apt-get install -y cloudflared
    echo "    cloudflared instalado: $(cloudflared --version)"
fi

echo ""
echo "=== 2/5  Autenticar com Cloudflare ==="
echo "    Vai abrir o browser — seleciona o domínio 'pinhaldorei.net' e clica Authorize."
echo "    Pressiona Enter quando estiveres pronto..."
read -r
cloudflared tunnel login

echo ""
echo "=== 3/5  Criar tunnel '$TUNNEL_NAME' ==="
# Verifica se já existe
if cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
    echo "    Tunnel '$TUNNEL_NAME' já existe, a reutilizar."
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
else
    cloudflared tunnel create "$TUNNEL_NAME"
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
fi
echo "    Tunnel ID: $TUNNEL_ID"

echo ""
echo "=== 4/5  Criar config.yml ==="
cat > "$CF_DIR/config.yml" << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CF_DIR}/${TUNNEL_ID}.json

ingress:
  - hostname: ${HOSTNAME}
    service: ${LOCAL_SERVICE}
  - service: http_status:404
EOF
echo "    $CF_DIR/config.yml criado"

echo ""
echo "=== 5/5  Registar DNS e instalar serviço ==="
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"
echo "    CNAME criado: $HOSTNAME → $TUNNEL_ID.cfargotunnel.com"

sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

echo ""
echo "✓ Tunnel ativo!"
echo ""
echo "  A testar (pode demorar ~30s para propagar)..."
sleep 5
curl -sf "https://${HOSTNAME}/health" && echo "  ✓ https://${HOSTNAME}/health → OK" \
    || echo "  ⚠ Ainda a propagar — tenta em 30s: curl https://${HOSTNAME}/health"
echo ""
echo "  Logs: sudo journalctl -u cloudflared -f"
