/* app-views.js — Carregado lazily quando o utilizador acede a Histórico ou Clima */
/* API_BASE, CLIMATE_URL, fmt, setText, ensureChartJs vêm do scope global de app.js */

/* Chart objects (exclusivos das views) */
let climateChart         = null;
let yearChartObj         = null;
let analiseChartObj      = null;
let analiseCumulObj      = null;
let historyDailyChartObj = null;

/* Constantes de meses, paleta e normais */
const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_FULL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const ANALISE_PALETTE = [
  '#3b82f6','#f43f5e','#10b981','#f59e0b',
  '#8b5cf6','#06b6d4','#f97316','#84cc16',
  '#ec4899','#6366f1','#14b8a6','#ef4444',
];

const NORMALS_RAIN = [112.6, 81.7, 74.1, 83.2, 61.8, 18.8, 7.5, 12.7, 38.1, 102.5, 127.8, 104.4];
const NORMALS_TEMP = [9.7, 10.4, 12.7, 14.0, 16.3, 18.9, 20.5, 20.9, 19.4, 16.7, 12.5, 10.6];
const NORMALS_TMAX = [15.3, 16.3, 18.5, 19.7, 22.1, 24.6, 26.1, 27.0, 25.9, 22.9, 18.2, 16.1];
const NORMAL_LINE  = { borderColor: 'rgba(100,116,139,0.55)', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4, tension: 0.3, spanGaps: false };

/* Event listener do arquivo diário (agora que loadHistoryDaily está definida) */
document.getElementById('historyBtn')?.addEventListener('click', loadHistoryDaily);

// ── CLIMA MENSAL ─────────────────────────────────────────────────

async function loadClimateMonthly() {
  const r = await fetch(CLIMATE_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`climate ${r.status}`);
  const j = await r.json();
  const months = j.months || j.data || [];
  renderClimateTable(months);
  await renderClimateChart(months);
}

function renderClimateTable(months) {
  const byM = Array.from({ length: 12 }, (_, i) => months.find(x => +x.month === i + 1) || { month: i + 1 });
  const mNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const rows = [
    { label: 'Temperatura — média', key: 't_mean', unit: '°C', dec: 1 },
    { label: 'Média máx', key: 'tmax_mean', unit: '°C', dec: 1, hot: true },
    { label: 'Média min', key: 'tmin_mean', unit: '°C', dec: 1, cold: true },
    { label: 'Dias com geada (min<0°)', key: 'frost_days', dec: 1 },
    { label: 'Dias de verão (máx>25°)', key: 'summer_days', dec: 1 },
    { label: 'Dias tropicais (máx>30°)', key: 'tropical_days', dec: 1 },
    { label: 'Noites tropicais (min≥20°)', key: 'tropical_nights', dec: 1 },
    { label: 'Média precipitação (mm)', key: 'precip_mean_mm', unit: ' mm', dec: 1 },
    { label: 'Máximo absoluto', key: 'abs_max', unit: '°C', dec: 1, hot: true, dateKey: 'abs_max_date' },
    { label: 'Mínimo absoluto', key: 'abs_min', unit: '°C', dec: 1, cold: true, dateKey: 'abs_min_date' },
  ];

  const tbl = document.getElementById('climateTable');
  if (!tbl) return;

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.innerHTML = `<th>Mês</th>${mNames.map(n => `<th>${n}</th>`).join('')}`;
  thead.appendChild(hr);

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
      if (row.dateKey && m[row.dateKey]) {
        const dt = new Date(m[row.dateKey]);
        td.title = isNaN(dt) ? String(m[row.dateKey]) :
          dt.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
      if (row.hot)  td.classList.add('is-hot');
      if (row.cold) td.classList.add('is-cold');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  tbl.replaceChildren(thead, tbody);
}

async function renderClimateChart(months) {
  const canvas = document.getElementById('climateChart');
  if (!canvas) return;

  const withMonths = months.map((m, i) => ({ month: m.month ?? i + 1, ...m }));
  const byM = Array.from({ length: 12 }, (_, i) => withMonths.find((x) => +x.month === i + 1) || {});
  const labels = MONTH_NAMES;
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
          type: 'bar', label: 'Precipitação média (mm)', data: rain,
          backgroundColor: 'rgba(20,184,166,0.25)', borderColor: 'rgba(20,184,166,0.7)',
          borderWidth: 1, borderRadius: 4, yAxisID: 'yRain', order: 3,
        },
        {
          type: 'bar', label: 'Normal prec. (mm)', data: NORMALS_RAIN,
          backgroundColor: 'rgba(15,23,42,0.35)', borderColor: 'rgba(15,23,42,0.0)',
          borderWidth: 0, borderRadius: 3, yAxisID: 'yRain', order: 2,
          grouped: false, barPercentage: 0.38, categoryPercentage: 0.8,
        },
        {
          type: 'line', label: 'Máx. absoluta', data: tMax,
          borderColor: 'rgba(244,63,94,0.8)', backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true, yAxisID: 'yTemp', order: 1,
        },
        {
          type: 'line', label: 'Mín. absoluta', data: tMin,
          borderColor: 'rgba(59,130,246,0.8)', backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true, yAxisID: 'yTemp', order: 1,
        },
        {
          type: 'line', label: 'Temp. média', data: tMean,
          borderColor: 'rgba(15,23,42,0.70)', backgroundColor: 'transparent',
          borderWidth: 2, borderDash: [4, 4], pointRadius: 2, tension: 0.3, spanGaps: true, yAxisID: 'yTemp', order: 1,
        },
        {
          type: 'line', label: 'Normal temp. (°C)', data: NORMALS_TEMP,
          ...NORMAL_LINE, yAxisID: 'yTemp', order: 0,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
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
        yTemp: { type: 'linear', position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => v + '°', font: { size: 11 } } },
        yRain: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => v + ' mm', font: { size: 11 } }, min: 0 },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ── RECORDES ABSOLUTOS ───────────────────────────────────────────

