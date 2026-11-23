// Runs the hero's life at a fixed timestep and samples every frame. Shared by run.js (measure) and shots.js (replay + render).
const install=require('./sampler.js');
const TASKS=['read','cook','wash','tea','craft','look','sleep'];
async function simulate(p,{start=6.5,hours=25,dt=1/60,tour=true,capture=null,log=console.log}={}){
 const info=await p.evaluate(`(${install})({})`);
 await p.evaluate(()=>__qa.start());
 await p.evaluate(h=>{__qa.reseed(12345);__th.setHour(h);},start);
 const CH=600;let total=0;const plan=[];
 // phase 1: natural day, the hero chooses for himself
 // capture: optional {frames:Set of frame numbers, fn:async frame=>{}} called right after that frame was simulated
 const cap=capture?[...capture.frames].sort((a,b)=>a-b):[];let ci=0;
 const runFrames=async(n,tag)=>{let done=0;while(done<n){let k=Math.min(CH,n-done);
   while(ci<cap.length&&cap[ci]<=total)ci++;if(ci<cap.length&&cap[ci]<=total+k)k=cap[ci]-total;
   await p.evaluate(([k,dt,tag])=>__qa.step(k,dt,f=>__A.sample(f,dt,__th.state().hour,tag)),[k,dt,tag]);done+=k;total+=k;
   if(ci<cap.length&&cap[ci]===total){await capture.fn(total);ci++;}}};
 // a game day: 14 h of day in 110 s and 10 h of night in 70 s -> frames per in-game hour differ; step until the clock has run `hours`
 let ran=0;let prevH=start;
 while(ran<hours){await runFrames(CH,'day');const h=await p.evaluate(()=>__th.state().hour);let d=h-prevH;if(d<0)d+=24;ran+=d;prevH=h;}
 log('natural day done: frames',total);
 // phase 2: every activity at least once, forced (covers what the random day skipped)
 if(tour){const seen=new Set(await p.evaluate(()=>__A.out.frames.filter(f=>f.state==='work').map(f=>f.task)));
  const seq=[['read',11],['cook',8],['wash',9],['tea',13],['craft',10],['look',16],['read',19.9],['sleep',22.5],['cook',7]];
  for(const [t,h] of seq){if(seen.has(t)&&t!=='sleep')continue;
   await p.evaluate(([t,h])=>{__th.setHour(h);__th.task(t);},[t,h]);let settled=0,n=0;
   while(n<60*60){await runFrames(60,'tour:'+t);n+=60;const s=await p.evaluate(()=>{const h=__dbg.hero;return {path:h.path.length,state:h.state,rm:!!h.swing||!!h.trans,lad:!!h.lad}});
    if(s.path==0&&!s.rm&&!s.lad&&s.state==='work'){if(++settled>=8)break;}else settled=0;}
   log('tour',t,'frames',n);}}
 return {info,total};
}
module.exports={simulate,TASKS};
