#!/usr/bin/env node
// Builds the static GitHub Pages site into dist/pages: the 3D dashboard plus an ESPN snapshot
// (data/odds.json) that the page falls back to if a visitor's browser can't reach ESPN directly.
// The research desk, Stake odds and Aura need the Node server, so they are not published here.
import { mkdir, copyFile, cp, writeFile, rm } from 'node:fs/promises';
import { fetchAll } from '../js/espn.js';

const out = 'dist/pages';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/data`, { recursive: true });
for (const f of ['index.html', 'favicon.svg']) await copyFile(f, `${out}/${f}`);
for (const d of ['js', 'css', 'vendor']) await cp(d, `${out}/${d}`, { recursive: true });
await writeFile(`${out}/.nojekyll`, '');

let events = [];
try { events = await fetchAll(AbortSignal.timeout(30000)); } catch (e) { console.warn(`ESPN snapshot failed: ${e.message}`); }
await writeFile(`${out}/data/odds.json`, JSON.stringify({ source: 'ESPN snapshot', fetchedAt: Date.now(), events }));
console.log(`Pages build: ${events.length} events in snapshot`);
