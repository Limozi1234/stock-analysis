const tickerInput = document.getElementById("tickerInput");
const searchBtn = document.getElementById("searchBtn");
const compareBtn = document.getElementById("compareBtn");
const statusEl = document.getElementById("status");
const statsSection = document.getElementById("statsSection");
const statName = document.getElementById("statName");
const statAnnualReturns = document.getElementById("statAnnualReturns");
const statCAGR = document.getElementById("statCAGR");
const statPE = document.getElementById("statPE");
const statRSI = document.getElementById("statRSI");
const statDivYield = document.getElementById("statDivYield");
const stat52Pos = document.getElementById("stat52Pos");
const statSocial = document.getElementById("statSocial");
const statStdDev = document.getElementById("statStdDev");
const statBeta = document.getElementById("statBeta");
const statMaxDD = document.getElementById("statMaxDD");
const statSharpe = document.getElementById("statSharpe");
const statPrice = document.getElementById("statPrice");
const statChange = document.getElementById("statChange");
const statYTD = document.getElementById("statYTD");
const stat52High = document.getElementById("stat52High");
const stat52Low = document.getElementById("stat52Low");
const statVolume = document.getElementById("statVolume");
const smaToggle = document.getElementById("smaToggle");
const sma200Toggle = document.getElementById("sma200Toggle");
const compareList = document.getElementById("compareList");

let priceChart = null;
let compareChart = null;
let currentSeries = null;
let spySeriesCache = null;
const compareSeries = new Map();

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#f87171" : "#94a3b8";
}

