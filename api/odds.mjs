import {request,todayIST,addDay,inWindow,safeURL} from './feeds.mjs';
export const TARGETS=[2,3,4,5,10,20,100,1000];
const cache=new Map();
export function normalizeOdds(events){const out=[];
 for(const e of events){const book=Object.keys(e.bookmakers||{}).find(k=>k.toLowerCase()==='stake');if(!book)continue;
 for(const market of e.bookmakers[book])for(const [idx,row] of (market.odds||[]).entries()){
 const sides=['home','away','draw','over','under','yes','no','1X','X2','12','odd','even'];
 for(const side of sides){const price=Number(row[side]);if(!Number.isFinite(price)||price<=1||price>10000)continue;
 const label=side==='home'?e.home:side==='away'?e.away:side==='draw'?'Draw':side==='1X'?`${e.home} or draw`:side==='X2'?`${e.away} or draw`:side==='12'?'Either team wins':side[0].toUpperCase()+side.slice(1);
 out.push({id:`stake:${e.id}:${market.name}:${idx}:${side}`,event_id:String(e.id),event:`${e.home} vs ${e.away}`,participants:[e.home,e.away],sport:e.sport?.name||'Unknown',league:e.league?.name||'',start:e.date,state:e.status,bookmaker:'Stake',market:market.name,selection:`${row.label?row.label+' · ':''}${label}${row.hdp!==undefined?' '+row.hdp:''}`,odds:price,updated_at:market.updatedAt||null,fetched_at:new Date().toISOString(),source_url:safeURL(row[side+'Link']||e.urls?.[book]),provider:'Odds-API.io'});
 }}}
 return out;
}
export async function loadStakeOdds(env={},day=todayIST()){
 if(!env.ODDS_API_KEY)return{status:'not-connected',provider:'Odds-API.io',bookmaker:'Stake',selections:[],message:'Connect a data-provider key with Stake coverage in Connections. No Stake odds have been fetched.'};
 const key=env.ODDS_API_KEY+day,old=cache.get(key);if(old&&Date.now()-old.at<120000)return old.data;
 const call=async(path,params)=>{const u=new URL('https://api.odds-api.io/v3/'+path);u.search=new URLSearchParams({apiKey:env.ODDS_API_KEY,...params});return(await request(u.href)).json()};
 try{const sports=['football','basketball','tennis','baseball','american-football','ice-hockey','cricket','esports'];
 const batches=await Promise.allSettled(sports.map(sport=>call('events',{sport,bookmaker:'Stake',status:'pending',from:new Date(day+'T00:00:00+05:30').toISOString(),to:new Date(addDay(day,2)+'T00:00:00+05:30').toISOString(),limit:'20'})));
 const ok=batches.filter(r=>r.status==='fulfilled'&&Array.isArray(r.value));if(!ok.length)throw Error('No event request succeeded. Check provider access and quota.');
 const events=ok.flatMap(r=>r.value).filter(e=>inWindow(e.date,day)).slice(0,80);const chunks=[];for(let i=0;i<events.length;i+=10)chunks.push(events.slice(i,i+10));
 const prices=await Promise.allSettled(chunks.map(es=>call('odds/multi',{eventIds:es.map(e=>e.id).join(','),bookmakers:'Stake'})));
 const selections=normalizeOdds(prices.filter(r=>r.status==='fulfilled').flatMap(r=>Array.isArray(r.value)?r.value:[r.value]));
 const failed=batches.length-ok.length+prices.filter(r=>r.status==='rejected').length;
 const data={status:failed?'partial':'connected',provider:'Odds-API.io',bookmaker:'Stake',selections,received_at:new Date().toISOString(),event_count:events.length,scope:'Up to 80 upcoming events across eight sports per refresh; available provider markets only.',message:failed?'Some provider requests failed. Coverage is partial.':'Stake prices received from the configured data provider.'};cache.set(key,{at:Date.now(),data});return data;
 }catch(e){const data={status:'unavailable',provider:'Odds-API.io',bookmaker:'Stake',selections:[],message:String(e.message).replaceAll(env.ODDS_API_KEY,'[redacted]'),received_at:null};cache.set(key,{at:Date.now(),data});return data}
}
export function eligibleSelections(selections,{now=Date.now(),day=todayIST(new Date(now)),sport='All',maxAge=300000}={}){
 return selections.filter(s=>{const updated=Date.parse(s.updated_at),start=Date.parse(s.start);return s.bookmaker==='Stake'&&Number.isFinite(s.odds)&&s.odds>=1.3&&s.odds<=1000&&['pending','scheduled','pre'].includes(s.state)&&start>now&&todayIST(new Date(start))===day&&Number.isFinite(updated)&&updated<=now+60000&&now-updated<=maxAge&&(sport==='All'||s.sport?.toLowerCase()===sport.toLowerCase())});
}
export function buildTickets(selections,target,{now=Date.now(),day=todayIST(new Date(now)),sport='All'}={}){
 target=Number(target);if(!TARGETS.includes(target))throw Error('Unsupported target multiplier');
 const eligible=eligibleSelections(selections,{now,day,sport});const limit=target<=5?5:3;const upper=target*1.12,lower=target*.95;
 const candidates=eligible.filter(s=>s.odds<=upper).sort((a,b)=>a.odds-b.odds||a.id.localeCompare(b.id)).slice(0,80);
 let beam=[{legs:[],odds:1,events:new Set(),people:new Set()}];const found=new Map();
 // Bounded beam search. One leg per event and no repeated participant within a ticket.
 for(let depth=0;depth<10;depth++){
  const next=new Map();
  for(const state of beam)for(const s of candidates){if(state.events.has(s.event_id)||(s.participants||[]).some(p=>state.people.has(p.toLowerCase()))||state.legs.length&&s.id<=state.legs.at(-1).id)continue;
   const odds=state.odds*s.odds;if(odds>upper)continue;
   const legs=[...state.legs,s],signature=legs.map(l=>l.id).join('|');const v={legs,odds,events:new Set([...state.events,s.event_id]),people:new Set([...state.people,...(s.participants||[]).map(p=>p.toLowerCase())])};
   if(odds>=lower)found.set(signature,v);else next.set(signature,v);
  }
  // Keep several bands of partial products, so early high products do not crowd out all alternatives.
  const buckets=new Map();for(const v of next.values()){const bin=Math.floor(Math.log(v.odds)/Math.log(target)*40);const list=buckets.get(bin)||[];list.push(v);buckets.set(bin,list)}
  beam=[...buckets.values()].flatMap(list=>list.sort((a,b)=>b.odds-a.odds).slice(0,8)).slice(0,240);if(!beam.length)break;
 }
 const ranked=[...found.values()].sort((a,b)=>Math.abs(Math.log(a.odds/target))-Math.abs(Math.log(b.odds/target))||a.legs.length-b.legs.length);const chosen=[];
 for(const c of ranked){if(chosen.length>=limit)break;const ids=new Set(c.legs.map(x=>x.id));if(chosen.some(t=>t.legs.length===c.legs.length&&t.legs.every(l=>ids.has(l.id))))continue;chosen.push({id:`${target}-${chosen.length+1}`,target,total_odds:c.odds,breakeven_probability:1/c.odds,legs:c.legs,ranking:'Closest to target; fewer legs break ties. No predictive model.'})}
 return{target,requested_options:limit,options:chosen,eligible_count:eligible.length,missing_options:Math.max(0,limit-chosen.length),message:chosen.length?`${chosen.length} distinct option${chosen.length===1?'':'s'} found from fresh Stake prices.`:'No qualifying combination from fresh Stake prices. Connect the feed or try another date.',disclaimer:'Combined prices assume the bookmaker accepts these legs together. Reciprocal odds are a break-even threshold, not a forecast. Correlation and bookmaker rules can change the offered payout.'};
}
export function bestSingles(selections,options={}){return eligibleSelections(selections,options).sort((a,b)=>a.odds-b.odds).slice(0,5).map(s=>({...s,breakeven_probability:1/s.odds,ranking:'Lowest listed odds at or above 1.30. Market-implied ordering; no validated edge.'}))}
