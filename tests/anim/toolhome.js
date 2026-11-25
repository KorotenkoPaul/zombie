#!/usr/bin/env node
// After a tool job ends, is every tool back home (not on his hip, not in a hand)? node tests/anim/toolhome.js [--tasks fix_railing,fix_shingle] [--hero new]
const {open}=require('./lib');const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const TASKS=arg('tasks','fix_railing,fix_shingle,fix_wall,fix_board,fix_hinge').split(',');const HERO=arg('hero','old');
(async()=>{const o=await open({seed:1,query:HERO==='new'?'?hero=new':''});const p=o.p;await p.evaluate(()=>{__qa.start();__qa.reseed(7);__th.setHour(10);});
 for(const t of TASKS){await p.evaluate(h=>__th.setHour(h),t==='fix_hinge'?17:10);await p.evaluate(t=>{const B=window.__brain;if(B&&B.command)B.command(t);else __th.task(t);},t);
  let n=0,seen=false,log=[];while(n<60*240){await p.evaluate(()=>__qa.step(30,1/60));n+=30;const s=await p.evaluate(()=>({t:__dbg.hero.task,st:__dbg.HH.act&&__dbg.HH.act.step}));
   if(s.t===t)seen=true;if(seen&&log.at(-1)!==s.st)log.push(s.st);if(seen&&s.t!==t)break;}
  const r=await p.evaluate(()=>{const P=window.__props,T=window.__dbg.THREE;const out=[];for(const [k,o] of Object.entries(P.tools||{})){if(!o||!o.isObject3D||!o.userData.home)continue;const h=o.userData.home;const hv=h.pos.clone();if(h.parent&&h.parent.matrixWorld)hv.applyMatrix4(h.parent.matrixWorld);const d=o.getWorldPosition(new T.Vector3()).distanceTo(hv);if(d>.15)out.push(k+':'+d.toFixed(2)+(o.parent&&/Hips|Hand/.test(o.parent.name)?'@'+o.parent.name:''));}return {away:out,belt:__dbg.hero.belt||null};});
  console.log(t,seen?'done after '+(n/60).toFixed(0)+'s':'never started',log.join('>'),JSON.stringify(r));}
 await o.b.close();})();
