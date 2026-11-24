#!/usr/bin/env node
// Pose probe (owner: the "poses standing / sitting / sleeping" thread).
// Puts the hero into one low-motion state at a time (standing idle, looking round, sitting on the chair, on the deck edge,
// on the bed edge, kneeling at a repair, lying asleep in each pose), runs it at a fixed 1/60 s step with a no-op brain,
// and measures every frame:
//   headHips  : head yaw vs pelvis (deg)          -- owl head when > ~80
//   headChest : head yaw vs chest (deg)           -- neck alone, > ~60 is too much
//   ankle L/R : shin-to-foot angle minus the standing neutral (deg, + = toes pulled up, - = pointed)
//   pitch L/R : foot (ankle->toe) tilt vs its standing tilt (deg) when the toes are within 6 cm of the floor (flat sole = 0)
//   roll  L/R : planted foot rolled onto its edge (deg)
//   knee  L/R : knee bent the wrong way (deg; > 0 = backwards)
//   toeUnder  : how far the toes go below the floor (cm)
//   lids      : eyelid closure 0..1
// Usage: node tests/pose/probe.js --out DIR [--only name,name] [--shots] [--query '?x']
const fs=require('fs'),path=require('path');const {open}=require('../anim/lib');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const OUT=path.resolve(arg('out','/tmp/pose'));const ONLY=arg('only',null);const SHOTS=process.argv.includes('--shots');
fs.mkdirSync(OUT,{recursive:true});
// scenarios: setup runs in the page (H = __dbg.HH), frames to run, shots at these frames
const SC=[
 {name:'idle',setup:`H.spawn('window');`,frames:900,shots:[...Array(8)].map((_,i)=>200+i*100)},
 {name:'deck-look',setup:`H.spawn('look');`,frames:1500,shots:[...Array(10)].map((_,i)=>150+i*150)},
 {name:'read',setup:`H.spawn('read');`,frames:900,shots:[...Array(6)].map((_,i)=>150+i*150),view:[[0,.9,1.3],[-.6,.7,1.2],[.6,.7,1.2]]},
 {name:'ledge',setup:`H.spawn('look');H.H.path=[];setTimeout(()=>{},0);`,after:`H.startTask('ledge');`,afterAt:120,frames:3600,shots:[...Array(12)].map((_,i)=>2000+i*150)},
 {name:'telescope',setup:`H.spawn('telescope');`,frames:1500,shots:[...Array(8)].map((_,i)=>300+i*150)},
 {name:'sleep-back',setup:`window.__sleepPose='back';H.spawn('sleep');`,frames:600,shots:[590],view:[[0,.3,2.6],[.9,.35,2.0],[-.5,.5,.9,'LeftFoot']]},
 {name:'sleep-sideL',setup:`window.__sleepPose='sideL';H.spawn('sleep');`,frames:600,shots:[590],view:[[0,.3,2.6],[.9,.35,2.0],[-.5,.5,.9,'LeftFoot']]},
 {name:'sleep-sideR',setup:`window.__sleepPose='sideR';H.spawn('sleep');`,frames:600,shots:[590],view:[[0,.3,2.6],[.9,.35,2.0]]},
 {name:'sleep-bellyL',setup:`window.__sleepPose='bellyL';H.spawn('sleep');`,frames:600,shots:[590],view:[[0,.3,2.6],[.9,.35,2.0],[-.5,.5,.9,'LeftFoot']]},
 {name:'getup',setup:`window.__sleepPose='back';H.spawn('sleep');setTimeout(()=>{},0);`,after:`H.startTask('look');`,afterAt:240,frames:900,shots:[300,400,500,600,700]},
 {name:'liedown',setup:`H.spawn('window');`,after:`H.startTask('sleep');`,afterAt:30,frames:4000,trig:`H.H.trans&&H.H.fit&&H.H.fit.mode==='sit'`,rel:420,shots:[...Array(29)].map((_,i)=>i*15),view:[[0,.3,2.6],[1.57,.35,2.6],[3.14,.35,2.6],[-1.2,.7,2.6]]},
 {name:'fix_board',setup:`H.spawn('fix_board');`,frames:1500,shots:[1100,1500]},
 {name:'clear_roof',setup:`H.spawn('clear_roof');`,frames:1500,shots:[1100,1500]},
 {name:'pond',setup:`H.spawn('fetchwater');`,frames:3000,shots:[]},
];
const MEASURE=`(()=>{const T=__dbg.THREE,HH=__dbg.HH,B=HH.bones,H=HH.H,root=HH.root;const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
 if(!window.__PR){// calibration from the bind pose: each bone's local axis that points where the body faces / up
  let sk=null;root.traverse(o=>{if(o.isSkinnedMesh&&!sk)sk=o;});const S=sk.skeleton;const saved=S.bones.map(b=>b.quaternion.clone());const sp=S.bones.map(b=>b.position.clone());
  const ry=root.rotation.y;root.rotation.y=0;S.pose();root.updateMatrixWorld(true);const loc=(b,w)=>w.clone().applyQuaternion(b.getWorldQuaternion(new T.Quaternion()).invert());
  const C={};for(const n of ['Hips','Spine2','Head','LeftFoot','RightFoot'])C[n]={f:loc(B[n],V(0,0,1)),u:loc(B[n],V(0,1,0)),r:loc(B[n],V(1,0,0))};
  const ang=(s)=>{const a=B[s+'Leg'].getWorldPosition(V()),f=B[s+'Foot'].getWorldPosition(V()),t=B[s+'ToeBase'].getWorldPosition(V());return {ank:f.clone().sub(a).angleTo(t.clone().sub(f))*57.3,pitch:Math.asin((t.y-f.y)/t.distanceTo(f))*57.3};};
  C.L=ang('Left');C.R=ang('Right');S.bones.forEach((b,i)=>{b.quaternion.copy(saved[i]);b.position.copy(sp[i]);});root.rotation.y=ry;root.updateMatrixWorld(true);window.__PR={C,rows:[]};}
 const C=__PR.C;const wq=n=>B[n].getWorldQuaternion(new T.Quaternion());
 const yawOf=(n)=>{const f=C[n].f.clone().applyQuaternion(wq(n));return Math.atan2(f.x,f.z);};
 const wr=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};
 const upright=C.Hips.u.clone().applyQuaternion(wq('Hips')).y>.8;
 const r={f:__qa.frame,task:H.task,clip:H.cur&&H.cur.getClip().name,bed:!!H.inBed||!!H.bedB,seat:!!H.seated,fit:!!H.fit,walk:H.path.length>0,lad:!!H.lad};
 r.headHips=upright?+(wr(yawOf('Head')-yawOf('Hips'))*57.3).toFixed(1):null;r.headChest=upright?+(wr(yawOf('Head')-yawOf('Spine2'))*57.3).toFixed(1):null;
 const g=H.ground&&!H.fit?H.floorY:(H.fit?H.fit.base:null);
 for(const s of ['Left','Right']){const k=s[0];const hp=B[s+'UpLeg'].getWorldPosition(V()),kn=B[s+'Leg'].getWorldPosition(V()),an=B[s+'Foot'].getWorldPosition(V()),to=B[s+'ToeBase'].getWorldPosition(V());
  const ank=an.clone().sub(kn).angleTo(to.clone().sub(an))*57.3;r['ank'+k]=+ank.toFixed(1);// raw shin-to-foot angle (deg)
  const pitch=Math.asin(Math.max(-1,Math.min(1,(to.y-an.y)/to.distanceTo(an))))*57.3;
  const low=g!=null&&to.y-g<.06&&an.y-g<.2;r['pitch'+k]=low?+(pitch-C[k].pitch).toFixed(1):null;
  const rr=C[s+'Foot'].r.clone().applyQuaternion(wq(s+'Foot'));r['roll'+k]=low?+(Math.asin(Math.max(-1,Math.min(1,rr.y)))*57.3).toFixed(1):null;
  r['toeUnder'+k]=g!=null?+Math.max(0,(g-to.y)*100).toFixed(1):null;r['heel'+k]=g!=null?+((an.y-g)*100).toFixed(1):null;
  // knee: the knee must point the way the pelvis faces (front of the leg); angle of the knee offset behind the hip-ankle line
  const hf=C.Hips.f.clone().applyQuaternion(wq('Hips'));const leg=an.clone().sub(hp);const ld=leg.clone().normalize();const mid=hp.clone().add(an).multiplyScalar(.5);const off=kn.clone().sub(mid);off.addScaledVector(ld,-off.dot(ld));
  const pf=hf.clone().addScaledVector(ld,-hf.dot(ld));r['knee'+k]=(off.length()>.01&&pf.length()>.1)?+(off.normalize().dot(pf.normalize())<-.3?Math.asin(Math.min(1,off.length()/ (leg.length()*.5)))*57.3:0).toFixed(1):0;}
 const em=root.getObjectByName('eyelids');r.lids=em&&em.morphTargetDictionary?+(em.morphTargetInfluences[em.morphTargetDictionary.blink]||0).toFixed(2):null;
 r.hip=B.Hips.getWorldPosition(V()).toArray().map(v=>+v.toFixed(3));r.head=B.Head.getWorldPosition(V()).toArray().map(v=>+v.toFixed(3));
 __PR.rows.push(r);return r;})()`;
