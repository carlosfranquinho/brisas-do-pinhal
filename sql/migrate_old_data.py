#!/usr/bin/env python3
"""
migrate_old_data.py — migra dados de old_db/franquin_meteomg.sql para SQLite.

Mapeamento de colunas:
  alldata.DateTime  -> ts_local (hora local Europe/Lisbon), ts_utc (convertido)
  T                 -> temp_c
  Tmax / Tmin       -> temp_max_c / temp_min_c
  H                 -> rh_pct
  D                 -> dewpoint_c
  W / G             -> wind_kmh / gust_kmh
  B                 -> wind_dir_deg   (bearing = direção do vento)
  RR / R            -> rain_rate_mmph / rain_day_mm
  P                 -> pressure_hpa
  S                 -> solar_wm2
  A                 -> apparent_c
  alldataExtra.UV   -> uv_index       (JOIN por DateTime)

Executar (do raiz do projeto):
  python3 sql/migrate_old_data.py

Requer Python >= 3.9 (zoneinfo é stdlib).
"""

import re
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DUMP_PATH = Path("old_db/franquin_meteomg.sql")
DB_PATH   = Path("/var/lib/meteo/meteo.db")
STATION   = "meteomg"
TZ_LOCAL  = ZoneInfo("Europe/Lisbon")

# ---------------------------------------------------------------------------
# 1. Parser de VALUES do dump MySQL
# ---------------------------------------------------------------------------

def _null_or_float(v: str):
    v = v.strip().strip("'")
    if v.upper() == "NULL":
        return None
    try:
        return float(v)
    except ValueError:
        return None

def _null_or_str(v: str):
    v = v.strip().strip("'")
    return None if v.upper() == "NULL" else v


def parse_insert_block(sql_text: str, table: str):
    """
    Extrai todas as linhas de dados de blocos INSERT INTO `table` (...) VALUES ...
    Retorna lista de listas de strings (valores brutos).
    """
    pattern = re.compile(
        rf"INSERT INTO `{re.escape(table)}`[^V]*VALUES\s+([\s\S]+?);\s*(?:INSERT|--|$)",
        re.IGNORECASE
    )
    row_pattern = re.compile(r"\(([^)]+)\)")

    records = []
    for match in pattern.finditer(sql_text):
        values_block = match.group(1)
        for row_match in row_pattern.finditer(values_block):
            raw = row_match.group(1)
            # split por vírgula fora de aspas simples
            parts = re.split(r",(?=(?:[^']*'[^']*')*[^']*$)", raw)
            records.append([p.strip() for p in parts])
    return records


# ---------------------------------------------------------------------------
# 2. Leitura do dump e construção dos dicts
# ---------------------------------------------------------------------------

print(f"A ler {DUMP_PATH} ({DUMP_PATH.stat().st_size // 1024 // 1024} MB)…")
sql_text = DUMP_PATH.read_text(encoding="utf-8", errors="replace")

print("A extrair alldata…")
alldata_rows = parse_insert_block(sql_text, "alldata")
print(f"  {len(alldata_rows):,} registos encontrados")

print("A extrair alldataExtra (UV)…")
extra_rows = parse_insert_block(sql_text, "alldataExtra")
print(f"  {len(extra_rows):,} registos encontrados")

# Construir dicionário DateTime → UV
uv_by_dt = {}
for row in extra_rows:
    if len(row) >= 2:
        dt_str = row[0].strip().strip("'")
        uv_by_dt[dt_str] = _null_or_float(row[1])

# ---------------------------------------------------------------------------
# 3. Converter e inserir no SQLite
# ---------------------------------------------------------------------------

conn = sqlite3.connect(str(DB_PATH))
conn.execute("PRAGMA journal_mode=WAL")
cur = conn.cursor()

