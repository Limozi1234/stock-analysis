// StockTwits via same-origin Vercel rewrite (browsers can't call it directly — CORS).
const ST_BASE  = "/api/st/api/2/streams/symbol";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Allowed ticker format: letters, digits, dot, hyphen, caret (e.g. AAPL, BRK.B, ^GSPC).
const TICKER_RE = /^[A-Z0-9.^-]{1,15}$/;

// Validate + normalize a user-supplied ticker. Returns "" if invalid.
function normalizeSymbol(raw) {
  const s = (raw || "").trim().toUpperCase();
  return TICKER_RE.test(s) ? s : "";
}

// Yahoo Finance endpoints to try in order. `symbol` is validated by normalizeSymbol
// before reaching here; we still encode it as defense-in-depth.
//
// Yahoo sends no CORS headers, so a direct browser fetch is blocked on any deployed
// origin. Primary path is a same-origin Vercel rewrite (/api/yf -> query1 Yahoo) which
// proxies server-side. The direct hosts remain as fallbacks for environments where the
// proxy is unavailable (they'll CORS-fail harmlessly and we move on).
const YF_URLS = (symbol) => {
  const enc  = encodeURIComponent(symbol);
  const path = `v8/finance/chart/${enc}?interval=1d&range=5y`;
  return [
    `/api/yf/${path}`,
    `/api/yf2/${path}`,
    `https://query1.finance.yahoo.com/${path}`,
    `https://query2.finance.yahoo.com/${path}`,
  ];
};

// ---- DOM refs ----
const tickerInput      = document.getElementById("tickerInput");
const searchBtn        = document.getElementById("searchBtn");
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
let priceChart = null;
let currentSeries = null, spySeriesCache = null;

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

// ---- Yahoo Finance fetch ----
async function fetchSeries(symbol) {
  const cached = cacheGet(symbol);
  if (cached) return cached;

  let json = null;
  for (const url of YF_URLS(symbol)) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) continue;
      json = await res.json();
      if (json?.chart?.result?.[0]) break;
    } catch { continue; }
  }

  if (!json?.chart?.result?.[0]) throw new Error(`Could not load data for ${symbol}. Check the ticker and try again.`);

  const result = json.chart.result[0];
  const meta   = result.meta;
  const timestamps = result.timestamp;
  const quote  = result.indicators.quote[0];

  const dates   = timestamps.map(t => new Date(t * 1000).toISOString().slice(0, 10));
  const closes  = quote.close.map(v  => v  == null ? null : parseFloat(v.toFixed(4)));
  const volumes = quote.volume.map(v => v  == null ? null : v);

  const series = {
    dates, closes, volumes,
    meta: {
      longName:         meta.longName  || meta.shortName || symbol,
      shortName:        meta.shortName || symbol,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  || null,
      trailingPE:       null,
      dividendYield:    null,
      instrumentType:   meta.instrumentType || "",
    },
  };

  cacheSet(symbol, series);
  return series;
}