async function loadHistoryRecords() {
  try {
    const res = await fetch(`${API_BASE}/history/records`);
    if (!res.ok) return;
    const data = await res.json();
    setText('#recHotV',  fmt(data.hottest.v,  1));
    setText('#recHotD',  data.hottest.d);
    setText('#recColdV', fmt(data.coldest.v,  1));
    setText('#recColdD', data.coldest.d);
    setText('#recRainV', fmt(data.rainiest.v, 1));
    setText('#recRainD', data.rainiest.d);
    setText('#recGustV', fmt(data.gustiest.v, 1));
    setText('#recGustD', data.gustiest.d);
  } catch (err) {
    console.error("Erro a carregar records", err);
  }
}

// ── ARQUIVO POR ANO ──────────────────────────────────────────────

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

async function loadYearDetail(year) {
  const titleEl   = document.getElementById('yearDetailTitle');
  const summaryEl = document.getElementById('yearSummaryCards');
  const monthsEl  = document.getElementById('monthCards');

  titleEl.textContent = year;
  summaryEl.innerHTML = '<div style="color:var(--text-light);padding:8px 0">A carregar…</div>';
  monthsEl.innerHTML  = '';

  try {
    const res = await fetch(`${API_BASE}/history/year/${year}`);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    const s = d.summary;

    const fmtRecDate = iso => iso
      ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })
      : null;
    const recDateEl = iso => { const t = fmtRecDate(iso); return t ? `<div class="rec-date">${t}</div>` : ''; };

    summaryEl.innerHTML = `
      <div class="soft-card metric-box" style="background:rgba(244,63,94,.05);border:1px solid rgba(244,63,94,.12)">
        <div class="mb-top"><span class="m-label" style="color:var(--accent-rose)">Máx. Absoluta</span></div>
        <div class="mb-value">${s.temp_max != null ? s.temp_max : '—'}<span class="m-unit">°C</span></div>
        ${recDateEl(s.temp_max_date)}
      </div>
      <div class="soft-card metric-box" style="background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.12)">
        <div class="mb-top"><span class="m-label" style="color:var(--accent-blue)">Mín. Absoluta</span></div>
        <div class="mb-value">${s.temp_min != null ? s.temp_min : '—'}<span class="m-unit">°C</span></div>
        ${recDateEl(s.temp_min_date)}
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
        ${recDateEl(s.gust_max_date)}
      </div>
    `;

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
        </div>`;
    }).join('');

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

  const labels  = MONTH_NAMES;
  const tempMax = months.map(m => m?.temp_max  ?? null);
  const tempMin = months.map(m => m?.temp_min  ?? null);
  const tempAvg = months.map(m => m?.temp_avg  ?? null);
  const rain    = months.map(m => m?.rain_total ?? null);

  yearChartObj = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: 'Precipitação (mm)', data: rain,
          backgroundColor: 'rgba(20,184,166,0.25)', borderColor: 'rgba(20,184,166,0.7)',
          borderWidth: 1, borderRadius: 4, yAxisID: 'yRain', order: 2,
        },
        {
          type: 'line', label: 'Temp. Máx.', data: tempMax,
          borderColor: 'rgba(244,63,94,0.8)', backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 3, tension: 0.3, yAxisID: 'yTemp', order: 1,
        },
        {
          type: 'line', label: 'Temp. Mín.', data: tempMin,
          borderColor: 'rgba(59,130,246,0.8)', backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 3, tension: 0.3, yAxisID: 'yTemp', order: 1,
        },
        {
          type: 'line', label: 'Temp. Média', data: tempAvg,
          borderColor: 'rgba(15,23,42,0.70)', backgroundColor: 'transparent',
          borderWidth: 2, borderDash: [4, 4], pointRadius: 2, tension: 0.3, yAxisID: 'yTemp', order: 1,
        },
        { type: 'line', label: 'Normal Temp.', data: NORMALS_TEMP, ...NORMAL_LINE, yAxisID: 'yTemp', order: 0 },
        {
          type: 'bar', label: 'Normal Prec. (mm)', data: NORMALS_RAIN,
          backgroundColor: 'rgba(15,23,42,0.35)', borderColor: 'rgba(15,23,42,0.0)',
          borderWidth: 0, borderRadius: 3, yAxisID: 'yRain', order: 1,
          grouped: false, barPercentage: 0.38, categoryPercentage: 0.8,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
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
        yTemp: { type: 'linear', position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => v + '°', font: { size: 11 } } },
        yRain: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: v => v + ' mm', font: { size: 11 } }, min: 0 },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ── ANÁLISE DETALHADA ────────────────────────────────────────────

async function loadAnalise(type) {
  const isTemp    = type === 'temperatura';
  const titleEl   = document.getElementById('analiseTitle');
  const ctEl      = document.getElementById('analiseChartTitle');
  const top10El   = document.getElementById('analiseTop10');
  const cumulCard = document.getElementById('analiseCumulCard');

  titleEl.textContent = isTemp ? 'Temperatura' : 'Precipitação';
  ctEl.textContent    = isTemp ? 'Temperatura média mensal por ano' : 'Total mensal de precipitação por ano';
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
    if (isTemp) {
      return {
        type: 'line', label: String(year), data: vals,
        borderColor: color, backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, spanGaps: true,
      };
    } else {
      return {
        type: 'bar', label: String(year), data: vals,
        backgroundColor: color + 'bb', borderColor: color,
        borderWidth: 1, borderRadius: 2, maxBarThickness: 7, order: 1,
      };
    }
  });

  if (!isTemp) {
    datasets.unshift({
      type: 'bar', label: 'Normal', data: NORMALS_RAIN,
      backgroundColor: 'rgba(20,184,166,0.12)', borderColor: 'rgba(20,184,166,0.45)',
      borderWidth: 1, borderRadius: 4,
      grouped: false, barPercentage: 1.0, categoryPercentage: 0.95, order: 2,
    });
  } else {
    datasets.push({ type: 'line', label: 'Normal', data: NORMALS_TEMP, ...NORMAL_LINE });
  }

  const unit = isTemp ? '°C' : ' mm';
  analiseChartObj = new Chart(canvas, {
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 12 } },
        tooltip: { callbacks: { label: ctx => { const v = ctx.parsed.y; return v != null ? `${ctx.dataset.label}: ${v}${unit}` : null; } } }
      },
      scales: {
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => v + (isTemp ? '°' : ' mm'), font: { size: 11 } }, min: isTemp ? undefined : 0 },
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
      const now = new Date();
      const isFuture = year === now.getFullYear() && mi + 1 > now.getMonth() + 1;
      return isFuture ? null : +cum.toFixed(1);
    });
    return {
      label: String(year), data: vals,
      borderColor: color, backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.2, spanGaps: false,
    };
  });

  let cumulNormal = 0;
  const normalCumulData = NORMALS_RAIN.map(v => +(cumulNormal += v).toFixed(1));
  datasets.push({ label: 'Normal acum.', data: normalCumulData, ...NORMAL_LINE });

  analiseCumulObj = new Chart(canvas, {
    type: 'line',
    data: { labels: MONTH_NAMES, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 12 } },
        tooltip: { callbacks: { label: ctx => { const v = ctx.parsed.y; return v != null ? `${ctx.dataset.label}: ${v} mm` : null; } } }
      },
      scales: {
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => v + ' mm', font: { size: 11 } }, min: 0 },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function renderAnaliseTop10(d, isTemp) {
  const el = document.getElementById('analiseTop10');

  const makeTable = (title, rows, unit, accentClass, cardClass = '') => {
    const trs = rows.map((r, i) => `
      <tr>
        <td class="top10-rank">${i + 1}</td>
        <td class="top10-date">${r.date}</td>
        <td class="top10-val ${accentClass}">${r.value != null ? r.value + unit : '—'}</td>
      </tr>`).join('');
    return `
      <div class="soft-card top10-card${cardClass ? ' ' + cardClass : ''}">
        <div class="card-header-clean" style="margin-bottom: 16px;">
          <h2 style="font-size: 1rem;">${title}</h2>
        </div>
        <table class="top10-table">
          <thead><tr><th>#</th><th>Data</th><th>Valor</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>`;
  };

  // Formata "YYYY-MM-DD" → "DD/MM/YYYY"
  const fmtD = s => s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : '—';
  // Formata período de streak
  const fmtStreak = s => s.start === s.end ? fmtD(s.start) : `${fmtD(s.start)} – ${fmtD(s.end)}`;

  if (isTemp) {
    el.className = 'analise-top10-grid';

    const heatRows = (d.heat_waves || []).map(w => ({
      date:  fmtStreak(w),
      value: w.peak_tmax != null ? `${w.days} d · pico ${w.peak_tmax}°C` : `${w.days} d`,
    }));

    // Subtítulo com as normais de Tmax usadas como referência
    const MABBR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const normalsNote = `<p class="heat-normals-note">Normais de Tmax (referência +5°C): ${
      NORMALS_TMAX.map((v, i) => `${MABBR[i]} ${v}°`).join(' · ')
    }</p>`;

    el.innerHTML =
      makeTable('Top 10 — Temperaturas máximas', d.top_max,       '°C', 'is-hot')  +
      makeTable('Top 10 — Dias mais quentes',    d.top_warm_days, '°C', 'is-hot')  +
      makeTable('Ondas de calor — Tmax &gt; normal +5 °C', heatRows, '', 'is-hot', 'top10-card--span') +
      makeTable('Top 10 — Temperaturas mínimas', d.top_min,       '°C', 'is-cold') +
      makeTable('Top 10 — Dias mais frios',      d.top_cold_days, '°C', 'is-cold') +
      normalsNote;
  } else {
    el.className = 'analise-top10-grid';

    const rateRows = (d.top_rate || []).map(r => {
      let label = r.date ?? '—';
      try {
        const dt = new Date(r.date);
        label = dt.toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      } catch(_) {}
      return { date: label, value: r.value };
    });
    const monthRows = (d.top_months || []).map(r => ({
      date: `${MONTH_FULL[r.month - 1]} ${r.year}`,
      value: r.total,
    }));
    const dryRows = (d.dry_streaks || []).map(s => ({
      date:  fmtStreak(s),
      value: `${s.days} dias`,
    }));
    const wetRows = (d.wet_streaks || []).map(s => ({
      date:  fmtStreak(s),
      value: s.total_mm != null ? `${s.days} dias · ${s.total_mm} mm` : `${s.days} dias`,
    }));

    el.innerHTML =
      makeTable('Top 10 — Dias mais chuvosos',       d.top_rain,  ' mm',   'is-teal') +
      makeTable('Top 10 — Meses mais chuvosos',      monthRows,   ' mm',   'is-teal') +
      makeTable('Top 10 — Anos mais chuvosos',       d.top_years.map(r => ({ date: String(r.year), value: r.total })), ' mm', 'is-teal') +
      makeTable('Top 10 — Intensidade de chuva',     rateRows,    ' mm/h', 'is-teal') +
      makeTable('Períodos de seca (dias sem chuva)',  dryRows,     '',      'is-orange') +
      makeTable('Sequências chuvosas (dias seguidos)', wetRows,    '',      'is-teal');
  }
}

