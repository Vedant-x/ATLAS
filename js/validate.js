// Sanity checks for imported pitching numbers. Scraped tables can shift columns when cells are
// blank or merged; a shifted line (e.g. "ERA 82" that is really 82 appearances) must never reach
// a card, a comparison or the model. Invalid lines are dropped, never "repaired" by guessing.
const INT = /^\d+$/;
const IP = /^\d+(\.[012])?$/;
const outs = (ip) => { const [w, f = '0'] = String(ip).split('.'); return Number(w) * 3 + Number(f); };
const num = (v) => (v == null || /^[-.]*$/.test(String(v)) ? null : Number(String(v).replace(/^\./, '0.')));

// Returns the list of problems with one pitching line (empty = valid).
export function lineProblems(l) {
  if (!l) return ['missing'];
  const p = [];
  for (const k of ['g', 'gs', 'w', 'l', 'sv', 'h', 'r', 'er', 'hr', 'bb', 'so', 'bf']) {
    if (l[k] != null && l[k] !== '' && !INT.test(String(l[k]))) p.push(`${k}=${l[k]} not a count`);
  }
  if (l.ip != null && l.ip !== '' && !IP.test(String(l.ip))) p.push(`ip=${l.ip} not innings`);
  const era = num(l.era), whip = num(l.whip), avg = num(l.avg);
  if (era != null && !(era >= 0 && era < 100)) p.push(`era=${l.era} out of range`);
  if (whip != null && !(whip >= 0 && whip < 20)) p.push(`whip=${l.whip} out of range`);
  if (avg != null && !(avg >= 0 && avg <= 1)) p.push(`avg=${l.avg} out of range`);
  // ERA must agree with earned runs over innings (to rounding).
  const o = l.ip != null && IP.test(String(l.ip)) ? outs(l.ip) : 0;
  if (era != null && o >= 3 && INT.test(String(l.er ?? ''))) {
    const calc = (Number(l.er) * 27) / o;
    if (Math.abs(calc - era) > Math.max(0.06, era * 0.02)) p.push(`era=${l.era} but ${l.er} ER in ${l.ip} IP gives ${calc.toFixed(2)}`);
  }
  if (l.w != null && l.l != null && l.g != null && INT.test(String(l.g)) && Number(l.w) + Number(l.l) > Number(l.g)) p.push('W+L exceeds games');
  return p;
}

// One game line (recent outings): counts must be counts, innings must be innings.
export function gameProblems(g) {
  const p = [];
  for (const k of ['h', 'er', 'bb', 'so', 'hr', 'bf', 'pitches']) if (g[k] != null && g[k] !== '' && !INT.test(String(g[k]))) p.push(`${k}=${g[k]}`);
  if (g.ip != null && g.ip !== '' && !IP.test(String(g.ip))) p.push(`ip=${g.ip}`);
  if (g.date && !/^\d{4}-\d{2}-\d{2}$/.test(g.date)) p.push(`date=${g.date}`);
  return p;
}

// Clean a whole starter report in place; `warn` receives one message per dropped item.
export function validateReport(r, warn = () => {}) {
  if (!r) return r;
  const who = `${r.league || ''} ${r.name || r.id || ''}`.trim();
  const keep = (l, label) => { const p = lineProblems(l); if (p.length) { warn(`${who}: dropped ${label} (${p.join('; ')})`); return null; } return l; };
  if (r.season) r.season = keep(r.season, 'season line');
  if (r.post) r.post = keep(r.post, 'postseason line');
  if (r.career) r.career = keep(r.career, 'career line');
  r.years = (r.years || []).filter((y) => keep(y, `year ${y.year}`));
  const before = (r.recent || []).length;
  r.recent = (r.recent || []).filter((g) => !gameProblems(g).length);
  if (r.recent.length < before) warn(`${who}: dropped ${before - r.recent.length} recent game row(s)`);
  r.splits = (r.splits || []).filter((x) => { const a = num(x.avg), e = num(x.era); const ok = (a == null || (a >= 0 && a <= 1)) && (e == null || (e >= 0 && e < 100)); if (!ok) warn(`${who}: dropped split ${x.label}`); return ok; });
  if (r.vsOpp) { const a = num(r.vsOpp.avg), e = num(r.vsOpp.era); if ((a != null && !(a >= 0 && a <= 1)) || (e != null && !(e >= 0 && e < 100))) { warn(`${who}: dropped vs-opponent line`); r.vsOpp = null; } }
  return r;
}
