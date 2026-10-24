// The NBA's official injury report: a PDF the league publishes through the day (official.nba.com),
// the source ESPN's injury lists follow, often with a lag. Teams must file by 5 pm ET the day before a
// game, and update it as statuses change. Read as text (no PDF library): each page, in the page
// tree's order, is a deflated content stream whose text is drawn word by word (GemBox, WinAnsi
// literal strings). Words are placed on the page through the drawing transforms and grouped into rows
// by height; each row is read by what its cells hold (date, time, a matchup like NYK@BOS, one of that
// game's two teams, "Last, First", status, reason), so it does not depend on where the columns sit.
// The Date, Matchup and Team cells are filled only on a block's first row, so each row carries the
// last ones seen forward, across page breaks too. Pure, for tests: the build fetches.

export const REPORT_PAGE = (y) => `https://official.nba.com/nba-injury-report-${y}-${String(y + 1).slice(2)}-season/`;
export const reportLinks = (html) => [...new Set([...String(html).matchAll(/https?:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_[\w-]+\.pdf/g)].map((m) => m[0]))];
// US Eastern summer time: from 2 am on the second Sunday of March to the first Sunday of November.
const sunday = (y, m, n) => 1 + ((7 - new Date(Date.UTC(y, m, 1)).getUTCDay()) % 7) + 7 * (n - 1);
const eastern = (y, m, d, h) => { const t = Date.UTC(y, m, d, h); return t >= Date.UTC(y, 2, sunday(y, 2, 2), 2) && t < Date.UTC(y, 10, sunday(y, 10, 1), 2) ? 4 : 5; };
// "…Injury-Report_2026-10-24_02_45AM.pdf" → the time it was published (US Eastern), for ordering.
export function reportTime(url) {
  const m = /Injury-Report_(\d{4})-(\d{2})-(\d{2})_(\d{1,2})(?:_(\d{2}))?(AM|PM)\.pdf$/.exec(url || '');
  if (!m) return null;
  const h = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], h, Number(m[5] || 0)) + eastern(+m[1], +m[2] - 1, +m[3], h) * 36e5;
}
export const latestReport = (links) => links.slice().sort((a, b) => (reportTime(a) || 0) - (reportTime(b) || 0)).at(-1) || null;

// The "stream" keyword that opens a stream's data (not the one inside "endstream").
const STREAM = /(?<![a-z])stream\r?\n/;
const inflateAt = (buf, raw, start, inflate) => {
  const end = raw.indexOf('endstream', start);
  try { return end < 0 ? null : inflate(buf.subarray(start, end)).toString('latin1'); } catch { return null; } // not deflated
};

// Every deflated stream in a PDF file, in file order, as text (inflate: zlib's inflateSync, passed in).
export function pdfStreams(buf, inflate) {
  const raw = buf.toString('latin1'), out = [];
  const re = new RegExp(STREAM.source, 'g');
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length, text = inflateAt(buf, raw, start, inflate);
    if (text != null) out.push(text);
    re.lastIndex = Math.max(start, raw.indexOf('endstream', start) + 9);
  }
  return out;
}

// Each page's content in the page tree's order (a page's several streams joined), or every stream in
// file order when the tree cannot be read.
export function pdfPages(buf, inflate) {
  const raw = buf.toString('latin1'), at = new Map();
  for (const m of raw.matchAll(/(?<![\d.])(\d+)\s+\d+\s+obj\b/g)) at.set(Number(m[1]), m.index + m[0].length);
  const body = (n) => { const s = at.get(n); if (s == null) return ''; const e = raw.indexOf('endobj', s); return raw.slice(s, e < 0 ? raw.length : e); };
  const content = (n) => { const m = STREAM.exec(body(n)); return (m && inflateAt(buf, raw, at.get(n) + m.index + m[0].length, inflate)) || ''; };
  const refs = (s) => [...String(s || '').matchAll(/(\d+)\s+\d+\s+R\b/g)].map((m) => Number(m[1]));
  const pages = [], seen = new Set();
  const walk = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    const b = body(n);
    if (/\/Type\s*\/Pages\b/.test(b)) for (const k of refs(/\/Kids\s*\[([^\]]*)\]/.exec(b)?.[1])) walk(k);
    else if (/\/Type\s*\/Page\b/.test(b)) pages.push(refs(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(b)?.[1]).map(content).join('\n'));
  };
  const root = Number(/\/Root\s+(\d+)\s+\d+\s+R/.exec(raw)?.[1]);
  const top = Number(/\/Pages\s+(\d+)\s+\d+\s+R/.exec(body(root))?.[1]);
  if (top) walk(top);
  return pages.some((p) => /\bBT\b/.test(p)) ? pages : pdfStreams(buf, inflate);
}

