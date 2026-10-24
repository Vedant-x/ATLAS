// Referees' habits (review item 21). Who referees each coming soccer match is read from FotMob's
// match details (the build already reads them for team news); what each referee gives is counted
// from football-data.co.uk's results files, which name the referee of every match with its cards and
// fouls (in the leagues whose files carry a Referee column). Per referee: games, yellow and red cards
// and fouls per game over this season and last, beside the league's own average, so card and foul
// markets can be read against who is in charge. Pure, for tests: the build fetches.
export const FD_RESULTS = (season, div) => `https://www.football-data.co.uk/mmz4281/${season}/${div}.csv`;
// This season's code and last season's: "2627" and "2526" from July 2026.
export function seasonCodes(now = Date.now()) {
  const d = new Date(now), y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const code = (a) => `${String(a).slice(2)}${String(a + 1).slice(2)}`;
  return [code(y), code(y - 1)];
}

// "Michael Oliver" (FotMob, ESPN) and "M Oliver" (football-data) as one key: first initial, surname.
export function refKey(name) {
  const w = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return w.length >= 2 ? `${w[0][0]} ${w.at(-1)}` : w[0] || '';
}

// One results file's matches that name a referee: [{ ref, yellow, red, fouls, result }].
export function parseResults(csv) {
  const lines = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  if (!head.includes('Referee')) return [];
  const n = (r, k) => (r[k] === '' || r[k] == null ? NaN : Number(r[k]));
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const r = Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
    const yellow = n(r, 'HY') + n(r, 'AY'), red = n(r, 'HR') + n(r, 'AR'), fouls = n(r, 'HF') + n(r, 'AF');
    if (!r.Referee || !Number.isFinite(yellow)) continue;
    out.push({ ref: r.Referee, yellow, red: Number.isFinite(red) ? red : 0, fouls: Number.isFinite(fouls) ? fouls : null, result: r.FTR || null });
  }
  return out;
}

// A league's table: its average per game, and each referee's. Fouls only where the files count them.
export function refereeTable(rows) {
  const per = (list) => {
    const f = list.filter((x) => x.fouls != null);
    return { games: list.length, yellow: +(list.reduce((a, x) => a + x.yellow, 0) / list.length).toFixed(2), red: +(list.reduce((a, x) => a + x.red, 0) / list.length).toFixed(3),
      fouls: f.length ? +(f.reduce((a, x) => a + x.fouls, 0) / f.length).toFixed(1) : null, homeWin: +(list.filter((x) => x.result === 'H').length / list.length).toFixed(3) };
  };
  if (!rows.length) return null;
  const by = {};
  for (const x of rows) (by[refKey(x.ref)] ||= { name: x.ref, rows: [] }).rows.push(x);
  return { league: per(rows), refs: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { name: v.name, ...per(v.rows) }])) };
}

// A coming match's referee for the match page: the name, and the record where the files know it.
export function refereeFor(name, table) {
  if (!name) return null;
  const r = table?.refs?.[refKey(name)];
  return r ? { name, games: r.games, yellow: r.yellow, red: r.red, fouls: r.fouls, homeWin: r.homeWin, league: table.league } : { name };
}

// One line for the match page: "4.1 yellow cards a game over 52 games (league 3.7), 0.12 red, 21 fouls (league 22)".
export function refereeLine(r) {
  if (!r?.games) return null;
  const lg = r.league || {};
  return [`${r.yellow.toFixed(1)} yellow cards a game over ${r.games} game${r.games === 1 ? '' : 's'}${lg.yellow != null ? ` (league ${lg.yellow.toFixed(1)})` : ''}`,
    `${r.red.toFixed(2)} red${lg.red != null ? ` (league ${lg.red.toFixed(2)})` : ''}`,
    r.fouls != null ? `${Math.round(r.fouls)} fouls${lg.fouls != null ? ` (league ${Math.round(lg.fouls)})` : ''}` : null,
    r.homeWin != null ? `home side won ${Math.round(r.homeWin * 100)}%${lg.homeWin != null ? ` (league ${Math.round(lg.homeWin * 100)}%)` : ''}` : null].filter(Boolean).join(', ');
}
