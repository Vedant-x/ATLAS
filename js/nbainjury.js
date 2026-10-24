// The NBA's official injury report: a PDF the league publishes through the day (official.nba.com),
// the source ESPN's injury lists follow, often with a lag. Teams must file by 5 pm ET the day before a
// game, and update it as statuses change. Read as text (no PDF library): the report's pages are
// deflated content streams whose text is drawn word by word (GemBox, WinAnsi literal strings). Words
// are placed by their position, rows grouped by height on the page and columns matched to the header
// ("Game Date … Player Name, Current Status, Reason"); the Date, Matchup and Team cells are merged
// down the table, so each row carries forward the last one seen. Pure, for tests: the build fetches.

export const REPORT_PAGE = (y) => `https://official.nba.com/nba-injury-report-${y}-${String(y + 1).slice(2)}-season/`;
export const reportLinks = (html) => [...new Set([...String(html).matchAll(/https?:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_[\w-]+\.pdf/g)].map((m) => m[0]))];
// "…Injury-Report_2026-10-24_02_45AM.pdf" → the time it was published (US Eastern), for ordering.
export function reportTime(url) {
  const m = /Injury-Report_(\d{4})-(\d{2})-(\d{2})_(\d{1,2})(?:_(\d{2}))?(AM|PM)\.pdf$/.exec(url || '');
  if (!m) return null;
  const h = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], h, Number(m[5] || 0)) + 4 * 36e5; // EDT; within an hour in winter
}
export const latestReport = (links) => links.slice().sort((a, b) => (reportTime(a) || 0) - (reportTime(b) || 0)).at(-1) || null;

// Every deflated stream in a PDF file, as text (inflate: zlib's inflateSync, passed in).
export function pdfStreams(buf, inflate) {
  const raw = buf.toString('latin1'), out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const end = raw.indexOf('endstream', m.index);
    if (end < 0) break;
    try { out.push(inflate(buf.subarray(m.index + m[0].length, end)).toString('latin1')); } catch { /* not deflated */ }
    re.lastIndex = end;
  }
  return out;
}

// A PDF literal string's text: (Brunson,\040Jalen) → "Brunson, Jalen".
function unescapePdf(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? String.fromCharCode(parseInt(c, 8))));
}

// The words of one content stream with their positions: [{ x, y, s }].
export function textItems(content) {
  const items = [];
  const tokens = [];
  // Strings (with nested parentheses), arrays of strings and numbers, numbers, names and operators.
  const re = /\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|\[|\]|-?\d*\.?\d+|\/[^\s/[\]()<>]+|[A-Za-z'"*]+/g;
  let m;
  while ((m = re.exec(content))) tokens.push(m[0]);
  let x = 0, y = 0, lead = 0, inArr = null;
  const stack = [];
  const text = (s) => { const t = s.replace(/\s+/g, ' ').trim(); if (t) items.push({ x: +x.toFixed(2), y: +y.toFixed(2), s: t }); };
  for (const t of tokens) {
    if (t === '[') { inArr = []; continue; }
    if (t === ']') { stack.push(inArr); inArr = null; continue; }
    if (inArr) { inArr.push(t); continue; }
    if (t[0] === '(' || /^-?\d*\.?\d+$/.test(t) || t[0] === '/') { stack.push(t); continue; }
    const num = (i) => Number(stack[stack.length - i]);
    switch (t) {
      case 'BT': x = 0; y = 0; break;
      case 'Td': case 'TD': x += num(2); y += num(1); if (t === 'TD') lead = -num(1); break;
      case 'Tm': x = num(2); y = num(1); break;
      case 'TL': lead = num(1); break;
      case 'T*': y -= lead; break;
      case 'Tj': case "'": case '"': { if (t !== 'Tj') y -= lead; const s = stack[stack.length - 1]; if (typeof s === 'string' && s[0] === '(') text(unescapePdf(s.slice(1, -1))); break; }
      case 'TJ': { const a = stack[stack.length - 1]; if (Array.isArray(a)) text(a.map((p) => (p[0] === '(' ? unescapePdf(p.slice(1, -1)) : Number(p) < -200 ? ' ' : '')).join('')); break; }
      default: break;
    }
    stack.length = 0;
  }
  return items;
}

// Words grouped into rows (by height, within 2 points), each row's words left to right.
export function textRows(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = rows.find((row) => Math.abs(row.y - it.y) <= 2);
    if (r) r.words.push(it); else rows.push({ y: it.y, words: [it] });
  }
  for (const r of rows) r.words.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => a.y - b.y);
}

