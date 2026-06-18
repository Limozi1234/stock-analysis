const AV_BASE = "https://www.alphavantage.co/query";
const ST_BASE = "https://api.stocktwits.com/api/2/streams/symbol";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ---- API key ----
const apiKeyInput = document.getElementById("apiKeyInput");
apiKeyInput.value = localStorage.getItem("av_api_key") || "";
document.getElementById("saveKeyBtn").addEventListener("click", () => {
  localStorage.setItem("av_api_key", apiKeyInput.value.trim());
  setStatus("API key saved.");
});
function getKey() { return localStorage.getItem("av_api_key") || apiKeyInput.value.trim(); }

// ---- DOM refs ----
const tickerInput      = document.getElementById("tickerInput");
const searchBtn        = document.getElementById("searchBtn");
const compareBtn       = document.getElementById("compareBtn");
const statusEl         = document.getElementById("status");
const statsSection     = document.getElementById("statsSection");
const statName         = document.getElementById("statName");
const statPrice        = document.getElementById("statPrice");
const statChange       = document.getElementById("statChange");
const statYTD          = document.getElementById("statYTD");
const stat52High       = document.getElementById("stat52High");
const stat52Low        = document.getElementById("stat52Low");
const statVolume       = document.getElementById("statVolume");
const statCAGR         = document.getElementById("statCAGR");
const statPE           = document.getElementById("statPE");
const statRSI          = document.getElementById("statRSI");
const statDivYield     = document.getElementById("statDivYield");
const stat52Pos        = document.getElementById("stat52Pos");
const statStdDev       = document.getElementById("statStdDev");
const statBeta         = document.getElementById("statBeta");
const statMaxDD        = document.getElementById("statMaxDD");
const statSharpe       = document.getElementById("statSharpe");
const statAnnualReturns= document.getElementById("statAnnualReturns");
const statSocial       = document.getElementById("statSocial");
const smaToggle        = document.getElementById("smaToggle");
const sma200Toggle     = document.getElementById("sma200Toggle");
const compareList      = document.getElementById("compareList");

let priceChart = null, compareChart = null;
let currentSeries = null, spySeriesCache = null;
const compareSeries = new Map();

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#f87171" : "#94a3b8";
}

// ---- localStorage cache ----
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(`av_cache_${key}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(`av_cache_${key}`); return null; }
    return data;
  } catch { return null; }
}
function cacheSet(key, data) {
  try { localStorage.setItem(`av_cache_${key}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ---- Alpha Vantage fetch ----
async function avGet(params) {
  const key = getKey();
  if (!key) throw new Error("Please enter and save your Alpha Vantage API key first. Get one free at alphavantage.co");
  const url = `${AV_BASE}?${new URLSearchParams({ ...params, apikey: key })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Network error: ${res.status}`);
  const data = await res.json();
  if (data["Note"]) throw new Error("Rate limit hit (5 req/min). Wait a moment and try again.");
  if (data["Information"]) throw new Error("Daily API limit reached (25/day). Try again tomorrow or upgrade your key.");
  if (data["Error Message"]) throw new Error(`Invalid symbol or API error.`);
  return data;
}

async function fetchSeries(symbol) {
  const cached = cacheGet(symbol);
  if (cached) return cached;

  const [dailyData, overviewData] = await Promise.all([
    avGet({ function: "TIME_SERIES_DAILY", symbol, outputsize: "full" }),
    avGet({ function: "OVERVIEW", symbol }).catch(() => ({})),
  ]);

  const ts = dailyData["Time Series (Daily)"];
  if (!ts) throw new Error(`No price data found for ${symbol}.`);

  const dates = Object.keys(ts).sort();
  const closes  = dates.map(d => parseFloat(ts[d]["4. close"]));
  const volumes = dates.map(d => parseInt(ts[d]["5. volume"], 10));

  const ov = overviewData || {};
  const series = {
    dates, closes, volumes,
    meta: {
      longName:         ov["Name"]          || symbol,
      shortName:        ov["Name"]          || symbol,
      fiftyTwoWeekHigh: parseFloat(ov["52WeekHigh"]) || null,
      fiftyTwoWeekLow:  parseFloat(ov["52WeekLow"])  || null,
      trailingPE:       parseFloat(ov["PERatio"])    || null,
      dividendYield:    parseFloat(ov["DividendYield"]) || null,
      instrumentType:   ov["AssetType"] || "",
    },
  };

  cacheSet(symbol, series);
  return series;
}

