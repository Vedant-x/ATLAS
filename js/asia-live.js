// Live scores for sources whose sites don't allow browser requests: NPB (Japan), KBO (Korea) and the
// esports feeds. The GitHub job reads them every 20 seconds (scripts/live-lane.mjs) and publishes a
// small file the site polls. The parsers are pure so they can be tested.

const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

// npb.jp/games/<year>/ header scoreboard: one link per game, "/scores/YYYY/MMDD/<home>-<away>-<n>/",
// a score ("-" before the first pitch, "2-1" home-away once play starts) and a state (stadium and
// start time before the game, "7回表"/"7回裏" for the inning, "試合終了" when it's over).
export function parseNpbScoreboard(html) {
  const out = [];
  for (const m of html.matchAll(/<a href="\/scores\/(\d{4})\/(\d{4})\/([a-z]+)-([a-z]+)-\d+\/?">([\s\S]*?)<\/a>/g)) {
    const [, yyyy, mmdd, home, away, body] = m;
    const score = (body.match(/class="score"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const state = (body.match(/class="state"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '').replace(/<br[^>]*>/g, ' ').replace(/<[^>]+>/g, '').trim();
    const sc = score.match(/(\d+)\s*[-－]\s*(\d+)/);
    const inn = state.match(/(\d+)\s*回\s*(表|裏)/);
    let status = 'pre';
    if (/試合終了|終了/.test(state)) status = 'final';
    else if (/中止|ノーゲーム/.test(state)) status = 'cancelled';
    else if (inn || (sc && !/（/.test(state))) status = 'live';
    out.push({
      id: `atlas_npb-${yyyy}${mmdd}-${home}-${away}`, status, path: m[0].match(/href="([^"]+)"/)[1].replace(/\/?$/, '/'),
      score: sc ? `${sc[1]} – ${sc[2]}` : null,
      clock: inn ? `${inn[2] === '表' ? 'Top' : 'Bot'} ${ORD(Number(inn[1]))}` : status === 'final' ? 'Final' : '',
      period: inn ? Number(inn[1]) : null,
    });
  }
  return out;
}

// KBO GetKboGameList rows: GAME_STATE_SC 1 = scheduled, 2 = in play, 3 = finished.
export function kboLive(rows = []) {
  return rows.filter((g) => g.G_ID).map((g) => {
    const status = g.CANCEL_SC_ID && g.CANCEL_SC_ID !== '0' ? 'cancelled' : g.GAME_STATE_SC === '2' ? 'live' : g.GAME_STATE_SC === '3' ? 'final' : 'pre';
    const inn = Number(g.GAME_INN_NO) || null;
    const half = g.GAME_TB_SC === 'T' ? 'Top' : g.GAME_TB_SC === 'B' ? 'Bot' : '';
    return {
      id: `atlas_kbo-${g.G_ID}`, status,
      score: status === 'live' || status === 'final' ? `${g.B_SCORE_CN ?? 0} – ${g.T_SCORE_CN ?? 0}` : null,
      clock: status === 'live' && inn ? `${half ? `${half} ` : ''}${ORD(inn)}` : status === 'final' ? 'Final' : '',
      period: inn,
    };
  });
}

// Apply a live file to the events on screen. Finished games leave the board (as for every sport);
// cancelled ones too. Returns null when nothing changed.
export function applyAsiaLive(events, live, now = Date.now()) {
  if (!live?.games?.length) return null;
  const by = new Map(live.games.map((g) => [g.id, g]));
  let changed = false;
  const out = [];
  for (const e of events) {
    const g = by.get(e.id);
    if (!g) { out.push(e); continue; }
    if (g.status === 'final' || g.status === 'cancelled') { changed = true; continue; }
    const next = { ...e, live: g.status === 'live', score: g.score ?? e.score, clock: g.clock || e.clock, period: g.period ?? e.period, fetchedAt: live.at || now };
    if (g.maps && e.esports) next.esports = { ...e.esports, maps: g.maps };
    if (next.live !== e.live || next.score !== e.score || next.clock !== e.clock || JSON.stringify(g.maps || null) !== JSON.stringify(g.maps ? e.esports?.maps : null)) changed = true;
    out.push(next);
  }
  return changed ? out : null;
}

// Starting pitchers from an NPB box score (npb.jp/scores/…/box.html): the pitching tables list each
// side's pitchers in the order they appeared, so the first is the starter. The bottom table is the
// home team (it pitches the top of the innings), the top table the visitors.
export function npbBoxStarters(html) {
  const first = (id) => html.match(new RegExp(`id="${id}"[\\s\\S]*?/bis/players/(\\d+)\\.html`))?.[1] || null;
  const home = first('tablefix_b_p'), away = first('tablefix_t_p');
  return home || away ? { home, away } : null;
}

