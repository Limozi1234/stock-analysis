// Minimal static file server for local preview. Run: bun run serve
// (Production is served as static files by Vercel; this is dev-only.)
const PORT = Number(process.env.PORT) || 3000;
const ROOT = import.meta.dir;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    let pathname = decodeURIComponent(new URL(req.url).pathname);
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