async function fetchSocial(symbol) {
  try {
    const res = await fetch(`${ST_BASE}/${encodeURIComponent(symbol)}.json`);
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

// ---- SEC EDGAR earnings reports (Analysis tab) ----
// data.sec.gov is CORS-enabled and accepts browser User-Agents, so we proxy it.
// www.sec.gov blocks browser UAs, so the ticker->CIK map ships as a static file.
const SEC_BASE = "/api/sec";    // -> data.sec.gov
let secTickerMap = null;

async function getCIK(symbol) {
  if (!secTickerMap) {
    try { secTickerMap = await (await fetch("/sec-tickers.json")).json(); }
    catch { secTickerMap = {}; }
  }
  const cik = secTickerMap[symbol];
  return cik != null ? String(cik).padStart(10, "0") : null;
}

function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }

async function fetchEarnings(symbol) {
  const cik = await getCIK(symbol);
  if (!cik) return null;
  const cikNum = String(Number(cik)); // un-padded for archive links

  const subs = await (await fetch(`${SEC_BASE}/submissions/CIK${cik}.json`)).json();
  const r = subs.filings.recent;
  const filings = [];
  for (let i = 0; i < r.form.length && filings.length < 4; i++) {
    if (r.form[i] === "10-Q" || r.form[i] === "10-K") {
      filings.push({
        form: r.form[i], filed: r.filingDate[i], end: r.reportDate[i],
        accn: r.accessionNumber[i], doc: r.primaryDocument[i],
      });
    }
  }

  // Reported diluted EPS, keyed by (accession | period-end), keeping period length.
  const eps = {};
  try {
    const ec = await (await fetch(`${SEC_BASE}/api/xbrl/companyconcept/CIK${cik}/us-gaap/EarningsPerShareDiluted.json`)).json();
    for (const f of (ec.units["USD/shares"] || [])) {
      if (!f.start) continue;
      const key = `${f.accn}|${f.end}`;
      (eps[key] = eps[key] || []).push({ val: f.val, len: daysBetween(f.start, f.end) });
    }
  } catch {}

  for (const f of filings) {
    const arr = eps[`${f.accn}|${f.end}`] || [];
    const target = f.form === "10-K" ? 365 : 90; // annual vs quarter period
    arr.sort((a, b) => Math.abs(a.len - target) - Math.abs(b.len - target));
    f.eps = arr.length ? arr[0].val : null;
    f.url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${f.accn.replace(/-/g, "")}/${f.doc}`;
  }
  return filings;
}

function renderEarnings(filings) {
  const el = document.getElementById("earningsList");
  if (!el) return;
  if (!filings || !filings.length) {
    el.innerHTML = `<div class="text-sm text-muted">No SEC earnings filings found for this symbol (ETFs and non-US tickers have none).</div>`;
    return;
  }
  el.innerHTML = filings.map((f, i) => {
    const prior = filings[i + 1]; // next-older filing
    let cls = "", arrow = "";
    // Only compare like-for-like (quarter vs quarter, annual vs annual) — a 10-K's
    // full-year EPS isn't comparable to an adjacent quarter's.
    if (f.eps != null && prior && prior.eps != null && prior.form === f.form) {
      if (f.eps > prior.eps)      { cls = "positive"; arrow = "▲"; }
      else if (f.eps < prior.eps) { cls = "negative"; arrow = "▼"; }
    }
    const label   = f.form === "10-K" ? "Annual · 10-K" : "Quarter · 10-Q";
    const epsStr  = f.eps != null ? `$${f.eps.toFixed(2)}` : "—";
    return `<a href="${f.url}" target="_blank" rel="noopener noreferrer" class="earnings-card">
      <span class="label">${label}</span>
      <span class="earnings-period">Period ending ${f.end}</span>
      <span class="earnings-eps ${cls}">${epsStr}${arrow ? ` <span class="earnings-arrow">${arrow}</span>` : ""}</span>
      <span class="earnings-eps-label">Diluted EPS</span>
      <span class="earnings-filed">Filed ${f.filed} · View report ↗</span>
    </a>`;
  }).join("");
}

// ---- Analysis tab actions ----
async function analyzeTicker() {
  const symbol = normalizeSymbol(tickerInput.value);
  if (!symbol) { setStatus("Please enter a valid ticker symbol (letters, digits, . - ^).", true); return; }
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

    // Earnings reports (SEC EDGAR) — independent of price data, non-blocking.
    const earnEl = document.getElementById("earningsList");
    if (earnEl) earnEl.innerHTML = `<div class="text-sm text-muted">Loading earnings reports…</div>`;
    fetchEarnings(symbol)
      .then(renderEarnings)
      .catch(() => { if (earnEl) earnEl.innerHTML = `<div class="text-sm text-muted">Earnings reports unavailable.</div>`; });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    searchBtn.disabled = false;
  }
}

searchBtn.addEventListener("click", analyzeTicker);
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
    const nameSpan=document.createElement("span"); nameSpan.textContent=sym; chip.appendChild(nameSpan);
    const btn=document.createElement("button"); btn.textContent="✕";
    btn.addEventListener("click",()=>{ cmpStocks.delete(sym); renderCmpChips(); renderCmpTable(); });
    chip.appendChild(btn); cmpChips.appendChild(chip);
  }
}

async function cmpAddStock() {
  const symbol = normalizeSymbol(cmpTickerInput.value);
  if (!symbol) { setCmpStatus("Please enter a valid ticker symbol (letters, digits, . - ^).", true); return; }
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

// Seed the Compare tab with SPY and QQQ so it isn't empty on first load.
async function initCompareDefaults() {
  for (const sym of ["SPY", "QQQ"]) {
    cmpTickerInput.value = sym;
    await cmpAddStock();
  }
  cmpTickerInput.value = "";
}
initCompareDefaults();

// ---- ETFs tab: curated reference list ----
const ETFS = [
  ["SPY",  "SPDR S&P 500 ETF — tracks the S&P 500 index of large-cap US stocks."],
  ["IVV",  "iShares Core S&P 500 ETF — low-cost S&P 500 index exposure."],
  ["VOO",  "Vanguard S&P 500 ETF — tracks the S&P 500 at a low expense ratio."],
  ["VTI",  "Vanguard Total Stock Market ETF — the entire investable US equity market."],
  ["QQQ",  "Invesco QQQ Trust — tracks the Nasdaq-100, heavy in large-cap tech."],
  ["DIA",  "SPDR Dow Jones Industrial Average ETF — the 30 Dow blue-chip stocks."],
  ["IWM",  "iShares Russell 2000 ETF — US small-cap stocks."],
  ["ITOT", "iShares Core S&P Total US Stock Market ETF — broad US equities."],
  ["VEA",  "Vanguard FTSE Developed Markets ETF — developed international equities ex-US."],
  ["VWO",  "Vanguard FTSE Emerging Markets ETF — emerging-market equities."],
  ["VXUS", "Vanguard Total International Stock ETF — all non-US equities."],
  ["EFA",  "iShares MSCI EAFE ETF — developed markets in Europe, Australasia, Far East."],
  ["EEM",  "iShares MSCI Emerging Markets ETF — large- and mid-cap emerging markets."],
  ["EWJ",  "iShares MSCI Japan ETF — Japanese equities."],
  ["FXI",  "iShares China Large-Cap ETF — large-cap Chinese stocks."],
  ["AGG",  "iShares Core US Aggregate Bond ETF — broad US investment-grade bonds."],
  ["BND",  "Vanguard Total Bond Market ETF — broad US investment-grade bond market."],
  ["BNDX", "Vanguard Total International Bond ETF — non-US investment-grade bonds."],
  ["TLT",  "iShares 20+ Year Treasury Bond ETF — long-dated US Treasuries."],
  ["LQD",  "iShares iBoxx $ Investment Grade Corporate Bond ETF."],
  ["HYG",  "iShares iBoxx $ High Yield Corporate Bond ETF — high-yield 'junk' bonds."],
  ["GLD",  "SPDR Gold Shares — tracks the spot price of gold bullion."],
  ["SLV",  "iShares Silver Trust — tracks the spot price of silver."],
  ["USO",  "United States Oil Fund — tracks WTI crude oil futures."],
  ["GDX",  "VanEck Gold Miners ETF — global gold-mining companies."],
  ["VNQ",  "Vanguard Real Estate ETF — US REITs and real estate companies."],
  ["XLK",  "Technology Select Sector SPDR — S&P 500 technology sector."],
  ["XLF",  "Financial Select Sector SPDR — S&P 500 financials."],
  ["XLE",  "Energy Select Sector SPDR — S&P 500 energy companies."],
  ["XLV",  "Health Care Select Sector SPDR — S&P 500 health care."],
  ["XLY",  "Consumer Discretionary Select Sector SPDR."],
  ["XLP",  "Consumer Staples Select Sector SPDR."],
  ["XLI",  "Industrial Select Sector SPDR."],
  ["XLU",  "Utilities Select Sector SPDR."],
  ["XLB",  "Materials Select Sector SPDR."],
  ["XLRE", "Real Estate Select Sector SPDR."],
  ["XLC",  "Communication Services Select Sector SPDR."],
  ["SOXX", "iShares Semiconductor ETF — US-listed semiconductor companies."],
  ["SMH",  "VanEck Semiconductor ETF — the largest chip makers and equipment firms."],
  ["SOXL", "Direxion Daily Semiconductor Bull 3X — 3x leveraged chip stocks (high risk)."],
  ["SOXS", "Direxion Daily Semiconductor Bear 3X — 3x inverse chip stocks (high risk)."],
  ["VGT",  "Vanguard Information Technology ETF — US tech sector."],
  ["ARKK", "ARK Innovation ETF — actively managed disruptive-innovation growth stocks."],
  ["SCHD", "Schwab US Dividend Equity ETF — high-quality, high-dividend US stocks."],
  ["VIG",  "Vanguard Dividend Appreciation ETF — companies with growing dividends."],
  ["VYM",  "Vanguard High Dividend Yield ETF — above-average dividend-paying US stocks."],
  ["VUG",  "Vanguard Growth ETF — large-cap US growth stocks."],
  ["VTV",  "Vanguard Value ETF — large-cap US value stocks."],
  ["IJR",  "iShares Core S&P Small-Cap ETF."],
  ["IJH",  "iShares Core S&P Mid-Cap ETF."],
  ["TQQQ", "ProShares UltraPro QQQ — 3x leveraged Nasdaq-100 (high risk)."],
  ["SQQQ", "ProShares UltraPro Short QQQ — 3x inverse Nasdaq-100 (high risk)."],
];

const etfBody = document.getElementById("etfBody");
if (etfBody) {
  for (const [sym, desc] of ETFS) {
    const tr = document.createElement("tr");
    const symTd = document.createElement("td");
    const link = document.createElement("button");
    link.className = "etf-link";
    link.textContent = sym;
    link.addEventListener("click", () => {
      tickerInput.value = sym;
      document.querySelector('.tab[data-tab="analysis"]').click();
      window.scrollTo({ top: 0, behavior: "smooth" });
      analyzeTicker();
    });
    symTd.appendChild(link);
    const descTd = document.createElement("td");
    descTd.className = "etf-desc";
    descTd.textContent = desc;
    const volTd = document.createElement("td");
    volTd.className = "etf-vol";
    volTd.id = `etfVol-${sym}`;
    volTd.textContent = "—";
    const trendTd = document.createElement("td");
    trendTd.className = "etf-trend";
    trendTd.id = `etfTrend-${sym}`;
    tr.append(symTd, descTd, volTd, trendTd);
    etfBody.appendChild(tr);
  }
}

// Lazily fetch the latest-day volume for each ETF the first time the tab opens.
// Limited concurrency keeps Yahoo happy; fetchSeries already caches for 24h.
// Compact inline sparkline over the last ~3 months of values, in the given color.
function sparklineSVG(values, color) {
  const data = values.slice(-63).filter(v => v != null); // ~3 months of trading days
  if (data.length < 2) return "";
  const w = 80, h = 18, pad = 2;
  const min = Math.min(...data), max = Math.max(...data), range = (max - min) || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const compactNum = n => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

let etfVolsLoaded = false;
async function loadEtfVolumes() {
  if (etfVolsLoaded) return;
  etfVolsLoaded = true;
  const queue = ETFS.map(([sym]) => sym);
  const volume = {};
  async function worker() {
    while (queue.length) {
      const sym = queue.shift();
      const cell = document.getElementById(`etfVol-${sym}`);
      const trendCell = document.getElementById(`etfTrend-${sym}`);
      if (cell) cell.textContent = "…";
      try {
        const series = await fetchSeries(sym);
        const vols = series.volumes.filter(v => v != null);
        const last = vols[vols.length - 1];
        volume[sym] = last || 0;
        if (cell) cell.textContent = last ? compactNum(last) : "N/A";

        // Trend: price sparkline (green/red) + volume sparkline (amber), both ~3 months.
        const closes = series.closes.filter(v => v != null);
        const vSeries = vols.slice(-63);
        const pWin = closes.slice(-63);
        if (trendCell && pWin.length >= 2) {
          const pChg = ((pWin[pWin.length - 1] - pWin[0]) / pWin[0]) * 100;
          const pUp = pChg >= 0;
          let volRow = "";
          if (vSeries.length >= 6) {
            // Diff recent 5-day avg vs the window's first 5-day avg (spike-resistant).
            const v0 = avg(vSeries.slice(0, 5)), v1 = avg(vSeries.slice(-5));
            const vChg = v0 ? ((v1 - v0) / v0) * 100 : 0;
            volRow = `<div class="trend-row trend-clickable" data-sym="${sym}" data-kind="vol" title="Click to expand">` +
              `<span class="trend-tag">Vol</span>${sparklineSVG(vols, "#fbbf24")}` +
              `<span class="spark-chg muted">${vChg >= 0 ? "+" : ""}${vChg.toFixed(0)}%</span></div>`;
          }
          trendCell.innerHTML =
            `<div class="trend-row trend-clickable" data-sym="${sym}" data-kind="px" title="Click to expand">` +
            `<span class="trend-tag">Px</span>${sparklineSVG(closes, pUp ? "#34d399" : "#fb7185")}` +
            `<span class="spark-chg ${pUp ? "positive" : "negative"}">${pUp ? "+" : ""}${pChg.toFixed(1)}%</span></div>` +
            volRow;
        }
      } catch {
        volume[sym] = -1;
        if (cell) cell.textContent = "N/A";
        if (trendCell) trendCell.textContent = "—";
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));

  // Reorder rows by latest volume, highest first.
  [...ETFS]
    .sort((a, b) => (volume[b[0]] ?? -1) - (volume[a[0]] ?? -1))
    .forEach(([sym]) => {
      const cell = document.getElementById(`etfVol-${sym}`);
      if (cell) etfBody.appendChild(cell.closest("tr"));
    });
}
const etfsTabBtn = document.querySelector('.tab[data-tab="etfs"]');
if (etfsTabBtn) etfsTabBtn.addEventListener("click", loadEtfVolumes);

// ---- Trend detail modal (click a PX / VOL sparkline) ----
let trendModalChart = null;
const trendModal      = document.getElementById("trendModal");
const trendModalTitle = document.getElementById("trendModalTitle");
const trendModalMeta  = document.getElementById("trendModalMeta");
const trendModalClose = document.getElementById("trendModalClose");

async function openTrendModal(sym, kind) {
  if (!trendModal) return;
  const isVol = kind === "vol";
  trendModalTitle.textContent = `${sym} — ${isVol ? "Volume" : "Price"} (5Y)`;
  trendModalMeta.textContent = "Loading…";
  trendModal.classList.add("open");
  document.body.style.overflow = "hidden";
  try {
    const series = await fetchSeries(sym); // cached from the table load
    const labels = series.dates;
    const data   = isVol ? series.volumes : series.closes;
    const color  = isVol ? "#fbbf24" : "#38bdf8";
    if (trendModalChart) trendModalChart.destroy();
    trendModalChart = new Chart(document.getElementById("trendModalChart"), {
      type: isVol ? "bar" : "line",
      data: { labels, datasets: [{
        label: `${sym} ${isVol ? "Volume" : "Close"}`, data,
        borderColor: color, backgroundColor: isVol ? color : "rgba(56,189,248,0.08)",
        fill: !isVol, pointRadius: 0, borderWidth: isVol ? 0 : 2, tension: 0.1,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 12 }, grid: { color: "#1f2940" } },
          y: { ticks: { color: "#94a3b8", callback: v => isVol ? Intl.NumberFormat("en", { notation: "compact" }).format(v) : v }, grid: { color: "#1f2940" } },
        },
        plugins: { legend: { display: false } },
      },
    });
    const valid = data.filter(v => v != null);
    const lo = Math.min(...valid), hi = Math.max(...valid);
    const fmt = v => isVol ? v.toLocaleString() : `$${v.toFixed(2)}`;
    trendModalMeta.textContent = `${labels[0]} → ${labels[labels.length - 1]} · ${valid.length} trading days · range ${fmt(lo)}–${fmt(hi)}`;
  } catch {
    trendModalMeta.textContent = "Could not load data.";
  }
}

function closeTrendModal() {
  if (!trendModal) return;
  trendModal.classList.remove("open");
  document.body.style.overflow = "";
  if (trendModalChart) { trendModalChart.destroy(); trendModalChart = null; }
}

if (trendModalClose) trendModalClose.addEventListener("click", closeTrendModal);
if (trendModal) trendModal.addEventListener("click", e => { if (e.target === trendModal) closeTrendModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTrendModal(); });
if (etfBody) etfBody.addEventListener("click", e => {
  const row = e.target.closest(".trend-clickable");
  if (row && row.dataset.sym) openTrendModal(row.dataset.sym, row.dataset.kind);
});

// ---- Default ticker: load CSGP immediately on open ----
const DEFAULT_TICKER = "GS";
tickerInput.value = DEFAULT_TICKER;
analyzeTicker();
