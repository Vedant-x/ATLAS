// Checks an AI answer against the data it was given. [P#] tags become the pick names (and verified
// cards). Every odds or percentage the answer writes must be in the data, and, in a sentence that
// names one pick, must belong to that pick: its own line, or a line about its match. A real number
// stuck to the wrong pick ("Team B has 80% at 1.50" when 80% and 1.50 are Team A's) is flagged, not
// passed because it appears somewhere in the context. Pure, so it can be tested.
const NUM_IN_DATA = /\d+(?:\.\d+)?%?/g;
const NUM_IN_ANSWER = /\b\d\.\d{2}\b|\b\d{1,3}(?:\.\d)?%/g;
const nums = (s) => new Set(String(s).match(NUM_IN_DATA) || []);
const has = (set, n) => set.has(n) || set.has(n.replace('%', ''));
const low = (s) => String(s || '').toLowerCase();

export function verifyAnswer(answer, context) {
  const tags = context.tags || {};
  const lines = String(context.text || '').split('\n');
  const known = nums(context.text);
  const pickLine = (t) => lines.find((l) => l.includes(`[${t}]`)) || '';
  const isPickLine = (l) => /\[P\d{1,2}\]/.test(l);
  // What one pick may be quoted with: its own line, plus lines about its match that are not another
  // pick's line (match details, starters, injuries) and lines about no match at all (constraints).
  const teamsOf = (x) => [x.e?.home, x.e?.away].filter(Boolean).map(low);
  const allTeams = Object.values(tags).flatMap(teamsOf);
  const allowed = {};
  for (const [t, x] of Object.entries(tags)) {
    const mine = teamsOf(x);
    const extra = lines.filter((l) => !isPickLine(l) && (mine.some((n) => low(l).includes(n)) || !allTeams.some((n) => low(l).includes(n))));
    allowed[t] = nums([pickLine(t), ...extra].join('\n'));
  }
  const named = (s) => Object.keys(tags).filter((t) => s.includes(`[${t}]`) || (tags[t].pick && low(s).includes(low(tags[t].pick))));

  const unknown = [], misplaced = [];
  for (const sentence of String(answer).split(/(?<=[.!?])\s+|\n+/)) {
    const who = named(sentence);
    for (const n of sentence.match(NUM_IN_ANSWER) || []) {
      if (!has(known, n)) unknown.push(n);
      else if (who.length === 1 && !has(allowed[who[0]], n)) misplaced.push({ number: n, pick: tags[who[0]].pick });
    }
  }
  const used = [...new Set([...String(answer).matchAll(/\[(P\d{1,2})\]/g)].map((m) => m[1]))].filter((t) => tags[t]);
  let text = String(answer).replace(/\[(P\d{1,2})\]/g, (m, t) => (tags[t] ? `**${tags[t].pick}**` : m));
  if (unknown.length) text += `\n\n_Unverified: ${[...new Set(unknown)].slice(0, 4).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in ATLAS's data; trust the cards below._`;
  if (misplaced.length) {
    const by = [...new Set(misplaced.map((m) => m.pick))];
    text += `\n\n_Check: ${[...new Set(misplaced.map((m) => m.number))].slice(0, 4).join(', ')} ${misplaced.length > 1 ? 'are' : 'is'} not ${by.length === 1 ? `${by[0]}'s` : 'the named pick\'s'} number in ATLAS's data (it belongs to another pick); trust the cards below._`;
  }
  return { text, picks: used.map((t) => tags[t]), unverified: unknown, misplaced };
}
