/* CONFIG */
const API_BASE = "https://brisas-api.pinhaldorei.net";
const LIVE_URL = `${API_BASE}/live`;
const HIST_URL = `${API_BASE}/history?hours=24`;
const METAR_URL = `${API_BASE}/metar-tgftp/LPMR`;
const IPMA_GLOBAL_ID = 1100900;
const IPMA_FORECAST = `https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/${IPMA_GLOBAL_ID}.json`;
const PUSH_MS = 120000;
const CSSVARS = getComputedStyle(document.documentElement);
const ACCENT = (CSSVARS.getPropertyValue("--accent") || "#3b82f6").trim();
const ACCENT2 = (CSSVARS.getPropertyValue("--accent-2") || "#94a3b8").trim();
// Endpoint de clima mensal da API
const CLIMATE_URL = `${API_BASE}/climate/monthly`;
const VIEWS = document.querySelectorAll('[data-view]');
const LINKS = document.querySelectorAll('[data-viewlink]');
let liveTimer = null;

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
const CHARTJS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
const SUNCALC_URL = 'https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.min.js';
function ensureChartJs()  { return window.Chart   ? Promise.resolve() : loadScript(CHARTJS_URL); }
function ensureSunCalc()  { return window.SunCalc  ? Promise.resolve() : loadScript(SUNCALC_URL); }

/* Icons */
const ICON_PATHS = {
  "clear-day": "icons/clear-day.svg",
  "clear-night": "icons/clear-night.svg",
  "partly-cloudy-day": "icons/partly-cloudy-day.svg",
  "partly-cloudy-night": "icons/partly-cloudy-night.svg",
  cloudy: "icons/cloudy.svg",
  overcast: "icons/cloudy.svg",
  drizzle: "icons/drizzle.png",
  rain: "icons/rain.svg",
  "heavy-rain": "icons/heavy-rain.svg",
  thunder: "icons/thunder.svg",
  snow: "icons/snow.svg",
  sleet: "icons/rain.svg",
  "freezing-rain": "icons/freezing-rain.png",
  fog: "icons/fog.svg",
  wind: "icons/wind.png",
  unknown: "icons/cloudy.svg",
};
function iconUrl(name) {
  return ICON_PATHS[name] || ICON_PATHS["unknown"];
}

const VALID_VIEWS = new Set(['home', 'historico', 'clima']);


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
      loadClimateMonthly().catch(console.error);
      table.dataset.ready = '1';
    }
  }

  if (view === 'historico') {
    // carregar records e years (uma só vez)
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

    const yearNum   = sub && /^\d{4}$/.test(sub) ? +sub : null;
    const isAnalise = sub === 'analise' && !!sub2;

    document.getElementById('historicoMain').hidden = !!(yearNum || isAnalise);
    document.getElementById('yearDetail').hidden    = !yearNum;
    document.getElementById('analiseDetail').hidden = !isAnalise;

    if (yearNum)   loadYearDetail(yearNum).catch(console.error);
    if (isAnalise) loadAnalise(sub2).catch(console.error);
  }
}

