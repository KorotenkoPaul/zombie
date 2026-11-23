// Strobe storyboard of the hero's walks from a scenario log (tests/mm/scenario.js): ghosts every K frames at their real place.
// node tests/mm/strobe.js frames.json.gz out.png --from F --to F [--k 8] [--three /path/to/node_modules] [--glb hero.glb] [--title text]
const fs=require('fs'),zlib=require('zlib'),path=require('path');const {chromium}=require('playwright');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const [inp,out]=process.argv.slice(2);const D=JSON.parse(zlib.gunzipSync(fs.readFileSync(inp)));const F=D.frames;
const from=+arg('from',-1e12),to=+arg('to',1e12),K=+arg('k',8);const NM=path.resolve(arg('three','node_modules'));const GLB=arg('glb');
const LQ=['Hips','Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightUpLeg','RightLeg','RightFoot','RightToeBase'];
(async()=>{const fr=F.filter(f=>f.f>=from&&f.f<=to&&f.lq);const poses=[];
 for(let i=0;i<fr.length;i+=K){const f=fr[i];const q={};LQ.forEach((n,j)=>q[n]=f.lq[j]);poses.push({q,hips:f.hp,x:f.root[0],y:f.root[1],z:f.root[2],ry:f.ry,op:.85});}
 if(process.argv.includes('--strip')){// film strip: every ghost in its own slot, turned so the start heading faces right; keeps the real hips height and turns
  const fa=fr[0].root,fb=fr[fr.length-1].root;const y0=Math.hypot(fb[0]-fa[0],fb[2]-fa[2])>.3?Math.atan2(fb[0]-fa[0],fb[2]-fa[2]):fr[0].ry,r0=fr[0].root[1];poses.forEach((q,i)=>{q.x=i*.75;q.z=0;q.y=fr[Math.min(fr.length-1,i*K)].root[1]-r0;q.ry=q.ry-y0+Math.PI/2;q.op=1;});
  const cx=(poses.length-1)*.75/2;const cam=[cx,1.1,Math.max(4,poses.length*.75*1.25)];
  const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:+arg('w',1600),height:360},deviceScaleFactor:1});
  await p.route('http://v/**',r=>{const u=new URL(r.request().url()).pathname;let f=u.startsWith('/three/')?path.join(NM,u):u==='/hero.glb'?GLB:path.join(__dirname,'view.html');
   r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});});
  await p.goto('http://v/');await p.waitForFunction(()=>window.ready,null,{timeout:120000});
  await p.evaluate(([ps,o])=>show(ps,o),[poses,{cam,at:[cx,.7,0],gy:0,fov:13}]);
  if(arg('title'))await p.evaluate(t=>{const d=document.createElement('div');d.textContent=t;d.style.cssText='position:fixed;left:16px;top:10px;font:600 22px sans-serif;color:#333';document.body.appendChild(d);},arg('title'));
  await p.screenshot({path:out});await b.close();console.log(out,poses.length,'poses');return;}
 // camera: look at the middle of the path from the side of its main direction
 const xs=poses.map(p=>p.x),zs=poses.map(p=>p.z),ys=poses.map(p=>p.y);const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2,cy=Math.min(...ys);
 const ex=Math.max(...xs)-Math.min(...xs),ez=Math.max(...zs)-Math.min(...zs);const span=Math.max(1.5,Math.hypot(ex,ez));
 const side=ex>ez?[0,0,1]:[1,0,0];const dist=span*2.3+2;const cam=[cx+side[0]*dist*.8,cy+dist*.55,cz+side[2]*dist*.8];
 const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:1400,height:560},deviceScaleFactor:1});
 await p.route('http://v/**',r=>{const u=new URL(r.request().url()).pathname;let f=u.startsWith('/three/')?path.join(NM,u):u==='/hero.glb'?GLB:path.join(__dirname,'view.html');
  r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});});
 p.on('pageerror',e=>console.log(e.message));await p.goto('http://v/');await p.waitForFunction(()=>window.ready,null,{timeout:120000});
 await p.evaluate(([ps,o])=>show(ps,o),[poses,{cam,at:[cx,cy+.5,cz],gy:cy+.002,fov:30}]);
 if(arg('title'))await p.evaluate(t=>{const d=document.createElement('div');d.textContent=t;d.style.cssText='position:fixed;left:16px;top:10px;font:600 22px sans-serif;color:#333';document.body.appendChild(d);},arg('title'));
 await p.screenshot({path:out});await b.close();console.log(out,poses.length,'poses');})();