async function fetchSeries(symbol) {
  const res = await fetch(`/api/chart/${symbol}`);
  if (!res.ok) throw new Error(`Network error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] != null && closes[i - 1] != null && closes[i - 1] !== 0)
      r.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return r;
}

function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function computeBeta(stockReturns, benchReturns) {
  const n = Math.min(stockReturns.length, benchReturns.length);
  const s = stockReturns.slice(-n), b = benchReturns.slice(-n);
  const ms = mean(s), mb = mean(b);
  let cov = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (s[i] - ms) * (b[i] - mb);
    varB += (b[i] - mb) ** 2;
  }
  return varB === 0 ? null : cov / varB;
}

function computeMaxDrawdown(closes) {
  let peak = -Infinity, maxDD = 0;
  for (const c of closes) {
    if (c == null) continue;
    if (c > peak) peak = c;
    const dd = (peak - c) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeSharpe(returns, riskFreeAnnual = 0.05) {
  const rfDaily = riskFreeAnnual / 252;
  const excess = returns.map((r) => r - rfDaily);
  const s = stddev(excess);
  return s === 0 ? null : (mean(excess) / s) * Math.sqrt(252);
}

function computeRSI(closes, period = 14) {
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] == null || closes[i - 1] == null) continue;
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  if (gains.length < period) return null;
  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}


function computeSMA(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0, count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] != null) { sum += values[j]; count++; }
    }
    result[i] = count === period ? sum / period : null;
  }
  return result;
}

function renderStats(series, spySeries) {
  const { dates, closes, volumes, meta } = series;
  const validCloses = closes.filter((c) => c != null);
  const last = validCloses[validCloses.length - 1];
  const prev = validCloses[validCloses.length - 2];
  const change = last - prev;
  const changePct = (change / prev) * 100;

  // YTD: find first close on or after Jan 1 of current year
  const currentYear = new Date().getFullYear();
  const ytdIdx = dates.findIndex((d) => d >= `${currentYear}-01-01`);
  let ytdHtml = "--";
  if (ytdIdx !== -1 && closes[ytdIdx] != null) {
    const ytdBase = closes[ytdIdx];
    const ytdReturn = ((last - ytdBase) / ytdBase) * 100;
    const sign = ytdReturn >= 0 ? "+" : "";
    const cls = ytdReturn >= 0 ? "positive" : "negative";
    ytdHtml = `<span class="${cls}">${sign}${ytdReturn.toFixed(2)}%</span>`;
  }

  // 3-year annual returns
  const years = [currentYear - 3, currentYear - 2, currentYear - 1];
  const annualReturns = years.map((yr) => {
    const startIdx = dates.findIndex((d) => d >= `${yr}-01-01`);
    const endIdx = dates.reduce((best, d, i) => (d <= `${yr}-12-31` ? i : best), -1);
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return { yr, pct: null };
    const startClose = closes[startIdx];
    const endClose = closes[endIdx];
    if (!startClose || !endClose) return { yr, pct: null };
    return { yr, pct: ((endClose - startClose) / startClose) * 100 };
  }).filter((r) => r.pct !== null);

  let annualHtml = "--";
  if (annualReturns.length > 0) {
    const avg = annualReturns.reduce((s, r) => s + r.pct, 0) / annualReturns.length;
    const rows = annualReturns.map(({ yr, pct }) => {
      const cls = pct >= 0 ? "positive" : "negative";
      return `<span class="ar-row"><span class="ar-year">${yr}</span><span class="value ${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span></span>`;
    });
    const avgCls = avg >= 0 ? "positive" : "negative";
    rows.push(`<span class="ar-row ar-avg"><span class="ar-year">Avg</span><span class="value ${avgCls}">${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%</span></span>`);
    annualHtml = rows.join("");
  }
  statAnnualReturns.innerHTML = annualHtml;

  // Risk metrics — last 252 trading days
  const window252 = closes.slice(-252).filter((c) => c != null);
  const stockRet = dailyReturns(window252);

  // CAGR over last 3 years
  const currentYear3 = new Date().getFullYear();
  const cagrStartIdx = dates.findIndex((d) => d >= `${currentYear3 - 3}-01-01`);
  if (cagrStartIdx !== -1 && closes[cagrStartIdx] != null) {
    const cagrStart = closes[cagrStartIdx];
    const cagrEnd = last;
    const cagrYears = (new Date(dates[dates.length - 1]) - new Date(dates[cagrStartIdx])) / (365.25 * 24 * 3600 * 1000);
    const cagr = (Math.pow(cagrEnd / cagrStart, 1 / cagrYears) - 1) * 100;
    statCAGR.textContent = `${cagr >= 0 ? "+" : ""}${cagr.toFixed(2)}%`;
    statCAGR.className = "value " + (cagr >= 0 ? "positive" : "negative");
  } else {
    statCAGR.textContent = "--";
  }

  const annualizedStdDev = stddev(stockRet) * Math.sqrt(252) * 100;
  statStdDev.textContent = `${annualizedStdDev.toFixed(2)}%`;

  const maxDD = computeMaxDrawdown(window252);
  statMaxDD.textContent = `-${(maxDD * 100).toFixed(2)}%`;
  statMaxDD.className = "value negative";

  const sharpe = computeSharpe(stockRet);
  statSharpe.textContent = sharpe != null ? sharpe.toFixed(2) : "--";
  statSharpe.className = "value " + (sharpe != null ? (sharpe >= 1 ? "positive" : sharpe < 0 ? "negative" : "") : "");

  if (spySeries) {
    const spyWindow = spySeries.closes.slice(-252).filter((c) => c != null);
    const spyRet = dailyReturns(spyWindow);
    const beta = computeBeta(stockRet, spyRet);
    statBeta.textContent = beta != null ? beta.toFixed(2) : "--";
    statBeta.className = "value " + (beta != null ? (beta > 1.2 ? "negative" : beta < 0.8 ? "positive" : "") : "");
  } else {
    statBeta.textContent = "--";
  }

  statName.textContent = meta.longName || meta.shortName || "";
  statPrice.textContent = `$${last.toFixed(2)}`;
  statChange.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${changePct.toFixed(2)}%)`;
  statChange.className = "value " + (change >= 0 ? "positive" : "negative");
  statYTD.innerHTML = ytdHtml;
  stat52High.textContent = `$${(meta.fiftyTwoWeekHigh ?? Math.max(...validCloses)).toFixed(2)}`;
  stat52Low.textContent = `$${(meta.fiftyTwoWeekLow ?? Math.min(...validCloses)).toFixed(2)}`;

  const lastVol = volumes[volumes.length - 1];
  statVolume.textContent = lastVol ? lastVol.toLocaleString() : "--";

  // RSI (14-day)
  const rsi = computeRSI(closes.slice(-50));
  if (rsi != null) {
    statRSI.textContent = rsi.toFixed(1);
    statRSI.className = "value " + (rsi >= 70 ? "negative" : rsi <= 30 ? "positive" : "");
  } else {
    statRSI.textContent = "--";
  }

  // 52-Week Position
  const window52 = closes.slice(-252).filter((c) => c != null);
  const high52 = Math.max(...window52);
  const low52 = Math.min(...window52);
  const pos52 = ((last - low52) / (high52 - low52)) * 100;
  stat52Pos.textContent = `${pos52.toFixed(1)}%`;
  stat52Pos.className = "value " + (pos52 >= 75 ? "positive" : pos52 <= 25 ? "negative" : "");

  // P/E and Dividend Yield from meta (bundled via yfinance)
  const pe = meta.trailingPE;
  statPE.textContent = pe != null ? parseFloat(pe).toFixed(1) : "N/A";
  statPE.className = "value";

  const divYield = meta.dividendYield;
  statDivYield.textContent = divYield != null ? `${(divYield * 100).toFixed(2)}%` : "N/A";
  statDivYield.className = "value " + (divYield > 0 ? "positive" : "");

  statsSection.hidden = false;
}

function renderPriceChart(symbol, series) {
  const { dates, closes } = series;
  const sliceStart = Math.max(0, dates.length - 300);
  const labels = dates.slice(sliceStart);
  const data = closes.slice(sliceStart);

  const datasets = [
    {
      label: `${symbol} Close`,
      data,
      borderColor: "#38bdf8",
      backgroundColor: "rgba(56,189,248,0.05)",
      fill: true,
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.1,
    },
  ];

  if (smaToggle.checked) {
    const sma50 = computeSMA(closes, 50).slice(sliceStart);
    datasets.push({
      label: "SMA 50",
      data: sma50,
      borderColor: "#fbbf24",
      backgroundColor: "transparent",
      pointRadius: 0,
      borderWidth: 1.5,
      tension: 0.1,
    });
  }

  if (sma200Toggle.checked) {
    const sma200 = computeSMA(closes, 200).slice(sliceStart);
    datasets.push({
      label: "SMA 200",
      data: sma200,
      borderColor: "#a78bfa",
      backgroundColor: "transparent",
      pointRadius: 0,
      borderWidth: 1.5,
      tension: 0.1,
    });
  }

  if (priceChart) priceChart.destroy();
  priceChart = new Chart(document.getElementById("priceChart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 10 }, grid: { color: "#334155" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
      },
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
    },
  });
}

function renderCompareChart() {
  if (compareSeries.size === 0) {
    if (compareChart) { compareChart.destroy(); compareChart = null; }
    return;
  }
  const colors = ["#38bdf8", "#fbbf24", "#a78bfa", "#4ade80", "#f87171", "#f472b6"];
  let colorIdx = 0;
  const datasets = [];
  let labels = [];

  for (const [symbol, series] of compareSeries.entries()) {
    const sliceStart = Math.max(0, series.dates.length - 300);
    const dates = series.dates.slice(sliceStart);
    const closes = series.closes.slice(sliceStart);
    if (dates.length > labels.length) labels = dates;

    const base = closes.find((c) => c != null);
    const normalized = closes.map((c) => (c != null && base ? ((c - base) / base) * 100 : null));

    datasets.push({
      label: symbol,
      data: normalized,
      borderColor: colors[colorIdx % colors.length],
      backgroundColor: "transparent",
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.1,
    });
    colorIdx++;
  }

  if (compareChart) compareChart.destroy();
  compareChart = new Chart(document.getElementById("compareChart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 10 }, grid: { color: "#334155" } },
        y: {
          ticks: { color: "#94a3b8", callback: (v) => `${v.toFixed(1)}%` },
          grid: { color: "#334155" },
        },
      },
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
    },
  });
}

function renderCompareChips() {
  compareList.innerHTML = "";
  for (const symbol of compareSeries.keys()) {
    const chip = document.createElement("div");
    chip.className = "compare-chip";
    chip.innerHTML = `<span>${symbol}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      compareSeries.delete(symbol);
      renderCompareChips();
      renderCompareChart();
    });
    chip.appendChild(removeBtn);
    compareList.appendChild(chip);
  }
}

