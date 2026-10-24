#!/usr/bin/env node
// Checks a build's data against the contract the pages rely on (js/contract.js). CI runs it after the
// build against the live feeds: a feed that changes shape fails the pull request.
//   node scripts/check-data.mjs <data dir> [--min-events N]
import { readFile } from 'node:fs/promises';
import { checkEvents, checkSources, checkHealth } from '../js/contract.js';

const dir = process.argv[2] || 'dist/pages/data';
const minIdx = process.argv.indexOf('--min-events');
const minEvents = minIdx > 0 ? Number(process.argv[minIdx + 1]) : 0;
const read = async (f) => JSON.parse(await readFile(`${dir}/${f}`, 'utf8'));
const index = await read('index.json');
const problems = [
  ...checkEvents(index.events, { minEvents }).map((p) => `index.json: ${p}`),
  ...checkSources(await read('sources.json')).map((p) => `sources.json: ${p}`),
  ...checkHealth(await read('health.json')).map((p) => `health.json: ${p}`),
];
const priced = index.events.filter((e) => e.markets?.length).length, sharp = index.events.filter((e) => e.markets?.some((m) => m.consensusFrom)).length;
console.log(`Data contract: ${index.events.length} events (${priced} priced, ${sharp} with a sharp line), ${problems.length} problem(s)`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length ? 1 : 0);
