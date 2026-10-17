// Temporary: MotoGP results feed and a few more league feeds (CI only).
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', Accept: 'application/json' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t: t.slice(0, 200) }; } catch (e) { return { s: 0, e: e.message }; } };
const short = (o, d = 0) => { if (o == null || typeof o !== 'object') return JSON.stringify(o)?.slice(0, 60); if (Array.isArray(o)) return `[${o.length}] ${o.length ? short(o[0], d + 1) : ''}`; if (d > 2) return '{…}'; return `{${Object.entries(o).slice(0, 25).map(([k, v]) => `${k}: ${short(v, d + 1)}`).join(', ')}}`; };
const M = 'https://api.motogp.pulselive.com/motogp/v1';
const seasons = (await get(`${M}/results/seasons`)).j || [];
const cur = seasons.find((s) => s.current) || seasons[0];
console.log('season', cur?.year, cur?.id);
const cats = (await get(`${M}/results/categories?seasonUuid=${cur?.id}`)).j || [];
console.log('categories', short(cats).slice(0, 600));
const gp = cats.find((c) => /motogp/i.test(c.name)) || cats[0];
const st = await get(`${M}/results/standings?seasonUuid=${cur?.id}&categoryUuid=${gp?.id}`);
console.log('standings', st.s, short(st.j).slice(0, 1500));
const evs = (await get(`${M}/results/events?seasonUuid=${cur?.id}&isFinished=false`)).j || [];
console.log('upcoming events', short(evs).slice(0, 1200));
const ev = evs[0];
if (ev) { const ses = await get(`${M}/results/sessions?eventUuid=${ev.id}&categoryUuid=${gp?.id}`); console.log('sessions', ses.s, short(ses.j).slice(0, 1200)); }
for (const u of ['https://www.shl.se/api/sports-v2/game-schedule', 'https://www.nationalleague.ch/api/games', 'https://api.volleyballworld.com/v1/matches']) { const r = await get(u); console.log('\n=== ', u, r.s, r.j ? short(r.j).slice(0, 500) : r.t || r.e); }
