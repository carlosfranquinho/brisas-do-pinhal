"""
Preenche dias com menos de THRESHOLD registos locais (station_id='meteomg')
com dados da própria estação no Wunderground (IMARIN39).

Como IMARIN39 é a mesma estação física, os dados são equivalentes a 'meteomg'
mas ficam marcados como 'IMARIN39' para rastreabilidade.

Só insere timestamps que não existam já na BD (qualquer station_id).

Uso:
    python3 sql/fill_partial_days_imarin39.py [--dry-run]
"""

import sqlite3
import datetime
import time
import json
import math
import sys
import urllib.request
import urllib.error
from zoneinfo import ZoneInfo

API_KEY   = "d799d63dde864ec899d63dde864ec8db"
DB_PATH   = "/var/lib/meteo/meteo.db"
STATION   = "IMARIN39"
THRESHOLD = 288       # dias com menos que este nº de registos meteomg
SLEEP_OK  = 1.5
SLEEP_ERR = 5.0


# ── helpers ───────────────────────────────────────────────────────────────────

def apparent_temperature_c(t_c, rh_pct, wind_kmh):
    if t_c is None or rh_pct is None:
        return None
    v_kmh = float(wind_kmh or 0.0)
    if t_c <= 10.0 and v_kmh >= 4.8:
        wc = 13.12 + 0.6215 * t_c - 11.37 * (v_kmh ** 0.16) + 0.3965 * t_c * (v_kmh ** 0.16)
        return round(wc, 1)
    wind_ms = v_kmh / 3.6
    e = (rh_pct / 100.0) * 6.105 * math.exp(17.27 * t_c / (237.7 + t_c))
    return round(t_c + 0.33 * e - 0.70 * wind_ms - 4.00, 1)


# ── BD ────────────────────────────────────────────────────────────────────────

def get_partial_dates(conn):
    """Dias onde meteomg tem menos de THRESHOLD registos E ainda não têm dados IMARIN39."""
    cur = conn.cursor()
    cur.execute("""
        SELECT DATE(ts_local) AS dia, COUNT(*) AS n
        FROM observations
        WHERE station_id = 'meteomg'
        GROUP BY dia
        HAVING n < ?
          AND dia NOT IN (
            SELECT DISTINCT DATE(ts_local)
            FROM observations
            WHERE station_id = 'IMARIN39'
          )
        ORDER BY dia
    """, (THRESHOLD,))
    return [(row[0], row[1]) for row in cur.fetchall()]


def get_day_utc_window(conn, day_str):
    """Devolve (min_ts_utc, max_ts_utc) dos registos locais para esse dia."""
    cur = conn.cursor()
    cur.execute("""
        SELECT MIN(ts_utc), MAX(ts_utc)
        FROM observations
        WHERE DATE(ts_local) = ?
    """, (day_str,))
    row = cur.fetchone()
    return row[0], row[1]


# ── API WU ────────────────────────────────────────────────────────────────────

def fetch_day(station_id, target_date):
    date_str = target_date.strftime("%Y%m%d")
    url = (
        f"https://api.weather.com/v2/pws/history/all"
        f"?stationId={station_id}&format=json&units=m"
        f"&date={date_str}&apiKey={API_KEY}&numericPrecision=decimal"
    )
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=15) as r:
            if r.status == 204:
                return []
            return json.loads(r.read().decode()).get("observations", [])
    except urllib.error.HTTPError as e:
        if e.code == 204:
            return []
        print(f"  HTTP {e.code}", end=" ")
        return None
    except Exception as e:
        print(f"  rede:{e}", end=" ")
        return None


# ── inserção ──────────────────────────────────────────────────────────────────

