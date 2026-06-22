// Vercel serverless function: proxy filing documents from www.sec.gov.
//
// www.sec.gov serves the actual DEF 14A / filing HTML, but enforces SEC's fair-
// access policy — requests without a contact-declaring User-Agent get a 403.
// vercel.json "rewrites" can't inject a custom UA, so this small function does.
// Locally, dev-server.js handles the same /api/secwww/* path.
//
// Routed automatically by Vercel: /api/secwww/<...> -> this catch-all function.
const SEC_UA = "Buy The Trend Research limozi888@gmail.com";

export default async function handler(req, res) {
  const parts = req.query.path;
  const path = (Array.isArray(parts) ? parts.join("/") : parts || "").replace(/^\/+/, "");

  // Allowlist EDGAR archive documents only — never proxy arbitrary SEC paths.
  if (!/^Archives\/edgar\//.test(path)) {
    res.status(400).send("Only /Archives/edgar/ paths are permitted.");
    return;
  }

  try {
    const upstream = await fetch(`https://www.sec.gov/${path}`, {
      headers: { "User-Agent": SEC_UA, "Accept": "text/html,application/xhtml+xml,*/*" },
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.send(body);
  } catch (err) {
    res.status(502).send(`Upstream fetch failed: ${err.message}`);
  }
}
