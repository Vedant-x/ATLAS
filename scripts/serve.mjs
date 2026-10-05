#!/usr/bin/env node
// Local preview of the built site (dist/pages, or the source folder before a build).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = await stat('dist/pages/index.html').then(() => 'dist/pages').catch(() => '.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT) || 8080;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) { res.writeHead(403); res.end('Local access only'); return; }
    const url = new URL(req.url, `http://${host}`);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Read only'); return; }
    const pathname = decodeURIComponent(url.pathname);
    // Only site files: never .env, Git history or scripts.
    const top = new Set(['/', '/index.html', '/favicon.svg', '/manifest.webmanifest', '/sw.js']);
    const asset = /^\/(js|css|vendor|icons|data)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(js|css|json|svg|png)$/.test(pathname) && !pathname.includes('..');
    if (!top.has(pathname) && !asset) { res.writeHead(404); res.end('Not found'); return; }
    const file = join(root, pathname === '/' ? 'index.html' : pathname);
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? '' : body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`ATLAS preview (${root}) on http://127.0.0.1:${port}`));
