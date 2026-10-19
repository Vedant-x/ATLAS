// League tables in one familiar order, whatever order ESPN's feed lists its stats in: games played,
// won, drawn, lost, then goals for and against, goal difference and points (soccer), or the US
// columns (overtime losses, win %, games behind, streak) where a sport has them. ESPN's own rank and
// "Total" record columns are left out: the # column is the rank and W-D-L is the record.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Each column with the names ESPN uses for it (abbreviation, short name or full name).
const COLS = [
  { key: 'GP', from: ['GP', 'MP', 'gamesPlayed'], label: 'GP', title: 'Games played' },
  { key: 'W', from: ['W', 'wins'], label: 'W', title: 'Won' },
  { key: 'D', from: ['D', 'T', 'ties'], label: (s) => (s ? 'D' : 'T'), title: (s) => (s ? 'Drawn' : 'Tied') },
  { key: 'L', from: ['L', 'losses'], label: 'L', title: 'Lost' },
  { key: 'OTL', from: ['OTL', 'overtimeLosses'], label: 'OTL', title: 'Overtime losses' },
  { key: 'GF', from: ['F', 'GF', 'PF', 'pointsFor'], label: (s) => (s ? 'GF' : 'PF'), title: (s) => (s ? 'Goals for' : 'Points for') },
  { key: 'GA', from: ['A', 'GA', 'PA', 'pointsAgainst'], label: (s) => (s ? 'GA' : 'PA'), title: (s) => (s ? 'Goals against' : 'Points against') },
  { key: 'GD', from: ['GD', 'pointDifferential'], label: 'GD', title: 'Goal difference' },
  { key: 'PTS', from: ['P', 'PTS', 'points'], label: 'Pts', title: 'Points' },
  { key: 'PCT', from: ['PCT', 'winPercent'], label: 'PCT', title: 'Win percentage' },
  { key: 'GB', from: ['GB', 'gamesBehind'], label: 'GB', title: 'Games behind the leader' },
  { key: 'STRK', from: ['STRK', 'streak'], label: 'Strk', title: 'Current streak' },
];
const RANK = ['R', 'rank'];

// One team's stats under the keys above (plus RANK), from ESPN's list of stat objects.
export function canonStats(list = []) {
  const by = new Map();
  for (const s of list) {
    const v = s.displayValue ?? s.summary ?? (s.value != null ? String(s.value) : null);
    if (v == null) continue;
    for (const n of [s.abbreviation, s.shortDisplayName, s.name, s.type]) if (n && !by.has(n)) by.set(n, v);
  }
  const out = {};
  for (const c of COLS) { const n = c.from.find((k) => by.has(k)); if (n) out[c.key] = by.get(n); }
  const r = RANK.find((k) => by.has(k));
  if (r) out.RANK = by.get(r);
  return out;
}

// Rows in rank order when every team has a rank, else as the feed lists them.
export function ranked(entries) {
  const rank = (e) => Number(e.stats?.RANK);
  return entries.every((e) => Number.isFinite(rank(e))) ? [...entries].sort((a, b) => rank(a) - rank(b)) : entries;
}

// The columns this group actually has, in the order above.
export const usedColumns = (entries) => COLS.filter((c) => entries.some((e) => e.stats?.[c.key] != null && e.stats[c.key] !== ''));

// entries: [{ team, ours, stats }] with stats from canonStats. goals: a goal sport (soccer, hockey),
// so GF/GA and D for draws rather than PF/PA and T for ties.
export function standingsTable(entries, { goals = false } = {}) {
  const rows = ranked(entries), cols = usedColumns(rows);
  const txt = (x) => (typeof x === 'function' ? x(goals) : x);
  const cell = (c, v) => `<td class="num${c.key === 'PTS' ? ' pts' : ''}">${esc(v ?? '')}</td>`;
  return `<div class="table-wrap"><table class="tbl tight standings"><thead><tr><th class="num">#</th><th>Team</th>${cols.map((c) => `<th class="num"><abbr title="${esc(txt(c.title))}">${esc(txt(c.label))}</abbr></th>`).join('')}</tr></thead>
    <tbody>${rows.map((e, i) => `<tr class="${e.ours ? 'ours' : ''}"><td class="num">${esc(e.stats?.RANK ?? i + 1)}</td><td><b>${esc(e.team)}</b></td>${cols.map((c) => cell(c, e.stats?.[c.key])).join('')}</tr>`).join('')}</tbody></table></div>`;
}