async function fetchSocial(symbol) {
  try {
    const res = await fetch(`${ST_BASE}/${symbol}.json`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ---- Math helpers ----
function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++)
    if (closes[i] != null && closes[i-1] != null && closes[i-1] !== 0)
      r.push((closes[i] - closes[i-1]) / closes[i-1]);
  return r;
}
function mean(arr) { return arr.reduce((s,v) => s+v, 0) / arr.length; }
function stddev(arr) { const m = mean(arr); return Math.sqrt(arr.reduce((s,v) => s+(v-m)**2, 0) / arr.length); }
function computeBeta(sRet, bRet) {
  const n = Math.min(sRet.length, bRet.length);
  const s = sRet.slice(-n), b = bRet.slice(-n);
  const ms = mean(s), mb = mean(b);
  let cov = 0, varB = 0;
  for (let i = 0; i < n; i++) { cov += (s[i]-ms)*(b[i]-mb); varB += (b[i]-mb)**2; }
  return varB === 0 ? null : cov / varB;
}
function computeMaxDrawdown(closes) {
  let peak = -Infinity, maxDD = 0;
  for (const c of closes) { if (c > peak) peak = c; const dd = (peak-c)/peak; if (dd > maxDD) maxDD = dd; }
  return maxDD;
}
function computeSharpe(returns, rf = 0.05) {
  const rfD = rf / 252, excess = returns.map(r => r-rfD), s = stddev(excess);
  return s === 0 ? null : (mean(excess)/s) * Math.sqrt(252);
}
function computeRSI(closes, period = 14) {
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    gains.push(d > 0 ? d : 0); losses.push(d < 0 ? -d : 0);
  }
  if (gains.length < period) return null;
  let ag = gains.slice(0,period).reduce((s,v)=>s+v,0)/period;
  let al = losses.slice(0,period).reduce((s,v)=>s+v,0)/period;
  for (let i = period; i < gains.length; i++) {
    ag = (ag*(period-1)+gains[i])/period; al = (al*(period-1)+losses[i])/period;
  }
  return al === 0 ? 100 : 100 - 100/(1+ag/al);
}
function computeSMA(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period-1; i < values.length; i++) {
    let sum = 0, count = 0;
    for (let j = i-period+1; j <= i; j++) { if (values[j] != null) { sum += values[j]; count++; } }
    result[i] = count === period ? sum/period : null;
  }
  return result;
}

// ---- Metrics calculation (shared between Analysis and Compare tabs) ----
function computeMetrics(series, spySeries) {
  const { dates, closes, volumes, meta } = series;
  const validCloses = closes.filter(c => c != null);
  const last = validCloses[validCloses.length - 1];
  const prev = validCloses[validCloses.length - 2];
  const change = last - prev, changePct = (change/prev)*100;
  const currentYear = new Date().getFullYear();

  const ytdIdx = dates.findIndex(d => d >= `${currentYear}-01-01`);
  const ytd = ytdIdx !== -1 && closes[ytdIdx] != null ? ((last - closes[ytdIdx]) / closes[ytdIdx]) * 100 : null;

  const w52 = closes.slice(-252).filter(c => c != null);
  const high52 = meta.fiftyTwoWeekHigh ?? Math.max(...w52);
  const low52  = meta.fiftyTwoWeekLow  ?? Math.min(...w52);
  const pos52  = ((last - low52) / (high52 - low52)) * 100;

  const years = [currentYear-3, currentYear-2, currentYear-1];
  const annualReturns = {};
  for (const yr of years) {
    const si = dates.findIndex(d => d >= `${yr}-01-01`);
    const ei = dates.reduce((best,d,i) => d <= `${yr}-12-31` ? i : best, -1);
    annualReturns[yr] = (si !== -1 && ei !== -1 && si <= ei && closes[si] && closes[ei])
      ? ((closes[ei]-closes[si])/closes[si])*100 : null;
  }
  const validAnnual = Object.values(annualReturns).filter(v => v != null);
  const annualAvg = validAnnual.length ? mean(validAnnual) : null;

  const cagrIdx = dates.findIndex(d => d >= `${currentYear-3}-01-01`);
  let cagr = null;
  if (cagrIdx !== -1 && closes[cagrIdx] != null) {
    const yrs = (new Date(dates[dates.length-1]) - new Date(dates[cagrIdx])) / (365.25*24*3600*1000);
    cagr = (Math.pow(last/closes[cagrIdx], 1/yrs)-1)*100;
  }

  const w252 = closes.slice(-252).filter(c => c != null);
  const stockRet = dailyReturns(w252);
  const stdDev = stddev(stockRet) * Math.sqrt(252) * 100;
  const maxDD  = computeMaxDrawdown(w252) * 100;
  const sharpe = computeSharpe(stockRet);
  const rsi    = computeRSI(closes.slice(-50));

  let beta = null;
  if (spySeries) {
    const spyRet = dailyReturns(spySeries.closes.slice(-252).filter(c => c != null));
    beta = computeBeta(stockRet, spyRet);
  }

  return {
    name: meta.longName || meta.shortName || "",
    price: last, change: changePct, ytd,
    high52, low52, pos52,
    volume: volumes[volumes.length-1],
    cagr, annualReturns, annualAvg,
    pe: meta.trailingPE ?? null,
    divYield: meta.dividendYield != null ? meta.dividendYield * 100 : null,
    rsi, stdDev, beta, maxDD, sharpe,
    dates, closes,
  };
}

