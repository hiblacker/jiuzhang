import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function createConsoleServer({ root = fileURLToPath(new URL('./dist/', import.meta.url)), origin = 'http://127.0.0.1:8080' } = {}) {
root = path.resolve(root);
const target = new URL(origin);
if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('INVALID_CONSOLE_API_ORIGIN');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
return http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/v1/')) {
      if (!['GET', 'POST'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const parts = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 1048576) { response.writeHead(413); response.end(); return; } parts.push(chunk); }
      const forwarded = {};
      for (const name of ['accept', 'authorization', 'content-type', 'cookie', 'x-csrf-token', 'x-xsrf-token']) {
        if (request.headers[name]) forwarded[name] = request.headers[name];
      }
      const upstream = await fetch(new URL(url.pathname + url.search, target), {
        method: request.method, redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: forwarded,
        body: request.method === 'POST' ? Buffer.concat(parts) : undefined,
      });
      if (upstream.status >= 300 && upstream.status < 400) throw new Error('UPSTREAM_REDIRECT_REJECTED');
      const upstreamHeaders = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
      const requestId = upstream.headers.get('x-request-id');
      if (requestId) upstreamHeaders['X-Request-Id'] = requestId;
      const cookies = upstream.headers.getSetCookie?.() || [];
      if (cookies.length) upstreamHeaders['Set-Cookie'] = cookies;
      response.writeHead(upstream.status, upstreamHeaders);
      if (upstream.body) for await (const chunk of upstream.body) response.write(chunk);
      response.end(); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let relative;
    try { relative = decodeURIComponent(url.pathname); } catch { response.writeHead(400); response.end(); return; }
    if (relative.includes('\\') || relative.includes('\0')) { response.writeHead(403); response.end(); return; }
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) { response.writeHead(403); response.end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Content-Length', info.size);
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
  } catch {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 'CONSOLE_UPSTREAM_UNAVAILABLE' }));
  }
});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createConsoleServer({ origin: process.env.CONSOLE_API_ORIGIN || 'http://127.0.0.1:8080' });
  server.listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', () => console.log(`Console ready on ${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4173}`));
}
