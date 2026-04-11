# Brisas do Pinhal Weather Station

Brisas do Pinhal is a hobby weather station that collects data from an Ecowitt device and
publishes live conditions on a small web page.  The project contains a Python
backend that ingests the station's readings and a very simple HTML/JavaScript
frontend that displays the latest values.

## Project Structure

```
.
├── app.js          # Front‑end logic for fetching and rendering data
├── index.html      # Static web page
├── server/
│   └── api_meteo-py  # FastAPI application that receives and serves data
├── sql/
│   ├── init_schema.sql      # SQLite schema
│   └── migrate_old_data.py  # One-time migration from old MySQL dump
├── requirements.txt
└── styles.css      # Basic styling
```

## Architecture

```
Ecowitt device (LAN)  →  FastAPI + SQLite + uvicorn (local, port 8000)
                                    │
                          Cloudflare Tunnel
                                    │
                       api.brisas.pinhaldorei.net  (API pública)

Browser  →  brisas.pinhaldorei.net  (GitHub Pages, frontend estático)
```

## Backend

The backend is a FastAPI application (SQLite database) that exposes:

- `POST /api` – receives measurements from the Ecowitt station, stores in SQLite and updates `live.json`
- `GET /live` – returns the most recent observation stored in `live.json`
- `GET /latest` – fetches the latest observation directly from the database
- `GET /history?hours=N` – returns observations for the last _N_ hours (default 24)
- `GET /metar-tgftp/{icao}` – retrieves and caches METAR data from NOAA
- `GET /climate/monthly` – monthly climate statistics aggregated from all observations
- `GET /health` – simple health check endpoint

Configuration is read from environment variables (see `/etc/meteo/env`).
Logs are written under `/home/carlos/meteo_logs`, current conditions at `/var/lib/meteo/live.json`,
and the database at `/var/lib/meteo/meteo.db`.

### Running the server

1. Install dependencies:

   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

2. Create the symlink (needed because uvicorn can't import files with hyphens):

   ```bash
   ln -s server/api_meteo-py server/api_meteo.py
   ```

3. Start the application:

   ```bash
   .venv/bin/uvicorn server.api_meteo:app --host 127.0.0.1 --port 8000
   ```

In production, the service is managed by systemd (`meteo-api.service`) and exposed
via Cloudflare Tunnel.

## Frontend

The frontend is a single page (`index.html`) enhanced by `app.js`.  It polls the
backend API every 2 minutes to update the displayed conditions.

It is hosted on **GitHub Pages** at `brisas.pinhaldorei.net`.

## Development

Run the following checks before committing changes:

```bash
python -m py_compile server/api_meteo-py
node --check app.js
```

## License

This project is intended for personal use and does not currently specify a
formal license.  Use at your own risk.