// ---- Render stats (Analysis tab) ----
function renderStats(series, spySeries) {
  const m = computeMetrics(series, spySeries);
  const { dates, closes, volumes, meta } = series;
  const currentYear = new Date().getFullYear();

  statName.textContent = m.name;
  statPrice.textContent = `$${m.price.toFixed(2)}`;
  statChange.textContent = `${m.change >= 0?"+":""}${m.change.toFixed(2)}%`;
  statChange.className = "value " + (m.change >= 0 ? "positive" : "negative");
  statYTD.innerHTML = m.ytd != null
    ? `<span class="${m.ytd>=0?"positive":"negative"}">${m.ytd>=0?"+":""}${m.ytd.toFixed(2)}%</span>` : "--";
  stat52High.textContent  = `$${m.high52.toFixed(2)}`;
  stat52Low.textContent   = `$${m.low52.toFixed(2)}`;
  statVolume.textContent  = m.volume ? m.volume.toLocaleString() : "--";

  statCAGR.textContent    = m.cagr != null ? `${m.cagr>=0?"+":""}${m.cagr.toFixed(2)}%` : "--";
  statCAGR.className      = "value " + (m.cagr != null ? (m.cagr>=0?"positive":"negative") : "");
  statPE.textContent      = m.pe != null ? m.pe.toFixed(1) : "N/A";
  statRSI.textContent     = m.rsi != null ? m.rsi.toFixed(1) : "--";
  statRSI.className       = "value " + (m.rsi!=null ? (m.rsi>=70?"negative":m.rsi<=30?"positive":"") : "");
  statDivYield.textContent= m.divYield != null ? `${m.divYield.toFixed(2)}%` : "N/A";
  statDivYield.className  = "value " + (m.divYield>0?"positive":"");
  stat52Pos.textContent   = `${m.pos52.toFixed(1)}%`;
  stat52Pos.className     = "value " + (m.pos52>=75?"positive":m.pos52<=25?"negative":"");
  statStdDev.textContent  = `${m.stdDev.toFixed(2)}%`;
  statMaxDD.textContent   = `-${m.maxDD.toFixed(2)}%`;
  statMaxDD.className     = "value negative";
  statSharpe.textContent  = m.sharpe != null ? m.sharpe.toFixed(2) : "--";
  statSharpe.className    = "value " + (m.sharpe!=null?(m.sharpe>=1?"positive":m.sharpe<0?"negative":""):"");
  statBeta.textContent    = m.beta != null ? m.beta.toFixed(2) : "--";
  statBeta.className      = "value " + (m.beta!=null?(m.beta>1.2?"negative":m.beta<0.8?"positive":""):"");

  // Annual returns
  const years = [currentYear-3, currentYear-2, currentYear-1];
  const rows = years.map(yr => {
    const pct = m.annualReturns[yr];
    if (pct == null) return "";
    const cls = pct>=0?"positive":"negative";
    return `<span class="ar-row"><span class="ar-year">${yr}</span><span class="value ${cls}">${pct>=0?"+":""}${pct.toFixed(2)}%</span></span>`;
  }).filter(Boolean);
  if (m.annualAvg != null) {
    const cls = m.annualAvg>=0?"positive":"negative";
    rows.push(`<span class="ar-row ar-avg"><span class="ar-year">Avg</span><span class="value ${cls}">${m.annualAvg>=0?"+":""}${m.annualAvg.toFixed(2)}%</span></span>`);
  }
  statAnnualReturns.innerHTML = rows.length ? rows.join("") : "--";

  statsSection.hidden = false;
}

