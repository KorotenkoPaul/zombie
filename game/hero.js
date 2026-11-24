// The hero: body animation, navigation and daily life.
// Everything about the character lives here so other work on index.html does not collide with it.
//
// How the body is driven:
//  * Base motions: Meshy library clips (walk, ladders, turns) plus "hy_*" clips generated from text with
//    Hunyuan Motion on fal and retargeted onto this skeleton (pipeline/motion). They are real captured-style
//    human motion: reading, sitting down, opening the oven, hammering, washing up, sleeping, stretching.
//  * Every clip has its hip travel removed; clips that really move the body (sit down, stand up, pull-up)
//    hand that travel to the character's root frame by frame ("root motion"). So blends between clips never jump.
//  * The root always stands on the real floor: a physics ray finds the top of the boards under the hero.
//    On a chair or a bed the root is placed so the hip joints sit a set height above the real seat / mattress
//    (measured on the furniture), whatever height the clip assumed. Leg IK keeps the soles on the boards.
//  * Code refines the clips to the scene: hands hold the real book and turn its pages, take the hammer off the
//    bench, grip the oven handle while the door opens; the head looks at what the hero is busy with.
import * as THREE from 'three';
import { createWorkshop } from './workshop.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,k)=>a+(b-a)*k;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const YAX=V(0,1,0);
const wrapA=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};
const rotY=(v,a)=>v.clone().applyAxisAngle(YAX,a);
const fwd=a=>V(Math.sin(a),0,Math.cos(a));

// clips whose hip travel becomes root travel. y:[a,b] = hips height glides from a to b instead (pull-up)
const RM={'57':{},'53':{},'435':{y:[.98,.87]},'184':{},'hy_sitdown':{},'hy_standup':{}};
const CLIMB=new Set(['437','438','444']);
// hip joint height above a seat / a mattress (thighs and buttocks rest on it, nothing sinks in)
const SEAT_CLEAR=.125,LIE_CLEAR=.115;

// text-to-motion clips (hero-moves.txt) -> three.js clips
export function movesToClips(moves){const out=[];if(!moves)return out;
 for(const [nm,m] of Object.entries(moves)){const dt=1/m.fps;const times=Float32Array.from({length:m.n},(_,i)=>i*dt);const tr=[];
  for(const b in m.q)tr.push(new THREE.QuaternionKeyframeTrack('mixamorig'+b+'.quaternion',times,Float32Array.from(m.q[b])));
  tr.push(new THREE.VectorKeyframeTrack('mixamorigHips.position',times,Float32Array.from(m.hips)));
  const c=new THREE.AnimationClip(nm,(m.n-1)*dt,tr);c.userData={loop:m.loop};out.push(c);}
 return out;}

export function createHero(ctx){
 const {scene,gltf,world,RAPIER,lv,sfx}=ctx;
 const P3=ctx.props||window.__props||null;
 const root=gltf.scene;scene.add(root);
 root.traverse(o=>{if(o.isMesh||o.isSkinnedMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;if(o.material){o.material.roughness=Math.max(.55,o.material.roughness??.8);o.material.metalness=0;}}});
 const bones={};root.traverse(o=>{if(o.isBone)bones[o.name.replace('mixamorig','').replace(':','')]=o;});
 for(const c of movesToClips(ctx.moves))if(!gltf.animations.some(a=>a.name===c.name))gltf.animations.push(c);
 // ---------- eyelids: the eyes are painted into the texture, so closed eyes are two skin-coloured lids on the Head bone ----------
 // eye centres in the mesh's (quantized) position space, found from the painted irises (pipeline: see NOTES-character.md)
 const LIDS=(()=>{let sk=null;root.traverse(o=>{if(o.isSkinnedMesh&&!sk)sk=o;});if(!sk||!bones.Head)return null;const S=sk.skeleton;const hi=S.bones.indexOf(bones.Head);if(hi<0)return null;
  const eyes=[V(.0497,.8005,.1099),V(-.0553,.8029,.1078)].map(v=>v.applyMatrix4(sk.bindMatrix));const fwdB=V(0,0,1).transformDirection(sk.bindMatrix);
  const d=eyes[0].distanceTo(eyes[1]);const inv=S.boneInverses[hi];const mat=new THREE.MeshStandardMaterial({color:0xE2AC86,roughness:.75,metalness:0});
  const lashM=new THREE.MeshStandardMaterial({color:0x2A160C,roughness:.9});const geo=new THREE.SphereGeometry(1,20,10,0,Math.PI*2,0,Math.PI/2);geo.rotateX(Math.PI/2);// a dome facing +z
  const lash=new THREE.TorusGeometry(1,.06,5,16,Math.PI);lash.rotateZ(Math.PI);
  const out=[];for(const e of eyes){const piv=new THREE.Group();// pivot at the top of the eye: the lid closes downward from it
   const q=new THREE.Quaternion().setFromUnitVectors(V(0,0,1),fwdB);const up=V(0,1,0).applyQuaternion(q);
   const M=new THREE.Matrix4().compose(e.clone().addScaledVector(up,.2*d).addScaledVector(fwdB,-.03*d),q,V(1,1,1));M.premultiply(inv);M.decompose(piv.position,piv.quaternion,piv.scale);
   const lid=new THREE.Mesh(geo,mat);lid.scale.set(.27*d,.2*d,.1*d);lid.position.set(0,-.2*d,0);piv.add(lid);
   const ln=new THREE.Mesh(lash,lashM);ln.scale.set(.26*d,.1*d,.05*d);ln.position.set(0,-.3*d,.1*d*.45);piv.add(ln);
   piv.visible=false;bones.Head.add(piv);out.push(piv);}
  return out;})();
 // the lips in world space (for breath vapour etc.): below the eyes, a touch forward
 try{const hq=new THREE.Quaternion();window.__hero=window.__hero||{};window.__hero.mouth=(t=V())=>{const Hd=bones.Head;if(!Hd)return t.set(0,0,0);Hd.getWorldQuaternion(hq);const up=V(0,1,0).applyQuaternion(hq),fw=V(0,0,1).applyQuaternion(hq);
   if(LIDS&&LIDS.length===2&&LIDS[0].parent){const a=LIDS[0].getWorldPosition(V()),b=LIDS[1].getWorldPosition(V());const d=a.distanceTo(b);return t.copy(a).add(b).multiplyScalar(.5).addScaledVector(up,-.85*d).addScaledVector(fw,.15*d);}
   return Hd.getWorldPosition(t).addScaledVector(up,.07).addScaledVector(fw,.09);};}catch(e){}
 // k: 0 open .. 1 closed (the lid grows down from the brow)
 const EYEM=root.getObjectByName('eyelids');const EYEI=EYEM&&EYEM.morphTargetDictionary?EYEM.morphTargetDictionary.blink:null;
 if(EYEI!=null&&LIDS)for(const p of LIDS)p.parent.remove(p);
 function setLids(k){if(EYEI!=null){EYEM.morphTargetInfluences[EYEI]=k;return;}if(!LIDS)return;for(const p of LIDS){p.visible=k>.02;p.scale.set(1,Math.max(.02,k),1);}}

 // ---------- clips ----------
 const rmCurve={},hipsY={};
 for(const c of gltf.animations){const name=c.name;
  for(const tr of c.tracks){if(!/Hips\.position$/.test(tr.name))continue;const v=tr.values,t=tr.times,n=t.length,dur=c.duration||t[n-1]||1;
   const cfg=RM[name];const orig=Float32Array.from(v);
   for(let i=0;i<n;i++){const j=i*3;v[j]=0;v[j+2]=0;
    if(cfg&&cfg.y)v[j+1]=lerp(cfg.y[0],cfg.y[1],smooth(0,1,t[i]/dur));
    else if(CLIMB.has(name))v[j+1]=orig[1];}
   hipsY[name]={t:Float32Array.from(t),y:Float32Array.from({length:n},(_,i)=>v[i*3+1])};
   if(cfg){const r=new Float32Array(n*3);for(let i=0;i<n;i++)for(let k=0;k<3;k++)r[i*3+k]=(orig[i*3+k]-v[i*3+k])-(orig[k]-v[k]);rmCurve[name]={t:Float32Array.from(t),r};}}}
 const mixer=new THREE.AnimationMixer(root);const actions={};
 for(const c of gltf.animations)actions[c.name]=mixer.clipAction(c);
 // boots on = the boots-off mocap played backwards (bed thread): the Fal 'put boots on' clip half-stood him up with the pelvis
 // tipped back and the head down at the bunk edge; taking a boot off reversed is a clean seated pick-up, pull-on and plant
 const BOOTREV={};for(const sd of ['R','L']){const src=gltf.animations.find(c=>c.name==='hy_bootsoff'+sd);if(!src)continue;const D=src.duration;
  const tr=src.tracks.map(t=>{const n=t.times.length,w=t.getValueSize(),tm=new Float32Array(n),v=new Float32Array(t.values.length);
   for(let i=0;i<n;i++){tm[i]=D-t.times[n-1-i];for(let k=0;k<w;k++)v[i*w+k]=t.values[(n-1-i)*w+k];}return new t.constructor(t.name,tm,v);});
  const c=new THREE.AnimationClip('hy_bootson'+sd,D,tr);if(actions[c.name])actions[c.name].stop();actions[c.name]=mixer.clipAction(c);BOOTREV[sd]=D;}
 const has=n=>!!actions[n];
 const rmAt=(name,time)=>{const C=rmCurve[name];if(!C)return V();const t=C.t,n=t.length;if(time<=t[0])return V(C.r[0],C.r[1],C.r[2]);if(time>=t[n-1]){const j=(n-1)*3;return V(C.r[j],C.r[j+1],C.r[j+2]);}
  let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(t[m]<=time)lo=m;else hi=m;}const k=(time-t[lo])/(t[hi]-t[lo]);const a=lo*3,b=hi*3;return V(lerp(C.r[a],C.r[b],k),lerp(C.r[a+1],C.r[b+1],k),lerp(C.r[a+2],C.r[b+2],k));};
 const hyAt=(name,f)=>{const C=hipsY[name];if(!C)return .85;const i=Math.round(clamp(f,0,1)*(C.y.length-1));return C.y[i];};
 const durOf=n=>actions[n]?actions[n].getClip().duration:1;

 const H={root,mixer,actions,cur:null,face:0,yaw:0,state:'idle',task:null,path:[],v:0,node:'bread_app',hp:3,
  floorY:lv.BD,ground:true,footIK:1,look:null,lookW:0,hold:{},busy:null,fit:null,idleClip:has('hy_idle')?'hy_idle':'0'};
 const IDLE=()=>H.idleClip;

 function play(name,{loop=true,fade=.35,speed=1,at=0}={}){const a=actions[name];if(!a)return null;if(H.cur===a){a.timeScale=speed;a.paused=false;return a;}
  a.reset();a.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);a.clampWhenFinished=!loop;a.timeScale=speed;a.time=at;a.enabled=true;a.setEffectiveWeight(1);
  if(H.cur)H.cur.crossFadeTo(a,fade,false);a.play();H.cur=a;return a;}
 // once-off clip; then() when it ends (or at a fraction of it)
 function once(name,{fade=.3,speed=1,at=0,until=1,then}={}){const a=play(name,{loop:false,fade,speed,at});if(!a){then&&then();return;}H.once={a,end:a.getClip().duration*until,then};}
 // hold one frame of a clip (a pose), e.g. the first frame of standing up = sitting on an edge ready to rise
 function hold(name,f,fade=.5){const a=play(name,{loop:false,fade,at:durOf(name)*f});if(a){a.paused=false;a.timeScale=0;}return a;}

 // ---------- measure the walk: how far one second of the clip carries the body (no foot sliding) ----------
 let walkSpeed=1.0;const WALK_V=1.05;// m/s: natural walking pace for a ~1.5 m tall person
 {const a=actions['30'];if(a){a.reset().play();const d=a.getClip().duration;const T=bones.LeftToeBase,Q=V();let prev=null,acc=0,cnt=0;
   for(let i=0;i<=120;i++){a.time=d*i/120;mixer.update(0);root.updateMatrixWorld(true);T.getWorldPosition(Q);
    if(prev&&Q.y<.07&&prev.y<.07){acc+=Math.abs(Q.z-prev.z)/(d/120);cnt++;}prev=Q.clone();}
   if(cnt>5)walkSpeed=clamp(acc/cnt,.5,1.8);a.stop();}}
 // ---------- which way a clip's body points (lying clips: where the head is) ----------
 function poseOf(name,f){const a=actions[name];const pr=root.position.clone(),py=root.rotation.y;root.position.set(0,0,0);root.rotation.y=0;
  mixer.stopAllAction();a.reset().play();a.time=durOf(name)*f;mixer.update(0);root.updateMatrixWorld(true);
  const out={head:bones.Head.getWorldPosition(V()),hips:bones.Hips.getWorldPosition(V()),lh:bones.LeftHand.getWorldPosition(V()),rh:bones.RightHand.getWorldPosition(V()),la:bones.LeftFoot.getWorldPosition(V()),ra:bones.RightFoot.getWorldPosition(V())};
  a.stop();root.position.copy(pr);root.rotation.y=py;return out;}
 const POSE={};
 if(has('hy_sleep')){const p=poseOf('hy_sleep',.3);POSE.sleepHeadYaw=Math.atan2(p.head.x-p.hips.x,p.head.z-p.hips.z);}
 if(has('hy_drink')){let l=0,r=0;for(const f of [.35,.5,.65]){const p=poseOf('hy_drink',f);l+=p.lh.y;r+=p.rh.y;}POSE.drinkHand=r>=l?'Right':'Left';}
 {const p=poseOf(has('hy_idle')?'hy_idle':'0',.2);POSE.ankle=clamp(Math.min(p.la.y,p.ra.y),.05,.16);}
 mixer.stopAllAction();
 // ---------- bed: seated pose (standing-up clip, frame 0) and a sleep clip turned so the root never has to spin ----------
 let SLEEPB=has('hy_sleep')?'hy_sleep':'267';
 const POSEBONES=[...new Set(Object.values(bones))].filter(b=>b&&b.isBone);
 function sampleQ(name,f){const a=actions[name];if(!a)return null;mixer.stopAllAction();a.reset().play();a.time=durOf(name)*f;mixer.update(0);const q=POSEBONES.map(b=>b.quaternion.clone());const hy=bones.Hips.position.y;a.stop();return {q,hy};}
 // sitting on the edge of a low bunk: the seated pose leaned well forward (forearms towards the knees) so the head stays clear of the upper bunk
 function sampleLean(name,f,ang){const a=actions[name];if(!a)return null;const pr=root.position.clone(),py=root.rotation.y;root.position.set(0,0,0);root.rotation.y=0;
  mixer.stopAllAction();a.reset().play();a.time=durOf(name)*f;mixer.update(0);root.updateMatrixWorld(true);
  for(const nm of ['Spine','Spine1','Spine2']){const b=bones[nm];if(!b)continue;const pw=b.parent.getWorldQuaternion(new THREE.Quaternion());const R=new THREE.Quaternion().setFromAxisAngle(V(1,0,0),ang/3);
   b.quaternion.premultiply(pw.clone().invert().multiply(R).multiply(pw));b.updateMatrixWorld(true);}
  const q=POSEBONES.map(b=>b.quaternion.clone());const hy=bones.Hips.position.y;a.stop();root.position.copy(pr);root.rotation.y=py;return {q,hy};}
 const SEATQ=sampleLean(has('hy_standup')?'hy_standup':'53',0,1.0);mixer.stopAllAction();
 const BED_GROUP=POSEBONES.map(b=>{const n=b.name.replace('mixamorig','').replace(':','');return /UpLeg|Leg|Foot|Toe/.test(n)?'leg':/^(Neck|Head)/.test(n)?'head':/^Left(Shoulder|Arm|ForeArm|Hand)/.test(n)?'la':/^Right(Shoulder|Arm|ForeArm|Hand)/.test(n)?'ra':'core';});
 const BED_MID={i:-1,q:null};
 function makeBedClip(off){const src=gltf.animations.find(c=>c.name==='hy_sleep');if(!src)return null;const c=src.clone();c.name='hy_sleep_bed';
  root.updateMatrixWorld(true);const rq=root.getWorldQuaternion(new THREE.Quaternion()),pq=bones.Hips.parent.getWorldQuaternion(new THREE.Quaternion());const rel=rq.clone().invert().multiply(pq);const relI=rel.clone().invert();
  const R=relI.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),off)).multiply(rel);
  // half-way pose for the pelvis: rolled onto the left side towards the pillow (the legs, still bent, come up with it)
  if(SEATQ){const hi=POSEBONES.indexOf(bones.Hips);BED_MID.i=hi;BED_MID.q=relI.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0,0,1),-(ctx.bedHead??1)*Math.PI*.42)).multiply(rel).multiply(SEATQ.q[hi]);}
  for(const tr of c.tracks){if(!/Hips\.quaternion$/.test(tr.name))continue;const v=tr.values;const q=new THREE.Quaternion();for(let i=0;i<v.length;i+=4){q.fromArray(v,i);q.premultiply(R);q.toArray(v,i);}}
  actions[c.name]=mixer.clipAction(c);return c.name;}

 // ---------- floor under the hero: real board tops ----------
 const ray=new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
 function floorAt(x,y,z,up=.45,down=.9){ray.origin={x,y:y+up,z};const hit=world.castRayAndGetNormal(ray,up+down,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});
  if(!hit||hit.normal.y<.6)return null;return y+up-(hit.toi??hit.timeOfImpact);}

 // ---------- layout: walk graph (keeps clear of furniture) ----------
 const {LC,WS,KT,BD,DK}=lv;
 const N={
  kh_b:{p:V(-1.22,LC,3.77)},kh_side:{p:V(-.5,LC,3.8),tight:true},/* WALK: the kitchen ladder stands between kh_b and the landing: round its side, not through the rungs */land:{p:V(-.4,LC,2.85)},gate:{p:V(0,LC,3.35),face:0},wstep:{p:V(1.15,WS,3.15)},
  wmid:{p:V(2.4,WS,3.45)},bench:{p:V(2.55,WS,2.62),face:Math.PI},wwin:{p:V(3.0,WS,3.95),face:0},
  kh_t:{p:V(-1.22,KT,2.75)},kmid:{p:V(-2.5,KT,3.3)},kl_m:{p:V(-3.4,KT,2.65)},stove:{p:V(-3.25,KT,2.42),face:Math.PI},sink:{p:V(-2.3,KT,2.15),face:Math.PI},kwin:{p:V(-3.0,KT,3.45),face:0},kl_b:{p:V(-3.98,KT,2.62)},
  bl_t:{p:V(-3.98,BD,1.95)},bl_m:{p:V(-3.45,BD,2.6)},bmid:{p:V(-2.3,BD,3.05)},bwin:{p:V(-3.6,BD,3.6),face:0},bdoor:{p:V(-.1,BD,2.78)},
  ledge:{p:V(1.25,BD,3.5),face:0},ll_b:{p:V(1.35,BD,3.47)},ll_t:{p:V(1.35,DK,2.7)},deckm:{p:V(1.9,DK,2.5)},deck:{p:V(3.13,DK,2.62),face:0},
 };
 const E=[['kh_b','kh_side'],['kh_side','land'],['land','gate'],['land','wstep'],['wstep','wmid'],['wmid','bench'],['wmid','wwin'],['kh_b','kh_t','ladder'],['kh_t','kmid'],['kmid','stove'],['kmid','sink'],['kmid','kwin'],['kmid','kl_m'],['kl_m','kl_b'],
  ['kl_b','bl_t','ladder'],['bl_t','bl_m'],['bl_m','bmid'],['bmid','bwin'],['bmid','bdoor'],['bdoor','ledge'],['ledge','ll_b'],['ll_b','ll_t','ladder'],['ll_t','deckm'],['deckm','deck']];
 // the rooms can be shifted sideways as a block (lv.XL: left rooms, lv.XR: right rooms); landings at LC stay
 {const XL=lv.XL||0,XR=lv.XR||0;if(XL||XR)for(const k in N){const n=N[k];if(n.p.y<LC+.3)continue;n.p.x+=n.p.x<0?XL:XR;}}
 const LAD={'kh_b>kh_t':{lz:3.45,side:1},'kl_b>bl_t':{lz:2.3,side:1},'ll_b>ll_t':{lz:3.15,side:1,rope:true}};
 // the ground (ground.js __ground.exits.forest): rope ladder from the gate down to the clearing, the path out to the forest edge,
 // a hidden spot out in the fog, and the work spots by the chopping stump and the firewood pile
 {const X=window.__ground&&window.__ground.exits&&window.__ground.exits.forest;if(X&&X.nodes){const ids=['g_foot','g_path1','g_fork','g_exit0','g_exit1','g_exit15','g_exit2','g_edge','g_out'];/* WALK: the track's bends way[3] and way[5] were not nodes, so he walked the chord g_fork->g_exit1 straight through a root */if(X.path&&X.path.length>6){X.nodes.g_exit0=X.nodes.g_exit0||X.path[3];X.nodes.g_exit15=X.nodes.g_exit15||X.path[5];}
  for(const k of ids)if(X.nodes[k])N[k]={p:X.nodes[k].clone(),tight:true};/* tight: walk the path ground.js laid round the roots and stones, no shortcuts */const chain=ids.filter(k=>N[k]);for(let i=1;i<chain.length;i++)E.push([chain[i-1],chain[i]]);
  if(N.g_foot){E.push(['g_foot','gate','ladder']);LAD['g_foot>gate']={lz:4.0,side:1,rope:true};}
  if(N.g_out)N.g_out.face=X.faceOut;
  const near=p=>chain.reduce((b,k)=>{const d=Math.hypot(N[k].p.x-p.x,N[k].p.z-p.z);return d<b[1]?[k,d]:b;},[null,1e9])[0];
  if(X.chopStand){N.g_chop={p:X.chopStand.clone(),face:Math.atan2(X.chopStump.x-X.chopStand.x,X.chopStump.z-X.chopStand.z)};E.push(['g_chop',near(X.chopStand)]);}
  {const PD=window.__ground.pond;if(PD&&PD.path&&PD.path.length>3&&N.g_fork){let prev='g_fork';for(let i=3;i<PD.path.length;i++){const k=i===PD.path.length-1?'g_pond':'g_p'+i;N[k]={p:PD.path[i].clone(),tight:true};E.push([prev,k]);prev=k;}N.g_pond.face=PD.face;}}
  if(X.woodStand){N.g_wood={p:X.woodStand.clone(),face:Math.atan2(X.woodPile.x-X.woodStand.x,X.woodPile.z-X.woodStand.z)};E.push(['g_wood',near(X.woodStand)]);}}}

 // ---------- fit to the real furniture ----------
 const rc=new THREE.Raycaster();
 const topOf=(o,x,z,y0)=>{rc.set(V(x,y0,z),V(0,-1,0));const h=rc.intersectObject(o,true)[0];return h?h.point.y:null;};
 const floorTop=(y,x=-2.3,z=3.0)=>{const f=floorAt(x,y,z);return f??y+.035;};
 const FIT={};
 const sdEnd=has('hy_sitdown')?rmAt('hy_sitdown',99):V(0,0,-.3);// where sitting down carries the hips (root space)
 const SIT=has('hy_sitdown')?'hy_sitdown':'57',STAND=has('hy_standup')?'hy_standup':'53';
 {// chair: sit facing the table, hips a little forward of the seat middle (the quiver stays off the chair back)
  const ch=ctx.chair,cb=new THREE.Box3().setFromObject(ch),cx=(cb.min.x+cb.max.x)/2,cz=(cb.min.z+cb.max.z)/2;
  const face=ctx.chairFace??Math.PI;const f=fwd(face);
  let seat=P3&&P3.surfaces&&P3.surfaces.chairSeat;if(!seat){for(const k of [.06,0,.1])seat=seat??topOf(ch,cx+f.x*k,cz+f.z*k,BD+.75);}seat=seat??BD+.46;
  const hip=V(cx+f.x*.07,seat,cz+f.z*.07);
  N.chair={p:hip.clone().setY(BD),face,seat,sit:true,floor:floorTop(BD,cx+f.x*.4,cz+f.z*.4)};
  // where to stand so that sitting down lands the hips on the seat
  N.chair_app={p:hip.clone().sub(rotY(V(sdEnd.x,0,sdEnd.z),face)).setY(BD),face,tight:true};
  // out from the chair: along the gap between the table and the bunk bed, then out past the bunk's ladder to the middle of the room
  {const tx=ctx.table?ctx.table.x0:hip.x-.13;const bb0=P3&&P3.surfaces&&P3.surfaces.bed&&P3.surfaces.bed[0];const bxr=bb0?bb0.x1+.1:-99;const cx=(bxr>tx-1.1)?(bxr+tx)/2:Math.min(hip.x-.55,tx-.42);
   N.chair_side={p:V(cx,BD,hip.z-.2)};N.chair_out={p:V(cx,BD,bb0?bb0.z1+.62:hip.z+.5)};E.push(['chair_side','chair_out'],['chair_out','bmid'],['chair_side','chair_app']);}
  FIT.tableTop=ctx.table?ctx.table.top:BD+.76;FIT.chair={cx,cz,seat};}
 {// bunk bed, lower bed: sit on the front edge (head clear of the upper bunk), then lie along the middle
  const bk=ctx.bunk,bb=new THREE.Box3().setFromObject(bk);const S=P3&&P3.surfaces&&P3.surfaces.bed&&P3.surfaces.bed[0];
  const bx=S?(S.x0+S.x1)/2:(bb.min.x+bb.max.x)/2,bz=S?(S.z0+S.z1)/2:(bb.min.z+bb.max.z)/2;
  let mat=S?S.top:null;if(mat==null){for(const dx of [0,.3,-.3])mat=mat??topOf(bk,bx+dx,bz,BD+.95);}mat=mat??BD+.5;
  const x0=S?S.x0:bb.min.x+.1,x1=S?S.x1:bb.max.x-.1,z1=S?S.z1:bb.max.z-.1;
  const headDir=ctx.bedHead??1;// +1: pillows at +x
  FIT.bed={bx,bz,mat,x0,x1,z1,headDir,box:bb};
  // lying: pelvis ~0.85 m from the head end, body centred across the mattress; yaw so the head points at the pillow
  const lieYaw=(headDir>0?Math.PI/2:-Math.PI/2)-(POSE.sleepHeadYaw??0);
  N.bedlie={p:V(headDir>0?x1-.95:x0+.95,mat,bz),face:0,seat:mat};SLEEPB=makeBedClip(lieYaw)||SLEEPB;
  // sitting on the very front edge of the mattress facing the room
  N.bededge={p:V(bx-headDir*.15,mat,z1+.14),face:0,seat:mat,floor:floorTop(BD,bx,z1+.45)};
  N.bed_app={p:V(N.bededge.p.x-sdEnd.x,BD,N.bededge.p.z-sdEnd.z),face:0,tight:true};
  E.push(['bmid','bed_app']);}
 const adj={};for(const [a,b,t] of E){(adj[a]=adj[a]||[]).push({to:b,t});(adj[b]=adj[b]||[]).push({to:a,t});}
 function edgeShut(a,b){const hc=window.__house&&window.__house.hatch;if(!hc||!hc.ladder||!hc.isOpen)return false;const L=hc.ladder;return ((a===L.bottom&&b===L.top)||(a===L.top&&b===L.bottom))&&!hc.isOpen();}
 function route(a,b){const prev={[a]:null},q=[a];while(q.length){const n=q.shift();if(n===b)break;for(const e of adj[n]||[])if(!(e.to in prev)&&!(window.__hatchStrict&&edgeShut(n,e.to))){prev[e.to]={n,t:e.t};q.push(e.to);}}
  if(!(b in prev))return [];const out=[];let c=b;while(c&&c!==a){out.unshift({node:c,t:prev[c].t,from:prev[c].n});c=prev[c].n;}return out;}
 // furniture footprints: the hero never walks into them
 const OBST=ctx.OBST||[];
 function pushOut(p){const r=.2;for(const o of OBST){if(o.seat||Math.abs(o.y-p.y)>.6)continue;if(p.x>o.x0-r&&p.x<o.x1+r&&p.z>o.z0-r&&p.z<o.z1+r){const dl=p.x-(o.x0-r),dr=o.x1+r-p.x,db=p.z-(o.z0-r),df=o.z1+r-p.z;const m=Math.min(dl,dr,db,df);if(m===dl)p.x=o.x0-r;else if(m===dr)p.x=o.x1+r;else if(m===db)p.z=o.z0-r;else p.z=o.z1+r;}}
  // on the ground: stones, stumps and the firewood pile (ground.js) are round obstacles
  if(p.y<lv.LC-1){const G=window.__ground;const st=G&&G._stones;if(st)for(const [x,z,rr] of st){const dx=p.x-x,dz=p.z-z,d=Math.hypot(dx,dz),m=rr+.22;if(d<m&&d>1e-4){p.x=x+dx/d*m;p.z=z+dz/d*m;}}}}
 function navCheck(){const bad=[];for(const [a,b,t] of E){if(t==='ladder')continue;const A=N[a].p,Bp=N[b].p;for(let k=0;k<=20;k++){const q=A.clone().lerp(Bp,k/20);for(const o of OBST){if(o.seat||Math.abs(o.y-q.y)>.6)continue;if(q.x>o.x0-.18&&q.x<o.x1+.18&&q.z>o.z0-.18&&q.z<o.z1+.18){bad.push(a+'-'+b+':'+o.n);break;}}}}return [...new Set(bad)];}

 // ---------- things the hero holds ----------
 // the real props (props.js) when they exist: the book on the table, the hammer on the workbench
 const wood=new THREE.MeshStandardMaterial({color:0x7A5233,roughness:.7});
 const mugM=new THREE.MeshStandardMaterial({color:0xE8DCC4,roughness:.5});
 const sh=m=>{m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return m;};
 const BOOK=P3&&P3.book?P3.book:null;const bookObj=BOOK?BOOK.obj:null;
 const bookHome=bookObj?{pos:bookObj.position.clone(),quat:bookObj.quaternion.clone(),parent:bookObj.parent}:null;
 const mug=sh((()=>{const g=new THREE.Group();const b=new THREE.Mesh(new THREE.CylinderGeometry(.04,.036,.09,14),mugM);b.position.y=.045;g.add(b);const h=new THREE.Mesh(new THREE.TorusGeometry(.025,.007,6,12),mugM);h.position.set(.045,.045,0);g.add(h);
  const tea=new THREE.Mesh(new THREE.CircleGeometry(.035,14),new THREE.MeshStandardMaterial({color:0x6B3A1E,roughness:.2}));tea.rotation.x=-Math.PI/2;tea.position.y=.08;g.add(tea);return g;})());
 const spoon=sh((()=>{const g=new THREE.Group();const h=new THREE.Mesh(new THREE.CylinderGeometry(.007,.009,.32,6),wood);h.position.y=.12;g.add(h);const s=new THREE.Mesh(new THREE.SphereGeometry(.03,10,6,0,Math.PI*2,0,Math.PI/2),wood);s.scale.y=.4;s.rotation.x=Math.PI;s.position.y=-.04;g.add(s);return g;})());
 const plate=sh(new THREE.Mesh(new THREE.CylinderGeometry(.1,.08,.015,18),mugM));
 const plank=sh(new THREE.Mesh(new THREE.BoxGeometry(.6,.03,.14),new THREE.MeshStandardMaterial({color:0xC08A55,roughness:.8})));plank.visible=false;scene.add(plank);
 const hs=b=>1/Math.max(1e-4,bones[b].getWorldScale(V()).x);
 // hand frame: Mixamo hand bones point their +y along the fingers; a handle lies across the palm
 const GRIP_R=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,-Math.PI/2)),GRIP_L=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,Math.PI/2));
 function grab(item,hand,pos,rot){const b=bones[hand+'Hand'];if(!b)return;b.add(item);item.position.set(...pos).multiplyScalar(hs(hand+'Hand'));item.rotation.set(...rot);item.scale.setScalar(hs(hand+'Hand'));item.visible=true;H.hold[hand]=item;}
 function release(hand){const it=H.hold[hand];if(!it)return;H.hold[hand]=null;it.parent&&it.parent.remove(it);}
 function grabTool(name,hand){if(!P3||!P3.grab)return false;const o=P3.grab(name,bones[hand+'Hand'],{offset:V(0,.075,.025),rot:hand==='Right'?GRIP_R:GRIP_L});if(o){H.hold[hand]={tool:name};return true;}return false;}
 function releaseTool(hand){const h=H.hold[hand];if(h&&h.tool&&P3)P3.release(h.tool);H.hold[hand]=null;}
 // where loose things rest
 const kTop=(()=>{const f=floorTop(KT,-2.3,2.2);return f+.9;})();
 const rest={mug:V(-1.86,kTop,1.55)};
 const hammerHome=()=>P3&&P3.tools&&P3.tools.benchHammer?P3.tools.benchHammer.getWorldPosition(V()):V(2.2,WS+.95,1.98);
 function park(item,p,ry=0){scene.attach(item);item.position.copy(p);item.rotation.set(0,ry,0);item.scale.setScalar(1);item.visible=true;}
 park(mug,rest.mug);spoon.visible=false;scene.add(spoon);plate.visible=false;scene.add(plate);

 // ---------- IK ----------
 const _q=new THREE.Quaternion(),_pq=new THREE.Quaternion();
 function turnBone(bone,childPos,goal,w){const bp=bone.getWorldPosition(V());const v1=childPos.clone().sub(bp).normalize(),v2=goal.clone().sub(bp).normalize();if(v1.lengthSq()<1e-6||v2.lengthSq()<1e-6)return;
  const dq=new THREE.Quaternion().setFromUnitVectors(v1,v2);if(w<1)dq.slerp(new THREE.Quaternion(),1-w);bone.getWorldQuaternion(_q);bone.parent.getWorldQuaternion(_pq);bone.quaternion.copy(_pq.invert().multiply(dq.multiply(_q)));bone.updateMatrixWorld(true);}
 // two-bone IK (hip-knee-ankle or shoulder-elbow-wrist); pole = which way the middle joint points
 function ik2(A,Bb,C,target,pole,w,keepEnd){if(!A||!Bb||!C||w<=.001)return;const endQ=keepEnd?C.getWorldQuaternion(new THREE.Quaternion()):null;
  const a=A.getWorldPosition(V()),b=Bb.getWorldPosition(V()),c=C.getWorldPosition(V());const l1=a.distanceTo(b),l2=b.distanceTo(c);const tv=target.clone().sub(a);const dd=clamp(tv.length(),Math.abs(l1-l2)+.01,l1+l2-.005);const dir=tv.normalize();
  const ca=clamp((l1*l1+dd*dd-l2*l2)/(2*l1*dd),-1,1),sa=Math.sqrt(1-ca*ca);let pp=pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));if(pp.lengthSq()<1e-6)pp=V(0,0,1);pp.normalize();
  const elbow=a.clone().addScaledVector(dir,ca*l1).addScaledVector(pp,sa*l1);turnBone(A,b,elbow,w);const b2=Bb.getWorldPosition(V()),c2=C.getWorldPosition(V());turnBone(Bb,c2,a.clone().addScaledVector(dir,dd),w);
  if(endQ){C.parent.getWorldQuaternion(_pq);const want=_pq.clone().invert().multiply(endQ);C.quaternion.slerp(want,w);C.updateMatrixWorld(true);}}
 function legIK(dy0,w){for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const dy=typeof dy0==='number'?dy0:dy0[s];if(Math.abs(dy)<.004)continue;const a=F.getWorldPosition(V());const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
   /* WALK: a straight leg has no knee direction (knee - hip/ankle midpoint ~ 0): the pole then pointed anywhere and a 1 cm floor step
      swung the trailing foot 9-22 cm (gate: RightFoot jump in the bedroom); fall back to the body's forward, blended in as the leg straightens */
   const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));const pl=pole.length(),fb=fwd(root.rotation.y);pole.multiplyScalar(1/Math.max(pl,1e-6)).lerp(fb,1-smooth(.01,.04,pl));
   /* POSE: the target is the clip's ankle moved by dy, so a foot the clip or motion lifts while the hips squat was lifted by the whole squat as well:
      gate seed 1 stoke f39182 put the right ankle 3 cm from the hip joint (knee 177 deg, foot inside the thigh). Never ask for less reach than the
      deepest real squat (knee interior 25 deg): a target closer to the hip keeps its height and slides out along the ground, away from the hip */
   const tg=a.clone().add(V(0,dy,0)),t1=k.distanceTo(hp),s1=a.distanceTo(k),mn=Math.sqrt(t1*t1+s1*s1-2*t1*s1*Math.cos(25*Math.PI/180)),rel=tg.clone().sub(hp);
   if(rel.length()<mn){const vy=rel.y,hz=V(rel.x,0,rel.z);let hl=hz.length();if(hl<1e-3){hz.copy(fb);hl=1;}const need=Math.sqrt(Math.max(0,mn*mn-vy*vy));tg.set(hp.x+hz.x/hl*need,tg.y,hp.z+hz.z/hl*need);}
   ik2(U,L,F,tg,pole,w,true);}}
 // seated / perched: put each ankle at its standing height above the boards, then lift the toes out of the floor
 // targets and knee direction are low-passed so clip noise and IK flips never reach the feet
 const plantS={};
 // where the pelvis faces (flat): knees point that way, whatever the root yaw or a twisted clip says
 function hipsFwd(){const q=bones.Hips.getWorldQuaternion(new THREE.Quaternion());const f=V(0,0,1).applyQuaternion(q);f.y=0;const r=fwd(root.rotation.y);if(f.lengthSq()<1e-4)return r;f.normalize();if(f.dot(r)<-.2)f.negate();return f;}
 function legPlant(g,dt,pw=1){const M=window.__plantMode??2;if(M===0||pw<.01)return;for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V()),k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
   const tgt=V(a.x,g+(POSE.ankle??.1),a.z);if(H.fit&&H.fit.liftOK&&a.y>tgt.y)tgt.y=a.y;/* BED: a foot lifted by the clip (boot off) may leave the floor; it never goes through it */let pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));if(pole.lengthSq()<1e-6)pole=fwd(root.rotation.y);pole.normalize().multiplyScalar(.35).add(hipsFwd());pole.normalize();
   if(M===1){ik2(U,L,F,tgt,pole,1,true);continue;}
   let S=plantS[s];if(!S||(pw>=.999&&S.t.distanceTo(tgt)>.3)||!S.on){S=plantS[s]={t:tgt.clone(),p:pole.clone(),on:true};}
   const kk=1-Math.exp(-(dt||1/60)*3);S.t.lerp(tgt,kk);S.p.lerp(pole,kk).normalize();ik2(U,L,F,S.t,S.p,pw,true);}toeGuard(g,dt,pw);}
 // a knee may never bend forward (a clip glitch or an IK pole flip): re-solve that leg with the knee pointing where the pelvis faces
 function kneeGuard(){const hf=hipsFwd();for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;
   const hp=U.getWorldPosition(V()),k=L.getWorldPosition(V()),a=F.getWorldPosition(V());const mid=hp.clone().add(a).multiplyScalar(.5);const off=k.clone().sub(mid);
   const leg=a.clone().sub(hp);if(leg.lengthSq()<1e-4)continue;const ld=leg.clone().normalize();const pf=hf.clone().sub(ld.clone().multiplyScalar(hf.dot(ld)));if(pf.lengthSq()<1e-4)continue;pf.normalize();
   const o=off.clone().sub(ld.clone().multiplyScalar(off.dot(ld)));if(o.length()<.02||o.dot(pf)>-.3*o.length())continue;
   ik2(U,L,F,a,pf.clone().add(o.normalize().multiplyScalar(.15)),1,true);}}
 function legPlantOff(){for(const k in plantS)plantS[k].on=false;}
 // POSE: standing still, the soles stay where they were put down: idle clips sway the legs about a fixed pelvis, which slid the
 // feet 9-15 cm sideways over the boards (workshop). Each ankle is held in the world (two-bone IK) and the hips carry the sway; a
 // foot the clip lifts (a step or a weight shift) is let go and locked again where it lands. Off while the root travels or turns.
 const SOLE={Left:{on:false,w:0,t:V()},Right:{on:false,w:0,t:V()},rp:V(),ry:0,still:0};
 // WALK: each sole on what is under it (the ground or a root top), relative to the body's support g: a foot over a root is
 // lifted onto it (it used to wade through the bark), a foot beside the root when the body stands on it reaches down
 /* WALK: on the boards each sole has its own floor (a step up onto the workshop, the top of the kitchen ladder). Both feet used to
    follow the root's floor: when the root's ray crossed the step edge, both feet jumped 20 cm in one frame (the swing foot was
    pushed 17 cm forward, a planted one popped out of the step). Each foot's floor is eased (a sole crossing an edge rises over
    ~0.1 s) and a swing foot looks 12 cm ahead, so it clears the riser instead of being shoved out of it. */
 const TF={Left:null,Right:null};
 function boardDy(g,dt){const p=root.position,fw=fwd(root.rotation.y),o={};for(const s of ['Left','Right']){const F=bones[s+'Foot'];if(!F){o[s]=g-p.y;continue;}const a=F.getWorldPosition(V());
   const swing=a.y-(g+(POSE.ankle??.1))>.02;/* a sole is ~25 cm long: one ray into a gap between planks is not a step down */const G=window.__ground,onG=p.y<=2&&G&&G.standAt;/* WALK: on the ground the floor under a sole is the roots' top (it was an instant per-foot lift: a sole crossing a root edge jumped 14 cm) */const fl=onG?(x,z)=>G.standAt(x,z):(x,z)=>{let m=null;for(const [ox,oz] of [[0,0],[.06,0],[-.06,0],[0,.06],[0,-.06]]){const h=floorAt(x+ox,g,z+oz,.28,.25);if(h!=null&&(m==null||h>m))m=h;}return m;};let fb=fl(a.x,a.z);if(swing&&H.path.length){const f2=fl(a.x+fw.x*.22,a.z+fw.z*.22);if(f2!=null&&(fb==null||f2>fb))fb=f2;}
   const tgt=(fb!=null&&Math.abs(fb-g)<(onG?.5:.28))?fb:g;if(TF[s]==null||Math.abs(TF[s]-tgt)>.35)TF[s]=tgt;else TF[s]+=clamp(tgt-TF[s],-1.2*dt,1.4*dt);o[s]=TF[s]-p.y;}return o;}
 function terrainFeet(g){const G=window.__ground;if(!G||!G.standAt||root.position.y>2)return;
  for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());const d=G.standAt(a.x,a.z)-g;if(Math.abs(d)<.01)continue;
   const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));const pl=pole.length();pole.multiplyScalar(1/Math.max(pl,1e-6)).lerp(fwd(root.rotation.y),1-smooth(.01,.04,pl));
   ik2(U,L,F,a.clone().add(V(0,clamp(d,-.25,.45),0)),pole,1,true);}}
 window.__SOLE=SOLE;function soleLock(g,dt){const moved=root.position.distanceTo(SOLE.rp)/Math.max(dt,1e-3),turned=Math.abs(wrapA(root.rotation.y-SOLE.ry))/Math.max(dt,1e-3);SOLE.rp.copy(root.position);SOLE.ry=root.rotation.y;
  const still=moved<.05&&turned<.35&&!H.path.length&&!H.slide&&!H.swing;SOLE.still=still?Math.min(1,SOLE.still+dt*4):0;
  for(const s of ['Left','Right']){const S=SOLE[s],U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());
   const up=a.y-(g+(POSE.ankle??.1))>.04;// the clip lifts this foot
   if(!still||up){S.on=false;S.w=Math.max(0,S.w-dt*6);}else if(!S.on){S.on=true;S.t.set(a.x,a.y,a.z);}
   if(S.on)S.w=Math.min(SOLE.still,S.w+dt*5);const w=S.w;if(w<.01)continue;
   const tgt=V(S.on?S.t.x:a.x,a.y,S.on?S.t.z:a.z);if(tgt.distanceTo(a)<.002)continue;if(tgt.distanceTo(a)>.25){S.on=false;continue;}
   const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));if(pole.lengthSq()<1e-6)pole.copy(hipsFwd());ik2(U,L,F,tgt,pole,w,true);}}
 const toeS={Left:0,Right:0};
 function toeGuard(g,dt,tw=1){const k=1-Math.exp(-(dt||1/60)*10);for(const s of ['Left','Right']){const F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)continue;const t=T.getWorldPosition(V());const need=Math.max(0,g+.035-t.y);
   toeS[s]+=(need-toeS[s])*k;if(toeS[s]*tw<=.002)continue;turnBone(F,t,t.clone().add(V(0,toeS[s]*tw,0)),1);}}
 const armLen=(()=>{const A=bones.RightArm,F=bones.RightForeArm,Hh=bones.RightHand;if(!A||!F||!Hh)return .58;root.updateMatrixWorld(true);return A.getWorldPosition(V()).distanceTo(F.getWorldPosition(V()))+F.getWorldPosition(V()).distanceTo(Hh.getWorldPosition(V()));})();
 // the upper bunk: whenever the head would be under it and too high, bend the spine forward/down to clear it
 const duckS={v:0};
 function duck(dt){if(window.__noDuck)return;const up=P3&&P3.surfaces&&P3.surfaces.bed&&P3.surfaces.bed[1];if(!up||!bones.Head||!bones.Spine1){return;}
  const under=up.top-.272,front=up.z1+.07;const hd=bones.Head.getWorldPosition(V());
  if(hd.x<up.x0-.12||hd.x>up.x1+.12||hd.y<under-.6){duckS.v+=(0-duckS.v)*(1-Math.exp(-dt*8));if(duckS.v<.002)return;}
  else{const zone=1-smooth(front-.02,front+.07,hd.z);const need=Math.min(.3,Math.max(0,hd.y+.15-under)*zone);const dv=(need-duckS.v)*(1-Math.exp(-dt*6));duckS.v+=clamp(dv,-.5*dt,.7*dt);}
  if(duckS.v<.002)return;
  for(const [nm,f] of [['Spine',.4],['Spine1',.35],['Spine2',.25]]){const b=bones[nm];if(!b)continue;const h=bones.Head.getWorldPosition(V());
   const fw=fwd(root.rotation.y);const goal=h.clone().add(V(fw.x*duckS.v*.7,-duckS.v,fw.z*duckS.v*.7));turnBone(b,h,goal,f/(1-(nm==='Spine'?0:nm==='Spine1'?.4:.75)));}}
 function armIK(side,target,pole,w){ik2(bones[side+'Arm'],bones[side+'ForeArm'],bones[side+'Hand'],target,pole,w,false);}
 // head and neck turn toward a point (smoothed, limited like a real neck)
 const lookS={yaw:0,pitch:0};
 // head look with human limits: the head never turns more than ~70 deg from the pelvis (neck + chest together),
 // whatever the clip or the look target asks; the turn is shared chest 25% / neck 35% / head 40%, so no owl turns
 const HEADMAX=1.22,LOOKMAX=1.05;
 function pelvisFwdGeo(){const l=bones.LeftUpLeg,r=bones.RightUpLeg;if(!l||!r)return hipsFwd();const d=l.getWorldPosition(V()).sub(r.getWorldPosition(V()));const f=V(-d.z,0,d.x);/* (L-R) x up */const n=f.length();if(n<1e-4)return hipsFwd();f.multiplyScalar(1/n);if(f.dot(fwd(root.rotation.y))<-.2)f.negate();return f;}
 // WALK: a neck turns ~60-70 deg at most. The look limit is against the pelvis, so a clip that already twists the chest plus the
 // look could still wring the neck 75-80 deg (gate owl-head while walking). Saturate the neck+head twist about the neck axis.
 function neckClamp(){const Nk=bones.Neck,Hd=bones.Head;if(!Nk||!Hd)return;const q=Nk.quaternion.clone().multiply(Hd.quaternion);let tw=2*Math.atan2(q.y,q.w);tw=wrapA(tw);
  const MAX=.85;if(Math.abs(tw)<=MAX)return;Hd.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(YAX,-(tw-Math.sign(tw)*MAX)));Hd.updateMatrixWorld(true);}
 function lookAt(dt){const Hd=bones.Head,Nk=bones.Neck,Ch=bones.Spine2;if(!Hd||!Nk)return;if(window.__noLookClamp&&!H.look)return;
  /* WALK: the head is limited against where the pelvis really faces (hip joints), not the Hips bone axis: on walking frames that axis
     is ~30 deg off, so the 70 deg limit let the head reach 100 deg from the pelvis (gate owl-head while walking) */
  const hf=pelvisFwdGeo();const hy=Math.atan2(hf.x,hf.z);
  const hq=Hd.getWorldQuaternion(new THREE.Quaternion());const fw=V(0,0,1).applyQuaternion(hq);const hl=rotY(fw,-hy);const ah=Math.atan2(hl.x,hl.z),ap=Math.atan2(-hl.y,Math.hypot(hl.x,hl.z));
  let ty=0,tp=0;const w=H.look?H.lookW:0;
  if(H.look&&w>.01){const hp=Hd.getWorldPosition(V());const d=H.look.clone().sub(hp);const local=rotY(d,-hy);
   const want=clamp(Math.atan2(local.x,local.z),-LOOKMAX,LOOKMAX),wp=clamp(Math.atan2(-d.y,Math.hypot(d.x,d.z)),-.6,.7);ty=(want-ah)*w;tp=(wp-ap)*w;}
  // whatever the result, the final head yaw stays inside the human range
  const fin=ah+ty;if(fin>HEADMAX)ty-=fin-HEADMAX;else if(fin<-HEADMAX)ty+=-HEADMAX-fin;
  const k=1-Math.exp(-dt*4);lookS.yaw=lerp(lookS.yaw,clamp(ty,-1.6,1.6),k);lookS.pitch=lerp(lookS.pitch,clamp(tp,-.7,.7),k);
  if(Math.abs(lookS.yaw)+Math.abs(lookS.pitch)<1e-3)return;
  const right=V(1,0,0).applyAxisAngle(YAX,hy);
  for(const [b,share] of [[Ch,.25],[Nk,.35],[Hd,.4]]){if(!b)continue;const pw=b.parent.getWorldQuaternion(new THREE.Quaternion());
   const q=new THREE.Quaternion().setFromAxisAngle(YAX,lookS.yaw*share).multiply(new THREE.Quaternion().setFromAxisAngle(right,lookS.pitch*(b===Ch?0:share/.75)));
   b.quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw));b.updateMatrixWorld(true);}}

 // ---------- walking: smooth curves, speed matched to the stride, turning steps ----------
 // is the straight line between two points on one floor free of furniture? (used to cut corners of the node graph)
 function segClear(a,b){const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.08);const r=.24;for(let i=1;i<=n;i++){const t=i/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
   for(const o of OBST){if(Math.abs(o.y-a.y)>.6)continue;if(x>o.x0-r&&x<o.x1+r&&z>o.z0-r&&z<o.z1+r)return false;}}return true;}
 // stuck: walking but not getting anywhere (QA: sunk into the workshop floor, walked on the spot for an hour) -> back onto the boards and replan
 function stuckCheck(dt){const p=root.position;const S=H.stk||(H.stk={t:0,x:p.x,z:p.z,n:0});S.t+=dt;if(S.t<2.5)return;const d=Math.hypot(p.x-S.x,p.z-S.z);S.t=0;S.x=p.x;S.z=p.z;
  if(d>.15||!H.path.length){S.n=0;return;}S.n++;const last=H.path[H.path.length-1].node;
  const f=floorAt(p.x,p.y+.6,p.z,.1,1.2);if(f!=null&&f>p.y+.04&&f-p.y<.6){p.y=f;H.floorY=f;}// sunk under the boards: back on top
  const nn=nearNode(p.clone().add(V(0,.3,0)));if(nn){H.node=nn;H.path=route(nn,last);}
  if(S.n>=2&&H.path.length){const t=N[H.path[0].node].p;if(H.path[0].t!=='ladder'&&Math.abs(t.y-p.y)<.5){p.x+=(t.x-p.x)*.5;p.z+=(t.z-p.z)*.5;}}}
 function walkStep(dt){
  // string-pull: if the node after this one is in plain sight, head straight for it
  while(H.path.length>1&&H.path[0].t!=='ladder'&&H.path[1].t!=='ladder'&&!N[H.path[0].node].tight&&!(H.path[2]&&H.path[2].t==='ladder'&&false)){const nx=N[H.path[1].node].p,p0=root.position;
   if(Math.abs(nx.y-p0.y)>.25||Math.abs(N[H.path[0].node].p.y-p0.y)>.25||!segClear(p0,nx))break;H.node=H.path[0].node;H.path.shift();}
  // MOTION HOOK: no hairpin at the start of a walk: a node right next to him that would send him one way and then straight back is skipped
  // when the corner after it can be cut (a bit of the way along), so he sets off toward where he is really going
  if(motion&&H.path.length>1&&H.path[0].t!=='ladder'&&H.path[1].t!=='ladder'&&!N[H.path[0].node].tight){const p0=root.position,a=N[H.path[0].node].p,b=N[H.path[1].node].p;const d0=Math.hypot(a.x-p0.x,a.z-p0.z);
   if(d0<.7&&d0>.02&&Math.abs(a.y-p0.y)<.25&&Math.abs(b.y-p0.y)<.25){const ux=(a.x-p0.x)/d0,uz=(a.z-p0.z)/d0,l=Math.hypot(b.x-a.x,b.z-a.z)||1;const cosT=(ux*(b.x-a.x)+uz*(b.z-a.z))/l;
    if(cosT<-.2){const m=p0.clone().lerp(a,.5);if(segClear(p0,m)&&segClear(m,b)){H.node=H.path[0].node;H.path.shift();}}}}
  const step=H.path[0];const target=N[step.node].p;const p=root.position;const nxt=H.path[1];const isLast=!nxt;
  // aim a little past the corner so the path rounds it
  let aim=target.clone();const toT=Math.hypot(target.x-p.x,target.z-p.z);if(!isLast&&toT<.55){const n2=N[nxt.node].p;aim.lerp(n2,clamp((.55-toT)/.55,0,1)*.5);}
  const dx=aim.x-p.x,dz=aim.z-p.z;const want=Math.atan2(dx,dz);const da=wrapA(want-root.rotation.y);
  // ===== MOTION HOOK: with motion matching the stop is a human one (constant deceleration over the last step), no creeping =====
  const ladNext=motion&&nxt&&nxt.t==='ladder';// MOTION HOOK: slow down over the last steps to the ladder foot (to ~.4 m/s, the approach pace), not at it
  const vmax=H.walkV*(isLast?(motion?clamp(Math.sqrt(2*1.6*Math.max(0,toT-.03))/H.walkV,0,1):clamp(toT/.42,.35,1)):ladNext?clamp(Math.sqrt(.16+2*1.6*Math.max(0,toT-.32))/H.walkV,0,1):1);let align=smooth(-.55,.75,Math.cos(da));/* WALK: just off a ladder the rungs are right in front of him: turn on the spot first (the first step used to go into the ladder) */if(H.ladOff){if(Math.hypot(p.x-H.ladOff.x,p.z-H.ladOff.z)<.3){if(Math.cos(da)<.75)align=0;}else H.ladOff=null;}// a person steps out while still turning, not after
  H.v+=clamp(vmax*align-H.v,-3.2*dt,(H.v<.5?3.2:2.4)*dt);
  stuckCheck(dt);
  // turn rate depends on speed: on the spot it takes small steps
  const rate=lerp(4.2,3.8,clamp(H.v/H.walkV,0,1))*(gait.turn||1);
  // turning has inertia: angular speed ramps up and down, so there is never a snap in heading
  const wav=clamp(da*3,-rate,rate);H.av=(H.av||0)+clamp(wav-(H.av||0),-11*dt,11*dt);root.rotation.y+=H.av*dt;H.face=root.rotation.y;
  const dir=fwd(root.rotation.y);p.x+=dir.x*H.v*dt;p.z+=dir.z*H.v*dt;if(!(N[step.node].tight&&toT<.9)){const q=p.clone();pushOut(q);const m=.6*dt;p.x+=clamp(q.x-p.x,-m,m);p.z+=clamp(q.z-p.z,-m,m);}
  const moving=H.v>.06||Math.abs(da)>.25;
  // MOTION HOOK: with motion matching a one-off action clip (stretching, a gesture) keeps playing on the upper body while he walks off
  /* WALK: a work clip (bent over the oven, stirring) that was still running kept the upper body hunched for up to 2 s of walking: it may only finish a short gesture (0.4 s) */
  if(motion&&H.once&&moving){H.onceWalk=(H.onceWalk||0)+dt;if(H.onceWalk>.4){H.once=null;H.onceWalk=0;}}else H.onceWalk=0;
  if(motion&&H.once){}else if(moving){play('30',{fade:.4});actions['30'].timeScale=clamp(Math.max(H.v,Math.abs(da)>.25?.45:0)/walkSpeed,.5,1.75);}else play(H.idleClip||'0',{fade:.5});
  H.state='walk';const rem=Math.hypot(target.x-p.x,target.z-p.z);
  if(rem<(isLast?.09:.32)){H.node=step.node;H.path.shift();if(isLast&&H.v<.5){H.v=0;}}}
 // ladders: walk to the foot, climb, pull up over the edge (root motion), or the same backwards
 // turn on the spot with inertia (angular speed ramps up and down, no snap)
 function turnTo(F,dt){const da=wrapA(F-root.rotation.y);const wav=clamp(da*3.5,-2.6,2.6);H.av=(H.av||0)+clamp(wav-(H.av||0),-7*dt,7*dt);if(Math.abs(da)<.004&&Math.abs(H.av)<.05)H.av=0;root.rotation.y+=H.av*dt;}
 // walk up to the ladder at a normal pace (no creeping), turning to face it on the way; true when in place
 function ladApproach(goal,F,dt){const p=root.position;const dx=goal.x-p.x,dz=goal.z-p.z,d=Math.hypot(dx,dz);turnTo(d>.35&&climb&&!window.__noClimb?Math.atan2(dx,dz):F,dt);/* CLIMB HOOK: walk facing the way, turn at the spot */const da=Math.abs(wrapA(F-root.rotation.y));
  if(d>.02){const vt=Math.min(Math.max(H.v||0,.35),H.walkV||1)*clamp(d/.25,.4,1);const v=Math.min(vt,(H.v||0)+2.6*dt);H.v=v;const m=Math.min(d,v*dt);p.x+=dx/d*m;p.z+=dz/d*m;play('30',{fade:.25});actions['30'].timeScale=clamp(v/walkSpeed,.6,1.6);}
  else{H.v=0;if(da>.15){play('30',{fade:.25});actions['30'].timeScale=.7;}}
  if(d<.04&&da<.15){p.x=goal.x;p.z=goal.z;return true;}return false;}
 function ladderStep(dt){const step=H.path[0];const key=step.from+'>'+step.node,rkey=step.node+'>'+step.from;const c=LAD[key]||LAD[rkey];const target=N[step.node].p;const p=root.position;
  if(!H.lad&&edgeShut(step.from,step.node)){try{window.__house.hatch.open();window.__audio&&window.__audio.play('hatch_open');}catch(e){}}// a closed hatch on the way: he pushes it open as he gets there
  // CLIMB HOOK: both hands free on a ladder: a tool still in a hand goes over the back for the climb and back into the hand after
  if(!H.lad&&climb&&!window.__noClimb){H.stowed=[];for(const h of ['Left','Right']){const t=H.hold[h]&&H.hold[h].tool;if(t){try{onBack(t,V(h==='Left'?-.06:.06,.1,-.16),[0,0,h==='Left'?.5:-.5]);}catch(e){}H.hold[h]=null;H.stowed.push([h,t]);}}
   /* anything else in a hand (the bow back from the hunt, a bucket...): onto the back too, and back into that hand in the same grip after */
   try{const T=PP().tools||{};for(const n in T){const o=T[n];for(const h of ['Left','Right'])if(o&&o.parent===bones[h+'Hand']){H.stowed.push([h,n,o.position.clone(),o.quaternion.clone(),o.scale.x]);if(/Bucket|meat|log|plate/i.test(n)){onBack(n,V(h==='Left'?-.04:.04,-.06,-.3),[0,0,0]);if(SLUNG_AT[n]){scene.attach(o);slung[n]=1;try{slungPost();}catch(e){}}/* OUTDOOR: hung on its rope by slungPost (hip bandolier) at once: not one frame up at the shoulder blades, through his head (QA 14.5 cm) */}/* bulky: hung clear behind the back (phone watch: hips inside the bucket) */else onBack(n,V(h==='Left'?-.05:.05,.08,-.15),[0,0,h==='Left'?.55:-.55]);}}}catch(e){}}
  if(!H.lad){const a=N[step.from].p;const up=target.y>a.y+.01;H.lad={up,phase:up?'mount':'over',x:target.x,yBot:Math.min(a.y,target.y),yTop:Math.max(a.y,target.y)};}
  const L=H.lad;const cz=c.lz+(.32+(c.rope?.05:0))*c.side;const F=c.side>0?Math.PI:0;H.state='walk';H.ground=false;
  const done=()=>{if(H.stowed&&H.stowed.length){for(const [h,t,pp,pq,ps] of H.stowed){try{if(slung[t]&&SLUNG_AT[t])continue;/* OUTDOOR: a slung load comes back into the hand only once the hand is down off the rungs (slingTick); at the top the raised fist put the bucket at his head (QA) */if(pp){const o=PP().tools[t];const b=bones[h+'Hand'];if(o&&b){b.add(o);o.position.copy(pp);o.quaternion.copy(pq);o.scale.setScalar(ps);}}else grabTool(t,h);}catch(e){}}H.stowed=null;}/* CLIMB HOOK: tools back into the hands */H.lad=null;H.path.shift();H.node=step.node;H.ground=true;H.ladOff=root.position.clone();H.v=L.up?.45:0;H.av=0;H.stk=null;const f=floorAt(root.position.x,root.position.y,root.position.z,.2);H.floorY=(f!=null&&Math.abs(f-target.y)<.25)?f:target.y;H.fit=null;};
  // watchdog (QA P0: froze on the rope ladder for minutes): a ladder never takes longer than a slow climb; past that, land on the target
  L.age=(L.age||0)+dt;if(L.age>14+(L.yTop-L.yBot)/.3){p.copy(target);const f0=floorAt(p.x,p.y+.3,p.z,.4);if(f0!=null)p.y=f0;play(IDLE()||'0',{fade:.3});done();return;}
  if(L.phase==='mount'){H.ground=true;if(ladApproach(V(L.x,p.y,cz),F,dt)){L.phase='climb';}}
  // ===== CLIMB HOOK (game/climb.js, ladder thread): hands and feet on the real rungs; window.__noClimb=true = the old clip =====
  else if(L.phase==='climb'&&climb&&!window.__noClimb&&(L.cl||(L.cl=climb.begin({up:L.up,x:L.x,lz:c.lz,side:c.side,cz,yBot:L.yBot,yTop:L.yTop}))?1:(L.cl=-1,0))&&L.cl!==-1){
   turnTo(F,dt);const r=climb.tick(dt);
   if(r==='off'){done();H.v=.12;}
   else if(r==='bottom'){play(IDLE()||'0',{fade:.35});done();}
   else if(r==='lost'){const py=p.y;if(Math.abs(py-(L.up?L.yTop:L.yBot))<.25||Math.abs(py-(L.up?L.yBot:L.yTop))<.25&&(L.lost=(L.lost||0)+1)>2){play(IDLE()||'0',{fade:.35});done();}else L.cl=null;}}
  else if(L.phase==='over'&&climb&&!window.__noClimb&&!L.start&&L.cl!==-1){// down: walk to the edge, back to the hole, climb down over it
   const P=L.P||(L.P=climb.topStand({x:L.x,lz:c.lz,cz,yTop:L.yTop}));if(!P){L.cl=-1;}
   else{H.ground=true;const dP=Math.hypot(P.x-p.x,P.z-p.z);if(ladApproach(V(P.x,p.y,P.z),F,dt)||(dP<.12&&Math.abs(wrapA(F-root.rotation.y))<1.3)){if(climb.begin({up:false,fromTop:true,x:L.x,lz:c.lz,side:c.side,cz,yBot:L.yBot,yTop:L.yTop})){L.phase='climb';L.cl=true;}else L.cl=-1;}}}
  // ===== /CLIMB HOOK =====
  else if(L.phase==='climb'){turnTo(F,dt);p.x=L.x;p.z=cz;play('437',{speed:1.3,fade:.3});const v=.31*1.3*dt;const pull=rmCurve['435']?rmAt('435',99).y:1.4;
   if(L.up){p.y+=v;if(p.y>=L.yTop-pull){p.y=L.yTop-pull;L.phase='finish';once('435',{fade:.3,until:.86,then:()=>{L.phase='stand';}});/* the last ~0.45 s of the pull-up is standing still: step off instead */}}
   else{p.y-=v;if(p.y<=L.yBot){p.y=L.yBot;play('0',{fade:.35});done();}}}
  else if(L.phase==='stand'){H.ground=true;play('0',{fade:.4});done();}
  else if(L.phase==='over'){// down: step back over the edge (the pull-up played backwards)
   const a=actions['435'];const d=a.getClip().duration;const end=rmCurve['435']?rmAt('435',99):V(0,1.4,1.06);
   if(!L.start){const goal=V(L.x,L.yTop,cz).add(rotY(V(end.x,0,end.z),F));H.ground=true;
    if(ladApproach(V(goal.x,p.y,goal.z),F,dt)){L.start=1;if(Math.abs(p.y-L.yTop)<.3)L.yTop=p.y;p.set(goal.x,L.yTop,goal.z);a.reset();a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.timeScale=-1;a.time=d;a.enabled=true;if(H.cur)H.cur.crossFadeTo(a,.3,false);a.play();H.cur=a;}}
   else{root.rotation.y=F;H.face=F;H.av=0;H.slide=null;/* yaw locked while stepping back over the edge (collide: swung 82 deg through the roof) */L.ot=(L.ot||0)+dt;if(H.cur!==a&&a.time>1e-3){a.time=Math.max(0,a.time-dt);}if(a.time<=1e-3||L.ot>d+.6){L.phase='climb';L.start=0;L.ot=0;}}}}

 // ---------- daily life ----------
 // needs drift over the day; each activity answers one, so the day is varied and never a fixed loop
 const need={energy:.8,hunger:.3,fun:.5,tidy:.3};
 let lastAct=[],actT=0,actDur=8;
 const ACT={
  read:{at:'chair',label:'читает',dur:[45,80],need:'fun'},
  craft:{at:'bench',label:'мастерит',dur:[18,30],need:'fun'},
  cook:{at:'stove',label:'готовит',dur:[16,24],need:'hunger'},
  tea:{at:'sink',label:'пьёт чай',dur:[12,18],need:'hunger'},
  wash:{at:'sink',label:'моет посуду',dur:[10,16],need:'tidy'},
  look:{at:'deck',label:'смотрит вдаль',dur:[12,20],need:'fun'},
  window:{at:pick,label:'смотрит в окно',dur:[8,14],need:'fun'},
  sleep:{at:'bedlie',label:'спит',dur:[1e9,1e9],need:'energy'},
  guard:{label:'на страже'},repair:{label:'чинит доски'},
 };
 function hour(){return ctx.hour();}
 function choose(){const h=hour();if(ctx.isNight(h)&&!(h>=20&&h<21.5))return 'sleep';
  const sc={};const hungerBoost=(h<8.5||(h>12&&h<13.5)||(h>17.5&&h<19.5))?.6:0;
  sc.cook=need.hunger+hungerBoost;sc.tea=need.hunger*.6+(h<10||(h>15&&h<17)?.35:.05);sc.wash=need.tidy;sc.read=need.fun*.8+(h>=19?.6:0);sc.craft=need.fun*.9+(h>9&&h<17?.3:0);
  sc.look=need.fun*.5+(h>6&&h<8||h>18&&h<20?.35:.1);sc.window=.2;
  for(const k in sc){if(lastAct[0]===k)sc[k]-=1;if(lastAct[1]===k)sc[k]-=.35;sc[k]+=rnd(0,.35);}
  return Object.keys(sc).sort((a,b)=>sc[b]-sc[a])[0];}
 const WINDOWS=['bwin','kwin','wwin'];
 function goTo(node,then){if(node===H.node&&!H.path.length){then&&then();return;}
  // on a ladder: finish this rung run first, the new route starts where the ladder ends (QA: H.lad left set, then a 67 cm teleport)
  if(H.lad&&H.path[0]&&H.path[0].t==='ladder'){const first=H.path[0];H.path=[first,...(first.node===node?[]:route(first.node,node))];H.then=then;return;}
  H.path=route(H.node,node);if(!H.path.length){then&&then();return;}H.then=then;H.av=0;H.walkV=WALK_V*(brain?lerp(.86,1.04,clamp(((gait.speed||1)-.7)/.42,0,1)):rnd(.92,1.04));}
 const sidePole=(side,down=1)=>{const f=fwd(root.rotation.y);const right=V(-f.z,0,f.x);return right.multiplyScalar(side==='Right'?1:-1).add(V(0,-down,0)).add(f.clone().multiplyScalar(-.3));};
 function ikList(list){if(!list)return;for(const [s,t,w] of list)if(t&&w>.001)armIK(s,t,sidePole(s),clamp(w,0,1));}

 // a small pot on the stove while cooking
 const pot=sh((()=>{const g=new THREE.Group();const m=new THREE.MeshStandardMaterial({color:0x3A3A3C,metalness:.5,roughness:.45});const b=new THREE.Mesh(new THREE.CylinderGeometry(.1,.09,.12,20,1,true),m);b.position.y=.06;g.add(b);
  const bt=new THREE.Mesh(new THREE.CircleGeometry(.09,20),m);bt.rotation.x=-Math.PI/2;bt.position.y=.005;g.add(bt);const soup=new THREE.Mesh(new THREE.CircleGeometry(.095,20),new THREE.MeshStandardMaterial({color:0x9A5A2A,roughness:.3}));soup.rotation.x=-Math.PI/2;soup.position.y=.09;g.add(soup);
  const hd=new THREE.Mesh(new THREE.BoxGeometry(.12,.015,.025),m);hd.position.set(.15,.1,0);g.add(hd);return g;})());pot.visible=false;scene.add(pot);
 const potSpot=()=>{const st=N.stove;const f=fwd(st.face),r=V(-f.z,0,f.x);const top=floorTop(KT,st.p.x,st.p.z)+.9;return st.p.clone().addScaledVector(f,.62).addScaledVector(r,.17).setY(top);};

 // the activity currently running: a small state machine with its own update
 let act=null;
 function startTask(name,opts){if(name===H.task&&act&&!act.left&&(!opts||!Object.keys(opts).length)&&name!=='micro'&&name!=='switch')return;if(H.trans||H.lad){H.pending=name;H.pendingOpts=opts;return;}
  if(act&&act.leave&&!act.left){const nm=name;act.left=true;H.trans=true;act.leave(()=>{H.trans=false;act=null;startTask(nm,opts);});return;}
  // still seated when a task without its own leave ends (or is cut short): stand up properly first, never slide off in a sitting pose
  if(H.seated&&!H.inBed&&!H.bedB&&!H.swing&&H.fit){const sp=H.seated;act=null;H.trans=true;standUp(sp,()=>{H.node=sp.node||nearNode(root.position.clone().add(V(0,.3,0)))||H.node;startTask(name,opts);});return;}
  if(H.sqJob){H.squat=0;H.sqJob=false;}/* GRAB: a job's knee bend never carries over into the next task */
  act=null;H.then=null;/* a walk left over from the task that was cut short must not fire its arrival (QA: the old 'read' sat him down in the middle of a stretch) */H.task=name;actT=0;const A=ACT[name]||{};actDur=A.dur?rnd(A.dur[0],A.dur[1]):8;lastAct.unshift(name);lastAct.length=3;H.look=null;H.lookW=0;
  const mk=MAKE[name];if(!mk)return;act=mk(opts||{});act.name=name;}
 // ===== BRAIN HOOK state: setBrain / gait / onTaskEnd =====
 let brain=null;let motion=null;let climb=null;/* CLIMB HOOK: game/climb.js, see setClimb *//* MOTION HOOK: game/motion.js, see setMotion */const gait={speed:1,turn:1};const endCbs=[];
 function endTask(res){kSlow(false);H.kSquat=0;const n=H.task;act=null;H.task=null;H.look=null;H.lookW=0;for(const cb of endCbs){try{cb(n,res);}catch(e){console.error(e);}}}
 // lamps with a wall switch (props.js switchPlate): the hand goes to the plate, not to the lamp
 const SWITCH_AT=(ctx.props&&ctx.props.switches)?Object.fromEntries(Object.entries(ctx.props.switches).map(([k,v])=>[k,v.clone()])):{bedroom:V(.372,lv.BD+1.15,3.5)};// wall switch positions come from props.js
 const LAMP=()=>window.__lights||ctx.lights||null;
 function nearNode(p){let best=null,bd=1e9;for(const k in N){const n=N[k];if(!n||!n.p||n.seat!=null||!adj[k])continue;if(Math.abs(n.p.y-p.y)>2.6||n.p.y>p.y+.2)continue;const dy=p.y-n.p.y;const d=Math.hypot(n.p.x-p.x,n.p.z-p.z)+Math.max(0,dy-1.95)*10+(p.hand?Math.max(0,.8-dy)*20:0);if(d<bd){bd=d;best=k;}}return best;}
 // ===== END BRAIN HOOK state =====
 const READ=has('hy_read')?'hy_read':'33',SITIDLE=has('hy_sitidle')?'hy_sitidle':'33';
 // the book in the hands: centred between the hands, a little forward, the pages facing the eyes
 const _bx=V(),_by=V(),_bz=V(),_bm=new THREE.Matrix4(),_bq=new THREE.Quaternion();
 function bookPose(){const L=bones.LeftHand.getWorldPosition(V()),R=bones.RightHand.getWorldPosition(V());const head=bones.Head.getWorldPosition(V());
  const f=fwd(root.rotation.y);const pos=L.clone().add(R).multiplyScalar(.5).addScaledVector(f,.06).add(V(0,.03,0));
  _by.copy(head).sub(pos).normalize();_bx.set(-f.z,0,f.x);_bx.addScaledVector(_by,-_bx.dot(_by)).normalize();_bz.crossVectors(_bx,_by);
  _bm.makeBasis(_bx,_by,_bz);_bq.setFromRotationMatrix(_bm);return {pos,quat:_bq.clone()};}
 const MAKE={
  // walk to a lamp or wall switch, reach out and press it; the light changes when the fingers touch
  switch:(o={})=>{const a={step:'go',t:0};const L=LAMP();const lp=SWITCH_AT[o.light]?SWITCH_AT[o.light].clone():(L&&L.pos?L.pos(o.light):null);const plate=!!SWITCH_AT[o.light];
   if(!lp){a.update=()=>endTask();return a;}
   const sp=lp.clone?lp.clone():V(lp.x,lp.y,lp.z);const node=nearNode(sp);
   const approach=()=>{a.step='approach';a.t=0;const p=root.position;const dx=sp.x-p.x,dz=sp.z-p.z,d=Math.hypot(dx,dz);const yaw=Math.atan2(dx,dz);H.face=yaw;
    const fl=floorAt(p.x,p.y+.3,p.z,.5)??p.y;a.low=sp.y-fl<.75;a.knob=a.low||plate?sp.clone().add(V(-.03,0,0)):sp.clone().add(V(0,-.15,0));
    const move=Math.max(0,Math.min(.9,d-(a.low?.45:.27)));const q=p.clone().add(V(dx/d*move,0,dz/d*move));pushOut(q);
    a.dur=Math.max(.35,move/.8);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:0,k:0,d:a.dur};if(move>.1)play('30',{fade:.3,speed:1.1});};
   if(node)goTo(node,approach);else approach();
   a.update=dt=>{a.t+=dt;H.look=sp.clone();H.lookW=1;
    if(a.step==='approach'&&a.t>=a.dur){a.step='reach';a.t=0;if(a.low&&has('hy_take'))once('hy_take',{fade:.4,then:()=>play(IDLE(),{fade:.5})});else play(IDLE(),{fade:.4});}
    else if(a.step==='reach'){const tT=a.low&&has('hy_take')?durOf('hy_take')*.45:.42,tE=a.low&&has('hy_take')?durOf('hy_take'):.95;if(a.t>tT&&!a.done){a.done=true;try{L.set(o.light,o.on!=null?!!o.on:!(L.get&&L.get(o.light)));}catch(e){}sfx&&sfx.click&&sfx.click();}
     if(a.t>tE)endTask();}};
   a.post=()=>{if(a.step!=='reach')return;const w=smooth(0,.4,a.t)*(1-smooth(.6,.95,a.t));const sh=bones.RightArm;const from=sh.getWorldPosition(V());
    const v=a.knob.clone().sub(from);const reach=armLen*.97;if(v.length()>reach)v.setLength(reach);if(!a.low)ikList([['Right',from.add(v),w]]);};
   return a;},
  // open or close the floor hatch over the kitchen ladder: go to its top or bottom, reach for the ring, it moves at the touch
  hatch:(o={})=>{// GRAB: BY HAND. He stands at the side of the opening facing the ring, crouches (code squat, feet planted), takes the
   // ring and the lid rises only as far as his palm carries it; past upright it tips over onto its rest. Closing: the palm on the
   // standing lid's ring pulls it toward him past upright, then lets go and it drops shut. Never a lid moving away from the hand.
   const a={step:'go',t:0,w:0,held:false};const hc=window.__house&&window.__house.hatch;if(!hc){a.update=()=>endTask();return a;}
   const want=o.open!=null?!!o.open:!hc.isOpen();
   if(want===hc.isOpen()&&Math.abs(hc.angle-(want?hc.OPEN:0))<.05){a.update=()=>endTask({ok:true,open:want});return a;}
   if(!hc.drive||!hc.ringAt){a.update=dt=>{a.t+=dt;if(a.t>.5){try{want?hc.open():hc.close();}catch(e){}endTask();}};return a;}
   const [,x1,,,z0,z1]=hc.box;/* beside the hole the near foot (~10 cm off his centre) stays on the boards; past its end he stands closer */
   const footX=(g,z)=>z>z1+.18?Math.max(g.x+.36,x1+.02):x1+.11;
   const tmp=V();const [hx0,hx1]=[hc.box[0],hc.box[1]];
   // opening: the palm under the lid's near side edge, 0.6 m out from the hinge (the ring lies too far in for a hand from the side);
   // closing: the palm on the standing lid's ring
   const EDGE=V(.29,.035,-.6);/* fingers over the edge of the top board */const edgeAt=(ang,out)=>{const L=hc.lid;const k=L.rotation.x;L.rotation.x=ang;L.updateMatrixWorld(true);out.copy(EDGE);L.localToWorld(out);L.rotation.x=k;L.updateMatrixWorld(true);return out;};
   const P=(ang,out)=>want?edgeAt(ang,out):hc.ringAt(ang,out);const ring=()=>P(hc.angle,V());
   const standZ=g=>clamp(g.z+.1,z0+.12,z1+.5);/* right shoulder in line with the ring */
   const sqFor=t=>{/* from the standing shoulder (measured as he arrives), not the leaning one */const p=root.position;const SH=a.SH||1.12;const hz=Math.max(0,Math.hypot(p.x-t.x,p.z-t.z)-.08);const R0=armLen*.9+PALM;const h=Math.min(hz,R0*.8);const dy=p.y+(H.squat||0)+SH-t.y;return clamp(dy-Math.sqrt(Math.max(0,R0*R0-h*h))+.02,0,.45);};/* .45 is the deepest the leg IK keeps the soles on the boards */
   const sqTo=(v,dt,rate=1.6)=>{const c=H.squat||0;H.squat=c+clamp(v-c,-rate*dt,rate*dt);};
   const L=hc.ladder||{top:'bl_t',bottom:'kl_b'};const start=N.bl_m?'bl_m':L.top;
   goTo(start,()=>{a.step='app';const g=ring();approachTo(a,V(footX(g,standZ(g)),root.position.y,standZ(g)),0,()=>{a.step='reach';a.t=0;a.SH=bones.RightArm.getWorldPosition(V()).y-root.position.y-(H.squat||0);});});
   const grip=()=>{const G=window.__grab;return G&&G.gripPoint?G.gripPoint('Right'):bones.RightHand.getWorldPosition(V());};
   a.update=dt=>{if(a.step==='approach'){a.t+=dt;if(a.t>=a.adur)a.next();return;}if(a.step==='go'||a.step==='app')return;a.t+=dt;
    const p=root.position,g=ring();H.look=g;H.lookW=1;
    {const fy=Math.atan2(g.x-p.x,g.z-p.z);root.rotation.y+=wrapA(fy-root.rotation.y)*Math.min(1,dt*4);H.face=root.rotation.y;}
    {/* small shuffles along the edge, the right shoulder stays level with the ring as it swings */const m=.35*dt;const tz=standZ(g);p.z+=clamp(tz-p.z,-m,m);const fx=footX(g,p.z);p.x+=clamp(fx-p.x,-m,m);}
    if(a.step==='reach'){a.w=Math.min(1,a.w+dt/.6);sqTo(sqFor(g),dt,.8);const gd=a.gd!=null?a.gd:grip().distanceTo(g);
     const tip=want&&hc.angle<.3?.07:0;/* a flush lid edge is lifted by the fingertips, which reach ~5 cm past the grip point */
     if(a.w>.95&&gd<.04+tip){a.held=true;a.step='move';a.t=0;AU(want?'hatch_open':'hatch_close',g);}else if(a.t>4){a.step='after';a.t=0;}return;}
    if(a.step==='move'){const gd=a.gd!=null?a.gd:grip().distanceTo(g);if(gd>.05+(want&&hc.angle<.3?.07:0)){a.lost=(a.lost||0)+dt;if(a.lost>2.5){hc.letGo(hc.angle>1.57);a.held=false;a.step='after';a.t=0;}return;}a.lost=0;
     // the next lid angle the palm can follow this frame (palm within reach of the shoulder after the knees straighten a little)
     const sh=bones.RightArm.getWorldPosition(V());const R=armLen*.92+PALM+.06;/* + the small lean reachTo adds */const rate=want?1.1:.9;let nx=want?Math.min(hc.OPEN,hc.angle+rate*dt):Math.max(0,hc.angle-rate*dt);
     if(!want&&sh.distanceTo(P(nx,tmp))>R+.02){/* opening: the palm-distance gate above is the limit (the lid waits for the hand) */let lo=hc.angle,hi=nx;for(let k=0;k<8;k++){const m=(lo+hi)/2;if(sh.distanceTo(P(m,tmp))<=R+.02)lo=m;else hi=m;}nx=lo;}
     if(Math.abs(nx-hc.angle)>1e-4){hc.drive(nx);a.st=0;}else a.st=(a.st||0)+dt;
     sqTo(sqFor(P(nx,tmp)),dt,.9);
     if(want&&hc.angle>=1.68){/* past upright: it tips over onto its rest under its own weight */hc.letGo(true);a.held=false;a.step='after';a.t=0;}
     else if(!want&&hc.angle<=1.3){/* pulled past upright toward the hole: let go, it drops shut */hc.letGo(false);a.held=false;a.step='after';a.t=0;}
     else if(a.st>1.2){/* the hand cannot carry it further: put it back down the way it was */hc.letGo(!want);a.held=false;a.step='after';a.t=0;}
     return;}
    if(a.step==='after'){a.w=Math.max(0,a.w-dt/.4);sqTo(0,dt,.9);if(a.t>.8&&(H.squat||0)<.01){H.squat=0;play(IDLE(),{fade:.4});endTask({ok:hc.isOpen()===want,open:hc.isOpen()});}}};
   a.post=()=>{const G=window.__grab;if(a.w>.01){const g=ring();if(G&&G.palmTarget&&G.gripPoint){/* the grip point turns with the forearm: aim, measure, re-aim (3 passes) */let t=G.palmTarget('Right',g);REACH_LEAN=want?1.1:.6;/* down to the floor boards he bends at the waist too */for(let k=0;k<4;k++){if(k===1)REACH_LEAN=want?.5:0;if(k===2)REACH_LEAN=0;/* lean once; the re-aims move the arm only */reachTo('Right',t,a.w);root.updateMatrixWorld(true);const e=g.clone().sub(G.gripPoint('Right'));if(e.length()<.01)break;t=t.add(e.multiplyScalar(a.w));}a.gd=G.gripPoint('Right').distanceTo(g);REACH_LEAN=.6;}else reachTo('Right',g,a.w);}{/* crouched, the free hand rests on the left knee (not pushed up by the thigh) */const sq=clamp(((H.squat||0)-.1)/.2,0,1)*a.w;if(sq>.01&&bones.LeftLeg){const kn=bones.LeftLeg.getWorldPosition(V());const f=fwd(root.rotation.y);const t=kn.add(V(0,.07,0)).addScaledVector(f,.03);const RL=REACH_LEAN;REACH_LEAN=0;reachTo('Left',G&&G.palmTarget?G.palmTarget('Left',t):t,sq);REACH_LEAN=RL;}}
    if(G){if(a.held||(a.step==='reach'&&a.w>.5))G.hold('Right',hc.lid,ring);else G.free(hc.lid);}};/* the palm on the ring is a grip: collide leaves it there */
   a.leave=cb=>{try{window.__grab&&window.__grab.free(hc.lid);}catch(e){}if(a.held){try{hc.letGo(hc.angle>1.57);}catch(e){}}H.squat=0;cb();};
   return a;},
  // a short gesture in place (stretch, look around, scratch the head, inspect); ends by itself
  micro:(o={})=>{const a={step:'do',t:0};const c=o.clip&&has(o.clip)?o.clip:IDLE();const one=['hy_stretch','hy_inspect','hy_take','hy_drink'].includes(c);
   const dur=o.dur||(one?durOf(c):3);if(H.seated){a.update=()=>endTask();return a;}
   const go=()=>{a.on=1;a.t=0;if(one)once(c,{fade:.5});else play(c,{fade:.5});};if(H.path.length){H.then=go;}else go();/* finish the step to the next spot first: a stretch is done standing, not mid-stride */
   a.update=dt=>{if(!a.on)return;a.t+=dt;if(o.look){H.look=o.look.clone?o.look.clone():V(o.look.x,o.look.y,o.look.z);H.lookW=.8;}if(a.t>=dur){play(IDLE(),{fade:.6});endTask();}};return a;},
  read:(o={})=>{const a={step:'go',t:0,k:0,flipT:rnd(5,8),pt:-1};
   if(o.seated){a.step='read';a.got=true;a.k=1;a.next=rnd(16,26);}
   else goTo('chair_app',()=>{a.step='sit';sitDown(N.chair,()=>{a.step='take';a.t=0;play(SITIDLE,{fade:.8});});});
   a.update=dt=>{a.t+=dt;
    if(a.step==='take'){H.look=bookHome?bookHome.pos.clone():null;H.lookW=1;if(a.t>1.0&&!a.got){a.got=true;a.k=0;play(READ,{fade:1.1});}
     if(a.got){a.k=Math.min(1,a.k+dt/1.1);if(a.k>=1){a.step='read';a.t=0;a.next=rnd(16,26);}}}
    else if(a.step==='read'){if(bookObj)H.look=bookObj.position.clone();H.lookW=1;
     a.flipT-=dt;if(a.flipT<0&&a.pt<0){a.pt=0;}
     if(a.pt>=0){const was=a.pt;a.pt+=dt;if(was<.45&&a.pt>=.45&&BOOK)BOOK.turn(1);if(a.pt>1.75){a.pt=-1;a.flipT=rnd(6,11);}}
     if(a.t>a.next&&a.pt<0){a.step='pause';a.t=0;a.pause=rnd(4,7);play(SITIDLE,{fade:1.3});}}
    else if(a.step==='pause'){// rest the book on the lap, glance around, stretch the neck
     H.look=root.position.clone().add(fwd(root.rotation.y+Math.sin(a.t*.5)*1.2).multiplyScalar(3)).add(V(0,1.3,0));H.lookW=.7;
     if(a.t>a.pause){a.step='read';a.t=0;a.next=rnd(16,26);play(READ,{fade:1.2});}}
    else if(a.step==='putdown'){a.k=Math.max(0,a.k-dt/1.0);H.look=bookHome?bookHome.pos.clone():null;H.lookW=1;if(a.k<=0&&!a.done){a.done=true;if(bookObj&&bookHome){bookHome.parent.add(bookObj);bookObj.position.copy(bookHome.pos);bookObj.quaternion.copy(bookHome.quat);}BOOK&&BOOK.setOpen&&BOOK.setOpen(1);a.cb&&a.cb();}}};
   a.post=dt=>{if(!bookObj)return;
    if(a.step==='take'&&!a.got){ikList([['Right',bookHome.pos.clone().add(V(0,.03,0)),smooth(.1,.9,a.t)]]);return;}
    if(!a.got)return;const T=bookPose();const k=smooth(0,1,a.k);
    if(!a.bp){a.bp=T.pos.clone();a.bq=T.quat.clone();}else{const s=1-Math.exp(-dt*10);a.bp.lerp(T.pos,s);a.bq.slerp(T.quat,s);}
    if(bookObj.parent!==scene)scene.attach(bookObj);
    bookObj.position.copy(bookHome.pos).lerp(a.bp,k);bookObj.quaternion.copy(bookHome.quat).slerp(a.bq,k);bookObj.updateMatrixWorld(true);
    if(a.step==='take'&&k<.5)ikList([['Right',bookObj.position.clone(),1-k*2]]);
    // hands on the covers; the right hand lifts the page corner and carries it over
    const gl=bookObj.localToWorld(V(-.14,-.015,.02)),gr=bookObj.localToWorld(V(.14,-.015,.02));let wr=.85*k,tr=gr;
    if(a.pt>=0){const st=BOOK.state;let tgt;
     if(a.pt<.45){tgt=gr.clone().lerp(BOOK.corner(V()),smooth(0,.45,a.pt));}
     else if(st.turning){const e=st.a<.5?2*st.a*st.a:1-Math.pow(-2*st.a+2,2)/2;const ph=e*Math.PI;tgt=bookObj.localToWorld(V(Math.cos(ph)*.13,.02+Math.sin(ph)*.11,.06));}
     else tgt=bookObj.localToWorld(V(-.11,.02,.06)).lerp(gr,smooth(1.3,1.75,a.pt));
     tr=tgt;wr=1;}
    // the hand follows its goal through a soft spring, so phase changes never snap it
    {const sf=1-Math.exp(-dt*12);if(!a.ht){a.ht=tr.clone();a.hw=wr;}else{a.ht.lerp(tr,sf);a.hw+=(wr-a.hw)*sf;}}
    ikList([['Left',gl,.85*k],['Right',a.ht,a.hw]]);};
   a.leave=cb=>{a.ik=null;if(a.step==='go'){cb();return;}
    const up=()=>standUp(N.chair,cb);
    if(!a.got||!bookObj){up();return;}a.step='putdown';a.cb=up;a.k=1;play(SITIDLE,{fade:.8});};return a;},
  craft:()=>{const a={step:'go',t:0};goTo('bench',()=>{a.step='reach';a.t=0;play(IDLE(),{fade:.4});});
   a.update=dt=>{a.t+=dt;const hp=hammerHome();
    if(a.step==='reach'){H.face=wrapA(N.bench.face+clamp(wrapA(Math.atan2(hp.x-root.position.x,hp.z-root.position.z)-N.bench.face),-.6,.6));H.look=hp;H.lookW=1;
     a.ik=[['Right',hp.clone().add(V(0,.05,0)),smooth(.1,.9,a.t)-smooth(1.0,1.7,a.t)]];if(a.t>.95&&!a.got){a.got=true;grabTool('benchHammer','Right');}
     if(a.t>1.6){a.step='work';a.t=0;H.face=N.bench.face;const bt=(P3&&P3.surfaces&&P3.surfaces.benchTop)||floorTop(WS,N.bench.p.x,N.bench.p.z)+.9;const f=fwd(N.bench.face);
      plank.visible=true;plank.position.copy(root.position).addScaledVector(f,.5).setY(bt+.015);plank.rotation.set(0,N.bench.face+rnd(-.2,.2),0);play('hy_hammer',{fade:.7});}}
    else if(a.step==='work'){H.face=N.bench.face;H.look=plank.position.clone();H.lookW=.8;a.ik=null;
     const y=bones.RightHand.getWorldPosition(V()).y;if(a.py!=null){const v=(y-a.py)/Math.max(dt,1e-3);if(a.pv!=null&&a.pv<-.4&&v>=-.05&&(a.lastHit??-9)<a.t-.3){a.lastHit=a.t;sfx&&sfx.hammer&&sfx.hammer();}a.pv=v;}a.py=y;}};
   a.post=()=>ikList(a.ik);
   a.leave=cb=>{plank.visible=false;if(!H.hold.Right){cb();return;}a.step='putback';a.t=0;play(IDLE(),{fade:.5});a.update=dt=>{a.t+=dt;const hp=hammerHome();H.look=hp;H.lookW=1;
     a.ik=[['Right',hp.clone().add(V(0,.06,0)),smooth(0,.8,a.t)-smooth(1.0,1.6,a.t)]];if(a.t>.85&&H.hold.Right){releaseTool('Right');}if(a.t>1.6){a.ik=null;cb();}};};return a;},
  cook:()=>{const a={step:'go',t:0};
   // KITCHEN: a look at the fire first, by hand (the hy_oven clip stooped bow-legged with the hand hovering while the door dropped by
   // itself): squat at the oven, the right palm on the handle lowers the door, a look at the embers, the hand lifts it shut, stand up
   const OVP=()=>{const P=window.__props||P3;return P&&P.oven&&P.oven.handle?P.oven:null;};const ovp=PT('oven');
   const sqTo=(v,dt,rate=2.2)=>{const c=H.squat||0;H.squat=c+clamp(v-c,-rate*dt,rate*dt);H.kSquat=H.squat>.001;H.kSqA=act;};
   const sqFor=t=>{const sh=bones.RightArm.getWorldPosition(V());const hz=Math.hypot(sh.x-t.x,sh.z-t.z);const R0=armLen*.9+PALM-.03;const dy=sh.y+(H.squat||0)-t.y;return clamp(dy-Math.sqrt(Math.max(0,R0*R0-hz*hz))+.03,0,.45);};
   const afterOven=()=>{/* GRAB: no spoon out of thin air and no clip stirring the air beside the stove: he steps up to the
     pot, takes the ladle out of it with his hand, then stirs in it (stirPost) */const PO=PP();const pp=PO&&PO.tools&&PO.tools.pot;
     if(pp&&PO.tools.ladle){pot.visible=false;a.pot2=1;a.step='topot';a.t=0;play(IDLE(),{fade:.5});approachTo(a,pp.getWorldPosition(V()),.45,()=>{a.step='getladle';a.t=0;});}
     else{a.step='stir';a.t=0;grab(spoon,'Right',[0,.06,.02],[0,0,-Math.PI/2]);play('hy_stir',{fade:.7});}};
   goTo('stove',()=>{pot.visible=true;pot.position.copy(potSpot());pot.rotation.y=rnd(0,6);
    if(OVP()&&ovp){a.ovh=1;ovenSpot(a,()=>{a.step='ovsq';a.t=0;});}
    else{a.step='oven';a.t=0;once('hy_oven',{fade:.5,then:afterOven});}});
   const oven=()=>P3&&P3.oven?P3.oven:(ctx.ovenDoor&&ctx.ovenDoor());
   a.update=dt=>{if(a.step==='approach'){if(a.pot2||a.ovh){stepTick(a,dt);return;}}a.t+=dt;
    kSlow(/^(ovsq|open|peek|shut)$/.test(a.step)&&(H.squat||0)>.05);if(/^(ovsq|open|peek|shut|up)$/.test(a.step)){const o=OVP();const h=o.handle(V());const m=ovp.clone().add(V(h.x-ovp.x,0,h.z-ovp.z).multiplyScalar(-.15)).setY(ovp.y+.02);const G=window.__grab;a.oik=null;
     if(a.step==='ovsq'){H.look=h;H.lookW=1;if(a.sqd===undefined)a.sqd=Math.max(sqFor(h),sqFor(m)*.8);sqTo(a.sqd,dt);a.oik=['Right',h,smooth(.2,.8,a.t)];if(a.t>.85&&palmTo('Right',h)<.04||a.t>1.6){a.step='open';a.t=0;AU('ovenDoor',h);}}
     else if(a.step==='open'){o.setOpen(Math.min(1,o.open+dt/.9));H.look=m;H.lookW=.9;a.oik=['Right',o.handle(V()),1];if(G)G.hold('Right',o.door,()=>o.handle(V()));if(o.open>=1){if(G)G.free(o.door);a.step='peek';a.t=0;}}
     else if(a.step==='peek'){/* the hand lets go and rests on his knee while he looks at the fire */H.look=m;H.lookW=1;a.oik=['Right',h,1-smooth(0,.35,a.t)];if(a.t>1.7){a.step='shut';a.t=0;}}
     else if(a.step==='shut'){H.look=h;H.lookW=1;if(!a.sh){a.oik=['Right',h,smooth(0,.4,a.t)];if(a.t>.45){a.sh=1;a.t=0;}}else{o.setOpen(Math.max(0,o.open-dt/.7));a.oik=['Right',o.handle(V()),1];if(G)G.hold('Right',o.door,()=>o.handle(V()));if(o.open<=0){if(G)G.free(o.door);a.step='up';a.t=0;AU('ovenDoor',h);}}}
     else if(a.step==='up'){a.oik=['Right',h,1-smooth(0,.35,a.t)];sqTo(0,dt,.9);if(a.t>.4&&(H.squat||0)<.01){H.squat=0;H.kSquat=0;kSlow(false);a.oik=null;afterOven();}}
     return;}if(a.step==='topot'||a.step==='getladle'||a.step==='stir2'||a.step==='putladle'){
     const PO=PP();const pp=PO&&PO.tools&&PO.tools.pot;if(pp){H.look=pp.getWorldPosition(V()).add(V(0,.08,0));H.lookW=.9;}
     if(a.step==='getladle'){const g=gripHome('ladle');a.reach=['Right',g,smooth(0,.5,a.t)];const G=window.__grab;const dd=G&&G.gripPoint?G.gripPoint('Right').distanceTo(g):0;if(!H.hold.Right||H.hold.Right.tool!=='ladle'){if(dd<.03||a.t>1.3){grabTool('ladle','Right');a.step='stir2';a.t=0;a.reach=null;}}}
     return;}
    H.face=N.stove.face;const ov=oven();
    if(a.step==='oven'){const k=a.t/durOf('hy_oven');const open=smooth(.24,.36,k)-smooth(.6,.72,k);ov&&ov.setOpen&&ov.setOpen(open);
     H.look=root.position.clone().addScaledVector(fwd(H.face),.6).add(V(0,.35,0));H.lookW=.7;
     a.ik=ov&&ov.handle?[['Right',ov.handle(),smooth(.16,.25,k)-smooth(.7,.8,k)]]:null;}
    else if(a.step==='stir'){const pp=pot.position.clone().add(V(0,.1,0));H.look=pp;H.lookW=1;
     a.ik=[['Right',pp.clone().add(V(Math.cos(a.t*3)*.045,.12,Math.sin(a.t*3)*.045)),.75]];}};
   // while crouched at the oven the free hand rests on its knee (never hanging behind him or to the floor)
   const knee=sd=>bones[sd+'Leg'].getWorldPosition(V()).addScaledVector(fwd(root.rotation.y),.02).add(V(0,.07,0));
   a.post=dt=>{ikList(a.ik);const crouch=/^(ovsq|open|peek|shut|up)$/.test(a.step)?clamp((H.squat||0)/.18,0,1):0;
    if(crouch>.01){gripNoLean('Left',knee('Left'),crouch);if(a.oik&&a.oik[2]<1)gripNoLean('Right',knee('Right'),crouch*(1-(a.oik?a.oik[2]:0)));}
    if(a.oik&&a.oik[2]>.01)reachGrip(a.oik[0],a.oik[1],Math.min(1,a.oik[2]));if(a.step==='stir2')stirPost(a,dt);if(a.reach&&a.reach[2]>.01)reachGrip(a.reach[0],a.reach[1],a.reach[2]);};
   a.leave=cb=>{a.ik=null;a.oik=null;H.squat=0;H.kSquat=0;kSlow(false);const ov=oven();try{window.__grab&&ov&&ov.door&&window.__grab.free(ov.door);}catch(e){}ov&&ov.setOpen&&ov.setOpen(0);pot.visible=false;
    if(H.hold.Right&&H.hold.Right.tool==='ladle'){/* the ladle goes back into the pot from his hand */try{window.__grab.free('Left');window.__grab.free('Right');}catch(e){}a.step='putladle';a.t=0;
     a.update=dt=>{a.t+=dt;const g=gripHome('ladle');a.reach=['Right',g,smooth(0,.45,a.t)*(1-smooth(.75,1.1,a.t))];const G=window.__grab;const dd=G&&G.gripPoint?G.gripPoint('Right').distanceTo(g):0;
      if(H.hold.Right&&(dd<.03||a.t>.7))relTool('Right','ladle',.14);if(a.t>1.1){a.reach=null;cb();}};return;}
    if(H.hold.Right){release('Right');spoon.visible=false;}cb();};return a;},
  tea:()=>{// KITCHEN: a real cup of tea. The mug from the sink rest in the drinking hand, over to the stove, the kettle by its handle in the
   // other hand, poured: the spout over the mug, tipped, then the kettle back on its ring; sip by the window; the mug back to the sink.
   const a={step:'go',t:0};const hand=POSE.drinkHand||'Right',oth=hand==='Right'?'Left':'Right';const P=window.__props||P3;
   const ket=()=>P&&P.tools&&P.tools.kettle;const kHandle=()=>{const k=ket();k.updateMatrixWorld(true);return k.localToWorld(V(0,.21,0));};
   const kSpout=()=>ket().localToWorld(V(.17,.155,0));const rgt=()=>{const f=fwd(root.rotation.y);return V(-f.z,0,f.x);};
   const cupAt=()=>{const hp=bones.Spine1.getWorldPosition(V());return hp.addScaledVector(fwd(root.rotation.y),.32).addScaledVector(rgt(),hand==='Right'?.04:-.04).add(V(0,-.12,0));};// mug held in front of the belly
   /* KITCHEN: step up facing the mug (reaching sideways for it from the sink spot bent him over to one side) */
   goTo('sink',()=>approachTo(a,rest.mug.clone(),.42,()=>{a.step='take';a.t=0;play(IDLE(),{fade:.4});}));
   a.ik=null;
   a.update=dt=>{a.t+=dt;
    if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    if(a.step==='take'){H.look=rest.mug.clone();H.lookW=1;/* the mug comes up from the counter into his hand in front of the belly (it never drops to dangle by his side) */a.ik=[[hand,rest.mug.clone().add(V(0,.05,0)).lerp(cupAt(),smooth(.9,1.4,a.t)),smooth(.1,.8,a.t)]];
     if(a.t>.85&&!H.hold[hand]){grab(mug,hand,hand==='Right'?[-.05,.136,.035]:[.05,.136,.035],[0,0,hand==='Right'?-Math.PI/2:Math.PI/2])/* KITCHEN: by its handle (the handle in the palm, not the mug's bottom on an open hand) */;}
     if(a.t>1.4){a.ik=null;if(!ket()){a.step='drink';a.t=0;a.turn=rnd(-1.1,-.5);return;}a.step='tostove';const kp=ket().getWorldPosition(V());const nn=nearNode(kp)||'stove';goTo(nn,()=>approachTo(a,kp,.42,()=>{a.step='kreach';a.t=0;}));}return;}
    if(a.step==='tostove'||a.step==='go')return;
    if(a.step==='kreach'){const h=kHandle();H.look=h;H.lookW=1;a.ik=[[oth,h,smooth(0,.6,a.t)],[hand,cupAt(),smooth(0,.6,a.t)]];
     if((a.t>.6&&palmTo(oth,h)<.03)||a.t>1.3){try{a.k0=(window.__grab&&window.__grab.gripPoint?window.__grab.gripPoint(oth):bones[oth+'Hand'].getWorldPosition(V())).clone().add(V(0,.04,0));a.w0=bones[oth+'Hand'].getWorldPosition(V());a.d0=a.k0.clone().sub(a.w0);bones[oth+'Hand'].attach(ket());/* as it stands, upright, the palm on its handle: no re-seat (a spec seat swung it, then the wrist snapped it level) */a.kh=1;AU('cloth');
      /* holding it, the grip point is the kettle's own (its GRIP spec), not the empty fist's: measure it again, or the fist was pulled 8-14 cm down onto the old point (a 27 cm pop after the pops filter) */{const G=window.__grab;if(G&&G.palmTarget){const g0=G.gripPoint(oth).clone();a.pa0=G.palmTarget(oth,g0).clone();a.k0=g0.add(V(0,.04,0));a.ik=[['palm',a.pa0.clone(),1],[hand,cupAt(),1]];a.lk0=h.clone();}H.noPop={side:oth,until:performance.now()+250};/* motion.js: the palm stays put while the arm's IK solution changes (the pop filter turned that into an 11 cm jerk) */}}catch(e){}a.step='pour';a.t=0;}return;}
    if(a.step==='pour'){// lift, bring the spout over the mug, tip it for ~2 s, level it again
     const m=mug.getWorldPosition(V()).add(V(0,.13,0));H.look=(a.lk0||a.k0)?(a.lk0||a.k0).clone().lerp(m,smooth(0,.7,a.t)):m;/* the gaze follows the kettle up from the ring (a jump of the look target popped the chest up) */H.lookW=1;a.tip=.75*(smooth(.7,1.2,a.t)-smooth(3.0,3.5,a.t));
     a.ik=[[hand,cupAt(),1],['pour',m,smooth(0,.6,a.t)]];H.noPop={side:oth,until:performance.now()+120};/* the kettle arm is IK'd smoothly every frame: the pop filter only added jerks to it (6-11 cm) */if(a.t>1.2&&!a.snd){a.snd=1;AU('pour',m);}
     if(a.t>3.7){a.step='kback';a.t=0;a.tip=0;}return;}
    if(a.step==='kback'){const hm=toolHome('kettle');if(!a.kbL){a.kbL=(H.look||hm).clone();}H.look=a.kbL.clone().lerp(hm,smooth(0,.5,a.t));H.lookW=1;const t=gripHome('kettle')||hm;a.ik=[[hand,cupAt(),1],[oth,t,1]];
     /* back to the ring by the palm, from where the pour left it (the grip target with full weight at once dropped the fist 5 cm, 20 after the pops filter) */{const G=window.__grab;if(!a.rel&&G&&G.palmTarget&&ket()&&ket().parent===bones[oth+'Hand']){if(!a.pk)a.pk=G.palmTarget(oth,G.gripPoint(oth)).clone();a.ik=[[hand,cupAt(),1],['palm',a.pk.clone().lerp(G.palmTarget(oth,t.clone()),smooth(0,.7,a.t)),1]];}}
     if(!a.rel&&((a.t>.5&&palmTo(oth,t)<.03)||a.t>1.3)){a.rel=1;a.tr=a.t;try{P.release('kettle',{blend:.14});}catch(e){}}
     if(a.rel){a.ik=[[hand,cupAt(),1],[oth,t,1-smooth(a.tr+.1,a.tr+.9,a.t)]];if(a.t>a.tr+.95){a.step='drink';a.t=0;a.turn=rnd(-.8,.8);a.ik=null;}}return;}
    if(a.step==='drink'){// turn toward the window, sip slowly, rest between sips
     const w=N.kwin?N.kwin.p:root.position;H.face=Math.atan2(w.x-root.position.x,w.z-root.position.z)+a.turn*.3;H.look=w.clone().add(V(0,1.5,2));H.lookW=.5;
     // a sip: the mug up to the lips by the arm (no clip miming it at the hip), a moment, down to the belly, a pause
     if(a.sip===undefined){a.sip=.8;a.sd=rnd(1.1,1.6);play(IDLE(),{fade:.6});}const u=a.t-a.sip;const k=u<0?0:smooth(0,.6,u)*(1-smooth(.6+a.sd,1.2+a.sd,u));
     if(u>1.2+a.sd){a.sip=a.t+rnd(2.5,5);a.sd=rnd(1.1,1.6);}
     const hd=bones.Head.getWorldPosition(V());const lip=hd.addScaledVector(fwd(root.rotation.y),.12).add(V(0,.0,0));const c=cupAt();a.sk=k;a.ik=[[hand,c.lerp(lip,k),1]];if(k>.6){H.look=null;}}};
   // the mug stays upright in his hand (the wrist turns it level; it hung upside down off the IK'd hand); tilted toward him only at the lips
   const level=w=>{if(w<.01||mug.parent!==bones[hand+'Hand'])return;const hb=bones[hand+'Hand'];mug.updateMatrixWorld(true);const u=V(0,1,0).applyQuaternion(mug.getWorldQuaternion(new THREE.Quaternion()));
    const q=new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(u,V(0,1,0)),w);const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(q.multiply(cq)));hb.updateMatrixWorld(true);};
   a.post=dt=>{/* carrying the mug: held upright in front of him while he walks */if(H.hold[hand]&&/^(tostove|go|approach)$/.test(a.step))reachGrip(hand,cupAt(),1);
    a.post2();if(H.hold[hand])level(a.step==='drink'?1-(a.sk||0):a.step==='take'?smooth(.85,1.3,a.t):1);
    // a sip: the mug itself is posed at the mouth (rim on the lips, tipped toward him, handle out to his side) and the hand follows it
    if(a.step==='drink'&&(a.sk||0)>.01&&mug.parent===bones[hand+'Hand']){const k=a.sk;const f=fwd(root.rotation.y);const up=V(0,1,0);const rs=V(-f.z,0,f.x).multiplyScalar(hand==='Right'?1:-1);
     const mouth=bones.Head.getWorldPosition(V()).addScaledVector(f,.1).add(V(0,.03,0));const th=.35+.25*smooth(.4,1,k);
     const Y=up.clone().multiplyScalar(Math.cos(th)).addScaledVector(f,-Math.sin(th)).normalize();const X=rs.clone();const Z=X.clone().cross(Y).normalize();X.copy(Y.clone().cross(Z)).normalize();
     const rimC=mouth.clone().addScaledVector(f,.035);const base=rimC.clone().addScaledVector(Y,-.09);
     const hb=bones[hand+'Hand'];const Mw=new THREE.Matrix4().makeBasis(X,Y,Z).scale(mug.getWorldScale(V())).setPosition(base);mug.updateMatrix();const Hw=Mw.multiply(mug.matrix.clone().invert());
     const hp=V(),hq=new THREE.Quaternion(),hs=V();Hw.decompose(hp,hq,hs);armIK(hand,hp,sidePole(hand),k);hb.updateMatrixWorld(true);
     const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(cq.slerp(hq,k)));hb.updateMatrixWorld(true);}};
   // the kettle hangs upright from the fist by its arched handle (the grip spec swung it up level with his face when the hand reached forward)
   /* the kettle hand is steered by its PALM: once it holds the kettle its grip point is the kettle's own (GRIP spec), so a target measured
      on the empty fist pulled the fist 8-16 cm down the frame it lifted it (27 cm after the pops filter) */
   const kPalm=pT=>{const G=window.__grab;reachTo(oth,pT,1);if(!G||!G.palmTarget)return;for(let i=0;i<3;i++){const pa=G.palmTarget(oth,G.gripPoint(oth));const e=pT.clone().sub(pa);if(e.length()<.004)break;armIK(oth,bones[oth+'Hand'].getWorldPosition(V()).add(e),sidePole(oth),1);}};
   const levelK=()=>{const k=ket();if(!k||k.parent!==bones[oth+'Hand'])return;const hb=bones[oth+'Hand'];k.updateMatrixWorld(true);const u=V(0,1,0).applyQuaternion(k.getWorldQuaternion(new THREE.Quaternion()));
    const q=new THREE.Quaternion().setFromUnitVectors(u,V(0,1,0));const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(q.multiply(cq)));hb.updateMatrixWorld(true);};
   a.post2=()=>{levelK();/* from the very frame it leaves the stove */{const G=window.__grab;const k=ket();if(G&&k){if(k.parent===bones[oth+'Hand'])G.hold(oth,k,null);else G.free&&G.free(oth);}}/* collide.js leaves the hand holding it where it is (it shoved the fist and kettle up past his face) */if(!a.ik)return;for(const [sd,t,w] of a.ik){if(!t||(w<.01&&sd!=='pour'))continue;
     if(sd==='palm'){kPalm(t);levelK();continue;}
     if(sd==='pour'){// the kettle hand: put the spout above the mug (a few corrections), then tip it round the axis across the spout
      const k=ket();if(!k||k.parent!==bones[oth+'Hand'])continue;let tgt=t.clone().addScaledVector(rgt(),oth==='Left'?-.12:.12).add(V(0,.08,0));
      const tipNow=()=>{if(a.tip<=.01)return;const hb=bones[oth+'Hand'];const sp=kSpout().sub(hb.getWorldPosition(V())).setY(0).normalize();const ax=sp.clone().cross(V(0,1,0)).normalize();
       const q=new THREE.Quaternion().setFromAxisAngle(ax,-a.tip*w);const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(q.multiply(cq)));hb.updateMatrixWorld(true);};
      // the spout is steered onto the rim WITH the kettle tipped (a few corrections of the fist), height included: never lifted above the chest
      /* the fist carried from where it lifted the kettle off the ring, low, over to the mug; the spout error is folded into a target kept
       from frame to frame (one gentle correction a frame: steady, no pop, no jitter) */
      const k0=a.k0||tgt;const base=k0.clone().lerp(tgt,w);a.pe=a.pe||V();
      {const pt=base.clone().add(a.pe);reachTo(oth,k0,1-w);/* the stoop he reached the ring with straightens as the kettle comes in (no snap upright) */if(a.pa0)kPalm(a.pa0.clone().add(pt.clone().sub(a.k0)));else reachGrip(oth,pt,1);levelK();tipNow();k.updateMatrixWorld(true);const e=t.clone().sub(kSpout());if(e.length()>.3)e.setLength(.3);a.pe.addScaledVector(e,.35*w);if(a.pe.length()>.5)a.pe.setLength(.5);}
      continue;}
     reachGrip(sd,t,w);if(sd===oth)levelK();}};
   a.leave=cb=>{try{window.__grab&&window.__grab.free(oth);}catch(e){}try{if(ket()&&ket().parent!==ket().userData.home.parent)P.release('kettle');}catch(e){}if(!H.hold[hand]){cb();return;}a.t=0;a.ik=null;
    const back=()=>{a.step='approach';a.t=0;a.ik=null;approachTo(a,rest.mug.clone(),.42,()=>{a.step='putmug';a.t=0;});a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}a.ik=[[hand,cupAt().lerp(rest.mug.clone().add(V(0,.05,0)),smooth(0,.7,a.t)),1-smooth(.9,1.4,a.t)]];
     if(a.t>.75&&H.hold[hand]){release(hand);park(mug,rest.mug);}if(a.t>1.4){a.ik=null;cb();}};};
    if(root.position.distanceTo(N.sink.p)>.8){a.step='go';a.update=()=>{};play(IDLE(),{fade:.4});goTo('sink',back);}else back();};return a;},
  wash:(o)=>dishesAction(o),/* the old gesture: the real dishes job now */
  look:()=>{const a={step:'go'};goTo('deck',()=>{a.step='look';a.t=0;play(IDLE(),{fade:.6});});a.update=dt=>{if(a.step!=='look')return;a.t+=dt;H.face=N.deck.face;
    const sweep=Math.sin(a.t*.25)*6;H.look=root.position.clone().add(V(sweep,1.2+Math.sin(a.t*.13)*.6,8));H.lookW=.8;};a.leave=cb=>cb();return a;},
  window:()=>{const a={step:'go'};const wn=pick(WINDOWS.filter(w=>Math.abs(N[w].p.y-root.position.y)<.8))||'bwin';goTo(wn,()=>{a.step='look';a.t=0;play(IDLE(),{fade:.6});});
   a.update=dt=>{if(a.step!=='look')return;a.t+=dt;H.face=N[wn].face??0;H.look=root.position.clone().add(V(Math.sin(a.t*.3)*3,1.6,6));H.lookW=.9;};a.leave=cb=>cb();return a;},
  sleep:(o={})=>{const a={step:'go'};if(o.inBed){a.step='sleep';a.update=dt=>{};a.leave=cb=>getUp(cb);return a;}goTo('bed_app',()=>{a.step='in';lieDown(()=>{a.step='sleep';});});
   a.update=dt=>{};a.leave=cb=>{if(a.step==='go'){cb();return;}getUp(cb);};return a;},
  guard:()=>{const a={};const sp=ctx.guardSpot?ctx.guardSpot():'ledge';H.guardAt=sp;goTo(sp,()=>{H.state='work';play('231');H.face=N[sp]?.face??0;});a.leave=cb=>cb();return a;},
  repair:()=>{const a={};const b=ctx.brokenBoard&&ctx.brokenBoard();if(!b){H.task=null;return a;}goTo(ctx.WIN_NODE[b.group],()=>{a.go=1;a.t=0;grabTool('benchHammer','Right');});
   a.update=dt=>{if(!a.go)return;a.t+=dt;play(has('hy_hammer')?'hy_hammer':'128');if(Math.floor(a.t*2.2)!==Math.floor((a.t-dt)*2.2))sfx&&sfx.hammer&&sfx.hammer();if(a.t>2.4){ctx.repairBoard(b);releaseTool('Right');H.task=null;act=null;}};a.leave=cb=>{if(H.hold.Right)releaseTool('Right');cb();};return a;},
 };
 // ===================== everyday jobs (Brain task names) =====================
 // one framework: walk to the spot (graph node, then a short slide up to the work point), optionally take tools from their
 // home (hand IK to the hook / shelf, real attach to the hand bone), work for a while with small variations (pause, look
 // round, scratch, stretch, sigh), put the tools back, end by itself. Props / lights / audio hooks are all optional.
 const PT=(n)=>{try{const P=window.__props||P3;return P&&P.point?P.point(n):null;}catch(e){return null;}};
 const AU=(n,pos)=>{try{window.__audio&&window.__audio.play&&window.__audio.play(n,pos);}catch(e){}};
 const toolHome=n=>{try{const P=window.__props||P3;return P&&P.toolHome?P.toolHome(n,V()):null;}catch(e){return null;}};
 const hasTool=n=>{const P=window.__props||P3;return !!(P&&P.tools&&P.tools[n]);};
 // slide the last bit up to a work point and face it
 // the spot must leave room for his head (a low eave, a roof edge, a beam): step back from the work until it does
 function headroom(q,ux,uz){const C=window.__collide;if(!C||!C.depthAt)return;const hit=(x,z)=>{for(const hy of [1.5,1.68,1.82])for(const f of [0,.12])if(C.depthAt(x+ux*f,q.y+hy,z+uz*f)>.005)return true;return false;};
  if(!hit(q.x,q.z))return;for(let b=.1;b<=.9;b+=.1){for(const sd of [0,.15,-.15]){const x=q.x-ux*b-uz*sd,z=q.z-uz*b+ux*sd;if(!hit(x,z)){const t=V(x,q.y,z);pushOut(t);if(!hit(t.x,t.z)){q.x=t.x;q.z=t.z;return;}}}}}
 function approachTo(a,sp,stand,then){const p=root.position;const dx=sp.x-p.x,dz=sp.z-p.z,d=Math.hypot(dx,dz)||1e-3;H.face=a.faceYaw!=null?a.faceYaw:Math.atan2(dx,dz);/* faceYaw: the job's own facing (a window pane), turned to during the slide, not on the spot after it */
  const move=Math.max(0,Math.min(1.2,d-stand));const q=p.clone().add(V(dx/d*move,0,dz/d*move));pushOut(q);headroom(q,dx/d,dz/d);const dur=Math.max(.3,move/.8,Math.abs(wrapA(H.face-root.rotation.y))/2.4);/* never faster than ~140 deg/s */
  const mv=Math.hypot(q.x-p.x,q.z-p.z);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(H.face-root.rotation.y),k:0,d:dur};if(mv>.35){/* a real step over there: face the way he goes, turn to the work at the end (no gliding sideways) */const yT=Math.atan2(q.x-p.x,q.z-p.z);H.slide.y0=root.rotation.y;H.slide.yT=root.rotation.y+wrapA(yT-root.rotation.y);H.slide.yF=H.slide.yT+wrapA(H.face-yT);
   /* WALK: three phases with their own time: turn toward the spot (<=150 deg/s, it used to be 30% of the slide: up to 380 deg/s), step there, turn to the work */
   const t1=Math.abs(wrapA(yT-root.rotation.y))/2.6,t2=mv/.8,t3=Math.abs(wrapA(H.face-yT))/2.6;H.slide.d=Math.max(dur,t1+t2+t3);H.slide.a=t1/H.slide.d;H.slide.b=(t1+t2)/H.slide.d;}if(move>.08)play('30',{fade:.3,speed:1});else if(H.cur&&H.cur===actions['30']&&!window.__keepWalk)play(IDLE(),{fade:.3});/* already there: the route's walk does not go on in place */
  a.step='approach';a.t=0;a.next=()=>{play(IDLE(),{fade:.4});then();};a.adur=H.slide.d;}
 // WALK: stop where the work is. The route is a graph walk to the node nearest the work; that node is often past the work
 // (the hero walked by the door bolt, on to the node, then spun 190 deg and walked back). When the work comes within reach on
 // the same floor and the rest of the route would only take him away and back, the walk ends right there, at the stand point.
 function cutShort(a,s,stand){const p=root.position;const last=H.path[H.path.length-1];if(last.node!==a.nn||H.path.some(x=>x.t==='ladder'))return;
  const np=N[a.nn]&&N[a.nn].p;if(!np||N[a.nn].tight||Math.abs(np.y-p.y)>.3)return;
  const dx=s.x-p.x,dz=s.z-p.z,d=Math.hypot(dx,dz);if(d>stand+.9||d<1e-3)return;
  let L=0,c=p;for(const x of H.path){const q=N[x.node]&&N[x.node].p;if(!q)return;L+=Math.hypot(q.x-c.x,q.z-c.z);c=q;}
  const move=Math.max(0,d-stand);if(L<move+.6)return;
  const q=p.clone().add(V(dx/d*move,0,dz/d*move));pushOut(q);headroom(q,dx/d,dz/d);q.y=p.y;if(!segClear(p,q))return;
  a.cut=1;N.__stand={p:q};H.path=[{node:'__stand',t:last.t}];const th=H.then;H.then=()=>{H.node=a.nn;th&&th();};}
 // meal: how far reachTo / reachGrip may bend the spine towards a far point (seated at a table: a little); the helpers are the kitchen / outdoor ones
 let REACH_LEAN=.6;
 // ===================== eating (HERO-RULES 2): one seated action, the plate and the spoon move only in his hands =====================
 // take the plate off the stove with the left hand, three scoops from the pan with the spoon, walk to the barrel table, sit on the
 // stool half turned (legs beside the barrel, never into it), set the plate down by hand, spoon from the plate to the mouth (code:
 // scoop, lift, into the mouth, chew), rests between bites, spoon back on the plate, plate in the left hand, up, plate into the basin.
 const espoon=sh((()=>{const g=new THREE.Group();const m=new THREE.MeshStandardMaterial({color:0xB9B5AC,roughness:.35,metalness:.6});
  const h=new THREE.Mesh(new THREE.CylinderGeometry(.0035,.005,.15,6),m);h.position.y=.03;g.add(h);
  const s=new THREE.Mesh(new THREE.SphereGeometry(.02,10,8),m);s.scale.set(1,1.35,.32);s.position.y=.12;g.add(s);return g;})());
 espoon.visible=false;scene.add(espoon);const ESP={tip:V(0,.12,0)};
 // head axes from the neck->head line (the same on both rigs; HeadTop_End points elsewhere on the detailed one) and the hips' facing
 function headUp(){const n=bones.Neck.getWorldPosition(V());return bones.Head.getWorldPosition(V()).sub(n).normalize();}
 function headFwd(){const u=headUp();const f=hipsFwd().clone();f.addScaledVector(u,-f.dot(u));return f.normalize();}
 function mouthPt(){const p=bones.Head.getWorldPosition(V());return p.addScaledVector(headUp(),.045).addScaledVector(headFwd(),.085);}
 function palmPt(side){const G=window.__grab;return G&&G.gripPoint?G.gripPoint(side):bones[side+'Hand'].getWorldPosition(V());}
 // a hero-side item held in the fist (origin = grip, +y = its working end): hand turned so the item points at tip, fist on gp
 function holdItemAt(side,o,gp,tip,w){const hb=bones[side+'Hand'];if(!o||o.parent!==hb||w<.01)return;
  const ua=V(0,1,0).applyQuaternion(o.quaternion).normalize();const gl=o.position.clone();
  const bas=(x,y)=>{const X=x.clone().normalize();const Y=y.clone().sub(X.clone().multiplyScalar(y.dot(X)));if(Y.lengthSq()<1e-6)Y.set(0,1,0).sub(X.clone().multiplyScalar(X.y));Y.normalize();return new THREE.Matrix4().makeBasis(X,Y,X.clone().cross(Y));};
  const W=tip.clone().sub(gp).normalize();let Fw=gp.clone().sub(bones[side+'ForeArm'].getWorldPosition(V())).normalize();
  for(let it=0;it<2;it++){const Qh=new THREE.Quaternion().setFromRotationMatrix(bas(W,Fw).multiply(bas(ua,V(0,1,0)).transpose()));
   const sc=hb.getWorldScale(V()).x;const wrist=gp.clone().sub(gl.clone().multiplyScalar(sc).applyQuaternion(Qh));
   armIK(side,wrist,sidePole(side),w);const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cur=hb.getWorldQuaternion(new THREE.Quaternion());
   hb.quaternion.copy(pq.invert().multiply(cur.slerp(Qh,w)));hb.updateMatrixWorld(true);Fw=hb.getWorldPosition(V()).sub(bones[side+'ForeArm'].getWorldPosition(V())).normalize();}}
 // a key-framed path: [[u, value]...] (value: Vector3), smooth between keys
 function keyed(K,u){if(u<=K[0][0])return K[0][1].clone();for(let i=1;i<K.length;i++)if(u<=K[i][0]){const k=smooth(K[i-1][0],K[i][0],u);return K[i-1][1].clone().lerp(K[i][1],k);}return K[K.length-1][1].clone();}
 function eatAction(o={}){const a={step:'go',t:0,T:0};const P=PP();
  const KT_=P&&P.surfaces&&P.surfaces.kitchenTable;const S0=KT_&&PT('eatSeat');const pl=P&&P.tools&&P.tools.plate;
  if(!S0||!pl){a.update=()=>endTask({ok:false});return a;}
  const face=KT_.face??-Math.PI/2;const F=fwd(face);const seat={p:S0.clone().setY(lv.KT),face,seat:S0.y,sit:true,floor:floorTop(lv.KT,S0.x,S0.z),node:'kmid'};
  const standPt=seat.p.clone().sub(rotY(V(sdEnd.x,0,sdEnd.z),face));
  // the stool sits between its stand point and the room: walk on and off round the front of it, never through it
  const rtF=V(-F.z,0,F.x);const kmP=N.kmid?N.kmid.p:standPt;const sideK=Math.sign((kmP.x-seat.p.x)*rtF.x+(kmP.z-seat.p.z)*rtF.z)||1;
  const toK=V(kmP.x-seat.p.x,0,kmP.z-seat.p.z).normalize();const wayPt=seat.p.clone().addScaledVector(F,.4).addScaledVector(toK,.45);/* in front of the stool, on the room side */
  // the plate's spot on the barrel top: on the line from the table centre towards his chest, 17 cm out
  const tableC=PT('eatTable');const chest0=seat.p.clone().addScaledVector(F,.07);const toMe=V(chest0.x-tableC.x,0,chest0.z-tableC.z).normalize();
  const plateSpot=V(tableC.x,KT_.top+.002,tableC.z).addScaledVector(toMe,.2);/* near his edge of the top: he eats sitting up, not folded over */
  const pan=PT('pan')||PT('pot');const home=toolHome('plate')||pan;const sinkP=PT('sink');
  const bites=Math.round(rnd(7,10));let food=1;a.bite=0;
  pl.visible=true;a.plate='home';a.spoon='plate';a.wL=0;a.wR=0;a.tw=0;
  try{P.plate&&P.plate.setFood&&P.plate.setFood(0);}catch(e){}
  // the spoon lies on the plate at the start (on the rim, handle out)
  const spoonOnPlate=()=>{pl.add(espoon);const s=1/pl.getWorldScale(V()).x;espoon.scale.setScalar(s);espoon.position.set(.05,.03,.0).multiplyScalar(1);espoon.rotation.set(Math.PI/2,0,-Math.PI/2+.3);espoon.visible=true;if(H.hold.Right===espoon)H.hold.Right=null;a.spoon='plate';};
  spoonOnPlate();
  const spoonToHand=()=>{grab(espoon,'Right',[0,.075,.025],[0,0,-Math.PI/2]);a.spoon='hand';};
  // the plate rides on the left palm, level, rim in the fingers (it moves only with the hand)
  const shL=()=>bones.LeftArm.getWorldPosition(V());
  const palmFor=c=>{const s=shL();const d=V(c.x-s.x,0,c.z-s.z);if(d.lengthSq()<1e-6)d.copy(fwd(root.rotation.y));d.normalize();return c.clone().addScaledVector(d,-.075).add(V(0,.028,0));};
  const plateOnHand=()=>{const P2=palmPt('Left');const s=shL();const d=V(P2.x-s.x,0,P2.z-s.z);if(d.lengthSq()<1e-6)d.copy(fwd(root.rotation.y));d.normalize();if(pl.parent!==scene)scene.attach(pl);pl.position.copy(P2).addScaledVector(d,.075).add(V(0,-.028,0));pl.rotation.set(0,root.rotation.y,0);pl.scale.setScalar(1);};
  const plateDown=(p)=>{if(pl.parent!==scene)scene.attach(pl);pl.position.copy(p);pl.rotation.set(0,face,0);pl.scale.setScalar(1);};
  const rimL=()=>palmFor(pl.getWorldPosition(V()));
  const spoonPt=()=>espoon.getWorldPosition(V());
  const say=s=>{a.step=s;a.t=0;};
  // 1) to the stove, the left hand takes the plate
  // he stands facing the middle between the plate and the pan: the plate a little to his right, the pan a little to his left
  const mid=home.clone().lerp(pan,.5);const plateHold=()=>{const me=root.position;const tw=V(me.x-mid.x,0,me.z-mid.z).normalize();return pan.clone().lerp(home,.55).addScaledVector(tw,.16).setY(pan.y+.1);};
  const nn=nearNode(mid);const go1=()=>approachTo(a,mid,.5,()=>{say('take');H.look=home;H.lookW=.9;});if(nn)goTo(nn,go1);else go1();
  const upd=dt=>{a.t+=dt;
   if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
   if(a.step==='take'){if(a.t>.7&&a.plate==='home'){a.plate='hand';AU('cloth');}if(a.t>1.3){say('spoon');}return;}
   if(a.step==='spoon'){H.look=pl.getWorldPosition(V());H.lookW=.9;if(a.t>.55&&a.spoon==='plate'){spoonToHand();}if(a.t>.9){say('serve');a.sc=0;}return;}
   if(a.step==='serve'){H.look=pan;H.lookW=.9;const n=Math.floor(a.t/1.35);if(n!==a.sc){a.sc=n;try{P.plate.setFood(Math.min(1,n/3));}catch(e){}AU('scrape',pan);}if(a.t>=4.05){say('spoonback');}return;}
   if(a.step==='spoonback'){H.look=pl.getWorldPosition(V());if(a.t>.5&&a.spoon==='hand'){spoonOnPlate();}if(a.t>.85){say('go2');play(IDLE(),{fade:.4});
     goTo('kmid',()=>approachTo(a,wayPt,0,()=>{say('go2');approachTo(a,standPt.clone().addScaledVector(F,1),1,()=>{say('sit');sitDown(seat,()=>{say('place');play(has('mc_stoolidle')?'mc_stoolidle':has('33')?'33':SITIDLE,{fade:.5});/* straight onto the upright stool idle: the generic sit idle leans him back while he sets the plate down */});});}));}return;}
   if(a.step==='go2'||a.step==='sit'){H.look=null;return;}
   if(a.step==='place'){H.look=plateSpot.clone().add(V(0,.15,0));H.lookW=.55;if(a.t>.9&&a.plate==='hand'){a.plate='table';plateDown(plateSpot);AU('cup',plateSpot);}if(a.t>1.3){say('pick');}return;}
   if(a.step==='pick'){H.look=plateSpot.clone().add(V(0,.15,0));H.lookW=.55;if(a.t>.6&&a.spoon==='plate')spoonToHand();if(a.t>1){say('eat');a.cyc=0;a.T=0;a.cu=0;a.per=rnd(2.6,3.3);a.rest=0;play(has('mc_stoolidle')?'mc_stoolidle':has('33')?'33':SITIDLE,{fade:.8});}return;}/* '33' (Mixamo seated idle): the Hunyuan sit idle folds the chest back over the stool on this rig */
   {const B=actions.mc_stoolidle;if(B&&H.cur===B&&/^(place|pick|eat|putspoon|lift)$/.test(a.step)){a.T2=(a.T2||0)+dt;B.time=.3+.28*Math.sin(a.T2*.9);}}
   if(a.step==='eat'){a.T+=dt;/* the CMU stool clip slumps forward from 1.0 s to 4.4 s; keep it in its upright, breathing window (0-0.6 s) */if(a.rest>0){a.rest-=dt;H.look=a.restLook;H.lookW=.6;if(a.rest<=0){a.cu=0;a.per=rnd(2.6,3.3);}return;}
    a.cu+=dt/a.per;if(a.cu>=1){a.cu=0;a.cyc++;a.per=rnd(2.5,3.4);if(a.cyc>=bites){say('putspoon');return;}if(Math.random()<.22){a.rest=rnd(2,4);a.restLook=root.position.clone().addScaledVector(F,rnd(1.5,3)).addScaledVector(V(-F.z,0,F.x),rnd(-1.6,1.2)).add(V(0,rnd(.9,1.5),0));/* out of the window / across the room, never behind him */}}
    if(a.cu>.55&&!a.bit){a.bit=1;food=Math.max(0,1-(a.cyc+1)/bites);try{P.plate.setFood(food);}catch(e){}}if(a.cu<.1)a.bit=0;
    H.look=a.cu<.32||a.cu>.85?plateSpot.clone().add(V(0,.18,0)):mouthPt().addScaledVector(headFwd(),.6).add(V(0,-.12,0));H.lookW=.6;/* eyes down to the plate, not the whole chest folded over it */return;}
   if(a.step==='putspoon'){H.look=plateSpot;if(a.t>.6&&a.spoon==='hand')spoonOnPlate();if(a.t>1){say('lift');}return;}
   if(a.step==='lift'){if(a.t>.6&&a.plate==='table'){a.plate='hand';}if(a.t>.9){say('up');H.look=null;standUp(seat,()=>{H.node=seat.node;/* this standUp names only the chair and the bed */say('go3');H.look=null;approachTo(a,wayPt,0,()=>{say('go3');const n2=N.sink?'sink':nearNode(sinkP);const g=()=>approachTo(a,sinkP,.42,()=>{say('drop');});if(n2)goTo(n2,g);else g();});});}return;}
   if(a.step==='go3'||a.step==='up'){H.look=null;return;}
   if(a.step==='drop'){H.look=sinkP;H.lookW=.9;if(a.t>.8&&a.plate==='hand'){a.plate='home';try{P.release('plate');pl.visible=false;P.dishes&&P.dishes.setDirty(P.dishes.state().dirty+1);}catch(e){}espoon.visible=false;espoon.parent&&espoon.parent.remove(espoon);scene.add(espoon);AU('cup',sinkP);}
    if(a.t>1.3)endTask({ok:true});return;}};
  // the eyes move between targets with a short glide, never a jump
  a.update=dt=>{upd(dt);if(H.task!=="eat")return;const L=H.look;if(L&&L.isVector3){if(!a.lk)a.lk=L.clone();else a.lk.lerp(L,1-Math.exp(-dt*7));H.look=a.lk.clone();}else a.lk=null;};
  // hand targets glide too (a switch of target is a move, not a jump)
  const glide=(key,v,dt,k=12,from)=>{if(!a[key]){a[key]=(from||v).clone();}a[key].lerp(v,1-Math.exp(-dt*k));return a[key];};
  // hands (contacts slot): weights ramp, never snap
  a.post=dt=>{const st=a.step;const k=x=>Math.min(1,x);REACH_LEAN=H.seated===seat||st==='sit'||st==='up'?.12:.3;/* he never folds over the plate: the plate comes to him */try{post2(dt);}finally{REACH_LEAN=.6;}};
  const post2=dt=>{const st=a.step;
   const wantL=a.plate==='hand'||st==='take'&&a.t<.7||st==='place'||st==='lift'||(st==='eat'||st==='pick'||st==='putspoon');
   const wantR=a.spoon==='hand'||(st==='spoon'&&a.t<.55)||(st==='pick'&&a.t<.6)||(st==='putspoon')||(st==='spoonback');
   a.wL+=((wantL?1:0)-a.wL)*Math.min(1,dt*3.5);a.wR+=((wantR?1:0)-a.wR)*Math.min(1,dt*3.5);
   const f=fwd(root.rotation.y),up=V(0,1,0),rt=V(-f.z,0,f.x);const hp=bones.Hips.getWorldPosition(V());
   // sitting down / getting up: the sit clip folds the chest far over the thighs (70 deg, head into the barrel); a person lowering onto
   // a stool keeps the chest within ~25 deg of upright: tip the spine back by the excess
   if(st==='sit'||st==='up'){const n0=bones.Neck.getWorldPosition(V());const v=n0.sub(hp);const lv=V(v.x,0,v.z);const ang=Math.atan2(lv.length(),Math.max(1e-3,v.y));const lim=.42;
    if(ang>lim&&lv.lengthSq()>1e-6){const ax=up.clone().cross(lv.normalize()).normalize();const ex=-(ang-lim);rotW(bones.Spine,ax,ex*.45);rotW(bones.Spine1,ax,ex*.35);rotW(bones.Spine2,ax,ex*.2);}}
   // seated: turn the chest to the plate and lean in a little (before any hand is placed)
   const seated=H.seated===seat&&(st==='place'||st==='pick'||st==='eat'||st==='putspoon'||st==='lift');a.tw+=((seated?1:0)-a.tw)*Math.min(1,dt*3);
   if(a.tw>.01){const c=plateSpot.clone();const d=V(c.x-hp.x,0,c.z-hp.z).normalize();const hf=hipsFwd();let ang=Math.atan2(hf.x*d.z-hf.z*d.x,hf.x*d.x+hf.z*d.z);/* +: to his left */
    const th=-clamp(ang*.7,-.75,.75)*a.tw;/* yaw about +y that turns the chest to the plate */for(const [b,s] of [['Spine',.35],['Spine1',.35],['Spine2',.3]])rotW(bones[b],up,th*s);rotW(bones.Neck,up,-th*.85);
    const ax=up.clone().cross(d).normalize();const bite=st==='eat'&&!a.rest?smooth(.3,.5,a.cu)*(1-smooth(.68,.85,a.cu)):0;const lean=(.06+.07*bite+(st==='place'||st==='pick'||st==='lift'?.04:0))*a.tw;/* the chest goes over the thighs when the hands go to the table */rotW(bones.Spine,ax,lean*.5);rotW(bones.Spine1,ax,lean*.3);rotW(bones.Spine2,ax,lean*.2);
    if(st==='eat'&&a.cu>.68&&a.cu<.98&&!a.rest){const ch=Math.sin((a.cu-.68)*Math.PI*2*5)*.03*(1-smooth(.85,.98,a.cu));rotW(bones.Head,rt,ch);}/* chewing */}
   // left hand
   if(a.wL>.01){let t=null;
    const carry=hp.clone().addScaledVector(f,.3).addScaledVector(rt,-.1).add(V(0,H.seated||st==='sit'?.3:.12,0));
    if(st==='take'&&a.plate==='home'){t=palmFor(home);}
    else if(st==='place'&&a.plate==='hand'){t=carry.lerp(palmFor(plateSpot),smooth(.05,.8,a.t));}
    else if(st==='lift'&&a.plate==='table'){t=rimL();}
    else if(st==='lift'){t=rimL().lerp(carry,smooth(.6,.9,a.t));}
    else if(a.plate==='table'){t=rimL();}
    else if(a.plate==='hand'){t=carry;if(st==='serve'||st==='spoon'||st==='spoonback')t=palmFor(plateHold());if(st==='spoonback')t=palmFor(plateHold()).lerp(carry,smooth(.4,.85,a.t));if(st==='take')t=palmFor(home).lerp(palmFor(plateHold()),smooth(.7,1.25,a.t));if(st==='drop')t=carry.lerp(palmFor(sinkP.clone().add(V(0,.03,0))),smooth(0,.75,a.t));}
    if(t)reachGrip('Left',glide('gL',t,dt,12,palmPt('Left')),a.wL);}else a.gL=null;
   if(a.plate==='hand')plateOnHand();
   // right hand with the spoon
   if(a.wR>.01){const pc=pl.getWorldPosition(V());let gp=null,tip=null,free=null;
    if(a.spoon!=='hand'){/* reaching for the spoon lying on the plate / putting it there */free=spoonPt().add(V(0,.02,0));}
    else if(st==='serve'){const u=(a.t%1.35)/1.35;const toPl=pc.clone().add(V(0,.05,0));const inPan=pan.clone().add(V(0,.02,0));
     gp=keyed([[0,toPl.clone().add(V(0,.1,0))],[.35,inPan.clone().add(V(0,.11,0))],[.55,inPan.clone().add(V(0,.1,0)).addScaledVector(rt,.04)],[.85,toPl.clone().add(V(0,.11,0))],[1,toPl.clone().add(V(0,.1,0))]],u);
     tip=keyed([[0,toPl],[.35,inPan],[.55,inPan.clone().addScaledVector(rt,.05)],[.85,toPl],[1,toPl]],u);}
    else if(st==='eat'&&!a.rest){const u=a.cu;const m=mouthPt();const hf=headFwd();hf.y=Math.min(hf.y,0);hf.normalize();
     const p0=pc.clone().add(V(0,.012,0));const tow=V(hp.x-pc.x,0,hp.z-pc.z).normalize();const side=Math.sin(a.cyc*2.3)*.03;
     const s0=p0.clone().addScaledVector(tow,-.04).addScaledVector(rt,side),s1=p0.clone().addScaledVector(tow,.04).addScaledVector(rt,side);
     const mIn=m.clone().addScaledVector(hf,-.01),mOut=m.clone().addScaledVector(hf,.11).add(V(0,-.04,0));
     tip=keyed([[0,s0.clone().add(V(0,.03,0))],[.12,s0],[.3,s1],[.5,mOut.clone().addScaledVector(hf,-.03)],[.58,mIn],[.66,mIn],[.76,mOut.clone().addScaledVector(hf,.03)],[1,s0.clone().add(V(0,.03,0))]],u);
     gp=tip.clone().add(keyed([[0,tow.clone().multiplyScalar(.1).add(V(0,.07,0))],[.3,tow.clone().multiplyScalar(.11).add(V(0,.06,0))],[.5,hf.clone().multiplyScalar(.12).add(V(0,-.05,0))],[.66,hf.clone().multiplyScalar(.12).add(V(0,-.05,0))],[.8,hf.clone().multiplyScalar(.1).add(V(0,-.08,0))],[1,tow.clone().multiplyScalar(.1).add(V(0,.07,0))]],u));}
    else{/* between bites / resting: the spoon rests over the plate edge */const c=pc.clone().addScaledVector(rt,.06).add(V(0,.03,0));tip=c;gp=c.clone().add(V(0,.08,0)).addScaledVector(V(hp.x-pc.x,0,hp.z-pc.z).normalize(),.08);}
    a.hw=(a.hw||0)+((gp?1:0)-(a.hw||0))*Math.min(1,dt*5);
    const tgt=glide('gR',gp||free,dt,st==='eat'?16:10,palmPt('Right'));if(gp){const tt=glide('gT',tip,dt,16);reachGrip('Right',tgt,a.wR*(1-a.hw));holdItemAt('Right',espoon,tgt,tt,a.wR*a.hw);}else{a.gT=null;reachGrip('Right',tgt,a.wR);}}
   else{a.gR=null;a.gT=null;}
  };
  a.leave=cb=>{try{P.release('plate');}catch(e){}espoon.visible=false;if(H.hold.Right===espoon)H.hold.Right=null;espoon.parent&&espoon.parent.remove(espoon);scene.add(espoon);a.post=null;
   if(H.seated===seat||a.step==='place'||a.step==='pick'||a.step==='eat'||a.step==='putspoon'||a.step==='lift'){standUp(seat,()=>{H.node=seat.node;cb();});}else cb();};
  return a;}
 // ===================== dishes by hand (HERO-RULES 2) =====================
 // facing the basin: dry pieces from the rack go up onto the shelf first (one at a time, a hand on each), then every dirty piece:
 // the right hand lifts it out of the basin, the left holds it under the running tap, the right scrubs it (small circles), it turns
 // clean, the left stands it in the rack. Nothing moves unless a hand holds it.
 function dishesAction(o={}){const a={step:'go',t:0,T:0};const P=PP();const D=P&&P.dishes;const sinkP=PT('sink');
  if(!D||!D.take||!sinkP){a.update=()=>endTask({ok:false});return a;}
  const tapP=PT('tap')||sinkP.clone().add(V(0,.22,-.1));const shelfP=PT('dishShelf');
  a.wL=0;a.wR=0;a.n=0;a.piece=null;let lk=null;
  const say=s=>{a.step=s;a.t=0;};const sh0=()=>bones.LeftArm.getWorldPosition(V());
  const face2=()=>{const f=fwd(root.rotation.y);return f;};
  const nn=N.sink?'sink':nearNode(sinkP);const go=()=>approachTo(a,sinkP,.36,()=>{play(IDLE(),{fade:.6});next();});if(nn)goTo(nn,go);else go();
  // what next: dry ones up to the shelf (at most 2 a visit), then the dirty ones
  function next(){const st=D.state();if(false&&st.rack>0&&(a.up||0)<2&&shelfP&&!(st.dirty>0&&Math.random()<.5)){/* the wall shelf is 0.8 m over his shoulder and 0.65 m past the counter: out of reach by hand, so the clean dishes stay stood in the plate rack (their place) */a.up=(a.up||0)+1;a.kind='shelf';say('reachR');return;}
   if(st.dirty>0&&a.n<4){a.kind='wash';say('reachR');return;}
   if(a.tapOn){try{P.water.tap(false);}catch(e){}a.tapOn=false;}say('end');}
  const pieceAt=(c,q)=>{const p=a.piece;if(!p)return;const ob=p.show;if(ob.parent!==scene)scene.attach(ob);ob.position.copy(c);ob.quaternion.copy(q);ob.scale.setScalar(1);ob.visible=true;};
  // where a piece sits in the left hand: in front of him under the tap, tilted towards him
  const holdC=()=>{const f=face2();const r=V(-f.z,0,f.x);const c=tapP.clone();c.y=sinkP.y+.15;return c.addScaledVector(f,-.09).addScaledVector(r,-.02);};
  const holdQ=()=>new THREE.Quaternion().setFromEuler(new THREE.Euler(-.9,root.rotation.y,0,'YXZ'));
  a.update=dt=>{a.t+=dt;a.T+=dt;
   if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
   if(a.step==='reachR'){// right hand to the piece (basin or rack)
    const from=a.kind==='shelf'?'rack':'dirty';const st=D.state();if((from==='rack'?st.rack:st.dirty)<=0){next();return;}
    if(a.t>.7){const p=D.take(from);if(!p){next();return;}a.piece={...p,show:from==='rack'?p.clean:p.obj,from};a.n+=from==='dirty'?1:0;
     a.p0=a.piece.show.getWorldPosition(V());a.q0=a.piece.show.getWorldQuaternion(new THREE.Quaternion());AU(p.kind==='cup'?'cup':'plate',a.p0);say(a.kind==='shelf'?'lift':'totap');}return;}
   if(a.step==='totap'){if(a.t>.3&&!a.tapOn){try{P.water.tap(true);}catch(e){}a.tapOn=true;}if(a.t>.8){say('scrub');a.dur=rnd(2.6,4);}return;}
   if(a.step==='scrub'){if(a.t>a.dur*.6&&a.piece.show!==a.piece.clean){const ob=a.piece.obj;ob.visible=false;a.piece.show=a.piece.clean;}if(a.t>a.dur){say('torack');}return;}
   if(a.step==='torack'){if(a.t>.9){D.settle(a.piece.i,'rack');AU('plate',sinkP);a.piece=null;say('back');}return;}
   if(a.step==='lift'){if(a.t>1.1){say('shelf');}return;}
   if(a.step==='shelf'){if(a.t>1.0){D.settle(a.piece.i,'shelf');AU('plate',shelfP);a.piece=null;say('back');}return;}
   if(a.step==='back'){if(a.t>.35)next();return;}
   if(a.step==='end'){if(a.t>.5)endTask({ok:true});return;}};
  a.post=dt=>{const st=a.step;const f=face2(),r=V(-f.z,0,f.x),up=V(0,1,0);const hp=bones.Hips.getWorldPosition(V());
   let look=sinkP;let tR=null,tL=null;
   if(st==='reachR'){const from=a.kind==='shelf'?'rack':'dirty';const st2=D.state();const i=Array.from({length:4},(_,k)=>k).find(k=>D.where(k)===from);if(i!=null){const s=D.slot(i,from).pos;tR=s.clone().add(V(0,from==='dirty'?.05:.03,0));look=s;}
    if(a.kind==='wash')tL=holdC().addScaledVector(r,-.1).add(V(0,.07,0)).addScaledVector(f,-.06);/* waits up over the front of the basin: the elbow stays above the countertop */}
   else if(a.piece){const pc=a.piece.show;
    if(st==='totap'){const k=smooth(0,.8,a.t);const c=a.p0.clone().lerp(holdC(),k);c.y+=Math.sin(k*Math.PI)*.06;const q=a.q0.clone().slerp(holdQ(),k);pieceAt(c,q);tL=k>.5?c.clone().addScaledVector(r,-.08):holdC().addScaledVector(r,-.1).add(V(0,.07,0)).addScaledVector(f,-.06);/* the left hand waits over the basin and joins once the piece is out of it, never down into the counter */tR=c.clone().addScaledVector(r,.07);look=c;}
    else if(st==='scrub'){const c=holdC();const w=Math.sin(a.t*1.3)*.15;const q=holdQ().multiply(new THREE.Quaternion().setFromAxisAngle(V(0,0,1),w));pieceAt(c,q);
     const n=V(0,1,0).applyQuaternion(q);const ph=a.t*2*Math.PI*1.6;const e1=V(1,0,0).applyQuaternion(q),e2=V(0,0,1).applyQuaternion(q);
     tR=c.clone().addScaledVector(n,.03).addScaledVector(e1,Math.cos(ph)*.035).addScaledVector(e2,Math.sin(ph)*.035);tL=c.clone().addScaledVector(r,-.08);look=c;}
    else if(st==='torack'){const sl=D.slot(a.piece.i,'rack');const k=smooth(0,.85,a.t);const c=holdC().lerp(sl.pos,k);c.y+=Math.sin(k*Math.PI)*.05;pieceAt(c,holdQ().slerp(sl.quat,k));const top=a.piece.kind==='cup'?.05:.085;/* the fingers on the edge: the side rim while it is flat, the top rim once it stands in the rack */tL=c.clone().addScaledVector(r,-.06*(1-k)).add(V(0,.02+(top-.02)*k,0));a.relL=tL.clone();look=sl.pos;}
    else if(st==='lift'||st==='shelf'){const sl=D.slot(a.piece.i,'shelf');const k=st==='lift'?smooth(0,1.1,a.t)*.6:.6+.4*smooth(0,.9,a.t);
     const mid=a.p0.clone().lerp(sl.pos,.5).add(V(0,.15,0)).addScaledVector(f,-.12);const c=k<.6?a.p0.clone().lerp(mid,smooth(0,.6,k)):mid.clone().lerp(sl.pos,smooth(.6,1,k));a.shelfC=c;a.shelfQ=a.q0.clone().slerp(sl.quat,k);a.shelfK=k;tR=c.clone().add(V(0,-.01,0));look=c;}}
   if(st==='back'&&a.relL&&a.t<.3)tL=a.relL.clone().add(V(0,.1*smooth(0,.3,a.t),0)).addScaledVector(f,-.05*smooth(0,.3,a.t));/* let go off the top edge: up and back, never down through the plate */
   else if(st==='back'&&a.kind==='wash'){a.relL=null;tL=holdC().addScaledVector(r,-.08);}
   /* a hand with nothing to do goes back to the clip (weights ramp, the hand glides) */a.wR+=((tR?1:0)-a.wR)*Math.min(1,dt*3.5);a.wL+=((tL?1:0)-a.wL)*Math.min(1,dt*3.5);
   H.look=lk=lk?lk.lerp(look,1-Math.exp(-dt*6)):look.clone();H.lookW=.85;
   /* the hand glides to its target, lifted over the counter / basin edge on the way (never through the furniture) */
   const C=window.__collide;const clear=q=>{if(!C||!C.depthAt)return q;for(let i=0;i<20;i++){let hit=false;for(const dy of [-.04,-.015,0])if(C.depthAt(q.x,q.y+dy,q.z)>.003){hit=true;break;}if(!hit)break;q.y+=.01;}return q;};
   const gl=(k,v,from)=>{if(!a[k])a[k]=from.clone();if(v){const g=a[k];let w=v;
     g.lerp(w,1-Math.exp(-dt*12));if(g.distanceTo(v)>.03)clear(g);}return a[k];};
   REACH_LEAN=st==='shelf'||st==='lift'?.65:.3;/* at the sink he leans a little towards the rack (a little more up to the shelf), never folds over it */
   if(a.wR>.01){const t=gl('gR',tR||null,palmPt('Right'));reachGrip('Right',t,a.wR);}else a.gR=null;
   /* up to the shelf the piece rides in the palm (where the hand really is), and only the last few cm go onto the shelf board */
   if((st==='lift'||st==='shelf')&&a.piece&&a.shelfC){const pp=palmPt('Right').add(V(0,.015,0));const e=smooth(.88,1,a.shelfK);pieceAt(pp.lerp(a.shelfC,e),a.shelfQ);}
   if(a.wL>.01){const t=gl('gL',tL,palmPt('Left'));reachGrip('Left',t,a.wL);}else a.gL=null;REACH_LEAN=.6;};
  a.leave=cb=>{if(a.piece){D.settle(a.piece.i,a.piece.from==='dirty'&&a.piece.show!==a.piece.clean?'dirty':a.piece.from==='rack'?'rack':'rack');a.piece=null;}if(a.tapOn){try{P.water.tap(false);}catch(e){}}a.post=null;cb();};
  return a;}
 // KITCHEN B16: the crouch spot in front of the oven: behind the end of its open drop-door (42 cm) so knees and feet stay clear of it.
 // A short shuffle there (forward or back), facing the oven.
 function ovenSpot(a,then){const P=window.__props||P3;const o=P&&P.oven;const op=PT('oven');if(!o||!o.handle||!op){then();return;}const h0=o.handle(V());/* out of the oven: toward the room side he stands on, square to the stove */let n=V(root.position.x-h0.x,0,root.position.z-h0.z).normalize();if(N.stove&&N.stove.face!=null){const f=fwd(N.stove.face).multiplyScalar(-1);if(f.dot(n)>.3)n=f;}
  /* boards under both feet and the heels (behind the oven is the kitchen hatch): the first spot that has them, then a step aside */
  const lat=V(-n.z,0,n.x);const okAt=c=>{for(const [u,v] of [[.12,0],[-.12,0],[.12,.18],[-.12,.18],[0,-.1]]){const x=c.x+lat.x*u+n.x*v,z=c.z+lat.z*u+n.z*v;const f=floorAt(x,root.position.y,z,.32,.3);if(f==null||Math.abs(f-root.position.y)>.06)return false;}return true;};
  let q=null;for(const sd of [0,.22,-.22,.36,-.36])for(const dd of [.84,.8,.76]){if(q)break;const c=h0.clone().addScaledVector(n,dd).addScaledVector(lat,sd);c.y=root.position.y;if(okAt(c))q=c;}
  if(!q){q=h0.clone().addScaledVector(n,.62);}q.y=root.position.y;pushOut(q);const p=root.position;const face=Math.atan2(-n.x,-n.z);H.face=face;const mv=Math.hypot(q.x-p.x,q.z-p.z);
  const dur=Math.max(.35,mv/.6,Math.abs(wrapA(face-root.rotation.y))/2.4);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(face-root.rotation.y),k:0,d:dur};if(mv>.06)play('30',{fade:.25,speed:.8});
  a.step='approach';a.t=0;a.adur=dur;a.next=()=>{play(IDLE(),{fade:.35});then();};}
 // KITCHEN: crouched, slow only the idle clip (its weight shifts slide planted feet); always restored, never left on a cached action.
 function kSlow(on){try{const c=H.cur;if(on&&c&&c.getClip&&c.getClip().name===IDLE()){if(H.kTSa&&H.kTSa!==c)H.kTSa.setEffectiveTimeScale(1);c.setEffectiveTimeScale(.12);H.kTSa=c;}else if(H.kTSa){H.kTSa.setEffectiveTimeScale(1);H.kTSa=null;}}catch(e){}}
 // GRAB: the broom starts in open floor. A stooped sweeper's head and bristles reach ~0.55 m round him at 0.9-1.3 m up, so beside the
 // bunk he first steps to a spot on the same boards with that much room (his head went into the bunk as he turned in place there).
 function roomy(x,y,z){const CL=window.__collide;if(!CL||!CL.depthAt)return true;for(const r of [.3,.45,.58])for(let k=0;k<16;k++){const an=k*Math.PI/8;for(const h of [.95,1.15,1.3])if(CL.depthAt(x+Math.sin(an)*r,y+h,z+Math.cos(an)*r)>.003)return false;}return true;}
 function sweepSpot(){const p=root.position.clone();if(roomy(p.x,p.y,p.z))return p;
  for(let r=.2;r<=1.2;r+=.1)for(let k=0;k<16;k++){const an=k*Math.PI/8,x=p.x+Math.sin(an)*r,z=p.z+Math.cos(an)*r;const y=floorAt(x,p.y,z,.25,.25);if(y==null||Math.abs(y-p.y)>.04)continue;if(roomy(x,y,z))return V(x,y,z);}
  return p;}
 // squatting at a block or crate the knees go forward: he stays back so shins and feet never enter it (gate: shins 6.6 cm and
 // feet in the chopblock while the axe went back into it). job({clear:obj}) runs it in take/put too.
 function kneesClear(obj,dt){if(!obj||(H.squat||0)<.05)return;const bb=new THREE.Box3().setFromObject(obj);const bc=bb.getCenter(V());const R=Math.min(bb.max.x-bb.min.x,bb.max.z-bb.min.z)/2;let need=0;
  for(const n of ['LeftLeg','RightLeg','LeftFoot','RightFoot','LeftToeBase','RightToeBase']){const b=bones[n];if(!b)continue;const q=b.getWorldPosition(V());if(q.y>bb.max.y+.05)continue;need=Math.max(need,R+.075-Math.hypot(q.x-bc.x,q.z-bc.z));}
  if(need>0){const p=root.position;const v=V(p.x-bc.x,0,p.z-bc.z).normalize();const m=Math.min(need,.6*dt+need*.5);p.x+=v.x*m;p.z+=v.z*m;}}
 /* the belt: a tool fetched from far away is hung on his right hip when the work is done (it used to ease home across the house by
    itself); the next job that needs it takes it from there, by hand. H.belt names the tool on the belt */
 function beltPt(){const f=fwd(root.rotation.y);const r=V(-f.z,0,f.x);return bones.Hips.getWorldPosition(V()).addScaledVector(r,.17).addScaledVector(f,.03).add(V(0,-.06,0));}
 function toBelt(n,hand){const P=window.__props||P3;if(!P||!P.grab||!bones.Hips)return false;const o=P.grab(n,bones.Hips,{offset:V()});if(!o){relTool(hand,n);return false;}
  /* fixed in the pelvis' own frame (x left, y up, z forward, metres on both rigs): head up, handle down along the right thigh, tipped out a little */
  const ws=bones.Hips.getWorldScale(V()).x||1;o.quaternion.setFromAxisAngle(V(0,0,1),-.12).multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),Math.PI/2));/* head fore-and-aft, not into the hip */o.position.set(-.2/ws,-.05/ws,0);if(H.hold[hand]&&H.hold[hand].tool===n)H.hold[hand]=null;H.belt=n;return true;}
 const beltHas=n=>{const P=window.__props||P3;const o=P&&P.tools&&P.tools[n];return H.belt===n&&!!o&&o.parent===bones.Hips;};
 const farHome=n=>{const h=toolHome(n);return !!h&&h.distanceTo(root.position)>1.6;};
 function job(o){const a={step:'go',t:0,T:0,held:[],faceYaw:o.faceYaw??null};const sp0=typeof o.pt==='function'?o.pt():o.pt;
  if(!sp0&&!o.node){a.update=()=>endTask(false);return a;}
  const sp=()=>(typeof o.pt==='function'?o.pt():o.pt)||(o.node&&N[o.node]?N[o.node].p.clone().addScaledVector(fwd(N[o.node].face??0),.5).add(V(0,1,0)):root.position.clone().add(V(0,1,0)));
  const dur=o.dur?rnd(o.dur[0],o.dur[1]):(o.clip&&!o.loop&&has(o.clip)?durOf(o.clip)*(o.reps||1):8);a.jdur=dur;
  const tools=(o.tools||[]).filter(([n])=>hasTool(n));
  const begin=()=>{const tk=tools.length&&!a.fetched;a.step=tk?'take':'work';a.t=0;o.start&&o.start(a);if(!tk)work();};
  const work=()=>{a.step='work';a.t=0;if(o.clip&&has(o.clip)){if(o.loop)play(o.clip,{fade:.5,speed:o.speed||1});else once(o.clip,{fade:.45,speed:o.speed||1,then:()=>{if(a.step==='work'&&a.T<dur-1)play(o.idle&&has(o.idle)?o.idle:IDLE(),{fade:.5});}});}else play(IDLE(),{fade:.5});};
  const go=()=>{const s=sp();if(o.node){goTo(o.node,()=>{if(o.slide===false){H.face=N[o.node].face??H.face;begin();}else approachTo(a,s,o.stand??.45,begin);});}
   else{const nn=nearNode(s);a.nn=nn;if(nn)goTo(nn,()=>approachTo(a,s,o.stand??.45,begin));else approachTo(a,s,o.stand??.45,begin);}};
  /* a tool that lives somewhere else (the hammer on the workshop bench, the wrench) is fetched by walking there and taking it in the hand,
     then he goes to the work with it: never reached for from across the house (it used to fly into his hand) */
  const far=tools.length&&!beltHas(tools[0][0])&&(()=>{const h=toolHome(tools[0][0]);return h&&h.distanceTo(sp())>1.6&&h.distanceTo(root.position)>1.1;})();
  if(far){const h=toolHome(tools[0][0]);const fetch=()=>approachTo(a,h.clone().setY(root.position.y),.42,()=>{a.step='take';a.t=0;a.afterTake=()=>{a.fetched=true;a.step="go";a.t=0;go();};});const nn=nearNode(h);if(nn)goTo(nn,fetch);else fetch();}
  else go();
  a.update=dt=>{a.t+=dt;const s=sp();
   if(a.step==='go'&&!o.noCut&&!a.cut&&a.nn&&motion&&H.path.length&&!window.__noCut)cutShort(a,s,o.stand??.45);
   if(a.step==='approach'){H.look=s;{/* no owl: the work behind him (stepping away first, then turning back to it) is not looked at over the shoulder */const fw=fwd(root.rotation.y),dx=s.x-root.position.x,dz=s.z-root.position.z,dl=Math.hypot(dx,dz)||1;H.lookW=.6*smooth(.1,.7,(fw.x*dx+fw.z*dz)/dl);}/* the work starts once he has turned to it: a squat that began mid-turn swivelled on the spot, motion.js took the
     legs for the turn (standing hips) and gave them back with a 30 cm drop (fix_rope) */const sk=H.slide?H.slide.k:1;a.skN=sk===a.skL?(a.skN||0)+1:0;a.skL=sk;if(a.t>=a.adur&&(sk>=1||a.skN>2||a.t>a.adur+1.2||window.__noTurnWait)){a.next();}return;}
   if(a.step==='take'){// GRAB: step in until the tool's grip is within arm's reach, the fist onto the grip (not the tool's origin), close the hand only there
    const [n,hand]=tools[a.held.length]||[];if(!n){work();return;}const bl=beltHas(n);const h=bl?beltPt():gripHome(n)||toolHome(n)||s;H.look=bl?null:h;H.lookW=1;
    if(!a.st){a.st=1;a.pk=0;if(!bl)stepNear(h,hand);}if(H.slide&&H.slide.k<1){a.t=0;return;}
    const low=!bl&&h.y<root.position.y+.7;jobSquat(a,dt,h,hand,!a.gotIt);if(o.clear)kneesClear(o.clear,dt);/* low down: he bends his knees to it (feet stay on the boards) */
    a.rg=[hand,h,(low?smooth(.4,.85,a.t):smooth(0,.45,a.t))*(a.gotIt?1-smooth(0,.35,a.t-a.tg):1)];
    if(!a.gotIt&&a.t>(low?.8:.45)&&(palmTo(hand,h)<.06||a.t>(low?1.5:1.6))){a.gotIt=true;a.tg=a.t;grabTool(n,hand);if(H.belt===n)H.belt=null;AU('cloth');}
    if(a.gotIt&&a.t-a.tg>.4&&!(H.squat>0)){a.held.push(n);a.gotIt=false;a.t=0;a.rg=null;a.st=0;if(a.held.length>=tools.length){if(a.afterTake){const f=a.afterTake;a.afterTake=null;f();}else work();}}return;}
   if(a.step==='work'){a.T+=dt;H.look=o.look?o.look(a):s;H.lookW=o.lookW??.85;o.tick&&o.tick(a,dt);
    // small variations so a long job is never a frozen loop: pause and look round, scratch, stretch, sigh
    if(o.vary!==false&&dur>14){a.vt=(a.vt??rnd(9,16))-dt;if(a.vt<=0&&!a.pause){a.vt=rnd(10,18);const r=Math.random();
      if(r<.45){a.pause=rnd(2.5,4.5);a.pl=root.position.clone().add(V(rnd(-3,3),rnd(1.2,1.8),rnd(-3,3)));play(IDLE(),{fade:.6});}
      else if(r<.65&&has('hy_scratch'))overlay('hy_scratch',{fade:.4,speed:1.2});else if(r<.8&&has('hy_stretch'))overlay('hy_stretch',{fade:.5,speed:1.15,weight:.7});else AU('sigh',root.position);}
     if(a.pause){a.pause-=dt;H.look=a.pl;H.lookW=.7;if(a.pause<=0){a.pause=0;if(o.clip&&o.loop&&has(o.clip))play(o.clip,{fade:.6,speed:o.speed||1});else if(o.clip&&has(o.clip))once(o.clip,{fade:.45,speed:o.speed||1});}}}
    if(!o.loop&&o.clip&&o.reps&&!H.once&&!a.pause&&a.T<dur-1)once(o.clip,{fade:.4,speed:o.speed||1});
    if(a.T>=dur){a.step='put';a.t=0;o.end&&o.end(a);play(IDLE(),{fade:.5});}return;}
   if(a.step==='put'){const n=a.held[a.held.length-1];if(!n){finish();return;}const hand=(tools.find(t=>t[0]===n)||[])[1]||'Right';if(a.toBelt==null)a.toBelt=farHome(n);const bt=a.toBelt;const h=bt?beltPt():gripHome(n)||toolHome(n)||s;H.look=bt?null:h;H.lookW=1;
    /* a far home: the tool goes on the belt (right hip), no trip back across the house and no flying home */
    // GRAB: the hand carries the tool onto its hook / spot and lets go there (the release only eases the last few mm), never from afar
    if(!a.st){a.st=1;a.pk=0;if(!bt)stepNear(h,hand);}if(H.slide&&H.slide.k<1){a.t=0;return;}
    const low=!bt&&h.y<root.position.y+.7;jobSquat(a,dt,h,hand,!a.rel);if(o.clear)kneesClear(o.clear,dt);
    a.rg=[hand,h,(low?smooth(.4,.85,a.t):smooth(0,.45,a.t))*(a.rel?1-smooth(0,.35,a.t-a.tr):1)];
    if(!a.rel&&a.t>(low?.8:.45)&&(palmTo(hand,h)<.08||a.t>(low?1.5:1.6))){a.rel=true;a.tr=a.t;if(bt)toBelt(n,hand);else relTool(hand,n);}
    if(a.rel&&a.t-a.tr>.4&&!(H.squat>0)){a.held.pop();a.rel=false;a.toBelt=null;a.t=0;a.rg=null;a.st=0;}}};
  const finish=()=>{a.ik=null;H.squat=0;endTask(o.result?o.result(a):undefined);};
  a.post=dt=>{if(a.step==='work'&&o.post)o.post(a,dt);ikList(a.ik);if(a.rg&&a.rg[2]>.01)reachGrip(a.rg[0],a.rg[1],a.rg[2]);};
  a.leave=cb=>{H.squat=0;for(const n of a.held){const t=tools.find(x=>x[0]===n);const hd=t?t[1]:'Right';if(farHome(n))toBelt(n,hd);else relTool(hd,n);}a.held=[];if(a.step==='work'||a.step==='take')o.end&&o.end(a);a.ik=null;cb();};
  return a;}
 // GRAB: knees bent just enough that the shoulder is within arm's reach of a low grip, then up again (the code squat keeps the feet planted)
 function jobSquat(a,dt,h,hand,down){const sh=bones[hand+'Arm'].getWorldPosition(V());const hz=Math.hypot(sh.x-h.x,sh.z-h.z);const R0=armLen*.9+PALM-.03;
  const want=down&&h.y<root.position.y+.7&&hz<R0*.95?clamp(sh.y+(H.squat||0)-h.y-Math.sqrt(Math.max(0,R0*R0-hz*hz))+.03,0,.4):0;/* only for a grip low down and within reach sideways (it squatted at the counter for an out-of-reach knife) */const c=H.squat||0;H.squat=c+clamp(want-c,-1.1*dt,1.1*dt);if(!want&&H.squat<.012)H.squat=0;H.sqJob=H.squat>0;}
 // GRAB: a small step so the shoulder ends within ~0.36 m (level) of p: a reach, not a lean or a stretch
 function stepNear(p,hand){const sh=bones[hand+'Arm'];if(!sh||!p)return;const s0=sh.getWorldPosition(V());const d=V(p.x-s0.x,0,p.z-s0.z);const L=d.length();if(L<=.4)return;
  const q=root.position.clone().addScaledVector(d.normalize(),Math.min(.6,L-.34));pushOut(q);const mv=Math.hypot(q.x-root.position.x,q.z-root.position.z);if(mv<.04)return;
  {const p=root.position;for(const k of [.5,1]){const x=p.x+(q.x-p.x)*k,z=p.z+(q.z-p.z)*k;const y=floorAt(x,p.y+.2,z,.3,.5);if(y==null||Math.abs(y-p.y)>.04)return;}}/* only on the same floor: never a step off an edge or onto a ledge */
  H.slide={x:q.x-root.position.x,z:q.z-root.position.z,yaw:0,k:0,d:Math.max(.4,mv/.6)};if(mv>.12)play('30',{fade:.25,speed:.9});}
 function relTool(hand,n){const P=window.__props||P3;try{if(P&&P.release)P.release(n,{blend:.35});}catch(e){}if(H.hold[hand]&&H.hold[hand].tool===n)H.hold[hand]=null;}
 function teleParts(){const P=window.__props||P3;let t=P&&P.placed&&P.placed.telescope;if(!t){t=null;scene.traverse(o=>{if(!t&&o.name==='telescope'&&o.userData&&o.userData.tube)t=o;});if(!t)scene.traverse(o=>{if(!t&&o.userData&&o.userData.tube&&o.userData.tube.parent)t=o;});}const tube=t&&t.userData&&t.userData.tube;if(!tube||!tube.parent)return null;
  const W=(x,y,z)=>{tube.updateMatrixWorld(true);return tube.localToWorld(V(x,y,z));};
  return {t,tube,yoke:tube.parent,eye:()=>W(-.5,0,0),dir:()=>W(1,0,0).sub(W(0,0,0)).normalize(),gripR:()=>W(-.12,.05,0)/* LEISURE: on top of the tube a hand-width ahead of the left one, not at arm's full stretch */,gripL:()=>W(-.3,-.045,0),floor:t.position.y};}
 function teleStand(T){const E=T.eye(),d=T.dir();const dh=V(d.x,0,d.z).normalize();return E.clone().addScaledVector(dh,-.24).setY(T.floor);}
 // a hand onto a point by the arm alone (no leaning the body toward it): for holds while the body has its own pose to keep
 const PALM=.06;/* palm centre to wrist */
 function gripNoLean(side,t,w){const G=window.__grab;const p=G&&G.palmTarget?G.palmTarget(side,t):t;const s1=bones[side+'Arm'].getWorldPosition(V());const tw=p.clone().sub(s1);const tl=tw.length();const wt=tl>PALM*1.5?s1.clone().addScaledVector(tw,(tl-PALM)/tl):p;armIK(side,wt,sidePole(side),clamp(w,0,1));}
 function telePost(a,dt,T){window.__tele=T;const E=T.eye(),d=T.dir();const dh=V(d.x,0,d.z).normalize();a.tw=Math.min(1,(a.tw||0)+dt/.9);const w=smooth(0,1,a.tw);
  H.face=Math.atan2(dh.x,dh.z);
  {/* step in until his eye is at the eyepiece (a small shuffle, not a glide: only while the hands settle) */const hp=bones.Head.getWorldPosition(V()).addScaledVector(dh,.09);const ev=E.clone().addScaledVector(d,-.04).sub(hp);ev.y=0;const el=ev.length();{const want=el>.015&&(a.pt||0)<5?Math.min(.35,el*3):0;a.sv=(a.sv||0)+(want-(a.sv||0))*Math.min(1,dt*5);if(a.sv>.002&&el>1e-4)root.position.addScaledVector(ev,Math.min(el,a.sv*dt)/el);}root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*3);}
  // stoop: bend the spine about his left-right axis until the eye comes down to the eyepiece
  const ax=V(0,1,0).cross(dh).normalize();const Hd=bones.Head;/* measured: positive angles about up x dh bend him toward dh (the negated axis leaned him back) */
  for(let it=0;it<3;it++){const hp=Hd.getWorldPosition(V());const eyeP=hp.clone().add(V(0,.06,0)).addScaledVector(dh,.09);const want=E.clone().addScaledVector(d,-.05);const dy=eyeP.y-want.y;if(Math.abs(dy)<.01)break;
   const hip=bones.Spine.getWorldPosition(V());const r=Math.max(.3,eyeP.distanceTo(hip));const ang=clamp(dy/r,-.03,.4)*w*.8;/* never arch back to reach up: the neck does that */rotW(bones.Spine,ax,ang*.45);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.2);root.updateMatrixWorld(true);}
  // LEISURE: lean the chest in about the hips until the eye is on the eyepiece: collide keeps his feet ~20 cm off the tripod,
  // so the last bit is a lean (people lean into an eyepiece, they don't stand with their nose 20 cm away from it)
  for(let it=0;it<3;it++){const hip=bones.Spine.getWorldPosition(V());const eyeP=Hd.getWorldPosition(V()).add(V(0,.06,0)).addScaledVector(dh,.09);const want=E.clone().addScaledVector(d,-.04);
   const v=eyeP.clone().sub(hip),u=want.clone().sub(hip);const a1=Math.atan2(v.dot(dh),v.y),a2=Math.atan2(u.dot(dh),u.y);const ang=clamp(a2-a1,-.03,.45)*w;if(Math.abs(ang)<.004)break;
   rotW(bones.Spine,ax,ang*.4);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.25);root.updateMatrixWorld(true);}

  // panning: hands on, the yoke turns a little, then rests
  a.pt=(a.pt||0)+dt;if(!a.pn||a.pt>a.pn.end+rnd(6,12)){a.pn={from:T.yoke.rotation.y,to:a.pan0+rnd(-.35,.35),st:a.pt+rnd(4,8),end:0};a.pn.end=a.pn.st+1.6;}
  const G=window.__grab;const gR=T.gripR(),gL=T.gripL();gripNoLean('Left',gL,w*.95);gripNoLean('Right',gR,w);
  const dR=G&&G.gripPoint?G.gripPoint('Right').distanceTo(gR):0;
  if(a.pt>a.pn.st&&a.pt<a.pn.end&&dR<.05){const k=smooth(a.pn.st,a.pn.end,a.pt);T.yoke.rotation.y=a.pn.from+(a.pn.to-a.pn.from)*k;T.yoke.updateMatrixWorld(true);}
  if(G&&w>.5){G.hold('Right',T.tube,()=>T.gripR());G.hold('Left',T.tube,()=>T.gripL());}
  if(G&&G.late)G.late(()=>{gripNoLean('Left',T.gripL(),w*.95);gripNoLean('Right',T.gripR(),w);});}
 const telePt=()=>{const P=window.__props||P3;const t=P&&P.placed&&P.placed.telescope;if(t&&t.position)return t.position.clone().add(V(0,1.35,0));return V(3.5,DK+1.35,1.3);};
 // the edge of the platform in front of a node: step forward until the boards end
 function edgeFrom(node){const n=N[node];if(!n)return null;const f=fwd(n.face??0);const p=n.p.clone();let last=null;
  for(let d=.1;d<2.5;d+=.05){const q=p.clone().addScaledVector(f,d);const y=floorAt(q.x,p.y+.2,q.z,.3,.6);if(y==null||Math.abs(y-p.y)>.15){return last?{p:last,f,y:p.y}:null;}last=q;}return null;}
 // POSE: an open edge to sit on with the legs hanging: walk out from each node in 10-degree steps until the boards end
 // (small gaps between planks are crossed), then demand: nothing solid (railing, post, beam, roof) in front of the shins
 // or under the dangling feet, nothing behind the back at hip height, and the same along 30 cm either side (room for the thighs)
 let EDGE_OK=null;
 function openEdge(nodes){const C=window.__collide;if(!C||!C.depthAt)return null;let best=null;
  const solid=(x,y,z)=>C.depthAt(x,y,z)>.005;
  for(const k of nodes){const n=N[k];if(!n)continue;for(let a=0;a<36;a++){const yaw=a*Math.PI/18;const f=fwd(yaw);let last=null,miss=0;
    for(let d=.1;d<3.5;d+=.03){const x=n.p.x+f.x*d,z=n.p.z+f.z*d;const y=floorAt(x,n.p.y+.2,z,.3,.6);if(y==null||Math.abs(y-n.p.y)>.15){if(++miss>=6)break;continue;}miss=0;last=V(x,n.p.y,z);}
    if(!last)continue;let bad=0;const r=V(-f.z,0,f.x);
    // not next to a ladder that comes up over this edge
    let ladD=9;for(const kk in LAD){const [lo,hi]=kk.split('>');const top=N[lo]&&N[hi]?(N[lo].p.y>N[hi].p.y?N[lo]:N[hi]):null;if(!top||Math.abs(top.p.y-n.p.y)>.3)continue;const L=LAD[kk];const dl=Math.hypot(last.x-top.p.x,last.z-L.lz);ladD=Math.min(ladD,dl);if(dl<.7)bad++;}
    for(const sd of [-.3,-.15,0,.15,.3]){const b=last.clone().addScaledVector(r,sd);
     for(const o of [.06,.2,.35,.5])for(const h of [-.75,-.5,-.3,-.1,.15,.4])if(solid(b.x+f.x*o,n.p.y+h,b.z+f.z*o))bad++;
     for(const o of [.15,.35])if(floorAt(b.x+f.x*o,n.p.y-.05,b.z+f.z*o,.02,1.1)!=null)bad++;// a roof or landing right under the feet
     for(const o of [-.35,-.15])for(const h of [.15,.4,.7])if(solid(b.x+f.x*o,n.p.y+h,b.z+f.z*o))bad++;
     if(sd===0&&floorAt(b.x-f.x*.1,n.p.y+.2,b.z-f.z*.1,.3,.3)==null&&floorAt(b.x-f.x*.2,n.p.y+.2,b.z-f.z*.2,.3,.3)==null)bad++;}
    if(bad>0)continue;const d0=Math.hypot(last.x-n.p.x,last.z-n.p.z);const sc=d0+(k==='deck'?0:.4)+Math.max(0,1.4-ladD)*3;/* LEISURE: well clear of a ladder or rope ladder coming over the edge (Pavel's screenshot: the rope across his lap) */if(!best||sc<best.sc)best={node:k,p:last,f,y:floorAt(last.x,n.p.y+.2,last.z-0,.3,.6)??n.p.y,sc};}}
  return best;}
 // ===== KITCHEN helpers (re-added on the rolled-back body, kitchen thread): reach with a small lean, palm/grip point on a target, a held
 // tool placed exactly, the stir. The integrator folds them into job() later.
 function reachTo(side,t,w){const sh=bones[side+'Arm'];if(!sh||!t)return;let tot=0;
  for(let it=0;it<3;it++){const hp=bones.Hips.getWorldPosition(V());const s0=sh.getWorldPosition(V());const ex=s0.distanceTo(t)-(armLen*.92+PALM);if(ex<=.01)break;
   const d=V(t.x-hp.x,0,t.z-hp.z);if(d.lengthSq()<1e-4)break;d.normalize();if(d.dot(fwd(root.rotation.y))<-.1)break;/* never arch backwards to reach: the arm alone goes there */const ax=V(0,1,0).cross(d).normalize();const ang=Math.min(REACH_LEAN-tot,ex*3)*w;if(ang<=.005)break;tot+=ang;
   rotW(bones.Spine,ax,ang*.45);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.2);}
  const s1=sh.getWorldPosition(V());const tw=t.clone().sub(s1);const tl=tw.length();const wt=tl>PALM*1.5?s1.clone().addScaledVector(tw,(tl-PALM)/tl):t;/* the palm, not the wrist, on the point */
  armIK(side,wt,sidePole(side),clamp(w,0,1));}
 function palmTo(side,t){const G=window.__grab;const p=G&&G.gripPoint?G.gripPoint(side):bones[side+'Hand'].getWorldPosition(V());return p&&t?p.distanceTo(t):9;}
 const gripHome=n=>{const G=window.__grab;return G&&G.toolGripHome?G.toolGripHome(n):toolHome(n);};
 function reachGrip(side,t,w){const G=window.__grab;if(!G||!G.gripPoint){reachTo(side,t,w);return;}reachTo(side,G.palmTarget(side,t),w);
  /* the fist's grip point, not the wrist, onto the point: a few corrections of the wrist target */if(w>.98)for(let i=0;i<3;i++){const e=t.clone().sub(G.gripPoint(side));if(e.length()<.004)break;armIK(side,bones[side+'Hand'].getWorldPosition(V()).add(e),sidePole(side),1);}}
 function holdToolAt(side,name,gp,tip,w,bw){const P=PP();const o=P&&P.tools&&P.tools[name];const G=window.__grab;const sp=G&&G.GRIP&&G.GRIP[name];const hb=bones[side+'Hand'];if(!o||!sp||o.parent!==hb)return false;
  const ua=V(...sp.a).applyQuaternion(o.quaternion).normalize();const gl=V(...sp.g).multiplyScalar(o.scale.x).applyQuaternion(o.quaternion).add(o.position);// tool axis + grip point in hand space
  const W=tip.clone().sub(gp).normalize();const sh=bones[side+'Arm'].getWorldPosition(V());let Fw=gp.clone().sub(sh).normalize();
  const bas=(x,y)=>{const X=x.clone().normalize();const Y=y.clone().sub(X.clone().multiplyScalar(y.dot(X)));if(Y.lengthSq()<1e-6)Y.set(0,1,0).sub(X.clone().multiplyScalar(X.y));Y.normalize();return new THREE.Matrix4().makeBasis(X,Y,X.clone().cross(Y));};
  for(let it=0;it<2;it++){let Qh;if(bw){/* the tool's whole orientation is given: hand = tool * (tool in hand)^-1 */const Qt=new THREE.Quaternion().setFromRotationMatrix(bas(W,bw).multiply(bas(V(...sp.a),V(...sp.b)).transpose()));Qh=Qt.multiply(o.quaternion.clone().invert());}
   else{const Ml=bas(ua,V(0,1,0)),Mw=bas(W,Fw);Qh=new THREE.Quaternion().setFromRotationMatrix(Mw.multiply(Ml.transpose()));}
   const sc=hb.getWorldScale(V()).x;const wrist=gp.clone().sub(gl.clone().multiplyScalar(sc).applyQuaternion(Qh));
   armIK(side,wrist,sidePole(side),w);const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cur=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(cur.slerp(Qh,w)));hb.updateMatrixWorld(true);
   Fw=hb.getWorldPosition(V()).sub(bones[side+'ForeArm'].getWorldPosition(V())).normalize();}
  return true;}
 function stirPost(a,dt){const P=PP();const pot=P&&P.tools&&P.tools.pot,la=P&&P.tools&&P.tools.ladle;if(!pot||!la||la.parent!==bones.RightHand)return;
  a.sw=Math.min(1,(a.sw||0)+dt/.6);a.sa=(a.sa||0)+dt*4.6;pot.updateMatrixWorld(true);const c=pot.localToWorld(V(0,.07,0));const sh=bones.RightArm.getWorldPosition(V());
  const toMe=V(sh.x-c.x,0,sh.z-c.z).normalize();const B=c.clone().add(V(Math.cos(a.sa)*.045,0,Math.sin(a.sa)*.045));// the bowl in the soup
  // the handle leans toward him; pick the lean (and a little to his right) that keeps the fist a comfortable ~0.42 m from the shoulder
  const L=.29;const rt=V(-toMe.z,0,toMe.x);let Gp=null,bd=9;for(const el of [1.35,1.2,1.05,.9,.75])for(const sd of [0,.35,-.2]){const dir=toMe.clone().multiplyScalar(Math.cos(el)).addScaledVector(rt,sd*Math.cos(el)).add(V(0,Math.sin(el),0)).normalize();
   const g=B.clone().addScaledVector(dir,L);const e=Math.abs(g.distanceTo(sh)-.42)+(sd?.02:0);if(e<bd){bd=e;Gp=g;}}
  a.gs=a.gs?a.gs.lerp(Gp,1-Math.exp(-dt*10)):Gp.clone();Gp=a.gs;
  const G=window.__grab;if(G){G.hold('Right',pot.parent||pot,null);G.hold('Left',pot.parent||pot,null);a.stirHold=1;}/* the stove and pot are what his hands work at: collide.js leaves them there */
  /* W10: no torso lean toward the pot; he stands close instead */holdToolAt('Right','ladle',Gp,B,a.sw);a.dbg=[Gp,B];{const G2=window.__grab,sw=a.sw;if(G2&&G2.late)G2.late(()=>holdToolAt('Right','ladle',Gp,B,sw));}
  // left hand on the pot handle nearer his left
  const hs=[pot.localToWorld(V(-.1,.09,0)),pot.localToWorld(V(.1,.09,0))];const ls=bones.LeftArm.getWorldPosition(V());const lh=hs[0].distanceTo(ls)<hs[1].distanceTo(ls)?hs[0]:hs[1];
  if(lh.distanceTo(ls)<armLen*.95+PALM)gripNoLean('Left',lh,a.sw*.95);
  else{// KITCHEN: the handle is out of reach: the left palm rests flat on the stove's front edge beside the pot (steadying himself), never stretched or leaning
   if(!a.sbox){const st=pot.parent;a.sbox=new THREE.Box3().setFromObject(st);a.sy=pot.getWorldPosition(V()).y;}const b=a.sbox;
   const e=V(clamp(ls.x,b.min.x+.04,b.max.x-.04),a.sy+.012,clamp(ls.z,b.min.z+.04,b.max.z-.04));if(e.distanceTo(ls)<armLen*.98+PALM)gripNoLean('Left',e,a.sw*.9);}
  // a scrape each half turn (Sound): the bowl along the pot side
  const half=Math.floor(a.sa/Math.PI);if(half!==a.sh){a.sh=half;try{window.__audio&&window.__audio.contact&&window.__audio.contact({tool:'spoon',kind:'scrape',pos:B.toArray(),strength:.45,dur:Math.PI/4.6});}catch(e){}}}
 // KITCHEN chop: the knife tip stays on the board beyond the carrot, the handle rocks down through it (a cut every ~0.5 s: slow lift,
 // quick press), each cut a few mm further along; the left palm holds the carrot a finger's width from the blade
 function chopPost(a,dt){const P=PP();const bd=P&&P.tools&&P.tools.board,kn=P&&P.tools&&P.tools.knife;if(!bd||!kn||kn.parent!==bones.RightHand)return;
  a.cw=Math.min(1,(a.cw||0)+dt/.7);bd.updateMatrixWorld(true);const L=v=>bd.localToWorld(v);
  const sh=bones.RightArm.getWorldPosition(V());const c0=L(V(0,.022,.045));const toMe=V(sh.x-c0.x,0,sh.z-c0.z).normalize();
  const xr=L(V(1,0,0)).sub(L(V(0,0,0)));xr.y=0;xr.normalize();const rt=V(-toMe.z,0,toMe.x).multiplyScalar(-1);/* his right */const sx=xr.dot(rt)>=0?1:-1;// board +x on his right?
  // the cut moves along the carrot toward its thin end, then starts again
  a.cp=(a.cp||0)+dt;const per=.52;const ph=(a.cp%per)/per;const n=Math.floor(a.cp/per);const off=.03-(n%6)*.006;
  const cut=L(V(off*sx,.022,.045));const away=toMe.clone().multiplyScalar(-1);
  const T=cut.clone().addScaledVector(away,.075).add(V(0,.004,0));// the tip rests on the board past the carrot
  const lift=ph<.72?.012+.075*Math.sin(ph/.72*Math.PI/2):.087-.075*smooth(.72,1,ph);// slow lift, quick press down
  const dir=toMe.clone().addScaledVector(rt,.25).normalize();const dy=Math.min(.19,.018+lift);const hd=Math.sqrt(.2*.2-dy*dy);
  const gp=T.clone().addScaledVector(dir,hd).add(V(0,dy,0));
  if(n!==a.cn&&ph>.95){}if(n!==a.cn){a.cn=n;if(a.cw>.9){AU('chop',cut);try{window.__audio&&window.__audio.contact&&window.__audio.contact({tool:'knife',kind:'hit',pos:cut.toArray(),strength:.35});}catch(e){}}}
  {/* bend a little over the board from the chest (people lean over a cutting board; the counter keeps his hips ~0.5 m away) */const ax=V(0,1,0).cross(away).normalize();const ang=.16*a.cw;rotW(bones.Spine,ax,ang*.45);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.2);root.updateMatrixWorld(true);}
  const G=window.__grab;if(G){G.hold('Right',bd,null);G.hold('Left',bd,null);a.chHold=1;}
  holdToolAt('Right','knife',gp,T,a.cw,V(0,-1,0));{const w=a.cw;if(G&&G.late)G.late(()=>holdToolAt('Right','knife',gp,T,w,V(0,-1,0)));}
  // left palm on the carrot, 5 cm to the far side of the cut (toward the carrot's tip), fingers curled over it
  const lp=L(V((off-.055)*sx,.058,.045));gripNoLean('Left',lp,a.cw*.95);{const w=a.cw;if(G&&G.late)G.late(()=>gripNoLean('Left',lp,w*.95));}
  H.look=cut;H.lookW=1;}
 Object.assign(MAKE,{
  // kitchen
  chop:(o)=>job({pt:()=>PT('board'),stand:.3,/* KITCHEN (watcher B8): no hy_chop clip (it chopped at hip height under the worktop, bow-legged, the left hand hanging): he stands upright at the board, the knife is held by hand IK and rocks on its tip over the carrot, the left hand holds the carrot */loop:true,dur:[22,40],tools:[['knife','Right']],vary:false,post:(a,dt)=>chopPost(a,dt),end:a=>{if(a.chHold){a.chHold=0;try{window.__grab.free('Left');window.__grab.free('Right');}catch(e){}}}}),
  pot:(o)=>job({pt:()=>PT('pot')||PT('pan'),stand:.45,/* KITCHEN: no hy_stir clip (it sways the whole body and mimes beside the pot): the stirring arm is hand IK (stirPost), the body stands calm */loop:true,dur:[25,45],tools:[['ladle','Right']],vary:false,post:(a,dt)=>stirPost(a,dt),end:a=>{if(a.stirHold){a.stirHold=0;try{window.__grab.free('Left');window.__grab.free('Right');}catch(e){}}}}),
  stoke:(o)=>{// KITCHEN: logs from the woodpile into the oven, all by hand. Squat at the pile, both palms on the logs, the armful goes into the
   // left arm; walk over cradling it; squat at the oven, the right hand takes the door handle and lowers the door as far as the hand carries it;
   // one log after another: the right hand takes it out of the left arm and pushes it into the fire; the right hand lifts the door shut; stand up.
   const a={step:'go',t:0};const wp=PT('woodpile'),ovp=PT('oven');const P=window.__props||P3;const OV=()=>P&&P.oven;if(!wp||!ovp||!OV()||!OV().handle){a.update=()=>endTask(false);return a;}
   const G=()=>window.__grab;const rightOf=()=>{const f=fwd(root.rotation.y);return V(-f.z,0,f.x);};
   const arm=()=>P.tools&&P.tools.logArmful;let logs=[],home=[];
   const sqTo=(v,dt,rate=2.2)=>{const c=H.squat||0;H.squat=c+clamp(v-c,-rate*dt,rate*dt);H.kSquat=H.squat>.001;H.kSqA=act;};
   // how far the hips must go down for the palm to reach t from the shoulder (feet stay put), +3 cm to spare
   const sqFor=(t,side='Right',mx=.45)=>{const sh=bones[side+'Arm'].getWorldPosition(V());const hz=Math.hypot(sh.x-t.x,sh.z-t.z);const R0=armLen*.9+PALM-.03;const dy=sh.y+(H.squat||0)-t.y;return clamp(dy-Math.sqrt(Math.max(0,R0*R0-hz*hz))+.03,0,mx);};
   const mouth=()=>{const o=OV();const h=o.handle(V());const c=ovp.clone();return c.add(V(h.x-c.x,0,h.z-c.z).multiplyScalar(-.15)).setY(ovp.y+.02);};// inside the opening, above the embers
   a.ik=[];
   const toOven=()=>{const nn=nearNode(ovp)||'stove';goTo(nn,()=>approachTo(a,ovp,.62,()=>ovenSpot(a,()=>{a.step='ovsq';a.t=0;H.carry=null;play(IDLE(),{fade:.4});})));};
   const nn=nearNode(wp)||'kmid';goTo(nn,()=>approachTo(a,wp,.5,()=>{a.step='pksq';a.t=0;AU('grunt');}));
   a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    const o=OV();a.ik=[];kSlow(/^(pksq|ovsq|open|let|log|shut)$/.test(a.step)&&(H.squat||0)>.05);
    if(a.step==='pksq'){// squat down to the pile, both hands onto the top logs
     H.look=wp;H.lookW=1;if(a.t<=1.0){if(a.sqd===undefined)a.sqd=sqFor(wp);sqTo(a.sqd,dt);}const w=smooth(.25,.9,a.t);a.ik=[['Left',wp.clone().add(V(0,.04,0)).addScaledVector(rightOf(),-.12),w],['Right',wp.clone().add(V(0,.04,0)).addScaledVector(rightOf(),.12),w]];
     if(a.t>1.0&&!a.got){a.got=1;try{P.grab('logArmful',bones.LeftHand,{offset:V(.1,.12,.1)});const ar=arm();if(ar){logs=ar.children.slice();home=logs.map(l=>({p:l.position.clone(),q:l.quaternion.clone(),v:l.visible}));}window.__audio&&window.__audio.carry&&window.__audio.carry(true);}catch(e){}
      try{P.woodpile&&P.woodpile.setCount&&P.woodpile.setCount(Math.max(0,(P.woodpile.count||1)-1));}catch(e){}}
     if(a.t>1.0){a.ik=[['Right',a.ik[1][1],1-smooth(1.0,1.5,a.t)]];sqTo(0,dt,1.1);}
     if(a.t>1.6&&(H.squat||0)<.01){a.step='carry';H.carry='hy_carrylogs';toOven();}return;}
    if(a.step==='carry'||a.step==='go'){if(H.carry&&H.path.length&&has(H.carry)&&!H.ov)overlay(H.carry,{fade:.3,until:.98,weight:.9});return;}
    if(a.step==='ovsq'){// down to the oven, the right palm onto the door handle
     const h=o.handle(V());H.look=h;H.lookW=1;if(a.sqd2===undefined)a.sqd2=Math.max(sqFor(h),sqFor(mouth())*.8);sqTo(a.sqd2,dt);a.ik=[['Right',h,smooth(.2,.8,a.t)]];
     if(a.t>.85&&palmTo('Right',h)<.04||a.t>1.6){a.step='open';a.t=0;AU('ovenDoor',h);}return;}
    if(a.step==='open'){// the door goes down only with the hand on it
     o.setOpen(Math.min(1,o.open+dt/.9));const h=o.handle(V());H.look=mouth();H.lookW=.9;a.ik=[['Right',h,1]];if(G())G().hold('Right',o.door,()=>o.handle(V()));
     if(o.open>=1){a.step='let';a.t=0;if(G())G().free(o.door);}return;}
    if(a.step==='let'){const h=o.handle(V());a.ik=[['Right',h,1-smooth(0,.3,a.t)]];if(a.t>.3){a.step='log';a.t=0;a.li=0;}return;}
    if(a.step==='log'){// one log: from the left arm into the fire
     const L=logs[a.li];if(!L){a.step='shut';a.t=0;a.ik=[['Right',(a.pf||mouth()).clone(),1]];/* no frame without the hand's target (it fell to the clip pose for one frame: 24 cm) */return;}const src=L.parent===bones.RightHand?null:L.getWorldPosition(V());const m=mouth();H.look=m;H.lookW=1;
     /* the hand travels: log -> fire -> next log, the target carried along a path (a full-weight target switch threw the hand 25 cm and his head 16 cm in one frame) */
     if(!a.lt){const tg=src||m;a.ik=a.li>0&&a.pf?[['Right',a.pf.clone().lerp(tg,smooth(0,.45,a.t)),1]]:[['Right',tg,smooth(0,.45,a.t)]];if(a.t>.5){a.p0=tg.clone();bones.RightHand.attach(L);a.lt=1;a.t=0;}}
     else{const tg=(a.p0||m).clone().lerp(m,smooth(0,.4,a.t));a.ik=[['Right',tg,1]];if(a.t>.55&&a.lt===1){a.lt=2;L.visible=false;AU('stoke',m);}if(a.t>.8){a.pf=m.clone();a.lt=0;a.t=0;a.li++;}}
     return;}
    if(a.step==='shut'){const h=o.handle(V());H.look=h;H.lookW=1;if(!a.sh){a.ik=[['Right',a.pf?a.pf.clone().lerp(h,smooth(0,.4,a.t)):h,a.pf?1:smooth(0,.4,a.t)]];if(a.t>.45){a.sh=1;a.t=0;}return;}
     o.setOpen(Math.max(0,o.open-dt/.7));a.ik=[['Right',o.handle(V()),1]];if(G())G().hold('Right',o.door,()=>o.handle(V()));
     if(o.open<=0){if(G())G().free(o.door);a.step='up';a.t=0;AU('ovenDoor',h);}return;}
    if(a.step==='up'){const h=o.handle(V());a.ik=[['Right',h,1-smooth(0,.35,a.t)]];sqTo(0,dt,.9);if(a.t>.4&&(H.squat||0)<.01){cleanup();play(IDLE(),{fade:.5});endTask({ok:true});a.step='done';}return;}};
   // while squatting at the oven the armful rests on his left thigh (the left forearm across it), never dangling to the floor
   const lap=()=>{const hp=bones.Hips.getWorldPosition(V());const f=fwd(root.rotation.y);return hp.addScaledVector(f,.34).addScaledVector(rightOf(),-.14).add(V(0,-.02,0));};
   a.post=()=>{/* the gaze glides between the handle, the fire and the logs (a new look target turned head and spine at once: the head jumped 16 cm and the arms with it) */if(H.look){a.lk=a.lk?a.lk.lerp(H.look,1-Math.exp(-6/60)):H.look.clone();H.look=a.lk.clone();}
    const ik=(a.ik||[]).slice();if(/^(ovsq|open|let|log|shut)$/.test(a.step)&&a.got&&logs.some(l=>l.visible&&l.parent!==bones.RightHand)){ik.unshift(['Left',lap(),a.step==='ovsq'?smooth(0,.6,a.t):1]);a.lapW=1;}
    else if((a.lapW||0)>0){/* the last log gone: the left arm leaves his lap slowly (it dropped 7-15 cm at once) */a.lapW=Math.max(0,a.lapW-1/60/.5);ik.unshift(['Left',lap(),smooth(0,1,a.lapW)]);}
    for(const [sd,t,w] of ik)if(t&&w>.01)reachGrip(sd,t,Math.min(1,w));};
   function cleanup(){const ar=arm();try{logs.forEach((l,i)=>{if(ar&&l.parent!==ar)ar.attach(l);if(home[i]){l.position.copy(home[i].p);l.quaternion.copy(home[i].q);l.visible=home[i].v;}});P.release('logArmful');}catch(e){}
    try{window.__audio&&window.__audio.carry&&window.__audio.carry(false);}catch(e){}H.carry=null;H.squat=0;H.kSquat=0;kSlow(false);a.ik=[];}
   a.leave=cb=>{cleanup();try{const o=OV();if(o&&o.open>0){if(G())G().free(o.door);o.setOpen(0);}}catch(e){}cb();};return a;},
  dishes:(o)=>dishesAction(o),
  supplies:(o)=>job({pt:()=>PT('pantry'),stand:.5,clip:'hy_count',loop:true,dur:[15,28]}),
  tea:MAKE.tea,
  // workshop
  saw:(o)=>job({pt:()=>PT('bench'),stand:.45,clip:'hy_saw',loop:true,dur:[20,40],tools:[['plankSaw','Right']],tick:(a,dt)=>{a.ct=(a.ct||0)+dt;if(a.ct>.8){a.ct=0;AU('saw',PT('bench'));}}}),
  hammer:(o)=>MAKE.craft(o),
  sharpen:(o)=>job({pt:()=>PT('whetstone'),stand:.42,clip:'hy_sharpen',loop:true,dur:[18,30],tools:[['knife','Right']],tick:(a,dt)=>{a.ct=(a.ct||0)+dt;if(a.ct>1.1){a.ct=0;AU('sharpen',PT('whetstone'));}}}),
  fixlamp:(o)=>job({pt:()=>PT('bench'),stand:.45,clip:'hy_lantern',loop:true,dur:[25,45],tools:[['lantern','Left']],
   start:a=>{const L=window.__lights;try{L&&L.attachHand&&L.attachHand(bones.LeftHand);}catch(e){}},tick:a=>{if(a.step==='work'&&!a.lit&&a.T>2){a.lit=1;try{window.__lights.set('hand',true);}catch(e){}}},
   end:a=>{const L=window.__lights;try{L&&L.set&&L.set('hand',false);L&&L.detachHand&&L.detachHand();}catch(e){}}}),
  // bedroom and anywhere
  stretch:(o)=>MAKE.micro({clip:'hy_stretch'}),
  diary:(o)=>{// LEISURE (frame check: he sat back in the chair writing in the air, the diary 1 m away on the table): he walks to the
   // table, picks up the diary (left hand) and the pencil (right), carries them to the chair, sits, holds the open diary on his thighs
   // with the left hand and writes in it with the pencil tip on the page (short lines, then the next line), stops now and then to
   // think with his eyes off the page, then stands, takes both back to the table and lays them down where they were
   const a={step:'go',t:0,T:0};const dur=rnd(30,55);const P=window.__props||P3;const DY=P&&P.tools&&P.tools.diary;const G=()=>window.__grab;
   const dp=()=>toolHome('diary'),pp=()=>toolHome('pencil');
   if(!DY||!dp()){a.update=()=>endTask(false);return a;}
   const pick=dp().clone();pick.y=root.position.y;const pn=nearNode(pick);
   // stand square to the table in front of the two things (from the chair side), so each hand reaches its own: the diary on
   // his left, the pencil on his right (QA: approached on the slant, the left hand had to cross over and stopped 25 cm short)
   const mid=()=>dp().lerp(pp(),.5);const spot=()=>{const m=mid();const n=V(N.chair.p.x-m.x,0,N.chair.p.z-m.z).normalize();return m.addScaledVector(n,.45).setY(root.position.y);};
   const toTable=then=>{const go=()=>approachTo(a,spot(),0,()=>{a.step='turn';a.t=0;play(IDLE(),{fade:.3});const m=mid();H.face=Math.atan2(m.x-root.position.x,m.z-root.position.z);a.after2=then;});if(pn)goTo(pn,go);else go();};
   const lap=()=>{const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);return bones.Hips.getWorldPosition(V()).addScaledVector(f,.3).addScaledVector(r,-.03).add(V(0,.1,0));};
   const flat=(q,tilt)=>{const f=fwd(root.rotation.y);const e=new THREE.Euler(tilt,Math.atan2(f.x,f.z)+Math.PI,0,'YXZ');return q.setFromEuler(e);};
   // the diary in world space: on the left palm while carried, open on his thighs while he writes
   a.dPose=(dt)=>{if(!a.dh)return;const g=G();const pl=g&&g.palm?g.palm('Left',V()):bones.LeftHand.getWorldPosition(V());
    const k=smooth(0,1,a.lapK||0);const tgt=pl.clone().add(V(0,.03,0)).lerp(lap(),k);DY.position.copy(tgt);flat(DY.quaternion,-.35*k);DY.updateMatrixWorld(true);};
   toTable(()=>{a.step='take';a.t=0;play(IDLE(),{fade:.4});});
   a.update=dt=>{a.t+=dt;if(a.step==='approach'){H.look=dp();H.lookW=.6;if(a.t>=a.adur)a.next();return;}
    if((a.step==='take'||a.step==='put')&&ctx.table){/* the table box keeps him ~60 cm out on the walk in; for the reach he shuffles up until his belly is a hand from the edge */const T=ctx.table,q=root.position;const dx=q.x-clamp(q.x,T.x0,T.x1),dz=q.z-clamp(q.z,T.z0,T.z1),d=Math.hypot(dx,dz);if(d>.17&&a.t<.7){const m=Math.min(d-.16,.45*dt);q.x-=dx/d*m;q.z-=dz/d*m;}a.tdist=d;}
    if(a.step==='turn'){H.look=dp();H.lookW=.8;const d=wrapA(H.face-root.rotation.y);root.rotation.y+=Math.sign(d)*Math.min(Math.abs(d),2.6*dt);if(Math.abs(d)<.02||a.t>1.2){a.step='at';a.t=0;const cb=a.after2;a.after2=null;cb&&cb();}return;}
    if(a.step==='take'){H.look=dp();H.lookW=1;if(a.t>.6&&!a.got){a.got=1;a.dh=1;grabTool('pencil','Right');AU('cloth');}
     if(a.t>1.2){a.step='go2';goTo('chair_app',()=>{a.step='sit';sitDown(N.chair,()=>{a.step='open';a.t=0;play(SITIDLE,{fade:.8});});});}}
    else if(a.step==='open'){a.lapK=Math.min(1,a.t/1.1);H.look=lap();H.lookW=1;if(a.t>1.2){a.step='write';a.t=0;a.ln=0;a.th=rnd(8,14);}}
    else if(a.step==='write'){a.T+=dt;const L=lap();H.look=L;H.lookW=.95;a.th-=dt;if(a.th<0){a.step='think';a.t=0;a.tk=rnd(3,5);}
     if(a.T>dur){a.step='close';a.t=0;}}
    else if(a.step==='think'){H.look=root.position.clone().addScaledVector(fwd(root.rotation.y+.7),3).add(V(0,1.35,0));H.lookW=.8;if(a.t>a.tk){a.step='write';a.t=0;a.th=rnd(8,14);}}
    else if(a.step==='close'){a.lapK=Math.max(0,1-a.t/1.0);H.look=lap();H.lookW=.8;if(a.t>1.1){a.step='up';standUp(N.chair,()=>{a.step='back';toTable(()=>{a.step='put';a.t=0;play(IDLE(),{fade:.4});});});}}
    else if(a.step==='put'){H.look=dp();H.lookW=1;if(a.t>.6&&a.got){a.got=0;a.dh=0;relTool('Right','pencil');try{P.release('diary');}catch(e){}AU('cloth');}if(a.t>1.1){a.step='done';if(a.after){const cb=a.after;a.after=null;cb();}else endTask();}}};
   a.post=dt=>{const W=(t0,t1)=>smooth(t0,t1,a.t);
    if(a.step==='take'||a.step==='put'){const w=Math.min(W(0,.5),1-W(.75,1.15));if(w>.01){{/* bend over the table as far as the reach needs (it is ~55 cm in from his toes) */const f=fwd(root.rotation.y),sh=bones.Spine2.getWorldPosition(V()),m=dp().lerp(pp(),.5);const need=Math.hypot(m.x-sh.x,m.z-sh.z)+(sh.y-m.y)*.5-.42;const ax=V(0,1,0).cross(f).normalize();const an=clamp(need*1.6,0,.62)*w;rotW(bones.Spine,ax,an*.58);rotW(bones.Spine1,ax,an*.27);rotW(bones.Spine2,ax,an*.15);}const tl=dp().add(V(0,.03,0)),tr=pp().add(V(0,.02,0));const two=()=>{gripNoLean('Left',tl,w);gripNoLean('Right',tr,w);};two();const G2=window.__grab;if(G2&&G2.late)G2.late(two);/* again after the head turn moved the chest */}}
    a.dPose(dt);
    if(a.dh&&(a.step==='open'||a.step==='write'||a.step==='think'||a.step==='close')){const k=smooth(0,1,a.lapK||0);
     // left hand on the diary's outer edge, the pencil on the page: a line is ~4 cm of small strokes, then the next line down
     const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const c=DY.position.clone();a.tL=c.clone().addScaledVector(r,-.07).add(V(0,.015,0));gripNoLean('Left',a.tL,k);
     if(a.step==='write'){a.wt=(a.wt||0)+dt;const ln=Math.floor(a.wt/3.2)%5,u=(a.wt%3.2)/3.2;const pt=c.clone().addScaledVector(r,-.02+u*.07+Math.sin(a.wt*19)*.004).addScaledVector(f,.05-ln*.022).add(V(0,.035+Math.max(0,Math.sin(a.wt*9))*.006,0));
      a.pw=Math.min(1,(a.pw||0)+dt/.5);a.tR=pt;const wR=smooth(0,1,a.pw)*k;const PC=P.tools.pencil;if(PC&&PC.parent===bones.RightHand){bones.RightHand.updateMatrixWorld(true);const hw=bones.RightHand.getWorldPosition(V());const Lt=PC.localToWorld(V(.09,.0045,0)).distanceTo(hw);const W=pt.clone().addScaledVector(V(0,1,0).multiplyScalar(.75).addScaledVector(f,-.45).addScaledVector(r,.35).normalize(),Lt);armIK('Right',W,sidePole('Right'),wR);bones.RightHand.updateMatrixWorld(true);turnBone(bones.RightHand,PC.localToWorld(V(.09,.0045,0)),pt,wR);}else gripNoLean('Right',pt,wR);/* the fist just over the page, the wrist turned so the pencil TIP is on the line */}
     else{a.pw=Math.max(0,(a.pw||0)-dt/.6);if(a.pw>.01)gripNoLean('Right',c.clone().addScaledVector(r,.04).add(V(0,.06,0)),smooth(0,1,a.pw)*k);}}};
   // cut short (an urgent need): he still puts the diary and pencil back on the table by hand first, never teleports them home
   a.leave=cb=>{if(!a.dh){if(a.got){relTool('Right','pencil');a.got=0;}if(H.seated){standUp(N.chair,cb);return;}cb();return;}a.after=cb;
    if(a.step==='take'||a.step==='at'||a.step==='turn'){a.step='put';a.t=0;return;}if(a.step==='put'||a.step==='back'||a.step==='up'||a.step==='close')return;
    if(a.step==='open'||a.step==='write'||a.step==='think'){a.step='close';a.t=0;return;}
    a.step='back';H.then=null;toTable(()=>{a.step='put';a.t=0;play(IDLE(),{fade:.4});});};return a;},
  sweep:(o)=>job({pt:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),1).add(V(0,.1,0)),stand:.9,clip:'hy_sweep',loop:true,dur:[15,28],tools:[['broom','Right']],
   tick:(a,dt)=>{// shuffles slowly across the floor while sweeping, turning back at walls
    if(a.pause)return;
    if(!a.spotDone){/* GRAB: with the broom in hand, first out into open floor (roomy), facing the way he goes, away from the furniture */const p=root.position;if(!a.spot)a.spot=sweepSpot();const d=V(a.spot.x-p.x,0,a.spot.z-p.z);const l=d.length();
     if(l<.04||(a.spT=(a.spT||0)+dt)>6){a.spotDone=true;}else{const yT=Math.atan2(d.x,d.z);root.rotation.y+=clamp(wrapA(yT-root.rotation.y),-2.2*dt,2.2*dt);H.face=root.rotation.y;if(Math.abs(wrapA(yT-root.rotation.y))<.6)p.addScaledVector(d.normalize(),Math.min(l,.3*dt));return;}}
    const p=root.position;const f=fwd(root.rotation.y);const q=p.clone().addScaledVector(f,.25);pushOut(q);const y=floorAt(q.x,p.y+.2,q.z,.3,.5);
    /* GRAB: he stoops over the broom, so his head and the bristles are ~0.7 m ahead of his feet: keep that much clear of furniture too */const blocked=[.35,.55,.75].some(k=>{const x=p.x+f.x*k,z=p.z+f.z*k;return OBST.some(o=>Math.abs(o.y-p.y)<.6&&x>o.x0-.12&&x<o.x1+.12&&z>o.z0-.12&&z<o.z1+.12);});
    /* GRAB: and by the real furniture/wall shapes (collide.js): shoulders and hips 25 cm round the next step, the stooped head ~0.5 m ahead
       (corner post by the door, the bunk's rails); only a step that gets him deeper in is refused, so a tight spot never locks him */
    const CL=window.__collide;let blk2=false;if(CL&&CL.clearance){const c0=CL.clearance(p.x,p.y,p.z,.25),c1=CL.clearance(p.x+f.x*.15,p.y,p.z+f.z*.15,.25),c2=CL.clearance(p.x+f.x*.5,p.y,p.z+f.z*.5,.12);blk2=c1>Math.max(.01,c0+.003)||c2>.02;if(!blk2&&CL.depthAt&&bones.Head){/* the stooped head itself, a hand ahead (the bunk's upper rail) */const hd=bones.Head.getWorldPosition(V());for(const k of [.08,.16])if(CL.depthAt(hd.x+f.x*k,hd.y,hd.z+f.z*k)>.005){blk2=true;break;}}}/* beds and seats too (pushOut lets him sit on those) */
    if(blocked||blk2||y==null||Math.abs(y-p.y)>.1||q.distanceTo(p.clone().addScaledVector(f,.25))>.02){root.rotation.y+=Math.PI*.6*dt;H.face=root.rotation.y;}else{p.addScaledVector(f,.22*dt);}
    a.ct=(a.ct||0)+dt;if(a.ct>1.2){a.ct=0;AU('sweep',p);}},look:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),.8)}),
  water:(o)=>job({pt:()=>PT('plant'),stand:.45,clip:'hy_water',dur:[5,6],tools:[['wateringCan','Right']]}),
  listen:(o)=>{
   // LEISURE (phone watch 2e3a58e: he stood 50 s in the middle of the workshop facing the viewer with the window at his back, and the
   // cupped hand read as a wave): he goes to a real glazed window of the room he is in (index.html win(): centre, inward normal),
   // stands close, faces the glass, rests a hand on the frame, leans in, turns an ear to the pane, holds still, shifts his weight
   const XL=lv.XL||0,XR=lv.XR||0;const G=(x,y,z,nx,nz,lo)=>({c:V(x+(x<0?XL:XR),y,z),n:V(nx,0,nz),lo});
   const GL=[G(-2.33,KT+1.5,1.04,0,1,KT+1.15),G(-4.37,KT+1.38,2.7,1,0,KT+1.0),G(-4.17,BD+1.2,2.4,1,0,BD+.8),G(3.575,WS+1.4,1.24,0,1,WS+1.05),G(4.57,WS+1.25,2.85,-1,0,WS+.85)];
   const here=GL.filter(g=>Math.abs(g.c.y-1.3-root.position.y)<1.2);const ok=g=>{const q=g.c.clone().addScaledVector(g.n,.5);q.y=g.c.y-1.3;const t=q.clone();pushOut(t);return t.distanceTo(q)<.12&&floorAt(q.x,q.y+.3,q.z,.3,.6)!=null;};
   const gl=pick(here.filter(ok))||pick(GL.filter(ok));const wn=gl?(nearNode(gl.c.clone().addScaledVector(gl.n,.6).setY(gl.c.y-1.3))||pick(WINDOWS)):pick(WINDOWS);
   if(!gl){const fw=()=>fwd(N[wn].face??0);return job({node:wn,slide:false,clip:IDLE(),loop:true,dur:[10,16],look:()=>bones.Head.getWorldPosition(V()).addScaledVector(fw(),3),lookW:.8});}
   /* listen_window (clip supplier, 7.8 s): leans in, ear to the glass, holds with weight shifts, eases out; the code then only adds the hand on the sill */
   const LW=has('listen_window');
   return job({node:wn,pt:()=>gl.c.clone().setY(root.position.y),stand:.42,faceYaw:Math.atan2(-gl.n.x,-gl.n.z),clip:LW?'listen_window':IDLE(),loop:!LW,dur:LW?null:[14,24],reps:LW?(Math.random()<.5?1:2):1,vary:false,
    start:a=>{a.side=Math.random()<.5?1:-1;a.ph=0;a.pt=rnd(2,3.5);a.hw=0;a.ws=rnd(4,7);a.shw=.5;a.sh=1;},
    // through the glass at the dark; with the ear turned the gaze drops and goes past the pane
    look:a=>{const r=V(-gl.n.z,0,gl.n.x);const k=a.ear||0;return gl.c.clone().addScaledVector(gl.n,-3).addScaledVector(r,a.side*2.4*k).add(V(0,-.2-.3*k,0));},lookW:LW?0:.9,
    tick:(a,dt)=>{a.pt-=dt;if(a.pt<0){a.ph^=1;a.pt=a.ph?rnd(3.5,6):rnd(2.5,4);if(a.ph&&Math.random()<.4)a.side=-a.side;}
     a.ear=clamp((a.ear||0)+(a.ph?dt/1.1:-dt/1.1),0,1);a.hw=clamp(a.hw+(a.T>1.2&&a.T<(a.jdur||99)-1.2?dt/.8:-dt/.6),0,1);
     a.ws-=dt;if(a.ws<0){a.ws=rnd(5,8);a.sh=(a.sh?0:1);}a.shw=clamp((a.shw||0)+((a.sh?1:0)-(a.shw||0))*Math.min(1,dt*1.2),0,1);},
    post:(a,dt)=>{const f=V(-gl.n.x,0,-gl.n.z),ax=V(0,1,0).cross(f).normalize();if(!LW){const lean=(.05+.07*smooth(0,1,a.ear||0))*smooth(0,1,a.hw);rotW(bones.Spine1,ax,lean);rotW(bones.Spine2,ax,lean*.6);
     /* weight shift: the hips sway a little toward one foot and back (no clip needed) */rotW(bones.Spine,f,((a.shw??.5)-.5)*.05);}
     const w=smooth(0,1,a.hw);if(w>.01){const s=a.side>0?'Left':'Right';/* the hand AWAY from the turned ear rests on the sill (the bottom rail of the frame; the curtains hang at the sides) */
      const r=V(-gl.n.z,0,gl.n.x);const t=gl.c.clone().addScaledVector(r,-a.side*.16).addScaledVector(gl.n,.07);t.y=gl.lo+.05;
      const put=()=>gripNoLean(s,t,w);put();const GG=window.__grab;if(GG&&GG.late)GG.late(put);}}});},
  bolt:(o)=>{const P=window.__props||P3;const D=P&&P.door;const to=o&&o.lock===false?0:1;
   // GRAB DOOR: the door and its bolt move only under his palm (grab.js door hand + props door.hand). The open door sweeps a
   // quarter circle (0.77 m) round its hinge, so he walks round just outside that sweep, a little ahead of the leaf, his palm
   // on it, and ends beside the shut door at the bolt. Spots in the door's frame: hinge + r * (-cos th, 0, sin th), th = open * 1.66.
   const spot=(th,r)=>{const w=D.width||.77;return D.obj.localToWorld(V(w/2-Math.cos(th)*r,0,Math.sin(th)*r));};
   const want=()=>{const th=D.open*1.66;return spot(Math.min(th+.4,1.5),.8+.13*smooth(0,.6,th));};
   const follow=(a,dt)=>{const p=root.position,q=want();const dx=q.x-p.x,dz=q.z-p.z,m=Math.hypot(dx,dz);a.v=Math.min(.75,Math.max(0,(a.v||0)+(m>.03?2:-3)*dt),Math.sqrt(2*2*m));const st=Math.min(m,a.v*dt);/* eased start and stop: no jerk in the feet */if(m>1e-4){p.x+=dx/m*st;p.z+=dz/m*st;}
    const lk=D.open>.02?spot(D.open*1.66,.62):D.boltKnob(V());const yF=Math.atan2(lk.x-p.x,lk.z-p.z);const dy=wrapA(yF-root.rotation.y);root.rotation.y+=Math.sign(dy)*Math.min(Math.abs(dy),2.4*dt);H.face=root.rotation.y;
    const mv=st/dt>.12;if(mv&&!a.walk){a.walk=1;play('30',{fade:.25,speed:.8});}else if(!mv&&a.walk&&m<.03){a.walk=0;play(IDLE(),{fade:.4});}return m;};
   return job({pt:()=>D&&D.boltKnob?D.boltKnob(V()):null,stand:.42,clip:null,dur:[14,14],vary:false,
   look:a=>D.open>.02?spot(D.open*1.66,.62).setY(root.position.y+.95):D.boltKnob(V()),
   start:a=>{a.ds='shut';a.dt=0;},
   tick:(a,dt)=>{a.dt+=dt;const m=follow(a,dt);
    if(a.ds==='shut'){if(m<.12&&D.target!==0)D.openTo(0);if((D.open<=1e-3&&m<.05)||a.dt>9){D.openTo(D.open);D.boltTo(to);a.ds='bolt';a.dt=0;}return;}
    if(a.ds==='bolt'){if(Math.abs(D.bolt-to)<1e-3){AU('bolt',D.boltKnob(V()));a.ds='done';a.dt=0;}else if(a.dt>3){D.boltTo(D.bolt);a.ds='done';a.dt=0;}return;}
    if(a.ds==='done'&&a.dt>.6)a.T=1e3;}});},
  radio:(o)=>{const P=window.__props||P3;const R=P&&P.radio;if(!R||!R.knob)return job({pt:()=>PT('radio'),stand:.45,clip:'hy_radio',loop:true,dur:[30,60]});
   // LEISURE: the radio sits low on the crate by the bed. He bends his knees to it, switches it on and turns the dial with his
   // right hand ON the knob (it only turns while the fingers are there), straightens up and listens, now and then bends again
   // to retune, and switches it off by hand before he goes (QA: the dial turned while his palms were 60-100 cm away)
   const D=rnd(30,60);const kn=()=>R.knob(V());
   const reachK=(a,dt,on)=>{a.kw=clamp((a.kw||0)+(on?dt/.6:-dt/.5),0,1);const k=kn();const kh=k.y-root.position.y;if(on&&!a.sq&&kh<.8&&has('cm_squat')){a.sq=1;play('cm_squat',{fade:.55});}else if(!on&&a.sq&&a.kw<.35){a.sq=0;play(IDLE(),{fade:.6});}/* a real crouch (CMU squat) to the low crate, not a stoop */
    a.kp=k;const G=window.__grab;return G&&G.gripPoint?G.gripPoint('Right').distanceTo(k)<.06:a.kw>.95;};/* the fingers on the dial (Grab's grip point): gripNoLean in post */
   // the stand spot: half a metre in front of the dial, 30 cm clear of the watering can (QA: the can went through his shins and
   // chest in the crouch; beside the crate he had to fold over 50 deg between it and the bunk); the approach line is aimed so he stops there
   const S0=()=>{const o3=R.obj;const f=fwd(o3.rotation.y),r=V(-f.z,0,f.x);const q=kn().addScaledVector(f,.58).addScaledVector(r,.05);q.y=root.position.y;return q;};/* square in front of the dial, in the 47 cm gap between the bunk end (x -1.15) and the watering can (gate: at +12 cm right the squat hit the bunk, at -6 cm the can) */
   const PTr=()=>{const S=S0();const nn=nearNode(S);const from=nn&&N[nn]?N[nn].p:root.position;const u=V(S.x-from.x,0,S.z-from.z);if(u.lengthSq()<1e-4)u.set(0,0,1);u.normalize();return S.clone().addScaledVector(u,.3).setY(kn().y);};
   // LEISURE (phone watch 7914e3f: 30 s crouched behind the chair, then standing with his back to the room and no radio in sight):
   // he tunes it in at the crate, then sits back in the chair by the table with the radio in view to listen (the bunk edge forces
   // a hunch under the upper bed), and goes back to switch it off
   const BED=!!(N.chair&&N.chair_app)&&!(o&&o.nobed);const ahead=()=>root.position.clone().addScaledVector(fwd(root.rotation.y),3).add(V(0,.9,0));
   const gap=()=>{const q=S0();q.x=(-1.15+N.chair.p.x-.25)/2;q.z+=.42;return q;};/* between the bunk end and the chair, a step back from the crate */
   const bedPh=(a,dt)=>{const T=a.T;if(!BED)return false;a.bs=a.bs||0;
    if(a.bs===0){if(T>7.5&&R.on&&!a.sq&&(a.sqw||0)<.05&&(a.kw||0)<.05&&T<a.jdur-25){a.bs=1;a.pin=null;a.lis=clamp(a.jdur-T-22,10,60);/* first a step straight back from the crate (the direct line to the chair crossed the watering can) */approachTo(a,gap(),0,()=>{a.step='work';goTo('chair_app',()=>{a.bs=2;sitDown(N.chair,()=>{a.bs=3;a.st=0;play(SITIDLE,{fade:.8});AU('sigh');});});});return true;}return false;}
    if(a.bs===3){a.st+=dt;if(a.st>a.lis){a.bs=4;standUp(N.chair,()=>{a.bs=5;/* back the way he came: through the gap between the bunk end and the chair, clear of the watering can */approachTo(a,gap(),0,()=>approachTo(a,S0(),0,()=>{a.step='work';a.bs=6;a.T=Math.max(a.T,a.jdur-3.4);a.pin=null;}));});}return true;}
    return a.bs<6;};
   return job({pt:PTr,stand:.3,loop:true,dur:BED?[D+30,D+30]:[D,D],vary:false,look:a=>a.bs>0&&a.bs<6&&a.bs!==3?ahead():kn(),lookW:.9,
    tick:(a,dt)=>{if(bedPh(a,dt))return;const T=a.T;{const p=root.position;if(!a.pin)a.pin=p.clone();else if(a.sq||a.sqw>0){p.x=a.pin.x;p.z=a.pin.z;}}/* he stays on his spot in the crouch (gate: contact pushes walked him 30 cm into the can and the bunk end) */{const k=kn(),p=root.position;const y=Math.atan2(k.x-p.x,k.z-p.z);const d=wrapA(y-root.rotation.y);root.rotation.y+=Math.sign(d)*Math.min(Math.abs(d),2.4*dt);H.face=root.rotation.y;}/* square up to the radio */let want=T<6.5&&T>.4;// tune on arrival
     if(!want&&!(o&&o.keepOn)&&T>(a.jdur||D)-3)want=true;// switch off before leaving
     if(!want){a.rt=(a.rt??rnd(14,24))-dt;if(a.rt<0){a.rr=(a.rr||0)+dt;want=true;if(a.rr>3.2){a.rt=rnd(14,24);a.rr=0;a.t0=null;}}}
     const touch=reachK(a,dt,want);a.sqw=clamp((a.sqw||0)+(a.sq?dt/.6:-dt/.6),0,1);H.squat=.15*smooth(0,1,a.sqw);/* hips down into a real crouch, the feet stay on the boards (post) */
     if(touch){if(T<6.5){if(!R.on)R.setOn(1);a.tn=.3+.4*smooth(1,6,T);R.setTune(a.tn);}
      else if(T>(a.jdur||D)-3){if(R.on&&!(o&&o.keepOn))R.setOn(0);}
      else if(a.rr>.5){a.t0=a.t0??(a.tn??.7);R.setTune(clamp(a.t0+Math.sin((a.rr-.5)*1.4)*.05,0,1));}}},
    post:(a,dt)=>{const sw=smooth(0,1,a.sqw||0);if(sw>.01){if(H.floorY!=null)legPlant(H.floorY,dt,sw);/* QA: in the CMU squat both soles hung 12-20 cm over the boards */
      const f=fwd(root.rotation.y),ax=V(0,1,0).cross(f).normalize();rotW(bones.Spine,ax,-.28*sw);rotW(bones.Spine1,ax,-.16*sw);/* a crouch, not a 60 deg stoop: the lowered hips take the height, the back straightens */}
     if(a.kp&&a.kw>.01){gripNoLean('Right',a.kp,smooth(0,1,a.kw));const G=window.__grab;if(G&&G.late){const k=a.kp,w=smooth(0,1,a.kw);G.late(()=>gripNoLean('Right',k,w));}}},
    end:a=>{a.ik=null;H.squat=0;legPlantOff();if(a.sq){a.sq=0;play(IDLE(),{fade:.5});}}});},
  telescope:(o)=>{const T=teleParts();if(!T)return job({pt:telePt,stand:.5,clip:'hy_telescope',loop:true,dur:[40,90],start:()=>AU('sigh')});
   // LEISURE + GRAB: at the real telescope, not mimed in the air a metre away: he stands behind the eyepiece facing along the tube,
   // the calm standing mocap (cm_tele, CMU 77_02 legs + hands held up at the face) is the base, the spine stoops until his eye is
   // at the eyepiece, the left hand cups the tube under the eyepiece, the right rests on top of the tube; now and then he swings it a little
   return job({pt:()=>teleStand(T),stand:.05,clip:IDLE()/* hips over the feet; cm_tele pushed the pelvis 10 cm ahead of the feet (a plank leaning back) */,loop:true,dur:[40,90],vary:false,start:a=>{AU('sigh');a.pan0=T.yoke.rotation.y;},
    look:a=>{const E=T.eye();const d=T.dir();return E.addScaledVector(d,6);},lookW:1,
    post:(a,dt)=>telePost(a,dt,T),end:()=>{play(IDLE(),{fade:.6});try{window.__grab.free(T.tube);}catch(e){}}});},
  look:(o)=>{// LEISURE: out on the deck he goes up to the railing, rests both hands on the top rail and leans on it a little, looking
   // out over the forest (the head sweeps slowly, now and then down at the ground); every so often he straightens up, hands off
   // the rail, and then leans on it again (frame check: he stood in the middle of the deck with his arms hanging for a minute)
   const n=N.deck;const rayD=(x,y,z,dx,dy,dz,len)=>{const r=new RAPIER.Ray({x,y,z},{x:dx,y:dy,z:dz});const h=world.castRay(r,len,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});return h?(h.toi??h.timeOfImpact):null;};const rail=(()=>{if(!n)return null;const f=fwd(n.face??0);/* scan forward with downward rays for the top rail (a thin cap: level rays slip under or over it) */for(let d=.2;d<1.5;d+=.025){const x=n.p.x+f.x*d,z=n.p.z+f.z*d;const dn=rayD(x,n.p.y+1.5,z,0,-1,0,1.6);if(dn==null)continue;const top=1.5-dn;if(top>.75&&top<1.25)return {p:V(x+f.x*.02,n.p.y+top,z+f.z*.02),f};}return null;})();
   const sweep=a=>root.position.clone().add(V(Math.sin(a.T*.22)*6,1.2+Math.sin(a.T*.13)*.6-(a.dwn||0)*1.4,8));
   if(!rail)return job({node:'deck',slide:false,dur:[40,80],look:sweep});
   return job({pt:()=>rail.p.clone(),stand:.27,dur:[40,80],vary:false,clip:IDLE(),
    start:a=>{a.on=1;a.nx=rnd(12,20);},
    look:a=>{const f=rail.f;const hd=bones.Head.getWorldPosition(V());return hd.addScaledVector(f,8).add(V(Math.sin(a.T*.21)*5,-.3+Math.sin(a.T*.13)*.4-(a.dwn||0)*3,0));},lookW:.85,
    tick:(a,dt)=>{H.face=Math.atan2(rail.f.x,rail.f.z);root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*3);{/* in to the rail, belly a hand's width off it (the obstacle box kept him an arm's length back: hands in the air over it) */const gap=rail.p.clone().sub(root.position).dot(rail.f)-.31;const st=clamp(gap,-.2*dt,.2*dt)*(a.on?1:0);if(Math.abs(st)>1e-5)root.position.addScaledVector(rail.f,st);}a.nx-=dt;if(a.nx<0){a.on^=1;a.nx=a.on?rnd(12,20):rnd(3,6);}
     a.hw=clamp((a.hw||0)+(a.on?dt/.8:-dt/.7),0,1);a.dwn=Math.max(0,Math.sin(a.T*.09)-.75)*4;},
    post:(a,dt)=>{const w=smooth(0,1,a.hw||0);if(w<.01)return;const f=rail.f,r=V(-f.z,0,f.x),ax=V(0,1,0).cross(f).normalize();rotW(bones.Spine,ax,.1*w);rotW(bones.Spine1,ax,.06*w);
     const c=V(root.position.x,rail.p.y,root.position.z);c.addScaledVector(f,rail.p.clone().sub(c).dot(f));/* the rail line straight ahead of him */
     /* palms on the top rail, a shoulder width apart (the rail is at his belly) */const tL=c.clone().addScaledVector(r,-.2).addScaledVector(f,-.02).add(V(0,.075,0)),tR=c.clone().addScaledVector(r,.2).addScaledVector(f,-.02).add(V(0,.075,0));const both=()=>{gripNoLean('Left',tL,w);gripNoLean('Right',tR,w);};both();const G=window.__grab;if(G&&G.late)G.late(both);/* again after the head turn and collide moved the chest */}});},
  ledge:(o)=>{// sit on an OPEN edge (no railing, a free drop under it) with the legs hanging over it: the round landing by the gate
   // ladder (the deck has railings all round and its one gap is cramped under the bedroom eave and by the rope ladder)
   // POSE: Pavel 2026-11-23: he sat inside the railing with his legs splayed through the balusters. The spot is now searched
   // for: no railing / post / beam in front of the shins or under the dangling feet, and his legs are never planted on the boards.
   // the edges are fixed boards: a spot found once is kept (EDGE_OK) and checked again on arrival, so a passing prop, a not yet
   // voxelised far shape or a search from the far end of the house never turns a ledge order into another task
   const LN=['land','gate','wstep'];let e0=openEdge(LN);if(e0)EDGE_OK=e0;else e0=EDGE_OK;const a={step:'go',t:0,T:0};const dur=rnd(40,90);
   const node=e0?e0.node:'land';H.ledgeWhy=e0?'':'no edge found from '+(nearNode(root.position)||'?');
   goTo(node,()=>{/* looked at again from the spot itself (the grids near him are built by now) */const e1=openEdge([node]);if(e1)EDGE_OK=e1;const e=e1||e0;if(!e){H.ledgeWhy='no open edge at '+node;endTask(false);return;}a.e=e;const yaw=Math.atan2(e.f.x,e.f.z);
    const tgt=e.p.clone().addScaledVector(e.f,-.12);let tries=0;/* approachTo moves at most 1.2 m per call: step on until the hips are over the edge (he sat 1 m short on the workshop step) */const near=()=>{const sp=V(tgt.x,0,tgt.z).addScaledVector(e.f,.5);const go=()=>Math.hypot(root.position.x-tgt.x,root.position.z-tgt.z)>.06&&++tries<4;approachTo(a,sp,.5,()=>{if(go())near();else seat();});};const seat=()=>{a.step='sit';a.t=0;H.face=yaw;a.hy0=bones.Hips.getWorldPosition(V()).y;
     H.fit={mode:'hold',base:e.y,y:a.hy0,dangle:true};H.ground=false;AU('sigh');};near();});
   // LEISURE: sitting down is one motion: the hips sink while the legs fold over the edge (the dangle clip fades in from
   // the middle of the descent, never a seated pose in mid-air) and both palms go down onto the boards beside the hips to
   // take the weight and stay there while he sits; getting up is the same backwards.
   const SIT=1.7,UP=1.5;const seatY=()=>a.e.y+SEAT_CLEAR;
   const palms=w=>{if(w<.01){a.ik=null;return;}const f=a.e.f,r=V(-f.z,0,f.x);const hp=bones.Hips.getWorldPosition(V());
    a.ik=[['Left',V(hp.x,a.e.y+.03,hp.z).addScaledVector(r,-.24).addScaledVector(f,-.04),w],['Right',V(hp.x,a.e.y+.03,hp.z).addScaledVector(r,.24).addScaledVector(f,-.04),w]];};
   // the legs hang over the drop: thighs along the boards to the edge, knees bent, shins down, a lazy swing (watcher P2: the clip held
   // them nearly straight, sticking out forward at knee height)
   const legsHang=w=>{if(w<.01||!a.e)return;const f=V(a.e.f.x,0,a.e.f.z).normalize();const T=a.T||0;
    for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const hp=U.getWorldPosition(V()),kn=L.getWorldPosition(V()),an=F.getWorldPosition(V());
     const th=hp.distanceTo(kn),sh=kn.distanceTo(an);const lat=kn.clone().sub(hp);lat.addScaledVector(f,-lat.dot(f));lat.y=0;if(lat.length()>.12)lat.setLength(.12);
     const K=hp.clone().addScaledVector(f,th*.96).add(lat).add(V(0,-.04,0));const sw=Math.sin(T*1.25+(s==='Left'?0:2.1))*.07;
     const A=K.clone().add(V(0,-sh*.97,0)).addScaledVector(f,.05+sw);ik2(U,L,F,A,f.clone().add(V(0,.3,0)).normalize(),w,true);
     {/* a relaxed hanging foot: toes ~30 deg pointed from his standing ankle angle (gate: 55 deg, or flexed up as the clip swung) */const T2=bones[s+'ToeBase'];if(T2){F.updateMatrixWorld(true);const k2=L.getWorldPosition(V()),a2=F.getWorldPosition(V()),t2=T2.getWorldPosition(V());const sd=a2.clone().sub(k2).normalize();const pp=f.clone().addScaledVector(sd,-f.dot(sd));if(pp.lengthSq()>1e-6){pp.normalize();const an=50*Math.PI/180;const d=sd.clone().multiplyScalar(Math.cos(an)).addScaledVector(pp,Math.sin(an));turnBone(F,t2,a2.clone().addScaledVector(d,t2.distanceTo(a2)),w);}}}}};
   a.post=()=>{if(a.ik)ikList(a.ik);legsHang(a.lw||0);};
   a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    if(a.step==='sit'){const k=smooth(0,SIT,a.t);H.fit.y=lerp(a.hy0,seatY(),k);a.lw=smooth(SIT*.35,SIT,a.t);if(!a.cl&&a.t>SIT*.35){a.cl=1;play(has('cm_dangle')?'cm_dangle':'hy_dangle',{fade:SIT*.6});}
     palms(smooth(.1,.55,k)*lerp(1,.85,smooth(SIT,SIT+.5,a.t)));if(a.t>SIT+.5){a.step='work';a.t=0;}return;}
    if(a.step==='work'){a.T+=dt;a.lw=1;/* palms stay on the boards beside the hips (the clip's hands hovered in front of the belly) */palms(.85);H.look=root.position.clone().add(V(Math.sin(a.T*.2)*5,.4+Math.sin(a.T*.11)*.5,0)).addScaledVector(a.e.f,6);H.lookW=.8;
     if(a.T>dur){a.step='up';a.t=0;}return;}
    if(a.step==='up'){const k=smooth(.35,UP+.35,a.t);a.lw=1-smooth(0,.6,k);palms(lerp(.85,1,smooth(0,.35,a.t))*(1-smooth(.75,1,k)));if(!a.cl2&&a.t>.45){a.cl2=1;play(IDLE(),{fade:UP*.7});}
     H.fit.y=lerp(seatY(),a.hy0,k);if(a.t>UP+.4){a.ik=null;H.fit=null;H.ground=true;H.floorY=a.e.y;endTask();}}};
   a.leave=cb=>{if(a.step==='sit'||a.step==='work'){a.step='up';a.t=0;const wait=()=>{if(H.fit&&a.step==='up'&&a.t<UP+.4){setTimeout(wait,100);}else{a.ik=null;H.fit=null;H.ground=true;cb();}};wait();}else cb();};
   return a;},
  firewood:(o)=>{const X=window.__ground&&window.__ground.exits&&window.__ground.exits.forest;if(!X||!N.g_wood)return job({pt:()=>PT('woodpile'),stand:.5,clip:'hy_picklog',dur:[2,3]});
   const a={step:'go',t:0};goTo('g_wood',()=>{H.face=N.g_wood.face;a.step='pick';reps('hy_picklog',4+(Math.random()<.5?1:0),()=>{try{(window.__props||P3).grab('logArmful',bones.LeftHand,{offset:V(.1,.12,.1)});}catch(e){}try{window.__audio.carry(true);}catch(e){}
     H.carry='hy_carrylogs';const wp=PT('woodpile');
     // OUTDOOR: the logs go onto the woodpile itself: he walks right up to it and faces it (frame by frame he dropped them at the
     // foot of the kitchen ladder, 1.3 m from the pile, side-on to it)
     const done=()=>{play(IDLE(),{fade:.4});endTask({ok:true,logs:3});};
     if(wp){a.step='drop';visit(a,wp,.5,'hy_droplogs',[[.6,()=>{try{(window.__props||P3).release('logArmful');window.__audio.carry(false);}catch(e){}H.carry=null;}]],done);}
     else goTo('kmid',()=>{try{(window.__props||P3).release('logArmful');window.__audio.carry(false);}catch(e){}H.carry=null;done();});});});
   a.update=dt=>{if(stepTick(a,dt))return;carryOv();};
   a.leave=cb=>{try{(window.__props||P3).release('logArmful');window.__audio.carry(false);}catch(e){}H.carry=null;cb();};a.post=()=>odArmful();return a;},
 });
 // close (or open) the window shutters one window after another: walk up, reach for the shutter, it swings at the touch
 // opts: {close:true|false, windows:['bwin','kwin','wwin']}; house hook: window.__house.shutters.close(name)/open(name) when it exists
 MAKE.shutters=(o={})=>{const a={step:'go',t:0};const close=o.close!==false;const list=(o.windows||WINDOWS).filter(w=>N[w]);
  const go=()=>{const w=list.shift();if(!w){play(IDLE(),{fade:.4});endTask({ok:true,close});return;}const n=N[w];const pt=n.p.clone().addScaledVector(fwd(n.face??0),.5).add(V(0,1.3,0));pt.hand=true;
   visit(a,pt,.4,has('hy_window')?'hy_window':'hy_take',[[.45,()=>{try{const S=window.__house&&window.__house.shutters;S&&(close?S.close(w):S.open(w));}catch(e){}AU(close?'shutter_close':'shutter_open',pt);}]],go);};
  go();a.update=dt=>{stepTick(a,dt);};return a;};
 // house repairs: walk to the worn part (Brain passes opts.pos), kneel / stand and work there with the right tools
 const REPAIR={
  /* a slate at the eave (Brain picks one; pickSlate keeps it only if he can reach it): he walks out only as far as the boards carry him
     and hammers it standing, bent over a chest-high one, straight up for a head-high one */
  fix_shingle:{clip:pos=>hamClip(pos,'hy_shingle'),tools:[['benchHammer','Right']],stand:.55,standFn:pos=>has('hy_standhammer')?safeStand(pos,.38,null,[1.15,1.4]):.55,nail:'roof',def:()=>N.deck&&N.deck.p.clone().add(V(0,.2,-.5))},
  /* one knee down on the boards, bent ~70 deg over the board Brain picked (kneel + hammer mocap, lean baked into the clip data) */
  fix_board:{clip:has('hy_kneelfloor')?'hy_kneelfloor':'hy_nailboard',tools:[['benchHammer','Right']],stand:has('hy_kneelfloor')?.45:.5,nail:'floor',def:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),.8)},
  fix_wall:{nail:'wall',clip:pos=>hamClip(pos,'hy_patchwall'),tools:[['benchHammer','Right']],stand:.45,standFn:pos=>has('hy_standhammer')?safeStand(pos,.36):.45,def:()=>{const w=pick(WINDOWS);const n=N[w];const f=fwd(n.face??0);return n.p.clone().addScaledVector(f,.55).add(V(-f.z*.9,1.2,f.x*.9));}},
  fix_rope:{clip:has('hy_squatwork')?'hy_squatwork':'hy_ropeknot',wipe:'rope',node:'gate',stand:.45,def:()=>N.gate&&N.gate.p.clone().add(V(0,.3,.6))},
  fix_hinge:{clip:null,wipe:'hinge',tools:[['benchWrench','Right']],stand:.45,def:()=>{const P=window.__props||P3;return P&&P.door&&P.door.handle?P.door.handle(V()):null;}},
  fix_window:{clip:null,wipe:true,stand:.5,def:()=>{const ps=panes();const near=ps.filter(q=>Math.abs(q.floor-root.position.y)<.8);const q=pick(near.length?near:ps);if(q){winPick=q;return q.p.clone();}winPick=null;const w=pick(WINDOWS);return N[w].p.clone().addScaledVector(fwd(N[w].face??0),.5).add(V(0,1.3,0));}},
  fix_railing:{nail:'rail',clip:pos=>hamClip(pos,'hy_railing'),standFn:pos=>has('hy_standhammer')?safeStand(pos,.38):.45,tools:[['benchHammer','Right']],stand:.45,def:()=>N.deck&&N.deck.p.clone().add(V(0,1,.6))},
  clear_roof:{clip:'hy_clearleaves',floorHands:true,stand:.6,def:()=>N.deck&&N.deck.p.clone().add(V(-.6,0,-.3))},
  fix_chimney:{clip:null,wipe:'chimney',stand:.45,def:()=>V(-3.2,KT+1.5,1.53)}};
 // ---- the body goes to the work, not the arm ----
 // hammering at a height: below ~0.72 m he kneels on one knee (upright kneel, hands ~0.6 m), waist to chest he stands bent over it,
 // above the chest he straightens up (clips in hero-moves-repair.txt: real CMU kneel / hammer mocap)
 /* kneeling at a floor board: the clip's kneeling knee floats ~6-13 cm (rolled-back rig's leg/root offset). The pelvis comes down until that
    knee (and its toes) rest on the boards; the standing foot is held where it was by leg IK, so only the kneeling leg sinks */
 function kneelDrop(a,dt,g,out){const LK=bones.LeftLeg,RK=bones.RightLeg;if(!LK||!RK||!bones.Hips)return;root.updateMatrixWorld(true);
  a.kw=Math.max(0,Math.min(1,(a.kw||0)+(out?-dt/.4:dt/.6)));if(a.kw<=0)return;
  const ly=LK.getWorldPosition(V()).y,ry=RK.getWorldPosition(V()).y;const K=ly<ry?'Left':'Right',S=K==='Left'?'Right':'Left';
  const kn=bones[K+'Leg'].getWorldPosition(V()).y-g-.065,tb=bones[K+'ToeBase']?bones[K+'ToeBase'].getWorldPosition(V()).y-g-.025:kn;
  const drop=clamp(Math.min(kn,tb),0,.15)*smooth(0,1,a.kw);if(drop<.002)return;
  const F=bones[S+'Foot'],fp=F.getWorldPosition(V());const Hp=bones.Hips;const hw=Hp.getWorldPosition(V());hw.y-=drop;Hp.position.copy(Hp.parent.worldToLocal(hw));Hp.updateMatrixWorld(true);
  const U=bones[S+'UpLeg'],L=bones[S+'Leg'];const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());const pole=k.clone().sub(hp.clone().add(fp).multiplyScalar(.5));ik2(U,L,F,fp,pole,1,true);}
 function floorOf(pos){const nn=nearNode(pos);if(!nn||!N[nn])return root.position.y;const f=N[nn].p;const g=floorAt(f.x,f.y+.3,f.z,.45,.9);return g!=null?g:f.y;}
 function hamClip(pos,old){if(!pos||!has('hy_standhammer'))return old;const dy=pos.y-floorOf(pos);
  return dy<.72&&has('hy_kneelhammer')?'hy_kneelhammer':dy>1.1&&has('hy_hammerhigh')?'hy_hammerhigh':'hy_standhammer';}
 // how close he can stand to a work point out over the edge: walk the line toward it, keep only boards at his own level (and a hand's
 // width beyond his toes), never inside a wall or under a beam; returns the stand-off for approachTo
 function safeStand(pt,min,from,hs){const p0=from||root.position;const g0=floorAt(p0.x,p0.y+.3,p0.z,.45,.9);const p=V(p0.x,g0!=null?g0:p0.y,p0.z);/* a graph node may sit above the boards (a ladder top) */const dx=pt.x-p.x,dz=pt.z-p.z,d=Math.hypot(dx,dz);if(d<1e-3)return min;const ux=dx/d,uz=dz/d;const C=window.__collide;
  let ok=0;for(let t=0;t<=d-min+1e-6;t+=.05){let good=true;for(const e of [0,.22]){const x=p.x+ux*(t+e),z=p.z+uz*(t+e);const g=floorAt(x,p.y+.3,z,.45,.5);if(g==null||Math.abs(g-p.y)>.12){good=false;break;}}
   if(good&&C&&C.depthAt){const x=p.x+ux*t,z=p.z+uz*t;for(const hy of hs||[.2,.5,.75,1,1.25])if(C.depthAt(x,p.y+hy,z)>.01){good=false;break;}}if(!good)break;ok=t;}
  return Math.max(min,d-ok);}
 // a part he can really reach (Pavel: the body goes to the work): from the walkable spot next to it, standing where the boards end, the
 // nail must be within an arm and a hammer, at a height one of the work poses serves, with room for his body. Brain's pick stays when it
 // qualifies, else the most worn one nearby that does (o.pos / o.target updated, so Brain marks the part he really fixed).
 const PART={shingle:{lo:.75,hi:1.3,st:.88,hs:[1.15,1.4]}/* over a railing: only the head and chest need room */,beam:{lo:.6,hi:1.3,st:.45},wall:{lo:.35,hi:1.4,st:.42},floor:{floor:true}};
 function reachOK(kind,pos){const L=PART[kind];const q=V(...pos);const nn=nearNode(q);if(!nn||!N[nn])return false;const f=N[nn].p;const C=window.__collide;
  if(L.floor){if(Math.abs(q.y-f.y)>.15)return false;const u=V(f.x-q.x,0,f.z-q.z);if(u.lengthSq()<1e-4)u.set(1,0,0);u.normalize();
   for(const t of [.35,.55,.8]){const x=q.x+u.x*t,z=q.z+u.z*t;const g=floorAt(x,f.y+.3,z,.45,.5);if(g==null||Math.abs(g-f.y)>.1)return false;if(C&&C.depthAt)for(const hy of [.15,.5,.9])if(C.depthAt(x,f.y+hy,z)>.01)return false;}
   if(C&&C.depthAt&&C.depthAt(q.x,f.y+.25,q.z)>.01)return false;return true;}
  const g=floorAt(f.x,f.y+.3,f.z,.45,.9);const dy=q.y-(g!=null?g:f.y);if(dy<L.lo||dy>L.hi)return false;const st=safeStand(q,.38,f,L.hs);/* approachTo walks at most 1.2 m off the node */const dd=Math.hypot(q.x-f.x,q.z-f.z);if(!(st<=L.st&&dd-st<=1.19))return false;
  /* and his head fits there (approachTo steps back from a low eave: then the part would be out of reach) */if(C&&C.depthAt&&dd>1e-3){const k=(dd-st)/dd,x=f.x+(q.x-f.x)*k,z=f.z+(q.z-f.z)*k,y=g!=null?g:f.y;for(const hy of [1.5,1.68,1.82])if(C.depthAt(x,y+hy,z)>.005)return false;}return true;}

 const PKIND={fix_shingle:'shingle',fix_railing:'beam',fix_wall:'wall',fix_board:'floor'};
 /* a floor board to kneel at needs room round it for the hammer arm and the knee (not tight against the bunk bed or a chest) */
 function floorClear(x,y,z){const C=window.__collide;if(!C||!C.depthAt)return true;for(const r of [0,.2,.35])for(let i=0;i<(r?8:1);i++){const a=i*Math.PI/4;const px=x+Math.sin(a)*r,pz=z+Math.cos(a)*r;for(const h of [.12,.35,.6])if(C.depthAt(px,y+h,pz)>.005)return false;
   for(const b of furnBoxes())if(px>b.min.x-.05&&px<b.max.x+.05&&pz>b.min.z-.05&&pz<b.max.z+.05&&y+.6>b.min.y&&y+.12<b.max.y)return false;/* the bunk bed, the stove, a chair: furniture has no colliders */}return true;}
 let FB=null;function furnBoxes(){if(FB)return FB;FB=[];let s=root;while(s.parent)s=s.parent;s.traverse(o=>{if(/^(stove|counter|fridge|bunkbed|chair|toolwall|telescope|woodpile|pantry|table|chest|barrel|bench)$/i.test(o.name||'')){const b=new THREE.Box3().setFromObject(o);if(!b.isEmpty())FB.push(b);}});return FB;}
 function roomyFloor(o){const p=V(...o.pos);const g0=floorAt(p.x,p.y+.3,p.z,.45,.6);const y=g0!=null?g0:p.y;if(floorClear(p.x,y,p.z))return;
  for(const r of [.3,.6,.9,1.2])for(let i=0;i<12;i++){const a=i*Math.PI/6,x=p.x+Math.sin(a)*r,z=p.z+Math.cos(a)*r;const g=floorAt(x,y+.3,z,.45,.6);if(g==null||Math.abs(g-y)>.05)continue;if(floorClear(x,g,z)){o.pos=[x,g,z];return;}}}
 function pickPart(k,o){if(PKIND[k]&&!o.pos&&REPAIR[k].def){const d=REPAIR[k].def();if(d)o.pos=d.toArray();}if(PKIND[k]==='floor'&&o.pos){try{roomyFloor(o);}catch(e){}}const kind=PKIND[k];const P=window.__planks;if(!kind||!P||!P.list||!o.pos)return;if(reachOK(kind,o.pos))return;const want=V(...o.pos);
  let best=null,bs=1e9;for(const c of P.list(kind)){const d=Math.hypot(c.pos[0]-want.x,c.pos[1]-want.y,c.pos[2]-want.z);const sc=d*.3+(c.fresh||0)*2;if(sc>=bs||!reachOK(kind,c.pos))continue;bs=sc;best=c;}
  if(best){o.pos=best.pos.slice();o.target=best.id;}}
 // where the hammer face lands: the floor board's top, the wall / rail / slate point itself; and the surface normal the blow comes down along
 function nailOf(R,pos){if(!pos)return null;let q=pos.clone();if(R.nail==='roof'){/* the slate's lower edge, the side toward him */const h=V(root.position.x-q.x,0,root.position.z-q.z);if(h.lengthSq()>1e-4){h.normalize();q.addScaledVector(h,.1).y-=.06;}
   /* the first roof surface on the way from his shoulder (the eave edge is nearer than a slate's middle) */
   const sh=bones.RightArm.getWorldPosition(V());const v=q.clone().sub(sh);const L=v.length();if(L>.05){v.normalize();const r=new RAPIER.Ray({x:sh.x,y:sh.y,z:sh.z},{x:v.x,y:v.y,z:v.z});
    const hh=world.castRay(r,L+.05,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});const t=hh?(hh.toi??hh.timeOfImpact):null;if(t!=null&&t>.25&&t<L)q=sh.clone().addScaledVector(v,t-.005);}}if(R.nail==='floor'){const hp=bones.Hips.getWorldPosition(V());
   const f=bones.LeftUpLeg.getWorldPosition(V()).sub(bones.RightUpLeg.getWorldPosition(V())).cross(V(0,1,0)).setY(0).normalize();/* the way the pelvis faces */
   const d=V(q.x-hp.x,0,q.z-hp.z);const ah=d.dot(f),sd=Math.sqrt(Math.max(0,d.lengthSq()-ah*ah));/* the knee goes down within reach of the board: the nail is where the hand comes down, ~40 cm ahead of the pelvis */q=hp.clone().addScaledVector(f,window.__nail0?clamp(ah,.34,.42):clamp(ah,.2,.24)).add(V(-f.z*(window.__nail0?.08:.2),0,f.x*(window.__nail0?.08:.2)));
   const g=floorAt(q.x,root.position.y+.2,q.z,.5,.6);q.y=(g!=null?g:root.position.y)+.005;}
  else if(R.nail==='wall'&&bones.RightArm.getWorldPosition(V()).distanceTo(q)>armLen+.3){/* the picked board is out of reach (a desk, a bunk in the way): the wall right in front of him */
   const f=bones.LeftUpLeg.getWorldPosition(V()).sub(bones.RightUpLeg.getWorldPosition(V())).cross(V(0,1,0)).setY(0).normalize();const hp=bones.Hips.getWorldPosition(V());
   const y=clamp(q.y,root.position.y+.5,root.position.y+1.25);const r=new RAPIER.Ray({x:hp.x,y,z:hp.z},{x:f.x,y:0,z:f.z});const h=world.castRay(r,.9,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});
   const t=h?(h.toi??h.timeOfImpact):null;if(t!=null&&t>.2)q=V(hp.x+f.x*(t-.005),y,hp.z+f.z*(t-.005));}
  return q;}
 function nrmOf(R,pos){const h=V(root.position.x-pos.x,0,root.position.z-pos.z);if(h.lengthSq()<1e-6)return V(0,1,0);h.normalize();
  return R.nail==='wall'?h:R.nail==='roof'?h.multiplyScalar(.6).add(V(0,1,0)).normalize():V(0,1,0);}
 // the blow: the clip gives the body and the rhythm, this puts the fist so the hammer FACE lands on the nail. Lift (0-50 %), hold, drop
 // (60-70 %), rest. The wrist target is corrected by the face's measured miss (the hammer hangs off the fist), the left hand steadies the work.
 const HFACE=[.102,.146,0];
 function repairHammer(a,dt,nail,nrm){const P=window.__props||P3;const hm=P&&P.tools&&P.tools.benchHammer;if(!hm||!nail||!bones.RightArm)return;a.nail=nail;
  const sh=bones.RightArm.getWorldPosition(V());const S=a.hm||(a.hm={ph:Math.random()*.3,w:0,n:0,T:rnd(.72,.9)});
  /* out of reach (hysteresis, so it never flickers): the IK fades out over half a second and the clip swings alone */
  const dn=sh.distanceTo(nail);a.hmFar=a.hmFar?dn>armLen+.42:dn>armLen+.5;const fade=a.endIn!=null&&a.endIn<.9;S.w=a.hmFar||fade?Math.max(0,S.w-dt/(S.fastOut?.33:fade?.7:.5)):Math.min(1,S.w+dt/.6);if(S.w<=0)return;S.ph+=dt;if(S.ph>S.T){S.ph-=S.T;S.T=rnd(.72,.9);S.hit=0;S.n++;if(S.n%6===5)S.ph-=rnd(.6,1.1);}
  H.noPop={side:'Right',until:performance.now()+150};/* motion.js: the blow is sharp on purpose */
  const u=S.ph/S.T;const lift=u<0?0:u<.5?smooth(0,.5,u):u<.6?1:u<.8?1-Math.pow((u-.6)/.2,2):0;
  const up=nrm.clone().normalize();const d=nail.clone().sub(sh);d.addScaledVector(up,-d.dot(up));if(d.lengthSq()<1e-4)d.set(0,0,1);d.normalize();
  // fist at impact: a handle's length back toward him and a little up; lifted: up and back round the elbow
  const hit=nail.clone().addScaledVector(d,-.24).addScaledVector(up,.06);const T=hit.clone().addScaledVector(up,.15*lift).addScaledVector(d,-.07*lift);
  const pole=V(0,-1,0).addScaledVector(d,-.3);
  const w=S.w;const solve=()=>{root.updateMatrixWorld(true);const PG0=window.__poseGuard;
   /* still out of reach: he leans in from the hips (spine bent toward the nail, eased, at most ~30 deg), never the arm stretching */
   {const hp=bones.Hips.getWorldPosition(V());const dir=V(nail.x-hp.x,0,nail.z-hp.z);const s0=bones.RightArm.getWorldPosition(V());const need=s0.distanceTo(nail)-(armLen+(window.__lean0?.17:.06));
    S.lean=(S.lean||0)+(clamp(need/.5,0,window.__lean0?.55:.85)-(S.lean||0))*(1-Math.exp(-dt*4));if(S.lean>.005&&dir.lengthSq()>1e-4){const ax=V(0,1,0).cross(dir.normalize()).normalize();
     for(const n of ['Spine','Spine1','Spine2']){const b=bones[n];if(!b)continue;const qw=new THREE.Quaternion().setFromAxisAngle(ax,S.lean/3);const bw=b.getWorldQuaternion(new THREE.Quaternion());const pq=b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(pq.invert().multiply(qw.multiply(bw)));b.updateMatrixWorld(true);}}}
   /* the back inside its range before the arm is solved on it (else the guard straightens it afterwards and carries the fist off the nail) */
   if(PG0&&PG0.fit&&!window.__noFit){for(const n of ['Spine','Spine1','Spine2'])if(bones[n])PG0.fit(bones[n]);if(PG0.fitSpine)PG0.fitSpine();bones.Hips.updateMatrixWorld(true);}
   {const ls=bones.LeftArm.getWorldPosition(V());const k=d.clone().cross(up).normalize();const lp=nail.clone().addScaledVector(k,-.13).addScaledVector(d,-.05).addScaledVector(up,.045);/* the wrist a palm above the surface: the hand rests ON it */if(ls.distanceTo(lp)<armLen*.95)armIK('Left',lp,V(0,-1,0),w*.9);}
   /* the face, not the fist, goes onto the nail: the hammer is turned whole (handle along the blow, face toward the surface, raised
      back round the wrist while lifting), the hand follows it, and the wrist target is corrected by the face's measured miss */
   const k=d.clone().cross(up).normalize();
   /* a low nail (floor, a kneeling blow): the handle comes down steeper at impact so the fist stays within the arm's reach */
   let al=0;for(let t=0;t<=1.1;t+=.05){al=t;const q=new THREE.Quaternion().setFromAxisAngle(k,-t);const y=d.clone().applyQuaternion(q),x=up.clone().negate().applyQuaternion(q);
    const g=nail.clone().addScaledVector(y,-.23).addScaledVector(x,-.1);if(g.distanceTo(sh)<=armLen*.97)break;}
   /* the hammer's pose (handle steepness al, handle turned sideways yw) is the one the arm can really give with the wrist and forearm
      inside their range: a few candidates are solved and the one with the face nearest the nail wins; both ease, never flip */
   const mkQh=(al_,yw)=>{const dd=d.clone().applyAxisAngle(up,yw),kk=dd.clone().cross(up).normalize();const R=new THREE.Quaternion().setFromAxisAngle(kk,-.75*lift-al_);
    const Y=dd.applyQuaternion(R),X=up.clone().negate().applyQuaternion(R);const Z=X.clone().cross(Y);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X,Y,Z)).multiply(hm.quaternion.clone().invert());};
   if(S.al==null){S.al=al;S.yw=0;}let Qh=mkQh(S.al,S.yw);
   const hb=bones.RightHand;const want=nail.clone().addScaledVector(up,.2*lift).addScaledVector(d,-.07*lift);
   /* solved at full weight, then blended from the clip's arm by w (iterating at weight w compounded to ~1-(1-w)^8: a 20+ cm snap on the first frame) */
   const AB=[bones.RightArm,bones.RightForeArm,hb],q0=AB.map(b=>b.quaternion.clone());
   /* inside the joints' range (pose.js guard): the arm and wrist are fitted here, and the fist goes wherever the face then needs it,
      instead of the guard bending the wrist back afterwards (the face landed 40 cm off the nail) */
   const PG=window.__poseGuard,fit=PG&&PG.fit&&!window.__noFit?b=>PG.fit(b):()=>0;
   /* the wrist holds the hammer as the clip's own fist does (its natural grip, inside the wrist's range); the forearm rolls about its
      own axis (pronation, the wrist stays put) until the head points into the surface, and the arm carries the face onto the nail.
      (A world-fixed hammer bent the wrist 45-50 deg past its range, and the guard then threw the face 40 cm off the nail) */
   const fa=bones.RightForeArm,Hn=(!window.__hnClip&&PG&&PG.rest&&PG.rest(hb))||q0[2].clone(),qy=new THREE.Quaternion(),Y1=V(0,1,0),into=up.clone().negate();
   const poseAt=tgt=>{armIK('Right',tgt,pole,1);fit(bones.RightArm);bones.RightArm.updateMatrixWorld(true);
     hb.quaternion.copy(Hn);hb.updateMatrixWorld(true);hm.updateMatrixWorld(true);
     {const ax=V(0,1,0).applyQuaternion(fa.getWorldQuaternion(new THREE.Quaternion())).normalize();const hx=V(1,0,0).applyQuaternion(hm.getWorldQuaternion(new THREE.Quaternion()));
      const p1=hx.addScaledVector(ax,-hx.dot(ax)),p2=into.clone().addScaledVector(ax,-into.dot(ax));
      if(p1.lengthSq()>1e-4&&p2.lengthSq()>1e-4){p1.normalize();p2.normalize();const ph=Math.atan2(p1.clone().cross(p2).dot(ax),p1.dot(p2));fa.quaternion.multiply(qy.setFromAxisAngle(Y1,ph));fit(fa);fa.updateMatrixWorld(true);hm.updateMatrixWorld(true);}}
     /* then the wrist bends the rest of the way to the hammer's pose, as far as its range allows */
     if(!window.__noWristQ){hb.quaternion.copy(fa.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(Qh));fit(hb);hb.updateMatrixWorld(true);hm.updateMatrixWorld(true);}};
   const run=n=>{AB.forEach((b,i)=>b.quaternion.copy(q0[i]));bones.RightArm.updateMatrixWorld(true);let tgt=T.clone(),err=9;for(let i=0;i<n;i++){poseAt(tgt);
     const f=hm.localToWorld(V(...HFACE));const e=want.clone().sub(f);err=e.length();if(window.__hmDbg)(S.errs=S.errs||[]).push(+err.toFixed(3),+tgt.distanceTo(sh).toFixed(3));if(err<.006)break;tgt.add(e);const off=tgt.clone().sub(T);if(off.length()>.45)tgt.copy(T).add(off.setLength(.45));}return err;};
   /* the hammer's steepness (al) and sideways turn (yw) are the ones this arm can really give inside its range: a few are tried
      and the nearest face wins; both ease toward it, never flip */
   if(PG&&PG.fit&&!window.__noFit&&!window.__noSearch){let ba=S.al,by=S.yw,be=1e9;for(const ca of [0,.25,.5,.75,1,1.25,S.al])for(const cy of [-.5,0,.5,S.yw]){Qh=mkQh(ca,cy);const e=run(4)+.02*Math.abs(ca-S.al)+.02*Math.abs(cy-S.yw);if(e<be){be=e;ba=ca;by=cy;}}
    const kk=1-Math.exp(-dt*5);S.al+=(ba-S.al)*kk;S.yw+=(by-S.yw)*kk;Qh=mkQh(S.al,S.yw);}
   S.errs=[];S.e=run(10);
   if(w<.999){AB.forEach((b,i)=>{const q=b.quaternion.clone();b.quaternion.copy(q0[i]).slerp(q,w);});bones.RightArm.updateMatrixWorld(true);hm.updateMatrixWorld(true);}
   /* never a one-frame teleport of the fist (QA: 83 cm/frame2 on the kitchen-ladder railing, an elbow flip near full reach): against the
      motion of the last two frames the wrist may deviate at most 8 cm per frame (the blow itself stays well inside that) */
   {const hp=hb.getWorldPosition(V());const fresh=S.lt!=null&&Math.abs(a.T-S.lt-dt)<1e-3;S.lt=a.T;
    if(fresh&&S.p1&&S.T1&&!window.__noClamp){const pred=S.p1.clone().add(T).sub(S.T1);/* where the fist would be if it only followed the blow's own target */const dv=hp.clone().sub(pred);if(dv.length()>.08){poseAt(pred.add(dv.setLength(.08)));hp.copy(hb.getWorldPosition(V()));}}
    else if(!fresh){S.p1=null;}S.p1=hp;S.T1=T.clone();}};
  /* after look / collide have moved the chest (grab.js late slot), else right here */
  const G=window.__grab;if(G&&G.late)G.late(solve);else solve();
  if(u>=.8&&!S.hit&&S.w>.9&&!a.hmFar){S.hit=1;AU('nails',nail);}}
 /* the window pane / wall he works on: the nearest solid surface round the spot at chest height (ray in 16 directions) */
 /* the real window panes (thin, nearly clear glass in the house walls; the walk graph's window nodes face the open front instead):
    centre, the side the room is on, and the floor under it. Found once in the scene */
 let PANES=null,winPick=null;function panes(){if(PANES)return PANES;PANES=[];let sc=root;while(sc.parent)sc=sc.parent;const B=new THREE.Box3(),sz=V(),c=V();
  sc.traverse(o=>{if(!o.isMesh)return;let x=o;while(x){if(x===root)return;x=x.parent;}const m=Array.isArray(o.material)?o.material[0]:o.material;if(!m||!m.transparent||m.opacity>.25)return;
   B.setFromObject(o);B.getSize(sz);B.getCenter(c);if(sz.y<.5||sz.y>1.2||Math.min(sz.x,sz.z)>.02||Math.max(sz.x,sz.z)<.5||Math.max(sz.x,sz.z)>1.2)return;
   let best=null,bd=1e9;for(const k in N){const p=N[k].p;const dy=c.y-p.y;if(dy<.8||dy>1.9)continue;const d=Math.hypot(p.x-c.x,p.z-c.z);if(d<bd){bd=d;best=p;}}if(!best||bd>3)return;
   const n=sz.x<sz.z?V(Math.sign(best.x-c.x)||1,0,0):V(0,0,Math.sign(best.z-c.z)||1);PANES.push({p:c.clone(),n,floor:best.y,w:Math.max(sz.x,sz.z)});});return PANES;}
 /* the door's upper hinge (the leaf's edge opposite the handle), the side of the leaf he is on, and where the other hand steadies the leaf */
 function hingeW(){const P=window.__props||P3;const d=P&&P.door;const D=d&&d.obj&&d.obj.userData.door;if(!D||!D.piv||!D.piv.children[0])return null;const leaf=D.piv.children[0];leaf.updateMatrixWorld(true);
  const p=leaf.localToWorld(V(D.w/2-.05,D.h*.78,0));const n=V(0,0,1).transformDirection(leaf.matrixWorld).setY(0).normalize();const hd=d.handle(V());
  if(root.position.clone().sub(p).setY(0).dot(n)<0)n.negate();const along=hd.clone().sub(p).setY(0);along.addScaledVector(n,-along.dot(n));along.normalize();
  return {p,n,fixed:true,t:0,lv:along.multiplyScalar(.28).add(V(0,-.22,0))};}
 /* squatting work at the boards (scooping leaves): a hand that the clip puts into the floor is lifted onto it (arm IK, held a palm above) */
 /* squatting at the boards (scooping leaves, the rope knots): the clip's feet hover a few cm; the pelvis comes down until the lower foot
    stands on the boards (both legs move together, so nothing else changes) */
 /* squatting on the boards: the pelvis goes down until the lower sole is on them. Applied before the legs are planted (preLeg, right
    after the clip and motion.js): done after, it fought the sole lock (feet pinned, then let go) and the whole body bobbed 27-35 cm */
 function squatDrop(a,dt,g,out){a.sq={g,out};if(!a.preLeg)a.preLeg=dt2=>{if(a.sq)squatApply(a,dt2,a.sq.g,a.sq.out);};if(window.__sqLate)squatApply(a,dt,g,out);}
 function squatApply(a,dt,g,out){if(!bones.Hips)return;a.sw2=Math.max(0,Math.min(1,(a.sw2||0)+(out?-dt/.4:dt/.6)));if(a.sw2<=0)return;root.updateMatrixWorld(true);
  let m=9;for(const sd of ['Left','Right']){const F=bones[sd+'Foot'],T=bones[sd+'ToeBase'];if(F)m=Math.min(m,F.getWorldPosition(V()).y-g-(POSE.ankle??.1));if(T)m=Math.min(m,T.getWorldPosition(V()).y-g-.025);}
  const drop=clamp(m,0,.15)*smooth(0,1,a.sw2);if(drop<.002)return;const Hp=bones.Hips;const hw=Hp.getWorldPosition(V());hw.y-=drop;Hp.position.copy(Hp.parent.worldToLocal(hw));Hp.updateMatrixWorld(true);}
 function handsOnFloor(g){const G=window.__grab;const f=()=>{root.updateMatrixWorld(true);for(const sd of ['Left','Right']){const h=bones[sd+'Hand'];if(!h)continue;const p=h.getWorldPosition(V());const fl=g+.045;
   const d=p.y-fl;if(d<.03){const t=p.clone();t.y=fl+(d<-.03?0:(d+.03)*(d+.03)/.12);/* soft clamp (C1): eases onto the boards, never a hard stop */armIK(sd,t,V(0,-1,0).addScaledVector(fwd(root.rotation.y),-.4),1);}}};if(G&&G.late)G.late(f);else f();}
 /* the rope ladder at the gate: its two side ropes are tied at the landing edge; he squats there and works one knot, then the other */
 function ropeW(){const L=(window.__ladders||[]).find(l=>l.rope&&N.gate&&Math.abs(l.x-N.gate.p.x)<.6&&Math.abs(l.rungs[l.rungs.length-1].y-N.gate.p.y)<.5);if(!L)return null;const top=L.rungs[L.rungs.length-1];
  const out=V(top.x-N.gate.p.x,0,top.z-N.gate.p.z);if(out.lengthSq()<1e-4)out.set(0,0,1);out.normalize();const side=V(out.z,0,-out.x);const edge=V(top.x,N.gate.p.y+.06,top.z).addScaledVector(out,-.07);
  const W={p:edge.clone(),n:out.clone().negate(),fixed:true,t:0,lv:V(0,-.02,0).addScaledVector(out,-.09),at:edge.clone().addScaledVector(out,-.5).setY(N.gate.p.y),k:0,sg:1,sw:0};
  W.upd=(a,dt)=>{W.sw-=dt;if(W.sw<=0){W.sw=rnd(5,8);W.sg=-W.sg;}const want=edge.clone().addScaledVector(side,W.sg*top.half*.9);if(!W.k){W.k=1;W.p.copy(want);}W.p.lerp(want,1-Math.exp(-dt*2.2));
   W.lv.copy(V(0,-.02,0).addScaledVector(out,-.09).addScaledVector(side,-W.sg*.05));};return W;}
  function chimneyW(){/* the stovepipe's hood over the cold stove: soot wiped off its front slope where the pipe leaves it (the pipe itself runs
    under the ceiling and up outside the bedroom wall, out of reach); right hand wipes, left steadies on the rim's edge */
  const at=V(-3.25,KT,2.1);const p=V(-3.2,KT+1.5,1.53);return {p,n:V(0,0,1),fixed:true,circle:true,t:0,lv:V(-.3,-.06,.06),at};}
 function wallNear(pt){let best=null;for(let i=0;i<16;i++){const a=i*Math.PI/8,d={x:Math.sin(a),y:0,z:Math.cos(a)};const r=new RAPIER.Ray({x:pt.x,y:pt.y,z:pt.z},d);
   const h=world.castRayAndGetNormal(r,1.4,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});const t=h?(h.toi??h.timeOfImpact):null;
   if(t!=null&&t>.05&&Math.abs(h.normal.y)<.4&&(!best||t<best.t))best={t,p:V(pt.x+d.x*t,pt.y,pt.z+d.z*t),n:V(h.normal.x,0,h.normal.z).normalize()};}return best;}
 /* cleaning / mending a window: palms ON the glass (never through it). The right hand wipes small circles with the rag, the left
    steadies itself on the frame; both wrists sit a palm's depth off the pane, solved with arm IK on the plane the ray found */
 function wipeWindow(a,dt,W,out){if(W&&!out)H.face=Math.atan2(-W.n.x,-W.n.z);a.ww=Math.max(0,Math.min(1,(a.ww||0)+(out?-dt/.5:dt/.7)));if(a.ww<=0||!W)return;const w=smooth(0,1,a.ww);
  const n=W.n,up=V(0,1,0),s=up.clone().cross(n).normalize();if(bones.RightArm.getWorldPosition(V()).sub(bones.LeftArm.getWorldPosition(V())).dot(s)<0)s.negate();/* s: toward his right shoulder (measured) */
  const chest=bones.Spine2?bones.Spine2.getWorldPosition(V()):root.position.clone().add(V(0,1.3,0));const dw=chest.clone().sub(W.p).dot(n);
  if(dw>.75){return;}/* too far to touch: the clip alone */a.wt=(a.wt||0)+dt;const ph=a.wt*Math.PI*2/1.6;
  const base=W.fixed?W.p.clone():W.p.clone().setY(clamp(chest.y-.05,W.p.y-.25,W.p.y+.3));if(!W.fixed){const sd=chest.clone().sub(base).dot(s);base.addScaledVector(s,sd);}
  const G=window.__grab;const solve=()=>{root.updateMatrixWorld(true);
   const rt=W.fixed&&W.circle?base.clone().addScaledVector(n,.09).addScaledVector(s,Math.cos(ph)*.07).addScaledVector(up,Math.sin(ph)*.04)
     :W.fixed?base.clone().addScaledVector(n,.075).addScaledVector(up,Math.sin(ph*1.6)*.025)/* dabbing oil into the hinge knuckle */
     :base.clone().addScaledVector(n,.09).addScaledVector(s,.12+Math.cos(ph)*.08).addScaledVector(up,.05+Math.sin(ph)*.07);
   const lt=W.fixed?base.clone().addScaledVector(n,.075).add(W.lv):base.clone().addScaledVector(n,.09).addScaledVector(s,-.2).addScaledVector(up,.1);
   /* just out of reach (a pipe under the ceiling, a high hinge): he leans in from the hips, eased, never the arm stretching */
   {const s0=bones.RightArm.getWorldPosition(V());const need=s0.distanceTo(rt)-armLen*.97;a.wl=(a.wl||0)+(clamp(need/.45,0,.45)*w-(a.wl||0))*(1-Math.exp(-dt*3));
    const dir=rt.clone().sub(bones.Hips.getWorldPosition(V())).setY(0);if(a.wl>.005&&dir.lengthSq()>1e-4){const ax=V(0,1,0).cross(dir.normalize()).normalize();
     for(const nm of ['Spine','Spine1','Spine2']){const b=bones[nm];if(!b)continue;const qw=new THREE.Quaternion().setFromAxisAngle(ax,a.wl/3);const bw=b.getWorldQuaternion(new THREE.Quaternion());const pq=b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(pq.invert().multiply(qw.multiply(bw)));b.updateMatrixWorld(true);}}}
   armIK('Right',rt,V(0,-1,0).addScaledVector(s,.5),w);armIK('Left',lt,V(0,-1,0).addScaledVector(s,-.5),w*.9);};
  if(G&&G.late)G.late(solve);else solve();}
 for(const [k,R] of Object.entries(REPAIR))MAKE[k]=(o={})=>{if(has('hy_standhammer'))try{pickPart(k,o);}catch(e){}const pos=o.pos?V(...o.pos):(R.def?R.def():null);
  const hamr=/benchHammer/.test(JSON.stringify(R.tools||[]));const clip=typeof R.clip==='function'?R.clip(o.pos?pos:null):R.clip;
  const D=rnd(18,35);/* known here, so the blow's IK fades out before the job ends (no snap back to the clip) */
  const W0=R.wipe==='hinge'?hingeW():R.wipe==='rope'?ropeW():R.wipe==='chimney'?chimneyW():R.wipe&&pos?(winPick&&winPick.p.distanceTo(pos)<.01?{p:winPick.p.clone(),n:winPick.n.clone(),t:0}:wallNear(pos)):null;/* the window: walk up to the pane itself, not to a point in front of it */
  const J=job({noCut:!!(R.standFn&&o.pos),/* the stand is measured from the node the part was checked from: no short cut off the route */faceYaw:W0?Math.atan2(-W0.n.x,-W0.n.z):null,pt:()=>W0?(W0.at?W0.at.clone():W0.p.clone().addScaledVector(W0.n,.42)):pos,/* the spot ~42 cm in front of the pane, then he turns to face it */node:pos?null:R.node,get stand(){return W0?.02:R.standFn&&o.pos?R.standFn(pos):R.stand;},clip,loop:true,dur:[D,D],tools:R.tools||[],vary:hamr&&has('hy_standhammer')?false:undefined,/* no look-round pauses mid-blow */
   post:R.floorHands?(a,dt)=>{squatDrop(a,dt,floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y,D-a.T<.6);handsOnFloor(floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y);}:R.wipe&&pos?(a,dt)=>{const W=a.win||(a.win=W0);if(W&&W.upd)W.upd(a,dt);if(R.wipe==='rope')squatDrop(a,dt,floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y,D-a.T<.6);wipeWindow(a,dt,W,D-a.T<.8);}:hamr&&has('hy_standhammer')&&pos?(a,dt)=>{if(R.nail==='floor')kneelDrop(a,dt,floorOf(pos),D-a.T<.6);/* a floor nail is placed once he has knelt (the pelvis still turns for the first moments of the kneel) */if(R.nail==='floor'&&(a.nlT=(a.nlT||0)+dt)<1.2&&!window.__nail0)a.nl=null;const n=a.nl||(a.nl=nailOf(R,pos));
     /* a wall or rail nail right under his chin can't be struck with a hammer held in a real wrist: the blow goes a little to his right
        along the board instead (the same board, ~0.58 m from the shoulder) */
     if(!a.nlFix&&R.nail!=='floor'&&R.nail!=='roof'&&!window.__nail0&&a.T>.3){a.nlFix=1;const sh=bones.RightArm.getWorldPosition(V());const nr=nrmOf(R,n);const tg=V(0,1,0).cross(nr);
      if(tg.lengthSq()>1e-3&&sh.distanceTo(n)<.55){tg.normalize();const f=V(Math.sin(H.face),0,Math.cos(H.face));if(tg.dot(V(-f.z,0,f.x))<0)tg.negate();
       const w0=n.clone().sub(sh);const b=w0.dot(tg),c=w0.lengthSq()-.58*.58;const sl=-b+Math.sqrt(Math.max(0,b*b-c));n.addScaledVector(tg,Math.min(.4,Math.max(0,sl)));}}
     a.endIn=D-a.T;repairHammer(a,dt,n,nrmOf(R,n));}:undefined,
   tick:(a,dt)=>{if(!/hammer|nail/i.test(JSON.stringify(R.tools||[])))return;if(hamr&&a.hm&&!a.hmFar)return;a.ct=(a.ct||0)+dt;if(a.ct>1.3){a.ct=0;AU('nails',pos);}},result:()=>({ok:true,target:o.target})});
  /* called away mid-blow (Brain, the tour): the arm eases back to the clip over a third of a second instead of snapping */
  if(J.post){const p0=J.post;J.post=dt=>{p0(dt);if(J.step!=='work'&&J.ww>0)wipeWindow(J,dt,J.win,true);if(J.step!=='work'&&J.sw2>0)squatDrop(J,dt,floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y,true);if(J.step!=='work'&&J.kw>0&&R.nail==='floor')kneelDrop(J,dt,floorOf(pos),true);if(J.step!=='work'&&J.hm&&J.hm.w>0&&J.nl){J.endIn=0;J.hm.fastOut=1;repairHammer(J,dt,J.nl,nrmOf(R,J.nl));}};}
  return J;};
 // ===================== gear: a skinned coat that really follows the body, bow and quiver from the workshop wall =====================
 // the coat is cut from the body mesh itself (torso + arms, pushed out 1.5 cm along the normals) and shares the skeleton
 const COAT=(()=>{let sk=null;root.traverse(o=>{if(o.isSkinnedMesh&&!sk)sk=o;});if(!sk)return null;const g0=sk.geometry;const S=sk.skeleton;
  const keep=new Set(['Spine','Spine1','Spine2','LeftShoulder','RightShoulder','LeftArm','RightArm','LeftForeArm','RightForeArm','Hips'].map(n=>bones[n]?S.bones.indexOf(bones[n]):-1));
  const hipI=bones.Hips?S.bones.indexOf(bones.Hips):-1;const P=g0.attributes.position,Nn=g0.attributes.normal,J=g0.attributes.skinIndex,W=g0.attributes.skinWeight,ix=g0.index;if(!ix||!Nn)return null;
  const g4=(A,i)=>[A.getX(i),A.getY(i),A.getZ(i),A.getW(i)];const domJ=i=>{const w=g4(W,i),j=g4(J,i);let b=-1,bw=-1;for(let k=0;k<4;k++){if(w[k]>bw){bw=w[k];b=j[k];}}return b;};
  const ok=new Uint8Array(P.count);for(let i=0;i<P.count;i++){const j=domJ(i);ok[i]=keep.has(j)&&!(j===hipI&&P.getY(i)<.02)?1:0;}
  const pos=new Float32Array(P.count*3);for(let i=0;i<P.count;i++){pos[i*3]=P.getX(i)+Nn.getX(i)*.022;pos[i*3+1]=P.getY(i)+Nn.getY(i)*.022;pos[i*3+2]=P.getZ(i)+Nn.getZ(i)*.022;}
  const tri=[];for(let t=0;t<ix.count;t+=3){const a=ix.getX(t),b=ix.getX(t+1),c=ix.getX(t+2);if(ok[a]&&ok[b]&&ok[c])tri.push(a,b,c);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',Nn);g.setAttribute('skinIndex',J);g.setAttribute('skinWeight',W);g.setIndex(tri);
  const mat=new THREE.MeshStandardMaterial({color:0x56603F,roughness:.95,metalness:0,transparent:true,opacity:1});
  const m=new THREE.SkinnedMesh(g,mat);m.name='coat';m.position.copy(sk.position);m.quaternion.copy(sk.quaternion);m.scale.copy(sk.scale);m.bind(S,sk.bindMatrix);m.castShadow=true;m.frustumCulled=false;m.visible=false;sk.parent.add(m);
  return {m,mat,on:false,k:0};})();
 function coatTick(dt){if(!COAT)return;const want=COAT.on?1:0;COAT.k+=clamp(want-COAT.k,-dt/.6,dt/.6);COAT.m.visible=COAT.k>.01;COAT.mat.opacity=COAT.k;COAT.mat.transparent=COAT.k<.99;COAT.mat.depthWrite=COAT.k>.5;}
 const GEAR={coat:false,bow:false,lantern:false};
 const PP=()=>window.__props||P3;
 // WORKSHOP HOOK ("Сделать работу в мастерской естественной"): saw, sharpen and fixlamp are job()s in game/workshop.js; they write only the hands (job post)
 {const WSH=createWorkshop({THREE,V,H,root,bones,job,PP,AU,smooth,rnd,grabTool,relTool,scene,armIK,sidePole,P3,OBST});MAKE.saw=WSH.saw;MAKE.sharpen=WSH.sharpen;MAKE.fixlamp=WSH.fixlamp;MAKE.craft=WSH.craft;H.workshop=WSH;}
 function onBack(n,off,rot){try{PP().grab(n,bones.Spine2,{offset:off,rot:new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot))});}catch(e){}}
 // a short station step: walk up to a world point, play a one-off clip, call cb at fraction `at` of the clip, then go on
 function visit(a,pt,stand,clip,hits,then){if(!pt){then();return;}const nn=nearNode(pt);const run=()=>approachTo(a,pt,stand,()=>{a.step='clip';a.t=0;a.hits=hits.slice();a.clipDur=has(clip)?durOf(clip):1.2;a.pt=pt;
   if(has(clip))once(clip,{fade:.35,then:()=>{a.step='next';for(const h of a.hits)h[1]();a.hits=[];play(IDLE(),{fade:.4});then();}});else{for(const h of hits)h[1]();then();}});
  if(nn)goTo(nn,run);else run();}
 // KITCHEN (re-added on the rolled-back body): the fridge by hand. He stands on the latch side clear of the door's swing, takes the handle, the door opens only as
 // far as his hand carries it (then a little push), the meat goes in / comes out with the hand inside, he takes the handle again and
 // pushes it shut. mode 'in' puts the held meatBag in, 'out' takes one out into the right hand.
 function fridgeAt(F,k,out){const k0=F.open;F.setOpen(k);F.handle(out);F.setOpen(k0);return out;}
 function fridgeVisit(a,mode,then){const F=PP().fridge;if(!F||!F.handle||!F.setOpen){then();return;}
  const h0=fridgeAt(F,0,V()),h5=fridgeAt(F,.5,V()),h1=fridgeAt(F,1,V());const ins=F.inside?F.inside(V()):PT('fridge');
  // the hinge: centre of the circle through the three handle positions (xz)
  const cx=(()=>{const ax=h0.x,az=h0.z,bx=h5.x,bz=h5.z,qx=h1.x,qz=h1.z;const d=2*(ax*(bz-qz)+bx*(qz-az)+qx*(az-bz));if(Math.abs(d)<1e-6)return null;
   const ux=((ax*ax+az*az)*(bz-qz)+(bx*bx+bz*bz)*(qz-az)+(qx*qx+qz*qz)*(az-bz))/d,uz=((ax*ax+az*az)*(qx-bx)+(bx*bx+bz*bz)*(ax-qx)+(qx*qx+qz*qz)*(bx-ax))/d;return V(ux,h0.y,uz);})();
  const nrm=V(h0.x-ins.x,0,h0.z-ins.z).normalize();const lat=cx?V(h0.x-cx.x,0,h0.z-cx.z).normalize():V();
  const S=h0.clone().addScaledVector(nrm,.28).addScaledVector(lat,.1);S.y=F.obj?F.obj.getWorldPosition(V()).y:h0.y-.9;{const fy=floorAt(S.x,S.y+.3,S.z,.6);if(fy!=null)S.y=fy;}
  const nn=nearNode(S);const run=()=>approachTo(a,S.clone().addScaledVector(nrm,.01),.01,()=>{H.face=Math.atan2(h0.x-root.position.x,h0.z-root.position.z);play(IDLE(),{fade:.4});
    a.step='fridge';a.t=0;a.fr={st:'reachO',w:0,t:0,k:F.open,mode,then,ins,nrm};});
  if(nn)goTo(nn,run);else run();}
 function fridgeTick(a,dt){const F=PP().fridge,R=a.fr;R.t+=dt;const R0=armLen*.92+PALM-.03;const tmp=V();const p=root.position;
  const grip=()=>{const G=window.__grab;return G&&G.gripPoint?G.gripPoint('Right'):bones.RightHand.getWorldPosition(V());};
  const hk=F.handle(V());H.look=R.st==='in'?R.ins:hk;H.lookW=1;
  // a short shuffle to a spot (walk clip while it slides), then the next state
  const slideTo=(q,faceAt,nx)=>{q=q.clone();q.y=p.y;pushOut(q);const d=Math.hypot(q.x-p.x,q.z-p.z);const yaw=Math.atan2(faceAt.x-q.x,faceAt.z-q.z);H.face=yaw;
   const dur=Math.max(.35,d/.7,Math.abs(wrapA(yaw-root.rotation.y))/2.4);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(yaw-root.rotation.y),k:0,d:dur};if(d>.08)play('30',{fade:.25,speed:.9});R.st='move';R.t=0;R.md=dur;R.nx=nx;};
  // while pulling / pushing the door the body goes with the hand (a step back or in), the hand never leaves the handle
  const keep=()=>{const sh=bones.RightArm.getWorldPosition(V());const v=V(hk.x-sh.x,0,hk.z-sh.z);const dy=hk.y-sh.y;const want=Math.sqrt(Math.max(0,R0*R0-dy*dy));const l=v.length();
   if(l>want){const m=Math.min(l-want,.6*dt);const q=p.clone().addScaledVector(v.normalize(),m);pushOut(q);p.x=q.x;p.z=q.z;}H.face=Math.atan2(hk.x-p.x,hk.z-p.z);};
  // KITCHEN: the meat shelf is low (~0.6 m): he bends his knees to bring the shoulder down to it (feet stay planted), only while the hand is in
  {if(R.st==='in'&&R.sq0===undefined){const sh=bones.RightArm.getWorldPosition(V());const hz=Math.hypot(sh.x-R.ins.x,sh.z-R.ins.z);const dy=sh.y+(H.squat||0)-R.ins.y;R.sq0=clamp(dy-Math.sqrt(Math.max(0,(R0*.9)**2-hz*hz))+.04,0,.42);}const want=R.st==='in'&&R.sq0?R.sq0*smooth(0,1,R.w):0;R.sq=(R.sq||0)+(want-(R.sq||0))*(1-Math.exp(-dt*6));H.squat=R.sq;H.kSquat=R.sq>.001;H.kSqA=act;}
  if(R.st==='move'){if(R.t>=R.md){play(IDLE(),{fade:.35});R.st=R.nx;R.t=0;}return;}
  if(R.st==='reachO'||R.st==='reachC'){R.w=Math.min(1,R.w+dt/.35);R.tgt='h';if((R.w>=1&&grip().distanceTo(hk)<.03)||R.t>1.2){R.st=R.st==='reachO'?'open':'close';R.t=0;}}
  else if(R.st==='open'){keep();F.setOpen(Math.min(.6,F.open+1.0*dt));if(F.open>=.6){F.openTo(.92);/* a last pull and it swings wide */R.w=Math.max(.0,R.w);R.st='letgo';R.t=0;}}
  else if(R.st==='letgo'){R.w=Math.max(0,R.w-dt/.25);if(R.w<=0){const fr=R.ins.clone().sub(fridgeAt(F,0,tmp).clone().setY(R.ins.y)).setY(0);const front=R.ins.clone().addScaledVector(R.nrm,.5);/* KITCHEN: half a metre back, so the knees bend and the head stays out of the fridge */slideTo(front,R.ins,'in');}}
  else if(R.st==='in'){R.tgt='i';R.w=Math.min(1,R.w+dt/.35);if(R.t>.3&&!R.did&&(grip().distanceTo(R.ins.clone().addScaledVector(R.nrm,.12))<.05||R.t>2.2)){R.did=1;R.tdid=R.t;try{if(R.mode==='in'){PP().release('meatBag');window.__audio.carry(false);H.carry=null;}else PP().grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}}
   if(R.did&&R.t>R.tdid+.25){R.w=Math.max(0,R.w-dt/.2);if(R.w<=0){const ho=F.handle(V());slideTo(ho.clone().addScaledVector(R.nrm,.28).addScaledVector(V(ho.x-R.ins.x,0,ho.z-R.ins.z).normalize(),.1),ho,'reachC');}}}
  else if(R.st==='close'){keep();F.setOpen(Math.max(0,F.open-1.0*dt));if(F.open<=.3){F.openTo(0);/* a push and it swings shut */R.st='after';R.t=0;}}
  else if(R.st==='after'){R.w=Math.max(0,R.w-dt/.3);if(R.w<=0){a.fr=null;H.squat=0;H.kSquat=0;a.step='next';R.then();}}}
 function fridgePost(a){const R=a.fr;if(!R||R.w<=.01)return;const F=PP().fridge;const G=window.__grab;
  const t=R.tgt==='i'?R.ins.clone().addScaledVector(R.nrm,.12):F.handle(V());/* the meat at the front of the shelf, not its back wall */reachGrip('Right',t,R.w);if(G){if(R.st==='open'||R.st==='close'||((R.st==='reachO'||R.st==='reachC')&&R.w>.6))G.hold('Right',F.obj,()=>F.handle(V()));else G.free(F.obj);}}
 function stepTick(a,dt){a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return true;}if(a.step==='fridge'){if(a.fr)fridgeTick(a,dt);return true;}
  if(a.step==='clip'){H.look=a.pt;H.lookW=.9;const k=a.t/Math.max(.3,a.clipDur);while(a.hits.length&&k>=a.hits[0][0]){a.hits.shift()[1]();}return true;}return false;}
 // the same one-off clip n times in a row (gathering logs, scooping), each with a small shift of the gaze
 function reps(clip,n,then){if(n<=0||!has(clip)){then();return;}once(clip,{fade:.35,then:()=>{H.face+=rnd(-.25,.25);reps(clip,n-1,then);}});}
 const peg=n=>{const p=PT(n);if(!p)return null;const q=p.clone();q.hand=true;/* hand height: stand on the floor below it, not on a floor level with it */return q;};
 function gearOn(a,o,then){const seq=[];
  if(o.jacket&&!GEAR.coat&&COAT)seq.push(next=>visit(a,peg('jacketPeg'),.45,'hy_jacketon',[[.14,()=>{try{PP().setHere&&PP().setHere('jacket',false);}catch(e){}COAT.on=true;GEAR.coat=true;}],[.55,()=>AU('zip')]]/* no rigid jacket in the hand: it leaves the peg at the touch and settles on the body (skinned coat fades in) */,next));
  if(o.bow&&!GEAR.bow)seq.push(next=>visit(a,peg('bowPeg'),.45,'hy_bowtake',[[.35,()=>{try{PP().grab('bow',bones.LeftHand,{offset:V(0,.08,.03)});}catch(e){}}],[.7,()=>{onBack('quiver',V(.06,.12,-.16),[0,0,-.5]);onBack('bow',V(-.02,.06,-.15),[0,0,.55]);/* OUTDOOR: slung across the back, both hands free for the ladder (Pavel: bow on the back) */GEAR.bow=true;}]],next));
  if(o.lantern&&!GEAR.lantern&&hasTool('lantern'))seq.push(next=>visit(a,toolHome('lantern'),.45,'hy_take',[[.45,()=>{try{PP().grab('lantern',bones.RightHand,{offset:V(0,.06,.03)});window.__lights&&window.__lights.attachHand&&window.__lights.attachHand(bones.RightHand);window.__lights.set('hand',true);}catch(e){}GEAR.lantern=true;}]],next));
  const run=i=>{if(a.leaving)return;if(i>=seq.length){then();return;}seq[i](()=>run(i+1));};run(0);}
 function gearOff(a,then){const seq=[];
  if(GEAR.lantern)seq.push(next=>visit(a,toolHome('lantern'),.45,'hy_take',[[.45,()=>{try{window.__lights.set('hand',false);window.__lights.detachHand();PP().release('lantern',{blend:.3});}catch(e){}GEAR.lantern=false;}]],next));
  if(GEAR.bow)seq.push(next=>visit(a,peg('bowPeg'),.45,'hy_bowhang',[[.2,()=>{try{PP().grab('bow',bones.LeftHand,{offset:V(0,.08,.03)});}catch(e){}/* off the back into the hand first */}],[.4,()=>{try{PP().release('quiver',{blend:.4});}catch(e){}}],[.7,()=>{try{PP().release('bow',{blend:.4});}catch(e){}GEAR.bow=false;}]],next));
  if(GEAR.coat)seq.push(next=>visit(a,peg('jacketPeg'),.45,'hy_jacketoff',[[.25,()=>AU('unzip')],[.55,()=>{COAT.on=false;}],[.7,()=>{try{PP().setHere&&PP().setHere('jacket',true);}catch(e){}GEAR.coat=false;}]],next));
  const run=i=>{if(i>=seq.length){then();return;}seq[i](()=>run(i+1));};run(0);}
 function dropGearNow(){if(GEAR.coat&&COAT){COAT.on=false;try{PP().setHere&&PP().setHere('jacket',true);}catch(e){}GEAR.coat=false;}
  for(const n of ['bow','quiver','lantern','meatBag','logArmful','waterBucket','drainBucket','plate'])try{PP().release(n);}catch(e){}
  if(GEAR.lantern)try{window.__lights.set('hand',false);window.__lights.detachHand();}catch(e){}GEAR.bow=GEAR.lantern=false;try{window.__audio.carry(false);}catch(e){}H.carry=null;}
 // ---- OUTDOOR helpers (self-contained on this hero.js): reach with a little lean, the palm (not the wrist) on a point,
 // and a tool driven in the world while the hands hold its handle (the tool follows the real palm, never floats off it)
 const OD_PALM=.07;
 function odPalm(side){const h=bones[side+'Hand'].getWorldPosition(V()),f=bones[side+'ForeArm'].getWorldPosition(V());return h.add(h.clone().sub(f).normalize().multiplyScalar(OD_PALM));}
 function odPalmTo(side,t){return t?odPalm(side).distanceTo(t):9;}
 function odReach(side,t,w){/* OUTDOOR: palm-target reach (targets here are odPalm points); the kitchen's reachGrip aims the fist's grip point */const sh=bones[side+'Arm'];if(!sh||!t)return;let tot=0;
  for(let it=0;it<3;it++){const hp=bones.Hips.getWorldPosition(V());const s0=sh.getWorldPosition(V());const ex=s0.distanceTo(t)-(armLen*.92+OD_PALM);if(ex<=.01)break;
   const d=V(t.x-hp.x,0,t.z-hp.z);if(d.lengthSq()<1e-4)break;d.normalize();if(d.dot(fwd(root.rotation.y))<-.1)break;/* never arch backwards to reach (frame by frame: a banana back at the top of the axe swing); the arm alone goes there */const ax=V(0,1,0).cross(d).normalize();const ang=Math.min(REACH_LEAN-tot,ex*3)*w;if(ang<=.005)break;tot+=ang;
   rotW(bones.Spine,ax,ang*.45);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.2);}
  const s1=sh.getWorldPosition(V());const tw=t.clone().sub(s1);const tl=tw.length();const wt=tl>OD_PALM*1.5?s1.clone().addScaledVector(tw,(tl-OD_PALM)/tl):t;armIK(side,wt,sidePole(side),clamp(w,0,1));}
 // the axe in the world: head at `head`, handle running from the head along -dir, edge toward `blade`
 const _odM=new THREE.Matrix4();
 function axeWorld(head,dir,blade){const P=PP();const ax=P&&P.tools&&P.tools.axe;if(!ax)return;if(ax.parent!==scene)scene.attach(ax);
  const y=dir.clone().normalize();const x=blade.clone().addScaledVector(y,-blade.dot(y)).normalize();const z=x.clone().cross(y);_odM.makeBasis(x,y,z);
  ax.quaternion.setFromRotationMatrix(_odM);ax.position.copy(head);const hs=ax.userData.home&&ax.userData.home.scale;ax.scale.setScalar(hs||1);ax.visible=true;ax.updateMatrixWorld(true);}
 const AXE_G=.56;/* the right fist this far below the head along the handle */
 // ---- OUTDOOR: wood splitting (MAKE.splitwood) -------------------------------------------------------------------------
 const SPL_RH=.26,SPL_RR=.115,SPL_T={place:3.7,swing:1.9,after:.9};
 const SPLM={bark:new THREE.MeshStandardMaterial({color:0x5a4330,roughness:.95}),wood:new THREE.MeshStandardMaterial({color:0xcfa572,roughness:.85})};
 // a sawn round (bark round the side, pale end grain) and the half of one (flat split face)
 function roundMesh(){const g=new THREE.Group();const c=new THREE.Mesh(new THREE.CylinderGeometry(SPL_RR*.97,SPL_RR,SPL_RH,14),[SPLM.bark,SPLM.wood,SPLM.wood]);c.position.y=SPL_RH/2;g.add(c);c.castShadow=true;return g;}
 function halfMesh(){const g=new THREE.Group();const c=new THREE.Mesh(new THREE.CylinderGeometry(SPL_RR*.97,SPL_RR,SPL_RH,10,1,false,0,Math.PI),[SPLM.bark,SPLM.wood,SPLM.wood]);c.position.y=SPL_RH/2;g.add(c);
  const f=new THREE.Mesh(new THREE.PlaneGeometry(SPL_RR*1.96,SPL_RH*.99),SPLM.wood);f.rotation.y=-Math.PI/2;f.position.y=SPL_RH/2;g.add(f);c.castShadow=true;return g;}
 // where things are round the block: its top, the stack of rounds at his left, the halves on the ground
 function splitState(blk){if(blk.userData.split)return blk.userData.split;const b=blk.userData.box||new THREE.Box3().setFromObject(blk);
  const S={blk,top:V(blk.position.x,b.max.y,blk.position.z),stack:[],halves:[]};blk.userData.split=S;return S;}
 // a graph node where he stands to split: 1.05 m from the block, on the side toward the nearest ground path node (added once)
 function blockNode(blk,S){if(N.g_block)return;const c=S.top;let best=null,bd=1e9;for(const k in N){if(!/^g_/.test(k)||/^g_p\d|g_pond|g_out|g_edge|g_exit2/.test(k))continue;const d=Math.hypot(N[k].p.x-c.x,N[k].p.z-c.z);if(d<bd){bd=d;best=k;}}
  if(!best)return;const b=N[best].p;let u=V(b.x-c.x,0,b.z-c.z).normalize();
  // the clearest spot round the block: away from the oak's roots (ground.js rootD) and from the log pile / sawhorse
  {const G=window.__ground;let bs=-1e9;for(let i=0;i<16;i++){const a=i*Math.PI/8;const v=V(Math.sin(a),0,Math.cos(a));let sc=0;for(const k of [.5,1.05,1.6]){const x=c.x+v.x*k,z=c.z+v.z*k;sc+=G&&G.rootD?Math.min(.8,G.rootD(x,z)):0;}
    const q=c.clone().addScaledVector(v,1.05);for(const n of ['logpile','sawhorse']){const o=PP().objects&&PP().objects[n];if(o&&o.userData.box){const bb=o.userData.box;const dx=Math.max(bb.min.x-q.x,0,q.x-bb.max.x),dz=Math.max(bb.min.z-q.z,0,q.z-bb.max.z);sc-=Math.max(0,.7-Math.hypot(dx,dz))*3;}}
    sc+=.15*v.dot(u);if(sc>bs){bs=sc;u.copy(v);}}}const p=c.clone().addScaledVector(u,1.05);const G=window.__ground;p.y=G&&G.heightAt?G.heightAt(p.x,p.z):b.y;
  N.g_block={p,face:Math.atan2(-u.x,-u.z)};(adj.g_block=adj.g_block||[]).push({to:best});(adj[best]=adj[best]||[]).push({to:'g_block'});}
 function splitStock(S,n){// the rounds he sawed earlier stand by the block; topped up only while he is away from it (never under his eyes)
  if(S.stack.length>=n)return;const G=window.__ground;const c=S.top;const st=N.g_block?N.g_block.p.clone():root.position.clone();const d=V(c.x-st.x,0,c.z-st.z).normalize();const r=V(d.z,0,-d.x);/* his left */
  while(S.stack.length<n+1){const i=S.stack.length;const m=roundMesh();const p=st.clone().addScaledVector(r,.3+(i%2)*.24).addScaledVector(d,.42-Math.floor(i/2)*.24);/* in front, to his left: the squat reaches it */p.y=G&&G.heightAt?G.heightAt(p.x,p.z):p.y-.42;m.position.copy(p);m.rotation.y=Math.random()*6;scene.add(m);S.stack.push(m);}
  while(S.halves.length>12){const h=S.halves.shift();scene.remove(h);}}
 let rdLateOn=0;function roundLock(a,rd){const hb=bones.LeftHand;hb.updateWorldMatrix(true,false);const wp=odPalm('Left').sub(a.rOff);if(a.cTop&&Math.hypot(wp.x-a.cTop.x,wp.z-a.cTop.z)<.42)wp.y=Math.max(wp.y,a.cTop.y+.003);/* over the block it rests on its top, never sinks into it */const M=new THREE.Matrix4().compose(wp,a.rQ,rd.getWorldScale(V()));M.premultiply(hb.matrixWorld.clone().invert());M.decompose(rd.position,rd.quaternion,rd.scale);rd.updateMatrixWorld(true);a.rW=wp.clone();}
 function splitPost(a,dt,S){const P=PP();const ax=P&&P.tools&&P.tools.axe;if(!ax||!a.axeOn)return;
  const T=SPL_T;a.pt+=dt;const c=S.top;const rp=root.position;const d=V(c.x-rp.x,0,c.z-rp.z);const hd=d.length();d.normalize();const r=V(-d.z,0,d.x),up=V(0,1,0);
  H.face=Math.atan2(d.x,d.z);
  const hits=a.plan[a.ri];if(hits==null){a.w=Math.max(0,(a.w||0)-dt/.4);H.squat=0;return;}
  if(a.ph==='lead'){axeRest(a,d,smooth(0,.5,a.pt));if(a.pt>.6){a.ph='place';a.pt=0;}return;}
  // 1. a round from the stack onto the block: squat, left palm on its top, lift, stand it on the block
  if(a.ph==='place'){a.cTop=c;const u=a.pt/T.place;let rd=a.rd;if(!rd){rd=a.rd=S.stack.pop()||(()=>{const m=roundMesh();m.position.copy(c).addScaledVector(r,.5);m.position.y-=.42;scene.add(m);return m;})();a.r0=rd.position.clone();}
   // the body: real mocap squat-and-lift (hy_pickground, CMU: hips lowest 0.9-1.3 s); without it a code squat
   const t=a.pt;if(!a.pk){a.pk=1;if(has(PICKC()))once(PICKC(),{fade:.3});}const PK=has(PICKC());
   H.squat=(PK?0:.42*smooth(.15,.8,t)*(1-smooth(1.3,1.9,t)))+.2*smooth(2.0,2.5,t)*(1-smooth(2.95,3.35,t));/* knees bend to set the round down on the block (standing, the palm stayed 14 cm high and the round dropped) */const tp=rd.getWorldPosition(V()).add(V(0,SPL_RH+.01,0));
   const w=smooth(.35,.85,t)*(1-smooth(2.75,3.05,t));
   if(rd.parent===bones.LeftHand&&(t>2.75||(t>2.45&&rd.getWorldPosition(V()).distanceTo(c)<.04))){scene.attach(rd);if(a.rW){rd.position.copy(a.rW);rd.quaternion.copy(a.rQ);}/* from where it was last frame (the hand has already moved on this frame) */a.settle={p:rd.position.clone(),q:rd.quaternion.clone(),t:0};a.placed=1;}
   if(a.settle){/* set down: the last few cm with the palm still on it, then the knock of wood on wood */const S2=a.settle;S2.t=Math.min(1,S2.t+dt/.4)/* pushed the last bit across the block top */;rd.position.lerpVectors(S2.p,c,smooth(0,1,S2.t));rd.quaternion.slerpQuaternions(S2.q,new THREE.Quaternion().setFromEuler(new THREE.Euler(0,S2.yaw??(S2.yaw=Math.random()*6),0)),S2.t);if(S2.t>=1){a.settle=null;AU('wood',c);}}
   let at=tp;if(rd.parent===bones.LeftHand){/* carried up with the rising body, then over to the block top */const k=smooth(1.35,2.6,t);const to=c.clone().add(V(0,SPL_RH+.01,0));at=a.r0.clone().add(V(0,SPL_RH+.01,0)).lerp(to,k);at.y+=.3*Math.sin(Math.PI*k);
    /* the round, not the palm, has to land on the block: the hand goes where the round's offset from the palm puts it there */if(k>.3){const want=a.r0.clone().lerp(c,k);want.y=lerp(a.r0.y,c.y,k)+.3*Math.sin(Math.PI*k);const pm=odPalm('Left');const off=pm.sub(rd.getWorldPosition(V()));at=want.add(off);}}
   else if(a.placed)at=c.clone().add(V(0,SPL_RH+.01,0));
   if(w>.01)odReach('Left',at,w);a.lk=at;axeRest(a,d,1);
   // a step in to set the round on the block (it is out of reach from where he swings), and a step back out after
   const step=(dist,back)=>{const q=c.clone().addScaledVector(d,-dist);const sx=q.x-rp.x,sz=q.z-rp.z;H.slide={x:sx,z:sz,yaw:0,k:0,d:Math.max(.45,Math.hypot(sx,sz)/(back?.55:.75))};play('30',{fade:.25});if(actions['30'])actions['30'].timeScale=back?-.8:1;};
   if(t>1.85&&!a.st1){a.st1=1;step(.66,false);}if(t>2.5&&!a.st1b){a.st1b=1;play(IDLE(),{fade:.3});}
   if(t>2.85&&!a.st2){a.st2=1;step(1.05,true);}if(t>3.5&&!a.st2b){a.st2b=1;if(actions['30'])actions['30'].timeScale=1;play(IDLE(),{fade:.3});}
   /* the palm is on its top now (after the reach this frame): it comes up with the hand */if(t>1.02&&rd.parent!==bones.LeftHand&&!a.placed&&odPalmTo('Left',tp)<.08){bones.LeftHand.updateWorldMatrix(true,false);bones.LeftHand.attach(rd);AU('wood',tp);a.rOff=odPalm('Left').sub(rd.getWorldPosition(V()));{const e=new THREE.Euler().setFromQuaternion(rd.getWorldQuaternion(new THREE.Quaternion()),'YXZ');a.rQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,e.y,0,'YXZ'));/* stood upright, whatever it was knocked to on the stack */}}
   /* fingers round its top rim: the round stays upright under the palm, it never swings tilted beside the hand (film: it hung 30 deg off at his side) */
   if(!rdLateOn){rdLateOn=1;stage('guard',()=>{const A=act;const r2=A&&A.rd;if(!r2||!A.rOff||r2.parent!==bones.LeftHand)return;roundLock(A,r2);});}/* again after the pose guard moved the hand */
   if(rd.parent===bones.LeftHand&&a.rOff)roundLock(a,rd);
   if(t>=T.place){a.rOff=null;a.rW=null;a.ph='swing';a.pt=0;a.hit=0;a.lk=null;a.pk=0;a.placed=0;a.settle=null;a.st1=a.st1b=a.st2=a.st2b=0;}return;}
  // 2. the swing: angle th round a pivot just in front of the shoulders, in the vertical plane through the round
  const Ls=bones.LeftArm.getWorldPosition(V()),Rs=bones.RightArm.getWorldPosition(V());const piv=Ls.clone().add(Rs).multiplyScalar(.5).addScaledVector(d,.06).add(V(0,-.04,0));
  const tgt=c.clone().add(V(0,SPL_RH-.015,0));const q=tgt.clone().sub(piv);const qh=V(q.x,0,q.z).length();const rH=q.length();const thS=Math.atan2(q.y,qh);
  if(a.ph==='swing'){// the body is real mocap (hy_axechop, CMU: slow lift 1.2 s, fast drop 0.35 s, hit at 1.57 s of 1.9 s); the axe angle follows its phase
   const C='hy_axechop',cd=has(C)?durOf(C):1.9;if(!a.clipOn&&has(C)){a.clipOn=1;play(C,{fade:.3});const A=actions[C];if(A)A.time=0;}
   const A=has(C)?actions[C]:null;const u=A?(A.time%cd)/cd:a.pt/T.swing;if(a.lu!=null&&u<a.lu-.5){a.struck=0;a.cyc=(a.cyc||0)+1;}a.lu=u;
   const last=a.hit+1>=hits;const thT=1.68,UT=.63,US=.82;/* top of the backswing just past vertical: further back the hands went behind his head and the body guard pulled them off the handle (film) */let th;
   if(u<UT)th=thS+(thT-thS)*smooth(0,UT,u);else if(u<US){const k=(u-UT)/(US-UT);th=thT+(thS-.05-thT)*k*k;}else th=thS-.05;
   if(u>=US&&!a.struck){a.struck=1;a.hit++;try{window.__audio&&window.__audio.contact?window.__audio.contact({tool:'axe',kind:'hit',pos:tgt.toArray(),strength:rnd(.8,1)}):AU('chop',tgt);}catch(e){AU('chop',tgt);}
    if(a.hit>=hits)splitRound(a,S,d,r);}
   if(u>US&&a.rd&&u<.95)th+=Math.sin((u-US)*60)*.025;/* stuck: rock the handle to free it */
   a.w=Math.min(1,(a.w||0)+dt/.35);H.squat=.04;
   holdAxe(a,piv,d,r,th,rH,a.w);
   if(a.hit>=hits&&u>.97){a.pt=0;a.struck=0;a.clipOn=0;a.lu=null;a.ph='after';play(IDLE(),{fade:.6});}return;}
  if(a.ph==='after'){const u=a.pt/T.after;a.w=Math.max(0,1-smooth(0,.6,u));H.squat=.04*(1-u);axeRest(a,d,1);if(a.w>.01)holdAxe(a,piv,d,r,thS-.05+.3*smooth(0,.6,u),rH,a.w);
   if(u>=1){a.ri++;a.ph=a.plan[a.ri]!=null?'place':'done';a.pt=0;a.hit=0;}}}
 // the axe at rest in the right hand: hanging head down along the leg, the blade forward (never sticking out sideways)
 function axeRest(a,d,w){const gp=odPalm('Right');let dn=V(0,-1,0).addScaledVector(d,.22).normalize();
  // squatting, the head is never in the ground: the handle leans forward until the head just rests on the earth
  let gy=0;try{gy=window.__ground.heightAt(gp.x,gp.z);}catch(e){}const room=gp.y-(gy+.07);if(AXE_G*-dn.y>room){const v=clamp(room/AXE_G,-.2,1);dn=d.clone().setY(0).normalize().multiplyScalar(Math.sqrt(1-v*v)).add(V(0,-v,0)).normalize();}axeWorld(gp.clone().addScaledVector(dn,AXE_G),dn,d.clone());}
 // both hands on the axe handle: right hand at the tool's grip, left hand at the handle's end; the blade faces the way it swings
 function holdAxe(a,piv,d,r,th,rH,w){const dir=d.clone().multiplyScalar(Math.cos(th)).add(V(0,Math.sin(th),0));const tan=d.clone().multiplyScalar(-Math.sin(th)).add(V(0,Math.cos(th),0));
  const gR=piv.clone().addScaledVector(dir,rH-AXE_G);const gL=piv.clone().addScaledVector(dir,Math.max(.22,rH-.67)).addScaledVector(r,.01);
  odReach('Right',gR,w);odReach('Left',gL,w*.95);/* right first: its trunk lean moved the left shoulder and slid the left hand off the handle */
  // the axe goes where the right fist really is (contact first); while blending out it hangs from the fist
  const pR=odPalm('Right');const hang=V(0,-1,0).addScaledVector(d,.22).normalize();const dd=hang.lerp(dir,w).normalize();axeWorld(pR.clone().addScaledVector(dd,AXE_G),dd,tan.clone().negate().lerp(d,1-w));a.dbg=[gR,gL];a.axeLate={w,blade:tan.clone().negate().lerp(d,1-w)};
  // the guard (last pose step) can still pull the arms back a few cm at the top of the swing: the axe is set again from where
  // both fists really ended up, the handle through both of them (film: hands off the handle above his head)
  if(!axeLateOn){axeLateOn=1;stage('guard',()=>{const A=act;const L=A&&A.axeLate;if(!L)return;A.axeLate=null;const ax=PP().tools.axe;if(!ax||ax.parent!==scene)return;
   const pR=odPalm('Right'),pL=odPalm('Left');const v=pR.clone().sub(pL);const l=v.length();if(L.w<.9||l<.12||l>.55)return;v.divideScalar(l);
   axeWorld(pR.clone().addScaledVector(v,AXE_G),v,L.blade);});}}
 let axeLateOn=0;
 // the round comes apart: two halves tip outwards off the block and drop onto the ground on both sides
 function splitRound(a,S,d,r){const rd=a.rd;if(!rd)return;a.rd=null;a.split++;const p=rd.position.clone();const yaw=Math.atan2(d.x,d.z);scene.remove(rd);
  AU('chop',p);for(const s of [-1,1]){const h=halfMesh();h.position.copy(p);h.rotation.set(0,yaw+(s<0?Math.PI:0)+Math.PI/2,0);scene.add(h);S.halves.push(h);
   const G=window.__ground;const land=p.clone().addScaledVector(r,s*rnd(.3,.45)).addScaledVector(d,rnd(-.12,.12));land.y=G&&G.heightAt?G.heightAt(land.x,land.z):p.y-.42;
   SPLF.push({h,t:0,p0:p.clone(),land,s,yaw:h.rotation.y,spin:rnd(-.6,.6)});}}
 const SPLF=[];function splitFall(dt){for(let i=SPLF.length-1;i>=0;i--){const f=SPLF[i];f.t+=dt;const k=Math.min(1,f.t/.55);
  // tips over its outer bottom edge first, then drops to the ground lying on its bark
  const tip=smooth(0,.35,f.t/.55);const drop=k*k;const pos=f.p0.clone().lerp(f.land,smooth(.1,1,k));pos.y=f.p0.y+(f.land.y-f.p0.y)*drop+.06*Math.sin(Math.PI*k);
  f.h.position.copy(pos);f.h.rotation.set(0,f.yaw+f.spin*k,0);f.h.rotateZ(-(Math.PI/2)*Math.min(1,tip+drop*.6));f.h.updateMatrixWorld(true);if(k>=1){SPLF.splice(i,1);AU('wood',f.land);}}}
 // OUTDOOR: filling the bucket at the pond. Real mocap squat (hy_pickground) down to the waterline, held at the bottom while the
 // right fist pushes the bucket under (it tips, fills, a splash and the ripples), then a slow, heavy rise with the full bucket.
 // The bucket hangs from the real fist all the time; he shuffles so the fist comes over the water, not the bank.
 const PF0={down:.7,hold:2.6},PFK={down:2.55,hold:1.0,up:1,d0:1.2,e:2.3};/* PFK: hy_kneelfill is down on one knee from 2.4 s and holds there till 4.3 s by itself *//* held part-way down: a bent-knee crouch with a straight back reaching forward, not a ball curled over the bucket (watcher) */
 // floor pickups: the knee-safe pickup clip (knees never fold under 40 deg), timed like hy_pickground; the pond: a one-knee kneel
 const PICKC=()=>has('hy_floorpick')?'hy_floorpick':'hy_pickground';
 function pondFill(a,dt){const PD=window.__ground&&window.__ground.pond;let F=(PD&&PD.fill)||root.position;a.ft+=dt;const t=a.ft;const C='hy_pickground';/* the crouch held part-way down (watcher-approved); kneel_fill was tried: it folds the trunk over the knees */const PF=PF0;
  // OUTDOOR: he faces the pond itself (its centre), crouches on the bank with the knees 0.1 m outside the drawn water
  // ellipse (POND in ground.js) and reaches the bucket out at arm's length into the water's edge
  if(!a.fs){a.fs=1;if(has(C))once(C,{fade:.3});const er=(x,z)=>{const dx=x+1.4,dz=z-7.6,c=Math.cos(-.12),sn=Math.sin(-.12);return Math.hypot((dx*c+dz*sn)/1.75,(-dx*sn+dz*c)/1.15);};
   const d=V(-1.4-root.position.x,0,7.6-root.position.z).normalize();H.face=Math.atan2(d.x,d.z);
   // the water starts where the bank dips under the surface (the water plane is drawn where the ground is below it)
   const G=window.__ground,lv=PD?PD.level:0;const p0=root.position.clone();let tW=1;for(let t=0;t<3.5;t+=.03){let h=lv+1;try{h=G.heightAt(p0.x+d.x*t,p0.z+d.z*t);}catch(e){}if(h<lv-.005){tW=t;break;}}
   const st=p0.clone().addScaledVector(d,tW-.42);/* knees (0.45 ahead in the crouch) 0.1 m short of the water */
   a.stand=st;a.tgt=p0.clone().addScaledVector(d,tW+.16);a.tgt.y=PD?PD.level:a.tgt.y;}
  if(a.tgt)F=a.tgt;
  const A=has(C)?actions[C]:null;
  if(A){if(t>=PF.down&&t<PF.down+PF.hold)A.timeScale=0;else if(t>=PF.down+PF.hold)A.timeScale=PF.up||.62;/* full bucket: up slower than he went down */}
  const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const p=root.position;{/* boots on the bank, never in the water (watcher: he stood 1.5 m from the centre among the lilies): the root stays a good
   0.3 m back from the waterline and outside the pond by 0.25 m; the arm and the squat reach the water */

   const tx=a.stand.x,tz=a.stand.z;const m=.45*dt;p.x+=clamp(tx-p.x,-m,m);p.z+=clamp(tz-p.z,-m,m);}
  root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*4);H.look=F.clone();H.lookW=.85*(1-smooth(PF.down+PF.hold,PF.down+PF.hold+.8,t));
  const lv=PD?PD.level:F.y;const end=PF.down+PF.hold+(A?(durOf(C)-PF.down)/(PF.up||.62):1.5);
  if(t>PF.down+.25&&!a.s1){a.s1=1;try{PD&&PD.splash&&PD.splash(F.x,F.z,1);}catch(e){}AU('bucket_fill',F);}
  if(t>PF.down+PF.hold-.2&&!a.s2){a.s2=1;try{PD&&PD.splash&&PD.splash(F.x,F.z,.6);}catch(e){}AU('slosh',F);}
  a.dip=smooth(PF.d0??PF.down-.1,PF.down+.5,t)*(1-smooth(PF.down+PF.hold+(PF.e??.8)-1,PF.down+PF.hold+(PF.e??.8),t));/* out in front until he is up again (gate: the full bucket came back through his thigh in the squat) */a.lv=lv;
  if(t>=end){a.step='rise';if(A)A.timeScale=1;H.carry=BUCKET();a.fdone();}}
 function pondFillPost(a){const P=PP();const bk=P&&P.tools&&P.tools.waterBucket;if(!bk||!a.dip)return;
  // the fist goes down to the water: the bucket's rim just under the surface, tipped toward the pond so it fills
  const R=odPalm('Right');const want=R.clone();const rimBelow=.35;/* fist to bucket bottom when hanging */const yFist=a.lv+.02;/* the fist at the surface: the whole bucket under */
  // going down the bucket stays out at the side and ahead of the knee (frame by frame it went through his right thigh)
  {const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const d=R.clone().sub(bones.Hips.getWorldPosition(V()));const kf=Math.min(1,a.dip*3),kl=smooth(.22,.5,a.dip);/* forward past the knee first, out at the side; only then in toward the middle (gate: the rim crossed the right thigh) */want.addScaledVector(r,(Math.max(.3,d.dot(r))-d.dot(r))*(1-kl)+(.08-d.dot(r))*kl).addScaledVector(f,Math.max(0,.5*kf-d.dot(f)));}/* ahead of both knees, which splay in the squat */
  // ...and at the bottom out over the water at the fill point (he squats on the bank; the arm and a forward lean reach it),
  // never sunk into the bank: over ground the bucket's bottom stays on top of it
  const PD=window.__ground&&window.__ground.pond;const F0=a.tgt||(PD&&PD.fill);if(F0){const F=F0;const u=smooth(.25,1,a.dip);want.x=lerp(want.x,F.x,u);want.z=lerp(want.z,F.z,u);}
  if(R.y>yFist)want.y=lerp(R.y,yFist,a.dip);
  // the pond is shallow at the edge: the bucket lies over on its side to scoop, its bottom never in the mud of the bed
  {let g=want.y-1;try{g=window.__ground.heightAt(want.x,want.z);}catch(e){}want.y=Math.max(want.y,g+.12);}
  if(want.distanceTo(R)>.005)odReach('Right',want,1);
  const L=odPalm('Left');odReach('Left',odPalm('Right').addScaledVector(V(-fwd(root.rotation.y).z,0,fwd(root.rotation.y).x),-.14),.7*a.dip);/* the other hand on the rim too */
  odHang('waterBucket',1.0*a.dip);}
 // a bucket in the fist hangs plumb from its handle (world upright, turned with him), tipped only when he tips it; never
 // follows the wrist's twist (it was swinging out at the hip or upside down at the feet)
 function odHang(n,tilt=0,free=false){const P=PP();const o=P&&P.tools&&P.tools[n];if(!o)return;
  if(o.parent!==bones.RightHand)return;const hb=bones.RightHand;
  // a full bucket is never inside his leg: the straight arm holds the fist out at the side, level with the hip, and the
  // heavy bucket hardly swings (frame by frame the rim went through the thigh at every step)
  if(!tilt&&!free){const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const hp=bones.Hips.getWorldPosition(V());const R=odPalm('Right');const d=R.clone().sub(hp);
   const lat=d.dot(r),fw=d.dot(f);const want=R.clone().addScaledVector(r,Math.max(0,.26-lat)).addScaledVector(f,clamp(fw,-.06,.06)-fw);if(want.distanceTo(R)>.005)odReach('Right',want,1);
   // the free left arm only balances the weight: a little out from the hip, relaxed and swinging, never a stiff wing
   const l=r.clone().negate();const L=odPalm('Left');const dl=L.clone().sub(hp);const sw=clamp(bones.RightFoot.getWorldPosition(V()).sub(bones.LeftFoot.getWorldPosition(V())).dot(f)*.18,-.07,.07);
   const nat=hp.clone().addScaledVector(l,.27).addScaledVector(f,.04+sw).add(V(0,-.1,0));if(dl.y>-.1||dl.dot(l)>.3)odReach('Left',L.lerp(nat,.75),1);}
  hb.updateWorldMatrix(true,false);
  // carried, the wide pail rests against the outside of his thigh and hangs tipped a little out from it (the arm is no stiff wing)
  const roll=(!tilt&&!free)?-.2:0;const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt,root.rotation.y,roll,'YXZ'));const hs=(o.userData.home&&o.userData.home.scale)||1;
  const g=V(0,.35,0).multiplyScalar(hs).applyQuaternion(q);const pos=odPalm('Right').sub(g);
  const M=new THREE.Matrix4().compose(pos,q,V(hs,hs,hs));M.premultiply(hb.matrixWorld.clone().invert());M.decompose(o.position,o.quaternion,o.scale);o.updateMatrixWorld(true);}
 // OUTDOOR: an armful of logs is carried with both arms at the chest (not dangling from one hand at the hip), and over the
 // ladder it rides across his back on its ropes, lying level (it stood up past his head)
 function odArmful(){const P=PP();const o=P&&P.tools&&P.tools.logArmful;if(!o||!o.visible)return;const inHand=o.parent===bones.LeftHand,back=o.parent===bones.Spine2;if(!inHand&&!back)return;
  const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const ch=bones.Spine2.getWorldPosition(V());let c;
  if(inHand){c=ch.clone().addScaledVector(f,.27).add(V(0,-.16,0));const lo=V(0,-.08,0);odReach('Left',c.clone().addScaledVector(r,-.18).add(lo),1);odReach('Right',c.clone().addScaledVector(r,.18).add(lo),1);}
  else c=ch.clone().addScaledVector(f,-.21).add(V(0,.03,0));
  const up=V(0,1,0);const X=up.clone().cross(r).normalize();const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X,up,r));const hs=(o.userData.home&&o.userData.home.scale)||1;
  const par=o.parent;par.updateWorldMatrix(true,false);const M=new THREE.Matrix4().compose(c,q,V(hs,hs,hs));M.premultiply(par.matrixWorld.clone().invert());M.decompose(o.position,o.quaternion,o.scale);o.updateMatrixWorld(true);}
 // OUTDOOR: a full bucket is carried like real weight: real mocap of a heavy case in the right hand (body leans away), else the sack carry
 const BUCKET=()=>has('hy_carrybucket')?'hy_carrybucket':'hy_carrysack';
 // OUTDOOR: both hands free on a ladder. What he carries in a hand goes over his shoulder on its rope (sling) for the climb
 // and back into the hand at the top or bottom; the carry overlay never runs on the ladder (it fought the rung grips).
 const SLING={logArmful:{off:[0,.1,-.17],rot:[0,0,Math.PI/2],hand:'Left',ho:[.1,.12,.1]},waterBucket:{off:[.1,-.02,-.2],rot:[0,0,.2],hand:'Right',ho:[0,.06,.02]},drainBucket:{off:[.1,-.02,-.2],rot:[0,0,.2],hand:'Right',ho:[0,.06,.02]},meatBag:{off:[.1,.18,-.14],rot:[0,0,0],hand:'Right',ho:[0,.1,.02]}};
 const slung={};
 function slingTick(){const P=PP();if(!P||!P.tools)return;const lad=!!H.lad;
  for(const n in SLING){const o=P.tools[n];if(!o)continue;const S=SLING[n];
   if(lad&&o.parent===bones[S.hand+'Hand']){onBack(n,V(...S.off),S.rot);if(SLUNG_AT[n])scene.attach(o);/* placed in the world by slungPost every frame */slung[n]=1;AU('cloth');}
   else if(!lad&&slung[n]&&!(H.path[0]&&H.path[0].t==='ladder')&&bones[S.hand+'Hand'].getWorldPosition(V()).y<bones.Hips.getWorldPosition(V()).y+.05){slung[n]=0;if(o.parent===bones.Spine2||o.parent===scene)try{P.grab(n,bones[S.hand+'Hand'],{offset:V(...S.ho)});AU('cloth');}catch(e){}}}
  if(lad&&H.ov&&H.carry&&H.ov.T===ovTracks(H.carry)&&H.ov.end-H.ov.t>.3)H.ov.end=H.ov.t+.3;}
 // after every pose: what is slung for the ladder hangs on its rope between the shoulder blades, upright in the world,
 // well below the neck (frame by frame the Spine2 offsets put the bucket over his head like a hat and the sack into his head)
 const SLUNG_AT={waterBucket:[.27,-.24,.36],drainBucket:[.29,-.25,.36],meatBag:[.3,-.22,.13]};/* [behind Spine2, below it, the rope's tie point up the load] */
 // the rope it hangs by: from the handle up over the right shoulder, across the chest to the left hip and round the back again
 let strap=null;const strapMat=new THREE.MeshStandardMaterial({color:0x6b4a2a,roughness:1});
 function strapTo(o,f,hs,ty,hip){const r=V(-f.z,0,f.x),l=r.clone().negate();const top=o.localToWorld(V(0,ty,0));const sp=bones.Spine2.getWorldPosition(V()),hp=bones.Hips.getWorldPosition(V());let pts;
  if(hip){const ls=bones.LeftShoulder.getWorldPosition(V());/* bandolier: handle -> up the back -> over the left shoulder -> across the chest -> down to the handle */
   pts=[top,sp.clone().addScaledVector(f,-.13).addScaledVector(r,.05),ls.clone().addScaledVector(f,-.06).add(V(0,.045,0)),ls.clone().addScaledVector(f,.07).add(V(0,.035,0)),sp.clone().addScaledVector(f,.15).addScaledVector(r,.03),hp.clone().addScaledVector(f,.1).addScaledVector(r,.2).add(V(0,.1,0)),top.clone().addScaledVector(f,.05)];}
  else{const sh=bones.RightShoulder.getWorldPosition(V());pts=[top,sh.clone().addScaledVector(f,-.1).add(V(0,.07,0)),sh.clone().addScaledVector(f,.06).add(V(0,.05,0)),sp.clone().addScaledVector(f,.14).addScaledVector(l,.02),hp.clone().addScaledVector(f,.1).addScaledVector(l,.15).add(V(0,.05,0)),
   hp.clone().addScaledVector(l,.19).add(V(0,.08,0)),hp.clone().addScaledVector(f,-.14).addScaledVector(l,.08).add(V(0,.12,0)),top.clone().addScaledVector(r,.05).add(V(0,-.02,0))];}
  const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,true,'centripetal'),48,.012,6,true)/* centripetal: no loop overshooting above the shoulder (film: a hoop over his head on the ladder) */;
  if(!strap){strap=new THREE.Mesh(g,strapMat);strap.castShadow=true;strap.frustumCulled=false;scene.add(strap);}else{strap.geometry.dispose();strap.geometry=g;}strap.visible=true;}
 function slungPost(){const P=PP();if(!P||!P.tools)return;let f=null,any=false;
  for(const n in SLUNG_AT){const o=P.tools[n];if(!o||!slung[n]||(o.parent!==bones.Spine2&&o.parent!==scene))continue;f=f||fwd(root.rotation.y);const S=SLUNG_AT[n];
   const hs=(o.userData.home&&o.userData.home.scale)||1;const sp=bones.Spine2.getWorldPosition(V());
   // clear of whatever sticks out furthest behind him: on a ladder the hips and thighs push back past the shoulder blades
   // (frame by frame his pelvis sat inside the bucket all the way up the rope ladder)
   let back=sp.dot(f);for(const bn of ['Hips','LeftUpLeg','RightUpLeg','Spine'])if(bones[bn])back=Math.min(back,bones[bn].getWorldPosition(V()).dot(f));
   let pos=sp.clone().addScaledVector(f,back-sp.dot(f)-S[0]).add(V(0,S[1]*hs,0));
   // a bucket hangs at his right hip on a rope across the chest from the left shoulder: rim below the shoulder blades, out
   // beside the thigh (watchers: on the back it either covered his head or read as round his waist)
   if(n!=='meatBag'){const r=V(-f.z,0,f.x);const hp=bones.Hips.getWorldPosition(V());pos=hp.clone().addScaledVector(r,.27).addScaledVector(f,-.24);pos.y=hp.y-.46;/* behind the hip: clear of the right arm reaching down the rungs */}
   const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,root.rotation.y,0,'YXZ'));const par=o.parent;par.updateWorldMatrix(true,false);
   const M=new THREE.Matrix4().compose(pos,q,V(hs,hs,hs));M.premultiply(par.matrixWorld.clone().invert());M.decompose(o.position,o.quaternion,o.scale);o.updateMatrixWorld(true);if(!any){any=true;strapTo(o,f,hs,S[2],n!=='meatBag');}}
  if(!any&&strap)strap.visible=false;}

 // OUTDOOR: the supply bucket on its shelf above the sink is higher than his head: taken down it comes straight down off the
 // shelf, in front of his chest, then to his side (QA: plumb from the fist it came down through his head and arms); put back the same way up
 function shelfPath(a){const P=PP();const o=P&&P.tools&&P.tools.waterBucket;if(a.step!=='clip'||!o||o.parent!==bones.RightHand)return false;
  const k=a.t/Math.max(.3,a.clipDur);const hs=(o.userData.home&&o.userData.home.scale)||1;const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
  const P3=P.toolHome('waterBucket').add(V(0,.35*hs,0)),P2=P3.clone().add(V(0,-.3,0)).addScaledVector(f,-.04);const fl=root.position.y;
  const P1=root.position.clone().addScaledVector(f,.42).addScaledVector(r,.06);P1.y=fl+1.18;
  const P0=bones.Hips.getWorldPosition(V()).addScaledVector(r,.28).addScaledVector(f,.06).add(V(0,-.12,0));
  const u=a.put?smooth(.08,.47,k):1-smooth(.47,.95,k);/* 1 = at the shelf */const seg=(A,B,x)=>A.clone().lerp(B,smooth(0,1,x));
  const at=u>.75?seg(P2,P3,(u-.75)/.25):u>.4?seg(P1,P2,(u-.4)/.35):seg(P0,P1,u/.4);odReach('Right',at,1);odHang('waterBucket',0,true);return true;}
 const carryOv=()=>{slingTick();if(H.carry&&H.path.length&&!H.lad&&has(H.carry)&&!H.ov)overlay(H.carry,{fade:.3,until:.98,weight:.85});};
 Object.assign(MAKE,{
  // out to the forest for meat or wood; gear from the workshop, out of sight for a while, back with the haul, gear off again
  trip:(o={})=>{const a={step:'go',t:0};const kind=o.kind||'hunt';const away=o.away||rnd(40,90);let res={ok:true};
   if(!N.g_out){a.update=()=>endTask({ok:false});return a;}
   const home=()=>{a.step='home';root.visible=true;H.look=null;H.lookW=0;/* OUTDOOR: no stale gaze from before the trip (he walked home staring at the sky) */H.node='g_out';
    const haul=kind==='hunt'?(res.ok?'meatBag':null):'logArmful';if(haul){try{PP().grab(haul,haul==='meatBag'?bones.RightHand:bones.LeftHand,{offset:haul==='meatBag'?V(0,.1,.02):V(.1,.12,.1)});}catch(e){}try{window.__audio.carry(true);}catch(e){}H.carry=haul==='meatBag'?'hy_carrysack':'hy_carrylogs';a.haul=haul;}
    const unload=next=>{if(!a.haul){next();return;}const P=PP();
     if(a.haul==='meatBag'){try{P.grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}fridgeVisit(a,'in',next);}
     else visit(a,PT('woodpile'),.5,'hy_droplogs',[[.6,()=>{try{P.release('logArmful');window.__audio.carry(false);}catch(e){}H.carry=null;}]],next);};
    a.unload=unload;if(a.leaving)return;unload(()=>gearOff(a,()=>{play(IDLE(),{fade:.4});endTask(res);}));};
   gearOn(a,{jacket:o.jacket,bow:o.bow??kind==='hunt',lantern:o.lantern},()=>{if(a.leaving)return;a.step='out';goTo('g_out',()=>{if(a.leaving)return;a.step='away';a.t=0;root.visible=false;
     if(kind==='hunt'&&Math.random()<.3)res={ok:false};else res=kind==='hunt'?{ok:true,meat:2}:{ok:true,logs:rnd(0,1)<.5?2:3};});});
   a.update=dt=>{if(stepTick(a,dt))return;carryOv();if(a.step==='away'){/* out of sight he turns round for home at an easy pace: no 180-degree snap when he reappears (QA: 45 cm/frame² hand jumps) */const fh=N.g_out.face!=null?N.g_out.face+Math.PI:H.face;H.face=fh;root.rotation.y+=clamp(wrapA(fh-root.rotation.y),-1.6*dt,1.6*dt);if(a.t>away&&Math.abs(wrapA(fh-root.rotation.y))<.02){root.rotation.y=fh;home();}}};
   // OUTDOOR: called away, he never walks off with the bow, quiver or lantern on him: the meat goes into the fridge and the
   // gear back on its pegs first, by hand (Pavel: worn only for the hunt). Out of sight in the forest he first comes back.
   a.leave=cb=>{a.leaving=true;root.visible=true;if(a.step==='away')a.step='home';
    const off=()=>{if(GEAR.bow||GEAR.lantern||GEAR.coat)gearOff(a,()=>{play(IDLE(),{fade:.4});cb();});else cb();};
    if(a.haul&&a.unload){const u=a.unload;a.unload=null;u(off);}else{if(a.haul){try{PP().release(a.haul);window.__audio.carry(false);}catch(e){}H.carry=null;a.haul=null;}off();}};a.post=()=>{if(a.haul==='logArmful')odArmful();};return a;},
  store:(o={})=>{const a={step:'go',t:0};const P=PP();try{P.grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}H.carry='hy_carrysack';
   fridgeVisit(a,'in',()=>endTask({ok:true}));
   a.update=dt=>{if(!stepTick(a,dt))carryOv();};a.leave=cb=>{try{P.release('meatBag');P.fridge.openTo(0,.4);}catch(e){}H.carry=null;cb();};return a;},
  eat:(o={})=>eatAction(o),
  // water: the tap bucket from the pond, the drain bucket emptied outside
  fetchwater:(o={})=>{const a={step:'go',t:0};const P=PP();const pond=window.__ground&&window.__ground.pond&&window.__ground.pond.fill;
   visit(a,PT('waterShelf'),.45,'hy_take',[[.45,()=>{try{P.grab('waterBucket',bones.RightHand,{offset:V(0,.06,.02)});}catch(e){}H.carry=BUCKET();}]],()=>{a.step='out';
    const spot=pond?pond.clone?pond.clone():V(pond.x,pond.y,pond.z):(N.g_exit1?N.g_exit1.p.clone().add(V(.6,0,.6)):null);
    const fill=()=>{a.step='fill';a.ft=0;a.fdone=()=>{try{window.__audio.carry(true);}catch(e){}play(IDLE(),{fade:.4});H.look=root.position.clone().addScaledVector(fwd(H.face),2.5);H.lookW=.6;/* a breath at the water before carrying it home */
      H.wait={t:rnd(1.5,2.5),then:()=>{a.step='back';a.put=1;H.look=null;H.lookW=0;/* no stale gaze up the ladder (he walked off it staring at the sky) */visit(a,PT('waterShelf'),.45,'hy_take',[[.5,()=>{try{P.release('waterBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>endTask({ok:true}));}};};};
    if(N.g_pond){goTo('g_pond',()=>{H.face=N.g_pond.face;a.step='turn';a.t=0;a.next=fill;a.adur=.6;a.step='approach';});return;}
    if(spot){const nn=nearNode(spot)||'g_exit1';goTo(nn,()=>approachTo(a,spot,.5,fill));}else fill();});
   a.update=dt=>{if(a.step==='fill'){pondFill(a,dt);return;}if(!stepTick(a,dt)){carryOv();if(H.carry&&H.path.length){a.sl=(a.sl||0)+dt;if(a.sl>.55){a.sl=0;AU('slosh',root.position);}}}};
   a.post=()=>{if(a.step==='fill'&&a.dip){H.bucketTilt=true;pondFillPost(a);}else if(!shelfPath(a))odHang('waterBucket',0);};
   a.leave=cb=>{try{P.release('waterBucket');window.__audio.carry(false);}catch(e){}H.carry=null;cb();};return a;},
  setbucket:(o={})=>{const a={step:'go',t:0,put:1,post:()=>{if(!shelfPath(a))odHang('waterBucket',0);}};const P=PP();visit(a,PT('waterShelf'),.45,'hy_take',[[.5,()=>{try{P.release('waterBucket',{blend:.3});}catch(e){}H.carry=null;}]],()=>endTask({ok:true}));
   a.update=dt=>{stepTick(a,dt);};return a;},
  dumpwater:(o={})=>{const a={step:'go',t:0};const P=PP();
   visit(a,PT('drainBay'),.22,'hy_pickground',[[.45,()=>{try{P.grab('drainBucket',bones.RightHand,{offset:V(0,.06,.02)});window.__audio.carry(true);}catch(e){}H.carry=BUCKET();}]],()=>{a.step='out';
    goTo('gate',()=>{H.face=N.gate.face??0;a.step='pour';a.t=0;play(IDLE(),{fade:.4});/* hy_water (a watering clip) twisted him 90 deg off the edge: the pour is the arms' own work */
     // long enough to empty it (the stream runs 5 s for a full bucket); emptied for sure at the end, else the brain sent him again and again
     let lv=.6;try{lv=P.water.dirty;}catch(e){}a.D=clamp(1.9+lv*5.2,2.8,6.5);H.wait={t:a.D,then:()=>{try{P.water.pour('drainBucket',false);P.water.setDirty(0);}catch(e){}
      a.step='back';a.back=1;visit(a,PT('drainBay'),.22,'hy_pickground',[[.47,()=>{try{P.release('drainBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>endTask({ok:true}));}};});});
   a.update=dt=>{if(stepTick(a,dt))return;carryOv();if(a.step==='pour'){/* up to the very edge (the gap in the rail for the ladder) so the stream goes over it, not onto the boards */if(!a.e0){a.e0=root.position.clone();}const ef=fwd(root.rotation.y);const k=smooth(0,.6,a.t)*(1-smooth(a.D-.6,a.D,a.t));root.position.x=a.e0.x+ef.x*.2*k;root.position.z=a.e0.z+ef.z*.2*k;if(a.t>.8&&!a.p){a.p=1;try{P.water.pour('drainBucket',true);}catch(e){}AU('bucket_dump',root.position);}}};
   // OUTDOOR: the pour: the fist lifts the bucket out over the edge, the other hand under its bottom tips it right over, then back
   // taking it from under the sink and putting it back: the fist carries it on a clean path between its spot and his side,
   // never past his legs (frame by frame his shin went into it as the pick-up clip swung the hand back by the feet)
   a.post=()=>{if(a.step==='clip'&&PP().tools.drainBucket.parent===bones.RightHand){const k=a.t/Math.max(.3,a.clipDur);const hs=PP().tools.drainBucket.userData.home.scale||1;
     const hg=PP().toolHome('drainBucket').add(V(0,.35*hs,0));const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const cy=bones.Hips.getWorldPosition(V()).addScaledVector(r,.3).addScaledVector(f,.08).add(V(0,-.12,0));
     const u=a.back?smooth(.12,.45,k):1-smooth(.5,.85,k);odReach('Right',cy.lerp(hg,u),1);odHang('drainBucket',0,true);return;}
    if(a.step!=='pour'){odHang('drainBucket',0);return;}H.bucketTilt=true;const D=a.D||2.8;const t=a.t;const w=smooth(0,.5,t)*(1-smooth(D-.5,D,t));const f=fwd(root.rotation.y);
    if(w>.01)odReach('Right',root.position.clone().addScaledVector(f,.62).addScaledVector(V(-f.z,0,f.x),.2).add(V(0,.85,0)),w);/* from the waist, leaning out over the edge: the tipped pail hangs in front of his belly, never up before his face (phone watch f1040) */const tilt=1.6*smooth(.45,.95,t)*(1-smooth(D-.8,D-.25,t));odHang('drainBucket',tilt);
    const bk=PP().tools.drainBucket;if(bk&&w>.01){const bt=bk.localToWorld(V(0,.02,0));odReach('Left',bt,.85*w*smooth(.3,.6,t));odHang('drainBucket',tilt);}};
   a.leave=cb=>{try{P.water.pour('drainBucket',false);P.release('drainBucket');window.__audio.carry(false);}catch(e){}H.carry=null;cb();};return a;},
  // OUTDOOR (Сделать вылазки наружу естественными): splitting firewood at the chopping block by the oak with the real axe.
  // He takes the axe out of the block, picks a round from the little stack beside it (squat, left hand), stands it on the block,
  // then swings two-handed: the axe goes up over his head round the shoulders and comes down so its edge lands on the round's top
  // (left hand at the handle's end, right hand above it). A blow either sticks (wiggle, pull out, swing again) or splits the round:
  // the halves tip off both sides onto the ground. The axe goes back into the block at the end. Everything moves only in a hand.
  splitwood:(o={})=>{const P=PP();const blk=P&&P.objects&&P.objects.chopblock;if(!blk||!hasTool('axe')){return {update:()=>endTask({ok:false})};}
   const S=splitState(blk);const top=()=>S.top.clone();
   // the plan: rounds, each split with 1-3 blows; the job lasts exactly as long as the plan
   const n=o.rounds||(2+(Math.random()<.5?1:0)),plan=[];let tot=.6;for(let i=0;i<n;i++){const hits=Math.random()<.55?1:Math.random()<.7?2:3;plan.push(hits);tot+=SPL_T.place+hits*SPL_T.swing+SPL_T.after;}
   blockNode(blk,S);
   return job({pt:()=>top().add(V(0,SPL_RH,0)),node:N.g_block?'g_block':undefined,slide:false,stand:1.05,tools:[['axe','Right']],dur:[tot,tot],vary:false,
    start:a=>{a.plan=plan;a.ri=0;a.ph='lead';a.pt=0;a.split=0;splitStock(S,n);},
    look:a=>a.lk||top().add(V(0,SPL_RH,0)),lookW:.9,
    tick:(a,dt)=>{if(SPLF.length)splitFall(dt);kneesClear(blk,dt);},clear:blk,
    post:(a,dt)=>{if(!a.axeOn){const ax=PP().tools.axe;if(ax&&ax.parent===bones.RightHand)a.axeOn=1;}splitPost(a,dt,S);},
    end:a=>{H.squat=0;a.w=0;a.axeOn=0;if(a.rd&&a.rd.parent!==scene){scene.attach(a.rd);}try{grabTool('axe','Right');}catch(e){}/* back into the fist to carry it to the block */},
    result:a=>({ok:true,split:a.split})});},
  hatch:MAKE.hatch,
 });
 {const cookBase=MAKE.cook;MAKE.cook=(o={})=>{if(!o.fromFridge)return cookBase(o);const a={step:'go',t:0};const P=PP();
  fridgeVisit(a,'out',()=>{
   try{P.release('meatBag');P.pan&&P.pan.setMeat&&P.pan.setMeat(true);}catch(e){}const inner=cookBase(o);act=inner;inner.name='cook';const cd=rnd(22,34);let ct=0;const iu=inner.update;inner.update=dt=>{iu&&iu(dt);ct+=dt;if(ct>cd&&!inner.left){inner.left=true;inner.leave(()=>{try{P.pan&&P.pan.setMeat&&P.pan.setMeat(false);P.plate&&P.plate.setFood&&P.plate.setFood(1);}catch(e){}endTask({ok:true});});}};});
  a.update=dt=>{stepTick(a,dt);};a.leave=cb=>{try{P.release('meatBag');P.fridge.openTo(0,.4);}catch(e){}cb();};return a;};}

 // ---------- sitting, lying down, getting up ----------
 // H.fit places the root so the hip joints are at fit.y (seat or mattress + clearance) whatever the clip assumes;
 // while sitting down / standing up it blends with how far the hips have travelled, so the body never pops.
 function sitDown(spot,then){H.trans=true;H.ground=false;H.face=spot.face;const fl=spot.floor??floorTop(BD);
  {const st=spot.p.clone().sub(rotY(V(sdEnd.x,0,sdEnd.z),spot.face));H.slide={x:st.x-root.position.x,z:st.z-root.position.z,yaw:wrapA(spot.face-root.rotation.y),k:0,d:.6};}
  H.fit={mode:'sit',base:fl,y:spot.seat+SEAT_CLEAR,hStand:hyAt(SIT,0),hSeat:hyAt(SIT,1)};
  once(SIT,{fade:.4,then:()=>{H.trans=false;H.seated=spot;H.fit.mode='hold';{const dx=spot.p.x-root.position.x,dz=spot.p.z-root.position.z;if(Math.hypot(dx,dz)<.3)H.slide={x:dx,z:dz,yaw:wrapA(spot.face-root.rotation.y),k:0,d:.6};}then&&then();}});}
 function standUp(spot,then){H.trans=true;H.face=spot.face;const fl=spot.floor??floorTop(BD);
  H.fit={mode:'rise',base:fl,y:spot.seat+SEAT_CLEAR,hStand:hyAt(STAND,1),hSeat:hyAt(STAND,0)};
  once(STAND,{fade:.45,until:.9,then:()=>{H.fit=null;H.seated=null;H.trans=false;H.ground=true;H.floorY=fl;play(IDLE(),{fade:.6});H.node=spot.node||(spot===N.chair?'chair_app':'bed_app');then&&then();}});}
 // lying down: sit on the edge, lean onto the left hand towards the pillow, lower the body and swing the legs up.
 // Done as a staged blend from the seated pose to the (pre-turned) sleep clip: torso leads, the legs follow; getting up is the same played backwards.
 const _bedQ=new THREE.Quaternion();
 function bedBlend(dir,then){const ed=N.bededge,li=N.bedlie;if(dir>0)H.edgeRoot=root.position.clone();
  const er=H.edgeRoot||V(ed.p.x,root.position.y,ed.p.z);if(SEATQ&&actions[SLEEPB])play(SLEEPB,{fade:0});
  H.fit=H.fit||{mode:'hold',base:floorTop(BD),y:ed.seat+SEAT_CLEAR};H.fit.mode='hold';root.rotation.y=0;H.face=0;
  H.bedB={dir,t:0,dur:dir>0?2.7:2.4,from:{x:er.x,z:er.z,y:ed.seat+SEAT_CLEAR},to:{x:li.p.x,z:li.p.z,y:li.seat+LIE_CLEAR},then};}
 function edgeTick(dt){const e=H.edgeHold;if(!e||H.bedB||!SEATQ)return;e.w=clamp(e.w+(e.to>e.w?1:-1)*dt/e.d,0,1);const w=smooth(0,1,e.w);
  if(w>0){for(let i=0;i<POSEBONES.length;i++){const bn=POSEBONES[i];bn.quaternion.slerp(SEATQ.q[i],w);}bones.Hips.position.y=lerp(bones.Hips.position.y,SEATQ.hy,w);}
  if(e.to===0&&e.w<=0)H.edgeHold=null;}
 function bedTick(dt){const b=H.bedB;if(!b)return;b.t=Math.min(b.dur,b.t+dt);const u=b.dir>0?b.t/b.dur:1-b.t/b.dur;
  const W={core:smooth(.04,.78,u),head:smooth(.45,1,u),la:smooth(.5,1,u),ra:smooth(.12,.85,u),leg:smooth(.3,.97,u)};b.W=W;b.u=u;
  if(SEATQ)for(let i=0;i<POSEBONES.length;i++){const bn=POSEBONES[i];const w=W[BED_GROUP[i]];_bedQ.copy(bn.quaternion);if(i===BED_MID.i&&BED_MID.q){if(w<.55)bn.quaternion.copy(SEATQ.q[i]).slerp(BED_MID.q,smooth(0,1,w/.55));else bn.quaternion.copy(BED_MID.q).slerp(_bedQ,smooth(0,1,(w-.55)/.45));}else bn.quaternion.copy(SEATQ.q[i]).slerp(_bedQ,w);}
  if(SEATQ)bones.Hips.position.y=lerp(SEATQ.hy,bones.Hips.position.y,W.core);
  // first down sideways along the edge, only then in under the upper bunk
  root.position.x=lerp(b.from.x,b.to.x,smooth(.05,.6,u));root.position.z=lerp(b.from.z,b.to.z,smooth(.38,.95,u));H.fit.y=lerp(b.from.y,b.to.y,W.core);
  if(b.t>=b.dur){H.bedB=null;b.then&&b.then();}}
 // left hand on the mattress while the body goes down (and pushes up on the way back)
 function bedHand(){const b=H.bedB;if(!b||!FIT.bed)return;const u=b.u;const w=smooth(.03,.2,u)*(1-smooth(.5,.72,u));if(w<.01)return;
  const hp=bones.Hips.getWorldPosition(V());const t=V(hp.x+.3*(FIT.bed.headDir||1),FIT.bed.mat+.04,Math.min(hp.z,FIT.bed.z1)-.12);
  armIK('Left',t,V(0,.3,1),w);}
 // legs over the bed's front rail (Pavel: they went through the left end of the bed): while getting in or out, any ankle that is over
 // the mattress or the rail is lifted to clear the mattress top, and kept off the foot board
 const legClr={Left:{l:0},Right:{l:0}};
 function bedLegClear(dt){if(window.__noLegClear)return;const b=H.bedB;const B=FIT.bed;if(!B||!(b||H.inBed)){legClr.Left.l=legClr.Right.l=0;return;}const railZ=B.z1+.08,yReq=B.mat+.1,xMin=B.x0+.07;
  for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());
   const k=smooth(railZ+.5,railZ+.03,a.z);const S=legClr[s];const want=Math.max(0,yReq-a.y)*k;S.l+=clamp(want-S.l,-1.1*dt,1.4*dt);S.l=Math.max(S.l,want*smooth(railZ+.12,railZ,a.z));
   const lift=S.l;const dx=Math.max(0,xMin-a.x)*k;if(lift<.002&&dx<.002)continue;
   const kn=L.getWorldPosition(V()),hp=U.getWorldPosition(V());const pole=kn.clone().sub(hp.clone().add(a).multiplyScalar(.5));ik2(U,L,F,a.clone().add(V(dx,lift,0)),pole,1,true);}}
 // ---------- asleep: on his back, on either side or on his stomach; now and then he turns over; slow breathing; eyes shut ----------
 // a layer over the lying clip: the whole body rolls about its long axis at the pelvis, then hips/knees/arms bend for the pose
 const SLEEP_POSES={back:{roll:0,flex:.12,knee:.18,armF:0,elb:0,lift:0,turnH:0},
  sideL:{roll:1.42,flex:.75,knee:1.15,armF:1.05,elb:.9,lift:.075,turnH:0},sideR:{roll:-1.42,flex:.75,knee:1.15,armF:1.05,elb:.9,lift:.075,turnH:0},
  bellyL:{roll:2.75,flex:.05,knee:.1,armF:.6,elb:1.2,lift:.02,turnH:.9},bellyR:{roll:-2.75,flex:.05,knee:.1,armF:.6,elb:1.2,lift:.02,turnH:-.9}};
 const SP={cur:{...SLEEP_POSES.back},from:null,to:null,t:0,dur:2.8,next:rnd(25,60),name:'back',w:0,br:0};
 const _qa=new THREE.Quaternion(),_qp=new THREE.Quaternion();
 function rotW(b,axis,ang){if(!b||Math.abs(ang)<1e-4)return;b.parent.getWorldQuaternion(_qp);_qa.setFromAxisAngle(axis,ang);const pi=_qp.clone().invert();b.quaternion.premultiply(pi.multiply(_qa).multiply(_qp));b.updateMatrixWorld(true);}
 const wp=(b)=>b.getWorldPosition(V());
 function sleepPick(){const c=SP.name;const opts={back:['sideL','sideR','sideL','sideR'],sideL:['back','bellyL','sideR'],sideR:['back','bellyR','sideL'],bellyL:['sideL'],bellyR:['sideR']}[c];return pick(opts);}
 function sleepTick(dt){const on=H.inBed&&!H.bedB&&!H.trans;SP.w+= ((on?1:0)-SP.w)*Math.min(1,dt*(on?.8:3));if(SP.w<.002){SP.w=0;if(!on){SP.name='back';SP.cur={...SLEEP_POSES.back};SP.to=null;}return;}
  if(on){if(SP.to){SP.t+=dt;const k=smooth(0,1,SP.t/SP.dur);for(const key in SP.cur)SP.cur[key]=lerp(SP.from[key],SP.to[key],k);
    const mid=Math.sin(Math.PI*Math.min(1,SP.t/SP.dur));SP.cur.flex+=.35*mid;SP.cur.knee+=.4*mid;SP.cur.lift+=.03*mid;// knees come up while he rolls
    if(SP.t>=SP.dur){SP.to=null;bedPress(true);}}
   else if((SP.next-=dt)<=0||(window.__sleepPose&&window.__sleepPose!==SP.name)){const n=window.__sleepPose||sleepPick();SP.from={...SP.cur};SP.to={...SLEEP_POSES[n]};SP.name=n;SP.t=0;SP.dur=rnd(2.4,3.4);SP.next=rnd(45,140);sfx&&sfx.rustle&&sfx.rustle();}}
  const c=SP.cur,w=SP.w;root.updateMatrixWorld(true);
  const hp=wp(bones.Hips),nk=wp(bones.Neck);const ax=nk.clone().sub(hp).setY(0).normalize();// roll about the bed's long axis (a tilted axis would swing the legs up)
  rotW(bones.Hips,ax,c.roll*w);
  // after the roll: the body's front, and each limb bends toward it
  const lft=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).normalize();const front=V().crossVectors(lft,ax).normalize();// character's left x up = front
  const bend=(a,b,ang,toFront=true)=>{if(!a||!b)return;const d=wp(b).sub(wp(a)).normalize();const axis=V().crossVectors(d,toFront?front:front.clone().negate());if(axis.lengthSq()<1e-6)return;rotW(a,axis.normalize(),ang*w);};
  const down=Math.abs(c.roll)>.3?(wp(bones.LeftUpLeg).y<wp(bones.RightUpLeg).y?'Left':'Right'):null;// the side he lies on
  for(const sd of ['Left','Right']){const top=down&&sd!==down;bend(bones[sd+'UpLeg'],bones[sd+'Leg'],c.flex*(top?1.15:.9));bend(bones[sd+'Leg'],bones[sd+'Foot'],c.knee*(top?1.1:.9),false);
   bend(bones[sd+'Arm'],bones[sd+'ForeArm'],c.armF*(top?.3:1));bend(bones[sd+'ForeArm'],bones[sd+'Hand'],c.elb*(top?.5:1));}
  if(bones.Neck&&Math.abs(c.turnH)>.01)rotW(bones.Neck,ax,-c.turnH*w);
  // breathing: about 13 breaths a minute, the chest rises a little
  SP.br+=dt*2*Math.PI/4.6;const lat=V().crossVectors(ax,front).normalize();rotW(bones.Spine1,lat,Math.sin(SP.br)*.025*w);rotW(bones.Spine2,lat,Math.sin(SP.br-.4)*.015*w);
  root.position.y+=c.lift*w;root.updateMatrixWorld(true);
  sleepLegRest(w,c,down);
  sleepArms(w,c,ax,front,lft,down);}
 // BED: on his side the upper leg rests (knee on the mattress in front of the lower knee, foot down): the roll + flex alone held the
 // top knee 36 cm up in the air and the quilt stood over it in a tall tent. Each joint is turned so its child drops to a resting height.
 function dropTo(a,b,yT,w){if(!a||!b)return;const pa=wp(a),pb=wp(b);const d=pb.clone().sub(pa);const L=d.length();if(pb.y<=yT+.005)return;
  const dy=Math.max(-L*.98,yT-pa.y);const hz=V(d.x,0,d.z);const hl=hz.length();if(hl<1e-4)return;const d2=hz.multiplyScalar(Math.sqrt(Math.max(0,L*L-dy*dy))/hl).setY(dy);
  const axis=V().crossVectors(d,d2);const sn=axis.length();if(sn<1e-6)return;const ang=Math.atan2(sn,d.dot(d2));rotW(a,axis.divideScalar(sn),ang*w);}
 function sleepLegRest(w,c,down){const B=FIT.bed;if(!B||!down||Math.abs(c.roll)>2.2)return;const top=down==='Left'?'Right':'Left';const k=w*(SP.to?.5:1);
  dropTo(bones[top+'UpLeg'],bones[top+'Leg'],B.mat+.17,k);dropTo(bones[top+'Leg'],bones[top+'Foot'],B.mat+.1,k);}
 // BED: the arms rest on something while he sleeps (watcher B3: the right forearm stayed raised with a stiff claw hand all night).
 // Back: left hand on the mattress beside the hip, right hand on the stomach. Side: the lower hand on the pillow by the face, the
 // upper one on the mattress in front of the chest. Stomach: both hands up by the head. Fingers relax toward the open bind pose.
 const FINGERS=[];root.traverse(o=>{if(o.isBone&&/Hand(Index|Middle|Ring|Pinky|Thumb)\d/.test(o.name))FINGERS.push({b:o,q0:o.quaternion.clone()});});
 function sleepArms(w,c,ax,front,lft,down){const B=FIT.bed;if(!B||w<.01)return;const mat=B.mat;const hp=wp(bones.Hips),ch=bones.Spine2?wp(bones.Spine2):hp.clone().addScaledVector(ax,.3),nk=wp(bones.Neck);
  const belly=Math.abs(c.roll)>2;const side=!belly&&Math.abs(c.roll)>.6;const k=w*(SP.to?.6:1);
  for(const sd of ['Left','Right']){const A=bones[sd+'Arm'],Fa=bones[sd+'ForeArm'],Hn=bones[sd+'Hand'];if(!Hn)continue;const out=lft.clone().multiplyScalar(sd==='Left'?1:-1);let t,pole;
   if(belly){t=nk.clone().addScaledVector(out,.24).addScaledVector(ax,-.02);t.y=mat+.06;pole=out.clone().add(V(0,-.3,0)).addScaledVector(ax,-.5);}
   else if(side){if(sd===down){t=nk.clone().addScaledVector(front,.2).addScaledVector(ax,.06);t.y=mat+.1;pole=ax.clone().negate().add(V(0,-.4,0));}
    else{t=ch.clone().addScaledVector(front,.26).addScaledVector(ax,-.08);t.y=mat+.07;pole=out.clone().add(ax.clone().multiplyScalar(-.4));}}
   else{if(sd==='Left'){t=hp.clone().addScaledVector(out,.24).addScaledVector(ax,.06);t.y=mat+.05;}else{t=hp.clone().addScaledVector(ax,.2).addScaledVector(out,.04);t.y=hp.y+.12;}pole=out.clone().add(V(0,-.3,0));}
   ik2(A,Fa,Hn,t,pole.normalize(),k,false);}
  for(const f of FINGERS)f.b.quaternion.slerp(f.q0,.65*w);root.updateMatrixWorld(true);}
 // eyes: shut while he sleeps (and as he lies down / until he sits up), a blink every few seconds when awake
 const BL={t:rnd(2,5),k:0};
 function lidTick(dt){let want=0;const b=H.bedB;if(H.inBed&&!b)want=1;if(H.bedC)want=H.bedC.dir>0?smooth(.75,1,H.bedC.u):1-smooth(0,.3,H.bedC.u);else if(b)want=smooth(.55,.9,b.u)*(b.dir>0?1:smooth(.75,.95,b.u));
  BL.t-=dt;if(BL.t<=0){BL.t=rnd(2.5,6);if(Math.random()<.2)BL.t=.25;BL.b=0;}if(BL.b!=null){BL.b+=dt;const k=BL.b<.07?BL.b/.07:1-(BL.b-.07)/.1;if(k<=0)BL.b=null;else want=Math.max(want,k);}
  BL.k+=(want-BL.k)*Math.min(1,dt*(want>BL.k?25:8));setLids(BL.k);}
 // the quilt and mattress sink under him (props.js bedPress)
 function bedPress(on){const P=window.__props||P3;if(!P)return;const hp=on?bones.Hips.getWorldPosition(V()):null;// asleep he lies under the quilt (props bedCover: a body-shaped mound)
  try{if(P.bedCover)P.bedCover(hp);/* BED: no bedPress(null) after it: both share one state, so that switched the cover off and the quilt never rose over him */else if(P.bedPress)P.bedPress(hp);}catch(e){}}
 // ===== BED: boots and vest come off by hand on the bed edge, and go on again in the morning (bed thread, 2026-11-24) =====
 // Pavel: he takes his boots off before sleep. They used to vanish in one frame. Now, sitting on the edge, he pulls each boot off
 // (hy_bootsoffR, then the same clip mirrored for the left foot), the boot leaves the foot in his hand and is set down beside the bed,
 // where it stands all night; in the morning he picks each one up and pulls it on (hy_bootsonR/L). The detailed hero's boots are their
 // own mesh (split per foot here); on the original hero the boots are part of the body, so the boot shell is cut out of the body
 // mesh as a prop and the foot left underneath turns into a grey wool sock. The detailed hero's vest comes off seated (hy_vestoff)
 // and lies folded at the foot of the bed; he puts it on again standing (hy_jacketon).
 const VEST=root.getObjectByName('vest'),BOOTS=root.getObjectByName('boots');
 const _bbm=new THREE.Matrix4(),_bm2=new THREE.Matrix4();
 const BT={init:false,side:{},vestProp:null,vestOn:true,sockU:{value:0}};
 function bootInit(){if(BT.init)return BT.ok;BT.init=true;try{
  let body=null;root.traverse(o=>{if(o.isSkinnedMesh&&o!==BOOTS&&o!==VEST&&o.name!=='eyelids'&&o.name!=='coat'&&(!body||o.geometry.attributes.position.count>body.geometry.attributes.position.count))body=o;});
  const src=BOOTS||body;if(!src)return BT.ok=false;const S=src.skeleton,g=src.geometry;const SI=g.attributes.skinIndex,SW=g.attributes.skinWeight,P=g.attributes.position;
  const bi=n=>S.bones.indexOf(bones[n]);root.updateMatrixWorld(true);
  // bind-pose positions in the skeleton's bind space (as the boot stands on the floor in the bind pose)
  const bp=i=>V(P.getX(i),P.getY(i),P.getZ(i)).applyMatrix4(src.bindMatrix);
  const c4=(A,i,k)=>k===0?A.getX(i):k===1?A.getY(i):k===2?A.getZ(i):A.getW(i);const wOf=(i,set)=>{let w=0;for(let k=0;k<4;k++){if(set.has(c4(SI,i,k)))w+=c4(SW,i,k);}return w;};
  // ankle height in the bind pose
  const ankY=n=>{const j=bi(n);const m=S.boneInverses[j].clone().invert();return V().setFromMatrixPosition(m).y;};
  const sel={Left:new Uint8Array(P.count),Right:new Uint8Array(P.count)};
  for(const sd of ['Left','Right']){const foot=new Set([bi(sd+'Foot'),bi(sd+'ToeBase'),bi(sd+'ToeBase_End')].filter(x=>x>=0)),leg=new Set([bi(sd+'Leg')]);const ay=ankY(sd+'Foot');
   for(let i=0;i<P.count;i++){if(BOOTS){sel[sd][i]=(wOf(i,foot)+wOf(i,leg))>.5?1:0;continue;}
    const wf=wOf(i,foot),wl=wOf(i,leg);if(wf+wl<.5)continue;const y=bp(i).y;if(wf>.5||y<ay+.13)sel[sd][i]=1;}}
  const idx=g.index?g.index.array:null;const nTri=idx?idx.length/3:P.count/3;const vi=(t,k)=>idx?idx[t*3+k]:t*3+k;
  const N0=g.attributes.normal,UV=g.attributes.uv;
  for(const sd of ['Left','Right']){const keep=[];for(let t=0;t<nTri;t++){const a=vi(t,0),b=vi(t,1),c=vi(t,2);if(sel[sd][a]&&sel[sd][b]&&sel[sd][c])keep.push(a,b,c);}
   if(keep.length<30)continue;const B={on:true,prop:null,skin:null};
   // the static boot: its triangles in the bind pose, origin at the sole's centre
   const used=[...new Set(keep)];const remap=new Map(used.map((v,i)=>[v,i]));const pos=new Float32Array(used.length*3),nor=new Float32Array(used.length*3),uv=UV?new Float32Array(used.length*2):null;
   const bb=new THREE.Box3();const nm=new THREE.Matrix3().getNormalMatrix(src.bindMatrix);
   used.forEach((v,i)=>{const q=bp(v);pos.set([q.x,q.y,q.z],i*3);bb.expandByPoint(q);const n=V(N0.getX(v),N0.getY(v),N0.getZ(v)).applyMatrix3(nm).normalize();nor.set([n.x,n.y,n.z],i*3);if(uv)uv.set([UV.getX(v),UV.getY(v)],i*2);});
   const c=bb.getCenter(V());for(let i=0;i<used.length;i++){pos[i*3]-=c.x;pos[i*3+1]-=bb.min.y;pos[i*3+2]-=c.z;}
   const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(pos,3));sg.setAttribute('normal',new THREE.BufferAttribute(nor,3));if(uv)sg.setAttribute('uv',new THREE.BufferAttribute(uv,2));sg.setIndex(keep.map(v=>remap.get(v)));
   const pm=new THREE.Mesh(sg,(Array.isArray(src.material)?src.material[0]:src.material).clone());pm.castShadow=true;pm.visible=false;pm.name='boot'+sd;scene.add(pm);
   B.prop=pm;B.c0=V(c.x,bb.min.y,c.z);// bind-space position of the prop origin
   B.foot=bones[sd+'Foot'];B.fi=bi(sd+'Foot');B.S=S;B.src=src;
   if(BOOTS){const sk=new THREE.SkinnedMesh(g.clone(),BOOTS.material);sk.geometry.setIndex(keep);sk.name='boots'+sd;sk.castShadow=BOOTS.castShadow;sk.frustumCulled=false;BOOTS.parent.add(sk);sk.position.copy(BOOTS.position);sk.quaternion.copy(BOOTS.quaternion);sk.scale.copy(BOOTS.scale);sk.bind(S,BOOTS.bindMatrix);B.skin=sk;}
   {bootWorld(B,_bbm);const P_=V(),Q_=new THREE.Quaternion(),S_=V();_bbm.decompose(P_,Q_,S_);BT.sc=S_.x;}
   BT.side[sd]=B;}
  if(BOOTS&&BT.side.Left&&BT.side.Right)BOOTS.visible=false;
  // original hero: the foot under the boot becomes a wool sock while the boot is off
  if(!BOOTS&&body&&(BT.side.Left||BT.side.Right)){const m=new Float32Array(P.count);for(let i=0;i<P.count;i++)m[i]=(sel.Left[i]||sel.Right[i])?1:0;g.setAttribute('sock',new THREE.BufferAttribute(m,1));
   const mats=Array.isArray(body.material)?body.material:[body.material];body.material=mats.map(m0=>{const m=m0.clone();m.onBeforeCompile=sh=>{sh.uniforms.sockK=BT.sockU;
     sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float sock;varying float vSock;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSock=sock;');
     sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float sockK;varying float vSock;').replace('#include <map_fragment>','#include <map_fragment>\n{float l=dot(diffuseColor.rgb,vec3(.3,.59,.11));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.27,.25,.23)*(.8+.5*l),vSock*sockK);}');};
     m.customProgramCacheKey=()=>'hero-sock';return m;});if(body.material.length===1)body.material=body.material[0];}
  return BT.ok=true;}catch(e){console.error('boots',e);return BT.ok=false;}}
 // world matrix the static boot needs to sit exactly where the skinned boot is drawn right now
 function bootWorld(B,out){root.updateMatrixWorld(true);const S=B.S;out.copy(B.foot.matrixWorld).multiply(S.boneInverses[B.fi]).multiply(_bm2.makeTranslation(B.c0.x,B.c0.y,B.c0.z));
  if(B.src.bindMode==='detached'){/* not used by these rigs */}return out;}
 function bootSpot(sd){const ed=N.bededge;const hd=FIT.bed&&FIT.bed.headDir||1;// beside the bed, to his right (the foot end), toes to the room
  const k=sd==='Right'?0:1;return {p:V(ed.p.x-hd*(.42+k*.14),(ed.floor??floorTop(BD)),(FIT.bed?FIT.bed.z1:ed.p.z)+.16+k*.03),yaw:(sd==='Right'?.18:-.12)};}
 function bootShow(sd,on){const B=BT.side[sd];if(!B)return;B.on=on;if(B.skin)B.skin.visible=on;if(!BOOTS){BT.sockU.value=(BT.side.Left&&!BT.side.Left.on||BT.side.Right&&!BT.side.Right.on)?1:0;}}
 function bootPark(sd){const B=BT.side[sd];if(!B)return;const s=bootSpot(sd);const pm=B.prop;scene.attach(pm);pm.position.copy(s.p);pm.rotation.set(0,s.yaw,0);pm.scale.setScalar(BT.sc||1);pm.visible=true;}
 // the boot leaves the foot in his hand: the prop takes the skinned boot's exact place, then rides with the hand bone
 function bootToHand(sd,hand){const B=BT.side[sd];if(!B)return;const pm=B.prop;bootWorld(B,_bbm);scene.add(pm);pm.matrix.copy(_bbm);pm.matrix.decompose(pm.position,pm.quaternion,pm.scale);pm.visible=true;bones[hand+'Hand'].attach(pm);bootShow(sd,false);}
 // set down: from the hand to its spot beside the bed in a short, eased move (the hand lets go just above the floor)
 const BTW=[];function bootTween(pm,toP,toQ,d,then){scene.attach(pm);BTW.push({pm,p0:pm.position.clone(),q0:pm.quaternion.clone(),toP,toQ,t:0,d,then});}
 function bootTweenTick(dt){for(let i=BTW.length-1;i>=0;i--){const w=BTW[i];w.t+=dt;const k=smooth(0,1,Math.min(1,w.t/w.d));w.pm.position.lerpVectors(w.p0,w.toP,k);w.pm.quaternion.slerpQuaternions(w.q0,w.toQ,k);if(w.t>=w.d){BTW.splice(i,1);w.then&&w.then();}}}
 function bootDown(sd){const B=BT.side[sd];if(!B)return;const s=bootSpot(sd);bootTween(B.prop,s.p,new THREE.Quaternion().setFromAxisAngle(V(0,1,0),s.yaw),.35);AU('thud',s.p);}
 // morning: the boot comes up from the floor into the hand, then onto the foot (the prop eases onto the skinned boot's place, then swaps)
 function bootPick(sd,hand){const B=BT.side[sd];if(!B)return;const pm=B.prop;pm.visible=true;const h=bones[hand+'Hand'];const hp=h.getWorldPosition(V());
  bootTween(pm,hp.clone().add(V(0,-.06,0)),pm.quaternion.clone(),.3,()=>{h.attach(pm);});}
 function bootOn(sd){const B=BT.side[sd];if(!B)return;const pm=B.prop;bootWorld(B,_bbm);const P_=V(),Q_=new THREE.Quaternion(),S_=V();_bbm.decompose(P_,Q_,S_);bootTween(pm,P_,Q_,.25,()=>{pm.visible=false;bootShow(sd,true);});}
 // the vest: off seated and laid folded at the foot end of the mattress; on again standing
 function vestProp(){if(BT.vestProp||!VEST)return BT.vestProp;const g=VEST.geometry;const m=(Array.isArray(VEST.material)?VEST.material[0]:VEST.material).clone();
  const P=g.attributes.position;const pos=new Float32Array(P.count*3);const bb=new THREE.Box3();for(let i=0;i<P.count;i++){const q=V(P.getX(i),P.getY(i),P.getZ(i)).applyMatrix4(VEST.bindMatrix);pos.set([q.x,q.y,q.z],i*3);bb.expandByPoint(q);}
  const c=bb.getCenter(V());// folded: flattened to a low pile, laid on its back on the quilt
  for(let i=0;i<P.count;i++){const x=pos[i*3]-c.x,y=pos[i*3+1]-c.y,z=pos[i*3+2]-c.z;pos[i*3]=x*.55;pos[i*3+1]=z*.35+.025;pos[i*3+2]=-y*.45;}
  const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(pos,3));if(g.attributes.uv)sg.setAttribute('uv',g.attributes.uv);sg.setIndex(g.index);sg.computeVertexNormals();
  const pm=new THREE.Mesh(sg,m);pm.castShadow=true;pm.visible=false;pm.name='vestFolded';scene.add(pm);return BT.vestProp=pm;}
 function vestPark(on){const pm=vestProp();if(!pm)return;if(on){const B=FIT.bed;const hd=B.headDir||1;pm.position.set(hd>0?B.x0+.28:B.x1-.28,B.mat+.03,B.z1-.22);pm.rotation.set(0,.35,0);pm.scale.setScalar(BT.sc||1);}pm.visible=on;}
 function vestShow(on){BT.vestOn=on;if(VEST)VEST.visible=on;}
 // instant state (spawned in bed, reset): no clips
 function undress(off,quiet){bootInit();for(const sd of ['Left','Right']){const B=BT.side[sd];if(!B)continue;for(let i=BTW.length-1;i>=0;i--)if(BTW[i].pm===B.prop)BTW.splice(i,1);if(off){bootShow(sd,false);bootPark(sd);}else{B.prop.visible=false;scene.attach(B.prop);bootShow(sd,true);}}
  if(VEST){vestShow(!off);vestPark(off);}if(!quiet)AU(off?'unzip':'zip',root.position);}
 // a seated clip with beats at clip seconds; the lifted foot may leave the floor (H.fit.liftOK), the planted one stays put
 const BSEQ={a:null,b:[],then:null};
 function seatedClip(name,beats,then){const a=actions[name];if(!a){then&&then();return;}H.fit&&(H.fit.liftOK=true);BSEQ.a=a;BSEQ.b=beats.slice().sort((x,y)=>x[0]-y[0]);BSEQ.then=then;
  once(name,{fade:.45,speed:1.3,then:()=>{for(const [,f] of BSEQ.b)f();BSEQ.a=null;BSEQ.b=[];if(H.fit)H.fit.liftOK=false;then&&then();}});}
 // seated on the bunk edge the upper body may lean forward, never far back: the clip's backward recline (lifting a foot onto
 // the knee) laid him down across the mattress with an arm out; the spine is turned so the chest stays at most ~8 degrees behind
 // the pelvis, spread over the three spine bones
 function seatLeanLimit(){if(!bones.Neck||!bones.Spine)return;root.updateMatrixWorld(true);const hp=bones.Hips.getWorldPosition(V()),nk=bones.Neck.getWorldPosition(V());const up=nk.sub(hp).normalize();const f=fwd(root.rotation.y);
  const back=Math.atan2(-up.dot(f),up.y);const MAX=.14;if(back<=MAX)return;const lat=V().crossVectors(V(0,1,0),f).normalize();// rotating about lat by +a tips the top toward f
  const d=back-MAX;for(const n of ['Spine','Spine1','Spine2'])rotW(bones[n],lat,d/3);}
 function bseqTick(dt){bootTweenTick(dt);if(!BSEQ.a)return;seatLeanLimit();const t=BSEQ.a.time;while(BSEQ.b.length&&t>=BSEQ.b[0][0]){const [,f]=BSEQ.b.shift();f();}}
 // clip times (s, after trimming) of the hand events, measured from the mocap keypoints
 const BOOT_OFF={grab:2.05/1.25,down:4.1/1.25},BOOT_ON=BOOTREV.R?{pick:BOOTREV.R-4.1/1.25+.05,on:BOOTREV.R-2.05/1.25}:{pick:.55/1.25,on:2.1/1.25},VEST_OFF={off:2.0};
 function undressSeq(done){bootInit();const steps=[];
  for(const sd of ['Right','Left']){const B=BT.side[sd];if(!B||!B.on||!has('hy_bootsoff'+sd[0]))continue;
   steps.push(n=>seatedClip('hy_bootsoff'+sd[0],[[BOOT_OFF.grab,()=>{if(B.on)bootToHand(sd,sd);}],[BOOT_OFF.down,()=>{if(B.prop.parent!==scene&&!B.on)bootDown(sd);}]],n));}
  if(VEST&&BT.vestOn&&has('hy_vestoff'))steps.push(n=>seatedClip('hy_vestoff',[[VEST_OFF.off,()=>{vestShow(false);AU('unzip',root.position);}],[VEST_OFF.off+.6,()=>vestPark(true)]],n));
  else if(VEST&&BT.vestOn){vestShow(false);vestPark(true);}
  let i=0;const next=()=>{if(i<steps.length)steps[i++](next);else done&&done();};next();}
 function dressSeq(done){bootInit();const steps=[];
  for(const sd of ['Right','Left']){const B=BT.side[sd];if(!B||B.on)continue;if(!has('hy_bootson'+sd[0])){bootShow(sd,true);B.prop.visible=false;continue;}
   steps.push(n=>seatedClip('hy_bootson'+sd[0],[[BOOT_ON.pick,()=>bootPick(sd,sd)],[BOOT_ON.on,()=>bootOn(sd)]],n));}
  let i=0;const next=()=>{if(i<steps.length)steps[i++](next);else done&&done();};next();}
 function vestOnStanding(){if(!VEST||BT.vestOn)return;if(has('hy_jacketon')){overlay('hy_jacketon',{fade:.4,speed:1.2});setTimeoutGame(.9,()=>{vestPark(false);vestShow(true);AU('zip',root.position);});}else{vestPark(false);vestShow(true);}}
 const GT=[];function setTimeoutGame(t,f){GT.push({t,f});}function gtTick(dt){for(let i=GT.length-1;i>=0;i--){if((GT[i].t-=dt)<=0){const f=GT[i].f;GT.splice(i,1);f();}}}
 // ===== BED: lying down and getting up are real motion (bed thread, 2026-11-24) =====
 // The seated pose -> sleep clip blend went through impossible frames (spine folded backwards, head at the foot end, forearms over the
 // head). Now a whole human motion plays: from the edge he leans onto his left elbow toward the pillow and swings both legs up
 // (hy_bedlie, mocap screened for knees); in the morning he pushes up and swings the legs down to sit on the edge (hy_bedgetup).
 // Code only moves the root so the hips end exactly on the measured lying / sitting spot, sets the hip height on the mattress,
 // and lets the planted feet go as the legs come up.
 function clipHipsXZ(name,end){const c=actions[name]&&actions[name].getClip();if(!c)return V();const tr=c.tracks.find(t=>/Hips\.position$/.test(t.name));if(!tr)return V();const v=tr.values,n=v.length/3;
  const i=end?n-1:0;return V(v[i*3]-v[0],0,v[i*3+2]-v[2]);}
 const BEDC_SPEED=1.05;
 function bedClip(dir,then){const name=dir>0?'hy_bedlie':'hy_bedgetup';if(!has(name)||!FIT.bed||(FIT.bed.headDir||1)<0)return bedBlend(dir,then);
  const ed=N.bededge,li=N.bedlie;if(dir>0)H.edgeRoot=root.position.clone();const er=H.edgeRoot||V(ed.p.x,root.position.y,ed.p.z);
  root.rotation.y=0;H.face=0;// the clip's own hip travel is pinned (hx0/hz0): the root alone carries him, so he slides out from under the upper bunk BEFORE he sits up
  const from=root.position.clone(),to=dir>0?V(li.p.x,0,li.p.z):V(er.x,0,er.z);const c0=clipHipsXZ(name,false);
  H.fit=H.fit||{mode:'hold',base:floorTop(BD),y:ed.seat+SEAT_CLEAR};H.fit.mode='hold';
  const y0=dir>0?ed.seat+SEAT_CLEAR:li.seat+LIE_CLEAR,y1=dir>0?li.seat+LIE_CLEAR:ed.seat+SEAT_CLEAR;
  const tr=actions[name].getClip().tracks.find(t=>/Hips\.position$/.test(t.name));H.bedC={dir,t:0,dur:durOf(name)/BEDC_SPEED,from,to,y0,y1,u:0,plant:dir>0?1:0,then,name,hx0:tr?tr.values[0]:null,hz0:tr?tr.values[2]:null};
  once(name,{fade:dir>0?.45:.6,speed:BEDC_SPEED});}
 function bedClipTick(dt){const c=H.bedC;if(!c)return;c.t=Math.min(c.dur,c.t+dt);const u=c.u=c.t/c.dur;
  // across the bed: first along the edge toward the pillow, then in under the upper bunk (getting up: out first)
  if(c.hx0!=null){bones.Hips.position.x=c.hx0;bones.Hips.position.z=c.hz0;}
  const kx=c.dir>0?smooth(.05,.6,u):smooth(.1,.6,u),kz=c.dir>0?smooth(.4,.95,u):smooth(0,.42,u);
  root.position.x=lerp(c.from.x,c.to.x,kx);root.position.z=lerp(c.from.z,c.to.z,kz);H.fit.y=lerp(c.y0,c.y1,c.dir>0?smooth(.1,.7,u):smooth(.3,.9,u));
  c.plant=c.dir>0?1-smooth(.12,.38,u):smooth(.62,.9,u);
  // getting up he pushes the quilt off as he rises: it follows his body for the first moments, then settles flat
  if(c.dir<0&&!c.qoff&&u>.22){c.qoff=true;bedPress(false);}
  if(c.t>=c.dur){H.bedC=null;c.then&&c.then();}}
 function lieDown(then){const ed=N.bededge;H.face=0;
  sitDown(ed,()=>{H.trans=true;undressSeq(()=>{H.wait={t:rnd(.3,.6),then:()=>{bedClip(1,()=>{
   // hand over to the sleep clip: the root eases onto the lying spot while the poses cross-fade
   const li=N.bedlie;if(has('hy_bedlie'))play(SLEEPB,{fade:1.1});H.slide={x:li.p.x-root.position.x,z:li.p.z-root.position.z,yaw:0,k:0,d:1.1};
   H.trans=false;H.inBed=true;bedPress(true);H.seated=null;then&&then();});}};});});}
 function getUp(then){H.trans=true;const ed=N.bededge;
  H.wait={t:rnd(.4,.9),then:()=>{H.inBed=false;if(!has('hy_bedgetup')||!FIT.bed||(FIT.bed.headDir||1)<0)bedPress(false);bedClip(-1,()=>{const er=H.edgeRoot||V(ed.p.x,root.position.y,ed.p.z);
   hold(STAND,0,.6);H.slide={x:er.x-root.position.x,z:er.z-root.position.z,yaw:0,k:0,d:.6};H.seated=ed;
   H.wait={t:rnd(.6,1),then:()=>{dressSeq(()=>{hold(STAND,0,.5);H.wait={t:.35,then:()=>standUp(ed,()=>{vestOnStanding();if(!VEST&&has('hy_stretch')&&Math.random()<.8)overlay('hy_stretch',{fade:.5,speed:1.1});then&&then();})};});}};});}};}
 function swingTick(dt){const s=H.swing;if(!s)return;if(s.k===0){if(s.hold)hold(s.hold[0],s.hold[1],s.fade);else play(s.clip,{fade:s.fade});H.fit=H.fit||{mode:'hold',base:floorTop(BD),y:s.from.y};H.fit.mode='hold';}
  s.k=Math.min(1,s.k+dt/s.dur);const k=smooth(0,1,s.k);
  root.position.x=lerp(s.from.p.x,s.to.p.x,k);root.position.z=lerp(s.from.p.z,s.to.p.z,k);root.rotation.y=s.from.yaw+wrapA(s.to.yaw-s.from.yaw)*smooth(.1,.9,s.k);H.face=root.rotation.y;H.fit.y=lerp(s.from.y,s.to.y,k);
  if(s.k>=1){H.swing=null;s.then&&s.then();}}

 // ---------- per frame ----------
 // freeze guard: a finished one-off clip that nothing follows, a ladder clip with no ladder, or a body hanging above the floor
 // with nothing holding it there (no seat, bed, ladder, slide) -> recover in place and let the next task start
 const FZ={t:0,lt:0,ft:0,p:null,ct:-1,c:null};
 function freezeGuard(dt){const c=H.cur;const nm=c&&c.getClip?c.getClip().name:null;const p=root.position;const tm=c?c.time:0;
  const still=FZ.p&&FZ.p.distanceTo(p)<.003&&nm===FZ.c&&Math.abs(tm-FZ.ct)<1e-4;FZ.p=p.clone();FZ.c=nm;FZ.ct=tm;
  const busy=H.seated||H.inBed||H.lad||H.slide||H.fit||H.wait||(H.path&&H.path.length);
  FZ.t=still&&!busy?FZ.t+dt:0;FZ.lt=(!H.lad&&/^43[57]$/.test(nm||''))?FZ.lt+dt:0;
  let fl=null;if(!busy&&!H.trans&&H.ground&&typeof floorAt==='function'){try{fl=floorAt(p.x,p.y,p.z,.32);}catch(e){}}FZ.ft=(fl!=null&&p.y-fl>.1&&p.y-fl<.6)?FZ.ft+dt:0;
  if(FZ.ft>1.5){p.y=fl;H.floorY=fl;FZ.ft=0;}
  if(FZ.t>6||FZ.lt>2.5){FZ.t=0;FZ.lt=0;console.warn('[hero] freeze guard: recover',H.task,nm,p.toArray().map(v=>+v.toFixed(2)));H.trans=false;H.lad=null;H.stk=null;H.once=null;
   play(IDLE(),{fade:.5});const n=H.task;if(n&&act){if(act.leave&&!act.left){act.left=true;try{act.leave(()=>{endTask(false);});}catch(e){endTask(false);}}else endTask(false);}}}
 // ===== HERO-RULES 1: one pose pipeline. Modules register a pass in a fixed slot instead of wrapping HH.update =====
 const SLOTS=['pre','motion','look','contacts','collide','grab','pops','guard'];const STAGES={};for(const k of SLOTS)STAGES[k]=[];
 function stage(slot,fn){if(!STAGES[slot])throw new Error('unknown hero slot '+slot);STAGES[slot].push(fn);return fn;}
 function runSlot(slot,dt){const L=STAGES[slot];for(let i=0;i<L.length;i++){try{L[i](dt);}catch(e){console.error('hero slot '+slot,e);}}}
 function update(dt){if(dt<=0)return;runSlot('pre',dt);const r=updateCore(dt);runSlot('collide',dt);runSlot('grab',dt);runSlot('pops',dt);runSlot('guard',dt);if(INV.on)invCheck(dt);return r;}
 // HERO-RULES 3, live: ?inv in the URL (or HH.inv.on=true) checks the final pose every frame (geometry only, no bone axes)
 // and counts what breaks per task; HH.inv.report() lists them, the first of each kind is logged with its frame
 const INV={on:/[?&]inv\b/.test(location.search),n:0,hits:{},prev:null,report(){return Object.entries(this.hits).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=>k+' x'+v.n+' worst '+v.worst.toFixed(v.unit==='deg'?0:2)+v.unit+' first f'+v.f);},reset(){this.hits={};this.n=0;}};
 function invHit(kind,val,unit){const k=(H.task||H.state||'-')+(H.lad?' (ladder)':H.trans?' (transition)':H.state==='walk'?' (walking)':'')+' / '+kind;const h=INV.hits[k];if(!h){INV.hits[k]={n:1,worst:val,unit,f:INV.n};console.warn('[inv] f'+INV.n+' '+k+' '+val.toFixed(2)+unit);}else{h.n++;if(val>h.worst)h.worst=val;}}
 function invCheck(dt){INV.n++;const busy=H.lad||H.trans||H.seated||H.inBed||H.fit||!root.visible;const w=n=>bones[n].getWorldPosition(V());
  if(!busy&&H.ground&&H.floorY!=null){const lo=Math.min(w('LeftFoot').y,w('RightFoot').y)-H.floorY;if(lo>.16)invHit('feet in the air',lo,'m');}
  // knees: the bend plane's normal (thigh x shin) points to his left for a real knee, to his right for a broken one
  const lh=w('LeftUpLeg'),rh=w('RightUpLeg');const toR=rh.clone().sub(lh).normalize();
  for(const sd of ['Left','Right']){const hp=sd==='Left'?lh:rh,kn=w(sd+'Leg'),an=w(sd+'Foot');const th=kn.clone().sub(hp),sh=an.clone().sub(kn);const ang=th.angleTo(sh);if(ang>.35&&th.clone().cross(sh).normalize().dot(toR)>.5)invHit(sd+' knee backwards',ang*57.3,'deg');}
  // head roll: the ear-to-ear axis tilted from level
  {const x=V(1,0,0).applyQuaternion(bones.Head.getWorldQuaternion(new THREE.Quaternion()));const r=Math.abs(Math.asin(clamp(x.y,-1,1)))*57.3;if(r>15&&!H.inBed)invHit('head roll',r,'deg');}
  const hp=w('Hips');if(INV.prev&&dt>0){const v=hp.distanceTo(INV.prev.h)/dt;if(v>4&&!H.lad&&root.visible)invHit('hips snap',v,'m/s');const yv=Math.abs(wrapA(root.rotation.y-INV.prev.y))/dt;if(yv>9)invHit('turn snap',yv*57.3,'deg/s');}
  INV.prev={h:hp,y:root.rotation.y};}
 function updateCore(dt){freezeGuard(dt);
  // ===== BRAIN HOOK: an attached brain (game/brain.js) decides what to do; the body below only carries it out =====
  if(brain){if(H.wait){H.wait.t-=dt;if(H.wait.t<=0){const f=H.wait.then;H.wait=null;f&&f();}}
   const mode=ctx.mode?ctx.mode():null;if(mode&&mode!==H.task&&(mode==='guard'||mode==='repair')&&!H.trans)startTask(mode);
   try{brain.tick(dt,{task:H.task,step:act?act.step:null,free:!H.trans&&!H.path.length&&!H.wait&&!H.swing,seated:!!H.seated,inBed:!!H.inBed,node:H.node,hour:hour()});}catch(e){console.error('brain',e);brain=null;}}
  else{
  // ===== END BRAIN HOOK (built-in chooser follows) =====
  const h=hour(),night=ctx.isNight(h);
  need.energy=clamp(need.energy-dt*(H.task==='sleep'&&H.inBed?-.02:.0015),0,1);need.hunger=clamp(need.hunger+dt*.002,0,1);need.fun=clamp(need.fun+dt*.003,0,1);need.tidy=clamp(need.tidy+dt*.0012,0,1);
  if(act&&act.name&&ACT[act.name]&&ACT[act.name].need&&H.state==='work'){need[ACT[act.name].need]=clamp(need[ACT[act.name].need]-dt*.03,0,1);}
  if(H.wait){H.wait.t-=dt;if(H.wait.t<=0){const f=H.wait.then;H.wait=null;f&&f();}}
  if(!H.trans&&!H.path.length){const mode=ctx.mode?ctx.mode():null;
   if(mode&&mode!==H.task&&(mode==='guard'||mode==='repair'))startTask(mode);
   else if(!H.task)startTask(choose());
   else if(H.task==='sleep'&&!night&&h>6.2)startTask(choose());
   else if(H.task!=='sleep'&&H.task!=='guard'&&H.task!=='repair'&&act&&act.step&&act.step!=='go'&&(actT+=dt)>actDur){
    // between activities: sometimes linger, stretch or glance around before moving on
    if(!H.linger&&!H.seated&&Math.random()<.45){H.linger=rnd(3,5);const c=pick(has('hy_stretch')&&h<11?['hy_stretch','336']:['336',IDLE(),IDLE()]);H.lingerClip=c;if(c==='hy_stretch'){H.linger=durOf(c);once(c,{fade:.6});}}
    if(H.linger&&!H.seated){H.linger-=dt;if(H.lingerClip!=='hy_stretch')play(H.lingerClip,{fade:.6});H.look=null;H.lookW=0;if(H.linger>0)return post(dt);}
    H.linger=0;startTask(night&&h<21.5&&h>=20?'read':choose());}
   else if(night&&H.task!=='sleep'&&H.task!=='guard'&&(h>=21.5||h<5)){startTask('sleep');}}
  }
  if(H.lad&&(!H.path.length||H.path[0].t!=='ladder')){H.lad=null;H.ground=true;}
  if(H.pending&&!H.trans&&!H.lad){const n=H.pending,o=H.pendingOpts;H.pending=null;H.pendingOpts=null;startTask(n,o);}
  // movement
  if(H.path.length){const step=H.path[0];if(step.t==='ladder')ladderStep(dt);else walkStep(dt);if(!H.path.length&&H.then){const f=H.then;H.then=null;H.state='work';f();}}
  else if(H.state==='walk'){H.state='work';H.v=0;}
  if(!H.path.length){if(!H.swing&&!H.trans&&!H.seated&&!H.inBed){const da=wrapA(H.face-root.rotation.y);const wav=clamp(da*3.5,-2.6,2.6);H.av=(H.av||0)+clamp(wav-(H.av||0),-6*dt,6*dt);if(Math.abs(da)<.002&&Math.abs(H.av)<.02)H.av=0;root.rotation.y+=H.av*dt;
     if(Math.abs(da)>.35&&H.cur&&['0','11','12','336','30','hy_idle'].includes(H.cur.getClip().name)){play('30',{fade:.3,speed:.7});H.turnStep=true;}else if(H.turnStep&&Math.abs(da)<.12){H.turnStep=false;if(H.cur===actions['30'])play(IDLE(),{fade:.4});}}}
  if(act&&act.update)act.update(dt);
  swingTick(dt);
  return post(dt);}
 const fkList=[...new Set(Object.values(bones))].filter(b=>b&&b.isObject3D);let fkSnap=null;
 function post(dt){const p=root.position;
  if(motion&&motion.pre)motion.pre();// MOTION HOOK: remember the pose that was on screen
  // root motion of once-off clips
  const pre=[];for(const n in rmCurve){const a=actions[n];if(a.isRunning()||a.getEffectiveWeight()>0)pre.push([n,a,a.time]);}
  // three.js only rewrites a bone when the clip value changed, so IK edits from the last frame would leak into this one: put the pure clip pose back first
  if(fkSnap)for(let i=0;i<fkList.length;i++)fkList[i].quaternion.copy(fkSnap[i]);
  mixer.update(dt);
  if(!fkSnap)fkSnap=fkList.map(()=>new THREE.Quaternion());for(let i=0;i<fkList.length;i++)fkSnap[i].copy(fkList[i].quaternion);
  for(const [n,a,t0] of pre){const t1=a.time;if(t1===t0)continue;const w=a.getEffectiveWeight();if(w<=0)continue;const d=rmAt(n,t1).sub(rmAt(n,t0));p.add(rotY(V(d.x,0,d.z),root.rotation.y).multiplyScalar(w));if(RM[n].y)p.y+=d.y*w;}
  if(H.slide){const sl=H.slide;const pa=sl.a!=null?sl.a*.6:0,pb=sl.b!=null?Math.max(pa+.05,Math.min(1,sl.b+(1-sl.b)*.4)):1;/* WALK: he moves while stepping, not while turning on the spot (a little overlap) */const k1=smooth(pa,pb,Math.min(1,sl.k+dt/sl.d)),k0=smooth(pa,pb,sl.k);sl.k=Math.min(1,sl.k+dt/sl.d);p.x+=sl.x*(k1-k0);p.z+=sl.z*(k1-k0);if(sl.yT!=null){const r=sl.k,A=sl.a??.3,B=Math.min(sl.b??.7,.999);root.rotation.y=r<A?lerp(sl.y0,sl.yT,smooth(0,A,r)):r<B?sl.yT:lerp(sl.yT,sl.yF,smooth(B,1,r));}else root.rotation.y+=sl.yaw*(k1-k0);if(sl.k>=1)H.slide=null;}
  if(H.once){const o=H.once;const a=o.a;if(a.time>=o.end-1e-3||!a.isRunning()){H.once=null;o.then&&o.then();}}
  edgeTick(dt);bedTick(dt);overlayTick(dt);bseqTick(dt);gtTick(dt);bedClipTick(dt);
  // height: stand on the real floor, or put the hips on the seat / mattress
  /* KITCHEN: a crouch whose task is gone (cut off mid-squat) eases back up instead of staying on for the next task */
  if(H.kSquat){if(!act||act!==H.kSqA){H.squat=Math.max(0,(H.squat||0)-1.2*dt);if(H.squat<=.001){H.squat=0;H.kSquat=0;kSlow(false);}}}
  if(H.fit){const f=H.fit;const hy=bones.Hips.position.y;let w=1;
   if(f.mode==='sit')w=smooth(0,1,(f.hStand-hy)/Math.max(.05,f.hStand-f.hSeat));else if(f.mode==='rise')w=1-smooth(0,1,(hy-f.hSeat)/Math.max(.05,f.hStand-f.hSeat));
   p.y=lerp(f.base,f.y-hy,w);}
  else if(H.ground&&H.kSquat&&(H.squat||0)>.02){/* KITCHEN crouch only (oven, woodpile, fridge shelf): the ray starts at the feet's level (from root+squat it started inside
   his own capsule and found no floor, so the hips never went down); the root keeps pace with the squat. Walking never comes here. */
   const sq=H.squat;const f=floorAt(p.x,p.y+sq,p.z,.06,.6)??floorAt(p.x,p.y+sq,p.z,.2,.6);if(f!=null&&Math.abs(f-(p.y+sq))<.3){H.floorY=f;const d=f-sq-p.y;p.y+=clamp(d*(1-Math.exp(-dt*12)),-2.6*dt,2.6*dt);}}
  else if(H.ground){// follow the boards: small steps up/down only (a gap between planks or a hole never pulls him down a storey)
   const sq=H.squat||0;/* KITCHEN: H.squat lowers the hips, the feet stay on the boards (legIK) */let f=floorAt(p.x,p.y+sq,p.z,.32);/* WALK: one ray between two planks hit the joist below: the root dipped 2 cm for a few frames. A drop is real only if the boards around agree */
   if(f!=null&&H.floorY!=null&&f<H.floorY-.006){for(const [ox,oz] of [[.07,0],[-.07,0],[0,.07],[0,-.07]]){const g2=floorAt(p.x+ox,p.y+sq,p.z+oz,.32);if(g2!=null&&g2>f&&g2<=H.floorY+.01)f=g2;}}
   /* WALK: on the ground the oak's roots are something to stand on: the body rises only when both soles (and the hips) are over a root;
      a single foot on a root is lifted by terrainFeet() with the knee bending, like stepping over it */
   const G=window.__ground;if(f!=null&&G&&G.standAt&&p.y<2&&!window.__noRootStep){const hs=['Left','Right'].map(s=>{const a=bones[s+'Foot']?bones[s+'Foot'].getWorldPosition(V()):p;return G.standAt(a.x,a.z);});f=Math.max(f,Math.min(G.standAt(p.x,p.z),...hs));}
   if(f!=null&&f-(p.y+sq)<.3&&(p.y+sq)-f<.3){H.floorY=f;const d=f-sq-p.y;p.y+=clamp(d*(1-Math.exp(-dt*12)),-.9*dt,1.3*dt);}}
  // ===== MOTION HOOK: motion matching (game/motion.js) writes legs/hips (and the upper body unless an action clip plays) on top of the clip pose, before IK =====
  if(motion){try{motion.post(dt);}catch(e){console.error('motion',e);motion=null;}}
  runSlot('motion',dt);
  if(act&&act.preLeg&&!window.__sqLate){try{act.preLeg(dt);}catch(e){console.error('preLeg',e);}}/* REPAIRS: squatting work lowers the pelvis before the soles are planted */
  sleepTick(dt);lidTick(dt);coatTick(dt);
  root.updateMatrixWorld(true);
  // soles on the boards when the body is lifted or lowered (chair, bed edge, uneven boards)
  const g=H.ground&&!H.fit?H.floorY:(H.fit&&!H.inBed&&!H.swing?H.fit.base:null);
  if(g!=null&&!H.lad){if(H.fit&&H.fit.dangle){legPlantOff();}/* LEISURE: legs hanging over an edge are never planted on the boards (Pavel's screenshot) */else if(H.fit&&H.fit.mode==='hold')legPlant(g,dt,H.bedB?1-H.bedB.W.leg:H.bedC?H.bedC.plant:1);else{legPlantOff();let dy=g-p.y;if(Math.abs(dy)>(H.squat?.5:.3)){if(H.ground&&!H.fit)H.floorY=p.y;dy=0;}if(H.ground&&!H.fit&&!H.squat&&(p.y>2?!window.__noBoardStep:!window.__noRootStep))legIK(boardDy(g,dt),1);else{TF.Left=TF.Right=null;if(Math.abs(dy)>.004)legIK(dy,1);}if(H.ground&&!H.fit&&!window.__noSole)soleLock(g,dt);toeGuard(g,dt);}if(!H.inBed&&!H.bedB)kneeGuard();}
  bedHand();bedLegClear(dt);
  H.bucketTilt=false;/* OUTDOOR: set again by a task that tips a bucket on purpose this frame (grab.js leaves it unplumbed) */
  if(act&&act.post)act.post(dt);if(act&&act.fr)fridgePost(act);/* KITCHEN: the hand on the fridge handle / shelf */slungPost();
  // GRAB tick (lost in the 00:20 rollback): eases released tools onto their hooks and closes the fists round what they hold;
  // without it every blended release left the tool hanging in the air where the hand let go (the axe over the chopping block)
  try{const G=window.__grab;if(G&&G.tick&&!window.__noGT)G.tick(dt,H);}catch(e){}
  if(!H.inBed&&!H.bedB&&!H.bedC){lookAt(dt);neckClamp();}duck(dt);runSlot('look',dt);runSlot('contacts',dt);}

 // ---------- overlay: an upper-body clip layered over whatever the legs do (stretch while walking off, scratch the head, sip...) ----------
 const UPPER=/^(Spine|Spine1|Spine2|Neck|Head|LeftShoulder|LeftArm|LeftForeArm|LeftHand|RightShoulder|RightArm|RightForeArm|RightHand)$/;
 const ovCache={};
 function ovTracks(name){if(ovCache[name])return ovCache[name];const c=actions[name]&&actions[name].getClip();if(!c)return null;const out=[];
  for(const tr of c.tracks){const m=/^mixamorig:?(\w+)\.quaternion$/.exec(tr.name);if(!m||!UPPER.test(m[1])||!bones[m[1]])continue;out.push({b:bones[m[1]],it:tr.createInterpolant(),spine:/^Spine/.test(m[1])});}
  return ovCache[name]={tracks:out,dur:c.duration};}
 function overlay(name,o={}){const T=ovTracks(name);if(!T){o.then&&o.then();return;}H.ov={T,t:o.at||0,speed:o.speed||1,fade:o.fade??.4,w:0,end:T.dur*(o.until||1),then:o.then,max:o.weight??1};}
 const _ovq=new THREE.Quaternion();
 function overlayTick(dt){const ov=H.ov;if(!ov)return;ov.t+=dt*ov.speed;const left=ov.end-ov.t;
  ov.w=Math.min(ov.max,smooth(0,ov.fade,ov.t)*smooth(0,ov.fade,left));
  if(left<=0){H.ov=null;ov.then&&ov.then();return;}
  const tt=Math.min(ov.t,ov.T.dur);for(const k of ov.T.tracks){const v=k.it.evaluate(tt);_ovq.fromArray(v);k.b.quaternion.slerp(_ovq,ov.w*(k.spine&&H.path.length?.6:1));}}
 // ---------- start anywhere: drop him into the middle of any activity (used for a random start, any time of day) ----------
 function resetBody(){H.squat=0;H.kSquat=0;kSlow(false);try{undress(false,true);}catch(e){}H.lad=null;H.path=[];H.stk=null;try{dropGearNow();}catch(e){}root.visible=true;for(const h of ['Left','Right']){if(H.hold[h]&&H.hold[h].tool)releaseTool(h);else release(h);}
  if(bookObj&&bookHome&&bookObj.parent!==bookHome.parent){bookHome.parent.add(bookObj);bookObj.position.copy(bookHome.pos);bookObj.quaternion.copy(bookHome.quat);}
  if(H.inBed)bedPress(false);
  Object.assign(H,{path:[],then:null,wait:null,swing:null,bedB:null,edgeHold:null,lad:null,slide:null,once:null,trans:false,seated:null,inBed:false,fit:null,ground:true,v:0,av:0,look:null,lookW:0,pending:null,linger:0,turnStep:false});
  act=null;H.task=null;legPlantOff();}
 function spawn(task,o={}){resetBody();H.squat=0;H.sqJob=false;/* a knee bend (GRAB squat, oven) cut short never carries over into the new start: it kept the root 4.5 cm low for a whole task (gate: foot-bend on every walk) */task=task||'read';
  if(task==='read'&&!o.walking){const s=N.chair;root.position.set(s.p.x,s.floor,s.p.z);root.rotation.y=s.face;H.face=s.face;H.seated=s;H.node='chair_app';H.task='read';H.ground=false;
   H.fit={mode:'hold',base:s.floor,y:s.seat+SEAT_CLEAR};play(READ,{fade:0});act=MAKE.read({seated:true});act.name='read';lastAct=['read'];actDur=rnd(25,40);return;}
  if(task==='sleep'&&!o.walking&&N.bedlie){const li=N.bedlie,ed=N.bededge;root.position.set(li.p.x,floorTop(BD),li.p.z);root.rotation.y=0;H.face=0;H.node='bed_app';H.ground=false;H.inBed=true;try{undress(true,true);}catch(e){}
   H.edgeRoot=V(ed.p.x,root.position.y,ed.p.z);H.fit={mode:'hold',base:floorTop(BD),y:li.seat+LIE_CLEAR};play(SLEEPB,{fade:0});H.task='sleep';act=MAKE.sleep({inBed:true});act.name='sleep';
   H.wait={t:.05,then:()=>bedPress(true)};return;}
  const A=ACT[task]||{};let at=typeof A.at==='string'?A.at:null;if(task==='window')at=pick(WINDOWS);
  let from=o.from&&N[o.from]?o.from:at&&N[at]&&!N[at].seat&&!o.walking?at:null;/* o.from: tests start him on a given node */
  if(!from){const keys=Object.keys(N).filter(k=>N[k]&&N[k].p&&N[k].seat==null&&!N[k].tight&&adj[k]&&k!==at);from=pick(keys);}
  if(at&&N[at]&&N[at].seat!=null&&!o.walking)from=at==='chair'?'chair_app':at==='bedlie'?'bed_app':from;
  const P=N[from].p;root.position.set(P.x,P.y,P.z);const f=floorAt(P.x,P.y,P.z,.4);if(f!=null)root.position.y=f;H.floorY=root.position.y;
  root.rotation.y=N[from].face??rnd(-Math.PI,Math.PI);H.face=root.rotation.y;H.node=from;play(IDLE(),{fade:0});startTask(task,o.opts);}
 // default start: reading at the table (a brain can call spawn() for a random start)
 spawn('read');

 return {spawn,openEdge,H,hero:H,bones,actions,play,once,N,E,route,goTo,startTask,update,navCheck,FIT,need,gait,
  setBrain:b=>{brain=b||null;},hasTask:n=>!!MAKE[n],stage,SLOTS,inv:INV,get act(){return act;},setMotion:m=>{motion=m||null;},setClimb:m=>{climb=m||null;if(climb){climb.init({THREE,bones,ik2,turnBone,root,H,actions,play,floorAt,idle:()=>IDLE()||'0'});if(!climb._staged)climb._staged=stage('contacts',dt=>{if(climb&&!window.__noClimb)climb.post(dt);});}},/* CLIMB HOOK: ladders in the contacts slot */root,onTaskEnd:cb=>{endCbs.push(cb);},
  ray:(x,y,z,dx,dy,dz,len)=>{const r=new RAPIER.Ray({x,y,z},{x:dx,y:dy,z:dz});const h=world.castRay(r,len,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});return h?(h.toi??h.timeOfImpact):null;},
  label:()=>H.linger?'':(ACT[H.task]||{}).label||'',node:()=>H.node,walkSpeed:()=>walkSpeed,floorAt,items:{book:bookObj,mug,spoon,plate,pot}};
}
