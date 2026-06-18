#!/usr/bin/env python3
import http.server, json, os
import yfinance as yf

PORT = 8080

def json_response(self, data, status=200):
    body = json.dumps(data).encode()
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Access-Control-Allow-Origin", "*")
    self.end_headers()
    self.wfile.write(body)

def fetch_chart(symbol):
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="5y", interval="1d", auto_adjust=True)
    if hist.empty:
        return {"error": f"No data found for {symbol}"}
    info = {}
    try:
        info = ticker.info
    except Exception:
        pass
    dates = [d.strftime("%Y-%m-%d") for d in hist.index]
    closes = [round(float(v), 4) if v == v else None for v in hist["Close"]]
    volumes = [int(v) if v == v else None for v in hist["Volume"]]
    return {
        "dates": dates,
        "closes": closes,
        "volumes": volumes,
        "meta": {
            "longName": info.get("longName", ""),
            "shortName": info.get("shortName", ""),
            "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
            "trailingPE": info.get("trailingPE"),
            "dividendYield": info.get("dividendYield"),
            "instrumentType": info.get("quoteType", ""),
        }
    }

import urllib.request, urllib.parse
ST_BASE = "https://api.stocktwits.com/api/2/streams/symbol"
ST_HEADERS = {"User-Agent": "Mozilla/5.0"}

def fetch_social(symbol):
    try:
        req = urllib.request.Request(f"{ST_BASE}/{symbol}.json", headers=ST_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/chart/"):
            symbol = self.path[len("/api/chart/"):].split("?")[0].upper()
            try:
                json_response(self, fetch_chart(symbol))
            except Exception as e:
                json_response(self, {"error": str(e)}, 500)
        elif self.path.startswith("/api/social/"):
            symbol = self.path[len("/api/social/"):].split("?")[0].upper()
            json_response(self, fetch_social(symbol))
        else:
            super().do_GET()

    def log_message(self, fmt, *args):
        pass

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f"Open http://localhost:{PORT} in your browser")
http.server.HTTPServer(("", PORT), Handler).serve_forever()
