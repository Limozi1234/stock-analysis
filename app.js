const API_BASE = "https://www.alphavantage.co/query";

const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const tickerInput = document.getElementById("tickerInput");
const searchBtn = document.getElementById("searchBtn");
const compareBtn = document.getElementById("compareBtn");
const statusEl = document.getElementById("status");
const statsSection = document.getElementById("statsSection");
const statPrice = document.getElementById("statPrice");
const statChange = document.getElementById("statChange");
const stat52High = document.getElementById("stat52High");
const stat52Low = document.getElementById("stat52Low");
const statVolume = document.getElementById("statVolume");
const smaToggle = document.getElementById("smaToggle");
const sma200Toggle = document.getElementById("sma200Toggle");
const compareList = document.getElementById("compareList");

let priceChart = null;
let compareChart = null;
let currentSeries = null; // { dates, closes, volumes }
const compareSeries = new Map(); // symbol -> { dates, closes }

// ---- API key handling ----
apiKeyInput.value = localStorage.getItem("av_api_key") || "";
saveKeyBtn.addEventListener("click", () => {
  localStorage.setItem("av_api_key", apiKeyInput.value.trim());
  setStatus("API key saved.");
});

function getApiKey() {
  return localStorage.getItem("av_api_key") || apiKeyInput.value.trim();
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#f87171" : "#94a3b8";
}

// ---- Data fetching ----
async function fetchDailySeries(symbol) {
  const key = getApiKey();
  if (!key) {
    throw new Error("Please enter and save an Alpha Vantage API key first.");
  }
  const url = `${API_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
    symbol
  )}&outputsize=full&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Network error: ${res.status}`);
  const data = await res.json();

  if (data["Note"]) throw new Error("API rate limit hit. Please wait a minute and try again.");
  if (data["Error Message"]) throw new Error(`Invalid symbol: ${symbol}`);
  const series = data["Time Series (Daily)"];
  if (!series) throw new Error("Unexpected API response. Check your API key and symbol.");

  const dates = Object.keys(series).sort(); // ascending
  const closes = dates.map((d) => parseFloat(series[d]["4. close"]));
  const volumes = dates.map((d) => parseFloat(series[d]["5. volume"]));

  return { dates, closes, volumes };
}

function computeSMA(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

// ---- Stats rendering ----
function renderStats(series) {
  const { dates, closes, volumes } = series;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const change = last - prev;
  const changePct = (change / prev) * 100;

  // last 252 trading days (~52 weeks)
  const window = closes.slice(-252);
  const high52 = Math.max(...window);
  const low52 = Math.min(...window);

  statPrice.textContent = `$${last.toFixed(2)}`;
  statChange.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${changePct.toFixed(2)}%)`;
  statChange.className = "value " + (change >= 0 ? "positive" : "negative");
  stat52High.textContent = `$${high52.toFixed(2)}`;
  stat52Low.textContent = `$${low52.toFixed(2)}`;
  statVolume.textContent = volumes[volumes.length - 1].toLocaleString();

  statsSection.hidden = false;
}

// ---- Price chart ----
function renderPriceChart(symbol, series) {
  const { dates, closes } = series;
  // limit to last ~300 points for readability
  const sliceStart = Math.max(0, dates.length - 300);
  const labels = dates.slice(sliceStart);
  const data = closes.slice(sliceStart);

  const datasets = [
    {
      label: `${symbol} Close`,
      data,
      borderColor: "#38bdf8",
      backgroundColor: "transparent",
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.1,
    },
  ];

  if (smaToggle.checked) {
    const sma50Full = computeSMA(closes, 50);
    datasets.push({
      label: "SMA 50",
      data: sma50Full.slice(sliceStart),
      borderColor: "#fbbf24",
      backgroundColor: "transparent",
      pointRadius: 0,
      borderWidth: 1.5,
      tension: 0.1,
    });
  }

  if (sma200Toggle.checked) {
    const sma200Full = computeSMA(closes, 200);
    datasets.push({
      label: "SMA 200",
      data: sma200Full.slice(sliceStart),
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
      plugins: {
        legend: { labels: { color: "#e2e8f0" } },
      },
    },
  });
}

// ---- Compare chart ----
function renderCompareChart() {
  if (compareSeries.size === 0) {
    if (compareChart) {
      compareChart.destroy();
      compareChart = null;
    }
    return;
  }

  const datasets = [];
  const colors = ["#38bdf8", "#fbbf24", "#a78bfa", "#4ade80", "#f87171", "#f472b6"];
  let colorIdx = 0;
  let maxLen = 0;

  for (const [symbol, series] of compareSeries.entries()) {
    maxLen = Math.max(maxLen, series.dates.length);
  }

  let labels = [];
  for (const [symbol, series] of compareSeries.entries()) {
    const sliceStart = Math.max(0, series.dates.length - 300);
    const dates = series.dates.slice(sliceStart);
    const closes = series.closes.slice(sliceStart);
    if (dates.length > labels.length) labels = dates;

    const base = closes[0];
    const normalized = closes.map((c) => ((c - base) / base) * 100);

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
          ticks: {
            color: "#94a3b8",
            callback: (v) => `${v}%`,
          },
          grid: { color: "#334155" },
        },
      },
      plugins: {
        legend: { labels: { color: "#e2e8f0" } },
      },
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

// ---- Main actions ----
async function analyzeTicker() {
  const symbol = tickerInput.value.trim().toUpperCase();
  if (!symbol) {
    setStatus("Please enter a ticker symbol.", true);
    return;
  }
  setStatus(`Loading ${symbol}...`);
  searchBtn.disabled = true;
  try {
    const series = await fetchDailySeries(symbol);
    currentSeries = series;
    currentSeries.symbol = symbol;
    renderStats(series);
    renderPriceChart(symbol, series);
    setStatus(`Loaded ${symbol} (${series.dates.length} trading days).`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    searchBtn.disabled = false;
  }
}

async function addToCompare() {
  const symbol = tickerInput.value.trim().toUpperCase();
  if (!symbol) {
    setStatus("Please enter a ticker symbol.", true);
    return;
  }
  if (compareSeries.has(symbol)) {
    setStatus(`${symbol} already in comparison.`);
    return;
  }
  setStatus(`Loading ${symbol} for comparison...`);
  compareBtn.disabled = true;
  try {
    const series =
      currentSeries && currentSeries.symbol === symbol
        ? currentSeries
        : await fetchDailySeries(symbol);
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
tickerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") analyzeTicker();
});

smaToggle.addEventListener("change", () => {
  if (currentSeries) renderPriceChart(currentSeries.symbol, currentSeries);
});
sma200Toggle.addEventListener("change", () => {
  if (currentSeries) renderPriceChart(currentSeries.symbol, currentSeries);
});
