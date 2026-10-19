// Checks an AI answer against the records it was given: claim to record, not number presence.
//
// Every odds or percentage in the answer is bound to a selection: the pick named nearest before it
// in the same sentence (by [P#] tag, pick name or team), else the nearest after, else the pick the
// previous sentence was about ("it", "that one"). A bound number must be one of that selection's own
// numbers: its price, ATLAS chance, break-even and return (from the record, not the text), or a
// number the context states about its side of its match. A number bound to no pick must at least be
// in the data. Percentages are only compared with percentages and prices with prices, so "60%"
// never matches a 60 elsewhere. "Team B has 80% at 1.50" when those are Team A's numbers is flagged,
// as is "[P1] and [P2] are 40% and 80%" when the numbers are the other way round. [P#] tags become
// the pick names (and verified cards). Pure, so it can be tested.
const low = (s) => String(s || '').toLowerCase();
const NUM = /(\d{1,3}(?:\.\d{1,2})?)\s?(%|percent\b|per cent\b)|\b(\d{1,3}\.\d{1,2})\b/gi;
// "pct:80" or "dec:1.50": a number with its kind, normalised (1.5 and 1.50 are the same price).
const tokens = (s) => [...String(s).matchAll(NUM)].map((m) => ({ at: m.index, raw: m[0], key: m[1] != null ? `pct:${Math.round(Number(m[1]))}` : `dec:${Number(m[3]).toFixed(2)}` }));
const keysOf = (s) => new Set(tokens(s).map((t) => t.key));
const pct = (p) => `pct:${Math.round(p * 100)}`;
const dec = (x) => `dec:${Number(x).toFixed(2)}`;

export function verifyAnswer(answer, context) {
  const tags = context.tags || {};
  const text = String(context.text || '');
  const known = keysOf(text);
  const lines = text.split('\n');
  const teamsOf = (x) => [x.e?.home, x.e?.away].filter(Boolean);
  const sideOf = (x) => teamsOf(x).find((t) => low(x.pick).includes(low(t))) || null; // the team a side pick backs
  // Context segments (split on · ; ,), each with the teams it names, so "A 60%, draw 25%, B 15%"
  // gives A its 60 and B its 15. Another pick's own line is never evidence for this one.
  const segments = lines.filter((l) => !/\[P\d{1,2}\]/.test(l)).flatMap((l) => l.split(/ · |; |, /)).map((s) => ({ s, keys: keysOf(s) }));
  const allowed = {};
  for (const [t, x] of Object.entries(tags)) {
    const own = new Set([dec(x.odds), pct(x.p), pct(1 / x.odds), ...(Number.isFinite(x.ev) ? [`pct:${Math.round(x.ev * 100)}`] : []), ...keysOf(x.pick), ...keysOf(x.market),
      ...keysOf(lines.find((l) => l.includes(`[${t}]`)) || '')]);
    const mine = teamsOf(x).map(low), side = sideOf(x) && low(sideOf(x));
    for (const g of segments) {
      const names = mine.filter((n) => low(g.s).includes(n));
      if (!names.length) continue; // about another match, or about nothing in particular
      // A side pick may quote its own side's numbers, not the opponent's.
      if (side && !names.includes(side)) continue;
      for (const k of g.keys) own.add(k);
    }
    allowed[t] = own;
  }
  // The other teams in these matches are anchors too: "Leeds (8%)" binds 8% to Leeds, whose numbers
  // are the segments naming Leeds.
  for (const x of Object.values(tags)) {
    for (const team of teamsOf(x)) {
      const k = `team:${low(team)}`;
      if (allowed[k] || Object.values(tags).some((y) => low(sideOf(y)) === low(team))) continue;
      allowed[k] = new Set(segments.filter((g) => low(g.s).includes(low(team))).flatMap((g) => [...g.keys]));
    }
  }
  // Where each pick is mentioned in a sentence: its tag, its pick text or the team it backs.
  const mentions = (s) => {
    const out = [];
    for (const [t, x] of Object.entries(tags)) {
      for (const needle of [`[${t}]`, x.pick, sideOf(x)].filter(Boolean)) {
        let i = low(s).indexOf(low(needle));
        while (i >= 0) { out.push({ t, at: i }); i = low(s).indexOf(low(needle), i + 1); }
      }
    }
    for (const k of Object.keys(allowed).filter((x) => x.startsWith('team:'))) {
      const needle = k.slice(5);
      let i = low(s).indexOf(needle);
      while (i >= 0) { out.push({ t: k, at: i }); i = low(s).indexOf(needle, i + 1); }
    }
    return out.sort((a, b) => a.at - b.at);
  };

  const unknown = [], misplaced = [];
  let subject = null;
  for (const sentence of String(answer).split(/(?<=[.!?])\s+|\n+/)) {
    const ms = mentions(sentence), toks = tokens(sentence);
    // "[P1] and [P2] are 40% and 80%": names first, then as many numbers of one kind, in order.
    const order = [...new Set(ms.map((m) => m.t))];
    const pairwise = new Map();
    for (const kind of ['pct', 'dec']) {
      const ofKind = toks.filter((n) => n.key.startsWith(kind));
      if (order.length >= 2 && ofKind.length === order.length && ofKind.every((n) => n.at > ms.at(-1).at)) ofKind.forEach((n, i) => pairwise.set(n, order[i]));
    }
    for (const n of toks) {
      const before = ms.filter((m) => m.at < n.at).at(-1), after = ms.find((m) => m.at > n.at);
      const who = pairwise.get(n) || before?.t || after?.t || (ms.length ? null : subject);
      if (!known.has(n.key) && !(who && allowed[who].has(n.key))) { unknown.push(n.raw); continue; }
      if (who && !allowed[who].has(n.key)) misplaced.push({ number: n.raw, pick: tags[who]?.pick || who.slice(5) });
    }
    const last = ms.filter((m) => tags[m.t]).at(-1);
    if (last) subject = last.t;
  }
  const used = [...new Set([...String(answer).matchAll(/\[(P\d{1,2})\]/g)].map((m) => m[1]))].filter((t) => tags[t]);
  let out = String(answer).replace(/\[(P\d{1,2})\]/g, (m, t) => (tags[t] ? `**${tags[t].pick}**` : m));
  if (unknown.length) out += `\n\n_Unverified: ${[...new Set(unknown)].slice(0, 4).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in ATLAS's data; trust the cards below._`;
  if (misplaced.length) {
    const by = [...new Set(misplaced.map((m) => m.pick))];
    out += `\n\n_Check: ${[...new Set(misplaced.map((m) => m.number))].slice(0, 4).join(', ')} ${misplaced.length > 1 ? 'are' : 'is'} not ${by.length === 1 ? `${by[0]}'s` : 'the named pick\'s'} number in ATLAS's data (it belongs to another pick); trust the cards below._`;
  }
  return { text: out, picks: used.map((t) => tags[t]), unverified: unknown, misplaced };
}
