// node render.js clipName [n] -> outsh/<clip>_hero.jpg strip (front-3/4 and side rows)
const {chromium}=require('playwright'); const fs=require('fs'); const path=require('path');
(async()=>{ const names=process.argv[2].split(','); const n=+process.argv[3]||8;
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']}); const p=await b.newPage();
 await p.route('**/*',async r=>{const u=new URL(r.request().url()); let f=null; if(u.pathname==='/'||u.pathname==='/index.html')f='/tmp/w/view/index.html'; else if(u.pathname.startsWith('/nm/'))f='/tmp/w/node_modules/'+u.pathname.slice(4); else if(u.pathname==='/hero.glb')f='/tmp/w/hero.glb'; else if(u.pathname.startsWith('/clip/'))f='/tmp/w/out/'+u.pathname.slice(6);
  if(!f||!fs.existsSync(f))return r.fulfill({status:404,body:''}); const ct=f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':'application/octet-stream'; r.fulfill({status:200,body:fs.readFileSync(f),contentType:ct});});
 p.on('console',m=>{if(m.type()==='error')console.log('PAGE',m.text())});
 await p.goto('http://x/index.html'); await p.waitForFunction('window.ready',null,{timeout:60000});
 for(const nm of names){ const F=await p.evaluate(u=>setClip(u),'/clip/'+nm+'.json'); const imgs=[];
  for(const v of ['q','side']) for(let k=0;k<n;k++){ const f=Math.round(k*(F-1)/(n-1)); imgs.push(await p.evaluate(([f,v])=>pose(f,v),[f,v])); }
  const html=`<body style="margin:0;background:#111"><div style="color:#ddd;font:14px sans-serif;padding:4px">${nm}</div>`+imgs.map((d,i)=>`<img src="${d}" style="width:180px">${(i+1)%n==0?'<br>':''}`).join('')+'</body>';
  const q=await b.newPage({viewport:{width:180*n,height:450}}); await q.setContent(html); await q.screenshot({path:`/tmp/w/outsh/${nm}_hero.jpg`,quality:80,type:'jpeg',fullPage:true}); await q.close(); console.log(nm); }
 await b.close(); })();
