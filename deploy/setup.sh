#!/usr/bin/env bash
# setup.sh — instalar Brisas do Pinhal no Pop!_OS
# Executar com: bash deploy/setup.sh
set -e

PROJ=/dados/projetos/brisamar

echo "=== 0/6  Pré-requisitos do sistema ==="
sudo apt-get install -y python3-venv python3-pip sqlite3
echo "    python3-venv, sqlite3 instalados"

echo "=== 1/6  Diretórios de runtime ==="
sudo mkdir -p /var/lib/meteo /home/carlos/meteo_logs /etc/meteo
sudo chown carlos:carlos /var/lib/meteo /home/carlos/meteo_logs
sudo chmod 755 /var/lib/meteo /home/carlos/meteo_logs

echo "=== 2/6  Ficheiro de variáveis de ambiente ==="
sudo cp "$PROJ/deploy/etc-meteo-env" /etc/meteo/env
sudo chmod 600 /etc/meteo/env
sudo chown root:root /etc/meteo/env

echo "=== 3/6  Python virtual environment ==="
python3 -m venv "$PROJ/.venv"
"$PROJ/.venv/bin/pip" install --upgrade pip -q
"$PROJ/.venv/bin/pip" install -r "$PROJ/requirements.txt" -q
echo "    pacotes instalados"

echo "=== 4/6  Symlink para uvicorn ==="
ln -sf "$PROJ/server/api_meteo-py" "$PROJ/server/api_meteo.py"
echo "    server/api_meteo.py -> api_meteo-py"

echo "=== 5/6  Schema SQLite ==="
sqlite3 /var/lib/meteo/meteo.db < "$PROJ/sql/init_schema.sql"
echo "    /var/lib/meteo/meteo.db criado"

echo "=== 6/6  Serviço systemd ==="
sudo cp "$PROJ/deploy/meteo-api.service" /etc/systemd/system/meteo-api.service
sudo systemctl daemon-reload
sudo systemctl enable meteo-api
sudo systemctl start meteo-api
sudo systemctl status meteo-api --no-pager

echo ""
echo "✓ Setup concluído!"
echo "  Testar: curl http://127.0.0.1:8000/health"
echo "  Logs:   sudo journalctl -u meteo-api -f"
