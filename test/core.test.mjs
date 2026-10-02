import test from 'node:test';import assert from 'node:assert/strict';
import {eligibleSelections,buildTickets,normalizeOdds} from '../api/odds.mjs';
import {todayIST,inWindow,parseESPN} from '../api/feeds.mjs';
const now=Date.parse('2026-10-02T06:00:00Z'),day='2026-10-02';
const selection=i=>({id:String(i).padStart(3,'0'),event_id:String(i),participants:['a'+i,'b'+i],bookmaker:'Stake',odds:Math.sqrt(2),state:'pending',start:'2026-10-02T12:00:00Z',updated_at:new Date(now-1000).toISOString()});
test('IST date boundary and 48 hour window',()=>{assert.equal(todayIST(new Date('2026-10-01T19:00:00Z')),day);assert.ok(inWindow('2026-10-03T18:29:59Z',day));assert.ok(!inWindow('2026-10-03T18:30:00Z',day))});
test('stale, unknown, completed and other bookmaker prices excluded',()=>{const s=selection(1);assert.equal(eligibleSelections([s,{...s,updated_at:null},{...s,updated_at:new Date(now-400000).toISOString()},{...s,state:'finished'},{...s,bookmaker:'Other'}],{now,day}).length,1)});
test('five distinct 2x options; exact products and independent events',()=>{const result=buildTickets(Array.from({length:8},(_,i)=>selection(i)),2,{now,day});assert.equal(result.options.length,5);assert.equal(new Set(result.options.map(t=>t.legs.map(l=>l.id).join(','))).size,5);for(const t of result.options){assert.ok(Math.abs(t.total_odds-2)<1e-9);assert.equal(new Set(t.legs.map(l=>l.event_id)).size,t.legs.length)}});
test('same match or participant cannot be combined',()=>{assert.equal(buildTickets([selection(1),{...selection(2),event_id:'1'}],2,{now,day}).options.length,0);assert.equal(buildTickets([selection(1),{...selection(2),participants:['a1','z']}],2,{now,day}).options.length,0)});
test('no prices never produces invented tickets',()=>{for(const target of [2,3,4,5,10,20,100,1000])assert.equal(buildTickets([],target,{now,day}).options.length,0)});
test('provider market timestamp is preserved',()=>{const d=normalizeOdds([{id:1,home:'A',away:'B',bookmakers:{Stake:[{name:'ML',updatedAt:'stamp',odds:[{home:'1.4',away:'3'}]}]}}]);assert.equal(d[0].updated_at,'stamp');assert.equal(d[0].odds,1.4)});
test('mixed tennis tournament is separated by grouping',()=>{const competition={id:1,date:'2026-10-02T12:00:00Z',competitors:[{athlete:{displayName:'A'}},{athlete:{displayName:'B'}}]};const d={events:[{groupings:[{grouping:{slug:'mens-singles'},competitions:[competition]},{grouping:{slug:'womens-singles'},competitions:[{...competition,id:2}]}]}]};assert.equal(parseESPN(d,'ATP','tennis/atp')[0].external_id,'1');assert.equal(parseESPN(d,'WTA','tennis/wta')[0].external_id,'2')});

test('multiplier slips can be limited to matches still to start today', async () => {
  const { todayEvents, localDay } = await import('../js/engine.js');
  const now = new Date(2026, 9, 2, 15, 0).getTime(); // 3pm local
  const at = (h) => new Date(2026, 9, 2, h, 0).getTime();
  const evs = [
    { id: 'a', start: at(18) },
    { id: 'b', start: at(23) },
    { id: 'c', start: new Date(2026, 9, 3, 1, 0).getTime() }, // tomorrow
    { id: 'd', start: at(13) }, // already started
    { id: 'e', start: at(14), live: true },
  ];
  assert.deepEqual(todayEvents(evs, now).map((e) => e.id), ['a', 'b']);
  assert.equal(localDay(at(18)), localDay(now));
});
