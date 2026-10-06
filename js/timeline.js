// The evidence timeline in the browser: material changes recorded by the build (data/changes.json),
// what is new since your last visit, and which of your watched matches need another look because
// something material changed after you last opened them.
const LV = 'atlas-last-visit', RV = 'atlas-reviewed';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

// "Since your last visit" means since the previous session: fixed at load, and the stored time moves
// on only after you have been here a minute, so a quick reload does not wipe the list.
const previousVisit = read(LV, null);
setTimeout(() => write(LV, Date.now()), 60e3);
export const lastVisit = () => previousVisit;

let cache = null, loading = null;
export function loadTimeline(refresh) {
  if (cache && Date.now() - cache.at < 5 * 6e4) return Promise.resolve(cache.data);
  if (!loading) {
    loading = fetch(`data/changes.json?t=${Math.floor(Date.now() / 6e4)}`).then((r) => (r.ok ? r.json() : { changes: [] }))
      .catch(() => ({ changes: [] }))
      .then((data) => { const before = cache?.data.updatedAt; cache = { at: Date.now(), data }; loading = null; if (data.updatedAt !== before) refresh?.(); return data; });
  }
  return loading;
}
export const timeline = () => cache?.data.changes || [];
export const timelineUpdatedAt = () => cache?.data.updatedAt || null;
export const changesFor = (eventId) => timeline().filter((c) => c.eventId === eventId).sort((a, b) => b.at - a.at);
export const latestChange = (eventId) => changesFor(eventId)[0] || null;
export const changesSince = (t) => timeline().filter((c) => !t || c.at > t).sort((a, b) => b.at - a.at);

// Opening a match marks it reviewed; a material change after that flags it "needs review".
export function markReviewed(eventId) { const r = read(RV, {}); r[eventId] = Date.now(); write(RV, r); }
export function needsReview(eventId) {
  const seen = read(RV, {})[eventId] || 0;
  return changesFor(eventId).filter((c) => c.at > seen && c.kind !== 'time');
}
