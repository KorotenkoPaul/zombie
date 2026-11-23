// Close-up checks of the hero's activities: node tests/hero_moves.js [outDir] [tasks...]
// Serves nothing itself: run `cd game && python3 -m http.server 8126` first.
const {chromium}=require('playwright');
const out=process.argv[2]||'/tmp/hero_moves';const want=process.argv.slice(3);
require('fs').mkdirSync(out,{recursive:true});
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:720,height:540}});p.on('pageerror',e=>console.log('PE',e.message));p.on('console',m=>{if(m.type()==='error')console.log('CE',m.text().slice(0,300))});
await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__dbg&&window.__dbg.HH,null,{timeout:180000});
await p.evaluate(()=>{window.__th.setHour(10);});
const probe=()=>p.evaluate(()=>{const {HH,heroBones:B,THREE}=window.__dbg;const H=HH.H;const w=o=>o.getWorldPosition(new THREE.Vector3());const r=v=>+v.toFixed(3);
 const toe=Math.min(w(B.LeftToeBase).y,w(B.RightToeBase).y),heel=Math.min(w(B.LeftFoot).y,w(B.RightFoot).y);const fl=HH.floorAt(H.root.position.x,H.root.position.y+.5,H.root.position.z,.6,1.5);
 return {task:H.task,node:HH.node(),clip:H.cur&&H.cur.getClip().name,root:[r(H.root.position.x),r(H.root.position.y),r(H.root.position.z)],hips:r(w(B.Hips).y),floor:fl&&r(fl),toeAbove:fl&&r(toe-fl),ankleAbove:fl&&r(heel-fl),seated:!!H.seated,inBed:!!H.inBed,fit:H.fit&&{mode:H.fit.mode,y:r(H.fit.y)}};});
const shot=async(name,{d=2.2,dy=1.0,yaw=.5,pitch=.15}={})=>{await p.evaluate(([d,dy,yaw,pitch])=>{const h=window.__dbg.hero.root.position;window.__th.view(yaw,pitch,1);window.__th.cam(h.x,h.y+dy,d,h.z);},[d,dy,yaw,pitch]);
 await p.waitForTimeout(1500);await p.screenshot({path:`${out}/${name}.png`,timeout:180000});console.log(name,JSON.stringify(await probe()));};
const run=async(task,ms)=>{await p.evaluate(t=>{window.__TS=6;window.__dbg.HH.startTask(t);},task);
 await p.waitForFunction(t=>{const H=window.__dbg.HH.H;return H.task===t&&!H.path.length&&!H.trans;},task,{timeout:240000}).catch(e=>console.log('wait fail',task));
 await p.evaluate(()=>{window.__TS=1;});await p.waitForTimeout(ms);};
await shot('00-start-read',{d:1.8,dy:.8,yaw:.9});await p.waitForTimeout(3000);await shot('01-start-read-b',{d:1.6,dy:.8,yaw:-.6});
const T=want.length?want:['cook','craft','tea','wash','sleep','read'];
for(const t of T){await run(t,4000);await shot(t+'-a',{d:2.0,dy:.8,yaw:.7});await p.waitForTimeout(3000);await shot(t+'-b',{d:1.8,dy:.7,yaw:-.5});}
await b.close();})();
