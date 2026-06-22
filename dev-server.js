// Minimal static file server for local preview, with the same /api proxies that
// vercel.json provides in production (so localhost behaves like the deployed site).
// Run: bun run serve
const PORT = Number(process.env.PORT) || 3000;
const ROOT = import.meta.dir;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// SEC's fair-access policy requires a User-Agent that declares a contact; browser
// UAs are 403'd by www.sec.gov. data.sec.gov (and the others) accept the browser UA.
const SEC_UA = "Buy The Trend Research limozi888@gmail.com";

// Same mapping as vercel.json "rewrites" (plus /api/secwww, served in prod by the
// api/secwww serverless function). Each entry: [upstream base, User-Agent].
const PROXIES = {
  "/api/yf/":     ["https://query1.finance.yahoo.com/", UA],
  "/api/yf2/":    ["https://query2.finance.yahoo.com/", UA],
  "/api/st/":     ["https://api.stocktwits.com/", UA],
  "/api/sec/":    ["https://data.sec.gov/", UA],
  "/api/secwww/": ["https://www.sec.gov/", SEC_UA],
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    // Proxy /api/* to the upstream host, forwarding the path + query string.
    for (const [prefix, [target, ua]] of Object.entries(PROXIES)) {
      if (pathname.startsWith(prefix)) {
        const upstream = target + pathname.slice(prefix.length) + url.search;
        const res = await fetch(upstream, { headers: { "User-Agent": ua, "Accept": "*/*" } });
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