function handleRoute() {
  const raw  = location.hash.replace(/^#\/?/, '') || 'home';
  const view = raw.split('?')[0];
  showView(view);
}

window.addEventListener('hashchange', handleRoute);
document.addEventListener('DOMContentLoaded', handleRoute);

/* ciclo da home */
let homeBooted = false;
async function startHome() {
  // arranca sempre o live; se já houver timer, renova-o
  if (!homeBooted) {
    homeBooted = true;
    try {
      await loadLive();              // mete valores no DOM
      await loadMetarTGFTP();        // ícone atual via METAR
      await loadForecast();          // previsão 4 dias
      await loadHistory();           // gráfico 24h
    } catch (e) { console.error(e); }
  }
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(() => loadLive().catch(console.error), PUSH_MS);
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

// HISTÓRICO/GRÁFICO (globais)
let lastLiveData = null;
let chart = null;
let HISTORY_WINDOW_POINTS = 0;
let chartLastTs = 0;
let climateChart = null;

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
  if (/\+RA/.test(r)) return "heavy-rain";
  if (/FZRA|FZDZ/.test(r)) return "freezing-rain";
  if (/SN|SG|PL|GR/.test(r)) return "snow";
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

/* Live */
async function loadLive() {
  const r = await fetch(LIVE_URL, {
    cache: "no-store",
    mode: "cors",
    credentials: "omit",
  });
  if (!r.ok) throw new Error("live " + r.status);
  const j = await r.json();

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

  const ts = localTime(j.ts_local ?? j.ts_utc);
  setSunTimes(ts);

  // legenda/estado
  const flag = $("#staleFlag");
  if (j.stale) {
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
    console.log('[trends] trendRef definido a partir de refRow (diff=' + Math.round(refDiff/60000) + 'min):', trendRef);
  } else {
    console.log('[trends] refRow não encontrado — rows.length=', rows.length);
  }
  // trendRef definido — recalcular setas com o último live
  if (lastLiveData) updateTrends(lastLiveData);

  // Pré-calcula quais os índices do eixo X a mostrar:
  // última hora completa antes do load, depois de 2h em 2h para trás
  const anchor = new Date();
  anchor.setMinutes(0, 0, 0); // ex: 15:43 → 15:00
  const tickTargets = [];
  for (let i = 0; i < 24; i += 2) {
    tickTargets.push(anchor.getTime() - i * 3_600_000);
  }
  // Para cada alvo, encontrar o índice mais próximo (dentro de 1h)
  // Guarda mapa índice → hora-alvo (para mostrar "17:00" mesmo que o ponto seja "16:59")
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

  // Acumulado 24h: rate (mm/h) × intervalo real entre leituras consecutivas
  const rain24 = rainRate.reduce((acc, rate, i) => {
    if (rate == null || i === 0) return acc;
    const intervalH = (labelDates[i].getTime() - labelDates[i - 1].getTime()) / 3_600_000;
    return acc + rate * intervalH;
  }, 0);
  setText("#rain24", fmt(rain24, 1));

  const ctxHTML = document.getElementById("histChart");
  if (!ctxHTML) return;

  const ctx2d = ctxHTML.getContext('2d');
  const gradientTemp = ctx2d.createLinearGradient(0, 0, 0, ctxHTML.height || 300);
  gradientTemp.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
  gradientTemp.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  await ensureChartJs();
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
          grid: { color: "rgba(0,0,0,0.04)", drawBorder: false },
          ticks: { font: { family: "'Plus Jakarta Sans', sans-serif" } },
          title: { display: true, text: "Temperatura (ºC)", font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' } },
        },
        y2: {
          position: "right",
          grid: { display: false, drawBorder: false },
          ticks: { font: { family: "'Plus Jakarta Sans', sans-serif" } },
          beginAtZero: true,
          title: { display: true, text: "Precipitação (mm)", font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' } },
        },
      },
    },
  });
}

// Carrega dados climáticos mensais e preenche a tabela
async function loadClimateMonthly() {
  const r = await fetch(CLIMATE_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`climate ${r.status}`);
  const j = await r.json();
  const months = j.months || j.data || [];
  renderClimateTable(months); // suporta “months” ou “data”
  await renderClimateChart(months);
}

