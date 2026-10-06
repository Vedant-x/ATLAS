// Evidence readiness: whether the information a sport needs before a match can be assessed is in,
// current and consistent. It measures the evidence available, never the chance of winning, so it is
// shown as a status ("Ready", "Waiting for lineup") and never as a percentage.
//
// Each sport lists its checks; every check is ok (true), missing (false) or not covered by any of
// our feeds (null). The overall state is the first one that applies:
//   conflict  two sources disagree on something that matters
//   stale     the price is older than an hour
//   waiting   a confirmation that normally arrives before the start is not in yet
//   limited   our feeds do not cover something the sport needs (said plainly, never hidden)
//   ready     everything the sport needs is in
//   none      no price and nothing else to go on

const H = 36e5;
export const READY_LABEL = {
  ready: 'Ready to assess', waiting: 'Waiting', stale: 'Stale price', conflict: 'Conflicting reports', limited: 'Limited coverage', none: 'Insufficient data',
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
    case 'hockey':
      add('goalies', 'Starting goalies', null, 'no confirmed-goalie feed yet');
      break;
    case 'basketball': case 'americanfootball':
      add('injuries', 'Injury report', null, 'checked live when the match page opens');
      break;
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

export function readiness(e, { now = Date.now(), priceAt = null } = {}) {
  const priced = Boolean(e.markets?.length);
  const list = checks(e, now);
  const ageMin = priced && priceAt ? Math.round((now - priceAt) / 6e4) : null;
  list.unshift({ key: 'price', label: 'Bookmaker price', ok: priced ? (ageMin == null || ageMin <= 60) : false, note: priced ? (ageMin == null ? 'available' : `checked ${ageMin < 1 ? 'just now' : `${ageMin} min ago`}`) : 'no price for this match' });
  // Two sides announced with the same starter name, or a starter also listed as out: reports disagree.
  const outNames = new Set(['home', 'away'].flatMap((s) => (e.absences?.[s] || []).map((x) => String(x.name).toLowerCase())));
  const conflict = (e.probables || []).some((p) => outNames.has(String(starterName(p)).toLowerCase()));
  let state;
  const soon = e.start - now;
  if (conflict) state = 'conflict';
  else if (priced && ageMin != null && ageMin > 60) state = 'stale';
  else if (list.some((c) => c.ok === false && c.waitable && soon > -H)) state = 'waiting';
  else if (!priced && !list.some((c) => c.ok)) state = 'none';
  else if (list.some((c) => c.ok === null) || !priced) state = 'limited';
  else state = 'ready';
  const waitingOn = list.filter((c) => c.ok === false && c.waitable).map((c) => c.label.toLowerCase());
  const label = state === 'waiting' ? `Waiting for ${waitingOn[0] || 'confirmation'}` : READY_LABEL[state];
  return { state, label, checks: list, missing: list.filter((c) => c.ok === false).map((c) => c.label), uncovered: list.filter((c) => c.ok === null).map((c) => c.label) };
}

// Sort weight: ready first, then waiting, limited, stale, conflict, none.
export const READY_ORDER = { ready: 0, waiting: 1, limited: 2, stale: 3, conflict: 4, none: 5 };
export const readyBadge = (r) => `<span class="ready ready-${r.state}" title="${r.checks.map((c) => `${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'} ${c.label}: ${c.note}`).join('\n').replace(/"/g, '&quot;')}">${r.label}</span>`;