// A PDF literal string's text: (Brunson,\040Jalen) → "Brunson, Jalen"; a hex one: <4F7574> → "Out".
function unescapePdf(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? String.fromCharCode(parseInt(c, 8))));
}
const hexPdf = (s) => (s.slice(1, -1).replace(/\s+/g, '').match(/.{1,2}/g) || []).map((h) => String.fromCharCode(parseInt(h.padEnd(2, '0'), 16))).join('');
const pdfString = (p) => (typeof p !== 'string' ? null : p[0] === '(' ? unescapePdf(p.slice(1, -1)) : p[0] === '<' ? hexPdf(p) : null);

// 2D transforms [a b c d e f]: m, then n.
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const ID = [1, 0, 0, 1, 0, 0];

// The words of one content stream where they land on the page (PDF space: y grows up): [{ x, y, s }].
export function textItems(content) {
  const items = [];
  const tokens = [];
  // Strings (with nested parentheses), hex strings, arrays, numbers, names and operators.
  const re = /\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|<[\da-fA-F\s]*>|\[|\]|-?\d*\.?\d+|\/[^\s/[\]()<>]+|[A-Za-z'"*]+/g;
  let m;
  while ((m = re.exec(content))) tokens.push(m[0]);
  let ctm = ID, line = ID, lead = 0, inArr = null;
  const saved = [], stack = [];
  const move = (tx, ty) => { line = mul([1, 0, 0, 1, tx, ty], line); };
  const text = (s) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t) items.push({ x: +(line[4] * ctm[0] + line[5] * ctm[2] + ctm[4]).toFixed(2), y: +(line[4] * ctm[1] + line[5] * ctm[3] + ctm[5]).toFixed(2), s: t });
  };
  for (const t of tokens) {
    if (t === '[') { inArr = []; continue; }
    if (t === ']') { stack.push(inArr); inArr = null; continue; }
    if (inArr) { inArr.push(t); continue; }
    if (t[0] === '(' || t[0] === '<' || t[0] === '/' || /^-?\d*\.?\d+$/.test(t)) { stack.push(t); continue; }
    const num = (i) => Number(stack[stack.length - i]);
    const six = () => [num(6), num(5), num(4), num(3), num(2), num(1)];
    switch (t) {
      case 'q': saved.push(ctm); break;
      case 'Q': ctm = saved.pop() || ID; break;
      case 'cm': ctm = mul(six(), ctm); break;
      case 'BT': line = ID; break;
      case 'Td': move(num(2), num(1)); break;
      case 'TD': lead = -num(1); move(num(2), num(1)); break;
      case 'Tm': line = six(); break;
      case 'TL': lead = num(1); break;
      case 'T*': move(0, -lead); break;
      case 'Tj': case "'": case '"': { if (t !== 'Tj') move(0, -lead); const s = pdfString(stack[stack.length - 1]); if (s != null) text(s); break; }
      case 'TJ': { const a = stack[stack.length - 1]; if (Array.isArray(a)) text(a.map((p) => pdfString(p) ?? (Number(p) < -200 ? ' ' : '')).join('')); break; }
      default: break;
    }
    stack.length = 0;
  }
  return items;
}

// Words grouped into rows (by height, within 2 points), the top of the page first, each row's words
// left to right.
export function textRows(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const r = rows.find((row) => Math.abs(row.y - it.y) <= 2);
    if (r) r.words.push(it); else rows.push({ y: it.y, words: [it] });
  }
  for (const r of rows) r.words.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

export const STATUSES = /^(out|questionable|doubtful|probable|available)$/i;
// The 30 teams as the report names them, by the abbreviations its matchups use (NYK@BOS).
export const TEAMS = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons', GSW: 'Golden State Warriors',
  HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers', LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies',
  MIA: 'Miami Heat', MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks',
  OKC: 'Oklahoma City Thunder', ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards',
};
const ALSO = { LAC: ['Los Angeles Clippers'] };

// The team a row's words start with, among the game's two (all 30 before a matchup is seen): its
// whole name, or its first words when the name wraps onto the next line (a player's "Last," word
// never matches: no team word ends with a comma). → { name, n (words used) } or null when none or
// more than one fits.
function teamAt(words, game) {
  let best = null, tie = false;
  for (const ab of game || Object.keys(TEAMS)) {
    for (const name of [TEAMS[ab], ...(ALSO[ab] || [])]) {
      const nw = name.split(' ');
      let k = 0;
      while (k < nw.length && words[k] === nw[k]) k++;
      if (k === nw.length) return { name: TEAMS[ab], n: k };
      if (!k || (best && k < best.n)) continue;
      if (best && k === best.n) { if (best.name !== TEAMS[ab]) tie = true; } else { best = { name: TEAMS[ab], n: k }; tie = false; }
    }
  }
  return best && !tie ? best : null;
}
const flip = (name) => { const [last, first] = name.replace(/,\s*$/, '').split(/,\s*/); return first ? `${first} ${last}`.trim() : last; };
const said = (ws) => ws.map((w) => w.s).join(' ');