async function fetchSocial(symbol) {
  const res = await fetch(`/api/social/${symbol}`);
  if (!res.ok) throw new Error(`Social fetch failed: ${res.status}`);
  return res.json();
}

function renderSocial(data) {
  const messages = data?.messages ?? [];
  if (messages.length === 0) {
    statSocial.innerHTML = "<span style='color:var(--muted)'>No recent activity</span>";
    return;
  }
  let bullish = 0, bearish = 0, neutral = 0;
  for (const m of messages) {
    const s = m?.entities?.sentiment?.basic;
    if (s === "Bullish") bullish++;
    else if (s === "Bearish") bearish++;
    else neutral++;
  }
  const total = bullish + bearish + neutral;
  const bullPct = Math.round((bullish / total) * 100);
  const bearPct = Math.round((bearish / total) * 100);

  statSocial.innerHTML = `
    <div class="social-row">
      <span class="social-count">${total} recent messages</span>
    </div>
    <div class="sentiment-bar-wrap">
      <div class="sentiment-bar">
        <div class="sentiment-bull" style="width:${bullPct}%"></div>
        <div class="sentiment-bear" style="width:${bearPct}%"></div>
      </div>
      <div class="sentiment-labels">
        <span class="positive">🐂 Bullish ${bullPct}%</span>
        <span class="negative">🐻 Bearish ${bearPct}%</span>
        <span style="color:var(--muted)">Neutral ${100 - bullPct - bearPct}%</span>
      </div>
    </div>`;
}

