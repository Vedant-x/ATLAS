// KHL (Kontinental Hockey League) from the league's own app feed, khl.api.webcaster.pro: fixtures,
// live scores with the period, and results. The feed names teams in Russian, so each club is mapped
// by its KHL id to its English name. Records and recent form are counted from the season's results.
// The parsers are pure so they can be tested.

export const KHL_API = 'https://khl.api.webcaster.pro/api/khl_mobile/';

// KHL club id → English name (2026/27 season, 22 clubs).
export const KHL_TEAMS = {
  1: 'Lokomotiv Yaroslavl', 2: 'CSKA Moscow', 7: 'Spartak Moscow', 24: 'SKA St. Petersburg', 25: 'Traktor Chelyabinsk',
  26: 'Torpedo Nizhny Novgorod', 29: 'Sibir Novosibirsk', 34: 'Avangard Omsk', 37: 'Metallurg Magnitogorsk', 38: 'Salavat Yulaev Ufa',
  53: 'Ak Bars Kazan', 54: 'Amur Khabarovsk', 56: 'Severstal Cherepovets', 66: 'Lada Togliatti', 71: 'Neftekhimik Nizhnekamsk',
  190: 'Avtomobilist Yekaterinburg', 198: 'Barys Astana', 207: 'Dinamo Minsk', 418: 'Admiral Vladivostok', 451: 'HC Sochi',
  568: 'Shanghai Dragons', 719: 'Dynamo Moscow',
};
const nameOf = (t) => KHL_TEAMS[t?.khl_id] || [t?.name, t?.location].filter(Boolean).join(' ');
const PERIODS = ['first_period', 'second_period', 'third_period', 'overtime', 'bullitt'];
const pair = (s) => { const m = /^(\d+)\s*:\s*(\d+)$/.exec(String(s || '')); return m ? [Number(m[1]), Number(m[2])] : null; };
const ORD = ['1st', '2nd', '3rd'];

// Live state of one feed event, in the live lane's format. team_a is the home side.
export function khlLive(raw) {
  const e = raw?.event || raw;
  const status = e.game_state_key === 'in_progress' ? 'live' : e.game_state_key === 'finished' ? 'final' : 'pre';
  const sc = pair(e.score);
  const per = PERIODS.map((k) => pair(e.scores?.[k])).filter(Boolean);
  const p = Number(e.period) || null;
  const clock = status === 'final' ? (e.scores?.bullitt ? 'Final (SO)' : e.scores?.overtime ? 'Final (OT)' : 'Final')
    : status === 'live' ? (p && p <= 3 ? `${ORD[p - 1]} period` : p === 4 ? 'Overtime' : p ? 'Shootout' : 'Live') : '';
  return {
    id: `atlas_khl-${e.id}`, status, score: status === 'pre' || !sc ? null : `${sc[0]} – ${sc[1]}`, clock, period: p,
    lines: per.length && status !== 'pre' ? { home: per.map((x) => x[0]), away: per.map((x) => x[1]) } : null,
  };
}

// Each club's record (wins, regulation losses, overtime/shootout losses) and last five results
// (newest last), from finished games.
export function khlRecords(finished) {
  const rec = {};
  const games = finished.map((r) => r?.event || r).filter((e) => e.game_state_key === 'finished' && pair(e.score)).sort((a, b) => a.start_at - b.start_at);
  for (const e of games) {
    const [h, a] = pair(e.score);
    if (h === a) continue;
    const extra = Boolean(e.scores?.overtime || e.scores?.bullitt);
    for (const [t, won] of [[e.team_a?.khl_id, h > a], [e.team_b?.khl_id, a > h]]) {
      const r = (rec[t] ||= { w: 0, l: 0, otl: 0, form: [] });
      if (won) r.w++; else if (extra) r.otl++; else r.l++;
      r.form.push(won ? 'W' : 'L');
      if (r.form.length > 5) r.form.shift();
    }
  }
  return rec;
}

// One feed event as an ATLAS event (no bookmaker prices: the model line comes from the records).
export function khlEvent(raw, records = {}, now = Date.now()) {
  const e = raw?.event || raw;
  const live = khlLive(e);
  const rec = (t) => { const r = records[t?.khl_id]; return r ? `${r.w}-${r.l}-${r.otl}` : null; };
  return {
    id: `atlas_khl-${e.id}`, sport: 'hockey', league: 'KHL', leaguePath: 'atlas/khl', group: 'Pro',
    home: nameOf(e.team_a), away: nameOf(e.team_b), start: Number(e.start_at),
    live: live.status === 'live', score: live.status === 'live' ? live.score : null, clock: live.clock, period: live.period,
    lines: live.status === 'live' ? live.lines : null,
    venue: e.location || null, markets: [], lineups: null, probables: [],
    stats: { homeRecord: rec(e.team_a), awayRecord: rec(e.team_b), homeForm: records[e.team_a?.khl_id]?.form || null, awayForm: records[e.team_b?.khl_id]?.form || null },
    logos: { home: e.team_a?.image || null, away: e.team_b?.image || null },
    note: e.stage_name || null, source: 'KHL official', fetchedAt: now, sourceUrl: e.khl_id ? `https://en.khl.ru/game/${e.khl_id}/` : 'https://en.khl.ru/calendar/',
    khlId: e.khl_id || null,
  };
}
