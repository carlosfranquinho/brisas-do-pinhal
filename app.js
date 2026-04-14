/* CONFIG */
const API_BASE = "https://brisas-api.pinhaldorei.net";
const LIVE_URL = `${API_BASE}/live`;
const HIST_URL = `${API_BASE}/history?hours=24`;
const METAR_URL = `${API_BASE}/metar-tgftp/LPMR`;
const IPMA_GLOBAL_ID = 1100900;
const IPMA_FORECAST = `https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/${IPMA_GLOBAL_ID}.json`;
const PUSH_MS = 120000;
const MAX_LIVE_MS = 30 * 60 * 1000; // 30 min → pausa automática
const WU_KEY     = "__WU_API_KEY__";
const WU_STATION = "IMARIN131";
const WU_URL     = `https://api.weather.com/v2/pws/observations/current?stationId=${WU_STATION}&format=json&units=m&apiKey=${WU_KEY}&numericPrecision=decimal`;
const CSSVARS = getComputedStyle(document.documentElement);
const ACCENT = (CSSVARS.getPropertyValue("--accent") || "#3b82f6").trim();
const ACCENT2 = (CSSVARS.getPropertyValue("--accent-2") || "#94a3b8").trim();
// Endpoint de clima mensal da API
const CLIMATE_URL = `${API_BASE}/climate/monthly`;
const VIEWS = document.querySelectorAll('[data-view]');
const LINKS = document.querySelectorAll('[data-viewlink]');
let liveTimer = null;
let liveStartedAt = 0;

/* Lazy script loader */
const _scripts = {};
function loadScript(url) {
  if (_scripts[url]) return _scripts[url];
  _scripts[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Script load failed: ' + url));
    document.head.appendChild(s);
  });
  return _scripts[url];
}
const CHARTJS_URL  = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
const SUNCALC_URL  = 'https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.min.js';
const VIEWS_JS_URL = 'app-views.js?v=4';
function ensureChartJs()    { return window.Chart   ? Promise.resolve() : loadScript(CHARTJS_URL);  }
function ensureSunCalc()    { return window.SunCalc  ? Promise.resolve() : loadScript(SUNCALC_URL); }
function ensureViewsScript(){ return loadScript(VIEWS_JS_URL); }

/* Icons */
const ICON_PATHS = {
  "clear-day":           "icons/clear-day.svg",
  "clear-night":         "icons/clear-night.svg",
  "partly-cloudy-day":   "icons/partly-cloudy-day.svg",
  "partly-cloudy-night": "icons/partly-cloudy-night.svg",
  cloudy:                "icons/cloudy.svg",
  overcast:              "icons/overcast.svg",
  drizzle:               "icons/drizzle.svg",
  rain:                  "icons/rain.svg",
  "heavy-rain":          "icons/heavy-rain.svg",
  thunder:               "icons/thunder.svg",
  snow:                  "icons/snow.svg",
  sleet:                 "icons/sleet.svg",
  "freezing-rain":       "icons/freezing-rain.svg",
  fog:                   "icons/fog.svg",
  unknown:               "icons/unknown.svg",
};
function iconUrl(name) {
  return ICON_PATHS[name] || ICON_PATHS["unknown"];
}

const VALID_VIEWS = new Set(['home', 'historico', 'clima', 'acerca']);


/* Now icon state + priorities */
const NOW_ICON_PRIORITY = { default: 0, ipma: 50, metar: 100 };
const nowIconState = {
  priority: -1,
  name: "unknown",
  source: "none",
  setAt: 0,
};