const summ=rows=>{const S={};const keys=['headHips','headChest','ankL','ankR','pitchL','pitchR','rollL','rollR','kneeL','kneeR','toeUnderL','toeUnderR'];
 for(const k of keys){const v=rows.map(r=>r[k]).filter(x=>x!=null).map(Math.abs).sort((a,b)=>a-b);if(!v.length)continue;S[k]={p50:+v[v.length>>1].toFixed(1),p95:+v[Math.floor(v.length*.95)].toFixed(1),max:+v[v.length-1].toFixed(1),n:v.length};}
 return S;};
// diagnostic shot: own camera at the hero, every mesh between the camera and the body hidden for the frame (walls, beams, leaves)
async function shot(p,file,view){for(const [k,v] of (view||[[.6,.25,2.3],[2.3,.25,2.3]]).entries()){
 await p.evaluate(([yo,pitch,dist,bn])=>{const T=__dbg.THREE,HH=__dbg.HH,B=HH.bones;const c=B[bn||'Hips'].getWorldPosition(new T.Vector3());if(!bn)c.y+=.05;const yaw=HH.root.rotation.y+yo;
  const cam=__qaCamera;cam.position.set(c.x+Math.sin(yaw)*Math.cos(pitch)*dist,c.y+Math.sin(pitch)*dist,c.z+Math.cos(yaw)*Math.cos(pitch)*dist);cam.lookAt(c);cam.fov=40;cam.updateProjectionMatrix();cam.updateMatrixWorld();
  const sc=HH.root.parent;let hero=new Set();HH.root.traverse(o=>hero.add(o));const hid=[];const rc=new T.Raycaster();const ms=[];sc.traverseVisible(o=>{if(o.isMesh&&!o.isSprite&&!hero.has(o))ms.push(o);});
  for(const t of ['Hips','Head','LeftFoot','RightFoot','LeftHand','RightHand','LeftLeg','RightLeg']){const q=B[t].getWorldPosition(new T.Vector3());const d=q.clone().sub(cam.position);const L=d.length();rc.set(cam.position,d.normalize());rc.far=L-.12;
   for(let it=0;it<12;it++){const h=rc.intersectObjects(ms.filter(o=>o.visible),false).find(h=>h.object.isMesh&&h.object.visible&&!hero.has(h.object)&&!(()=>{for(let q=h.object;q;q=q.parent)if(/bed|quilt|cover|mattress|chair|pillow/i.test(q.name||''))return true;return false;})());if(!h)break;h.object.visible=false;hid.push(h.object);}}
  const amb=new T.AmbientLight(0xffffff,__qaCamera&&window.__PRlight||1.2);sc.add(amb);if(window.__camera&&window.__camera.dof)window.__camera.dof(false);__noRender(false);__qaComposer.render();__noRender(true);sc.remove(amb);for(const o of hid)o.visible=true;},v);
 await p.locator('canvas').first().screenshot({path:file+'_'+k+'.png'});}}