function renderSocial(data) {
  const messages = data?.messages ?? [];
  if (messages.length === 0) { statSocial.innerHTML = "<span style='color:var(--muted)'>No recent activity</span>"; return; }
  let bullish = 0, bearish = 0, neutral = 0;
  for (const m of messages) {
    const s = m?.entities?.sentiment?.basic;
    if (s === "Bullish") bullish++; else if (s === "Bearish") bearish++; else neutral++;
  }
  const total = bullish + bearish + neutral;
  const bullPct = Math.round((bullish/total)*100), bearPct = Math.round((bearish/total)*100);
  statSocial.innerHTML = `
    <div class="social-row"><span class="social-count">${total} recent messages</span></div>
    <div class="sentiment-bar-wrap">
      <div class="sentiment-bar">
        <div class="sentiment-bull" style="width:${bullPct}%"></div>
        <div class="sentiment-bear" style="width:${bearPct}%"></div>
      </div>
      <div class="sentiment-labels">
        <span class="positive">🐂 Bullish ${bullPct}%</span>
        <span class="negative">🐻 Bearish ${bearPct}%</span>
        <span style="color:var(--muted)">Neutral ${100-bullPct-bearPct}%</span>
      </div>
    </div>`;
}

// ---- Price chart ----
function renderPriceChart(symbol, series) {
  const { dates, closes } = series;
  const sliceStart = Math.max(0, dates.length-300);
  const labels = dates.slice(sliceStart), data = closes.slice(sliceStart);
  const datasets = [{ label: `${symbol} Close`, data, borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.05)", fill: true, pointRadius: 0, borderWidth: 2, tension: 0.1 }];
  if (smaToggle.checked)   datasets.push({ label:"SMA 50",  data: computeSMA(closes,50).slice(sliceStart),  borderColor:"#fbbf24", backgroundColor:"transparent", pointRadius:0, borderWidth:1.5, tension:0.1 });
  if (sma200Toggle.checked) datasets.push({ label:"SMA 200", data: computeSMA(closes,200).slice(sliceStart), borderColor:"#a78bfa", backgroundColor:"transparent", pointRadius:0, borderWidth:1.5, tension:0.1 });
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(document.getElementById("priceChart"), {
    type: "line", data: { labels, datasets },
    options: { responsive:true, maintainAspectRatio:false, interaction:{mode:"index",intersect:false},
      scales: { x:{ticks:{color:"#94a3b8",maxTicksLimit:10},grid:{color:"#334155"}}, y:{ticks:{color:"#94a3b8"},grid:{color:"#334155"}} },
      plugins:{ legend:{labels:{color:"#e2e8f0"}} } },
  });
}

// ---- Compare chart (Analysis tab) ----
function renderCompareChart() {
  if (compareSeries.size === 0) { if (compareChart) { compareChart.destroy(); compareChart = null; } return; }
  const colors = ["#38bdf8","#fbbf24","#a78bfa","#4ade80","#f87171","#f472b6"];
  let colorIdx = 0, datasets = [], labels = [];
  for (const [symbol, series] of compareSeries.entries()) {
    const sliceStart = Math.max(0, series.dates.length-300);
    const dates = series.dates.slice(sliceStart), closes = series.closes.slice(sliceStart);
    if (dates.length > labels.length) labels = dates;
    const base = closes.find(c => c != null);
    datasets.push({ label:symbol, data: closes.map(c => (c!=null&&base)?((c-base)/base)*100:null), borderColor:colors[colorIdx%colors.length], backgroundColor:"transparent", pointRadius:0, borderWidth:2, tension:0.1 });
    colorIdx++;
  }
  if (compareChart) compareChart.destroy();
  compareChart = new Chart(document.getElementById("compareChart"), {
    type:"line", data:{labels,datasets},
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:"index",intersect:false},
      scales:{ x:{ticks:{color:"#94a3b8",maxTicksLimit:10},grid:{color:"#334155"}}, y:{ticks:{color:"#94a3b8",callback:v=>`${v.toFixed(1)}%`},grid:{color:"#334155"}} },
      plugins:{legend:{labels:{color:"#e2e8f0"}}} },
  });
}