def insert_new_observations(conn, obs_list, after_ts_utc):
    """Insere apenas registos WU com ts_utc > after_ts_utc (janela em falta)."""
    tz  = ZoneInfo("Europe/Lisbon")
    cur = conn.cursor()
    inserted = skipped = 0
    daily_min = daily_max = None

    for obs in obs_list:
        ts_utc_str = obs.get("obsTimeUtc")
        if not ts_utc_str:
            continue

        dt_utc       = datetime.datetime.strptime(ts_utc_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        ts_utc_iso   = dt_utc.isoformat().replace("+00:00", "Z")
        ts_local_str = dt_utc.astimezone(tz).isoformat()

        if ts_utc_iso <= after_ts_utc:
            skipped += 1
            continue

        m = obs.get("metric", {})
        temp_c         = m.get("tempAvg")
        rh_pct         = obs.get("humidityAvg")
        dewpoint_c     = m.get("dewptAvg")
        wind_kmh       = m.get("windspeedAvg")
        gust_kmh       = m.get("windgustHigh")
        wind_dir_deg   = obs.get("winddirAvg")
        pressure_hpa   = m.get("pressureMax")
        rain_rate_mmph = m.get("precipRate")
        rain_day_mm    = m.get("precipTotal")
        solar_wm2      = obs.get("solarRadiationHigh")
        uv_index       = obs.get("uvHigh")
        apparent_c     = apparent_temperature_c(temp_c, rh_pct, wind_kmh)

        if temp_c is not None:
            if daily_min is None or temp_c < daily_min: daily_min = temp_c
            if daily_max is None or temp_c > daily_max: daily_max = temp_c

        try:
            cur.execute("""
                INSERT INTO observations
                    (station_id, ts_local, ts_utc,
                     temp_c, temp_max_c, temp_min_c,
                     rh_pct, dewpoint_c,
                     wind_kmh, gust_kmh, wind_dir_deg,
                     pressure_hpa, rain_rate_mmph, rain_day_mm,
                     solar_wm2, uv_index, apparent_c)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                STATION, ts_local_str, ts_utc_iso,
                temp_c, daily_max, daily_min,
                rh_pct, dewpoint_c,
                wind_kmh, gust_kmh, wind_dir_deg,
                pressure_hpa, rain_rate_mmph, rain_day_mm,
                solar_wm2, uv_index, apparent_c
            ))
            inserted += 1
        except Exception as e:
            print(f"\n  DB error: {e}")

    conn.commit()
    return inserted, skipped


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    dry_run = "--dry-run" in sys.argv

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    print("A identificar dias parciais (meteomg < 96 registos)...")
    partial = get_partial_dates(conn)

    if not partial:
        print("Nenhum dia parcial encontrado.")
        conn.close()
        return

    print(f"Encontrados {len(partial)} dias parciais.\n")

    if dry_run:
        print("[dry-run] Dias que seriam consultados:")
        for day_str, n in partial:
            print(f"  {day_str}  ({n} registos locais)")
        conn.close()
        return

    total_inserted = 0
    days_improved  = 0
    days_no_data   = 0
    days_nothing_new = 0

    for day_str, local_n in partial:
        target = datetime.date.fromisoformat(day_str)
        print(f"-> {day_str}  (local: {local_n:3d} registos)  ", end="", flush=True)

        obs = fetch_day(STATION, target)
        time.sleep(SLEEP_OK)

        if obs is None:
            print("erro de rede")
            time.sleep(SLEEP_ERR - SLEEP_OK)
            days_no_data += 1
            continue

        if not obs:
            print("sem dados WU")
            days_no_data += 1
            continue

        min_ts, max_ts = get_day_utc_window(conn, day_str)
        inserted, skipped = insert_new_observations(conn, obs, max_ts)

        if inserted > 0:
            print(f"+{inserted} inseridos após {max_ts}  ({skipped} anteriores ignorados)")
            total_inserted += inserted
            days_improved  += 1
        else:
            print(f"nada novo após {max_ts}  ({skipped} registos WU anteriores ao corte)")
            days_nothing_new += 1

    conn.close()

    print(f"\n── Concluído ─────────────────────────────────────────")
    print(f"  Dias parciais processados  : {len(partial)}")
    print(f"  Dias melhorados            : {days_improved}")
    print(f"  Dias sem dados WU          : {days_no_data}")
    print(f"  Dias sem timestamps novos  : {days_nothing_new}")
    print(f"  Registos inseridos         : {total_inserted}")


if __name__ == "__main__":
    main()
