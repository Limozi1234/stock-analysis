// Vercel Edge Middleware: proxy filing documents from www.sec.gov.
//
// www.sec.gov serves the DEF 14A / filing HTML but enforces SEC's fair-access
// policy — requests without a contact-declaring User-Agent get a 403. Browsers
// can't set User-Agent and vercel.json "rewrites" can't inject one, so this runs
// server-side and adds it.
//
// Why middleware and not an /api function: this project deploys as a fully static
// site (outputDirectory "."), which makes Vercel treat /api/*.js as static assets
// rather than building them as Serverless Functions. Edge Middleware is detected
// from this root middleware.js regardless of outputDirectory, so it's the one
// server-side hook that coexists with the static deploy. Locally, dev-server.js
// serves the same /api/secwww/* path.
export const config = { matcher: "/api/secwww/:path*" };

const SEC_UA = "Buy The Trend Research limozi888@gmail.com";

export default async function middleware(request) {
  const { pathname } = new URL(request.url);
  const path = pathname.replace(/^\/api\/secwww\//, "").replace(/^\/+/, "");

  // Allowlist EDGAR archive documents only — never proxy arbitrary SEC paths.
  if (!/^Archives\/edgar\//.test(path)) {
    return new Response("Only /Archives/edgar/ paths are permitted.", { status: 400 });
  }

  const upstream = await fetch(`https://www.sec.gov/${path}`, {
    headers: { "User-Agent": SEC_UA, "Accept": "text/html,application/xhtml+xml,*/*" },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "text/html; charset=utf-8",
      "cache-control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
