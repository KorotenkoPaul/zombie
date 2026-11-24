#!/usr/bin/env node
// Task lab: force ONE task (eat, dishes, wash...) from start to end, sample every frame with the QA sampler, print the
// issues inside that task by step, and optionally photograph chosen moments from 4 sides.
//   node tests/anim/tasklab.js --task eat [--hour 13] [--hero new] [--shots 6] [--out DIR] [--max 150]
const fs=require('fs'),path=require('path');const {open}=require('./lib');const install=require('./sampler.js');const {analyze}=require('./analyze');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const TASK=arg('task','eat'),HOUR=+arg('hour',13),HERO=arg('hero','old'),SHOTS=+arg('shots',0),MAX=+arg('max',150),OUT=path.resolve(arg('out','/tmp/tasklab/'+TASK+'-'+HERO));
const OPTS=JSON.parse(arg('opts','null'));
(async()=>{fs.mkdirSync(OUT,{recursive:true});const {b,p,errs}=await open({seed:+arg('seed',1),query:HERO==='new'?'?hero=new':HERO==='detail'?'?hero=detail':'',vp:{width:480,height:480}});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(`(${install})({})`);await p.evaluate(()=>__qa.start());await p.evaluate(h=>{__qa.reseed(12345);__th.setHour(h);},HOUR);
 const step=n=>p.evaluate(([n])=>{let st='';__qa.step(n,1/60,f=>{const a=__dbg.HH.act;st=(a&&a.step)||'';__A.sample(f,1/60,__th.state().hour,'step:'+st);});return {task:__dbg.hero.task,step:st,f:__qa.frame};},[n]);
 const ask=()=>p.evaluate(([t,o])=>{const B=window.__brain;if(B&&B.command)B.command(t,o||undefined);else __th.task(t);},[TASK,OPTS]);
 await step(30);await ask();let seen=false,n=0,idle=0,t0f=null,steps=[];let last='';
 while(n<MAX*60){const s=await step(30);n+=30;if(s.task===TASK){if(!seen){seen=true;t0f=s.f;}if(s.step!==last){steps.push([s.f,s.step]);last=s.step;}}
  if(seen&&s.task!==TASK){if(++idle>=2)break;}else if(!seen&&n%300===0)await ask();}
 const D=await p.evaluate(()=>({...__A.out,names:__A.collNames(),mov:__A.movNames()}));
 const R=analyze(D);const byF=new Map(D.frames.map(f=>[f.f,f]));
 const mine=R.issues.filter(q=>{const f=byF.get(q.f);return f&&f.task===TASK;});
 console.log(`${TASK}/${HERO}: seen=${seen} frames ${n}, steps:`,steps.map(s=>s[1]+'@'+s[0]).join(' '));
 const agg={};for(const q of mine){const f=byF.get(q.f);const k=[q.P,q.type,q.bone,String(q.into||'').replace(/#\d+.*|~\d+/,''),f.tag].join(' | ');if(!agg[k]||q.value>agg[k].v)agg[k]={v:q.value,f:q.f,unit:q.unit,n:0};agg[k].n++;}
 Object.entries(agg).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>console.log(' P'+k+': '+v.v+' '+(v.unit||'')+' x'+v.n+' @f'+v.f));
 fs.writeFileSync(OUT+'/issues.json',JSON.stringify({steps,mine}));fs.writeFileSync(OUT+'/frames.json',JSON.stringify(D.frames.filter(f=>f.task===TASK)));
 if(errs.length)console.log('page errors:',errs.slice(0,4).join(' / '));
 await b.close();
 if(SHOTS){// replay deterministically and photograph evenly spaced moments of the task from 4 sides
  const want=[];const t1=steps.length?Math.max(...mine.map(q=>q.f),steps[steps.length-1][0]+120):0;const fr=[];
  const extra=(arg('frames','')||'').split(',').filter(Boolean).map(Number);
  for(let k=0;k<SHOTS;k++)fr.push(Math.round(t0f+(t1-t0f)*k/(SHOTS-1)));fr.push(...extra);fr.sort((a,b)=>a-b);
  const o=await open({seed:+arg('seed',1),query:HERO==='new'?'?hero=new':HERO==='detail'?'?hero=detail':'',vp:{width:480,height:480}});const P=o.p;
  await P.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
  await P.evaluate(`(${install})({})`);await P.evaluate(()=>__qa.start());await P.evaluate(h=>{__qa.reseed(12345);__th.setHour(h);},HOUR);
  const st=n=>P.evaluate(([n])=>{__qa.step(n,1/60,f=>__A.sample(f,1/60,__th.state().hour,''));return __qa.frame;},[n]);
  const ask2=()=>P.evaluate(([t,o])=>{const B=window.__brain;if(B&&B.command)B.command(t,o||undefined);else __th.task(t);},[TASK,OPTS]);
  let cur=await st(30);await ask2();let m=30;
  for(const F of fr){while(cur<F){const k=Math.min(30,F-cur);cur=await st(k);m+=k;if(m%300===0&&cur<t0f)await ask2();}
   const c=await P.evaluate(()=>{const b=__dbg.heroBones;const h=(b&&b.Hips)||__dbg.hero.root;const v=new __dbg.THREE.Vector3();h.getWorldPosition(v);return v.toArray();});
   let vi=0;const hy=0;for(const yaw0 of (arg('yaws','0,.75,-.75,0.01').split(',').map(Number))){const yaw=hy+yaw0;const file=`${OUT}/f${F}_${vi}.png`;
    await P.evaluate(([c,yaw,D])=>{const cam=__qaCamera;const R=window.__camera&&window.__camera.rig;try{__th.cam&&__th.cam();}catch(e){}
     const top=yaw===.01;cam.position.set(c[0]+Math.sin(yaw)*D*(top?.35:1),c[1]+(top?1.2:.75),c[2]+Math.cos(yaw)*D*(top?.35:1));cam.lookAt(c[0],c[1]+.2,c[2]);cam.near=.05;cam.updateProjectionMatrix();
     if(window.__camera&&window.__camera.dof)window.__camera.dof(false);__qaCamera.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);},[c,yaw,+arg('dist',1.8)]);
    await P.locator('canvas').first().screenshot({path:file});vi++;}}
  await o.b.close();
  const {execSync}=require('child_process');try{execSync(`cd ${OUT} && for f in $(ls f*_0.png|sed 's/_0.png//'); do ffmpeg -y -loglevel error -i \${f}_0.png -i \${f}_1.png -i \${f}_2.png -i \${f}_3.png -filter_complex "[0][1][2][3]hstack=4,drawtext=text='\${f}':x=8:y=8:fontsize=20:fontcolor=yellow" \${f}_row.jpg; done; ffmpeg -y -loglevel error $(ls f*_row.jpg|sort -t f -k2 -n|sed 's/^/-i /') -filter_complex "vstack=inputs=$(ls f*_row.jpg|wc -l)" sheet.jpg`);}catch(e){console.log('sheet',String(e).slice(0,300));}
  console.log('sheet',OUT+'/sheet.jpg');}
})().catch(e=>{console.error(e);process.exit(2);});