# Garantir schema
cur.executescript("""
CREATE TABLE IF NOT EXISTS observations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id     TEXT    NOT NULL,
  ts_local       TEXT    NOT NULL,
  ts_utc         TEXT    NOT NULL,
  temp_c         REAL    DEFAULT NULL,
  temp_max_c     REAL    DEFAULT NULL,
  temp_min_c     REAL    DEFAULT NULL,
  rh_pct         REAL    DEFAULT NULL,
  dewpoint_c     REAL    DEFAULT NULL,
  wind_kmh       REAL    DEFAULT NULL,
  gust_kmh       REAL    DEFAULT NULL,
  wind_dir_deg   REAL    DEFAULT NULL,
  pressure_hpa   REAL    DEFAULT NULL,
  rain_rate_mmph REAL    DEFAULT NULL,
  rain_day_mm    REAL    DEFAULT NULL,
  solar_wm2      REAL    DEFAULT NULL,
  uv_index       REAL    DEFAULT NULL,
  apparent_c     REAL    DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_station_ts ON observations (station_id, ts_local);
CREATE INDEX IF NOT EXISTS idx_ts_utc     ON observations (ts_utc);
""")

INSERT_SQL = """
INSERT OR IGNORE INTO observations
  (station_id, ts_local, ts_utc,
   temp_c, temp_max_c, temp_min_c,
   rh_pct, dewpoint_c,
   wind_kmh, gust_kmh, wind_dir_deg,
   pressure_hpa, rain_rate_mmph, rain_day_mm,
   solar_wm2, uv_index, apparent_c)
VALUES
  (?, ?, ?,
   ?, ?, ?,
   ?, ?,
   ?, ?, ?,
   ?, ?, ?,
   ?, ?, ?)
"""

skipped = 0
inserted = 0
BATCH = 1000
batch = []

for row in alldata_rows:
    if len(row) < 14:
        skipped += 1
        continue

    # Colunas: DateTime, T, Tmax, Tmin, H, D, W, G, B, RR, R, P, S, A
    dt_str   = row[0].strip().strip("'")
    temp_c         = _null_or_float(row[1])
    temp_max_c     = _null_or_float(row[2])
    temp_min_c     = _null_or_float(row[3])
    rh_pct         = _null_or_float(row[4])
    dewpoint_c     = _null_or_float(row[5])
    wind_kmh       = _null_or_float(row[6])
    gust_kmh       = _null_or_float(row[7])
    wind_dir_deg   = _null_or_float(row[8])   # B = Bearing
    rain_rate_mmph = _null_or_float(row[9])   # RR
    rain_day_mm    = _null_or_float(row[10])  # R
    pressure_hpa   = _null_or_float(row[11])  # P
    solar_wm2      = _null_or_float(row[12])  # S
    apparent_c     = _null_or_float(row[13])  # A

    uv_index = uv_by_dt.get(dt_str)

    # Converter DateTime local → UTC
    try:
        dt_local = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        dt_local = dt_local.replace(tzinfo=TZ_LOCAL)
        dt_utc   = dt_local.astimezone(tz=None).replace(tzinfo=None)
        ts_local = dt_local.isoformat()
        ts_utc   = dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        skipped += 1
        continue

    batch.append((
        STATION, ts_local, ts_utc,
        temp_c, temp_max_c, temp_min_c,
        rh_pct, dewpoint_c,
        wind_kmh, gust_kmh, wind_dir_deg,
        pressure_hpa, rain_rate_mmph, rain_day_mm,
        solar_wm2, uv_index, apparent_c
    ))

    if len(batch) >= BATCH:
        cur.executemany(INSERT_SQL, batch)
        conn.commit()
        inserted += len(batch)
        batch = []
        print(f"  {inserted:,} inseridos…", end="\r")

if batch:
    cur.executemany(INSERT_SQL, batch)
    conn.commit()
    inserted += len(batch)

conn.close()

print(f"\n✓ Migração concluída: {inserted:,} registos inseridos, {skipped} ignorados.")
print(f"  Base de dados: {DB_PATH}")