async function analyzeTicker() {
  const symbol = tickerInput.value.trim().toUpperCase();
  if (!symbol) { setStatus("Please enter a ticker symbol.", true); return; }
  setStatus(`Loading ${symbol}...`);
  searchBtn.disabled = true;
  try {
    const [series, spySeries, socialData] = await Promise.all([
      fetchSeries(symbol),
      spySeriesCache ?? fetchSeries("SPY").then((s) => { spySeriesCache = s; return s; }),
      fetchSocial(symbol).catch(() => null),
    ]);
    currentSeries = { ...series, symbol };
    renderStats(series, spySeries);
    renderSocial(socialData);
    renderPriceChart(symbol, series);
    setStatus(`Loaded ${symbol} — ${series.dates.length} trading days.`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    searchBtn.disabled = false;
  }
}

async function addToCompare() {
  const symbol = tickerInput.value.trim().toUpperCase();
  if (!symbol) { setStatus("Please enter a ticker symbol.", true); return; }
  if (compareSeries.has(symbol)) { setStatus(`${symbol} already in comparison.`); return; }
  setStatus(`Loading ${symbol} for comparison...`);
  compareBtn.disabled = true;
  try {
    const series =
      currentSeries?.symbol === symbol ? currentSeries : await fetchSeries(symbol);
    compareSeries.set(symbol, series);
    renderCompareChips();
    renderCompareChart();
    setStatus(`Added ${symbol} to comparison.`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    compareBtn.disabled = false;
  }
}


searchBtn.addEventListener("click", analyzeTicker);
compareBtn.addEventListener("click", addToCompare);
tickerInput.addEventListener("keydown", (e) => { if (e.key === "Enter") analyzeTicker(); });
smaToggle.addEventListener("change", () => { if (currentSeries) renderPriceChart(currentSeries.symbol, currentSeries); });

// ---- Tab switching ----
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---- Compare tab ----
const cmpTickerInput = document.getElementById("cmpTickerInput");
const cmpAddBtn = document.getElementById("cmpAddBtn");
const cmpStatusEl = document.getElementById("cmpStatus");
const cmpHeaderRow = document.getElementById("cmpHeaderRow");
const cmpBody = document.getElementById("cmpBody");
const cmpChips = document.getElementById("cmpChips");

const cmpStocks = new Map(); // symbol -> metrics object

function setCmpStatus(msg, isError = false) {
  cmpStatusEl.textContent = msg;
  cmpStatusEl.style.color = isError ? "#f87171" : "#94a3b8";
}

function computeMetrics(series, spySeries) {
  const { dates, closes, volumes, meta } = series;
  const validCloses = closes.filter((c) => c != null);
  const last = validCloses[validCloses.length - 1];
  const prev = validCloses[validCloses.length - 2];
  const change = last - prev;
  const changePct = (change / prev) * 100;

  const currentYear = new Date().getFullYear();

  // YTD
  const ytdIdx = dates.findIndex((d) => d >= `${currentYear}-01-01`);
  const ytd = ytdIdx !== -1 && closes[ytdIdx] != null
    ? ((last - closes[ytdIdx]) / closes[ytdIdx]) * 100 : null;

  // 52-week
  const w52 = closes.slice(-252).filter((c) => c != null);
  const high52 = meta.fiftyTwoWeekHigh ?? Math.max(...w52);
  const low52 = meta.fiftyTwoWeekLow ?? Math.min(...w52);
  const pos52 = ((last - low52) / (high52 - low52)) * 100;

  // Annual returns
  const years = [currentYear - 3, currentYear - 2, currentYear - 1];
  const annualReturns = {};
  for (const yr of years) {
    const si = dates.findIndex((d) => d >= `${yr}-01-01`);
    const ei = dates.reduce((best, d, i) => (d <= `${yr}-12-31` ? i : best), -1);
    if (si !== -1 && ei !== -1 && si <= ei && closes[si] && closes[ei])
      annualReturns[yr] = ((closes[ei] - closes[si]) / closes[si]) * 100;
    else annualReturns[yr] = null;
  }
  const validAnnual = Object.values(annualReturns).filter((v) => v != null);
  const annualAvg = validAnnual.length ? validAnnual.reduce((s, v) => s + v, 0) / validAnnual.length : null;

  // CAGR 3Y
  const cagrIdx = dates.findIndex((d) => d >= `${currentYear - 3}-01-01`);
  let cagr = null;
  if (cagrIdx !== -1 && closes[cagrIdx] != null) {
    const yrs = (new Date(dates[dates.length - 1]) - new Date(dates[cagrIdx])) / (365.25 * 24 * 3600 * 1000);
    cagr = (Math.pow(last / closes[cagrIdx], 1 / yrs) - 1) * 100;
  }

  // Risk
  const w252 = closes.slice(-252).filter((c) => c != null);
  const stockRet = dailyReturns(w252);
  const stdDev = stddev(stockRet) * Math.sqrt(252) * 100;
  const maxDD = computeMaxDrawdown(w252) * 100;
  const sharpe = computeSharpe(stockRet);
  const rsi = computeRSI(closes.slice(-50));

  let beta = null;
  if (spySeries) {
    const spyRet = dailyReturns(spySeries.closes.slice(-252).filter((c) => c != null));
    beta = computeBeta(stockRet, spyRet);
  }

  return {
    name: meta.longName || meta.shortName || "",
    price: last,
    change: changePct,
    ytd,
    high52,
    low52,
    pos52,
    volume: volumes[volumes.length - 1],
    cagr,
    annualReturns,
    annualAvg,
    pe: meta.trailingPE ?? null,
    divYield: meta.dividendYield != null ? meta.dividendYield * 100 : null,
    rsi,
    stdDev,
    beta,
    maxDD,
    sharpe,
  };
}

const CMP_ROWS = [
  { group: "Price" },
  { key: "price",   label: "Price",           fmt: (v) => `$${v.toFixed(2)}` },
  { key: "change",  label: "Day Change",       fmt: (v) => pctFmt(v), color: true },
  { key: "ytd",     label: "YTD Return",       fmt: (v) => v != null ? pctFmt(v) : "N/A", color: true },
  { key: "high52",  label: "52-Week High",     fmt: (v) => `$${v.toFixed(2)}` },
  { key: "low52",   label: "52-Week Low",      fmt: (v) => `$${v.toFixed(2)}` },
  { key: "pos52",   label: "52-Week Position", fmt: (v) => `${v.toFixed(1)}%` },
  { key: "volume",  label: "Volume",           fmt: (v) => v ? v.toLocaleString() : "N/A" },
  { group: "Returns" },
  { key: "cagr",        label: "CAGR (3Y)",         fmt: (v) => v != null ? pctFmt(v) : "N/A", color: true },
  { key: "annualAvg",   label: "3Y Annual Avg",      fmt: (v) => v != null ? pctFmt(v) : "N/A", color: true },
  { key: "yr0",         label: `${new Date().getFullYear() - 3} Return`, fmt: (v, m) => m.annualReturns[new Date().getFullYear()-3] != null ? pctFmt(m.annualReturns[new Date().getFullYear()-3]) : "N/A", color: true, custom: true },
  { key: "yr1",         label: `${new Date().getFullYear() - 2} Return`, fmt: (v, m) => m.annualReturns[new Date().getFullYear()-2] != null ? pctFmt(m.annualReturns[new Date().getFullYear()-2]) : "N/A", color: true, custom: true },
  { key: "yr2",         label: `${new Date().getFullYear() - 1} Return`, fmt: (v, m) => m.annualReturns[new Date().getFullYear()-1] != null ? pctFmt(m.annualReturns[new Date().getFullYear()-1]) : "N/A", color: true, custom: true },
  { group: "Valuation" },
  { key: "pe",       label: "P/E Ratio",      fmt: (v) => v != null ? v.toFixed(1) : "N/A" },
  { key: "divYield", label: "Dividend Yield", fmt: (v) => v != null ? `${v.toFixed(2)}%` : "N/A", color: true },
  { group: "Risk" },
  { key: "beta",   label: "Beta (1Y)",          fmt: (v) => v != null ? v.toFixed(2) : "N/A" },
  { key: "stdDev", label: "Std Deviation (1Y)", fmt: (v) => `${v.toFixed(2)}%` },
  { key: "maxDD",  label: "Max Drawdown (1Y)",  fmt: (v) => `-${v.toFixed(2)}%`, negative: true },
  { key: "sharpe", label: "Sharpe Ratio (1Y)",  fmt: (v) => v != null ? v.toFixed(2) : "N/A", color: true },
  { group: "Momentum" },
  { key: "rsi",   label: "RSI (14)",  fmt: (v) => v != null ? v.toFixed(1) : "N/A" },
];

function pctFmt(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

function colorClass(row, val, metrics) {
  if (row.negative) return "negative";
  if (!row.color) return "";
  const num = row.custom
    ? parseFloat(row.fmt(null, metrics))
    : (typeof val === "number" ? val : parseFloat(val));
  if (isNaN(num)) return "";
  return num >= 0 ? "positive" : "negative";
}

function renderCmpTable() {
  const symbols = [...cmpStocks.keys()];

  // Header
  cmpHeaderRow.innerHTML = `<th class="metric-col">Metric</th>`;
  for (const sym of symbols) {
    const th = document.createElement("th");
    th.className = "stock-col";
    th.textContent = sym;
    cmpHeaderRow.appendChild(th);
  }

  // Body
  cmpBody.innerHTML = "";
  for (const row of CMP_ROWS) {
    const tr = document.createElement("tr");
    if (row.group) {
      tr.className = "group-header";
      tr.innerHTML = `<td colspan="${symbols.length + 1}">${row.group}</td>`;
      cmpBody.appendChild(tr);
      continue;
    }
    const labelTd = document.createElement("td");
    labelTd.className = "metric-col";
    labelTd.textContent = row.label;
    tr.appendChild(labelTd);

    for (const sym of symbols) {
      const m = cmpStocks.get(sym);
      const val = row.custom ? null : m[row.key];
      const text = row.fmt(val, m);
      const td = document.createElement("td");
      td.className = "stock-val " + colorClass(row, val, m);
      td.textContent = text;
      tr.appendChild(td);
    }
    cmpBody.appendChild(tr);
  }
}

function renderCmpChips() {
  cmpChips.innerHTML = "";
  for (const sym of cmpStocks.keys()) {
    const chip = document.createElement("div");
    chip.className = "compare-chip";
    chip.innerHTML = `<span>${sym}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.addEventListener("click", () => {
      cmpStocks.delete(sym);
      renderCmpChips();
      renderCmpTable();
    });
    chip.appendChild(btn);
    cmpChips.appendChild(chip);
  }
}

async function cmpAddStock() {
  const symbol = cmpTickerInput.value.trim().toUpperCase();
  if (!symbol) { setCmpStatus("Please enter a ticker symbol.", true); return; }
  if (cmpStocks.has(symbol)) { setCmpStatus(`${symbol} already added.`); return; }
  setCmpStatus(`Loading ${symbol}...`);
  cmpAddBtn.disabled = true;
  try {
    const [series, spySeries] = await Promise.all([
      fetchSeries(symbol),
      spySeriesCache ?? fetchSeries("SPY").then((s) => { spySeriesCache = s; return s; }),
    ]);
    const metrics = computeMetrics(series, spySeries);
    cmpStocks.set(symbol, metrics);
    cmpTickerInput.value = "";
    renderCmpChips();
    renderCmpTable();
    setCmpStatus(`Added ${symbol} — ${cmpStocks.size} stock${cmpStocks.size > 1 ? "s" : ""} in comparison.`);
  } catch (err) {
    setCmpStatus(err.message, true);
  } finally {
    cmpAddBtn.disabled = false;
  }
}

cmpAddBtn.addEventListener("click", cmpAddStock);
cmpTickerInput.addEventListener("keydown", (e) => { if (e.key === "Enter") cmpAddStock(); });
sma200Toggle.addEventListener("change", () => { if (currentSeries) renderPriceChart(currentSeries.symbol, currentSeries); });
