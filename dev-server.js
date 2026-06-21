// Minimal static file server for local preview, with the same /api proxies that
// vercel.json provides in production (so localhost behaves like the deployed site).
// Run: bun run serve
const PORT = Number(process.env.PORT) || 3000;
const ROOT = import.meta.dir;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Same mapping as vercel.json "rewrites".
const PROXIES = {
  "/api/yf/":   "https://query1.finance.yahoo.com/",
  "/api/yf2/":  "https://query2.finance.yahoo.com/",
  "/api/st/":   "https://api.stocktwits.com/",
  "/api/sec/":  "https://data.sec.gov/",
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    // Proxy /api/* to the upstream host, forwarding the path + query string.
    for (const [prefix, target] of Object.entries(PROXIES)) {
      if (pathname.startsWith(prefix)) {
        const upstream = target + pathname.slice(prefix.length) + url.search;
        const res = await fetch(upstream, { headers: { "User-Agent": UA, "Accept": "application/json" } });
        return new Response(res.body, { status: res.status, headers: { "Content-Type": res.headers.get("content-type") || "application/json" } });
      }
    }

    if (pathname === "/") pathname = "/index.html";

    // Resolve safely inside ROOT to avoid path traversal.
    const resolved = `${ROOT}${pathname}`;
    if (!resolved.startsWith(ROOT)) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(resolved);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

console.log(`▶  Stock Analysis dev server: http://localhost:${server.port}`);