function showView(name) {
  // suporte a sub-rotas: "historico/2024", "historico/analise/temperatura"
  const parts = name.split('/');
  const base  = parts[0];
  const sub   = parts[1] || null;
  const sub2  = parts[2] || null;

  const view = VALID_VIEWS.has(base) ? base : 'home';
  VIEWS.forEach(v => v.hidden = v.dataset.view !== view);
  LINKS.forEach(a => a.classList.toggle('active', a.dataset.viewlink === view));

  if (view === 'home') {
    startHome();
  }

  if (view === 'clima') {
    const table = document.getElementById('climateTable');
    if (table && !table.dataset.ready) {
      table.dataset.ready = '1';
      ensureViewsScript().then(() => loadClimateMonthly().catch(console.error));
    }
  }

  if (view === 'historico') {
    const yearNum   = sub && /^\d{4}$/.test(sub) ? +sub : null;
    const isAnalise = sub === 'analise' && !!sub2;

    // DOM: mostrar/ocultar sub-secções imediatamente (sem esperar pelo script)
    document.getElementById('historicoMain').hidden = !!(yearNum || isAnalise);
    document.getElementById('yearDetail').hidden    = !yearNum;
    document.getElementById('analiseDetail').hidden = !isAnalise;

    // Dados: aguardar o script de views
    ensureViewsScript().then(() => {
      const recordsBox = document.getElementById('allTimeRecords');
      if (recordsBox && !recordsBox.dataset.ready) {
        loadHistoryRecords().catch(console.error);
        recordsBox.dataset.ready = '1';
      }
      const yearCards = document.getElementById('yearCards');
      if (yearCards && !yearCards.dataset.ready) {
        loadYearCards().catch(console.error);
        yearCards.dataset.ready = '1';
      }
      if (yearNum)   loadYearDetail(yearNum).catch(console.error);
      if (isAnalise) loadAnalise(sub2).catch(console.error);
    });
  }
}

function handleRoute() {
  const raw  = location.hash.replace(/^#\/?/, '') || 'home';
  const view = raw.split('?')[0];
  showView(view);
}

window.addEventListener('hashchange', handleRoute);
document.addEventListener('DOMContentLoaded', handleRoute);

/* pausa automática após MAX_LIVE_MS */
function pauseLive() {
  if (liveTimer)     { clearInterval(liveTimer);     liveTimer     = null; }
  if (countdownTimer){ clearInterval(countdownTimer); countdownTimer = null; }
  ['staleFlag', 'staleFlag-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = id.includes('mobile') ? 'Pausado' : 'Pausado — atualize a página para retomar'; el.className = 'stale'; }
  });
  ['age', 'age-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}

/* ciclo da home */
let homeBooted = false;
let lastRainTs = null; // timestamp da última vez que choveu (ts_local)
function formatLastRain(tsLocal) {
  // tsLocal: "YYYY-MM-DD HH:MM:SS"
  const dStr    = tsLocal.slice(0, 10);  // "YYYY-MM-DD"
  const timeStr = tsLocal.slice(11, 16); // "HH:MM"
  const now     = new Date();
  const pad     = n => String(n).padStart(2, "0");
  const todayStr     = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const yest         = new Date(now); yest.setDate(yest.getDate() - 1);
  const yesterdayStr = `${yest.getFullYear()}-${pad(yest.getMonth()+1)}-${pad(yest.getDate())}`;
  if (dStr === todayStr)     return `hoje às ${timeStr}`;
  if (dStr === yesterdayStr) return `ontem às ${timeStr}`;
  return `${dStr.slice(8, 10)}/${dStr.slice(5, 7)} às ${timeStr}`;
}

async function loadLastRain() {
  try {
    const r = await fetch(`${API_BASE}/last-rain`, { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    if (data.ts_local) lastRainTs = data.ts_local;
  } catch (e) {
    console.warn("loadLastRain falhou:", e);
  }
}

async function startHome() {
  // arranca sempre o live; se já houver timer, renova-o
  if (!homeBooted) {
    homeBooted = true;
    try {
      await loadLastRain();          // timestamp da última chuva
      await loadLive();              // mete valores no DOM
      await loadMetarTGFTP();        // ícone atual via METAR
      await loadForecast();          // previsão 4 dias
      await loadHistory();           // gráfico 24h
    } catch (e) { console.error(e); }
  }
  liveStartedAt = Date.now();
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    if (Date.now() - liveStartedAt >= MAX_LIVE_MS) { pauseLive(); return; }
    loadLive().catch(console.error);
  }, PUSH_MS);
}



function setNowIcon(name, source, priority) {
  const img = document.getElementById("bm-now-ico");
  if (!img) return;

  if (priority < nowIconState.priority) {
    console.debug("[icon] skip (lower priority)", {
      name,
      source,
      priority,
      current: nowIconState,
    });
    return;
  }

  nowIconState.priority = priority;
  nowIconState.name = name;
  nowIconState.source = source;
  nowIconState.setAt = Date.now();

  img.src = iconUrl(name);
  img.alt = name.replace(/-/g, " ");
  img.dataset.source = source; // p/ inspeção rápida no DOM
  img.title = `Ícone: ${name} • fonte: ${source}`; // hover mostra a origem

  img.classList.remove("sunny", "alert", "neutral");
  if (
    [
      "clear-day",
      "clear-night",
      "partly-cloudy-day",
      "partly-cloudy-night",
    ].includes(name)
  ) {
    img.classList.add("sunny");
  } else if (["thunder", "heavy-rain"].includes(name)) {
    img.classList.add("alert");
  } else {
    img.classList.add("neutral");
  }

  console.debug("[icon] set", nowIconState);
}

// ── TENDÊNCIAS ──────────────────────────────────────────────────
// trendRef: snapshot do ponto mais próximo de 30 min atrás (do histórico)
let trendRef = null;
const TREND_THRESHOLDS = { rh: 1.0, dew: 0.3, press: 0.3, uv: 0.2, solar: 10 };

function setTrendArrow(id, trend) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!trend) { el.textContent = ''; el.className = 'trend-badge'; return; }
  el.className = `trend-badge trend-${trend}`;
  el.textContent = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '→';
}

