-- Schema SQLite para Brisas do Pinhal
-- Executar: sqlite3 /var/lib/meteo/meteo.db < sql/init_schema.sql

CREATE TABLE IF NOT EXISTS observations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id     TEXT    NOT NULL,
  ts_local       TEXT    NOT NULL,   -- ISO-8601 com timezone local
  ts_utc         TEXT    NOT NULL,   -- ISO-8601 UTC (termina em Z)
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

PRAGMA journal_mode=WAL;
