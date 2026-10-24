// The data contract every page relies on, checked against the real build output (scripts/check-data.mjs,
// run by CI after building against the live feeds), so a feed that changes shape fails a pull request
// instead of quietly breaking the site. Pure: each check returns a list of problems (empty = fine).
import { leagueByPath } from './catalog.js';

const isStr = (x) => typeof x === 'string' && x.trim().length > 0;
const isTime = (t) => Number.isFinite(t) && t > Date.UTC(2020, 0, 1) && t < Date.UTC(2100, 0, 1);

export function checkEvents(events, { minEvents = 0, maxShown = 12 } = {}) {
  const out = [];
  if (!Array.isArray(events)) return ['events is not a list'];
  if (events.length < minEvents) out.push(`only ${events.length} events (expected at least ${minEvents})`);
  const ids = new Set();
  for (const e of events) {
    const at = `${e?.id ?? '?'} (${e?.leaguePath ?? '?'})`;
    if (!isStr(e?.id)) { out.push(`an event has no id: ${JSON.stringify(e).slice(0, 80)}`); continue; }
    if (ids.has(e.id)) out.push(`${at}: duplicate id`);
    ids.add(e.id);
    if (!isStr(e.sport)) out.push(`${at}: no sport`);
    if (!leagueByPath(e.leaguePath)) out.push(`${at}: league not in the catalog`);
    if (!isStr(e.home) || !isStr(e.away)) out.push(`${at}: missing a team name`);
    if (!isTime(e.start)) out.push(`${at}: start time ${e.start} is not a time`);
    for (const m of e.markets || []) {
      if (!isStr(m?.name) || !Array.isArray(m.outcomes) || m.outcomes.length < 2) { out.push(`${at}: market ${m?.name} has fewer than two outcomes`); continue; }
      for (const o of m.outcomes) {
        if (!isStr(o?.name)) out.push(`${at}: ${m.name} has an outcome with no name`);
        if (!(Number.isFinite(o?.odds) && o.odds > 1 && o.odds < 1001)) out.push(`${at}: ${m.name} / ${o?.name} has odds ${o?.odds}`);
        if (o?.cons != null && !(o.cons > 0 && o.cons < 1)) out.push(`${at}: ${m.name} / ${o.name} has a fair chance of ${o.cons}`);
      }
      const cons = m.outcomes.map((o) => o.cons).filter((c) => c != null);
      if (cons.length === m.outcomes.length && Math.abs(cons.reduce((a, b) => a + b, 0) - 1) > 0.02) out.push(`${at}: ${m.name} fair chances add up to ${cons.reduce((a, b) => a + b, 0).toFixed(3)}`);
    }
    for (const p of e.props || []) {
      if (!isStr(p?.player) || !isStr(p?.type) || !(p.odds > 1) || !(p.p > 0 && p.p < 1)) out.push(`${at}: a prop is incomplete: ${JSON.stringify(p).slice(0, 100)}`);
    }
  }
  return out.length > maxShown ? [...out.slice(0, maxShown), `… and ${out.length - maxShown} more`] : out;
}

export function checkSources(report) {
  const out = [];
  if (!Array.isArray(report?.sources) || !report.sources.length) return ['sources.json lists no sources'];
  for (const s of report.sources) {
    if (!isStr(s?.name)) out.push('a source has no name');
    if (![true, false, null].includes(s?.ok)) out.push(`${s?.name}: ok is ${s?.ok}`);
    if (!['ok', 'empty', 'failed', 'paused', 'off'].includes(s?.status)) out.push(`${s?.name}: status ${s?.status}`);
  }
  return out;
}

export function checkHealth(h) {
  const out = [];
  if (typeof h?.ok !== 'boolean') out.push('health.json has no ok flag');
  if (!['ok', 'degraded', 'problem'].includes(h?.level)) out.push(`health.json level is ${h?.level}`);
  if (!Array.isArray(h?.problems) || !Array.isArray(h?.alerts)) out.push('health.json problems or alerts are missing');
  return out;
}
