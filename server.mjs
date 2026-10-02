import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {handleAPI} from './api/handler.mjs';
import {loadFeeds,todayIST} from './api/feeds.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));const port=Number(process.env.PORT||8768);
const env={ODDS_API_KEY:process.env.ODDS_API_KEY||'',AURA_URL:process.env.AURA_URL||'https://aura-production-0486.up.railway.app',AURA_API_TOKEN:process.env.AURA_API_TOKEN||''};
env.saveConfig=async updates=>{const values={PORT:String(port),AURA_URL:env.AURA_URL,ODDS_API_KEY:env.ODDS_API_KEY,AURA_API_TOKEN:env.AURA_API_TOKEN,...updates};await writeFile(path.join(root,'.env'),Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600})};
const files=new Map([['/','index.html'],['/index.html','index.html'],['/dashboard.css','dashboard.css'],['/dashboard.js','dashboard.js'],['/favicon.svg','favicon.svg']]);
const redirects=new Map([['/overview.html','/#dashboard'],['/intelligence.html','/#sources'],['/markets.html','/#multipliers']]);
const server=http.createServer(async(req,res)=>{try{const host=req.headers.host||'';if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){res.writeHead(403);res.end('Local access only');return}
 const url=new URL(req.url,`http://${host}`);if(redirects.has(url.pathname)){res.writeHead(302,{Location:redirects.get(url.pathname)});res.end();return}
 if(url.pathname.startsWith('/api/')){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>24000){res.writeHead(413);res.end();return}chunks.push(c)}const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const out=await handleAPI(request,env);res.writeHead(out.status,Object.fromEntries(out.headers));res.end(Buffer.from(await out.arrayBuffer()));return}
 const file=files.get(url.pathname);if(!file){res.writeHead(404);res.end('Not found');return}const content=await readFile(path.join(root,file));const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"});res.end(content);
 }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Server request failed'}))}});
server.listen(port,'127.0.0.1',()=>{console.log(`ATLAS is running at http://127.0.0.1:${port}`);loadFeeds(todayIST()).then(d=>console.log(`Feeds: ${d.events.length} events; ${d.sources.filter(s=>s.status==='connected').length}/${d.sources.length} sources responded`)).catch(()=>console.log('Initial feed refresh failed; dashboard will retry'))});
// Keep source data fresh while the local service is running, including when the tab is closed.
const timer=setInterval(()=>loadFeeds(todayIST()).catch(()=>{}),60000);timer.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);server.close(()=>process.exit(0))});
