// What the pages say about thin or missing evidence, as pure functions (tested in node).
//  - recordText: a list's record. Below MIN_EVIDENCE settled picks a hit rate and an ROI say nothing
//    (1-0 is not "100%, +37%"), so the line leads with the count and says so.
//  - feedText: a league with nothing to show. An empty schedule only when its feed answered with
//    none; a feed that failed, or a paused feed, is unavailable, never "no fixtures".
export const MIN_EVIDENCE = 30;
const pct0 = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const units = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}u`;
export function recordText(st) {
  if (!st || !(st.won + st.lost)) return '';
  const n = st.won + st.lost;
  if (n < MIN_EVIDENCE) return `${n} settled pick${n === 1 ? '' : 's'} (${st.won}–${st.lost}): too few to judge yet`;
  return `${st.won}–${st.lost} · ${pct0(st.hitRate)} hit rate · <span class="${st.profit >= 0 ? 'pos' : 'neg'}">${units(st.profit)} (ROI ${st.roi == null ? '—' : `${st.roi >= 0 ? '+' : ''}${(st.roi * 100).toFixed(1)}%`})</span>`;
}
export function feedText({ known = false, failed = false, paused = false, builtAgo = null } = {}) {
  if (known) return 'No fixtures in the next 4 days';
  if (failed || paused) return `Feed temporarily unavailable; showing the last successful snapshot${builtAgo ? ` (built ${builtAgo})` : ''}`;
  return 'Loading fixtures…';
}
