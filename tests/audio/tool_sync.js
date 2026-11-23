// Tool contact QA: like feet_sync.js; window.__feetLog also gets TH (right hand per frame while holding a tool) and TC (each contact).
// K=45 ROUTE=saw,hammer node tests/audio/tool_sync.js
const pw=require('playwright');const L0=pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch=o=>L0({...o,args:[...(o.args||[]),'--autoplay-policy=no-user-gesture-required']});
const {open}=require('../anim/lib.js');const fs=require('fs');
const DT=+(process.env.DT||1/30);
(async()=>{const {b,p,errs}=await open({seed:3,vp:{width:320,height:320}});
 await p.evaluate(()=>__qa.start());
 await p.mouse.click(100,100);
 for(let i=0;i<120;i++){await p.waitForTimeout(1000);const ok=await p.evaluate(()=>window.__audio&&window.__audio.loaded()&&window.__audio.started());if(ok)break;await p.evaluate(()=>__qa.step(2,1/30));}
 const st=await p.evaluate(()=>({loaded:__audio.loaded(),ctx:__audio.node()&&__audio.node().context.state}));console.log(st);
 await p.evaluate(()=>{window.__audioTrace=[];window.__feetBones=true;window.__feetLog=[];__th.setHour(10.5);__audio.mute(false);});
 const route=(process.env.ROUTE||'cook,wash,craft,look,window,read,telescope').split(',');
 for(const t of route){await p.evaluate(t=>__th.task(t),t);console.log('task',t);for(let k=0;k<(+process.env.K||20);k++){await p.evaluate(dt=>__qa.step(30,dt),DT);}}
 const tr=await p.evaluate(()=>window.__audioTrace.filter(x=>/tool|saw|stir|hammer|nail/.test(x[1])).map(x=>x[1]+'@'+x[0].toFixed(2)).join(' '));console.log(tr);const log=await p.evaluate(()=>window.__feetLog);fs.writeFileSync((process.env.OUT||'/tmp')+'/feet_'+Math.round(1/DT)+'.json',JSON.stringify(log));
 console.log('log',log.length,'S',log.filter(x=>x[0]=='S').length,errs.slice(0,3));await b.close();})().catch(e=>{console.error(e);process.exit(2);});