function updateTrends(j) {
  if (!trendRef) return;
  const calc = (key, current) => {
    if (current == null || trendRef[key] == null) return null;
    const delta = +current - trendRef[key];
    const thr = TREND_THRESHOLDS[key];
    if (delta >  thr) return 'up';
    if (delta < -thr) return 'down';
    return 'stable';
  };
  setTrendArrow('trend-rh',    calc('rh',    j.rh_pct));
  setTrendArrow('trend-dew',   calc('dew',   j.dewpoint_c));
  setTrendArrow('trend-press', calc('press', j.pressure_hpa));
  setTrendArrow('trend-uv',    calc('uv',    j.uv_index));
  setTrendArrow('trend-solar', calc('solar', j.solar_wm2));
}

// Gráfico 24h (home)
let lastLiveData = null;
let chart = null;

/* Helpers */
const $ = (sel) => document.querySelector(sel);
const fmt = (n, d = 0) => (n == null || isNaN(n) ? "—" : Number(n).toFixed(d));
const degToDir = (deg) => {
  if (deg == null) return "—";
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSO",
    "SO",
    "OSO",
    "O",
    "ONO",
    "NO",
    "NNO",
  ];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
};

const localTime = (iso) => new Date(iso);

function setText(sel, text) {
  const el = $(sel);
  if (!el) return;
  const prev = el.dataset.val ?? el.textContent;
  el.textContent = text;
  el.dataset.val = text;
  if (String(prev) !== String(text)) {
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 350);
  }
}

function iconNameFromMetarRaw(raw, isDaytime) {
  if (!raw) return "unknown";
  const r = " " + raw + " ";
  if (/\+TSRA|TSRA|VCTS|CB/.test(r)) return "thunder";
  if (/\+RA|GR/.test(r)) return "heavy-rain";  // GR=granizo → heavy-rain (não snow)
  if (/FZRA|FZDZ/.test(r)) return "freezing-rain";
  if (/SN|SG|PL/.test(r)) return "snow";
  if (/RA|SHRA/.test(r)) return "rain";
  if (/DZ/.test(r)) return "drizzle";
  if (/FG|BR|HZ/.test(r)) return "fog";
  if (/CAVOK|SKC|NSC/.test(r)) return isDaytime ? "clear-day" : "clear-night";
  if (/OVC|BKN/.test(r)) return "overcast";
  if (/SCT|FEW/.test(r))
    return isDaytime ? "partly-cloudy-day" : "partly-cloudy-night";
  return isDaytime ? "clear-day" : "clear-night";
}

