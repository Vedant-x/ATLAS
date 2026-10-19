// The results history: every finished game the build has seen, from yesterday's scoreboards on each
// build plus a few older days backfilled per build, kept for 180 days in data/results.json and
// carried from build to build. The ratings (ratings.js) are worked out from it; the site itself
// never downloads it. Stored as rows under one header, to keep the file small.
export const FIELDS = ['id', 'lg', 'sport', 't', 'h', 'a', 'hid', 'aid', 'hs', 'as', 'w', 'tour', 'draw'];
export const KEEP_DAYS = 180;
export const BACKFILL_DAYS = 120; // how far back the backfill goes, a few days per build

export const encode = (list) => ({ fields: FIELDS, rows: list.map((g) => FIELDS.map((f) => g[f] ?? null)) });
export function decode(file) {
  const f = file?.fields, rows = file?.rows;
  if (!Array.isArray(f) || !Array.isArray(rows)) return [];
  return rows.map((r) => Object.fromEntries(f.map((k, i) => [k, r[i]]).filter(([, v]) => v != null)));
}

// Old and new together: one row per game (the newer copy wins), none older than KEEP_DAYS.
export function merge(old, fresh, now = Date.now()) {
  const by = new Map();
  for (const g of [...old, ...fresh]) if (g?.id && Number.isFinite(g.t) && g.t > now - KEEP_DAYS * 864e5) by.set(g.id, g);
  return [...by.values()].sort((a, b) => a.t - b.t);
}
