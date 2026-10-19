// Fair comparison with other services (Phase 6 of the brief). A comparison is only made on a prospective,
// pre-registered protocol: the same sports, dates, odds band and selection deadline for every service,
// actual available prices, equal flat stakes, every published selection kept and every abstention
// recorded, singles and parlays apart. Results from different evidence categories are never merged into
// one ranking, and two services are ranked only when the evidence separates them.
//
// Entry shape (data/comparisons.json): { service, evidence, kind: 'singles' | 'parlays', fees, notes,
//   opportunities, selections: [{ date, sport, market, odds, status: won|lost|push|void, p?, close? }] }

export const EVIDENCE = {
  audited: 'Independently audited',
  ledger: 'Reproduced from a complete ledger',
  provider: 'Provider-reported',
  testimonial: 'User testimonial',
  backtest: 'Historical backtest',
};

// One service's numbers in the comparison format. Profit at 1 unit per selection; ROI with a 95%
// interval (normal approximation); Brier only where probabilities were published; maximum drawdown
// in units over the selections in date order; price against the close where closing odds exist.
export function serviceStats(entry) {
  const sel = [...(entry.selections || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const settled = sel.filter((s) => s.status === 'won' || s.status === 'lost');
  const ret = settled.map((s) => (s.status === 'won' ? s.odds - 1 : -1));
  const n = settled.length, profit = ret.reduce((a, x) => a + x, 0), roi = n ? profit / n : null;
  const sd = n > 1 ? Math.sqrt(ret.reduce((a, x) => a + (x - roi) ** 2, 0) / (n - 1)) : null;
  let peak = 0, run = 0, drawdown = 0;
  for (const r of ret) { run += r; peak = Math.max(peak, run); drawdown = Math.max(drawdown, peak - run); }
  const withP = settled.filter((s) => Number.isFinite(s.p));
  const withClose = settled.filter((s) => s.close > 1);
  const odds = sel.map((s) => s.odds).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (f) => (odds.length ? odds[Math.min(odds.length - 1, Math.floor(f * odds.length))] : null);
  return {
    service: entry.service, evidence: EVIDENCE[entry.evidence] || 'Unlabelled (not compared)', kind: entry.kind || 'singles',
    opportunities: entry.opportunities ?? null, selections: sel.length, abstentions: entry.opportunities != null ? Math.max(0, entry.opportunities - sel.length) : null,
    won: settled.filter((s) => s.status === 'won').length, lost: settled.filter((s) => s.status === 'lost').length,
    push: sel.filter((s) => s.status === 'push').length, void: sel.filter((s) => s.status === 'void').length,
    avgOdds: odds.length ? odds.reduce((a, x) => a + x, 0) / odds.length : null, oddsQuartiles: [q(0.25), q(0.5), q(0.75)],
    profit: +profit.toFixed(2), roi, roiCI: sd != null ? [roi - 1.96 * sd / Math.sqrt(n), roi + 1.96 * sd / Math.sqrt(n)] : null,
    brier: withP.length ? withP.reduce((a, s) => a + (s.p - (s.status === 'won' ? 1 : 0)) ** 2, 0) / withP.length : null, brierN: withP.length,
    clv: withClose.length ? withClose.reduce((a, s) => a + (s.odds / s.close - 1), 0) / withClose.length : null,
    maxDrawdown: +drawdown.toFixed(2), fees: entry.fees ?? null, notes: entry.notes ?? '',
  };
}

// Rank services of one evidence category and one kind by ROI, only where the 95% intervals do not
// overlap; otherwise "insufficient evidence to rank". Different categories or kinds are never ranked
// against each other.
export function compareServices(entries) {
  const stats = entries.map(serviceStats);
  const groups = {};
  for (const s of stats) (groups[`${s.evidence}|${s.kind}`] ||= []).push(s);
  return Object.entries(groups).map(([k, list]) => {
    const [evidence, kind] = k.split('|');
    const sorted = list.slice().sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity));
    const separated = sorted.length > 1 && sorted.every((s, i) => i === 0 || (s.roiCI && sorted[i - 1].roiCI && s.roiCI[1] < sorted[i - 1].roiCI[0]));
    return { evidence, kind, services: sorted, ranking: separated ? sorted.map((s) => s.service) : null, verdict: sorted.length < 2 ? 'one service: nothing to rank' : separated ? 'ranked: the 95% intervals do not overlap' : 'insufficient evidence to rank' };
  });
}
