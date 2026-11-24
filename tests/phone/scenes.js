#!/usr/bin/env node
// PHONE SCENES: asks the brain for given tasks and films them with the real hero-zoom camera (◎) in iPhone portrait.
// Usage: node tests/phone/scenes.js --out DIR [--tasks eat:13,sleep:22.5,dishes:9,cook:12,diary:20] [--every 180] [--max 45] [--seed 1]
const fs=require('fs'),path=require('path');const {open}=require('./lib');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const OUT=path.resolve(arg('out','/tmp/phs'));const SEED=+arg('seed',1),EVERY=+arg('every',180),MAXS=+arg('max',45);
const W=+arg('w',390),H=+arg('h',844),DPR=+arg('dpr',2);
const TASKS=arg('tasks','eat:13,sleep:22.5,dishes:9,cook:12,diary:20').split(',').map(s=>{const [t,h]=s.split(':');return [t,+h||10];});
(async()=>{fs.mkdirSync(OUT,{recursive:true});
 const {b,p,errs}=await open({seed:SEED,vp:{width:W,height:H},dpr:DPR});
 await p.addStyleTag({content:'#load,#hint{display:none!important}'});await p.evaluate(()=>__qa.start());
 await p.evaluate(()=>{const T=__dbg.THREE,HH=__dbg.HH,R=__camera.rig;
  window.__ph={
   shot(){R.setFollow(true);for(let i=0;i<40;i++)R.update(.1,{});if(__camera.dof)__camera.dof(false);
    const cam=__qaCamera;cam.updateMatrixWorld();__noRender(false);let sc=__dbg.hero.root;while(sc.parent)sc=sc.parent;__realRender.call(__renderer,sc,cam);__noRender(true);
    const bb=[1e9,1e9,-1e9,-1e9];const v=new T.Vector3();
    for(const n of ['Head','Hips','LeftFoot','RightFoot','LeftHand','RightHand','HeadTop_End']){const bn=HH.bones[n];if(!bn)continue;bn.getWorldPosition(v);v.project(cam);
     const x=(v.x*.5+.5)*innerWidth,y=(-v.y*.5+.5)*innerHeight;bb[0]=Math.min(bb[0],x);bb[1]=Math.min(bb[1],y);bb[2]=Math.max(bb[2],x);bb[3]=Math.max(bb[3],y);}
    return bb.map(Math.round);},
   chk(){const B=HH.bones,v=n=>B[n]?B[n].getWorldPosition(new T.Vector3()):null;const out=[];
    for(const sd of ['Left','Right']){const Hp=v(sd+'UpLeg'),K=v(sd+'Leg'),A=v(sd+'Foot'),Ts=v(sd+'ToeBase');if(!Hp||!K||!A||!Ts)continue;
     const ha=A.clone().sub(Hp),t=K.clone().sub(Hp).dot(ha)/ha.lengthSq();const off=K.clone().sub(Hp.clone().add(ha.clone().multiplyScalar(t)));
     const fwd=Ts.clone().sub(A);fwd.y=0;if(fwd.lengthSq()<1e-6)continue;fwd.normalize();
     const th=K.clone().sub(Hp).normalize(),sh=A.clone().sub(K).normalize();const bend=Math.acos(Math.max(-1,Math.min(1,th.dot(sh))))*57.3;
     if(bend>12&&off.dot(fwd)<-0.02)out.push(sd[0]+'knee-back '+bend.toFixed(0));}
    return out;},
   st(){const h=__dbg.hero;let clip=null;try{const c=h.cur;clip=c&&c.getClip?c.getClip().name:null;}catch(e){}
    const hip=HH.bones.Hips.getWorldPosition(new T.Vector3());
    return {task:h.task,state:h.state,clip,yaw:+(h.yaw||0).toFixed(2),hipY:+(hip.y-h.root.position.y).toFixed(2),bed:!!h.inBed,seated:!!h.seated,hour:__th.state().hour};}};
 });
 const step=n=>p.evaluate(n=>__qa.step(n,1/60),n);
 await p.evaluate(()=>{__qa.reseed(4242);__th.setHour(9);});await step(1200);
 const all=[];
 for(let n=0;n<TASKS.length;n++){const [t,h]=TASKS[n];const name=String(n).padStart(2,'0')+'_'+t;
  await p.evaluate(h=>__th.setHour(h),h);
  const ask=()=>p.evaluate(t=>{const B=window.__brain;if(B&&B.command)B.command(t);else __th.task(t);},t);await ask();
  let seen=false,fr=0,after=0,last=-1e9,flags=0;const log=[];
  while(fr<60*(MAXS+40)){const s=await p.evaluate(()=>__ph.st());if(s.task===t)seen=true;
   if(!seen&&fr%600===0&&fr>0){if(fr>=2400)break;await ask();}
   const bad=await p.evaluate(()=>__ph.chk());if(bad.length)flags++;
   if(seen&&(fr-last>=EVERY||(bad.length&&fr-last>=60))&&log.length<MAXS*60/EVERY+6){last=fr;const bb=await p.evaluate(()=>__ph.shot());
    const cx=(bb[0]+bb[2])/2,cy=(bb[1]+bb[3])/2,hh=Math.max(200,(bb[3]-bb[1])*1.7),ww=hh*.85;
    const clip={x:Math.max(0,Math.min(W-ww,cx-ww/2)),y:Math.max(0,Math.min(H-hh,cy-hh/2)),width:Math.min(ww,W),height:Math.min(hh,H)};
    const file=`${OUT}/${name}_f${String(fr).padStart(5,'0')}.jpg`;try{await p.screenshot({path:file,type:'jpeg',quality:88,clip});}catch(e){}
    log.push({fr,file:path.basename(file),bad,...s});}
   if(seen&&s.task!==t){if(++after>=8)break;}
   await step(20);fr+=20;}
  all.push({name,t,seen,flags20:flags,log});fs.writeFileSync(OUT+'/log.json',JSON.stringify(all));
  console.log(name,seen?'ok':'NOT STARTED',log.length,'shots, knee flags',flags);}
 if(errs.length)console.log('page errors:',errs.slice(0,5).join('\n'));
 await b.close();})();
