// Live match alerts for the matches you follow (watchlist + slip), like a scores app: goals, runs and
// other scores, cards, half-time / end of period, and full time. While ATLAS is open (any tab, desktop
// or phone) each live match's ESPN summary is read every 30 seconds and new moments become a system
// notification, or a toast when the page is in view. `liveMoments` is pure so it can be tested.

const PREF_KEY = 'atlas-alert-prefs', SEEN_KEY = 'atlas-live-seen';
export const ALERT_TYPES = [['scores', 'Goals & scores'], ['cards', 'Cards'], ['periods', 'Half-time & periods'], ['final', 'Full time']];
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

export const alertPrefs = {
  get: () => ({ scores: true, cards: true, periods: true, final: true, ...load(PREF_KEY, {}) }),
  set(patch) { save(PREF_KEY, { ...alertPrefs.get(), ...patch }); },
};

const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const short = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Every alert-worthy moment in a match summary, each with a stable key so it is announced once.
// kind: score | card | period | final. `title` is the scoreline at that moment.
export function liveMoments(sm, e) {
  const comp = sm?.header?.competitions?.[0];
  if (!comp) return [];
  const C = (k) => comp.competitors?.find((c) => c.homeAway === k) || {};
  const H = C('home'), A = C('away');
  const nm = (c, fb) => c.team?.shortDisplayName || c.team?.displayName || fb;
  const hn = nm(H, e.home), an = nm(A, e.away);
  const line = (hs = H.score, as = A.score) => `${hn} ${hs ?? 0}–${as ?? 0} ${an}`;
  const teamOf = (id) => (String(H.team?.id ?? H.id) === String(id) ? hn : String(A.team?.id ?? A.id) === String(id) ? an : '');
  const out = [];
  const push = (key, kind, title, body) => out.push({ key: `${e.id}|${key}`, id: e.id, sport: e.sport, kind, title, body });

  if (sm.keyEvents?.length) {
    // Soccer: goals and cards from the key events.
    for (const k of sm.keyEvents) {
      const type = k.type?.text || '', who = k.participants?.[0]?.athlete?.displayName || '', min = k.clock?.displayValue || '', team = k.team?.displayName || teamOf(k.team?.id);
      const key = k.id || `${type}|${min}|${who}`;
      if (k.scoringPlay || /^goal|own goal|penalty - scored/i.test(type)) push(key, 'score', line(k.homeScore ?? undefined, k.awayScore ?? undefined), `Goal${/own goal/i.test(type) ? ' (own goal)' : /penalty/i.test(type) ? ' (penalty)' : ''} · ${[who, team && `(${team})`, min].filter(Boolean).join(' ')}`);
      else if (/red card/i.test(type)) push(key, 'card', line(), `Red card · ${[who, team && `(${team})`, min].filter(Boolean).join(' ')}`);
      else if (/yellow card/i.test(type)) push(key, 'card', line(), `Yellow card · ${[who, team && `(${team})`, min].filter(Boolean).join(' ')}`);
    }
  } else if (sm.scoringPlays?.length) {
    // Other sports: each scoring play (runs, goals, touchdowns, field goals) with the score after it.
    // Basketball is left out: a basket every few seconds would be noise, so it gets periods and final.
    if (e.sport !== 'basketball') {
      for (const p of sm.scoringPlays) {
        const per = p.period?.displayValue || (p.period?.number ? `P${p.period.number}` : '');
        const what = p.type?.text && !/^(score|scoring play)$/i.test(p.type.text) ? p.type.text : 'Score';
        push(p.id || `${per}|${p.clock?.displayValue}|${p.text}`, 'score', line(p.homeScore, p.awayScore), short(`${what} · ${teamOf(p.team?.id) || ''}${per ? ` (${per})` : ''}${p.text ? `: ${p.text}` : ''}`));
      }
    }
  }

  // Match status: half-time, end of a period / inning break, full time.
  const st = comp.status?.type || {};
  const period = comp.status?.period || 0;
  if (st.state === 'post' || /FINAL|FULL_TIME/.test(st.name || '')) push('final', 'final', line(), `Full time${st.detail && !/^(FT|Final)$/i.test(st.detail) ? ` · ${st.detail}` : ''}`);
  else if (/HALFTIME/.test(st.name || '')) push(`half|${period}`, 'period', line(), 'Half-time');
  else if (/END_PERIOD/.test(st.name || '')) push(`end|${period}`, 'period', line(), st.detail || `End of the ${ord(period)} period`);
  return out;
}

// Which followed matches to poll: ESPN-covered, under way (or due to start within 10 minutes and
// not yet final).
const espn = (e) => e.leaguePath && !e.leaguePath.startsWith('atlas/') && e.compId;
export const covers = (e) => Boolean(espn(e));

export function startLiveAlerts({ events, follow, fetchSummary, show }) {
  let seen = load(SEEN_KEY, {});
  const primed = new Set(); // matches read once this session: their older moments are not announced
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const ids = follow();
      const now = Date.now();
      const due = events().filter((e) => ids.has(e.id) && covers(e) && (e.live || (e.start <= now + 10 * 6e4 && e.start > now - 5 * 36e5))).slice(0, 10);
      const prefs = alertPrefs.get();
      for (const e of due) {
        let sm;
        try { sm = await fetchSummary(e); } catch { continue; }
        const ms = liveMoments(sm, e);
        const known = new Set(seen[e.id]?.keys || []);
        // First look at a match this session, or after more than 10 minutes away: remember what has
        // happened and announce from now on, rather than a burst of old goals.
        const caughtUp = primed.has(e.id) || (seen[e.id] && seen[e.id].at > now - 10 * 6e4);
        const fresh = caughtUp ? ms.filter((m) => !known.has(m.key)) : [];
        primed.add(e.id);
        seen[e.id] = { keys: ms.map((m) => m.key), at: now };
        for (const m of fresh) if (prefs[{ score: 'scores', card: 'cards', period: 'periods', final: 'final' }[m.kind]]) show(m);
      }
      for (const [id, v] of Object.entries(seen)) if (v.at < now - 2 * 864e5) delete seen[id];
      save(SEEN_KEY, seen);
    } finally { busy = false; }
  }
  tick();
  const timer = setInterval(tick, 30000);
  // Catch up at once when the tab comes back (background timers are throttled by the browser).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  return { tick, stop: () => clearInterval(timer) };
}
