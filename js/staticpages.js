// Pages search engines can read (review item 43). The app's addresses are #/ routes, which search
// engines take as one page, so each build also writes a plain page per sport and per league at a
// real address (sports/<id>/, leagues/<key>/): the coming fixtures with their times, prices and the
// market's own chance, a link into the app for each, and schema.org SportsEvent data; and the
// sitemap that lists them. Pure, for tests: the build writes the files.
import { esc } from './esc.js';
import { devig } from './engine.js';
import { leagueKey } from './catalog.js';

export const SITE = 'https://vedant-x.github.io/ATLAS/';
const WINNERS = ['Winner', 'Match Result', 'Moneyline'];
const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const pct = (p) => `${Math.round(p * 100)}%`;
// JSON inside a <script> tag: no "</script>" can close it early.
const jsonLd = (x) => JSON.stringify(x).replace(/</g, '\\u003c');

// One fixture as a line of text: who, when (India time), the market's chances (its cut taken out)
// and the prices, when a bookmaker prices it.
export function fixtureLine(e) {
  const m = e.markets?.find((x) => WINNERS.includes(x.name));
  const when = `${IST.format(new Date(e.start))} IST`;
  if (!m?.outcomes?.length) return { when, chances: null, prices: null };
  const d = devig(m);
  const fair = m.outcomes.map((o, i) => (Number.isFinite(o.cons) ? o.cons : d.outcomes[i].fair));
  return {
    when,
    chances: m.outcomes.map((o, i) => `${o.name} ${pct(fair[i])}`).join(' · '),
    prices: `${m.outcomes.map((o) => o.odds.toFixed(2)).join(' / ')}${e.bookmaker ? ` (${e.bookmaker.split(' (')[0].split(';')[0]})` : ''}`,
  };
}

const page = ({ title, description, path, body, ld = null, up = '../../' }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}"><link rel="icon" href="${up}favicon.svg">
<meta property="og:type" content="website"><meta property="og:site_name" content="ATLAS"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}icons/og.png">
<style>:root{color-scheme:dark}body{margin:0;background:#07090d;color:#e8ecf3;font:16px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
a{color:#d2ff00}h1{font-size:28px;margin:8px 0 4px}p.lead{color:#aab3c2;margin:0 0 20px}.open{display:inline-block;margin:0 0 24px;padding:12px 18px;border-radius:10px;background:#d2ff00;color:#07090d;font-weight:700;text-decoration:none}
ul{list-style:none;padding:0;margin:0}li{padding:12px 0;border-top:1px solid #1d2430}li b{display:block}li small{display:block;color:#aab3c2;font-size:14px}footer{margin-top:32px;color:#8a94a6;font-size:13px}</style>
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}</head>
<body><main><p><a href="${up}">ATLAS</a></p>${body}
<footer>Chances are the bookmakers' with their cut taken out, not guarantees. Bet only what you can afford to lose, only where it is legal, and only if you are 18 or older. Times are India time; the app shows yours.</footer></main></body></html>
`;

// A league's page: its fixtures in the next 7 days, soonest first (up to 60).
export function leaguePage(league, events, { now = Date.now() } = {}) {
  const key = leagueKey(league.path);
  const list = events.filter((e) => e.leaguePath === league.path && !e.final && e.start > now - 3 * 36e5 && e.start < now + 7 * 864e5).sort((a, b) => a.start - b.start).slice(0, 60);
  const rows = list.map((e) => {
    const f = fixtureLine(e);
    return `<li><a href="../../#/match/${encodeURIComponent(e.id)}"><b>${esc(e.home)} v ${esc(e.away)}</b></a><small><time datetime="${new Date(e.start).toISOString()}">${esc(f.when)}</time>${e.live ? ' · live now' : ''}</small>${f.chances ? `<small>${esc(f.chances)}</small><small>Prices ${esc(f.prices)}</small>` : ''}</li>`;
  }).join('');
  const ld = list.length ? { '@context': 'https://schema.org', '@graph': list.map((e) => ({ '@type': 'SportsEvent', name: `${e.home} v ${e.away}`, startDate: new Date(e.start).toISOString(), sport: league.sport, url: `${SITE}#/match/${encodeURIComponent(e.id)}`, ...(e.venue?.name || typeof e.venue === 'string' ? { location: { '@type': 'Place', name: e.venue?.name || e.venue } } : {}), competitor: [e.home, e.away].map((n) => ({ '@type': 'SportsTeam', name: n })) })) } : null;
  return {
    path: `leagues/${key}/`,
    count: list.length,
    html: page({
      title: `${league.name} fixtures, odds and win chances · ATLAS`,
      description: list.length ? `${list.length} ${league.name} fixtures in the next 7 days, with each match's win chances (the bookmakers' cut taken out) and prices. Next: ${list[0].home} v ${list[0].away}, ${fixtureLine(list[0]).when}.` : `${league.name}: no fixtures in the next 7 days.`,
      path: `leagues/${key}/`,
      body: `<h1>${esc(league.name)}</h1><p class="lead">${esc(league.sportName || league.sport)} · fixtures in the next 7 days, with the market's win chances and prices.</p><a class="open" href="../../#/league/${esc(key)}">Open ${esc(league.name)} in ATLAS</a>${rows ? `<ul>${rows}</ul>` : '<p>No fixtures in the next 7 days.</p>'}`,
      ld,
    }),
  };
}

// A sport's page: its leagues with fixtures coming up, the busiest first.
export function sportPage(sport, leagues) {
  const rows = leagues.filter((l) => l.count).sort((a, b) => b.count - a.count).map((l) => `<li><a href="../../leagues/${esc(leagueKey(l.path))}/"><b>${esc(l.name)}</b></a><small>${l.count} fixture${l.count === 1 ? '' : 's'} in the next 7 days</small></li>`).join('');
  return {
    path: `sports/${sport.id}/`,
    html: page({
      title: `${sport.name} fixtures, odds and win chances · ATLAS`,
      description: `${sport.name} on ATLAS: ${leagues.filter((l) => l.count).length} competitions with fixtures in the next 7 days, each match's win chances with the bookmakers' cut taken out, and prices.`,
      path: `sports/${sport.id}/`,
      body: `<h1>${esc(sport.name)}</h1><p class="lead">Competitions with fixtures in the next 7 days.</p><a class="open" href="../../#/sport/${esc(sport.id)}">Open ${esc(sport.name)} in ATLAS</a>${rows ? `<ul>${rows}</ul>` : '<p>No fixtures in the next 7 days.</p>'}`,
    }),
  };
}

// The sitemap: the app's home and every page written this build.
export function sitemap(paths, { at = Date.now() } = {}) {
  const day = new Date(at).toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['', ...paths].map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${day}</lastmod><changefreq>hourly</changefreq></url>`).join('\n')}\n</urlset>\n`;
}
