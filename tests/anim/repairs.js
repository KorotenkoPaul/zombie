#!/usr/bin/env node
// Repair lab (house repairs: fix_board, fix_shingle, fix_wall ...): forces each repair, measures the work pose every frame
// (knees: angle + bending the right way, hammer face to nail at each blow, shoulder to nail, hip height) and films it
// from 4 sides. node tests/anim/repairs.js [--tasks fix_board,fix_shingle] [--hero new] [--out DIR] [--shots 0]
const fs=require('fs'),path=require('path');const {open}=require('./lib');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const TASKS=arg('tasks','fix_board,fix_shingle,fix_wall,fix_railing,fix_rope,fix_hinge,fix_window,clear_roof,fix_chimney').split(',');
const OUT=path.resolve(arg('out','/tmp/repairs'));const HERO=arg('hero','old');const SHOTS=+arg('shots',1);const WORK=+arg('work',8);
fs.mkdirSync(OUT,{recursive:true});
const install=()=>{const T=__dbg.THREE,HH=__dbg.HH,B=HH.bones,V=(x,y,z)=>new T.Vector3(x,y,z);
 window.__TR={};if(HH.SLOTS)for(const sl of HH.SLOTS)HH.stage(sl,()=>{const hp=B.Hips.getWorldPosition(V());const hf=B.Head.getWorldPosition(V()).sub(hp).setY(0);const an=B.LeftUpLeg.getWorldPosition(V()).sub(B.RightUpLeg.getWorldPosition(V())).cross(V(0,1,0));const f=HH.H.face;const A=x=>+(((Math.atan2(x.x,x.z)-f+9*Math.PI)%(2*Math.PI))-Math.PI).toFixed(2);const lu=HH.root.worldToLocal(B.LeftUpLeg.getWorldPosition(V())),ru=HH.root.worldToLocal(B.RightUpLeg.getWorldPosition(V()));const la=lu.sub(ru).cross(V(0,1,0));const rf=HH.root.localToWorld(V(0,0,1)).sub(HH.root.position);window.__TR[sl]=[A(hf),A(an),+Math.atan2(la.x,la.z).toFixed(2),A(rf)];{const a=HH.act,P=window.__props,hm=P&&P.tools&&P.tools.benchHammer;if(a&&a.nail&&hm&&hm.parent===B.RightHand){hm.updateMatrixWorld(true);(window.__FS=window.__FS||{})[sl]=(window.__FS[sl]||[]).concat(+hm.localToWorld(V(.102,.146,0)).distanceTo(a.nail).toFixed(3)).slice(-400);}}});
 window.__R={frame(){const w=b=>B[b]?B[b].getWorldPosition(V()):null;const hq=B.Hips.getWorldQuaternion(new T.Quaternion());
  const fw=w('LeftUpLeg').sub(w('RightUpLeg')).cross(V(0,1,0)).setY(0).normalize();/* pelvis forward from anatomy (left hip minus right hip x up), axis-free */const o={};
  for(const s of ['Left','Right']){const U=w(s+'UpLeg'),K=w(s+'Leg'),A=w(s+'Foot');const th=K.clone().sub(U),sh=A.clone().sub(K);
   const knee=180-th.angleTo(sh)*180/Math.PI;const mid=U.clone().add(A).multiplyScalar(.5);const kf=K.clone().sub(mid).dot(fw);
   o[s]={knee:+knee.toFixed(0),kf:+(kf*100).toFixed(1),ankleY:+(A.y-HH.root.position.y).toFixed(3),kneeY:+(K.y-HH.root.position.y).toFixed(3)};}
  const a=HH.act;const P=window.__props;const hm=P&&P.tools&&P.tools.benchHammer;let face=null;
  if(hm&&hm.parent===B.RightHand){const sc=hm.getWorldScale(V()).x;face=hm.localToWorld(V(.102,.146,0));}
  const nail=a&&a.nail?a.nail.clone():null;const sh=w('RightArm');let nr=null,hdAng=null;if(nail){const hp=w('Hips');const hf=w('Head').sub(hp).setY(0);const nd=nail.clone().sub(hp).setY(0);hdAng=+(Math.atan2(hf.clone().cross(nd).y,hf.dot(nd))*180/Math.PI).toFixed(0);const d=nail.clone().sub(hp);nr=[+d.dot(fw).toFixed(2),+(d.clone().setY(0).cross(fw).y).toFixed(2),+(nail.y-HH.root.position.y).toFixed(2)];}
  const acts=Object.entries(HH.actions).filter(([k,x])=>x.isRunning()&&x.getEffectiveWeight()>.05).map(([k,x])=>k+':'+x.getEffectiveWeight().toFixed(2));return {rh:w('RightHand').toArray(),rx:+HH.root.rotation.x.toFixed(2),hm:HH.act&&HH.act.hm?+HH.act.hm.ph.toFixed(2):null,se:HH.act&&HH.act.hm?+(HH.act.hm.e||0).toFixed(3):null,tr:JSON.parse(JSON.stringify(window.__TR)),pg:window.__poseGuard&&(a&&a.step==='work'&&!window.__pgR&&(window.__pgR=1,window.__poseGuard.reset()),1)&&window.__poseGuard.stats?(()=>{const s=window.__poseGuard.stats();return Object.assign({_spine:s.spine,_knee:s.knee,_head:s.head,_fr:s.frames},s.joints);})():null,fs:window.__FS?Object.fromEntries(Object.entries(window.__FS).map(([k,v])=>[k,[Math.min(...v),+(v.reduce((x,y)=>x+y,0)/v.length).toFixed(3)]])):null,acts,hdAng,dbg:HH.H.dbgNail,nr,shY:+(sh.y-HH.root.position.y).toFixed(2),task:__dbg.hero.task,step:a&&a.step,clip:HH.H&&HH.H.clip,hipY:+(w('Hips').y-HH.root.position.y).toFixed(3),low:['LeftLeg','RightLeg','LeftToeBase','RightToeBase','LeftFoot','RightFoot'].map(n=>+(w(n).y-HH.root.position.y).toFixed(3)),legs:o,far:!!(a&&a.hmFar),
   nailSh:nail?+sh.distanceTo(nail).toFixed(3):null,faceNail:nail&&face?+face.distanceTo(nail).toFixed(3):null,hit:a&&a.hm?a.hm.hit:0,errs:a&&a.hm&&a.hm.errs?a.hm.errs.slice():null,dbg2:a&&a.hm?[+(a.hm.al||0).toFixed(3),+(a.hm.w||0).toFixed(2)]:null,sl:window.__FS?Object.fromEntries(Object.entries(window.__FS).map(([k,v])=>[k,v.at(-1)])):null,
   win:a&&a.win?['RightHand','LeftHand','RightForeArm','LeftForeArm','Head','RightArm'].map(n=>+w(n).sub(a.win.p).dot(a.win.n).toFixed(3)):null,root:HH.root.position.toArray().map(v=>+v.toFixed(3)),yaw:+HH.root.rotation.y.toFixed(3),face:+HH.H.face.toFixed(3)};}};};
