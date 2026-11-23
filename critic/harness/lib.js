const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const NM=__dirname+'/node_modules/';
async function open(opts={}){
 const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:opts.vp||{width:390,height:844},deviceScaleFactor:opts.dpr||1});
 const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
 await p.route('https://cdn.jsdelivr.net/npm/**',async r=>{const u=r.request().url().replace('https://cdn.jsdelivr.net/npm/','');const m=u.match(/^(@?[^@]+)@[^/]+\/(.*)$/);const f=NM+m[1]+'/'+m[2];
  if(!fs.existsSync(f)){console.log('MISSING',f);return r.abort();}
  r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.wasm')?'application/wasm':'application/javascript'});});
 await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
 await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__th,null,{timeout:300000});
 return {b,p,errs};
}
module.exports={open};
