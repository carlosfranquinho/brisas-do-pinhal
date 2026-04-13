# Brisas do Pinhal — Estação Meteorológica

Dashboard web de uma estação meteorológica pessoal baseada num dispositivo Ecowitt.
Apresenta condições em tempo real, histórico detalhado por ano, análises climatológicas
e comparação com normais climatológicas de referência.

## Estrutura do projeto

```
.
├── index.html          # Página única (SPA com hash routing)
├── app.js              # Lógica core: routing, página inicial, lazy loading
├── app-views.js        # Lógica das vistas Histórico e Clima (carregado sob pedido)
├── styles.css          # Estilos
├── favicon.svg         # Ícone do site
├── brisas-logo.svg     # Logo da marca
├── icons/              # Ícones meteorológicos SVG
├── CNAME               # Domínio para GitHub Pages
├── server/
│   ├── api_meteo-py    # Aplicação FastAPI (ficheiro principal)
│   └── api_meteo.py    # Symlink → api_meteo-py (necessário para uvicorn)
├── sql/
│   ├── init_schema.sql      # Schema SQLite
│   └── migrate_old_data.py  # Migração única do dump MySQL antigo
└── requirements.txt
```

## Arquitetura

```
Dispositivo Ecowitt (LAN)
        │ POST /api
        ▼
┌─────────────────────────────┐
│  FastAPI + SQLite + uvicorn │  porta 8000 (local)
└─────────────────────────────┘
        │ Cloudflare Tunnel
        ▼
api.brisas.pinhaldorei.net     ← API pública

Browser
        │ fetch(API)
        ▼
brisas.pinhaldorei.net         ← GitHub Pages (frontend estático)
```

## Frontend

Single-page app com routing por hash (`#/`, `#/historico`, `#/clima`, `#/historico/2024`, etc.).

**Páginas:**
- **Início** — condições em tempo real (temperatura, humidade, vento, pressão, UV, solar, chuva), gráfico das últimas 24h, tendências, previsão IPMA e METAR do aeroporto mais próximo
- **Histórico** — recordes absolutos, cards por ano, detalhe por ano (gráfico mensal + extremos), arquivo diário, análises de temperatura e precipitação com comparação a normais climatológicas
- **Clima** — tabela e gráfico de médias mensais agregadas de toda a série histórica

O frontend atualiza automaticamente a cada 2 minutos. `app-views.js` (28 KB) é carregado de forma lazy apenas quando o utilizador navega para Histórico ou Clima, reduzindo o tempo de bloqueio inicial.

## Backend — API

Endpoints disponíveis:

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST/GET` | `/api` | Recebe medições do dispositivo Ecowitt; guarda em SQLite e em `live.json` |
| `GET` | `/live` | Última observação (lida de `live.json`, sem tocar na BD) |
| `GET` | `/latest` | Última observação direto da base de dados |
| `GET` | `/health` | Health check |
| `GET` | `/history?hours=N` | Observações das últimas N horas (padrão: 24) |
| `GET` | `/history/daily?date=YYYY-MM-DD` | Observações de um dia específico |
| `GET` | `/history/records` | Recordes absolutos de toda a série |
| `GET` | `/history/years` | Resumo anual (totais e extremos por ano) |
| `GET` | `/history/year/{year}` | Detalhe mensal de um ano (com datas dos recordes) |
| `GET` | `/history/analysis/temperature` | Análise mensal de temperatura (todos os anos) |
| `GET` | `/history/analysis/precipitation` | Análise mensal de precipitação (todos os anos) |
| `GET` | `/climate/monthly` | Médias mensais de toda a série histórica |
| `GET` | `/metar-tgftp/{icao}` | Leitura METAR via NOAA (com cache) |

A configuração é lida de variáveis de ambiente (ficheiro `/etc/meteo/env`).

Dados em runtime:
- Base de dados: `/var/lib/meteo/meteo.db`
- Condições actuais: `/var/lib/meteo/live.json`
- Logs: `/home/carlos/meteo_logs/`

## Configuração e instalação

### Dependências Python

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### Symlink (necessário porque uvicorn não importa ficheiros com hífen)

```bash
ln -s server/api_meteo-py server/api_meteo.py
```

### Base de dados

```bash
sudo mkdir -p /var/lib/meteo
sqlite3 /var/lib/meteo/meteo.db < sql/init_schema.sql
```

### Arrancar manualmente

```bash
.venv/bin/uvicorn server.api_meteo:app --host 127.0.0.1 --port 8000
```

Em produção o serviço é gerido pelo systemd (`meteo-api.service`) e exposto via Cloudflare Tunnel em `api.brisas.pinhaldorei.net`.

## Base de dados — notas sobre qualidade e cobertura

### Fontes de dados

A BD SQLite (`observations`) agrega dados de várias fontes, identificadas pelo campo `station_id`:

| station_id | Fonte | Período | Intervalo |
|---|---|---|---|
| `meteomg` | Servidor local (Ecowitt → FastAPI) | abr 2021 – presente | 5 min |
| `IMARIN39` | Mesma estação física via Weather Underground | abr 2021 – ago 2025 | ~5 min (+16s) |
| `IPATAI5` | Estação WU vizinha (9.3 km) | mar 2023 – mar 2026 | ~5 min |
| `IBARRE4` | Estação WU vizinha (12.1 km) | jan – mar 2021 | ~5 min |
| `IBARRE8` | Estação WU vizinha (15.0 km) | mar 2021 – mar 2026 | ~5 min |

Os registos de estações externas só existem em períodos onde não há dados `meteomg` — nunca sobrepõem dados locais (eliminados registos redundantes por bucket de 5 minutos).

### Timestamps

- `ts_utc` — sempre em UTC com sufixo `Z`
- `ts_local` — hora local Portugal com offset explícito (`+00:00` inverno / `+01:00` verão)
- Para agrupar por data local usar `substr(ts_local, 1, 10)` — **não** `DATE(ts_local)`, porque o SQLite interpreta o offset `+01:00` e converte para UTC antes de extrair a data

### Cobertura histórica

O sistema antigo (MySQL) armazenava o ts_utc em hora local (bug corrigido em 2026 — 188 768 registos de verão actualizados). A série cobre abr 2021 – presente com ~29 dias parciais (< 1/3 dos registos esperados) em ~1650 dias totais.

Os dados de mai–ago 2025 têm menor densidade porque a estação esteve offline por obras no edifício.

## Desenvolvimento

Verificações antes de fazer commit:

```bash
python -m py_compile server/api_meteo-py
node --check app.js
node --check app-views.js
```