export const STATUSES = /^(out|questionable|doubtful|probable|available)$/i;
const HEAD = ['Game Date', 'Game Time', 'Matchup', 'Team', 'Player Name', 'Current Status', 'Reason'];

// The report's entries: [{ date, time, matchup, team, player ("First Last"), status, reason }].
export function parseReport(rowsByPage) {
  const out = [];
  for (const rows of rowsByPage) {
    // The header row: where each column starts.
    const head = rows.find((r) => { const t = r.words.map((w) => w.s).join(' '); return /Player Name/.test(t) && /Current Status/.test(t); });
    if (!head) continue;
    const starts = HEAD.map((label) => { const first = label.split(' ')[0]; const w = head.words.find((x, i) => x.s === first && head.words.slice(i, i + label.split(' ').length).map((y) => y.s).join(' ') === label); return w ? w.x : null; });
    if (starts.some((s) => s == null)) continue;
    const col = (x) => { let k = 0; for (let i = 0; i < starts.length; i++) if (x >= starts[i] - 2) k = i; return k; };
    let carry = {};
    for (const r of rows.filter((row) => row.y > head.y)) {
      const cells = Array(HEAD.length).fill('');
      for (const w of r.words) { const k = col(w.x); cells[k] = cells[k] ? `${cells[k]} ${w.s}` : w.s; }
      if (/^Page \d+ of \d+$/.test(cells.join(' ').trim())) continue;
      const [date, time, matchup, team, name, status, reason] = cells;
      if (date) carry = { ...carry, date };
      if (time) carry = { ...carry, time };
      if (matchup) carry = { ...carry, matchup, team: undefined };
      if (team) carry = { ...carry, team };
      if (name && STATUSES.test(status)) {
        const [last, first] = name.split(/,\s*/);
        out.push({ ...carry, player: first ? `${first} ${last}`.trim() : name, status: status[0].toUpperCase() + status.slice(1).toLowerCase(), reason });
      } else if (!name && !status && reason && out.length && !team && !matchup) out.at(-1).reason = `${out.at(-1).reason} ${reason}`.trim(); // a wrapped reason
    }
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// The official statuses onto one game's injury lists ({ home, away } of { id, name, status }):
// a listed player's status becomes the league's own; a player the league lists and ESPN does not
// is added (with his id when ATLAS knows it: idOf(name)). "Available" players leave the lists.
// Returns how many entries changed or were added.
export function applyOfficial(e, entries, idOf = () => null) {
  let n = 0;
  const inj = (e.injuries ||= { home: [], away: [] });
  for (const side of ['home', 'away']) {
    const team = norm(e[side]);
    for (const x of entries.filter((r) => norm(r.team) === team)) {
      const list = (inj[side] ||= []);
      const cur = list.find((p) => norm(p.name) === norm(x.player));
      if (/^available$/i.test(x.status)) { if (cur) { list.splice(list.indexOf(cur), 1); n++; } continue; }
      if (cur) { if (cur.status !== x.status) { cur.status = x.status; n++; } cur.official = true; }
      else { list.push({ id: idOf(x.player), name: x.player, status: x.status, reason: x.reason || '', official: true }); n++; }
    }
  }
  return n;
}