// ── ARQUIVO DIÁRIO ───────────────────────────────────────────────

async function loadHistoryDaily() {
  const dateInput = document.getElementById('historyDateInput').value;
  if (!dateInput) return alert('Por favor, selecione uma data primeiro.');

  document.getElementById('historyLoading').style.display = 'block';
  document.getElementById('historyError').style.display   = 'none';
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

    setText('#hTmax',  fmt(data.stats.tmax,       1));
    setText('#hTmin',  fmt(data.stats.tmin,       1));
    setText('#hTmean', fmt(data.stats.tmean,      1));
    setText('#hRain',  fmt(data.stats.total_rain, 1));
    setText('#hGust',  fmt(data.stats.max_gust,   1));

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
  const rain  = series.map(r => r.rain_rate_mmph);

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
          type: 'line', label: 'Temperatura (°C)', data: temps,
          yAxisID: 'yTemp', borderColor: '#10b981', backgroundColor: gradientTemp,
          borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, order: 1,
        },
        {
          type: 'bar', label: 'Precipitação (mm/h)', data: rain,
          yAxisID: 'yRain', backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4, order: 2,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14, padding: 12 } },
      },
      scales: {
        x:     { grid: { display: false }, ticks: { maxTicksLimit: 24, font: { size: 11 } } },
        yTemp: { position: 'left',  grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => v + '°',    font: { size: 11 } } },
        yRain: { position: 'right', grid: { drawOnChartArea: false },     ticks: { callback: v => v + ' mm',  font: { size: 11 } }, min: 0 },
      },
    },
  });
}
