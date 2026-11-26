const {chromium,devices}=require('playwright');const OUT=process.argv[2];
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({...devices['iPhone 13'],deviceScaleFactor:2});p.setDefaultTimeout(900000);p.on('pageerror',e=>console.log('PE',e.message));
await p.goto('http://localhost:8126/index.html?cam=free');await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:600000});
console.log('mobile',await p.evaluate(()=>matchMedia('(pointer:coarse)').matches));
await p.evaluate(()=>__th.setHour(13));await p.waitForTimeout(20000);
const wf=n=>p.evaluate(n=>new Promise(r=>{let k=0;const f=()=>{if(++k>=n)return r();requestAnimationFrame(f)};requestAnimationFrame(f)}),n);
for(const [tag,t,yaw,pitch,dist] of [['home',null],['crown_front',{x:0.3,y:15,z:1},0.1,0.15,16],['crown_right',{x:0.3,y:15,z:1},0.9,0.2,16]]){
 if(t)await p.evaluate(([t,yaw,pitch,dist])=>__th.rig.set({target:t,yaw,pitch,dist,snap:true,home:false}),[t,yaw,pitch,dist]);
 await wf(4);await p.screenshot({path:OUT+'/ph_'+tag+'.png'});console.log('shot',tag);}
await b.close();})();
