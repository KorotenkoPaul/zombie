// node run.js out_dir file1.fbx [file2.fbx ...]  -> out_dir/<name>.json (hero clip format, 30 fps)
const {chromium}=require('playwright'); const fs=require('fs'); const path=require('path');
(async()=>{ const [outDir,...files]=process.argv.slice(2); const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']}); const p=await b.newPage();
 await p.route('**/*',async r=>{const u=new URL(r.request().url()); let f=null; const pn=decodeURIComponent(u.pathname);
  if(pn==='/index.html')f=''+(process.env.FBXPAGE||__dirname+'/fbx2hero.html')+''; else if(pn.startsWith('/nm/'))f='/tmp/w/node_modules/'+pn.slice(4); else if(pn==='/hero.glb')f='/tmp/w/hero.glb'; else if(pn.startsWith('/f/'))f=pn.slice(2);
  if(!f||!fs.existsSync(f))return r.fulfill({status:404,body:''}); r.fulfill({status:200,body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});});
 p.on('console',m=>{if(m.type()==='error')console.log('PAGE',m.text())}); p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('http://x/index.html'); if(process.env.NAMES) await p.evaluate(()=>window.OPT={names:1}); await p.waitForFunction('window.ready',null,{timeout:60000});
 for(const f of files){ const r=await p.evaluate(u=>convert(u),'/f'+path.resolve(f)); if(r.err){console.log(f,r.err,r.names);continue;}
  const nm=path.basename(f).replace(/\.fbx$/i,'').replace(/[^A-Za-z0-9_]+/g,'_'); fs.writeFileSync(path.join(outDir,nm+'.json'),JSON.stringify(r)); console.log(nm,r.frames,'frames K',r.K.toFixed(3),'missing',r.missing.join(',')||'-'); }
 await b.close(); })();
