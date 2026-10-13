// What changed about a match between two looks at it: starters, lineups, absences, prices, kick-off.
// Pure functions shared by the build (scripts/changes.mjs keeps a server-side timeline that every
// visitor sees) and the browser (alerts for matches you follow).
//
// Every change records what it was before and after, where it came from and when it was seen, and
// whether it moves the forecast. A change whose effect ATLAS cannot quantify says so; it never gets a
// made-up percentage.
import { devig } from './engine.js';
import { propLabel } from './props.js';

const starterOf = (p) => p?.report?.name || p?.name || '';
const mainMarket = (e) => e.markets?.find((m) => m.name === 'Winner' || m.name === 'Match Result') || e.markets?.[0];

export function snapshot(e) {
  const m = mainMarket(e);
  const fair = m ? Object.fromEntries(devig(m).outcomes.map((o) => [o.name, +o.fair.toFixed(4)])) : {};
  const lu = e.absences?.lineup;
  return {
    starters: (e.probables || []).map((p) => `${p.side}:${starterOf(p)}`).filter((x) => !x.endsWith(':')).sort(),
    out: ['home', 'away'].flatMap((s) => (e.absences?.[s] || []).map((i) => i.name)).sort(),
    lineup: lu ? { type: lu.type || null, home: lu.home.starters.map((p) => p.name), away: lu.away.starters.map((p) => p.name) } : null,
    odds: m ? Object.fromEntries(m.outcomes.map((o) => [o.name, o.odds])) : {},
    fair, market: m?.name || null,
    score: e.score || null, live: Boolean(e.live), start: e.start,
    // Player props (the 24 likeliest) and tonight's injury report, for "re-rated" and "pulled" alerts.
    ...(e.props?.length ? {
      props: Object.fromEntries(e.props.slice().sort((a, b) => b.p - a.p).slice(0, 24).map((x) => [`${x.id}|${x.type}|${x.target}`, [+x.p.toFixed(3), propLabel(x), x.why || '']])),
      propPlayers: Object.fromEntries(e.props.map((x) => [String(x.id), x.player])),
    } : {}),
    ...(e.injuries ? { inj: Object.fromEntries(['home', 'away'].flatMap((sd) => (e.injuries[sd] || []).map((x) => [x.name, x.status]))) } : {}),
  };
}

const confirmedType = (t) => t && !['lastStarting11', 'predicted'].includes(t);
const pct = (p) => `${Math.round(p * 100)}%`;

