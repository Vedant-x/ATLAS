// What ATLAS actually knows about each sport's upcoming matches, field by field, so a tracked fixture
// is never mistaken for an assessed one. Each field is available (nearly every match), partial (some),
// stale (in, but old) or unavailable (none). Pure, so it can be tested.
import { winProbs } from './models.js';

const H = 36e5;
const status = (n, of) => (!of || !n ? 'unavailable' : n / of >= 0.8 ? 'available' : 'partial');
const newest = (list, f) => list.reduce((t, x) => Math.max(t, f(x) || 0), 0);

export const COVERAGE_FIELDS = [
  ['fixtures', 'Fixtures'], ['prices', 'Prices'], ['news', 'Team news'], ['lineups', 'Lineups'],
  ['players', 'Player history'], ['model', 'Model (unpriced)'], ['updated', 'Updated'],
];

// events: the board. Returns { [sport]: { n, fields: { key: { state, note } } } } for matches live or
// starting within `hours`.
export function coverage(events, { now = Date.now(), hours = 48, fetchedAt = 0 } = {}) {
  const by = {};
  for (const e of events) if (e.live || (e.start > now && e.start < now + hours * H)) (by[e.sport] ||= []).push(e);
  const out = {};
  for (const [sport, list] of Object.entries(by)) {
    const n = list.length;
    const priced = list.filter((e) => e.markets?.length);
    const news = list.filter((e) => e.absences || e.injuries || Number.isFinite(e.injuryChecked));
    const lineups = list.filter((e) => e.absences?.lineup || e.lineups || (e.probables || []).some((p) => p.report?.name || p.name));
    const withProps = list.filter((e) => e.props?.length);
    const withHist = withProps.filter((e) => e.props.some((x) => x.hist));
    const unpriced = list.filter((e) => !e.markets?.length);
    const modelled = unpriced.filter((e) => winProbs(e).confidence === 'medium');
    const last = newest(list, (e) => e.fetchedAt) || fetchedAt || 0;
    const age = last ? (now - last) / H : null;
    const priceAge = priced.length ? (now - (newest(priced, (e) => e.fetchedAt) || fetchedAt || now)) / H : null;
    const f = {};
    f.fixtures = { state: 'available', note: `${n} match${n === 1 ? '' : 'es'}` };
    f.prices = { state: priceAge != null && priceAge > 2 ? 'stale' : status(priced.length, n), note: `${priced.length} of ${n} priced` };
    f.news = { state: status(news.length, n), note: news.length ? `${news.length} of ${n}` : 'no feed' };
    f.lineups = { state: status(lineups.length, n), note: lineups.length ? `${lineups.length} of ${n}` : 'none' };
    f.players = withProps.length ? { state: status(withHist.length, withProps.length), note: `${withHist.length} of ${withProps.length}` } : { state: 'unavailable', note: 'no player lines' };
    f.model = unpriced.length ? { state: status(modelled.length, unpriced.length), note: `${modelled.length} of ${unpriced.length} rated` } : { state: 'available', note: 'all priced' };
    f.updated = { state: age == null ? 'unavailable' : age > 2 ? 'stale' : 'available', note: age == null ? 'time unknown' : age < 1 ? `${Math.max(0, Math.round(age * 60))} min ago` : `${Math.round(age)} h ago` };
    out[sport] = { n, fields: f };
  }
  return out;
}
