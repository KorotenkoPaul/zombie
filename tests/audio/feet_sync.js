// Footstep sync QA: runs the game on the virtual clock (tests/anim/lib.js) at 30 fps, logs per-frame foot speeds and every
// footstep audio.js schedules (window.__feetLog), then: python3 tests/audio/feet_sync_report.py /tmp/feet_30.json
// env: DT (frame step, default 1/30), ROUTE (tasks), OUT (dir).
const pw=require('playwright');const L0=pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch=o=>L0({...o,args:[...(o.args||[]),'--autoplay-policy=no-user-gesture-required']});
const {open}=require('../anim/lib.js');const fs=require('fs');
const DT=+(process.env.DT||1/30);
(async()=>{const {b,p,errs}=await open({seed:3,vp:{width:320,height:320}});
 await p.evaluate(()=>__qa.start());
 await p.mouse.click(100,100);
 for(let i=0;i<120;i++){await p.waitForTimeout(1000);const ok=await p.evaluate(()=>window.__audio&&window.__audio.loaded()&&window.__audio.started());if(ok)break;await p.evaluate(()=>__qa.step(2,1/30));}
 const st=await p.evaluate(()=>({loaded:__audio.loaded(),ctx:__audio.node()&&__audio.node().context.state}));console.log(st);
 await p.evaluate(()=>{window.__feetBones=true;window.__feetLog=[];__th.setHour(10.5);__audio.mute(false);});
 const route=(process.env.ROUTE||'cook,wash,craft,look,window,read,telescope').split(',');
 for(const t of route){await p.evaluate(t=>__th.task(t),t);for(let k=0;k<20;k++){await p.evaluate(dt=>__qa.step(30,dt),DT);}}
 const log=await p.evaluate(()=>window.__feetLog);fs.writeFileSync((process.env.OUT||'/tmp')+'/feet_'+Math.round(1/DT)+'.json',JSON.stringify(log));
 console.log('log',log.length,'S',log.filter(x=>x[0]=='S').length,errs.slice(0,3));await b.close();})().catch(e=>{console.error(e);process.exit(2);});
