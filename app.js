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

/* Icons */
const ICON_PATHS = {
  "clear-day": "icons/clear-day.svg",
  "clear-night": "icons/clear-night.svg",
  "partly-cloudy-day": "icons/partly-cloudy-day.svg",
  "partly-cloudy-night": "icons/partly-cloudy-night.svg",
  cloudy: "icons/cloudy.svg",
  overcast: "icons/cloudy.svg",
  drizzle: "icons/drizzle.svg",
  rain: "icons/rain.svg",
  "heavy-rain": "icons/heavy-rain.svg",
  thunder: "icons/thunder.svg",
  snow: "icons/snow.svg",
  sleet: "icons/sleet.svg",
  "freezing-rain": "icons/freezing-rain.svg",
  fog: "icons/fog.svg",
  wind: "icons/wind.svg",
  unknown: "icons/cloudy.svg",
};
function iconUrl(name) {
  return ICON_PATHS[name] || ICON_PATHS["unknown"];
}

// --- Router super simples (não mexe em IDs/classes existentes)
const ROUTES = {
  "#/": "home",
  "#/historico": "historico",
  "#/clima": "clima",
  "": "home",
  "#": "home",
};

function applyRoute() {
  const key = (location.hash in ROUTES) ? location.hash : "#/";
  const view = ROUTES[key];

  // Mostra/esconde as sections
  document.querySelectorAll('#views > section[data-view]')
    .forEach(sec => { sec.hidden = (sec.dataset.view !== view); });

  // Ativa item do menu
  document.querySelectorAll('nav.main-nav [data-viewlink]')
    .forEach(a => a.classList.toggle('active', a.dataset.viewlink === view));

  // Lazy-load por vista
  if (view === "clima") {
    const table = document.getElementById('climateTable');
    if (table && !table.dataset.ready) {
      if (typeof window.loadClimateMonthly === 'function') {
        // Usa o teu loader se já existir
        Promise.resolve(window.loadClimateMonthly()).catch(console.error);
      } else {
        // Fallback suave: tenta um endpoint e, se não houver, mostra estado vazio
        fetch(`${API_BASE}/climate/monthly`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data) drawClimateMonthly(data);
            else table.innerHTML = '<tbody><tr><td>Sem dados do clima.</td></tr></tbody>';
          })
          .catch(() => (table.innerHTML = '<tbody><tr><td>Sem dados do clima.</td></tr></tbody>'));
      }
      table.dataset.ready = "1";
    }
  }
}

window.addEventListener('hashchange', applyRoute);
document.addEventListener('DOMContentLoaded', applyRoute);


/* Now icon state + priorities */
const NOW_ICON_PRIORITY = { default: 0, ipma: 50, metar: 100 };
const nowIconState = {
  priority: -1,
  name: "unknown",
  source: "none",
  setAt: 0,
};

function showView(name) {
  VIEWS.forEach(v => v.hidden = v.dataset.view !== name);
  LINKS.forEach(a => a.classList.toggle('active', a.dataset.viewlink === name));

  if (name === 'home') startHome();       // <— garante o carregamento da página “Agora”
  if (name === 'clima') buildClimateOnce(); // mantém o que já tens para “Clima”
}

