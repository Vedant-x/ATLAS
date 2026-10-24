// A source that keeps failing is tried less often. After `after` failed builds in a row it is tried
// once every `every` (6 hours) until it works again; the builds in between skip it and say so on the
// Sources page. ClubElo answered 502 and Tennis Abstract 403 on every build for days: each build spent
// half a minute on requests that could not work, and their failures hid among the real ones.
// prev: the source's entry in the previous build's data/sources.json.
export const BREAKER = { after: 3, every: 6 * 36e5 };
export function breaker(prev, { now = Date.now(), after = BREAKER.after, every = BREAKER.every } = {}) {
  const streak = prev?.ok === false ? prev.failStreak || 1 : 0;
  if (streak < after) return { skip: false, streak };
  const tried = prev.lastAttemptAt ?? prev.at ?? 0;
  return now - tried < every ? { skip: true, streak, next: tried + every } : { skip: false, streak };
}

// A source's run record across builds: when it was last tried and last worked, how many builds in a
// row it has failed, and what kind of failure it was. A skipped source keeps its last real attempt.
export function carryStatus(x, p) {
  x.lastAttemptAt = x.skipped ? p?.lastAttemptAt ?? p?.at ?? null : x.at;
  x.lastSuccessAt = x.ok === true ? x.at : p?.lastSuccessAt ?? (p?.ok === true ? p.at : null);
  x.failStreak = x.ok === false ? (p?.ok === false ? p.failStreak || 1 : 0) + (x.skipped ? 0 : 1) : 0;
  x.lastError = x.ok === false ? (x.skipped ? p?.lastError ?? p?.note ?? null : x.note) : null;
  // When the current run of failures began (the first failed build after the last success).
  x.downSince = x.ok === false ? (p?.ok === false ? p.downSince ?? p.lastAttemptAt ?? p.at ?? x.at : x.at) : null;
  x.status = x.ok === true ? (x.count === 0 ? 'empty' : 'ok') : x.ok === false ? (x.skipped ? 'paused' : 'failed') : 'off';
  return x;
}
