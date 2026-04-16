-- Migração: adicionar tabela de leituras de qualidade do ar
-- Executar: sqlite3 /var/lib/meteo/meteo.db < sql/add_aq_table.sql

CREATE TABLE IF NOT EXISTS aq_readings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_local   TEXT NOT NULL,
  ts_utc     TEXT NOT NULL,
  pm25_ugm3  REAL    DEFAULT NULL,
  voc_index  INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_aq_ts ON aq_readings (ts_local);
