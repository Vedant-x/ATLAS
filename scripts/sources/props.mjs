// Build source (run by scripts/pages.mjs): player props.
import { out, UA, get, log, problems, noteSource } from '../lib.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { REPORT_PAGE, reportLinks, latestReport, reportTime, pdfPages, textItems, textRows, parseReport, applyOfficial } from '../../js/nbainjury.js';
import { CORE, PROVIDER, PROP_STATS, GAMELOG_KEYS, OPPORTUNITY, parseProps, gamelogRows, previousSeason, formFor, propHistory, propChance, withoutTeammate, hasForm, suspectProp } from '../../js/props.js';
import { pendingNews } from '../../js/newsgate.js';

// The NBA's official injury report (js/nbainjury.js): the latest PDF linked from the league's page,
// read as text. Returns { url, at, entries, pages, rows } (rows: the first page's text, for the log
// when nothing could be read from it).
export async function officialNbaReport() {
  const y = new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  let links = [];
  for (const u of [REPORT_PAGE(y), REPORT_PAGE(y - 1)]) {
    try { links = reportLinks(await get(u)); if (links.length) break; } catch { /* the other season's page */ }
  }
  const url = latestReport(links);
  if (!url) throw new Error('no report linked from official.nba.com');
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const raw = pdfPages(Buffer.from(await r.arrayBuffer()), inflateSync);
  // TEMPORARY layout dump (removed before merge): how the real file draws its cells.
  if (process.env.NBA_REPORT_DUMP) {
    const c = raw[0] || '', at = Math.max(0, c.indexOf('(Game)') - 1500);
    log(`  NBA DUMP content[${at}..]: ${JSON.stringify(c.slice(at, at + 5000))}`);
    raw.slice(0, 2).forEach((p, n) => textRows(textItems(p)).slice(0, n ? 12 : 45).forEach((row) => log(`  NBA DUMP p${n + 1} y=${row.y}: ${row.words.map((w) => `${w.x}:${w.s}`).join(' | ')}`)));
  }
  const pages = raw.map((c) => textRows(textItems(c))).filter((rows) => rows.length);
  return { url, at: reportTime(url), entries: parseReport(pages), pages: pages.length, rows: (pages[0] || []).slice(0, 14).map((row) => row.words.map((w) => w.s).join(' ')) };
}

