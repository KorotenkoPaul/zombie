#!/usr/bin/env node
// Penetration lab: send him to repair MANY parts of one kind (every wear candidate, or --n of them), one after the other in one
// page, and list where his body sinks into what he repairs (the QA analyzer's penetration / prop-through-body checks), per part.
//   node tests/anim/penlab.js --task fix_shingle [--hero old|new|orig] [--n 8] [--work 8] [--flags __x]
const {open}=require('./lib');const install=require('./sampler.js');const {analyze}=require('./analyze');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const T=arg('task','fix_shingle'),HERO=arg('hero','old'),N=+arg('n',8),WORK=+arg('work',8),K={fix_board:'floor',fix_wall:'wall',fix_railing:'post',fix_shingle:'shingle'}[T];
(async()=>{const {b,p}=await open({seed:1,query:(HERO==='old'?'?':'?hero='+HERO+'&')+'wear&noplcull',vp:{width:+arg('px',240),height:+arg('px',240)}});
 await p.evaluate(`(${install})({})`);await p.evaluate(f=>{for(const k of f.split(',').filter(Boolean)){const [n,v]=k.split('=');window[n]=v===undefined?true:+v;}},arg('flags',''));
 await p.evaluate(()=>{__qa.start();__qa.reseed(12345);__th.setHour(10);});
 const ids=await p.evaluate(k=>{const W=window.__wear;W.set('__init',0);return W.candidates(k);},K);
 const pick=arg('ids','')?arg('ids').split(',').map(Number):ids.filter((_,i)=>i%Math.max(1,Math.floor(ids.length/N))===0).slice(0,N);console.log(T,HERO,ids.length,'candidates, testing',pick.join(','));
 const step=(n,tag)=>p.evaluate(([n,tag])=>{let st='';__qa.step(n,1/60,f=>{const a=__dbg.HH.act;st=(a&&a.step)||'';__A.sample(f,1/60,__th.state().hour,tag+':'+st);});return {t:__dbg.hero.task,st};},[n,tag]);
 const agg={};const SHOOT=+arg('shoot',0),OUT=arg('out','/tmp/penlab');require('fs').mkdirSync(OUT,{recursive:true});
 const shoot=async tag=>{const c=await p.evaluate(arg_focus=>{const b=__dbg.heroBones;const v=new __dbg.THREE.Vector3();(b[arg_focus]||b.Spine1||b.Hips).getWorldPosition(v);return v.toArray();},arg('focus','Spine1'));const fr=await p.evaluate(()=>__qa.frame);
  let vi=0;for(const yaw of [0,1.57,3.14,4.71]){await p.evaluate(([c,yaw,D])=>{const cam=__qaCamera;cam.position.set(c[0]+Math.sin(yaw)*D,c[1]+.5,c[2]+Math.cos(yaw)*D);cam.lookAt(c[0],c[1],c[2]);cam.near=.05;cam.updateProjectionMatrix();
   if(window.__camera&&window.__camera.dof)window.__camera.dof(false);__qaCamera.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);},[c,yaw,+arg('dist',1.6)]);
   await p.locator('canvas').first().screenshot({path:`${OUT}/${tag}_f${fr}_${vi++}.png`});}
  require('child_process').execSync(`cd ${OUT} && ffmpeg -y -loglevel error -i ${tag}_f${fr}_0.png -i ${tag}_f${fr}_1.png -i ${tag}_f${fr}_2.png -i ${tag}_f${fr}_3.png -filter_complex hstack=4 ${tag}_f${fr}.jpg`);console.log(' shot',`${OUT}/${tag}_f${fr}.jpg`);};
 for(const id of pick){await p.evaluate(([t,id])=>{const W=window.__wear;W.set(id,1);const c=window.__planks.list().find(c=>c.id===id);__brain.command(t,{target:id,pos:c.pos.slice()});},[T,id]);
  let n=0,ok=false;while(n<60*90){const s=await step(30,'p'+id);n+=30;if(s.t===T&&s.st==='work'){ok=true;break;}if(s.t!==T&&n%600===0)await p.evaluate(([t,id])=>{const c=window.__planks.list().find(c=>c.id===id);__brain.command(t,{target:id,pos:c.pos.slice()});},[T,id]);}
  if(!ok){console.log(' part',id,'never reached work');await p.evaluate(()=>{__A.out.frames.length=0;});continue;}if(SHOOT){await step(SHOOT,'w'+id);await shoot('p'+id);await step(Math.max(0,WORK*60-SHOOT),'w'+id);}else await step(WORK*60,'w'+id);
  const D=await p.evaluate(()=>{const o={...__A.out,frames:__A.out.frames.slice(),names:__A.collNames(),mov:__A.movNames()};__A.out.frames.length=0;return o;});const R=analyze(D);const byF=new Map(D.frames.map(f=>[f.f,f]));
  for(const q of R.issues){if(!/penetration|prop-through/.test(q.type))continue;const f=byF.get(q.f);if(!f||!/^w/.test(f.tag||''))continue;const k=f.tag.split(':')[0]+' '+q.type+' '+q.bone+' '+String(q.into||'').slice(0,28);if(!agg[k]||q.value>agg[k].v)agg[k]={v:q.value,f:q.f,P:q.P,clip:q.clip};}
  await p.evaluate(id=>{window.__wear.set(id,0);__th.task&&__th.task('idle');},id);await step(60,'x');await p.evaluate(()=>{__A.out.frames.length=0;});}
 for(const [k,v] of Object.entries(agg).sort((a,b)=>b[1].v-a[1].v))console.log(' P'+v.P,k,v.v,'cm @f'+v.f,v.clip||'');
 await b.close();})();
