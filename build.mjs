import {mkdir,copyFile,cp} from 'node:fs/promises';
await mkdir('dist/client',{recursive:true});await mkdir('dist/server',{recursive:true});
for(const file of ['index.html','desk.html','dashboard.css','dashboard.js','favicon.svg'])await copyFile(file,'dist/client/'+file);
for(const dir of ['js','css','vendor'])await cp(dir,'dist/client/'+dir,{recursive:true});
await copyFile('worker.mjs','dist/server/index.js');await cp('api','dist/server/api',{recursive:true});
console.log('Built static dashboard and Worker API.');