async function loadMetarTGFTP() {
  try {
    const r = await fetch(METAR_URL, { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) return;
    // Rejeitar respostas que não sejam da estação correta (proteção contra dados errados do NOAA)
    if (!j.raw || !j.raw.trimStart().startsWith("LPMR")) {
      console.warn("METAR: raw inesperado (estação errada ou dados corrompidos):", j.raw?.slice(0, 40));
      return;
    }

    const sunrise = $("#sunrise")?.textContent || "06:00";
    const sunset = $("#sunset")?.textContent || "21:00";
    const day = isDay(Date.now(), sunrise, sunset);
    const name = iconNameFromMetarRaw(j.raw, day);

    setNowIcon(name, `metar:lpmr`, NOW_ICON_PRIORITY.metar);
  } catch (e) {
    console.warn("METAR TGFTP falhou:", e);
  }
}

let countdownTimer = null,
  nextRefreshAt = 0;
function startCountdown(ms) {
  nextRefreshAt = Date.now() + ms;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const s = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
    const txt = s === 0 ? "agora" : `em ${s}s`;
    const el = $("#age");
    if (el) el.textContent = txt; // sem “pulse” a cada tick
    if (s === 0) clearInterval(countdownTimer);
  }, 250);
}

/* Copyright: ano atual */
const copyrightYearEl = document.getElementById('copyrightYear');
if (copyrightYearEl) copyrightYearEl.textContent = new Date().getFullYear();

/* Cabeçalho: data atual */
(function setNow() {
  const now = new Date();
  const fmtDate = now.toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  $("#nowDate").textContent =
    fmtDate.charAt(0).toUpperCase() + fmtDate.slice(1);
})();

// Dia/noite: usa horários já formatados "HH:MM"
function isDay(nowTs, sunriseStr, sunsetStr) {
  const [srH, srM] = sunriseStr.split(":").map(Number);
  const [ssH, ssM] = sunsetStr.split(":").map(Number);
  const now = new Date(nowTs);
  const sr = new Date(now);
  sr.setHours(srH, srM, 0, 0);
  const ss = new Date(now);
  ss.setHours(ssH, ssM, 0, 0);
  return now >= sr && now < ss;
}

// Mapa ultra-prático IPMA → nome do ícone do sprite
function iconNameFromIpma(code, isDaytime) {
  const c = Number(code);
  if (c === 1) return isDaytime ? "clear-day" : "clear-night";
  if (c === 2 || c === 3 || c === 25)
    return isDaytime ? "partly-cloudy-day" : "partly-cloudy-night";
  if (c === 4 || c === 24 || c === 27) return "cloudy";
  if (c === 5) return "overcast";

  if ([6, 7, 8, 15].includes(c)) return "rain";
  if ([9, 10, 12, 13].includes(c)) return "drizzle";
  if ([11, 14].includes(c)) return "heavy-rain";

  if ([16, 17, 26].includes(c)) return "fog";

  if (c === 18) return "snow";
  if (c === 21) return "sleet";
  if (c === 22) return "freezing-rain";
  if ([19, 20, 23].includes(c)) return "thunder";

  return "unknown";
}

// Aplica no ícone grande do topo
function renderNowIcon(ipmaCode, sunriseHHMM, sunsetHHMM) {
  const day = isDay(Date.now(), sunriseHHMM, sunsetHHMM);
  const name = iconNameFromIpma(ipmaCode, day);
  setNowIcon(name, "ipma-forecast", NOW_ICON_PRIORITY.ipma);
}

/* Sun times */
const LAT = 39.75,
  LON = -8.94;
async function setSunTimes(date = new Date()) {
  await ensureSunCalc();
  const t = SunCalc.getTimes(date, LAT, LON);
  const opt = { hour: "2-digit", minute: "2-digit" };
  $("#sunrise").textContent = t.sunrise.toLocaleTimeString("pt-PT", opt);
  $("#sunset").textContent = t.sunset.toLocaleTimeString("pt-PT", opt);
}

