#!/usr/bin/env node
// HERO WATCH: films the hero doing each activity (walk there + the work + leaving) for visual review.
// Smart follow camera: picks the angle around the hero with the clearest view (raycast from his chest), keeps it
// steady for the whole clip, re-picks only when the view gets blocked. Dense frames (every --every frames) while he
// moves or changes pose, sparse ones (every --calm frames) during steady work.
// Usage: node tests/watch/watch.js --out DIR [--tasks a,b,c] [--hero old|new] [--every 6] [--calm 30] [--seed 1]
// Output: DIR/<NN_task>/f<frame>.jpg + DIR/<NN_task>/log.json (per shot: frame, task, clip, state, root, yaw, ladder, seated, bed)
const fs=require('fs'),path=require('path');const {open}=require('../anim/lib');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const OUT=path.resolve(arg('out','/tmp/hero-watch'));const EVERY=+arg('every',6),CALM=+arg('calm',30),SEED=+arg('seed',1);
const SZ=+arg('size',400);const FAST=!process.argv.includes('--post');const VIEW=arg('view','body');const MAXS=+arg('max',75);
// task, hour, opts, seconds after start to keep filming
const ALL=[['walkabout',10],['tea',9],['chop',9],['pot',8],['stoke',7],['dishes',9],['wash',9],['saw',10],['hammer',10],['sharpen',10],['fixlamp',11],
 ['stretch',8],['diary',20],['sweep',10],['water',9],['listen',21],['radio',20],['telescope',18],['ledge',17],['firewood',10],['supplies',11],
 ['hatch',21.5],['bolt',21.6],['fetchwater',9],['setbucket',9.3],['dumpwater',9.5],['fix_shingle',10],['fix_board',10],['fix_wall',10],['fix_rope',10],['fix_hinge',17],
 ['fix_window',10],['fix_railing',10],['clear_roof',10],['fix_chimney',11],['read',11],['cook',12],['eat',13],['craft',10],['look',16],['sleep',22.5],['trip',15,{kind:'wood',jacket:false}],['store',10]];
