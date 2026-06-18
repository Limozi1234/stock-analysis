from http.server import BaseHTTPRequestHandler
import json, yfinance as yf

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        symbol = self.path.strip("/").split("/")[-1].upper()
        try:
            ticker = yf.Ticker(symbol)

            # history is fast; info is slow — fetch with a separate short-lived call
            hist = ticker.history(period="5y", interval="1d", auto_adjust=True)
            if hist.empty:
                raise ValueError(f"No data found for {symbol}")

            # fast_info is much quicker than ticker.info
            fi = ticker.fast_info
            info = {}
            try:
                info = {
                    "longName":          getattr(fi, "company_name", "") or "",
                    "shortName":         getattr(fi, "company_name", "") or "",
                    "fiftyTwoWeekHigh":  getattr(fi, "fifty_two_week_high", None),
                    "fiftyTwoWeekLow":   getattr(fi, "fifty_two_week_low",  None),
                    "trailingPE":        getattr(fi, "pe_forward",           None),  # fallback
                    "dividendYield":     getattr(fi, "last_volume",          None),  # not in fast_info; set below
                    "instrumentType":    getattr(fi, "quote_type",           ""),
                }
                # trailingPE and dividendYield aren't in fast_info; try ticker.info quickly
                try:
                    slow = ticker.info
                    info["longName"]      = slow.get("longName",      info["longName"])
                    info["shortName"]     = slow.get("shortName",     info["shortName"])
                    info["trailingPE"]    = slow.get("trailingPE",    None)
                    info["dividendYield"] = slow.get("dividendYield", None)
                except Exception:
                    info["trailingPE"]    = None
                    info["dividendYield"] = None
            except Exception:
                pass

            dates   = [d.strftime("%Y-%m-%d") for d in hist.index]
            closes  = [round(float(v), 4) if v == v else None for v in hist["Close"]]
            volumes = [int(v)              if v == v else None for v in hist["Volume"]]

            data = {"dates": dates, "closes": closes, "volumes": volumes, "meta": info}
            body = json.dumps(data).encode()
            self.send_response(200)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode()
            self.send_response(500)

        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
