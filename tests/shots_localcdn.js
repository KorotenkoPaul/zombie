// usage: node shots.js '[["out.png","js",waitms],...]' [w] [h]
const {chromium}=require('playwright');const fs=require('fs');
const NM=__dirname+'/cdn/node_modules/';
(async()=>{const list=JSON.parse(process.argv[2]);const w=+process.argv[3]||390,h=+process.argv[4]||844;
const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:w,height:h}});
p.on('pageerror',e=>console.log('PE',e.message));
p.on('console',m=>{if(m.type()==='error'||m.text().startsWith('DBG'))console.log('C',m.text().slice(0,300))});
await p.route(/cdn\.jsdelivr\.net\/npm\//,async r=>{const u=new URL(r.request().url());let f=u.pathname.replace('/npm/','').replace(/@[\d.]+/,'');
 const fp=NM+f; if(fs.existsSync(fp)){const ct=fp.endsWith('.wasm')?'application/wasm':'application/javascript';return r.fulfill({body:fs.readFileSync(fp),contentType:ct,headers:{'access-control-allow-origin':'*'}});}
 console.log('MISS',f);r.abort();});
const port=process.env.PORT||8126;
await p.goto(`http://localhost:${port}/index.html`);
await p.waitForFunction(()=>window.__th,null,{timeout:300000});
await p.waitForTimeout(1500);
for(const [out,js,wait] of list){if(js){const r=await p.evaluate(js);if(r!==undefined)console.log('R',JSON.stringify(r).slice(0,3000));}
await p.waitForTimeout(wait||1500);await p.screenshot({path:__dirname+'/shots/'+out});}
await b.close();})();