async function loadForecast() {
  try {
    const r = await fetch(IPMA_FORECAST, { cache: "no-store" });
    const j = await r.json();

    const days = j.data?.slice(0, 4) || [];
    const ul = $("#forecast");
    const ulMobile = $("#forecast-mobile");
    ul.innerHTML = "";
    if (ulMobile) ulMobile.innerHTML = "";

    days.forEach((d, i) => {
      const day = new Date(d.forecastDate);
      const label =
        i === 0
          ? "hoje"
          : i === 1
            ? "amanhã"
            : day.toLocaleDateString("pt-PT", { weekday: "short" });

      const iconName = iconNameFromIpma(d.idWeatherType, /*isDaytime*/ true);
      const tMax = Number.isFinite(+d.tMax) ? Math.round(d.tMax) : null;
      const tMin = Number.isFinite(+d.tMin) ? Math.round(d.tMin) : null;

      const makeItem = () => {
        const li = document.createElement("li");
        li.innerHTML = `
  <div class="d">${label}</div>
  <div class="ic">
    <img class="bm-ico bm-ico--sm" src="${iconUrl(iconName)}" alt="${iconName.replace(/-/g, " ")}" width="48" height="48">
  </div>
  <div class="t">
    <span class="hi">${tMax != null ? `${tMax}°` : "—"}</span>
    <span class="sep"> | </span>
    <span class="lo">${tMin != null ? `${tMin}°` : "—"}</span>
  </div>
`;
        return li;
      };

      ul.appendChild(makeItem());
      if (ulMobile) ulMobile.appendChild(makeItem());

      // continua a usar o 1.º dia para o ícone grande do topo
      if (i === 0) {
        const sunrise = $("#sunrise")?.textContent || "06:00";
        const sunset = $("#sunset")?.textContent || "21:00";
        renderNowIcon(d.idWeatherType, sunrise, sunset);
      }
    });
  } catch (e) {
    console.warn("IPMA falhou:", e);
  }
}

function appendLivePointToChart(j) {
  if (!chart || !HISTORY_WINDOW_POINTS) return;

  // timestamp seguro
  const rawTs = j.ts_local || j.ts_utc;
  if (!rawTs) return;
  const t = new Date(
    rawTs.includes(" ") && !rawTs.endsWith("Z")
      ? rawTs.replace(" ", "T")
      : rawTs
  );
  const tms = t.getTime();

  const toNum = (v) => (v == null ? null : Number(v));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  // ignora fora de ordem
  if (chartLastTs && tms <= chartLastTs) return;

  // valores
  const temp = (() => {
    const v = toNum(j.temp_c);
    return isNum(v) ? v : null; // null => gap
  })();

  const rain = (() => {
    const v = toNum(j.rain_rate_mmph);
    return isNum(v) ? v : null; // null => sem barra
  })();

  chart.data.labels.push(
    t.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
  );
  chart.data.datasets[0].data.push(temp);
  if (temp !== null) {
    chart.data.datasets[0].hidden = false; // volta a mostrar se vier valor
  }
  chart.data.datasets[1].data.push(rain);
  chartLastTs = tms;

  // mantém a janela do tamanho original (≈24h)
  const maxPoints = HISTORY_WINDOW_POINTS || chart.data.labels.length;
  while (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
  }

  chart.update("none");
}

