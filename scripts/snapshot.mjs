#!/usr/bin/env node
// Writes data/odds.json from ESPN. The site falls back to this snapshot when a visitor's
// browser can't reach ESPN directly. Run by .github/workflows/deploy.yml.
import { writeFile, mkdir } from 'node:fs/promises';
import { fetchAll } from '../js/espn.js';

const events = await fetchAll(AbortSignal.timeout(30000));
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/odds.json', import.meta.url),
  JSON.stringify({ source: 'ESPN snapshot', fetchedAt: Date.now(), events }));
console.log(`snapshot: ${events.length} events`);
