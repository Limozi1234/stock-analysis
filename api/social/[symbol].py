from http.server import BaseHTTPRequestHandler
import json, urllib.request

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        symbol = self.path.strip("/").split("/")[-1].upper()
        try:
            url = f"https://api.stocktwits.com/api/2/streams/symbol/{symbol}.json"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                body = r.read()
            self.send_response(200)
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode()
            self.send_response(500)

        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
