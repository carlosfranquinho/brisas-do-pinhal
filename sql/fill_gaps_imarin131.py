"""
Preenche lacunas na BD local com dados da estação Wunderground IMARIN131.

- Só insere dias que não têm qualquer registo (INSERT OR IGNORE por ts_utc).
- Nunca sobrescreve dados existentes.
- Cobre o período desde 2021-01-01 até hoje.
- Marca os registos inseridos com station_id="IMARIN131" para rastreabilidade.

Uso:
    python3 sql/fill_gaps_imarin131.py [--dry-run]

    --dry-run  lista os dias em falta sem fazer pedidos à API nem inserir dados
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

API_KEY    = "d799d63dde864ec899d63dde864ec8db"
STATION_ID = "IMARIN131"
DB_PATH    = "/var/lib/meteo/meteo.db"
START_DATE = datetime.date(2021, 1, 1)
SLEEP_OK   = 1.5   # segundos entre pedidos bem-sucedidos
SLEEP_ERR  = 5.0   # segundos após erro de rede


# ── helpers ──────────────────────────────────────────────────────────────────

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


# ── BD: dias em falta ─────────────────────────────────────────────────────────

def get_missing_dates():
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()
    cur.execute(
        "SELECT DISTINCT DATE(ts_local) FROM observations WHERE DATE(ts_local) >= ?",
        (START_DATE.isoformat(),)
    )
    days_with_data = {row[0] for row in cur.fetchall()}
    conn.close()

    missing = []
    d = START_DATE
    today = datetime.date.today()
    while d <= today:
        if d.isoformat() not in days_with_data:
            missing.append(d)
        d += datetime.timedelta(days=1)
    return missing


# ── API Wunderground ──────────────────────────────────────────────────────────

def fetch_day(target_date: datetime.date):
    date_str = target_date.strftime("%Y%m%d")
    url = (
        f"https://api.weather.com/v2/pws/history/all"
        f"?stationId={STATION_ID}&format=json&units=m"
        f"&date={date_str}&apiKey={API_KEY}&numericPrecision=decimal"
    )
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=15) as r:
            if r.status == 204:
                return []
            return json.loads(r.read().decode()).get("observations", [])
    except urllib.error.HTTPError as e:
        print(f"   HTTP {e.code}: {e.reason}")
        return None
    except Exception as e:
        print(f"   Erro de rede: {e}")
        return None


# ── inserção na BD ────────────────────────────────────────────────────────────

def insert_observations(conn, obs_list):
    if not obs_list:
        return 0

    tz  = ZoneInfo("Europe/Lisbon")
    cur = conn.cursor()
    count = 0

    daily_min = daily_max = None

    for obs in obs_list:
        ts_utc_str = obs.get("obsTimeUtc")
        if not ts_utc_str:
            continue

        dt_utc       = datetime.datetime.strptime(ts_utc_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        ts_local_str = dt_utc.astimezone(tz).isoformat()
        ts_utc_iso   = dt_utc.isoformat().replace("+00:00", "Z")

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
                INSERT OR IGNORE INTO observations
                    (station_id, ts_local, ts_utc,
                     temp_c, temp_max_c, temp_min_c,
                     rh_pct, dewpoint_c,
                     wind_kmh, gust_kmh, wind_dir_deg,
                     pressure_hpa, rain_rate_mmph, rain_day_mm,
                     solar_wm2, uv_index, apparent_c)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                STATION_ID, ts_local_str, ts_utc_iso,
                temp_c, daily_max, daily_min,
                rh_pct, dewpoint_c,
                wind_kmh, gust_kmh, wind_dir_deg,
                pressure_hpa, rain_rate_mmph, rain_day_mm,
                solar_wm2, uv_index, apparent_c
            ))
            count += 1
        except Exception as e:
            print(f"   DB error: {e}")

    conn.commit()
    return count


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    dry_run = "--dry-run" in sys.argv

    print(f"A calcular dias em falta desde {START_DATE}...")
    missing = get_missing_dates()

    if not missing:
        print("Sem lacunas. BD completa.")
        return

    print(f"Encontrados {len(missing)} dias em falta.")

    if dry_run:
        print("\n[dry-run] Dias que seriam preenchidos:")
        for d in missing:
            print(f"  {d}")
        return

    print(f"A iniciar recuperação via Wunderground ({STATION_ID})...\n")

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    total_inserted = 0
    no_data        = 0
    errors         = 0

    for d in missing:
        print(f"-> {d}", end="  ", flush=True)
        obs = fetch_day(d)

        if obs is None:
            print("ERRO — a saltar")
            errors += 1
            time.sleep(SLEEP_ERR)
            continue

        if not obs:
            print("sem dados no WU")
            no_data += 1
            time.sleep(SLEEP_OK)
            continue

        n = insert_observations(conn, obs)
        print(f"{n} registos inseridos")
        total_inserted += n
        time.sleep(SLEEP_OK)

    conn.close()

    print(f"\n── Concluído ──────────────────────────────")
    print(f"  Dias processados : {len(missing)}")
    print(f"  Registos inseridos: {total_inserted}")
    print(f"  Dias sem dados WU : {no_data}")
    print(f"  Erros de rede     : {errors}")


if __name__ == "__main__":
    main()
