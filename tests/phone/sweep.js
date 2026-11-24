#!/usr/bin/env node
// PHONE SWEEP: the hero as Pavel sees him on the iPhone. Plays the game naturally (brain decides, no forced tasks)
// from the game's own random start and shoots with the REAL game camera in portrait: the home view (⌂) and the
// hero zoom (◎, classic zoomK = ZMIN), plus a 2x crop around the hero from the zoom shot.
// Usage: node tests/phone/sweep.js --out DIR [--seed 7] [--every 300] [--frames 21600] [--w 390 --h 844] [--dpr 2] [--post]
const fs=require('fs'),path=require('path');const {open}=require('./lib');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const OUT=path.resolve(arg('out','/tmp/phone'));const SEED=+arg('seed',7),EVERY=+arg('every',300),FR=+arg('frames',21600);
const W=+arg('w',390),H=+arg('h',844),DPR=+arg('dpr',2),POST=process.argv.includes('--post'),HOME=!process.argv.includes('--nohome');
const HOUR=arg('hour',null);
(async()=>{fs.mkdirSync(OUT,{recursive:true});
 const {b,p,errs}=await open({seed:SEED,vp:{width:W,height:H},dpr:DPR});
 await p.addStyleTag({content:'#load,#hint{display:none!important}'});await p.evaluate(()=>__qa.start());
 if(HOUR!==null)await p.evaluate(h=>__th.setHour(+h),HOUR);
 await p.evaluate(()=>{const T=__dbg.THREE,HH=__dbg.HH,R=__camera.rig;
  window.__ph={
   shot(mode){if(mode==='home')R.goHome();else R.setFollow(true);for(let i=0;i<40;i++)R.update(.1,{});
    if(__camera.dof)__camera.dof(false);
    const cam=__qaCamera;cam.updateMatrixWorld();__noRender(false);
    if(window.__phPost)__qaComposer.render();else{let sc=__dbg.hero.root;while(sc.parent)sc=sc.parent;__realRender.call(__renderer,sc,cam);}
    __noRender(true);
    // hero bbox on screen
    const bb=[1e9,1e9,-1e9,-1e9];const v=new T.Vector3();
    for(const n of ['Head','Hips','LeftFoot','RightFoot','LeftHand','RightHand','HeadTop_End']){const bn=HH.bones[n];if(!bn)continue;bn.getWorldPosition(v);v.project(cam);
     const x=(v.x*.5+.5)*innerWidth,y=(-v.y*.5+.5)*innerHeight;bb[0]=Math.min(bb[0],x);bb[1]=Math.min(bb[1],y);bb[2]=Math.max(bb[2],x);bb[3]=Math.max(bb[3],y);}
    return bb.map(Math.round);},
   chk(){const B=HH.bones,v=n=>B[n]?B[n].getWorldPosition(new T.Vector3()):null;const out=[];const h=__dbg.hero;
    for(const sd of ['Left','Right']){const Hp=v(sd+'UpLeg'),K=v(sd+'Leg'),A=v(sd+'Foot'),Ts=v(sd+'ToeBase');if(!Hp||!K||!A||!Ts)continue;
     const ha=A.clone().sub(Hp),t=K.clone().sub(Hp).dot(ha)/ha.lengthSq();const off=K.clone().sub(Hp.clone().add(ha.clone().multiplyScalar(t)));
     const fwd=Ts.clone().sub(A);fwd.y=0;if(fwd.lengthSq()<1e-6)continue;fwd.normalize();
     const th=K.clone().sub(Hp).normalize(),sh=A.clone().sub(K).normalize();const bend=Math.acos(Math.max(-1,Math.min(1,th.dot(sh))))*57.3;
     const side=off.dot(fwd);
     if(bend>12&&side<-0.02)out.push(sd[0]+'knee-back '+bend.toFixed(0)+'deg '+(side*100).toFixed(0)+'cm');}
    return out;},
   st(){const h=__dbg.hero;let clip=null;try{const c=h.cur;clip=c&&c.getClip?c.getClip().name:null;}catch(e){}
    return {task:h.task,state:h.state,clip,root:h.root.position.toArray().map(v=>+v.toFixed(2)),lad:!!h.lad,seated:!!h.seated,bed:!!h.inBed,hour:__th.state().hour};}};
 });
 await p.evaluate(x=>{window.__phPost=x;},POST);
 const log=[],flags=[];let lastFlag=-1e9;let f=0;const t0=Date.now();
 const sharp=require('fs');
 while(f<=FR){
  const st=await p.evaluate(()=>__ph.st());const tag=String(f).padStart(6,'0');const rec={f,...st};
  for(const mode of HOME?['home','zoom']:['zoom']){const bb=await p.evaluate(m=>__ph.shot(m),mode);
   const file=`${OUT}/f${tag}_${mode}.jpg`;await p.screenshot({path:file,type:'jpeg',quality:85});rec[mode]=bb;
   if(mode==='zoom'){const cx=(bb[0]+bb[2])/2,cy=(bb[1]+bb[3])/2,hh=Math.max(120,(bb[3]-bb[1])*1.6),ww=hh*.8;
    const clip={x:Math.max(0,cx-ww/2),y:Math.max(0,cy-hh/2),width:Math.min(ww,W),height:Math.min(hh,H)};
    if(clip.x+clip.width>W)clip.x=W-clip.width;if(clip.y+clip.height>H)clip.y=H-clip.height;
    try{await p.screenshot({path:`${OUT}/f${tag}_crop.jpg`,type:'jpeg',quality:90,clip});}catch(e){}}}
  log.push(rec);fs.writeFileSync(OUT+'/log.json',JSON.stringify(log));
  console.log(tag,st.hour,st.task,st.state,st.clip,((Date.now()-t0)/1000|0)+'s');
  for(let k=0;k<EVERY;k+=20){await p.evaluate(n=>__qa.step(n,1/60),20);f+=20;
   const bad=await p.evaluate(()=>__ph.chk());
   if(bad.length){const s2=await p.evaluate(()=>__ph.st());const tag2=String(f).padStart(6,'0');console.log('FLAG',tag2,bad.join(','),s2.task,s2.state,s2.clip);
    if(f-lastFlag>=240){lastFlag=f;const bb=await p.evaluate(()=>__ph.shot('zoom'));const cx=(bb[0]+bb[2])/2,cy=(bb[1]+bb[3])/2,hh=Math.max(160,(bb[3]-bb[1])*1.6),ww=hh*.8;
     const clip={x:Math.max(0,Math.min(W-ww,cx-ww/2)),y:Math.max(0,Math.min(H-hh,cy-hh/2)),width:Math.min(ww,W),height:Math.min(hh,H)};
     try{await p.screenshot({path:`${OUT}/flag_f${tag2}.jpg`,type:'jpeg',quality:90,clip});}catch(e){}}
    flags.push({f,bad,...s2});fs.writeFileSync(OUT+'/flags.json',JSON.stringify(flags));}}}
 if(errs.length)console.log('page errors:',errs.slice(0,5).join('\n'));
 await b.close();})();