function handleRoute() {
  const view = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
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

/* evita crash se ainda não implementaste o construtor de clima */
function buildClimateOnce(){ /* no-op se já estiveres a usar outra função */ }


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

// HISTÓRICO/GRÁFICO (globais)
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
function setSunTimes(date = new Date()) {
  if (typeof SunCalc === "undefined") {
    $("#sunrise").textContent = "—";
    $("#sunset").textContent = "—";
    return;
  }
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
    ul.innerHTML = "";

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

      const li = document.createElement("li");
      li.innerHTML = `
  <div class="d">${label}</div>
  <div class="ic">
    <img class="bm-ico bm-ico--sm" src="${iconUrl(
        iconName
      )}" alt="${iconName.replace(/-/g, " ")}" width="48" height="48">
  </div>
  <div class="t">
    <span class="hi">${tMax != null ? `${tMax}°` : "—"}</span>
    <span class="sep"> | </span>
    <span class="lo">${tMin != null ? `${tMin}°` : "—"}</span>
  </div>
`;
      ul.appendChild(li);

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

  if (j.rain_day_mm != null) setText("#rainToday", fmt(j.rain_day_mm, 1));

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

  // chuva 24h aprox. (10 min ≈ 1/6 h)
  const rain24 = rainRate.reduce((a, b) => a + (b ?? 0) / 6, 0);
  setText("#rain24", fmt(rain24, 1));

  const ctx = $("#histChart");
  if (!ctx) return;

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Temperatura (°C)",
          data: temps,
          yAxisID: "y1",
          borderColor: ACCENT,
          backgroundColor: "rgba(0,0,0,0)",
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0,
          spanGaps: true,
          hidden: allTempsNull,
        },
        {
          type: "bar",
          label: "Precipitação (mm/h)",
          data: rainRate,
          yAxisID: "y2",
          backgroundColor: ACCENT2,
          borderColor: ACCENT2,
          borderWidth: 1,
          maxBarThickness: 18,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 4, right: 8, bottom: 0, left: 4 } },
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: {
          grid: { color: "#00000014" },
          ticks: {
            maxRotation: 0,
            autoSkip: false,
            callback: function (value, index) {
              const d = labelDates[index];
              if (d.getMinutes() === 0 && d.getHours() % 2 === 0) {
                return d.toLocaleTimeString("pt-PT", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
              }
              return "";
            },
          },
        },
        y1: {
          position: "left",
          grid: { color: "#00000014" },
          min: 0,
          max: 43,
          ticks: { stepSize: 5 },
          title: { display: true, text: "Temperatura (ºC)" },
        },
        y2: {
          position: "right",
          grid: { display: false },
          beginAtZero: true,
          suggestedMax: 10,
          title: { display: true, text: "Precipitação (mm)" },
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
  renderClimateChart(months);
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

function renderClimateChart(months) {
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
    if (m.t != null) return toNum(m.t);
    if (m.tmax_mean != null && m.tmin_mean != null)
      return (toNum(m.tmax_mean) + toNum(m.tmin_mean)) / 2;
    if (m.tmax != null && m.tmin != null)
      return (toNum(m.tmax) + toNum(m.tmin)) / 2;
    return null;
  });
  const tMax = byM.map((m) => toNum(m.abs_max ?? m.tmax));
  const tMin = byM.map((m) => toNum(m.abs_min ?? m.tmin));

  const rain = byM.map((m) => toNum(m.precip_mean_mm ?? m.rain));

  if (climateChart) climateChart.destroy();
  climateChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Precipitação (mm)',
          data: rain,
          yAxisID: 'yRain',
          backgroundColor: ACCENT2,
          borderColor: ACCENT2,
         order: 0,

        },
        {
          type: 'line',
          label: 'Temperatura média',
          data: tMean,
          yAxisID: 'yTemp',
          borderColor: ACCENT,
          backgroundColor: 'rgba(0,0,0,0)',
          tension: 0.25,
          spanGaps: true,
          order: 1,
        },
        {
          type: 'line',
          label: 'Máximo absoluto',

          data: tMax,
          yAxisID: 'yTemp',
          borderColor: '#ef4444',
          backgroundColor: 'rgba(0,0,0,0)',
          tension: 0.25,
          spanGaps: true,
          order: 1,
        },
        {
          type: 'line',
          label: 'Mínimo absoluto',

          data: tMin,
          yAxisID: 'yTemp',
          borderColor: '#2563eb',
          backgroundColor: 'rgba(0,0,0,0)',
          tension: 0.25,
          spanGaps: true,
          order: 1,

        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        yTemp: {
          position: 'left',
          title: { display: true, text: 'Temperatura (°C)' },
        },
        yRain: {
          position: 'right',
          title: { display: true, text: 'Precipitação (mm)' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

function drawClimateMonthly(data){
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


/* Boot */
async function boot() {
  try {
    await loadLive(); // garante #sunrise / #sunset
    await loadMetarTGFTP(); // usa METAR (observado) para o ícone atual
    await loadForecast(); // agora já há horas reais para o ícone
    await loadHistory(); // gráfico pode vir por fim
    setInterval(() => {
      loadLive().catch(console.error);
    }, PUSH_MS);
  } catch (err) {
    console.error(err);
  }
}

(function markActiveNav() {
  const path = location.pathname.replace(/\/+$/, "");
  const map = { "": "home", "/": "home", "/historico.html": "historico", "/clima.html": "clima" };
  const route =
    map[path] ||
    (location.hash.includes("historico") ? "historico" :
      location.hash.includes("clima") ? "clima" : "home");

  document.querySelectorAll(".main-nav a").forEach(a => {
    if (a.dataset.route === route) a.classList.add("active");
  });
})();

boot().catch(console.error);