// DraftKings player milestones and anytime scorers from ESPN's core odds feed, for matches in the
// next 36 hours. Names come from the two teams' rosters (one request per team), with the athlete
// record as a fallback for anyone a roster misses (a recent trade or call-up).
export async function playerProps(events) {
  const now = Date.now();
  const getJson = async (u) => JSON.parse(await get(u.replace(/^http:/, 'https:')));
  const due = events.filter((e) => !e.live && e.compId && e.teamIds?.home && e.teamIds?.away && e.start > now && e.start < now + 36 * 36e5 && PROP_STATS[e.leaguePath?.split('/')[0]]);
  const rosters = new Map(), athletes = new Map();
  const roster = (lp, team) => {
    const k = `${lp}|${team}`;
    if (!rosters.has(k)) {
      rosters.set(k, getJson(`https://site.api.espn.com/apis/site/v2/sports/${lp}/teams/${team}/roster`).then((j) => {
        const m = new Map(), add = (a) => { if (a?.id) m.set(String(a.id), a.displayName || a.fullName); };
        for (const a of j.athletes || []) { if (Array.isArray(a.items)) a.items.forEach(add); else add(a); }
        return m;
      }).catch(() => new Map()));
    }
    return rosters.get(k);
  };
  const athlete = (ref) => {
    if (!athletes.has(ref)) athletes.set(ref, getJson(ref).then((a) => ({ name: a.displayName, team: /\/teams\/(\d+)/.exec(a.team?.$ref || '')?.[1] || null })).catch(() => null));
    return athletes.get(ref);
  };
  let lines = 0, matched = 0, failed = 0;
  const sideCheck = { agree: 0, disagree: 0 }; // over/under order against the ladder (props.js)
  const queue = [...due];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const e = queue.shift();
      const [sport, league] = e.leaguePath.split('/');
      const url = `${CORE}/${sport}/leagues/${league}/events/${e.compId}/competitions/${e.compId}/odds/${PROVIDER}/propBets?limit=1000`;
      let items = [];
      try {
        const j = await getJson(url);
        items = j.items || [];
        for (let pg = 2; pg <= Math.min(j.pageCount || 1, 3); pg++) items.push(...((await getJson(`${url}&page=${pg}`)).items || []));
      } catch (err) { if (!/404/.test(err.message)) failed++; continue; }
      if (!items.length) continue;
      const [h, a] = await Promise.all([roster(e.leaguePath, e.teamIds.home), roster(e.leaguePath, e.teamIds.away)]);
      const extra = new Map();
      // Only player references (a team or other ref has no athlete id, and used to stop the whole step).
      const idOf = (r) => /athletes\/(\d+)/.exec(r || '')?.[1];
      const refs = [...new Set(items.map((x) => x.athlete?.$ref).filter((r) => idOf(r) && !h.has(idOf(r)) && !a.has(idOf(r))))].slice(0, 25);
      for (const r of refs) { const x = await athlete(r); if (x?.name) extra.set(idOf(r), { name: x.name, side: x.team === String(e.teamIds.home) ? 'home' : x.team === String(e.teamIds.away) ? 'away' : null }); }
      const who = (id) => (h.has(id) ? { name: h.get(id), side: 'home' } : a.has(id) ? { name: a.get(id), side: 'away' } : extra.get(id) || null);
      e.props = parseProps(items, sport, who, { check: sideCheck });
      if (e.props.length) { matched++; lines += e.props.length; }
    }
  }));
  log(`Player props (DraftKings via ESPN): ${lines} lines on ${matched} of ${due.length} matches in the next 36h${failed ? `, ${failed} lookup(s) failed` : ''}; over/under order check: ${sideCheck.agree} agree, ${sideCheck.disagree} disagree with the ladder`);
  if (sideCheck.disagree > sideCheck.agree) problems.push(`Player props: the over/under order looks reversed (${sideCheck.disagree} of ${sideCheck.agree + sideCheck.disagree} disagree with the ladder)`);
  // Player history: each player's last 20 games from his ESPN game log (last season too while this
  // one is under 10 games old). It gives the props page its hit rates, splits and charts, and the
  // ATLAS chance (propChance): the price as a prior, moved by how the player's recent games went.
  // Injury reports (ESPN match summaries) for every match with props: who is out, doubtful or
  // questionable tonight, by athlete id, so their absence can be read from the game logs.
  const INJ = /^(out|doubtful|questionable|day-to-day|injured reserve|suspension)/i;
  const withProps = due.filter((e) => e.props?.length);
  // Every NBA game too, props or not: its picks wait on the injury report (newsgate.js).
  const sq = due.filter((e) => e.props?.length || e.leaguePath === 'basketball/nba');
  // The league's own report first: its statuses replace ESPN's for NBA games (ESPN's follow it, late).
  let official = null;
  if (sq.some((e) => e.leaguePath === 'basketball/nba')) {
    try {
      official = await officialNbaReport();
      const teams = new Set(official.entries.map((x) => x.team));
      log(`NBA injury report (official): ${official.entries.length} entries for ${teams.size} teams on ${official.pages} page(s), published ${official.at ? new Date(official.at).toISOString().slice(0, 16).replace('T', ' ') : '?'} UTC (${official.url.split('/').pop()})`);
      if (official.entries.length) log(`  e.g. ${official.entries.filter((x, i, a) => a.findIndex((y) => y.team === x.team) === i).slice(0, 6).map((x) => `${x.matchup} ${x.team}: ${x.player} ${x.status} (${x.reason})`).join(' · ')}`);
      else log(`  nothing read; first rows: ${official.rows.join(' | ').slice(0, 600)}`);
      // Used only when it reads cleanly: several teams, every status a known one.
      if (teams.size < 2) official = null;
      noteSource('NBA injury report', 'official.nba.com', 'The league\'s own injury report: statuses for every NBA game', Boolean(official), official?.entries.length ?? 0, official ? `${official.entries.length} players on ${teams.size} teams` : 'report read but no rows could be read from it');
    } catch (err) {
      log(`NBA injury report (official) failed: ${err.message}`);
      noteSource('NBA injury report', 'official.nba.com', 'The league\'s own injury report: statuses for every NBA game', false, null, err.message);
    }
  }
  let injured = 0, pending = 0, pulled = 0, officialChanges = 0;
  const tally = {}; // the league's report against ESPN's lists (applyOfficial)
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (sq.length) {
      const e = sq.shift();
      try {
        const sm = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${e.leaguePath}/summary?event=${e.compId}`);
        e.injuryChecked = Date.now(); // the report was read, even if nobody is on it
        const inj = { home: [], away: [] };
        for (const t of sm.injuries || []) {
          const side = String(t.team?.id) === String(e.teamIds.home) ? 'home' : String(t.team?.id) === String(e.teamIds.away) ? 'away' : null;
          if (!side) continue;
          inj[side] = (t.injuries || []).map((x) => ({ id: x.athlete?.id != null ? String(x.athlete.id) : null, name: x.athlete?.displayName || '', status: x.status || x.type?.description || '' }))
            .filter((x) => x.id && x.name && INJ.test(x.status));
        }
        // NBA: the league's statuses over ESPN's, players it lists that ESPN does not added (with their
        // ids where the summary or the props name them).
        if (official && e.leaguePath === 'basketball/nba') {
          const ids = new Map();
          const add = (name, id) => { if (name && id != null) ids.set(name.toLowerCase(), String(id)); };
          for (const t of sm.leaders || []) for (const c of t.leaders || []) for (const l of c.leaders || []) add(l.athlete?.displayName, l.athlete?.id);
          for (const pr of e.props || []) add(pr.player, pr.id);
          for (const x of [...inj.home, ...inj.away]) add(x.name, x.id);
          const g = { home: e.home, away: e.away, injuries: inj };
          officialChanges += applyOfficial(g, official.entries, (name) => ids.get(name.toLowerCase()) ?? null, tally);
        }
        if (inj.home.length || inj.away.length) { e.injuries = { ...inj, source: inj.home.concat(inj.away).some((x) => x.official) ? 'NBA official report, ESPN' : 'ESPN', at: Date.now(), ...(official ? { officialAt: official.at } : {}) }; injured += inj.home.length + inj.away.length; }
        if (e.leaguePath === 'basketball/nba') {
          // Key players: each team's season leaders (points, rebounds, assists) in the summary.
          const leaders = new Set((sm.leaders || []).flatMap((t) => (t.leaders || []).flatMap((c) => (c.leaders || []).map((l) => String(l.athlete?.id ?? '')))).filter(Boolean));
          const names = pendingNews(e.injuries, leaders);
          if (names.length) { e.newsPending = names; pending++; }
          // A player on the injury report (out, doubtful, questionable) has no props here: he may not
          // play, or play limited minutes.
          // Probable players (likely to play) keep theirs.
          const listed = new Set(['home', 'away'].flatMap((s) => (e.injuries?.[s] || []).filter((x) => !/^probable/i.test(x.status || '')).map((x) => x.id)));
          const before = e.props?.length || 0;
          if (before) { e.props = e.props.filter((p) => !listed.has(String(p.id))); pulled += before - e.props.length; }
        }
      } catch { /* no injury report */ }
    }
  }));
  log(`Injury reports (ESPN${official ? ', NBA statuses from the league\'s report' : ''}): ${official ? `${officialChanges} NBA statuses changed or added by the league's report (${tally.both || 0} players on both lists, ${tally.changed || 0} of them with a new status; ${tally.added || 0} only on the league's; ${tally.cleared || 0} cleared to play); ` : ''}${injured} players out, doubtful or questionable across ${withProps.filter((e) => e.injuries).length} of ${withProps.length} prop matches; NBA: ${pending} game(s) waiting on a key player's status, ${pulled} prop(s) of listed players left out`);

  // Player history: each player's last 20 games from his ESPN game log (last season too while this
  // one is under 10 games old). It gives the props page its hit rates, splits and charts, and the
  // ATLAS chance (propChance): the price as a prior, moved by how the player's recent games went.
  // Injured teammates' logs are read too: the games they missed show how the player does without them.
  const logs = new Map();
  const want = [];
  for (const e of due) for (const pr of e.props || []) {
    const [sport, league] = e.leaguePath.split('/');
    if (hasForm(sport, pr.type) && !logs.has(`${league}|${pr.id}`) && want.length < 320) { logs.set(`${league}|${pr.id}`, null); want.push([sport, league, pr.id]); }
  }
  let mates = 0;
  for (const e of withProps) for (const side of ['home', 'away']) for (const x of e.injuries?.[side] || []) {
    const [sport, league] = e.leaguePath.split('/');
    if (!logs.has(`${league}|${x.id}`) && mates < 160) { logs.set(`${league}|${x.id}`, null); want.push([sport, league, x.id]); mates++; }
  }
  const q = [...want];
  let backfilled = 0, sample = null;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (q.length) {
      const [sport, league, id] = q.shift();
      const base = `https://site.web.api.espn.com/apis/common/v3/sports/${sport}/${league}/athletes/${id}/gamelog`;
      try {
        const g = await getJson(base);
        const rows = gamelogRows(g, 20);
        sample ||= { keys: Object.keys(g).join(','), season: previousSeason(g), game: Object.values(g.events || {})[0] };
        if (sport === 'hockey' && !sample.hockeyNames) sample.hockeyNames = (g.names || []).join(',');
        const prev = rows.length < 10 && previousSeason(g);
        if (prev) {
          try {
            const old = gamelogRows(await getJson(`${base}?season=${prev}`), 20 - rows.length);
            old.forEach((r) => Object.defineProperty(r, '_season', { value: false }));
            rows.push(...old);
            backfilled++;
          } catch { /* this season only */ }
        }
        logs.set(`${league}|${id}`, rows);
      } catch { /* price only */ }
    }
  }));
  // Teammates of a prop player tonight: the injured (with their status) and the other prop players
  // on his side, each with a game log.
  const teammatesOf = (e, league, pr) => {
    if (!pr.side) return [];
    const list = (e.injuries?.[pr.side] || []).filter((x) => x.id !== String(pr.id)).map((x) => ({ id: x.id, name: x.name, status: x.status }));
    for (const o of e.props || []) if (o.side === pr.side && String(o.id) !== String(pr.id) && !list.some((x) => x.id === String(o.id))) list.push({ id: String(o.id), name: o.player, status: null });
    return list.filter((x) => logs.get(`${league}|${x.id}`)?.length);
  };
  const OUT = /^(out|doubtful|injured reserve|suspension)/i;
  let formed = 0, adjusted = 0;
  const suspect = [];
  for (const e of due) {
    const [sport, league] = e.leaguePath.split('/');
    for (const pr of e.props || []) {
      const rows = logs.get(`${league}|${pr.id}`);
      const home = pr.side === 'home' ? true : pr.side === 'away' ? false : null;
      const opp = pr.side ? e.teamIds?.[pr.side === 'home' ? 'away' : 'home'] : null;
      const hist = rows?.length ? propHistory(sport, pr.type, pr.target, rows, { opp, home }) : null;
      if (!hist) continue;
      pr.hist = hist;
      pr.form = formFor(sport, pr.type, pr.target, rows.slice(0, 10));
      // Teammates ruled out (or doubtful) tonight: how he did in the games they missed moves the
      // forecast; questionable ones are listed as "what if" only.
      const adj = [];
      for (const m of teammatesOf(e, league, pr).filter((x) => x.status)) {
        const w = withoutTeammate(sport, pr.type, pr.target, rows, logs.get(`${league}|${m.id}`));
        if (w) adj.push({ name: m.name, status: m.status, applied: OUT.test(m.status) && w.fresh, ...w });
      }
      const live = adj.filter((x) => x.applied).sort((a, b) => Math.abs(b.scale - 1) - Math.abs(a.scale - 1));
      const scale = Math.min(1.4, Math.max(0.7, live.reduce((m, x) => m * x.scale, 1)));
      const top = live[0];
      pr.pBase = propChance(pr.pm ?? pr.p, sport, pr.type, pr.target, rows, { home }).p;
      pr.p = top ? propChance(pr.pm ?? pr.p, sport, pr.type, pr.target, rows, { home, scale, without: top.without }).p : pr.pBase;
      if (adj.length) pr.adj = adj.slice(0, 4);
      if (top && Math.abs(pr.p - pr.pBase) >= 0.02) { pr.why = `without ${top.name} (${top.status.toLowerCase()})`; adjusted++; }
      formed++;
    }
    const bad = (e.props || []).filter(suspectProp);
    if (bad.length) { e.props = e.props.filter((pr) => !suspectProp(pr)); suspect.push(...bad.map((pr) => `${pr.player} over ${pr.target - 0.5} ${pr.label} @${pr.odds} (cleared ${pr.hist.l20[0]} of ${pr.hist.l20[1]})`)); }
    e.props?.sort((a, b) => b.p - a.p);
  }
  if (suspect.length) log(`  SUSPECT LINES dropped (${suspect.length}): ${suspect.slice(0, 6).join(' · ')}`);
  // Every prop player's game log (and his injured teammates') for the player research page
  // (data/players.json, loaded on demand): per game the date, opponent, home/away, this season or
  // last, minutes (or at-bats), the game and team ids (for with/without a teammate) and each stat a
  // prop of his sport uses; and for prop players, tonight's teammates to compare against.
  const players = {};
  const entry = (sport, rows, name, team, extra = {}) => {
    const cols = [...new Set(Object.values(GAMELOG_KEYS[sport] || {}).flat())];
    const opp = OPPORTUNITY[sport];
    return {
      n: name, s: sport, t: team, c: cols, o: opp || null, ...extra,
      g: rows.map((r) => [r._at ? new Date(r._at).toISOString().slice(0, 10) : '', r._oppAbbr || '', r._opp || '', r._home === true ? 1 : r._home === false ? 0 : -1, r._season === false ? 0 : 1, opp && Number.isFinite(r[opp]) ? r[opp] : null, r._ev || '', r._team || '', ...cols.map((c) => (Number.isFinite(r[c]) ? r[c] : null))]),
    };
  };
  for (const e of due) {
    const [sport, league] = e.leaguePath.split('/');
    for (const pr of e.props || []) {
      const k = `${league}|${pr.id}`, rows = logs.get(k);
      if (!rows?.length || players[k]) continue;
      const team = pr.side === 'home' ? e.home : pr.side === 'away' ? e.away : '';
      players[k] = entry(sport, rows, pr.player, team, { tm: teammatesOf(e, league, pr).map((m) => [`${league}|${m.id}`, m.name, m.status]) });
      for (const m of teammatesOf(e, league, pr)) {
        const mk = `${league}|${m.id}`;
        if (!players[mk] && m.status) players[mk] = entry(sport, logs.get(mk), m.name, team, { inj: m.status });
      }
    }
  }
  await mkdir(`${out}/data`, { recursive: true });
  await writeFile(`${out}/data/players.json`, JSON.stringify({ updatedAt: Date.now(), players }));
  log(`Player history: ${[...logs.values()].filter(Boolean).length} of ${want.length} game logs (${mates} of injured teammates, ${backfilled} with last season), ${formed} props modelled from recent games, ${adjusted} moved by a teammate's absence`);
  due.flatMap((e) => (e.props || []).filter((pr) => pr.why)).slice(0, 5).forEach((pr) => log(`  ABSENCE ${pr.player} ${pr.target}+ ${pr.label}: ${Math.round(pr.pBase * 100)}% → ${Math.round(pr.p * 100)}% ${pr.why}`));
  const withVenue = Object.values(players).reduce((n, pl) => n + pl.g.filter((g) => g[3] !== -1).length, 0), games = Object.values(players).reduce((n, pl) => n + pl.g.length, 0);
  // How complete the minutes / at-bats column is per sport (the player page disables the filter when thin).
  const cover = {};
  for (const pl of Object.values(players)) { const c = (cover[pl.s] ||= [0, 0]); c[0] += pl.g.filter((g) => g[5] != null).length; c[1] += pl.g.length; }
  log(`  opportunity column: ${Object.entries(cover).map(([sp, [a, b]]) => `${sp} ${a}/${b}`).join(' · ')}`);
  if (sample?.hockeyNames) log(`  hockey gamelog columns: ${sample.hockeyNames}`);
  if (sample) log(`  gamelog: previous season ${sample.season} · game keys ${Object.keys(sample.game || {}).join(',')} · atVs ${sample.game?.atVs} · opponent ${sample.game?.opponent?.abbreviation} · ${withVenue}/${games} games with home/away`);
  for (const e of due.filter((x) => x.props?.length).slice(0, 3)) log(`  PROPS ${e.away} @ ${e.home}: ${e.props.slice(0, 4).map((x) => `${x.player} ${x.target}+ ${x.label} @${x.odds}`).join(' · ')}`);
}
