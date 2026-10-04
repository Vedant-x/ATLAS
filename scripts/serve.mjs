#!/usr/bin/env node
// Local preview plus a server-only Stake collector. Set ODDS_API_KEY in the environment.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { collectStake } from './stake-provider.mjs';
const root = await stat('dist/pages/index.html').then(() => 'dist/pages').catch(() => '.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT) || 8080;
let cached, checked = 0, pending;
async function stake() {
  if (cached && Date.now() - checked < 60000) return cached;
  if (!pending) pending = collectStake().then(d => { cached = d; checked = Date.now(); return d; }).finally(() => { pending = null; });
  return pending;
}
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) { res.writeHead(403); res.end('Local access only'); return; }
    const url = new URL(req.url, `http://${host}`);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Read only'); return; }
    if (url.pathname === '/api/stake-odds') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) { res.writeHead(403); res.end('Origin not allowed'); return; }
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
      res.end(req.method === 'HEAD' ? '' : JSON.stringify(await stake())); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    // Never expose .env, Git history, source collector scripts or server credentials.
    const top = new Set(['/', '/index.html', '/favicon.svg', '/manifest.webmanifest', '/sw.js']);
    const asset = /^\/(js|css|vendor|icons|data)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(js|css|json|svg|png)$/.test(pathname) && !pathname.includes('..');
    if (!top.has(pathname) && !asset) { res.writeHead(404); res.end('Not found'); return; }
    const file = join(root, pathname === '/' ? 'index.html' : pathname);
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? '' : body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`ATLAS preview (${root}) on http://127.0.0.1:${port}`));