(async()=>{fs.mkdirSync(OUT,{recursive:true});
 const want=arg('tasks',null);const list=want?want.split(',').map(t=>ALL.find(a=>a[0]===t)||[t,10]):ALL;
 const hero=arg('hero','old');
 const {b,p,errs}=await open({seed:SEED,vp:{width:SZ,height:SZ}});
 if(hero!=='old')console.log('note: --hero new needs ?hero=new support in lib; using default');
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(()=>__qa.start());await p.evaluate(f=>{window.__watchFast=f;},FAST);
 await p.evaluate(()=>{
  const T=__dbg.THREE,H=__dbg.hero;let scene=H.root;while(scene.parent)scene=scene.parent;
  const mine=o=>{while(o){if(o===H.root)return true;o=o.parent;}return false;};
  const RC=new T.Raycaster();
  let blockers=null;
  const solid=o=>{if(!(o.isMesh)||mine(o)||o.isSkinnedMesh)return false;let x=o;while(x){if(!x.visible)return false;x=x.parent;}
   const m=Array.isArray(o.material)?o.material[0]:o.material;if(!m||(m.transparent&&m.opacity<.6)||m.depthWrite===false)return false;
   let n='';x=o;while(x){n+=' '+(x.name||'');x=x.parent;}if(/grass|leaf|leaves|fern|moss|bush|flower|crown|foliage|fog|sky|rain|smoke|cloud|ground|terrain|bg/i.test(n))return false;
   if(o.isInstancedMesh&&o.count>3000)return false;return true;};
  const clear=(from,dir,max)=>{if(!blockers){blockers=[];scene.traverse(o=>{if(solid(o))blockers.push(o);});}
   RC.set(from,dir);RC.far=max;const h=RC.intersectObjects(blockers,false);return h.length?h[0].distance:max;};
  const W={yaw:null,blocked:0};
  window.__watch={info:()=>({n:blockers?blockers.length:0}),
   shot(force,view){const P=H.root.position;
    // chest point: hips bone if available
    let c=new T.Vector3(P.x,P.y+.75,P.z);try{const hb=__dbg.heroBones||__dbg.HH.bones;const hip=hb&&(hb.Hips||hb.mixamorigHips);if(hip){hip.getWorldPosition(c);c.y+=.1;}}catch(e){}
    if(view==='hands'){try{const hb=__dbg.HH.bones;const a=new T.Vector3(),b=new T.Vector3();hb.RightHand.getWorldPosition(a);hb.LeftHand.getWorldPosition(b);c=a.distanceTo(b)<.45?a.add(b).multiplyScalar(.5):a;}catch(e){}}
    const fy=H.yaw||0;const want=view==='hands'?1.0:2.5,pitch=view==='hands'?.35:.22;
    const score=yaw=>{const d=new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
     // clearance along the ray and from the head and feet too (full body visible)
     const a=clear(c,d,want),b=clear(c.clone().add(new T.Vector3(0,view==='hands'?.15:.55,0)),d,want),f=clear(c.clone().add(new T.Vector3(0,view==='hands'?-.15:-.6,0)),d,want);return Math.min(a,b,f);};
    let need=force||W.yaw===null;if(!need){const s=score(W.yaw);if(s<Math.min(1.3,W.best-.3)){if(++W.blocked>2)need=true;}else W.blocked=0;}
    if(need){let best=-1,by=0;for(let k=0;k<16;k++){const yaw=fy+k*Math.PI/8;const s=score(yaw);
      // prefer seeing his front/side: face direction (yaw of facing = fy) => camera yaw near fy+-0.7
      const front=Math.cos(yaw-fy-.6);const v=Math.min(s,want)+.35*front;if(v>best){best=v;by=yaw;}}
     W.yaw=by;W.best=score(by);W.blocked=0;}
    const dist=Math.max(view==='hands'?.45:.7,Math.min(want,score(W.yaw)-.12));
    const R=window.__camera&&window.__camera.rig;
    if(R&&R.set){if(__th.rig&&__th.rig.cine)__th.rig.cine(false);R.set({target:c.clone(),yaw:W.yaw,pitch,dist:Math.max(dist,1.5),snap:true});for(let i=0;i<4;i++)R.update(.25,{});if(window.__camera.dof)window.__camera.dof(false);}
    const cam=__qaCamera;cam.position.set(c.x+Math.sin(W.yaw)*Math.cos(pitch)*dist,c.y+Math.sin(pitch)*dist,c.z+Math.cos(W.yaw)*Math.cos(pitch)*dist);cam.lookAt(c);
    if(cam.fov&&dist<1.6){cam.fov=Math.min(75,50*1.6/dist);cam.updateProjectionMatrix();}else if(cam.fov!==50){cam.fov=50;cam.updateProjectionMatrix();}
    if(window.__watchFast&&!W.hid){W.hid=1;scene.traverse(o=>{if(o.isInstancedMesh&&o.count>500&&/canopy|forest/i.test(o.name||'')||(o.isInstancedMesh&&o.count>2500))o.visible=false;});}
    const far0=cam.far;if(window.__watchFast){cam.far=18;cam.updateProjectionMatrix();}
    cam.updateMatrixWorld();__noRender(false);if(window.__watchFast)__realRender.call(__renderer,scene,cam);else __qaComposer.render();__noRender(true);if(window.__watchFast){cam.far=far0;cam.updateProjectionMatrix();}
    return {dist:+dist.toFixed(2),yaw:+W.yaw.toFixed(2)};},
   reset(){W.yaw=null;},
   st(){const h=H;const cur=h.cur;let clip=null;try{clip=cur&&(cur.getClip?cur.getClip().name:(cur.name||cur._clip&&cur._clip.name));}catch(e){}
    if(!clip&&h.actions){for(const [k,a] of Object.entries(h.actions)){if(a===cur){clip=k;break;}}}
    return {task:h.task,state:h.state,clip,root:h.root.position.toArray().map(v=>+v.toFixed(3)),yaw:+(h.yaw||0).toFixed(3),lad:!!h.lad,seated:!!h.seated,bed:!!h.inBed,path:h.path.length,swing:!!h.swing,trans:!!h.trans,hour:__th.state().hour};}};
 });
 let total=0;const index=[];
 const step=n=>p.evaluate(n=>__qa.step(n,1/60),n).then(()=>{total+=n;});
 const shoot=async(dir,force)=>{const T0=Date.now();const cam=await p.evaluate(f=>__watch.shot(f[0],f[1]),[!!force,VIEW]);const T1=Date.now();const st=await p.evaluate(()=>__watch.st());
  const file=`${dir}/f${String(total).padStart(6,'0')}.png`;
  for(let tr=0;tr<3;tr++){await p.locator('canvas').first().screenshot({path:file});if(fs.statSync(file).size>12000)break;await p.evaluate(()=>{__noRender(false);__qaComposer.render();__noRender(true);});}
  return {f:total,...st,cam,tShot:T1-T0,tShotAll:Date.now()-T0};};
 // warm-up: let the brain settle 20 s of game time
 await p.evaluate(()=>{__qa.reseed(4242);__th.setHour(9);});await step(1200);
 for(let n=0;n<list.length;n++){const [t,h,opts]=list[n];const name=String(n).padStart(2,'0')+'_'+t;const dir=OUT+'/'+name;fs.mkdirSync(dir,{recursive:true});
  const ok=t==='walkabout'||await p.evaluate(t=>!!(__dbg.HH.hasTask&&__dbg.HH.hasTask(t)),t);
  if(!ok){console.log(name,'not available');continue;}
  await p.evaluate(h=>__th.setHour(h),h);
  const ask=()=>p.evaluate(([t,o])=>{if(t==='walkabout')return;const B=window.__brain;if(B&&B.command)B.command(t,o||undefined);else __th.task(t);},[t,opts||null]);
  await ask();await p.evaluate(()=>__watch.reset());
  const log=[];let seen=t==='walkabout',afterEnd=0,frames=0,last=null,lastShot=-999;const t0=Date.now();
  while(frames<60*MAXS){
   const s=await p.evaluate(()=>__watch.st());
   if(s.task===t)seen=true;
   if(!seen&&frames>0&&frames%120===0){if(frames>=900)break;await ask();}
   // dense while moving / changing pose / on ladders, sparse while steady
   const moving=s.path>0||s.lad||s.swing||s.trans||!last||s.clip!==last.clip||s.state!==last.state||Math.hypot(s.root[0]-last.root[0],s.root[1]-last.root[1],s.root[2]-last.root[2])>.01;
   const gap=moving?EVERY:CALM;
   if(seen&&frames-lastShot>=gap){const ts=Date.now();log.push(await shoot(dir));lastShot=frames;log[log.length-1].ms=Date.now()-ts;if(log.length%10==0)fs.writeFileSync(dir+'/log.json',JSON.stringify({task:t,hour:h,seen,log}));}
   last=s;
   if(seen&&s.task!==t&&t!=='walkabout'){if(++afterEnd>=Math.round(4*60/EVERY))break;}
   await step(EVERY);frames+=EVERY;}
  fs.writeFileSync(dir+'/log.json',JSON.stringify({task:t,hour:h,seen,log},null,0));
  index.push({name,task:t,seen,shots:log.length});
  console.log(name,seen?'filmed':'never started',log.length,'shots',((Date.now()-t0)/1000).toFixed(0)+'s');}
 fs.writeFileSync(OUT+'/index.json',JSON.stringify({seed:SEED,every:EVERY,calm:CALM,index},null,1));
 if(errs.length)console.log('page errors:',errs.slice(0,5).join('\n'));
 await b.close();})();
