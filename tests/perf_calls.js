// Per-draw-call attribution (main + shadow passes): which object groups cost how many calls and triangles per frame.
// node tests/perf_calls.js [hour]   (iPhone 13 emulation; serve game/ on :8126)
const {chromium,devices}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({...devices['iPhone 13']});p.on('pageerror',e=>console.log('PE',e.message));
await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:180000});
await p.evaluate(h=>window.__th.setHour(h),+(process.argv[2]||21.5));await p.waitForTimeout(8000);
await p.evaluate(()=>{const R=window.__perf.renderer;const orig=R.renderBufferDirect;window.__rec=null;
 R.renderBufferDirect=function(camera,scene,geometry,material,object,group){if(window.__rec){let top=object,path=[];while(top.parent&&top.parent.type!=='Scene'){top=top.parent;}
  const key=(top.name?'':'@'+top.position.toArray().map(v=>v.toFixed(1)).join(',')+' ')+(camera.isOrthographicCamera||camera.isPerspectiveCamera&&camera.fov===90?'SH ':'')+(top.name||top.type)+'/'+(object.name||'')+'/'+(material.type)+(material.transparent?'T':'')+'/'+(geometry.type);
  const n=(geometry.index?geometry.index.count:geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:(geometry.instanceCount??1)===Infinity?1:(object.isInstancedMesh?object.count:(geometry.isInstancedBufferGeometry?geometry.instanceCount:1)));
  const r=window.__rec[key]||(window.__rec[key]=[0,0]);r[0]++;r[1]+=n;}return orig.apply(this,arguments);};});
await p.evaluate(()=>new Promise(res=>{let k=0;const f=()=>{k++;if(k===2)window.__rec={};if(k===4){window.__done=JSON.stringify(window.__rec);res();return;}requestAnimationFrame(f);};requestAnimationFrame(f);}));
const rec=JSON.parse(await p.evaluate(()=>window.__done));
// two frames recorded (k=2..3): halve
const rows=Object.entries(rec).map(([k,v])=>[k,v[0]/2,Math.round(v[1]/2)]);
const tot=rows.reduce((a,r)=>[a[0]+r[1],a[1]+r[2]],[0,0]);console.log('TOTAL calls',tot[0],'tris',tot[1]);
const agg={};for(const [k,c,t] of rows){const g=k.split('/')[0];agg[g]=agg[g]||[0,0];agg[g][0]+=c;agg[g][1]+=t;}
console.log(Object.entries(agg).sort((a,b)=>b[1][0]-a[1][0]).slice(0,40).map(([k,v])=>v[0].toString().padStart(6)+' calls '+String(v[1]).padStart(8)+' tris  '+k).join('\n'));
console.log('--- top tris');console.log(rows.sort((a,b)=>b[2]-a[2]).slice(0,15).map(r=>r[1]+' '+r[2]+' '+r[0]).join('\n'));
await b.close();})();
