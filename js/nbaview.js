// NBA: every game in the next 36 hours with ATLAS's pick and its best player props, and the best
// props across the night. Props read the way most bookmakers write them ("over 24.5 points"), with
// how often the player cleared the line in his last 10 games. The full research (every line, splits,
// charts) is one tap away on the props page.
import { esc, sportOf, legButton, miniPick, notice } from './views.js';
import { pc, odd } from './charts.js';
import { split } from './ui.js';
import { allProps } from './propsview.js';
import { propLabel, propMarket, propOver } from './props.js';
import { rankedBankers } from './track.js';
import { trackCalibration } from './trackview.js';
import { fmt, zone } from './tz.js';

let S;
export const bindNba = (state) => { S = state; };

const NBA = 'basketball/nba';
const HOURS = 36;
export const nbaGames = (events, now = Date.now()) => events.filter((e) => e.leaguePath === NBA && (e.live || (e.start > now && e.start < now + HOURS * 36e5)))
  .sort((a, b) => (b.live - a.live) || a.start - b.start);
// Props for these games, best estimated return first (chance x odds - 1).
export const nbaProps = (games) => allProps(games, Date.now(), { any: true }).filter(({ e }) => !e.live).sort((a, b) => b.x.p * b.x.odds - a.x.p * a.x.odds);

const frac = (r) => (r && r[1] ? `${r[0]}/${r[1]}` : null);
// One prop, as simple as a pick card: the line as bookmakers write it, the last 10 games against it,
// ATLAS's chance with what the price needs and the return, and the price.
export function propMini({ e, x }) {
  const league = e.leaguePath?.split('/')[1];
  const leg = { key: `${e.id}|${propMarket(x)}|${propLabel(x)}`, eventId: e.id, sport: e.sport, match: `${e.home} vs ${e.away}`, market: propMarket(x), pick: propLabel(x), odds: x.odds, p: x.p, prop: { id: String(x.id), league, type: x.type, target: x.target } };
  const ret = x.p * x.odds - 1, l10 = frac(x.hist?.l10);
  const team = x.side === 'home' ? e.home : x.side === 'away' ? e.away : '';
  const tip = [`${propLabel(x)} (${team || `${e.home} v ${e.away}`})`, x.hist ? `Last 5 ${frac(x.hist.l5) || '–'} · last 20 ${frac(x.hist.l20) || '–'} · average ${x.hist.avg}` : '', x.why || ''].filter(Boolean).join('\n');
  return `<div class="mini reveal nba-prop" title="${esc(tip)}"><span class="mini-ico">${sportOf(e.sport).icon}</span>
    <a class="mini-main" href="#/props/${esc(`${league}~${x.id}~${encodeURIComponent(x.type)}~${x.target}`)}"><b>${esc(x.yes ? propLabel(x) : `${x.player} ${propOver(x)}`)}</b><small>${l10 ? `L10 ${l10} · ` : ''}${x.hist ? `avg ${x.hist.avg} · ` : ''}${esc(e.away)} @ ${esc(e.home)}</small></a>
    <div class="mini-nums"><b>${pc(x.p, 0)}</b><small><span class="mm-need">needs ${pc(1 / x.odds, 0)} · </span><span class="${ret >= 0 ? 'pos' : 'neg'}">${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(1)}%</span></small></div>
    ${legButton(leg, odd(x.odds))}</div>`;
}

// ATLAS's single pick for a game (game lines only), at odds 1.20 to 3.00.
const gamePick = (e) => rankedBankers([e], { cal: trackCalibration(), min: 0.5, minOdds: 1.2, maxOdds: 3, limit: 1, mix: false })[0];

function gameBlock(e, props) {
  const pick = e.live ? null : gamePick(e);
  const mine = props.filter((p) => p.e.id === e.id).slice(0, 3);
  const when = e.live ? `<span class="live">LIVE ${esc(e.score || '')}</span>` : esc(fmt(e.start, zone(), 'short'));
  return `<section class="panel nba-game reveal"><h2 class="ph"><a href="#/match/${esc(e.id)}">${esc(e.away)} @ ${esc(e.home)}</a> <small>${when}</small></h2>
    <div class="minilist">${pick ? miniPick(pick) : ''}${mine.map(propMini).join('')}${!pick && !mine.length ? `${e.live ? `<p><a href="#/match/${esc(e.id)}">Live scoreboard →</a></p>` : '<p class="muted">No price or props for this game yet.</p>'}` : ''}</div></section>`;
}

// Home: the night's NBA games and its three best props.
export function nbaPanel() {
  const games = nbaGames(S.events);
  if (!games.length) return '';
  const props = nbaProps(games).slice(0, 3);
  return `<div class="panel dash-nba reveal"><h2 class="ph">NBA tonight <small>${games.length} game${games.length === 1 ? '' : 's'} · <a href="#/nba">all games and props →</a></small></h2>
    <div class="minilist">${props.map(propMini).join('') || '<p class="muted">No player props priced yet: they appear a few hours before tip-off.</p>'}</div></div>`;
}

export const nbaViews = {
  nba() {
    const games = nbaGames(S.events), props = nbaProps(games);
    return {
      mode: 'sport', accent: '#ff8a3d', title: 'NBA', sceneOpts: { sport: 'basketball' },
      html: `<section class="hero small"><p class="kicker reveal">NBA · NEXT ${HOURS} HOURS · ${games.length} GAME${games.length === 1 ? '' : 'S'}</p><h1>${split('NBA')}</h1></section>
        ${notice()}
        ${props.length ? `<section class="panel reveal nba-best"><h2 class="ph">Best props <small>best return first · lines as bookmakers write them</small></h2><div class="minilist">${props.slice(0, 6).map(propMini).join('')}</div>
          <p class="rec-line"><a href="#/props">Every prop, with splits and charts →</a></p></section>` : ''}
        ${games.map((e) => gameBlock(e, props)).join('') || '<p class="muted reveal">No NBA games in the next 36 hours.</p>'}`,
    };
  },
};