function renderClimateTable(months) {
  // garantir 12 meses (1..12)
  const byM = Array.from({ length: 12 }, (_, i) => months.find(x => +x.month === i + 1) || { month: i + 1 });

  const mNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const rows = [
    { label: 'Temperatura — média', key: 't_mean', unit: '°C', dec: 1 },
    { label: 'Média máx', key: 'tmax_mean', unit: '°C', dec: 1, hot: true },
    { label: 'Média min', key: 'tmin_mean', unit: '°C', dec: 1, cold: true },

    { label: 'Dias com geada (min<0°)', key: 'frost_days', dec: 1 },
    { label: 'Dias com gelo (máx<0°)', key: 'ice_days', dec: 1 },
    { label: 'Dias de verão (máx>25°)', key: 'summer_days', dec: 1 },
    { label: 'Dias tropicais (máx>30°)', key: 'tropical_days', dec: 1 },
    { label: 'Noites tropicais (min≥20°)', key: 'tropical_nights', dec: 1 },

    { label: 'Média precipitação (mm)', key: 'precip_mean_mm', unit: ' mm', dec: 1 },

    // Extremos absolutos — valor visível; data em title (tooltip)
    { label: 'Máximo absoluto', key: 'abs_max', unit: '°C', dec: 1, hot: true, dateKey: 'abs_max_date' },
    { label: 'Mínimo absoluto', key: 'abs_min', unit: '°C', dec: 1, cold: true, dateKey: 'abs_min_date' },
  ];

  const tbl = document.getElementById('climateTable');
  if (!tbl) return;

  // THEAD
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.innerHTML = `<th>Mês</th>${mNames.map(n => `<th>${n}</th>`).join('')}`;
  thead.appendChild(hr);

  // TBODY
  const tbody = document.createElement('tbody');

  for (const row of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = row.label;
    tr.appendChild(th);

    byM.forEach(m => {
      const td = document.createElement('td');
      const v = m[row.key];
      const txt = (v == null || Number.isNaN(+v)) ? '—' :
        (row.dec != null ? Number(v).toFixed(row.dec) : String(v)) + (row.unit || '');
      td.textContent = txt;

      // tooltip com a data (para extremos)
      if (row.dateKey && m[row.dateKey]) {
        const dt = new Date(m[row.dateKey]);
        const hhmm = isNaN(dt) ? String(m[row.dateKey]) :
          dt.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        td.title = hhmm;
      }

      if (row.hot) td.classList.add('is-hot');
      if (row.cold) td.classList.add('is-cold');
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }

  // MONTAGEM
  tbl.replaceChildren(thead, tbody);
}

async function renderClimateChart(months) {
  const canvas = document.getElementById('climateChart');
  if (!canvas) return;

  const withMonths = months.map((m, i) => ({ month: m.month ?? i + 1, ...m }));
  const byM = Array.from({ length: 12 }, (_, i) =>
    withMonths.find((x) => +x.month === i + 1) || {}
  );
  const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const toNum = (v) => (v == null ? null : Number(v));

  const tMean = byM.map((m) => {
    if (m.t_mean != null) return toNum(m.t_mean);
    if (m.tmax_mean != null && m.tmin_mean != null)
      return +((toNum(m.tmax_mean) + toNum(m.tmin_mean)) / 2).toFixed(1);
    return null;
  });
  const tMax = byM.map((m) => toNum(m.abs_max ?? m.tmax_mean));
  const tMin = byM.map((m) => toNum(m.abs_min ?? m.tmin_mean));
  const rain = byM.map((m) => toNum(m.precip_mean_mm ?? m.rain));

  await ensureChartJs();
  if (climateChart) climateChart.destroy();
  climateChart = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Precipitação média (mm)',
          data: rain,
          backgroundColor: 'rgba(20,184,166,0.25)',
          borderColor: 'rgba(20,184,166,0.7)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'yRain',
          order: 2,
        },
        {
          type: 'line',
          label: 'Máx. absoluta',
          data: tMax,
          borderColor: 'rgba(244,63,94,0.8)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          spanGaps: true,
          yAxisID: 'yTemp',
          order: 1,
        },
        {
          type: 'line',
          label: 'Mín. absoluta',
          data: tMin,
          borderColor: 'rgba(59,130,246,0.8)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          spanGaps: true,
          yAxisID: 'yTemp',
          order: 1,
        },
        {
          type: 'line',
          label: 'Temp. média',
          data: tMean,
          borderColor: 'rgba(100,116,139,0.7)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 2,
          tension: 0.3,
          spanGaps: true,
          yAxisID: 'yTemp',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 16 } },
        tooltip: { callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            if (v == null) return null;
            return ctx.dataset.yAxisID === 'yRain'
              ? `${ctx.dataset.label}: ${v} mm`
              : `${ctx.dataset.label}: ${v}°C`;
          }
        }}
      },
      scales: {
        yTemp: {
          type: 'linear', position: 'left',
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { callback: v => v + '°', font: { size: 11 } },
        },
        yRain: {
          type: 'linear', position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { callback: v => v + ' mm', font: { size: 11 } },
          min: 0,
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function drawClimateMonthly(data) {
  const table = document.getElementById('climateTable');
  if (!table) return;
  const months = data?.months || [];
  table.innerHTML = `
    <thead>
      <tr><th>Mês</th><th>Máx média</th><th>Mín média</th><th>Chuva</th></tr>
    </thead>
    <tbody>
      ${months.map(m => `
        <tr>
          <td>${m.name ?? "—"}</td>
          <td>${fmt(m.tmax, 1)}°</td>
          <td>${fmt(m.tmin, 1)}°</td>
          <td>${fmt(m.rain, 1)} mm</td>
        </tr>`).join("")}
    </tbody>`;
  renderClimateChart(months);
}



// --- Lógica Histórico Diário ---
let historyDailyChartObj = null;

document.getElementById('historyBtn')?.addEventListener('click', loadHistoryDaily);

async function loadHistoryRecords() {
  try {
    const res = await fetch(`${API_BASE}/history/records`);
    if (!res.ok) return;
    const data = await res.json();

    setText('#recHotV', fmt(data.hottest.v, 1));
    setText('#recHotD', data.hottest.d);

    setText('#recColdV', fmt(data.coldest.v, 1));
    setText('#recColdD', data.coldest.d);

    setText('#recRainV', fmt(data.rainiest.v, 1));
    setText('#recRainD', data.rainiest.d);

    setText('#recGustV', fmt(data.gustiest.v, 1));
    setText('#recGustD', data.gustiest.d);
  } catch (err) {
    console.error("Erro a carregar records", err);
  }
}

// ── ARQUIVO POR ANO ─────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_FULL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

async function loadYearCards() {
  const container = document.getElementById('yearCards');
  try {
    const res = await fetch(`${API_BASE}/history/years`);
    if (!res.ok) throw new Error(res.status);
    const years = await res.json();

    if (!years.length) {
      container.innerHTML = '<p style="color:var(--text-light);padding:16px 0">Sem dados históricos.</p>';
      return;
    }

    container.innerHTML = years.map(y => `
      <a href="#/historico/${y.year}" class="year-card soft-card">
        <div class="yc-year">${y.year}</div>
        <div class="yc-temps">
          <span class="yc-max">▲ ${y.temp_max != null ? y.temp_max + '°' : '—'}</span>
          <span class="yc-min">▼ ${y.temp_min != null ? y.temp_min + '°' : '—'}</span>
        </div>
        <div class="yc-rain">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><line x1="16" y1="13" x2="16" y2="21"/></svg>
          ${y.rain_total != null ? y.rain_total + ' mm' : '—'}
        </div>
        <div class="yc-meta">${y.months_with_data} ${y.months_with_data === 1 ? 'mês' : 'meses'} · ${y.days_with_data} dias</div>
      </a>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p style="color:var(--accent-rose);padding:16px 0">Erro ao carregar anos.</p>';
    console.error(err);
  }
}

let yearChartObj = null;

async function loadYearDetail(year) {
  const titleEl    = document.getElementById('yearDetailTitle');
  const summaryEl  = document.getElementById('yearSummaryCards');
  const monthsEl   = document.getElementById('monthCards');

  titleEl.textContent  = year;
  summaryEl.innerHTML  = '<div style="color:var(--text-light);padding:8px 0">A carregar…</div>';
  monthsEl.innerHTML   = '';

  try {
    const res = await fetch(`${API_BASE}/history/year/${year}`);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    const s = d.summary;

    // Resumo anual
    summaryEl.innerHTML = `
      <div class="soft-card metric-box" style="background:rgba(244,63,94,.05);border:1px solid rgba(244,63,94,.12)">
        <div class="mb-top"><span class="m-label" style="color:var(--accent-rose)">Máx. Absoluta</span></div>
        <div class="mb-value">${s.temp_max != null ? s.temp_max : '—'}<span class="m-unit">°C</span></div>
      </div>
      <div class="soft-card metric-box" style="background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.12)">
        <div class="mb-top"><span class="m-label" style="color:var(--accent-blue)">Mín. Absoluta</span></div>
        <div class="mb-value">${s.temp_min != null ? s.temp_min : '—'}<span class="m-unit">°C</span></div>
      </div>
      <div class="soft-card metric-box">
        <div class="mb-top"><span class="m-label">Temp. Média</span></div>
        <div class="mb-value">${s.temp_avg != null ? s.temp_avg : '—'}<span class="m-unit">°C</span></div>
      </div>
      <div class="soft-card metric-box" style="background:rgba(20,184,166,.05);border:1px solid rgba(20,184,166,.12)">
        <div class="mb-top"><span class="m-label" style="color:var(--accent-teal)">Precipitação Total</span></div>
        <div class="mb-value">${s.rain_total != null ? s.rain_total : '—'}<span class="m-unit">mm</span></div>
      </div>
      <div class="soft-card metric-box">
        <div class="mb-top"><span class="m-label">Rajada Máx.</span></div>
        <div class="mb-value">${s.gust_max != null ? s.gust_max : '—'}<span class="m-unit">km/h</span></div>
      </div>
    `;

    // Cards dos 12 meses
    monthsEl.innerHTML = d.months.map((m, i) => {
      if (!m) return `
        <div class="month-card month-card--empty">
          <div class="mc-name">${MONTH_FULL[i]}</div>
          <div class="mc-nodata">sem dados</div>
        </div>`;
      return `
        <div class="month-card soft-card">
          <div class="mc-name">${MONTH_FULL[i]}</div>
          <div class="mc-temps">
            <span class="mc-max">▲ ${m.temp_max != null ? m.temp_max + '°' : '—'}</span>
            <span class="mc-min">▼ ${m.temp_min != null ? m.temp_min + '°' : '—'}</span>
          </div>
          <div class="mc-avg">${m.temp_avg != null ? '⌀ ' + m.temp_avg + '°C' : ''}</div>
          <div class="mc-rain">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><line x1="16" y1="13" x2="16" y2="21"/></svg>
            ${m.rain_total != null ? m.rain_total + ' mm' : '—'}
          </div>
          <div class="mc-days">${m.days_with_data || '?'} dias</div>
        </div>`;
    }).join('');

    // Gráfico mensal
    await renderYearChart(d.months);

  } catch (err) {
    summaryEl.innerHTML = '<p style="color:var(--accent-rose)">Erro ao carregar dados do ano.</p>';
    console.error(err);
  }
}

async function renderYearChart(months) {
  const canvas = document.getElementById('yearChart');
  if (!canvas) return;
  await ensureChartJs();
  if (yearChartObj) { yearChartObj.destroy(); yearChartObj = null; }

  const labels   = MONTH_NAMES;
  const tempMax  = months.map(m => m?.temp_max  ?? null);
  const tempMin  = months.map(m => m?.temp_min  ?? null);
  const tempAvg  = months.map(m => m?.temp_avg  ?? null);
  const rain     = months.map(m => m?.rain_total ?? null);

  yearChartObj = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Precipitação (mm)',
          data: rain,
          backgroundColor: 'rgba(20,184,166,0.25)',
          borderColor: 'rgba(20,184,166,0.7)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'yRain',
          order: 2,
        },
        {
          type: 'line',
          label: 'Temp. Máx.',
          data: tempMax,
          borderColor: 'rgba(244,63,94,0.8)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'yTemp',
          order: 1,
        },
        {
          type: 'line',
          label: 'Temp. Mín.',
          data: tempMin,
          borderColor: 'rgba(59,130,246,0.8)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'yTemp',
          order: 1,
        },
        {
          type: 'line',
          label: 'Temp. Média',
          data: tempAvg,
          borderColor: 'rgba(100,116,139,0.7)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 2,
          tension: 0.3,
          yAxisID: 'yTemp',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 16 } },
        tooltip: { callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            if (v == null) return null;
            return ctx.dataset.yAxisID === 'yRain' ? `${ctx.dataset.label}: ${v} mm` : `${ctx.dataset.label}: ${v}°C`;
          }
        }}
      },
      scales: {
        yTemp: {
          type: 'linear', position: 'left',
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { callback: v => v + '°', font: { size: 11 } },
        },
        yRain: {
          type: 'linear', position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { callback: v => v + ' mm', font: { size: 11 } },
          min: 0,
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ── ANÁLISE DETALHADA ───────────────────────────────────────────

const ANALISE_PALETTE = [
  '#3b82f6','#f43f5e','#10b981','#f59e0b',
  '#8b5cf6','#06b6d4','#f97316','#84cc16',
  '#ec4899','#6366f1','#14b8a6','#ef4444',
];

let analiseChartObj  = null;
let analiseCumulObj  = null;

async function loadAnalise(type) {
  const isTemp  = type === 'temperatura';
  const titleEl = document.getElementById('analiseTitle');
  const ctEl    = document.getElementById('analiseChartTitle');
  const top10El = document.getElementById('analiseTop10');
  const cumulCard = document.getElementById('analiseCumulCard');

  titleEl.textContent = isTemp ? 'Temperatura' : 'Precipitação';
  ctEl.textContent    = isTemp
    ? 'Temperatura média mensal por ano'
    : 'Total mensal de precipitação por ano';
  top10El.innerHTML   = '<p style="color:var(--text-light);padding:8px 0">A carregar…</p>';
  if (cumulCard) cumulCard.style.display = 'none';

  const url = `${API_BASE}/history/analysis/${isTemp ? 'temperature' : 'precipitation'}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();

    await renderAnaliseChart(d, isTemp);
    if (!isTemp) await renderAnaliseCumul(d);
    renderAnaliseTop10(d, isTemp);
  } catch (err) {
    top10El.innerHTML = '<p style="color:var(--accent-rose)">Erro ao carregar análise.</p>';
    console.error(err);
  }
}

async function renderAnaliseChart(d, isTemp) {
  const canvas = document.getElementById('analiseChart');
  if (!canvas) return;
  await ensureChartJs();
  if (analiseChartObj) { analiseChartObj.destroy(); analiseChartObj = null; }

  const yearSet = [...new Set(d.by_year_month.map(r => r.year))].sort();
  const labels  = MONTH_NAMES;

  const datasets = yearSet.map((year, idx) => {
    const color = ANALISE_PALETTE[idx % ANALISE_PALETTE.length];
    const vals  = Array.from({ length: 12 }, (_, mi) => {
      const row = d.by_year_month.find(r => r.year === year && r.month === mi + 1);
      return row ? (isTemp ? row.avg_temp : row.total) : null;
    });
    return {
      type: 'line', label: String(year), data: vals,
      borderColor: color, backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
      tension: 0.3, spanGaps: true,
    };
  });

  const unit = isTemp ? '°C' : ' mm';
  analiseChartObj = new Chart(canvas, {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 12 } },
        tooltip: { callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            return v != null ? `${ctx.dataset.label}: ${v}${unit}` : null;
          }
        }}
      },
      scales: {
        y: {
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { callback: v => v + (isTemp ? '°' : ' mm'), font: { size: 11 } },
          min: isTemp ? undefined : 0,
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

async function renderAnaliseCumul(d) {
  const cumulCard = document.getElementById('analiseCumulCard');
  const canvas    = document.getElementById('analiseCumulChart');
  if (!cumulCard || !canvas) return;
  await ensureChartJs();
  if (analiseCumulObj) { analiseCumulObj.destroy(); analiseCumulObj = null; }
  cumulCard.style.display = 'block';

  const yearSet = [...new Set(d.by_year_month.map(r => r.year))].sort();

  const datasets = yearSet.map((year, idx) => {
    const color = ANALISE_PALETTE[idx % ANALISE_PALETTE.length];
    let cum = 0;
    const vals = Array.from({ length: 12 }, (_, mi) => {
      const row = d.by_year_month.find(r => r.year === year && r.month === mi + 1);
      if (row?.total != null) cum += row.total;
      // se não há dados para este mês e ano (ainda não chegou), retorna null
      // detecta se o mês ainda está no futuro para o ano corrente
      const now = new Date();
      const isFuture = year === now.getFullYear() && mi + 1 > now.getMonth() + 1;
      return isFuture ? null : +cum.toFixed(1);
    });
    return {
      label: String(year), data: vals,
      borderColor: color, backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
      tension: 0.2, spanGaps: false,
    };
  });

  analiseCumulObj = new Chart(canvas, {
    type: 'line',
    data: { labels: MONTH_NAMES, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 12 } },
        tooltip: { callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            return v != null ? `${ctx.dataset.label}: ${v} mm` : null;
          }
        }}
      },
      scales: {
        y: {
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { callback: v => v + ' mm', font: { size: 11 } },
          min: 0,
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function renderAnaliseTop10(d, isTemp) {
  const el = document.getElementById('analiseTop10');

  const makeTable = (title, rows, unit, accentClass) => {
    const trs = rows.map((r, i) => `
      <tr>
        <td class="top10-rank">${i + 1}</td>
        <td class="top10-date">${r.date}</td>
        <td class="top10-val ${accentClass}">${r.value != null ? r.value + unit : '—'}</td>
      </tr>`).join('');
    return `
      <div class="soft-card top10-card">
        <div class="card-header-clean" style="margin-bottom: 16px;">
          <h2 style="font-size: 1rem;">${title}</h2>
        </div>
        <table class="top10-table">
          <thead><tr><th>#</th><th>Data</th><th>Valor</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>`;
  };

  if (isTemp) {
    el.className = 'analise-top10-grid';
    el.innerHTML =
      makeTable('Top 10 — Dias mais quentes', d.top_hot,  '°C', 'is-hot') +
      makeTable('Top 10 — Dias mais frios',   d.top_cold, '°C', 'is-cold');
  } else {
    el.className = 'analise-top10-grid analise-top10-grid--3';
    const rateRows = (d.top_rate || []).map(r => {
      let label = r.date ?? '—';
      try {
        const dt = new Date(r.date);
        label = dt.toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      } catch(_) {}
      return { date: label, value: r.value };
    });
    el.innerHTML =
      makeTable('Top 10 — Dias mais chuvosos',    d.top_rain,  ' mm', 'is-teal') +
      makeTable('Top 10 — Anos mais chuvosos',    d.top_years.map(r => ({ date: String(r.year), value: r.total })), ' mm', 'is-teal') +
      makeTable('Top 10 — Intensidade de chuva',  rateRows, ' mm/h', 'is-teal');
  }
}

async function loadHistoryDaily() {
  const dateInput = document.getElementById('historyDateInput').value;
  if (!dateInput) return alert('Por favor, selecione uma data primeiro.');

  document.getElementById('historyLoading').style.display = 'block';
  document.getElementById('historyError').style.display = 'none';
  document.getElementById('historyContent').style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/history/daily?date=${dateInput}`);
    if (!res.ok) {
      document.getElementById('historyError').textContent = 'Nenhum dado encontrado para a data especificada.';
      document.getElementById('historyError').style.display = 'block';
      document.getElementById('historyLoading').style.display = 'none';
      return;
    }
    const data = await res.json();

    // Stats
    setText('#hTmax', fmt(data.stats.tmax, 1));
    setText('#hTmin', fmt(data.stats.tmin, 1));
    setText('#hTmean', fmt(data.stats.tmean, 1));
    setText('#hRain', fmt(data.stats.total_rain, 1));
    setText('#hGust', fmt(data.stats.max_gust, 1));

    await renderDailyHistoryChart(data.series);

    document.getElementById('historyLoading').style.display = 'none';
    document.getElementById('historyContent').style.display = 'flex';
  } catch (err) {
    document.getElementById('historyError').textContent = 'Erro ao carregar os dados.';
    document.getElementById('historyError').style.display = 'block';
    document.getElementById('historyLoading').style.display = 'none';
  }
}

async function renderDailyHistoryChart(series) {
  const canvas = document.getElementById('historyDailyChart');
  if (!canvas) return;
  await ensureChartJs();

  const labels = series.map(r => {
    const d = new Date(r.ts_local);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  const temps = series.map(r => r.temp_c);
  const rain = series.map(r => r.rain_rate_mmph);

  const ctx = canvas.getContext('2d');
  const gradientTemp = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradientTemp.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
  gradientTemp.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  if (historyDailyChartObj) historyDailyChartObj.destroy();
  historyDailyChartObj = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Temperatura (°C)',
          data: temps,
          yAxisID: 'yTemp',
          borderColor: '#10b981',
          backgroundColor: gradientTemp,
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          order: 1
        },
        {
          type: 'bar',
          label: 'Taxa Precipitação (mm/h)',
          data: rain,
          yAxisID: 'yRain',
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderRadius: 4,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { usePointStyle: true, font: { family: "'Plus Jakarta Sans', sans-serif" } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 24, font: { family: "'Plus Jakarta Sans', sans-serif" } } },
        yTemp: { position: 'left', title: { display: true, text: 'Temperatura (°C)', font: { family: "'Plus Jakarta Sans', sans-serif" } }, grid: { color: 'rgba(0,0,0,0.04)' } },
        yRain: { position: 'right', title: { display: true, text: 'Precipitação (mm/h)', font: { family: "'Plus Jakarta Sans', sans-serif" } }, min: 0 }
      }
    }
  });
}
