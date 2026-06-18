from http.server import BaseHTTPRequestHandler
import json, yfinance as yf

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        symbol = self.path.strip("/").split("/")[-1].upper()
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="5y", interval="1d", auto_adjust=True)
            if hist.empty:
                raise ValueError(f"No data found for {symbol}")
            info = {}
            try:
                info = ticker.info
            except Exception:
                pass
            dates = [d.strftime("%Y-%m-%d") for d in hist.index]
            closes = [round(float(v), 4) if v == v else None for v in hist["Close"]]
            volumes = [int(v) if v == v else None for v in hist["Volume"]]
            data = {
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
            body = json.dumps(data).encode()
            self.send_response(200)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode()
            self.send_response(500)

        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