function renderCompareChips() {
  compareList.innerHTML = "";
  for (const symbol of compareSeries.keys()) {
    const chip = document.createElement("div"); chip.className = "compare-chip";
    chip.innerHTML = `<span>${symbol}</span>`;
    const btn = document.createElement("button"); btn.textContent = "✕";
    btn.addEventListener("click", () => { compareSeries.delete(symbol); renderCompareChips(); renderCompareChart(); });
    chip.appendChild(btn); compareList.appendChild(chip);
  }
}

// ---- Analysis tab actions ----
async function analyzeTicker() {
  const symbol = tickerInput.value.trim().toUpperCase();
  if (!symbol) { setStatus("Please enter a ticker symbol.", true); return; }
  setStatus(`Loading ${symbol}...`);
  searchBtn.disabled = true;
  try {
    const [series, spySeries, socialData] = await Promise.all([
      fetchSeries(symbol),
      spySeriesCache ?? fetchSeries("SPY").then(s => { spySeriesCache = s; return s; }),
      fetchSocial(symbol),
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
  setStatus(`Loading ${symbol}...`); compareBtn.disabled = true;
  try {
    const series = currentSeries?.symbol === symbol ? currentSeries : await fetchSeries(symbol);
    compareSeries.set(symbol, series); renderCompareChips(); renderCompareChart();
    setStatus(`Added ${symbol} to comparison.`);
  } catch (err) { setStatus(err.message, true); }
  finally { compareBtn.disabled = false; }
}

searchBtn.addEventListener("click", analyzeTicker);
compareBtn.addEventListener("click", addToCompare);
tickerInput.addEventListener("keydown", e => { if (e.key==="Enter") analyzeTicker(); });
smaToggle.addEventListener("change",    () => { if (currentSeries) renderPriceChart(currentSeries.symbol, currentSeries); });
sma200Toggle.addEventListener("change", () => { if (currentSeries) renderPriceChart(currentSeries.symbol, currentSeries); });

// ---- Tabs ----
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---- Compare tab ----
const cmpTickerInput = document.getElementById("cmpTickerInput");
const cmpAddBtn      = document.getElementById("cmpAddBtn");
const cmpStatusEl    = document.getElementById("cmpStatus");
const cmpHeaderRow   = document.getElementById("cmpHeaderRow");
const cmpBody        = document.getElementById("cmpBody");
const cmpChips       = document.getElementById("cmpChips");
const cmpStocks      = new Map();

function setCmpStatus(msg, isError=false) { cmpStatusEl.textContent=msg; cmpStatusEl.style.color=isError?"#f87171":"#94a3b8"; }

function pctFmt(v) { return `${v>=0?"+":""}${v.toFixed(2)}%`; }

const currentYear = new Date().getFullYear();
const CMP_ROWS = [
  { group:"Price" },
  { key:"price",    label:"Price",            fmt: v => `$${v.toFixed(2)}` },
  { key:"change",   label:"Day Change",        fmt: v => pctFmt(v), color:true },
  { key:"ytd",      label:"YTD Return",        fmt: v => v!=null?pctFmt(v):"N/A", color:true },
  { key:"high52",   label:"52-Week High",      fmt: v => `$${v.toFixed(2)}` },
  { key:"low52",    label:"52-Week Low",       fmt: v => `$${v.toFixed(2)}` },
  { key:"pos52",    label:"52-Week Position",  fmt: v => `${v.toFixed(1)}%` },
  { key:"volume",   label:"Volume",            fmt: v => v?v.toLocaleString():"N/A" },
  { group:"Returns" },
  { key:"cagr",      label:"CAGR (3Y)",          fmt: v => v!=null?pctFmt(v):"N/A", color:true },
  { key:"annualAvg", label:"3Y Annual Avg",       fmt: v => v!=null?pctFmt(v):"N/A", color:true },
  { label:`${currentYear-3} Return`, custom: m => m.annualReturns[currentYear-3], color:true },
  { label:`${currentYear-2} Return`, custom: m => m.annualReturns[currentYear-2], color:true },
  { label:`${currentYear-1} Return`, custom: m => m.annualReturns[currentYear-1], color:true },
  { group:"Valuation" },
  { key:"pe",       label:"P/E Ratio",        fmt: v => v!=null?v.toFixed(1):"N/A" },
  { key:"divYield", label:"Dividend Yield",   fmt: v => v!=null?`${v.toFixed(2)}%`:"N/A", color:true },
  { group:"Risk" },
  { key:"beta",    label:"Beta (1Y)",           fmt: v => v!=null?v.toFixed(2):"N/A" },
  { key:"stdDev",  label:"Std Deviation (1Y)",  fmt: v => `${v.toFixed(2)}%` },
  { key:"maxDD",   label:"Max Drawdown (1Y)",   fmt: v => `-${v.toFixed(2)}%`, negative:true },
  { key:"sharpe",  label:"Sharpe Ratio (1Y)",   fmt: v => v!=null?v.toFixed(2):"N/A", color:true },
  { group:"Momentum" },
  { key:"rsi", label:"RSI (14)", fmt: v => v!=null?v.toFixed(1):"N/A" },
];

function renderCmpTable() {
  const symbols = [...cmpStocks.keys()];
  cmpHeaderRow.innerHTML = `<th class="metric-col">Metric</th>`;
  symbols.forEach(sym => { const th=document.createElement("th"); th.className="stock-col"; th.textContent=sym; cmpHeaderRow.appendChild(th); });
  cmpBody.innerHTML = "";
  for (const row of CMP_ROWS) {
    const tr = document.createElement("tr");
    if (row.group) {
      tr.className="group-header";
      tr.innerHTML=`<td colspan="${symbols.length+1}">${row.group}</td>`;
      cmpBody.appendChild(tr); continue;
    }
    const labelTd = document.createElement("td"); labelTd.className="metric-col"; labelTd.textContent=row.label; tr.appendChild(labelTd);
    for (const sym of symbols) {
      const m = cmpStocks.get(sym);
      const val = row.custom ? row.custom(m) : m[row.key];
      const text = row.custom ? (val!=null?pctFmt(val):"N/A") : row.fmt(val, m);
      const td = document.createElement("td"); td.className="stock-val";
      if (row.negative) td.classList.add("negative");
      else if (row.color) { const num=parseFloat(text); if(!isNaN(num)) td.classList.add(num>=0?"positive":"negative"); }
      td.textContent=text; tr.appendChild(td);
    }
    cmpBody.appendChild(tr);
  }
}

function renderCmpChips() {
  cmpChips.innerHTML = "";
  for (const sym of cmpStocks.keys()) {
    const chip=document.createElement("div"); chip.className="compare-chip";
    chip.innerHTML=`<span>${sym}</span>`;
    const btn=document.createElement("button"); btn.textContent="✕";
    btn.addEventListener("click",()=>{ cmpStocks.delete(sym); renderCmpChips(); renderCmpTable(); });
    chip.appendChild(btn); cmpChips.appendChild(chip);
  }
}

async function cmpAddStock() {
  const symbol = cmpTickerInput.value.trim().toUpperCase();
  if (!symbol) { setCmpStatus("Please enter a ticker symbol.", true); return; }
  if (cmpStocks.has(symbol)) { setCmpStatus(`${symbol} already added.`); return; }
  setCmpStatus(`Loading ${symbol}...`); cmpAddBtn.disabled = true;
  try {
    const [series, spySeries] = await Promise.all([
      fetchSeries(symbol),
      spySeriesCache ?? fetchSeries("SPY").then(s => { spySeriesCache=s; return s; }),
    ]);
    cmpStocks.set(symbol, computeMetrics(series, spySeries));
    cmpTickerInput.value = "";
    renderCmpChips(); renderCmpTable();
    setCmpStatus(`Added ${symbol} — ${cmpStocks.size} stock${cmpStocks.size>1?"s":""} in table.`);
  } catch (err) { setCmpStatus(err.message, true); }
  finally { cmpAddBtn.disabled = false; }
}

cmpAddBtn.addEventListener("click", cmpAddStock);
cmpTickerInput.addEventListener("keydown", e => { if (e.key==="Enter") cmpAddStock(); });
