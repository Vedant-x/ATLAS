// One plain line on why a pick made the list: the strongest one or two facts from the record, form,
// starters and absences that back the side it picks. The card already shows the price against
// ATLAS's chance; the full case (for and against) stays on the match page. Empty when no fact
// clearly points that way (totals, props, evenly matched sides).
const rate = (rec) => { const n = String(rec || '').split('-').map(Number); if (n.length < 2 || n.some((x) => !Number.isFinite(x))) return null; const g = n.reduce((a, b) => a + b, 0); return g ? n[0] / g : null; };
const formPts = (f) => (Array.isArray(f) && f.length ? f.reduce((s, r) => s + (r === 'W' ? 1 : r === 'D' ? 0.5 : 0), 0) / f.length : null);
const unbeaten = (f) => { let n = 0; for (const r of [...f].reverse()) { if (r === 'L') break; n++; } return n; };
const eraOf = (e, side) => { const p = (e.probables || []).find((x) => x.side === side); return Number((p?.report || p?.pitching)?.season?.era); };
const norm = (s) => String(s || '').toLowerCase();

// Which side a pick backs: its name starts with that team's (winner, handicap, draw-no-bet).
export function pickSide(e, pick) {
  const p = norm(pick);
  if (e.home && p.startsWith(norm(e.home))) return 'home';
  if (e.away && p.startsWith(norm(e.away))) return 'away';
  return null;
}

export function whyLine(b) {
  const e = b.event || {};
  const side = pickSide(e, b.pick);
  if (!side) return '';
  const other = side === 'home' ? 'away' : 'home';
  const team = { home: e.home, away: e.away };
  const s = e.stats || {};
  const facts = [];
  const f = s[`${side}Form`], fo = s[`${other}Form`];
  if (Array.isArray(f) && f.length >= 4) {
    const run = unbeaten(f);
    if (run >= 4) facts.push(`${team[side]} unbeaten in ${run}`);
    else { const a = formPts(f), o = formPts(fo); if (a != null && o != null && a - o >= 0.2) facts.push(`form ${f.join('')} v ${fo.join('')}`); }
  }
  if (e.sport === 'baseball') {
    const a = eraOf(e, side), o = eraOf(e, other);
    if (Number.isFinite(a) && Number.isFinite(o) && o - a >= 0.75) facts.push(`starter ERA ${a.toFixed(2)} v ${o.toFixed(2)}`);
  }
  const out = e.absences?.[other]?.length || 0, own = e.absences?.[side]?.length || 0;
  if (out >= 2 && out > own) facts.push(`${team[other]} without ${out} players`);
  const r = rate(s[`${side}Record`]), ro = rate(s[`${other}Record`]);
  if (facts.length < 2 && r != null && ro != null && r - ro >= 0.1) facts.push(`record ${s[`${side}Record`]} v ${s[`${other}Record`]}`);
  return facts.slice(0, 2).join(' · ');
}
