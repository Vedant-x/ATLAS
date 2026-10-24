// Evidence readiness: whether the information a sport needs before a match can be assessed is in,
// current and consistent. It measures the evidence available, never the chance of winning, so it is
// shown as a status ("Ready", "Waiting for lineup") and never as a percentage.
//
// Each sport lists its checks; every check is ok (true), missing (false) or not covered by any of
// our feeds (null). The overall state is the first one that applies:
//   conflict  two sources disagree on something that matters
//   stale     the price is older than an hour
//   waiting   a confirmation that normally arrives before the start is not in yet
//   unknown   there is a price but no time on it, so its freshness can't be checked
//   limited   our feeds do not cover something the sport needs (said plainly, never hidden)
//   ready     everything the sport needs is in
//   none      no price and nothing else to go on

const H = 36e5;
export const READY_LABEL = {
  ready: 'Ready to assess', waiting: 'Waiting', stale: 'Stale price', conflict: 'Conflicting reports', unknown: 'Freshness unknown', limited: 'Limited coverage', none: 'Insufficient data',
};

const starterName = (p) => p?.report?.name || p?.name || (p?.npbId || p?.kboId ? 'announced' : '');
const side = (e, s) => (e.probables || []).find((p) => p.side === s);

// The checks for one sport. `ctx.priceAt` is when prices were last fetched.
function checks(e, now) {
  const soon = e.start - now;
  const out = [];
  const add = (key, label, ok, note = '', waitable = false) => out.push({ key, label, ok, note, waitable });
  const lu = e.absences?.lineup;
  switch (e.sport) {
    case 'baseball': {
      const h = starterName(side(e, 'home')), a = starterName(side(e, 'away'));
      add('starters', 'Starting pitchers', Boolean(h && a), h && a ? `${h} v ${a}` : h || a ? 'only one side announced' : 'not announced yet', true);
      add('lineup', 'Batting orders', e.lineups ? true : null, e.lineups ? 'published' : 'loaded on the match page about an hour before');
      break;
    }
    case 'football': {
      const type = lu?.type;
      const confirmed = type && !['lastStarting11', 'predicted'].includes(type);
      add('lineup', 'Starting XIs', lu ? (confirmed ? true : false) : null, confirmed ? 'confirmed' : type === 'predicted' ? 'predicted only' : type === 'lastStarting11' ? 'last match\'s XI only' : 'no lineup feed for this league', true);
      add('absences', 'Injuries and suspensions', e.absences ? true : null, e.absences ? `${(e.absences.home?.length || 0) + (e.absences.away?.length || 0)} listed` : 'no team-news feed for this league');
      break;
    }
    case 'hockey': {
      // Daily Faceoff's starters (goalies.js): confirmed for both, or waiting on the confirmation.
      const g = e.goalies, sure = (x) => /confirm/i.test(x?.status || '');
      if (g) add('goalies', 'Starting goalies', sure(g.home) && sure(g.away) ? true : false, `${g.home.name} (${(g.home.status || 'unconfirmed').toLowerCase()}) v ${g.away.name} (${(g.away.status || 'unconfirmed').toLowerCase()})`, true);
      else add('goalies', 'Starting goalies', null, e.leaguePath === 'hockey/nhl' ? 'not reported yet' : 'no starting-goalie feed for this league');
      break;
    }
    case 'basketball': case 'americanfootball': {
      // A dated injury list from the build (ESPN for prop leagues, Sleeper for the NFL), else the
      // match page checks it live.
      const inj = e.injuries, at = Number.isFinite(inj?.at) ? inj.at : null;
      if (inj && at) add('injuries', 'Injury report', now - at <= injuryLimit(e.start - now), `${inj.source || 'feed'}: ${(inj.home?.length || 0) + (inj.away?.length || 0)} listed, read ${Math.max(0, Math.round((now - at) / 36e5))} h ago`);
      else add('injuries', 'Injury report', null, 'checked live when the match page opens');
      break;
    }
    case 'tennis': {
      const t = e.tennis, ranked = t?.home?.seed != null || t?.away?.seed != null || e.ranks;
      add('ranks', 'Rankings / seeds', ranked ? true : null, ranked ? 'known' : 'not in the feed');
      add('surface', 'Surface-adjusted form', null, 'not covered yet');
      break;
    }
    case 'cricket':
      add('toss', 'Toss and XIs', soon < 0 ? true : false, soon < 0 ? 'decided' : 'decided about 30 minutes before the start', true);
      break;
    case 'esports':
      add('rosters', 'Rosters / stand-ins', null, 'not covered yet');
      add('format', 'Series format', e.bestOf ? true : null, e.bestOf ? `best of ${e.bestOf}` : 'unknown');
      break;
    case 'efootball':
      add('form', 'Player form', e.stats?.homePlayer && e.stats?.awayPlayer ? true : null, e.stats?.homePlayer ? 'recent results known' : 'no form data');
      break;
    default:
      break;
  }
  return out;
}