// Changes between two snapshots of one match. Each: { kind, text, before, after, source, forecast }
// where forecast is 'updated' (the probability on the site moved with it), 'not-modelled' (material,
// but ATLAS cannot put a number on its effect) or 'none'.
export function diff(e, before, now, at = Date.now()) {
  const out = [];
  if (!before) return out;
  const name = `${e.home} v ${e.away}`;
  const push = (kind, text, extra = {}) => out.push({ kind, text, name, ...extra });

  // Starting pitchers (baseball), side by side: announced, or replaced. They feed the model directly
  // when there is no bookmaker price; with a price, the price is what moves.
  const sp = (list, side) => (list.find((x) => x.startsWith(`${side}:`)) || '').slice(side.length + 1);
  for (const side of ['home', 'away']) {
    const was = sp(before.starters, side), is = sp(now.starters, side);
    if (!is || was === is) continue;
    const team = side === 'home' ? e.home : e.away;
    push('starter', was ? `${team} starter change: ${is} replaces ${was}` : `${team} starter announced: ${is}`, {
      before: was || null, after: is, source: e.source || 'league feed', forecast: e.markets?.length ? 'not-modelled' : 'updated',
    });
  }
  // Lineups: confirmed XI arrives (and how it differs from the predicted or previous XI).
  if (now.lineup && (!before.lineup || before.lineup.type !== now.lineup.type)) {
    if (confirmedType(now.lineup.type)) {
      const diffs = before.lineup ? ['home', 'away'].map((s) => {
        const inn = now.lineup[s].filter((n) => !before.lineup[s].includes(n));
        return inn.length ? `${s === 'home' ? e.home : e.away}: ${inn.slice(0, 4).join(', ')}${inn.length > 4 ? ` +${inn.length - 4}` : ''} in` : '';
      }).filter(Boolean) : [];
      push('lineup', `Confirmed XIs published${diffs.length ? ` · changes vs ${before.lineup.type === 'predicted' ? 'predicted' : 'previous'} XI: ${diffs.join(' · ')}` : before.lineup ? ' · same as expected' : ''}`, {
        before: before.lineup?.type || null, after: 'confirmed', source: 'FotMob', forecast: 'not-modelled',
      });
    } else if (now.lineup.type === 'predicted' && !before.lineup) push('lineup', 'Predicted XIs available (not confirmed)', { after: 'predicted', source: 'FotMob', forecast: 'none' });
  }
  // Absences.
  const newOut = now.out.filter((n) => !before.out.includes(n)), back = before.out.filter((n) => !now.out.includes(n));
  if (newOut.length) push('injury', `Newly listed out: ${newOut.slice(0, 4).join(', ')}${newOut.length > 4 ? ` +${newOut.length - 4}` : ''}`, { after: newOut.join(', '), source: 'FotMob / ESPN', forecast: 'not-modelled' });
  if (back.length) push('injury', `No longer listed out: ${back.slice(0, 4).join(', ')}${back.length > 4 ? ` +${back.length - 4}` : ''}`, { before: back.join(', '), source: 'FotMob / ESPN', forecast: 'not-modelled' });
  // Injury report (US sports): a player newly listed, a status change, or off the report. When a
  // teammate's prop moved because of it, the forecast moved with it.
  if (before.inj && now.inj) {
    const moved = (n) => Object.values(now.props || {}).some((v) => v[2].includes(n));
    for (const [n, st] of Object.entries(now.inj)) {
      const was = before.inj[n];
      if (was === st) continue;
      push('injury', was ? `${n}: ${was} → ${st}` : `${n} listed ${st}`, { before: was || null, after: st, source: 'ESPN injury report', forecast: moved(n) ? 'updated' : 'not-modelled' });
    }
    for (const n of Object.keys(before.inj)) if (!(n in now.inj)) push('injury', `${n} is off the injury report`, { before: before.inj[n], after: null, source: 'ESPN injury report', forecast: 'not-modelled' });
  }
  // Player props: the ATLAS chance moved 5+ points (with the reason when it is a teammate's absence),
  // or every line for a player was pulled (often injury news or a late scratch).
  if (before.props && now.props) {
    const moves = Object.entries(now.props).map(([k, [p, label, why]]) => [k, p, label, why, before.props[k]?.[0]]).filter(([, p, , , b]) => b != null && Math.abs(p - b) >= 0.05)
      .sort((a, b) => Math.abs(b[1] - b[4]) - Math.abs(a[1] - a[4])).slice(0, 4);
    for (const [, p, label, why, b] of moves) push('prop', `${label}: ATLAS ${pct(b)} → ${pct(p)}${why ? ` (${why})` : ''}`, { before: b, after: p, source: why ? 'ESPN injury report + game logs' : 'price and game logs', forecast: 'updated' });
    const gone = Object.entries(before.propPlayers || {}).filter(([id]) => !(id in (now.propPlayers || {}))).map(([, n]) => n);
    if (gone.length && Object.keys(now.propPlayers || {}).length) push('prop', `Lines pulled for ${gone.slice(0, 3).join(', ')}${gone.length > 3 ? ` +${gone.length - 3}` : ''}: often injury news or a late scratch`, { before: gone.join(', '), after: null, source: 'DraftKings via ESPN', forecast: 'not-modelled' });
  }
  // Prices: the margin-free chance moved 4+ points, or the odds 8%+ (this does move the forecast).
  if (!Object.keys(before.fair || {}).length && Object.keys(now.fair).length) push('price', `Bookmaker prices now available (${now.market})`, { source: e.bookmaker || 'bookmaker', forecast: 'updated' });
  for (const [k, p] of Object.entries(now.fair || {})) {
    const b = before.fair?.[k];
    const ob = before.odds?.[k], on = now.odds?.[k];
    if (b != null && (Math.abs(p - b) >= 0.04 || (ob && on && Math.abs(on / ob - 1) >= 0.08))) push('price', `${k} ${p > b ? 'shortened' : 'drifted'}: market chance ${pct(b)} → ${pct(p)} (odds ${before.odds[k]?.toFixed(2)} → ${now.odds[k]?.toFixed(2)})`, { before: b, after: p, source: e.bookmaker || 'bookmaker', forecast: 'updated' });
  }
  // Kick-off moved by 15+ minutes.
  if (before.start && now.start && Math.abs(now.start - before.start) >= 15 * 6e4) push('time', `Start time moved by ${Math.round((now.start - before.start) / 6e4)} min`, { before: before.start, after: now.start, source: e.source || 'league feed', forecast: 'none' });
  // Live-only alerts (used by the browser for followed matches).
  if (!before.live && now.live) push('start', `${name} has started`, { forecast: 'none', liveOnly: true });
  else if (!now.live && now.start - at < 15 * 6e4 && now.start - at > 0 && !(before.start - (before.checkedAt || at) < 15 * 6e4)) push('soon', `${name} starts in ${Math.max(1, Math.round((now.start - at) / 6e4))} min`, { forecast: 'none', liveOnly: true });
  if (before.score && now.score && before.score !== now.score) push('score', `${name}: ${now.score}`, { forecast: 'none', liveOnly: true });
  return out;
}

export const KIND_ICON = { prop: '🎯', starter: '⚾', lineup: '📋', injury: '🩹', price: '📈', time: '🕒', start: '▶', soon: '⏱', score: '•' };
export const FORECAST_NOTE = { updated: 'Forecast updated', 'not-modelled': 'Forecast impact not quantified', none: '' };
