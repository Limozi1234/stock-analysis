from http.server import BaseHTTPRequestHandler
import json
import yfinance as yf

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        symbol = self.path.strip("/").split("/")[-1].upper()
        try:
            ticker = yf.Ticker(symbol)
            # 2y keeps response fast on Vercel free tier; local server.py still uses 5y
            hist = ticker.history(period="2y", interval="1d", auto_adjust=True)
            if hist.empty:
                raise ValueError(f"No data found for {symbol}")

            fi = ticker.fast_info
            dates   = [d.strftime("%Y-%m-%d") for d in hist.index]
            closes  = [round(float(v), 4) if v == v else None for v in hist["Close"]]
            volumes = [int(v)              if v == v else None for v in hist["Volume"]]

            data = {
                "dates": dates,
                "closes": closes,
                "volumes": volumes,
                "meta": {
                    "longName":         getattr(fi, "company_name", "") or symbol,
                    "shortName":        getattr(fi, "company_name", "") or symbol,
                    "fiftyTwoWeekHigh": getattr(fi, "fifty_two_week_high", None),
                    "fiftyTwoWeekLow":  getattr(fi, "fifty_two_week_low",  None),
                    "trailingPE":       None,
                    "dividendYield":    None,
                    "instrumentType":   getattr(fi, "quote_type", ""),
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