// How old a price may be before it is stale: tighter as the start nears (prices move most in the
// last hours: team news, lineups, sharp money) and for sports whose markets move fast (tennis,
// esports, small leagues priced by few books). Minutes.
export function priceLimit(sport, msToStart) {
  const h = msToStart / 36e5;
  const base = h > 24 ? 360 : h > 6 ? 120 : h > 1 ? 60 : 20;
  return ['tennis', 'esports', 'efootball', 'mma'].includes(sport) ? Math.round(base / 2) : base;
}
// How old an injury report may be: 12 hours, 2 hours on game day (inside 6 hours of the start).
export const injuryLimit = (msToStart) => (msToStart < 6 * 36e5 ? 2 : 12) * 36e5;

export function readiness(e, { now = Date.now(), priceAt = null } = {}) {
  const priced = Boolean(e.markets?.length);
  const list = checks(e, now);
  // The quote's own time when the feed gives one (Odds API), else when our prices were fetched.
  const at = e.priceAt ?? priceAt;
  const ageMin = priced && at ? Math.round((now - at) / 6e4) : null;
  const limit = priceLimit(e.sport, e.start - now);
  list.unshift({ key: 'price', label: 'Bookmaker price', ok: priced ? (ageMin == null ? null : ageMin <= limit) : false, note: priced ? (ageMin == null ? 'offered, but the time it was checked is unknown' : `checked ${ageMin < 1 ? 'just now' : `${ageMin} min ago`} (limit ${limit} min at this distance from the start)`) : 'no price for this match' });
  // Two sides announced with the same starter name, or a starter also listed as out: reports disagree.
  const outNames = new Set(['home', 'away'].flatMap((s) => (e.absences?.[s] || []).map((x) => String(x.name).toLowerCase())));
  const conflict = (e.probables || []).some((p) => outNames.has(String(starterName(p)).toLowerCase()));
  let state;
  const soon = e.start - now;
  if (conflict) state = 'conflict';
  else if (priced && ageMin != null && ageMin > limit) state = 'stale';
  else if (list.some((c) => c.ok === false && c.waitable && soon > -H)) state = 'waiting';
  else if (priced && ageMin == null) state = 'unknown';
  else if (!priced && !list.some((c) => c.ok)) state = 'none';
  else if (list.some((c) => c.ok === null) || !priced) state = 'limited';
  else state = 'ready';
  const waitingOn = list.filter((c) => c.ok === false && c.waitable).map((c) => c.label.toLowerCase());
  const label = state === 'waiting' ? `Waiting for ${waitingOn[0] || 'confirmation'}` : READY_LABEL[state];
  return { state, label, checks: list, missing: list.filter((c) => c.ok === false).map((c) => c.label), uncovered: list.filter((c) => c.ok === null).map((c) => c.label) };
}

// Sort weight: ready first, then waiting, freshness unknown, limited, stale, conflict, none.
export const READY_ORDER = { ready: 0, waiting: 1, unknown: 2, limited: 3, stale: 4, conflict: 5, none: 6 };
export const readyBadge = (r) => `<span class="ready ready-${r.state}" data-tip="${r.checks.map((c) => `${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'} ${c.label}: ${c.note}`).join('\n').replace(/"/g, '&quot;')}">${r.label}</span>`;

// When a match's price was quoted: the quote's own time (Odds API, football-data.co.uk), else the
// time the feed carrying it was read. Never the site's build time: null means freshness unknown.
export const priceTime = (e) => e?.priceAt ?? (e?.markets?.length ? e.fetchedAt ?? null : null);
