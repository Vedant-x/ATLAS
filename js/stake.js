// Stake quotes are a separate bookmaker feed, never inferred from ESPN or model prices.
export const STAKE_MAX_AGE = 5 * 60000;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const sides = ['home', 'away', 'draw', 'over', 'under', 'yes', 'no', '1X', 'X2', '12', 'odd', 'even'];
export const stakeTime = v => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
export function quoteFresh(market, event, now = Date.now()) {
  const t = stakeTime(market.updatedAt), start = stakeTime(event.date);
  return t !== null && t <= now + 60000 && now - t <= STAKE_MAX_AGE && event.status === 'pending' && start > now;
}
export function quoteRows(event) {
  return (event.bookmakers?.Stake || []).flatMap(m => (m.odds || []).map((r, index) => {
    const outcomes = sides.filter(s => Number.isFinite(Number(r[s])) && Number(r[s]) > 1).map(s => ({
      name: s === 'home' ? event.home : s === 'away' ? event.away : s === '1X' ? `${event.home} or draw` : s === 'X2' ? `${event.away} or draw` : s === '12' ? 'Either team wins' : s[0].toUpperCase() + s.slice(1),
      odds: Number(r[s]),
    }));
    if (r.label && Number(r.odds) > 1 && Number.isFinite(Number(r.odds))) outcomes.push({ name: r.label, odds: Number(r.odds) });
    return { name: m.name, index, line: r.hdp ?? null, label: r.label || '', updatedAt: m.updatedAt, outcomes };
  })).filter(r => r.outcomes.length);
}
const sportMap = { football: 'football', basketball: 'basketball', baseball: 'baseball', tennis: 'tennis', 'american-football': 'americanfootball', 'ice-hockey': 'hockey', cricket: 'cricket', esports: 'esports', 'mixed-martial-arts': 'mma', rugby: 'rugby' };
const nameKey = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function matchStakeEvent(event, list) {
  // Both full participant names, sport and kickoff must agree. No one-word/fuzzy joins.
  const hits = list.filter(s => sportMap[s.sport?.slug] === event.sport && Math.abs(stakeTime(s.date) - event.start) <= 10 * 60000 && nameKey(s.home) === nameKey(event.home) && nameKey(s.away) === nameKey(event.away));
  return hits.length === 1 ? hits[0] : null;
}
const stamp = t => stakeTime(t) !== null ? new Date(stakeTime(t)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST' : 'not supplied';
const link = u => { try { const url = new URL(u); return url.protocol === 'https:' && (url.hostname === 'stake.com' || url.hostname.endsWith('.stake.com')) ? url.href : null; } catch { return null; } };
export function stakeTable(event, now = Date.now()) {
  const rows = quoteRows(event);
  return `<div class="stake-quotes"><table><thead><tr><th>Market / line</th><th>Stake decimal prices</th><th>Source update · IST</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}${r.line !== null ? ` · ${esc(r.line)}` : ''}${r.label ? `<small>${esc(r.label)}</small>` : ''}</td><td>${r.outcomes.map(o => `<span>${esc(o.name)} <b>${o.odds.toFixed(3).replace(/0$/, '')}</b></span>`).join('')}</td><td><span class="${quoteFresh(r, event, now) ? 'pos' : 'warn'}">${quoteFresh(r, event, now) ? 'Fresh pre-match quote' : 'Expired / unverified for current use'}</span><small>${esc(stamp(r.updatedAt))}</small></td></tr>`).join('')}</tbody></table></div>`;
}
export function stakeMatchSection(event, feed) {
  const s = matchStakeEvent(event, feed?.events || []);
  if (!s) return `<section class="stake-match"><h2 class="ph">Stake prices</h2><p class="muted">No verified Stake event match in the connected feed. <a href="#/stake">Check the Stake connection →</a></p></section>`;
  return `<section class="stake-match"><h2 class="ph">Stake prices <small>via Odds-API.io · pre-match snapshot</small></h2><p>These quotes are separate from the research model and reference prices above. Expired quotes must be checked again on Stake.</p>${stakeTable(s)}</section>`;
}
export function stakeView(feed, events = []) {
  const d = feed || { status: 'loading', message: 'Checking the Stake connection…', events: [] };
  const list = d.events || [], fresh = list.reduce((n,e) => n + quoteRows(e).filter(m => quoteFresh(m,e)).length, 0);
  return { mode: 'other', accent: '#00e6a8', title: 'Stake odds', html: `<section class="hero small"><p class="kicker">STAKE / BOOKMAKER FEED</p><h1>STAKE ODDS</h1><p class="lede">Actual provider quotes, with the market name and source timestamp preserved. Pre-match coverage only.</p></section>
    <section class="panel stake-connection"><h2>${esc(d.status.replaceAll('-', ' '))}</h2><p>${esc(d.message)}</p><p><b>${list.length}</b> events · <b>${fresh}</b> fresh market rows · fetched ${esc(stamp(d.fetchedAt))}</p><p class="muted">${esc(d.scope?.sports?.join(', ') || 'Default scope: soccer, basketball, baseball')} · at most ${Number(d.scope?.maxEvents) || 20} events per collection. Coverage is partial; unavailable markets stay unavailable.</p><p class="muted">GitHub Pages reads a snapshot from the scheduled build (normally every 15 minutes, sometimes later). It is not a live odds stream. A local server with a key can refresh every minute. Prices older than five minutes are marked expired.</p></section>
    ${list.length ? list.map(e => { const url=link(e.urls?.Stake), match=events.find(a=>matchStakeEvent(a,[e])); return `<details class="stake-event"><summary><span>${esc(e.home)} vs ${esc(e.away)}<small>${esc(e.league?.name || e.sport?.name)} · ${esc(stamp(e.date))}</small></span><b>${quoteRows(e).length} market rows</b></summary>${url?`<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Check this event on Stake ↗</a></p>`:''}${match?`<p><a href="#/match/${esc(match.id)}">Open ATLAS research dossier →</a></p>`:''}${stakeTable(e)}</details>`; }).join('') : '<p class="muted stake-empty">No Stake quotes have been received. ESPN prices and ATLAS model lines are never substituted into this board.</p>'}
    <details class="stake-event"><summary>Connection setup</summary><p>Use an Odds-API.io account with <b>Stake</b> coverage. This provider is independent of Stake. A Stake login or Aura model key does not unlock this feed.</p><ol><li>Add <b>ODDS_API_KEY</b> as a GitHub Actions repository secret.</li><li>Select Stake in the provider account’s bookmaker settings.</li><li>Run the existing Deploy to GitHub Pages workflow.</li></ol><p>Optional repository variables: <b>STAKE_SPORTS</b> (comma-separated provider sport slugs) and <b>STAKE_MAX_EVENTS</b> (up to 80). Broader coverage uses more quota. Default scope can use up to 480 requests/day on the 15-minute schedule, plus manual/push builds.</p><p><a href="https://github.com/Vedant-x/ATLAS/settings/secrets/actions" target="_blank" rel="noopener noreferrer">GitHub secret settings ↗</a> · <a href="https://odds-api.io/sportsbooks/stake" target="_blank" rel="noopener noreferrer">Provider coverage ↗</a></p><p>Keys belong only in GitHub secrets or the local server environment. Never paste a key into this public page. Current provider docs say new free keys are paused; account charges and redistribution terms apply.</p></details>` };
}
export async function loadStakeFeed(fetcher = fetch, local = ['localhost','127.0.0.1'].includes(location.hostname)) {
  const endpoint = local ? 'api/stake-odds' : 'data/stake.json';
  try { const r = await fetcher(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(60000) }); if (!r.ok) throw Error(); const d=await r.json(); if (d.schema!==1 || d.bookmaker!=='Stake' || !Array.isArray(d.events)) throw Error(); return d; }
  catch { return { schema:1, bookmaker:'Stake', status:'unavailable', message:'Stake feed unavailable. No quotes can be verified from this response.', events:[], fetchedAt:null }; }
}