(async()=>{const o=await open({seed:1,query:(HERO==='new'?'?hero=new&':HERO==='detail'?'?hero=detail&':'?')+'cam=free'});const p=o.p;
 await p.evaluate(()=>__qa.start());await p.evaluate(install);await p.evaluate(f=>{for(const k of f.split(',').filter(Boolean))window[k]=true;},arg('flags',''));await p.evaluate(()=>{__qa.reseed(7);__th.setHour(10);});
 const res={};
 for(const t of TASKS){const ok=await p.evaluate(t=>!!__dbg.HH.hasTask(t),t);if(!ok){res[t]={missing:1};continue;}
  const ask=()=>p.evaluate(t=>{const B=window.__brain;if(B&&B.command)B.command(t);else __th.task(t);},t);
  await p.evaluate(h=>__th.setHour(h),t==='fix_hinge'?17:t==='fix_chimney'?11:10);await ask();
  let n=0,ready=false;while(n<60*120){await p.evaluate(()=>__qa.step(30,1/60));n+=30;const s=await p.evaluate(()=>({t:__dbg.hero.task,st:__dbg.HH.act&&__dbg.HH.act.step}));
   if(s.t===t&&s.st==='work'){ready=true;break;}if(s.t!==t&&n%600===0)await ask();}
  if(!ready){res[t]={never:1,frames:n};console.log(t,'never reached work');continue;}
  await p.evaluate(()=>__qa.step(60,1/60));// blend in
  const fr=await p.evaluate(n=>{const r=[];for(let i=0;i<n;i++){__qa.step(1,1/60);r.push(__R.frame());}return r;},60*WORK);
  const knees=fr.flatMap(f=>['Left','Right'].map(s=>f.legs[s]));const wrong=knees.filter(k=>k.knee<150&&k.kf<-2).length;
  const hits=[],ses=[];for(let i=1;i<fr.length;i++)if(fr[i].hit&&!fr[i-1].hit&&fr[i].faceNail!=null){hits.push(fr[i].faceNail);ses.push(fr[i].se);(globalThis.__ER=globalThis.__ER||[]).push(fr[i].errs);(globalThis.__SL=globalThis.__SL||[]).push(fr[i].sl);}
  let jmp=0,jf=-1;for(let i=2;i<fr.length;i++){const a=fr[i].rh,b=fr[i-1].rh,c=fr[i-2].rh;const d=Math.hypot(a[0]-2*b[0]+c[0],a[1]-2*b[1]+c[1],a[2]-2*b[2]+c[2])*100;if(d>jmp){jmp=d;jf=i;}}
  fs.writeFileSync(OUT+'/'+HERO+'_'+fr.at(-1).task+'_fr.json',JSON.stringify(fr.map(f=>({rh:f.rh,hm:f.hm,se:f.se,d:f.dbg2,hit:f.hit}))));
  const S={rhJump:+jmp.toFixed(1),rhJumpF:jf,rhJumpHm:jf>=0?fr[jf].hm:null,frames:fr.length,far:fr.filter(f=>f.far).length,minKnee:Math.min(...knees.map(k=>k.knee)),wrongKnee:wrong,worstKf:Math.min(...knees.map(k=>k.kf)),
   hipY:[Math.min(...fr.map(f=>f.hipY)),Math.max(...fr.map(f=>f.hipY))],nailSh:fr[0].nailSh,ses,hitsAll:hits,er:globalThis.__ER,sl:globalThis.__SL,hits:hits.length,hitErr:hits.length?+Math.max(...hits).toFixed(3):null,
   rx:fr.map(f=>f.rx).filter((v,i)=>i%60==0),tr:fr.at(-1).tr,fs:fr.at(-1).fs,pg:fr.at(-1).pg,acts:fr.at(-1).acts,hdAng:fr[0].hdAng,dbg:fr[0].dbg,nr:fr[0].nr,shY:fr[0].shY,minFaceNail:Math.min(...fr.map(f=>f.faceNail??9)),clip:fr[0].clip,winMin:fr[0].win?fr[0].win.map((_,i)=>Math.min(...fr.map(f=>f.win?f.win[i]:9))):null,winMax:fr[0].win?fr[0].win.map((_,i)=>Math.max(...fr.map(f=>f.win?f.win[i]:-9))):null,low:fr[0].low,lowEnd:fr.at(-1).low,root:fr[0].root,step:fr.at(-1).step,task:fr.at(-1).task};
  res[t]=S;console.log(t,JSON.stringify(S));console.log("legs",JSON.stringify(fr[0].legs),JSON.stringify(fr[150]&&fr[150].legs));
  if(SHOTS){for(let k=0;k<4;k++){const yaw=fr[0].face+k*Math.PI/2;
    await p.evaluate(([yaw,dist])=>{const scene0=()=>{let s=__dbg.HH.root;while(s.parent)s=s.parent;return s;};const T=__dbg.THREE,HH=__dbg.HH,B=HH.bones;const cam=__qaCamera;const hip=B.Hips.getWorldPosition(new T.Vector3());const tg=hip.clone().add(new T.Vector3(0,.15,0));
     let dd=dist;const bad=(x,y,z)=>{try{if(__dbg.inTrunk&&__dbg.inTrunk(x,y,z,.3))return true;}catch(e){}return false;};while(dd>.8&&bad(tg.x+Math.sin(yaw)*dd,tg.y+.9*dd/dist,tg.z+Math.cos(yaw)*dd))dd-=.15;cam.position.set(tg.x+Math.sin(yaw)*dd,tg.y+.9*dd/dist,tg.z+Math.cos(yaw)*dd);cam.lookAt(tg);if(cam.fov!==50){cam.fov=50;cam.updateProjectionMatrix();}cam.updateMatrixWorld();
     // hide whatever stands between the camera and his body (walls, beams, bunk), never the floor under him
     const hid=[];let mk=null;const a=HH.act;if(a&&a.nail){mk=new T.Mesh(new T.SphereGeometry(.03,8,6),new T.MeshBasicMaterial({color:0xff0000}));mk.position.copy(a.nail);scene0().add(mk);}const rc=new T.Raycaster();const scene=scene0();
     const hero=new Set();HH.root.traverse(o=>hero.add(o));const meshes=[];scene.traverse(o=>{if(o.isMesh&&!hero.has(o)&&o.geometry&&!o.isSkinnedMesh){if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();const sc=o.getWorldScale(new T.Vector3());meshes.push(o);}});const hits=(r)=>{const out=[];for(const m of meshes){if(!m.visible)continue;let vis=true;for(let q=m.parent;q;q=q.parent)if(!q.visible){vis=false;break;}if(!vis)continue;const mt=m.material;const sd=mt&&!Array.isArray(mt)?mt.side:null;if(sd!=null)mt.side=2;try{r.intersectObject(m,false,out);}catch(e){}if(sd!=null)mt.side=sd;}return out.sort((a,b)=>a.distance-b.distance);};
     for(const bn of ['Hips','Head','Spine2','LeftHand','RightHand','LeftLeg','RightLeg','LeftFoot','RightFoot']){const b=B[bn];if(!b)continue;const q=b.getWorldPosition(new T.Vector3());const d=q.clone().sub(cam.position);const L=d.length();rc.set(cam.position,d.normalize());rc.far=L-.12;
      for(let it=0;it<12;it++){const h=hits(rc).find(x=>!(x.object.material&&x.object.material.transparent&&x.object.material.opacity<.05));if(!h)break;
       if(h.point.y<HH.root.position.y+.08)break;h.object.visible=false;hid.push(h.object);}}
     __noRender(false);__qaComposer.render();__noRender(true);for(const o of hid)o.visible=true;if(mk)mk.parent.remove(mk);},[yaw,2.4]);
    await p.locator('canvas').first().screenshot({path:`${OUT}/${HERO}_${t}_${k}.jpg`,type:'jpeg',quality:80});}}
  // let him finish
  await p.evaluate(()=>{const B=window.__brain;try{__dbg.HH.act&&(__dbg.HH.act.T=999);}catch(e){}});await p.evaluate(()=>__qa.step(600,1/60));}
 fs.writeFileSync(OUT+'/'+HERO+'.json',JSON.stringify(res,null,1));console.log('errs',o.errs.slice(0,5));await o.b.close();})().catch(e=>{console.error(e);process.exit(2);});
