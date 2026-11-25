#!/usr/bin/env node
// Sound lab: run ONE task start to end and log every sound the game asks for (__audio.play / contact), with the frame, the
// task step, the hero's speed and the hammer's hit counter, so repair sounds can be checked against the animation events.
//   node tests/anim/soundlab.js --task fix_board [--hero old|new|orig] [--max 120]
const {open}=require('./lib');const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const TASK=arg('task','fix_board'),HERO=arg('hero','old'),MAX=+arg('max',120);
(async()=>{const {b,p}=await open({seed:1,query:(HERO==='old'?'':'?hero='+HERO),vp:{width:320,height:320}});
 await p.evaluate(()=>{__qa.start();__qa.reseed(12345);__th.setHour(10);window.__SL=[];const A=window.__audio;let last=null;
  const rec=(kind,n)=>{const a=__dbg.HH.act,r=__dbg.hero.root.position;const v=last?Math.hypot(r.x-last[0],r.z-last[1])*60:0;
   window.__SL.push([__qa.frame,kind,n,__dbg.hero.task,a&&a.step,+v.toFixed(2),a&&a.hm?a.hm.hit:null,a&&a.hm?+(a.hm.ph/a.hm.T).toFixed(2):null]);};
  window.__SLv=()=>{const r=__dbg.hero.root.position;last=[r.x,r.z];};
  const p0=A.play,c0=A.contact;A.play=(n,...x)=>{rec('play',n);return p0(n,...x);};A.contact=e=>{rec('contact',e&&(e.tool+':'+e.kind));return c0(e);};});
 const step=n=>p.evaluate(n=>{for(let i=0;i<n;i++){__SLv();__qa.step(1,1/60);}return {t:__dbg.hero.task,st:__dbg.HH.act&&__dbg.HH.act.step};},n);
 const ask=()=>p.evaluate(t=>{const B=window.__brain;if(B&&B.command)B.command(t);else __th.task(t);},TASK);
 await step(30);await ask();let seen=false,n=0,steps=[],last='';
 while(n<MAX*60){const s=await step(30);n+=30;if(s.t===TASK){seen=true;if(s.st!==last){steps.push(s.st);last=s.st;}}else if(seen)break;else if(n%300===0)await ask();}
 const L=await p.evaluate(()=>window.__SL);console.log(TASK,HERO,'steps',steps.join('>'));
 for(const r of L)if(r[3]===TASK)console.log(r.join(' '));await b.close();})();