(async()=>{const res={};
 for(const sc of SC){if(ONLY&&!ONLY.split(',').includes(sc.name))continue;const t0=Date.now();
  const {b,p,errs}=await open({seed:7,vp:{width:480,height:480},query:arg('query','')});
  if(SHOTS)await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
  await p.evaluate(()=>__qa.start());
  await p.evaluate(s=>{const H=__dbg.HH;H.setBrain({tick(){}});__th.setHour(/sleep/.test(s.name)?1:/getup/.test(s.name)?6.5:14);window.__PR=null;eval(s.setup);},sc);
  const rows=[];let f0=null;
  for(let f=1;f<=sc.frames;f++){
   if(sc.after&&f===sc.afterAt)await p.evaluate(s=>{const H=__dbg.HH;eval(s.after);},sc);
   await p.evaluate(()=>__qa.step(1,1/60));rows.push(await p.evaluate(MEASURE));
   if(sc.trig&&f0==null&&await p.evaluate(s=>{const H=__dbg.HH;return !!eval(s.trig);},sc)){f0=f;console.log('trigger at',f);}
   const fr=sc.trig?(f0==null?-1:f-f0):f;if(sc.trig&&fr>sc.rel)break;
   if(SHOTS&&sc.shots.includes(fr))await shot(p,`${OUT}/${sc.name}_${String(fr).padStart(4,'0')}`,sc.view);
  }
  fs.writeFileSync(`${OUT}/${sc.name}.json`,JSON.stringify(rows));res[sc.name]=summ(rows.filter(r=>!r.walk&&!r.lad));
  console.log(sc.name,((Date.now()-t0)/1000).toFixed(0)+'s',JSON.stringify(res[sc.name]));if(errs.length)console.log('  errs',errs.slice(0,3).join(' | '));
  await b.close();}
 fs.writeFileSync(`${OUT}/summary.json`,JSON.stringify(res,null,1));})();