/* WU fallback — usado quando o PC/API está completamente offline */
async function loadLiveFromWU() {
  const r = await fetch(WU_URL, { cache: "no-store", mode: "cors" });
  if (!r.ok) throw new Error("WU " + r.status);
  const d = await r.json();
  const obs = d?.observations?.[0];
  if (!obs) throw new Error("WU sem dados");
  const m = obs.metric ?? {};
  // Mapear campos WU → formato da nossa API
  return {
    fallback: true,
    station:  WU_STATION,
    ts_local: obs.obsTimeLocal,
    ts_utc:   obs.obsTimeUtc,
    temp_c:          m.temp          ?? null,
    temp_max_c:      m.tempHigh      ?? null,
    temp_min_c:      m.tempLow       ?? null,
    rh_pct:          obs.humidity    ?? null,
    dewpoint_c:      m.dewpt         ?? null,
    wind_kmh:        m.windSpeed     ?? null,
    gust_kmh:        m.windGust      ?? null,
    wind_dir_deg:    obs.winddir     ?? null,
    pressure_hpa:    m.pressure      ?? null,
    rain_rate_mmph:  m.precipRate    ?? null,
    rain_day_mm:     m.precipTotal   ?? null,
    solar_wm2:       obs.solarRadiation ?? null,
    uv_index:        obs.uv          ?? null,
    apparent_c:      m.heatIndex     ?? m.windChill ?? m.temp ?? null,
    stale: false,
  };
}

/* Live */
async function loadLive() {
  let j;
  try {
    const r = await fetch(LIVE_URL, {
      cache: "no-store",
      mode: "cors",
      credentials: "omit",
    });
    if (!r.ok) throw new Error("live " + r.status);
    j = await r.json();
  } catch (apiErr) {
    // PC/tunnel offline — tentar WU diretamente do browser
    try {
      j = await loadLiveFromWU();
    } catch (wuErr) {
      console.warn("WU fallback falhou:", wuErr);
      const flag = $("#staleFlag");
      if (flag) { flag.textContent = "Estação offline — sem dados disponíveis"; flag.className = "stale"; }
      throw apiErr; // propaga para o caller (startHome) ignorar e tentar novamente
    }
  }

  const setExt = (sel, label, val, hhmm) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.innerHTML =
      `<span class="label">${label}</span>` +
      `<span class="val">${val}</span>` +
      (hhmm ? ` <span class="label time">(${hhmm})</span>` : "");
  };


  const tmaxH = j.temp_max_time ? new Date(j.temp_max_time).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "";
  const tminH = j.temp_min_time ? new Date(j.temp_min_time).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "";

  setText("#temp", fmt(j.temp_c, 1));
  setText("#apparent", fmt(j.apparent_c ?? j.temp_c, 1));
  setText("#wind", fmt(j.wind_kmh, 0));
  setText("#winddir", degToDir(j.wind_dir_deg));
  const arrow = document.getElementById("windArrowContainer");
  if (arrow && j.wind_dir_deg !== null) {
    arrow.style.transform = `rotate(${j.wind_dir_deg}deg)`;
  }
  setText("#gust", fmt(j.gust_kmh, 0));
  setText("#rh", fmt(j.rh_pct, 0) + "%");
  setText("#dew", fmt(j.dewpoint_c, 1) + "°");
  setText("#press", fmt(j.pressure_hpa, 0));
  if (j.pressure_hpa != null) {
    const pressImg = document.querySelector("#pressIcon img");
    if (pressImg) {
      const trend = trendRef ? j.pressure_hpa - (trendRef.press ?? j.pressure_hpa) : 0;
      pressImg.src = trend < -0.3 ? "icons/extra/pressure-low.svg" : "icons/extra/pressure-high.svg";
    }
  }
  setText("#uv", fmt(j.uv_index, 1));
  setText("#solar", fmt(j.solar_wm2, 0));

  const hhmm = (s) => {
    if (!s) return "";
    const m = s.replace(" ", "T").match(/T(\d{2}:\d{2})/);
    return m ? m[1] : "";
  };

  setExt("#tmax", "máx", `${fmt(j.temp_max_c, 1)}°`, hhmm(j.temp_max_time));
  setExt("#tmin", "min", `${fmt(j.temp_min_c, 1)}°`, hhmm(j.temp_min_time));

  if (j.rain_day_mm != null) {
    setText("#rainToday", fmt(j.rain_day_mm, 1));
    // Bucket de precipitação
    const rainMm = j.rain_day_mm ?? 0;
    const NICE_MAXES = [5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300];
    const bucketMax = NICE_MAXES.find(v => v > rainMm) ?? Math.ceil(rainMm / 10) * 10 + 10;
    const pct = Math.min(100, (rainMm / bucketMax) * 100);
    const fill = document.getElementById('rainFill');
    const maxLabel = document.getElementById('rainBucketMax');
    if (fill) fill.style.height = pct + '%';
    if (maxLabel) maxLabel.textContent = bucketMax + ' mm';
  }

  // Taxa de pluviosidade — quando chove mostra taxa atual; senão mostra última precipitação
  const rateGroup = document.getElementById('rainRateGroup');
  if (rateGroup) {
    const rate = j.rain_rate_mmph != null ? +j.rain_rate_mmph : 0;
    const rateLabel = document.getElementById('rainRateLabel');
    const rateUnit  = document.getElementById('rainRateUnit');
    if (rate > 0) {
      if (rateLabel) rateLabel.textContent = "Taxa atual";
      if (rateUnit)  rateUnit.textContent  = " mm/h";
      setText("#rainRate", fmt(rate, 1));
      rateGroup.dataset.mode = "rate";
      // atualiza lastRainTs com a observação atual
      if (j.ts_local) lastRainTs = j.ts_local;
      rateGroup.hidden = false;
    } else if (lastRainTs) {
      if (rateLabel) rateLabel.textContent = "Última precipitação";
      if (rateUnit)  rateUnit.textContent  = "";
      setText("#rainRate", formatLastRain(lastRainTs));
      rateGroup.dataset.mode = "last";
      rateGroup.hidden = false;
    } else {
      rateGroup.hidden = true;
    }
  }

  const ts = localTime(j.ts_local ?? j.ts_utc);
  setSunTimes(ts);

  // legenda/estado
  const flag = $("#staleFlag");
  if (j.fallback) {
    flag.textContent = `Estação offline — dados de ${j.station}`;
    flag.className = "stale";
  } else if (j.stale) {
    flag.textContent = "Dados desatualizados";
    flag.className = "stale";
  } else {
    flag.textContent = "Estação online";
    flag.className = "ok";
  }

  lastLiveData = j;
  updateTrends(j);
  startCountdown(PUSH_MS);
  appendLivePointToChart(j);
}

