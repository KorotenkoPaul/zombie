// Runs the hero's life at a fixed timestep and samples every frame. Shared by run.js (measure) and shots.js (replay + render).
const install=require('./sampler.js');
const TASKS=['read','cook','wash','tea','craft','look','sleep'];
async function simulate(p,{start=6.5,hours=25,dt=1/60,tour=true,capture=null,log=console.log,gate=0}={}){
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
 while(!gate&&ran<hours){await runFrames(CH,'day');const h=await p.evaluate(()=>__th.state().hour);let d=h-prevH;if(d<0)d+=24;ran+=d;prevH=h;}
 log('natural day done: frames',total);
 // phase 2: every activity at least once, forced (covers what the random day skipped)
 if(tour&&!gate){const seen=new Set(await p.evaluate(()=>__A.out.frames.filter(f=>f.state==='work').map(f=>f.task)));
  const seq=[['read',11],['cook',8],['wash',9],['tea',13],['craft',10],['look',16],['read',19.9],['sleep',22.5],['cook',7]];
  for(const [t,h] of seq){if(seen.has(t)&&t!=='sleep')continue;
   await p.evaluate(([t,h])=>{__th.setHour(h);__th.task(t);},[t,h]);let settled=0,n=0;
   while(n<60*60){await runFrames(60,'tour:'+t);n+=60;const s=await p.evaluate(()=>{const h=__dbg.hero;return {path:h.path.length,state:h.state,rm:!!h.swing||!!h.trans,lad:!!h.lad}});
    if(s.path==0&&!s.rm&&!s.lad&&s.state==='work'){if(++settled>=8)break;}else settled=0;}
   log('tour',t,'frames',n);}
  }
 if(tour||gate){
  // every other body task hero.js knows (HH.hasTask), at an hour that suits it
  const EXTRA=(gate?[['read',11],['cook',8],['wash',9],['tea',13],['craft',10],['look',16],['sleep',22.5]]:[]).concat([['trip',9,{kind:'hunt',jacket:true,lantern:true},240],['store',10],['cook',12,{fromFridge:true}],['eat',13],['fetchwater',9],['dumpwater',9.5],
   ['trip',15,{kind:'wood',jacket:false},240],['hatch',10],['bolt',21],['chop',9],['pot',8],['stoke',7],['dishes',9],['supplies',11],['saw',10],['hammer',10],['sharpen',10],['fixlamp',11],
   ['stretch',8],['diary',20],['sweep',10],['water',9],['listen',21],['radio',20],['telescope',18],['ledge',17],['firewood',10],['splitwood',10],
   ['fix_shingle',10],['fix_board',10],['fix_wall',10],['fix_rope',10],['fix_hinge',17],['fix_window',10],['fix_railing',10],['clear_roof',10],['fix_chimney',11]]);
  for(const [t,h,opts,maxS] of EXTRA){const ok=await p.evaluate(t=>!!(__dbg.HH.hasTask&&__dbg.HH.hasTask(t)),t);if(!ok){log('tour',t,'not available');continue;}
   // through the brain (the body alone does not route between floors); the brain may slip its own chore in first, so ask again until he takes it
   const ask=()=>p.evaluate(([t,o,g])=>{const B=window.__brain;const MR=Math.random;
    // gate: bed straight away. The bedtime chores (bolt, hatch) are planned by dice and are their own gate tasks; without this sleep came and went as a block
    if(g&&t==='sleep')Math.random=()=>.995;try{if(B&&B.command)B.command(t,o||undefined);else __th.task(t);}finally{Math.random=MR;}},[t,opts||null,!!gate]);
   if(gate){// isolated: every task starts from the same seeded state (reading at the table, hatch open, needs primed for that hour)
    await p.evaluate(([t,h])=>{let x=2166136261;for(const c of t)x=Math.imul(x^c.charCodeAt(0),16777619)>>>0;__qa.reseed(x);__th.setHour(h);const B=window.__brain;if(B&&B.prime)B.prime(h);
     __dbg.HH.spawn('read');const ht=window.__house&&window.__house.hatch;if(ht&&ht.open)ht.open();},[t,h]);await runFrames(30,'tour:'+t);}
   else await p.evaluate(h=>__th.setHour(h),h);
   await ask();let n=0,seen=false,idle=0;
   const cap=gate?60*(t==='sleep'?gate+35:gate):60*(maxS||90);
   while(n<cap){await runFrames(60,'tour:'+t);n+=60;const s=await p.evaluate(()=>__dbg.hero.task);if(s===t)seen=true;if(seen&&s!==t){if(++idle>=3)break;}else if(!seen){if(n>=900)break;await ask();}}
   log('tour',t,seen?'ran':'never started','frames',n);}}
 return {info,total};
}
module.exports={simulate,TASKS};
