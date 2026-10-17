// A slip someone shared (#/slip/<code>): its legs as they were when shared, each matched to the
// fixture on today's board, with one button to copy them into your own slip.
import { esc, sportOf, ist, legButton } from './views.js';
import { decodeSlip } from './share.js';
import { pc, odd } from './charts.js';

export function sharedSlipView(code, events) {
  const legs = decodeSlip(code || '');
  const head = (h) => `<section class="hero small"><p class="kicker reveal">SHARED SLIP</p><h1>${h}</h1></section>`;
  if (!legs.length) {
    return { mode: 'edge', accent: '#d2ff00', title: 'Shared slip',
      html: `${head('SLIP NOT FOUND')}<div class="panel reveal"><p class="muted">This link holds no readable slip. Ask for the link again, or build your own from <a href="#/bankers">Picks</a>.</p></div>` };
  }
  const byId = new Map(events.map((e) => [e.id, e]));
  const odds = legs.reduce((a, l) => a * l.odds, 1), p = legs.reduce((a, l) => a * l.p, 1);
  const state = (l) => {
    const e = byId.get(l.eventId);
    if (!e) return '<small class="warn">Not on today\'s board: finished, or not loaded yet</small>';
    if (e.live) return '<small class="live">LIVE: already started</small>';
    return `<time class="ist">${esc(ist(e.start))}</time>`;
  };
  const rows = legs.map((l) => `<li><span>${sportOf(l.sport).icon}</span><div><b>${esc(l.pick)}</b><small>${esc(l.market)} · ${esc(l.match)}</small>${state(l)}${l.derived ? '<small class="warn">ATLAS fair price, not a bookmaker quote</small>' : ''}</div><em>${odd(l.odds)}</em>${legButton(l, '+')}</li>`).join('');
  const open = legs.filter((l) => byId.get(l.eventId) && !byId.get(l.eventId).live);
  return {
    mode: 'edge', accent: '#d2ff00', title: 'Shared slip',
    html: `${head(`${legs.length} LEGS · ${odds.toFixed(2)}X`)}
      <div class="panel shared-slip reveal">
        <p class="muted">Prices as they were when the slip was shared. Check the current price with your bookmaker before you bet.</p>
        <ul class="slip-legs">${rows}</ul>
        <div class="slip-sum"><div><small>Total odds</small><b>${odds.toFixed(2)}x</b></div><div><small>Est. chance when shared</small><b>${pc(p, p < 0.01 ? 2 : 1)}</b></div><div><small>Break-even</small><b>${pc(1 / odds, 1)}</b></div></div>
        ${open.length ? `<div class="slip-actions"><button class="btn" data-addall="${esc(open.map((l) => l.key).join('~'))}">Add ${open.length === legs.length ? 'all' : `the ${open.length} still to start`} to my slip</button></div>` : '<p class="muted">Every match on this slip has started or left the board.</p>'}
      </div>`,
  };
}