// The report's entries: [{ date, time, matchup, team, player ("First Last"), status, reason }].
export function parseReport(rowsByPage) {
  const out = [];
  let carry = {}, game = null, statusX = null;
  for (const rows of rowsByPage) {
    // The header row, where it repeats: what sits above it is the page's title. Where the status
    // column starts tells a name (left of it) from a reason (right of it).
    const head = rows.find((r) => { const t = said(r.words); return /Player Name/.test(t) && /Current Status/.test(t); });
    statusX = head?.words.find((w, i) => w.s === 'Current' && head.words[i + 1]?.s === 'Status')?.x ?? statusX;
    let pending = null; // a player's name whose status sits a line lower: { name, reason }
    for (const r of rows) {
      if (head && r.y >= head.y - 1) continue;
      const ws = r.words.flatMap((w) => w.s.split(' ').map((s) => ({ x: w.x, s })));
      const line = said(ws);
      if (!line || /^Page \d+ of \d+$/i.test(line) || /^Injury Report:/i.test(line)) continue;
      let i = 0, fresh = false, m;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(ws[i]?.s)) { carry = { ...carry, date: ws[i].s }; i++; fresh = true; }
      if (/^\d{1,2}:\d{2}$/.test(ws[i]?.s) && ws[i + 1]?.s === '(ET)') { carry = { ...carry, time: `${ws[i].s} (ET)` }; i += 2; fresh = true; }
      if ((m = /^([A-Z]{2,4})@([A-Z]{2,4})$/.exec(ws[i]?.s || ''))) {
        carry = { ...carry, matchup: m[0], team: null };
        game = TEAMS[m[1]] && TEAMS[m[2]] ? [m[1], m[2]] : null;
        i++;
        fresh = true;
      }
      const team = teamAt(ws.slice(i).map((w) => w.s), game);
      if (team) { carry = { ...carry, team: team.name }; i += team.n; fresh = true; }
      const rest = ws.slice(i);
      // The status: the first status word with a name before it (or one waiting from the line above),
      // that name left of the status column, so a reason's words are never read as a player.
      const k = rest.findIndex((w) => STATUSES.test(w.s));
      if (k >= 0 && (k > 0 || pending) && rest.slice(0, k).every((w) => statusX == null || w.x <= statusX)) {
        const name = k > 0 ? said(rest.slice(0, k)) : pending.name;
        const reason = [k > 0 ? '' : pending.reason, said(rest.slice(k + 1))].filter(Boolean).join(' ');
        // Players of a team the reader did not recognise are left out rather than given to the last one.
        if (carry.team) out.push({ ...carry, player: flip(name), status: rest[k].s[0].toUpperCase() + rest[k].s.slice(1).toLowerCase(), reason });
        pending = null;
        continue;
      }
      // No status on this line: a name whose status sits a line lower (left of the status column),
      // the rest of a reason that wrapped (right of it), "NOT YET SUBMITTED", or the rest of a team
      // name that wrapped (passed over).
      const left = said(rest.filter((w) => statusX != null && w.x <= statusX));
      const right = said(rest.filter((w) => statusX == null || w.x > statusX));
      if (left.includes(',')) pending = { name: left, reason: right };
      else {
        pending = null;
        if (right && !fresh && out.length) out.at(-1).reason = `${out.at(-1).reason} ${right}`.trim();
      }
    }
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// The official statuses onto one game's injury lists ({ home, away } of { id, name, status }):
// a listed player's status becomes the league's own; a player the league lists and ESPN does not
// is added (with his id when ATLAS knows it: idOf(name)). "Available" players leave the lists.
// Returns how many entries changed or were added; tally (optional) counts, for the build log, the
// players on both lists, those only on the league's, and those cleared, which shows when the report
// was misread (most of its players missing from ESPN's lists).
export function applyOfficial(e, entries, idOf = () => null, tally = {}) {
  let n = 0;
  const inj = (e.injuries ||= { home: [], away: [] });
  const add = (k) => { tally[k] = (tally[k] || 0) + 1; };
  for (const side of ['home', 'away']) {
    const team = norm(e[side]);
    for (const x of entries.filter((r) => norm(r.team) === team)) {
      const list = (inj[side] ||= []);
      const cur = list.find((p) => norm(p.name) === norm(x.player));
      if (/^available$/i.test(x.status)) { if (cur) { list.splice(list.indexOf(cur), 1); n++; add('cleared'); } continue; }
      if (cur) { add('both'); if (cur.status !== x.status) { cur.status = x.status; n++; add('changed'); } cur.official = true; }
      else { list.push({ id: idOf(x.player), name: x.player, status: x.status, reason: x.reason || '', official: true }); n++; add('added'); }
    }
  }
  return n;
}