/* Histórico 24h -> gráfico */
async function loadHistory() {
  const r = await fetch(HIST_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("hist " + r.status);
  const rows = await r.json(); // <- rows SÓ aqui

  // helper: ts_local "YYYY-MM-DD HH:MM:SS" -> Date local; fallback para ts_utc
  const toLocalDate = (x) => {
    if (x.ts_local) return new Date(x.ts_local.replace(" ", "T"));
    return new Date(
      x.ts_utc.endsWith("Z") ? x.ts_utc : x.ts_utc.replace(" ", "T") + "Z"
    );
  };

  const toNum = (v) => (v == null ? null : Number(v));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  // arrays de datas/labels
  const labelDates = rows.map(toLocalDate);
  const labels = labelDates.map((t) =>
    t.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
  );

  // guarda janela e último timestamp real (para o appendLivePointToChart)
  HISTORY_WINDOW_POINTS = labels.length;
  chartLastTs = labelDates.at(-1)?.getTime() || 0;

  // define trendRef: ponto do histórico mais próximo de 30 min atrás
  const refTarget = Date.now() - 30 * 60 * 1000;
  let refRow = null, refDiff = Infinity;
  rows.forEach((r, i) => {
    const diff = Math.abs(labelDates[i].getTime() - refTarget);
    if (diff < refDiff) { refDiff = diff; refRow = r; }
  });
  if (refRow) {
    trendRef = {
      rh:    refRow.rh_pct       != null ? +refRow.rh_pct       : null,
      dew:   refRow.dewpoint_c   != null ? +refRow.dewpoint_c   : null,
      press: refRow.pressure_hpa != null ? +refRow.pressure_hpa : null,
      uv:    refRow.uv_index     != null ? +refRow.uv_index     : null,
      solar: refRow.solar_wm2    != null ? +refRow.solar_wm2    : null,
    };
  }
  // trendRef definido — recalcular setas com o último live
  if (lastLiveData) updateTrends(lastLiveData);

  // Pré-calcula quais os índices do eixo X a mostrar:
  // de 2h em 2h, desde a hora cheia antes do instante atual até ao início dos dados
  const anchor = new Date();
  anchor.setMinutes(0, 0, 0); // ex: 21:51 → 21:00

  const dataStartTs = labelDates[0]?.getTime() ?? (anchor.getTime() - 24 * 3_600_000);
  const tickTargets = [];
  for (let ts = anchor.getTime(); ts >= dataStartTs - 3_600_000; ts -= 2 * 3_600_000) {
    tickTargets.push(ts);
  }

  // Para cada alvo, encontrar o índice mais próximo (dentro de 1h)
  const tickMap = new Map(); // Map<dataIndex, Date(targetTs)>
  for (const targetTs of tickTargets) {
    let bestIdx = -1, bestDiff = Infinity;
    labelDates.forEach((d, i) => {
      const diff = Math.abs(d.getTime() - targetTs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    });
    if (bestIdx >= 0 && bestDiff < 3_600_000) tickMap.set(bestIdx, new Date(targetTs));
  }

  // datasets
  const rawTemps = rows.map((x) =>
    Number.isFinite(+x.temp_c) ? +x.temp_c : null
  );
  const rainRate = rows.map((x) => {
    const v = toNum(x.rain_rate_mmph);
    return isNum(v) ? v : null;
  });

  // filtra lixo -> gaps
  const temps = rows.map((x) => {
    const v = toNum(x.temp_c);
    return isNum(v) ? v : null;
  });
  const allTempsNull = temps.every((v) => v === null);

  // Acumulado 24h: somar incrementos de rain_day_mm, com reset à meia-noite
  const rain24 = rows.reduce((acc, row, i) => {
    if (i === 0) return acc;
    const prev = toNum(rows[i - 1].rain_day_mm);
    const curr = toNum(row.rain_day_mm);
    if (prev == null || curr == null) return acc;
    if (curr >= prev) return acc + (curr - prev); // incremento normal
    return acc + curr;                             // reset à meia-noite
  }, 0);
  setText("#rain24", fmt(rain24, 1));

  const ctxHTML = document.getElementById("histChart");
  if (!ctxHTML) return;

  // Libertar a Main Thread para o Browser desenhar a página
  await new Promise(r => setTimeout(r, 20));

  await ensureChartJs();

  // Libertar novamente para mitigar a compilação inicial da framework
  await new Promise(r => setTimeout(r, 20));

  const ctx2d = ctxHTML.getContext('2d');
  const gradientTemp = ctx2d.createLinearGradient(0, 0, 0, ctxHTML.height || 300);
  gradientTemp.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
  gradientTemp.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  if (chart) chart.destroy();
  chart = new Chart(ctxHTML, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Temperatura (°C)",
          data: temps,
          yAxisID: "y1",
          borderColor: '#10b981',
          backgroundColor: gradientTemp,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          spanGaps: true,
          hidden: allTempsNull,
          order: 1
        },
        {
          type: "bar",
          label: "Precipitação (mm/h)",
          data: rainRate,
          yAxisID: "y2",
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderRadius: 4,
          order: 2
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#1e293b', bodyColor: '#475569',
          borderColor: 'rgba(0,0,0,0.05)', borderWidth: 1, padding: 12, boxPadding: 4,
          usePointStyle: true,
          titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13, weight: '800' },
          bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: "'Plus Jakarta Sans', sans-serif" },
            maxRotation: 0,
            autoSkip: false,
            callback: function (value, index) {
              const target = tickMap.get(index);
              if (!target) return "";
              return target.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
            },
          },
        },
        y1: {
          position: "left",
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { callback: v => v + '°', font: { size: 11 } },
        },
        y2: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: v => v + ' mm', font: { size: 11 } },
          min: 0,
        },
      },
    },
  });
}

