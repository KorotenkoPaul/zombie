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
import { armsFreeAt } from './stretchroom.js';

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
const SEAT_CLEAR=.125,LIE_CLEAR=.085;/* lying: the body rests ON the mattress (gate: torso/hips 4-6 cm in the air at .115) */

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
 {const seenM=new Set();root.traverse(o=>{if((o.isMesh||o.isSkinnedMesh)&&o.material&&!Array.isArray(o.material)){if(seenM.has(o.material))o.material=o.material.clone();seenM.add(o.material);}});}/* PERF: one material per mesh. Material_0/head were shared by meshes with different morph-target counts (eyelids, coat): three.js switched their program twice a frame (~0.2 ms, ~35 KB garbage) */
 root.traverse(o=>{if(o.isMesh||o.isSkinnedMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;if(o.material){o.material.roughness=Math.max(.55,o.material.roughness??.8);o.material.metalness=0;}}}); /* [HERO LOOK] cloth surfaces for the v6 hero (heroclothes.js) */try{if(ctx.dressHero)window.__clothes=ctx.dressHero({THREE,root});}catch(e){console.warn('clothes',e);}
 /* [PERF] shadow proxy: a hero glb may carry 'heroShadow' (body+head decimated to ~4.6k tris, same skin). It alone casts the body's
    shadow, on layer 6, which only the shadow cameras see (index.html sun, lights.js lamps); Mesh_0 stops casting (32k tris less per
    shadow pass). vest and boots keep their own shadows, so taking them off still shows. */
 {const HSH=root.getObjectByName('heroShadow');if(HSH){HSH.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=false;o.layers.set(6);}});
  const M0=root.getObjectByName('Mesh_0');if(M0)M0.traverse(o=>{if(o.isMesh)o.castShadow=false;});}}
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
  kh_b:{p:V(-1.22,LC,3.77)},kh_side:{p:V(-.55,LC,3.55),tight:true},/* WALK: the kitchen ladder stands between kh_b and the landing: round its side, not through the rungs */land:{p:V(-.4,LC,2.85)},gate:{p:V(0,LC,3.35),face:0},wstep:{p:V(1.15,WS,3.15)},
  wmid:{p:V(2.4,WS,3.45)},bench:{p:V(2.55,WS,2.62),face:Math.PI},wwin:{p:V(3.0,WS,3.95),face:0},
  kh_t:{p:V(-1.22,KT,2.75)},kmid:{p:V(-2.5,KT,3.3)},kl_m:{p:V(-3.4,KT,2.65)},stove:{p:V(-3.25,KT,2.42),face:Math.PI},sink:{p:V(-2.3,KT,2.15),face:Math.PI},kwin:{p:V(-3.0,KT,3.45),face:0},kl_b:{p:V(-3.98,KT,2.62)},
  bl_t:{p:V(-3.98,BD,1.95)},bl_m:{p:V(-3.45,BD,2.6)},bmid:{p:V(-2.3,BD,3.05)},bwin:{p:V(-3.6,BD,3.6),face:0},bdoor:{p:V(-.1,BD,2.78)},bdoor2:{p:V(.4,BD,2.8),tight:true},ledge_a:{p:V(.85,BD,3.55),tight:true}/* COLLIDE: out of the doorway onto the ledge in front of the hanging rope ladder, not along its left rope (bdoor2->ledge brushed the rope at (1.03, 3.2): navReport) *//* WALK (Collide): the doorway out to the ledge spans z 2.35-3.25; the straight bdoor-ledge line crossed the jamb at z 3.05 and the head went 2.6 cm into it */,
  ledge:{p:V(1.25,BD,3.5),face:0},ll_b:{p:V(1.35,BD,3.47)},ll_t:{p:V(1.35,DK,2.7)},deckm:{p:V(1.9,DK,2.5)},deck:{p:V(3.13,DK,2.62),face:0},
 };
 const E=[['kh_b','kh_side'],['kh_side','land'],['land','gate'],['land','wstep'],['wstep','wmid'],['wmid','bench'],['wmid','wwin'],['kh_b','kh_t','ladder'],['kh_t','kmid'],['kmid','stove'],['kmid','sink'],['kmid','kwin'],['kmid','kl_m'],['kl_m','kl_b'],
  ['kl_b','bl_t','ladder'],['bl_t','bl_m'],['bl_m','bmid'],['bmid','bwin'],['bmid','bdoor'],['bdoor','bdoor2'],['bdoor2','ledge_a'],['ledge_a','ledge'],['ledge','ll_b'],['ll_b','ll_t','ladder'],['ll_t','deckm'],['deckm','deck']];
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
  N.bedlie={p:V(headDir>0?x1-.70:x0+.70,mat,bz)/* 25 cm nearer the pillow: at .78 the head lay beside the pillow, at .62 the shoulders were on it, at .95 the head lay off the pillow's edge, sunk 7 cm into the mattress (gate), the toes at the very foot end */,face:0,seat:mat};SLEEPB=makeBedClip(lieYaw)||SLEEPB;
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
 function pushOut(p,r=.2){for(const o of OBST){if(o.seat||Math.abs(o.y-p.y)>.6)continue;if(p.x>o.x0-r&&p.x<o.x1+r&&p.z>o.z0-r&&p.z<o.z1+r){const dl=p.x-(o.x0-r),dr=o.x1+r-p.x,db=p.z-(o.z0-r),df=o.z1+r-p.z;const m=Math.min(dl,dr,db,df);if(m===dl)p.x=o.x0-r;else if(m===dr)p.x=o.x1+r;else if(m===db)p.z=o.z0-r;else p.z=o.z1+r;}}
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
 function grabTool(name,hand){if(!P3||!P3.grab)return false;{const t=P3.tools&&P3.tools[name];if(t&&t.userData.home0){t.userData.home=t.userData.home0;delete t.userData.home0;}}const o=P3.grab(name,bones[hand+'Hand'],{offset:V(0,.075,.025),rot:hand==='Right'?GRIP_R:GRIP_L});if(o){H.hold[hand]={tool:name};return true;}return false;}
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
   if(rel.length()<mn&&typeof dy0!=='number'&&root.position.y>2){/* WALK: per-foot floors (a step): a lift that would fold the leg past the deepest squat is cut short in height, the foot keeps its place (sliding it out along the ground made the swing foot jump 5-17 cm at the step) */const hz=Math.hypot(rel.x,rel.z);if(hz<mn)tg.y=Math.min(tg.y,hp.y-Math.sqrt(mn*mn-hz*hz));}else if(rel.length()<mn){const vy=rel.y,hz=V(rel.x,0,rel.z);let hl=hz.length();if(hl<1e-3){hz.copy(fb);hl=1;}const need=Math.sqrt(Math.max(0,mn*mn-vy*vy));tg.set(hp.x+hz.x/hl*need,tg.y,hp.z+hz.z/hl*need);}
   ik2(U,L,F,tg,pole,w,true);}}
 // WALK: a deep crouch (the oven, the woodpile, the bucket at the pond) bends the ankle no further than a person's: past ~38 deg up from
 // neutral the heel comes off the boards, the foot turning about the ball of the foot (the toes stay where they are) and the leg re-solved
 // to the raised ankle (gate stoke: foot flat on the boards bent 78 deg up, the shin through the woodpile 5.4 cm)
 function heelLift(hw=1){for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)continue;
   const k=L.getWorldPosition(V()),a=F.getWorldPosition(V()),t=T.getWorldPosition(V());const sh=a.clone().sub(k).normalize(),fd=t.clone().sub(a);const fl=fd.length();if(fl<1e-3)continue;fd.multiplyScalar(1/fl);
   const ang=Math.acos(clamp(sh.dot(fd),-1,1));const ex=Math.min(ang-(90+26)*Math.PI/180,40*Math.PI/180)*hw;/* eased in and out with the crouch's depth (no snap as it starts) */if(ex<=.005)continue;
   const ax=fd.clone().cross(V(0,-1,0));if(ax.lengthSq()<1e-6)continue;ax.normalize();const q=new THREE.Quaternion().setFromAxisAngle(ax,ex);
   const a2=t.clone().add(a.clone().sub(t).applyQuaternion(q));const fq=q.clone().multiply(F.getWorldQuaternion(new THREE.Quaternion()));
   F.parent.getWorldQuaternion(_hq);F.quaternion.copy(_hq.invert().multiply(fq));F.updateMatrixWorld(true);
   const pole=k.clone().sub(U.getWorldPosition(V()).add(a).multiplyScalar(.5));ik2(U,L,F,a2,pole.lengthSq()>1e-6?pole.normalize():fwd(root.rotation.y),1,true);}}
 const _hq=new THREE.Quaternion();
 // seated / perched: put each ankle at its standing height above the boards, then lift the toes out of the floor
 // targets and knee direction are low-passed so clip noise and IK flips never reach the feet
 const plantS={};
 // where the pelvis faces (flat): knees point that way, whatever the root yaw or a twisted clip says
 function hipsFwd(){const q=bones.Hips.getWorldQuaternion(new THREE.Quaternion());const f=V(0,0,1).applyQuaternion(q);f.y=0;const r=fwd(root.rotation.y);if(f.lengthSq()<1e-4)return r;f.normalize();if(f.dot(r)<-.2)f.negate();return f;}
 function toesFwd(s){const F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)return hipsFwd();const d=T.getWorldPosition(V()).sub(F.getWorldPosition(V()));d.y=0;if(d.lengthSq()<1e-6)return hipsFwd();d.normalize();const h=hipsFwd();return d.dot(h)<0?h:d.add(h).normalize();}
 function legPlant(g,dt,pw=1){const M=window.__plantMode??2;if(M===0||pw<.01)return;for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V()),k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
   const tgt=V(a.x,g+(POSE.ankle??.1),a.z);if(H.fit&&H.fit.liftOK&&a.y>tgt.y)tgt.y=a.y;/* BED: a foot lifted by the clip (boot off) may leave the floor; it never goes through it */let pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));if(pole.lengthSq()<1e-6)pole=fwd(root.rotation.y);pole.normalize().multiplyScalar(.35).add(toesFwd(s));pole.normalize();/* KNEES: toward the toes (the pelvis forward let a turned-out foot have its knee fall in: radio crouch) */
   if(M===1){ik2(U,L,F,tgt,pole,1,true);continue;}
   let S=plantS[s];if(!S||(pw>=.999&&S.t.distanceTo(tgt)>.3)||!S.on){S=plantS[s]={t:tgt.clone(),p:pole.clone(),on:true};}
   const kk=1-Math.exp(-(dt||1/60)*3);S.t.lerp(tgt,kk);S.p.lerp(pole,kk).normalize();ik2(U,L,F,S.t,S.p,pw,true);}toeGuard(g,dt,pw);kneeOverToes();/* KNEES: the planted crouch kept a knee that the clip had inside the toes (radio) */}
 // a knee may never bend forward (a clip glitch or an IK pole flip): re-solve that leg with the knee pointing where the pelvis faces
 function kneeGuard(){const hf=hipsFwd();for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;
   const hp=U.getWorldPosition(V()),k=L.getWorldPosition(V()),a=F.getWorldPosition(V());const mid=hp.clone().add(a).multiplyScalar(.5);const off=k.clone().sub(mid);
   const leg=a.clone().sub(hp);if(leg.lengthSq()<1e-4)continue;const ld=leg.clone().normalize();const pf=hf.clone().sub(ld.clone().multiplyScalar(hf.dot(ld)));if(pf.lengthSq()<1e-4)continue;pf.normalize();
   const o=off.clone().sub(ld.clone().multiplyScalar(off.dot(ld)));if(o.length()<.02||o.dot(pf)>-.3*o.length())continue;
   ik2(U,L,F,a,pf.clone().add(o.normalize().multiplyScalar(.15)),1,true);}
  kneeOverToes();}
 // KNEES: a bent knee goes out over the toes, never in past them (gate: in the radio crouch the left knee sat 15 cm inside the
 // line from hip to foot, toes turned out 20 deg; a turning step of the motion matching swung it 8 cm in). Inward of the toe
 // line by more than ~10 deg the leg is re-solved with the knee toward the toes, eased in by how far in it was (no snap);
 // the ankle and the foot's own angle stay.
 const KOT={Left:0,Right:0,f:{},b:{Left:0,Right:0},w:{}};
 // rail_lean: the knee straight out over the toes of its own foot, and each foot 3 cm further out (the ankle height and the foot's angle stay)
 function railKnees(w){const sp=.03;for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)continue;
   const hp=U.getWorldPosition(V()),a=F.getWorldPosition(V()),t=T.getWorldPosition(V());const inw=bones[(s==='Left'?'Right':'Left')+'UpLeg'].getWorldPosition(V()).sub(hp);inw.y=0;if(inw.lengthSq()<1e-6)continue;inw.normalize();
   const td=t.clone().sub(a);td.y=0;if(td.lengthSq()<1e-6)continue;td.normalize();const pole=td.clone().addScaledVector(inw,-.25).normalize();
   ik2(U,L,F,a.clone().addScaledVector(inw,-sp),pole,w,true);}}
 function kneeOverToes(){if(window.__noKneeToes)return;const dt=1/60;for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)continue;
   const hp=U.getWorldPosition(V()),k=L.getWorldPosition(V()),a=F.getWorldPosition(V()),t=T.getWorldPosition(V());const leg=a.clone().sub(hp);const ll=leg.length();if(ll<1e-3)continue;const ld=leg.clone().multiplyScalar(1/ll);
   const off=k.clone().sub(hp);off.sub(ld.clone().multiplyScalar(off.dot(ld)));const bend=off.length();
   const td=t.clone().sub(a);td.y=0;if(td.lengthSq()<1e-6){KOT[s]=0;continue;}td.normalize();const pf=td.clone().sub(ld.clone().multiplyScalar(td.dot(ld)));if(pf.lengthSq()<1e-4){KOT[s]=0;continue;}pf.normalize();
   /* which side is 'in': toward the other leg */const o2=bones[(s==='Left'?'Right':'Left')+'UpLeg'].getWorldPosition(V()).sub(hp);const inw=o2.sub(ld.clone().multiplyScalar(o2.dot(ld))).sub(pf.clone().multiplyScalar(o2.dot(pf)));if(inw.lengthSq()<1e-6)continue;inw.normalize();
   /* not for a near-straight leg (the reach clamp would move the ankle: soles came off the boards) nor a kneel (knee at the ankle's height: clear_roof) nor a foot turned well away from the pelvis */
   const l1=hp.distanceTo(k),l2=k.distanceTo(a);const kneel=k.y<a.y+.12;const fh=hipsFwd();
   let want=0;if(bend>.06&&ll<l1+l2-.02&&!kneel&&td.dot(fh)>.5){const ang=Math.atan2(off.dot(inw),off.dot(pf));want=smooth(.15,.4,ang);}/* radians toward the other leg, 9..23 deg */
   /* once a frame from the pose as the clip and the legs left it; a later pass (the planted crouch re-solves the legs) only re-applies it */
   const first=KOT.f[s]!==FRN;if(first){KOT.f[s]=FRN;KOT.b[s]=KOT[s];KOT.w[s]=want;}else KOT.w[s]=Math.max(KOT.w[s],want);KOT[s]=KOT.b[s]+clamp(KOT.w[s]-KOT.b[s],-dt*4,dt*4);if(KOT[s]<.01||(!first&&want<.01))continue;
   /* WALK: the turn is eased by blending the knee's DIRECTION and solving fully: an ik2 at partial weight leaves the ankle off its own
      target (both bones turn part-way), and the foot swung 7 cm in a frame as the weight ramped (gate firewood, right foot jump 10) */
   const pw=pf.clone().addScaledVector(inw,-.15).normalize();const p0=off.clone().multiplyScalar(1/Math.max(bend,1e-6));const pole=bend>1e-4?p0.lerp(pw,KOT[s]).normalize():pw;
   ik2(U,L,F,a,pole,1,true);}}
 // WALK + carry: a load hanging from a fist (the meat sack, a bucket, the lantern) never passes through the legs: when a stepping leg
 // reaches it, it swings aside about the fist the least that clears the legs' own skin, and swings back to hanging straight after
 // (gate store: the sack went 4.6-10.4 cm into the shins, depending on when he arrived). Measured on the final pose, every frame.
 const LOADS=['meatBag','waterBucket','drainBucket'];/* loads that hang from the fist by a neck or a bail (a ladle, a hammer or the watering can is aimed on purpose) */const _lb=new THREE.Box3();
 // the legs' skin as the gate samples it: every 10th vertex of the body whose main bone is a thigh or a shin (the bone line missed the knee and trouser leg by 5-9 cm)
 const GCMP=(a,i,k)=>[a.getX,a.getY,a.getZ,a.getW][k].call(a,i);let LSK=null;function legSkin(){if(!LSK){LSK={m:null,ix:[]};root.traverse(o=>{if(o.isSkinnedMesh&&!LSK.m)LSK.m=o;});const M=LSK.m;if(M){const si=M.geometry.attributes.skinIndex,sw=M.geometry.attributes.skinWeight,n=M.geometry.attributes.position.count;
   for(let i=0;i<n;i+=10){let bi=0,bw=-1;for(let k=0;k<4;k++){const w=GCMP(sw,i,k);if(w>bw){bw=w;bi=GCMP(si,i,k);}}const nm=M.skeleton.bones[bi].name;if(/(Up)?Leg$/.test(nm))LSK.ix.push(i);}}}
  const M=LSK.m;if(!M)return [];if(LSK.f===FRN)return LSK.p;/* once a frame: the swing search measures up to 21 poses of the load against the same legs */const out=[];for(const i of LSK.ix){const v=M.getVertexPosition(i,new THREE.Vector3());out.push(v.applyMatrix4(M.matrixWorld));}LSK.f=FRN;LSK.p=out;return out;}
 // how deep the legs' skin is in a load (m, inside > 0), each mesh of the load in its own frame as the gate sees it: a round one as a cylinder, the rest as its box
 function loadPen(load){const P=legSkin();let need=-1;
     load.traverse(m=>{if(!m.isMesh||!m.visible||!m.geometry)return;const g=m.geometry;if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox;const sz=bb.getSize(V());if(sz.length()<.03)return;
      const I=m.matrixWorld.clone().invert();const sc=new THREE.Vector3().setFromMatrixScale(m.matrixWorld);const k=Math.min(sc.x,sc.y,sc.z)||1;const cx=(bb.min.x+bb.max.x)/2,cz=(bb.min.z+bb.max.z)/2;const round=Math.abs(sz.x-sz.z)<.15*Math.max(sz.x,sz.z);const L=V();
      for(const q of P){L.copy(q).applyMatrix4(I);if(L.y<bb.min.y||L.y>bb.max.y)continue;let sd;
       if(round)sd=Math.min(sz.x,sz.z)/2-Math.hypot(L.x-cx,L.z-cz);else{const ox=Math.max(bb.min.x-L.x,0,L.x-bb.max.x),oz=Math.max(bb.min.z-L.z,0,L.z-bb.max.z);const out=Math.hypot(ox,oz);sd=out>0?-out:Math.min(L.x-bb.min.x,bb.max.x-L.x,L.z-bb.min.z,bb.max.z-L.z);}
       need=Math.max(need,sd*k);}});return need;}
 function loadClear(dt){if(window.__noLoadClear)return;const T=PP()&&PP().tools;if(!T)return;const moving=H.path.length>0||H.v>.1;
  for(const k of LOADS){const o=T[k];if(!o)continue;const U=o.userData;const S=U.lsw;
   /* last frame's swing is taken off first, unless something else has posed the load since */
   if(S&&S.set&&o.position.equals(S.set.p)&&o.quaternion.equals(S.set.q)){o.position.copy(S.base.p);o.quaternion.copy(S.base.q);}
   const hand=o.parent;const inHand=hand===bones.LeftHand||hand===bones.RightHand;
   if(!inHand||o.visible===false){if(S)U.lsw=null;continue;}
   const W=U.lsw||(U.lsw={a:0,b:0});W.base={p:o.position.clone(),q:o.quaternion.clone()};W.set=null;
   let ta=0,tb=0;root.updateMatrixWorld(true);_lb.setFromObject(o);
   if((moving||!window.__loadMoveOnly)&&!H.lad&&!_lb.isEmpty()&&_lb.min.y<hand.getWorldPosition(V()).y-.12){
    /* the pivot: the top of the load, where the fist holds its neck or bail */const pv=_lb.getCenter(V());pv.y=_lb.max.y;
    const fw=V(Math.sin(root.rotation.y),0,Math.cos(root.rotation.y)),lf=V(Math.cos(root.rotation.y),0,-Math.sin(root.rotation.y));
    const M0=o.matrixWorld.clone(),Hi=hand.matrixWorld.clone().invert();
    const pose=(a,b)=>{const R=new THREE.Matrix4().makeRotationAxis(fw,a).multiply(new THREE.Matrix4().makeRotationAxis(lf,b));const Mw=new THREE.Matrix4().makeTranslation(pv.x,pv.y,pv.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-pv.x,-pv.y,-pv.z)).multiply(M0);
     Hi.clone().multiply(Mw).decompose(o.position,o.quaternion,new THREE.Vector3());o.updateMatrixWorld(true);};
    const p0=loadPen(o);
    if(p0>-.01||Math.abs(W.a)+Math.abs(W.b)>.01){/* touching, or still swung out: find the smallest swing that clears the legs (a leg knocks a hanging sack aside; it does not pass through it) */
     let best=null;const C=[[0,0]];for(const m of [.12,.24,.36,.5,.65,.8,.95])for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1],[.7,.7],[-.7,.7],[.7,-.7],[-.7,-.7]])C.push([x*m,y*m]);/* GRAB: diagonals and up to 55 deg: in a crouch the knee comes out under a sack at the hip (10 cm into the shins rising from the fridge shelf) */
     for(const [a,b] of C){pose(a,b);const pe=loadPen(o);const cost=Math.hypot(a-W.a,b-W.b)*.08+Math.hypot(a,b)*.04;if(pe<=-.025){if(!best||!best.ok||cost<best.c)best={a,b,c:cost,ok:true};}else if(!best||(!best.ok&&pe<best.pe))best={a,b,pe,c:cost,ok:false};}
     ta=best.a;tb=best.b;W.p0=p0;}
    const r=dt*(W.p0>.03?40:12);W.p0=0;/* a kicked sack swings fast; one the knee is already deep in is knocked aside within the frame */W.a+=clamp(ta-W.a,-r,r);W.b+=clamp(tb-W.b,-r,r);
    if(Math.abs(W.a)+Math.abs(W.b)>1e-4){pose(W.a,W.b);W.set={p:o.position.clone(),q:o.quaternion.clone()};}else{o.position.copy(W.base.p);o.quaternion.copy(W.base.q);}}
   else if(Math.abs(W.a)+Math.abs(W.b)>1e-4){/* swing back to hanging straight */const r=dt*3;W.a+=clamp(-W.a,-r,r);W.b+=clamp(-W.b,-r,r);const pv=_lb.getCenter(V());pv.y=_lb.max.y;
    const fw=V(Math.sin(root.rotation.y),0,Math.cos(root.rotation.y)),lf=V(Math.cos(root.rotation.y),0,-Math.sin(root.rotation.y));const R=new THREE.Matrix4().makeRotationAxis(fw,W.a).multiply(new THREE.Matrix4().makeRotationAxis(lf,W.b));
    const Mw=new THREE.Matrix4().makeTranslation(pv.x,pv.y,pv.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-pv.x,-pv.y,-pv.z)).multiply(o.matrixWorld);hand.matrixWorld.clone().invert().multiply(Mw).decompose(o.position,o.quaternion,new THREE.Vector3());o.updateMatrixWorld(true);W.set={p:o.position.clone(),q:o.quaternion.clone()};}
   }}
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
   const swing=a.y-(g+(POSE.ankle??.1))>.02;/* a sole is ~25 cm long: one ray into a gap between planks is not a step down */const G=window.__ground,onG=p.y<=2&&G&&G.standAt;/* WALK: on the ground the floor under a sole is the roots' top (it was an instant per-foot lift: a sole crossing a root edge jumped 14 cm) */const fl=onG?(x,z)=>G.standAt(x,z):(x,z)=>{/* the ray under the ankle; a gap between planks reads lower than the boards on BOTH sides (a step edge is higher on one side only, and lifting a heel off the low boards for it floated the planted foot 18 cm) */const r=(ox,oz)=>floorAt(x+ox,g,z+oz,.28,.25);const c=r(0,0);let m=c;for(const [ox,oz] of [[.06,0],[0,.06]]){const a1=r(ox,oz),a2=r(-ox,-oz);if(a1!=null&&a2!=null){const lo=Math.min(a1,a2);if(m==null||(lo>m+.01&&lo-m<.12))m=lo;}}return m;};let fb=fl(a.x,a.z);if(swing&&H.path.length){const f2=fl(a.x+fw.x*.22,a.z+fw.z*.22);if(f2!=null&&(fb==null||f2>fb))fb=f2;}
   /* boards: a lower floor counts only if the boards are there all round the sole (the hatch opening or a rung below it is not a floor: the foot dropped 3 cm and slid 7 at the bedroom ladder top) */
   if(!onG&&fb!=null&&fb<g-.012){for(const [ox,oz] of [[.08,0],[-.08,0],[0,.08],[0,-.08]]){const h=floorAt(a.x+ox,g,a.z+oz,.28,.25);if(h==null||h>fb+.02){fb=g;break;}}}
   const tgt=(fb!=null&&Math.abs(fb-g)<(onG?.3:.28))?fb:g;/* WALK: on the ground a root top more than a step (30 cm) above the floor under him is a wall, not a step, and the floor under a sole only snaps after the body itself jumped (a task start): walking past the oak's big root the right foot leapt 52 cm up onto it in one frame (splitwood) */if(TF[s]==null||(Math.abs(TF[s]-tgt)>.35&&TF.rp&&TF.rp.distanceToSquared(p)>.09))TF[s]=tgt;else TF[s]+=clamp(tgt-TF[s],-1.2*dt,1.4*dt);o[s]=TF[s]-p.y;}(TF.rp||(TF.rp=V())).copy(p);return o;}
 function terrainFeet(g){const G=window.__ground;if(!G||!G.standAt||root.position.y>2)return;
  for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());const d=G.standAt(a.x,a.z)-g;if(Math.abs(d)<.01)continue;
   const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));const pl=pole.length();pole.multiplyScalar(1/Math.max(pl,1e-6)).lerp(fwd(root.rotation.y),1-smooth(.01,.04,pl));
   ik2(U,L,F,a.clone().add(V(0,clamp(d,-.25,.45),0)),pole,1,true);}}
 window.__SOLE=SOLE;function soleLock(g,dt){SOLE.seen=1;/* KITCHEN crouch: the root rising out of a squat is not walking (the soles were let go and the feet jumped 5-12 cm sideways) */const moved=(H.kSquat||(H.kSqG||0)>0?Math.hypot(root.position.x-SOLE.rp.x,root.position.z-SOLE.rp.z):root.position.distanceTo(SOLE.rp))/Math.max(dt,1e-3),turned=Math.abs(wrapA(root.rotation.y-SOLE.ry))/Math.max(dt,1e-3);SOLE.rp.copy(root.position);SOLE.ry=root.rotation.y;
  const still=moved<.05&&turned<.35&&!H.path.length&&!H.slide&&!H.swing;SOLE.still=still?Math.min(1,SOLE.still+dt*4):0;
  for(const s of ['Left','Right']){const S=SOLE[s],U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());
   const up=a.y-(g+(POSE.ankle??.1))>.04;// the clip lifts this foot
   if(!still||up){S.on=false;/* the clip lifting this sole: let go within ~4 frames (held back longer, the lifted foot was bent and twisted against the boards) */S.w=Math.max(0,S.w-dt*(up?16:6));}else if(!S.on){S.on=true;/* WALK: re-locking during a release starts from where the sole is shown now */if(S.w<.01)S.t.set(a.x,a.y,a.z);else S.t.lerp(a,1-S.w);}
   if(S.on)S.w=Math.min(SOLE.still,S.w+dt*5);const w=S.w;if(w<.01)continue;
   /* WALK: a released sole eases from where it was held to the clip's (the target used to switch to the clip foot at once: the foot slid 12 cm in one frame, telescope deck) */{/* leash: the held spot never trails the clip's foot by more than 12 cm (held further, the leg pulled the sole into a bend: clear_roof 64 deg) */const ex=S.t.x-a.x,ez=S.t.z-a.z,ed=Math.hypot(ex,ez);if(ed>.12){/* dragged at most 1.2 m/s: a clip whose foot cuts across (listen_window loop: 30 cm in a frame) moved the held spot 19 cm at once */const m=Math.min(ed-.12,1.2*dt);S.t.x-=ex/ed*m;S.t.z-=ez/ed*m;}}const tgt=V(S.t.x,a.y,S.t.z);if(tgt.distanceTo(a)<.002)continue;
   const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());/* WALK: a near-straight leg has no knee direction: blend to the pelvis' forward (as legIK does), or the knee could flip and the guard after it threw the foot 19 cm (listen at the window) */const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));const pl=pole.length();pole.multiplyScalar(1/Math.max(pl,1e-6)).lerp(hipsFwd(),1-smooth(.01,.04,pl));ik2(U,L,F,tgt,pole,w,true);}}
 /* KITCHEN: the soles once more after the task's own post (act.post): its reach lean and life shift move the hips after the lock,
    and the feet went with them, 5 cm off their planted spot for the whole task (sink), then jumped back onto it the frame the task ended */
 function soleRe(){if(!SOLE.seen||window.__noSoleRe||act&&act.ownSoles)return;/* LEISURE: a task that holds the soles itself (the stretch lock): putting them back on the sole lock's older spot fought it every few frames (gate game style: stretch foot 5-8 cm jitter) */root.updateMatrixWorld(true);for(const s of ['Left','Right']){const S=SOLE[s],U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F||!S.on||S.w<.01)continue;const a=F.getWorldPosition(V());const tgt=V(S.t.x,a.y,S.t.z);if(tgt.distanceTo(a)<.002)continue;
  const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));const pl=pole.length();pole.multiplyScalar(1/Math.max(pl,1e-6)).lerp(hipsFwd(),1-smooth(.01,.04,pl));ik2(U,L,F,tgt,pole,S.w,true);}}
 const toeS={Left:0,Right:0};
 function toeGuard(g,dt,tw=1){const k=1-Math.exp(-(dt||1/60)*10);for(const s of ['Left','Right']){const F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)continue;const t=T.getWorldPosition(V());const need=Math.max(0,g+.035-t.y);
   toeS[s]+=(need-toeS[s])*k;if(toeS[s]*tw<=.002)continue;turnBone(F,t,t.clone().add(V(0,toeS[s]*tw,0)),1);
   /* WALK: the toes are lifted by bending the ankle only up to a person's limit; the rest of the lift raises the whole foot (the leg re-solved
      to a higher ankle). Bending it all at the ankle put the foot 46-49 deg up on the approach to the stove (gate stoke) */
   if(!window.__noToeCap){const U=bones[s+'UpLeg'],L=bones[s+'Leg'];const kp=L.getWorldPosition(V()),a=F.getWorldPosition(V()),t2=T.getWorldPosition(V());const sh=a.clone().sub(kp).normalize(),fd=t2.clone().sub(a);const fl=fd.length();if(fl<1e-3)continue;fd.multiplyScalar(1/fl);
    const ex=Math.acos(clamp(sh.dot(fd),-1,1))-(90+30)*Math.PI/180;if(ex<=.005)continue;const ax=fd.clone().cross(V(0,-1,0));if(ax.lengthSq()<1e-6)continue;ax.normalize();
    const q=new THREE.Quaternion().setFromAxisAngle(ax,ex);const fq=q.multiply(F.getWorldQuaternion(new THREE.Quaternion()));F.parent.getWorldQuaternion(_hq);F.quaternion.copy(_hq.invert().multiply(fq));F.updateMatrixWorld(true);
    const dh=Math.max(0,t2.y-T.getWorldPosition(V()).y);if(dh>.001){const pole=kp.clone().sub(U.getWorldPosition(V()).add(a).multiplyScalar(.5));ik2(U,L,F,a.clone().add(V(0,dh,0)),pole.lengthSq()>1e-6?pole.normalize():fwd(root.rotation.y),1,true);}}}}
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
 // arm IK whose result the anatomical guard (pose.js, last) leaves alone: solved at full weight with the joints fitted inside their
 // range, the target corrected from where the hand really ends up, then blended in by w. A plain armIK beside the hip lying down was
 // pulled back by the guard 12-22 cm INTO the mattress (traced per slot, bed r13). minY: the hand never ends below it.
 const RAI={};let FRN=0;
 function romArmIK(sd,tg,pole,w,minY){const PG=window.__poseGuard;if(!PG||!PG.fit||window.__noFit){armIK(sd,tg,pole,w);return;}
  const A=bones[sd+'Arm'],F=bones[sd+'ForeArm'],Hn=bones[sd+'Hand'];const q0=[A.quaternion.clone(),F.quaternion.clone(),Hn.quaternion.clone()];
  /* the elbow solution sticks (switching poles between frames flips the arm, and motion.js's pop filter then holds the old arm for ~1 s) */
  const R=RAI[sd]||(RAI[sd]={pi:0,f:-9});if(FRN-R.f>30)R.pi=0;R.f=FRN;const PLS=[pole,pole.clone().add(V(0,1.6,0)),pole.clone().negate()];
  let best=null;for(const pi of [R.pi,...[0,1,2].filter(i=>i!==R.pi)]){const pl=PLS[pi];A.quaternion.copy(q0[0]);F.quaternion.copy(q0[1]);Hn.quaternion.copy(q0[2]);
   const t=tg.clone();let e=9;for(let i=0;i<6;i++){ik2(A,F,Hn,t,pl,1,false);PG.fit(A);PG.fit(F);A.updateMatrixWorld(true);const h=wp(Hn);const d=tg.clone().sub(h);e=d.length();if(minY!=null&&h.y<minY)e+=(minY-h.y)*3;if(e<.01)break;t.add(d);}
   if(!best||e<best.e-.03)best={e,pi,q:[A.quaternion.clone(),F.quaternion.clone()]};if(pi===R.pi&&e<.03)break;}R.pi=best.pi;
  A.quaternion.copy(q0[0]).slerp(best.q[0],w);F.quaternion.copy(q0[1]).slerp(best.q[1],w);Hn.quaternion.copy(q0[2]);A.updateMatrixWorld(true);}
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
  /* GRAB: the last steps before a ladder: the hand hangs its tool at the hip on the move (he used to stop 0.45 s at the foot for it) */
  if(H.path.length>1&&H.path[1].t==='ladder'&&climb&&!window.__noClimb&&!window.__noStowHand){const q=N[H.path[0].node].p,p0=root.position;if(Math.hypot(q.x-p0.x,q.z-p0.z)<1.4&&Math.abs(q.y-p0.y)<.4)stowStart();}
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
  const dx=aim.x-p.x,dz=aim.z-p.z;let want=Math.atan2(dx,dz);
  /* WALK: look half a metre ahead and steer round what the push-out would shove him off (a root, a stump, a crate): he turns before it,
     the body leads; pushed only at contact, the path bent 30 deg in a frame with the body still facing ahead (sharp-turn 350 deg/s, crab step) */
  if(!window.__noSteer&&H.v>.2&&toT>.6&&!(N[step.node].tight&&toT<.9)){for(const L of [.6,.35]){const la=V(p.x+Math.sin(want)*L,p.y,p.z+Math.cos(want)*L);const q=la.clone();pushOut(q);const dq=Math.hypot(q.x-la.x,q.z-la.z);if(dq>.005){const w2=Math.atan2(q.x-p.x,q.z-p.z);want+=clamp(wrapA(w2-want),-1.2,1.2)*smooth(.005,.06,dq);}}}
  const da=wrapA(want-root.rotation.y);
  // ===== MOTION HOOK: with motion matching the stop is a human one (constant deceleration over the last step), no creeping =====
  const ladNext=motion&&nxt&&nxt.t==='ladder';// MOTION HOOK: slow down over the last steps to the ladder foot (to ~.4 m/s, the approach pace), not at it
  const vmax=H.walkV*(isLast?(motion?clamp(Math.sqrt(2*1.6*Math.max(0,toT-.03))/H.walkV,0,1):clamp(toT/.42,.35,1)):ladNext?clamp(Math.sqrt(.16+2*1.6*Math.max(0,toT-.32))/H.walkV,0,1):1);let align=smooth(-.55,.75,Math.cos(da));/* WALK: just off a ladder the rungs are right in front of him: turn on the spot first (the first step used to go into the ladder) */if(H.ladOff){if(Math.hypot(p.x-H.ladOff.x,p.z-H.ladOff.z)<.3){if(Math.cos(da)<.75){if(window.__noPivot){align=0;}else{/* once he has turned his back on the rungs he steps out while still turning (he stood 0.7 s turning on the spot: robot at the ladder exit) */const lf=H.ladOff.f;const away=lf==null?0:smooth(.35,-.3,Math.cos(root.rotation.y-lf));align=Math.min(align,away);H.pivot=1;}}}else H.ladOff=null;}// a person steps out while still turning, not after
  H.v+=clamp(vmax*align-H.v,-3.2*dt,(H.v<.5?3.2:2.4)*dt);
  stuckCheck(dt);
  // turn rate depends on speed: on the spot it takes small steps
  const rate=lerp(4.2,3.8,clamp(H.v/H.walkV,0,1))*(gait.turn||1)*(H.pivot?1.35:1);/* off the ladder foot: a quick pivot on the planted foot, not a slow shuffle round */
  // turning has inertia: angular speed ramps up and down, so there is never a snap in heading
  const wav=clamp(da*3,-rate,rate);{const ac=H.pivot?15:11;H.pivot=0;H.av=(H.av||0)+clamp(wav-(H.av||0),-ac*dt,ac*dt);}root.rotation.y+=H.av*dt;H.face=root.rotation.y;
  const dir=fwd(root.rotation.y);p.x+=dir.x*H.v*dt;p.z+=dir.z*H.v*dt;/* WALK: the push off walls and roots eases in and out (it switched on at full rate when the route left a tight node: the path bent 50 deg in one frame at the forest fork, 545 deg/s) */{const on=!(N[step.node].tight&&toT<.9);H.pw=clamp((H.pw??1)+(on?3:-3)*dt,0,1);if(H.pw>0){const q=p.clone();pushOut(q);const m=.6*dt*H.pw;p.x+=clamp(q.x-p.x,-m,m);p.z+=clamp(q.z-p.z,-m,m);}}
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
 function ladApproach(goal,F,dt,foot){const p=root.position;const dx=goal.x-p.x,dz=goal.z-p.z,d=Math.hypot(dx,dz);{const cl=climb&&!window.__noClimb;let k=cl&&foot?clamp((.6-d)/.5,0,1):d>.35?0:1;k=k*k*(3-2*k);const a=Math.atan2(dx,dz);turnTo(cl&&d>.35&&k<=0?a:cl&&foot&&d>.1?a+wrapA(F-a)*k:F,dt);}/* CLIMB HOOK: walk facing the way, turning to the rungs over the last 60 cm (turning on the spot after the walk read as a stop at every ladder foot) */const da=Math.abs(wrapA(F-root.rotation.y));
  if(d>.02){const vt=climb&&!window.__noClimb&&foot?Math.min(Math.max(H.v||0,.6),H.walkV||1)*clamp(d/.16,.35,1):Math.min(Math.max(H.v||0,.35),H.walkV||1)*clamp(d/.25,.4,1);/* CLIMB HOOK: the last steps to the rungs at walking pace, slowing only over the last 16 cm (it crept in at .14 m/s for over a second: from the far camera a stop at every ladder foot) */const v=Math.min(vt,(H.v||0)+2.6*dt);H.v=v;const m=Math.min(d,v*dt);p.x+=dx/d*m;p.z+=dz/d*m;play('30',{fade:.25});actions['30'].timeScale=clamp(v/walkSpeed,.6,1.6);}
  else{H.v=0;if(da>.15){play('30',{fade:.25});actions['30'].timeScale=.7;}}
  if(d<.04&&da<.15){if(!(climb&&!window.__noClimb)){p.x=goal.x;p.z=goal.z;}/* CLIMB HOOK: climb.js eases the last few cm onto the ladder's line (the snap was a 4 cm root jump at every mount) */return true;}return false;}
 function ladderStep(dt){const step=H.path[0];const key=step.from+'>'+step.node,rkey=step.node+'>'+step.from;const c=LAD[key]||LAD[rkey];const target=N[step.node].p;const p=root.position;
  if(!H.lad&&edgeShut(step.from,step.node)){try{window.__house.hatch.open();window.__audio&&window.__audio.play('hatch_open');}catch(e){}}// a closed hatch on the way: he pushes it open as he gets there
  // CLIMB HOOK: both hands free on a ladder: a tool still in a hand goes over the back for the climb and back into the hand after
  /* GRAB: before the climb the hand itself takes each tool over its shoulder onto the back (it used to jump there, 70-80 cm in a frame) */
  if(!H.lad&&climb&&!window.__noClimb&&!window.__noStowHand)stowStart();/* GRAB: normally already begun on the last steps of the walk here (walkStep); he does not stop for it: the climb itself waits at the foot only if the hand is not done yet */
  if(!H.lad&&climb&&!window.__noClimb){H.stowed=[];if(H.stowPre){H.stowed.push(...H.stowPre);H.stowPre=null;}for(const h of ['Left','Right']){const t=H.hold[h]&&H.hold[h].tool;if(t&&!stowing(h)){try{onBack(t,V(h==='Left'?-.06:.06,.1,-.16),[0,0,h==='Left'?.5:-.5]);}catch(e){}H.hold[h]=null;H.stowed.push([h,t]);}}
   /* anything else in a hand (the bow back from the hunt, a bucket...): onto the back too, and back into that hand in the same grip after */
   try{const T=PP().tools||{};for(const n in T){const o=T[n];for(const h of ['Left','Right'])if(o&&o.parent===bones[h+'Hand']){H.stowed.push([h,n,o.position.clone(),o.quaternion.clone(),o.scale.x]);if(/Bucket|meat|log|plate/i.test(n)){onBack(n,V(h==='Left'?-.04:.04,-.06,-.3),[0,0,0]);if(SLUNG_AT[n]){scene.attach(o);slung[n]=1;try{slungPost();}catch(e){}}/* OUTDOOR: hung on its rope by slungPost (hip bandolier) at once: not one frame up at the shoulder blades, through his head (QA 14.5 cm) */}/* bulky: hung clear behind the back (phone watch: hips inside the bucket) */else onBack(n,V(h==='Left'?-.05:.05,.08,-.15),[0,0,h==='Left'?.55:-.55]);}}}catch(e){}}
  if(!H.lad){const a=N[step.from].p;const up=target.y>a.y+.01;H.lad={up,phase:up?'mount':'over',x:target.x,yBot:Math.min(a.y,target.y),yTop:Math.max(a.y,target.y)};}
  const L=H.lad;const cz=c.lz+(.32+(c.rope?.05:0))*c.side;const F=c.side>0?Math.PI:0;H.state='walk';H.ground=false;
  const done=()=>{if(H.stowed&&H.stowed.length){for(const [h,t,pp,pq,ps] of H.stowed){try{if(!onHeroT(t)&&!slung[t])continue;/* GRAB: put away meanwhile (a cut-off task's leave): not his to take back */if(slung[t]&&SLUNG_AT[t])continue;/* OUTDOOR: a slung load comes back into the hand only once the hand is down off the rungs (slingTick); at the top the raised fist put the bucket at his head (QA) */if(window.__noStowHand){if(pp){const o=PP().tools[t];const b=bones[h+'Hand'];if(o&&b){b.add(o);o.position.copy(pp);o.quaternion.copy(pq);o.scale.setScalar(ps);}}else grabTool(t,h);}else{(STW&&STW.mode==='on'?STW:(STW={mode:'on',t:0,items:[]})).items.push({h,n:t,pp,pq,ps});}}catch(e){}}H.stowed=null;}/* CLIMB HOOK: tools back into the hands */H.lad=null;H.path.shift();H.node=step.node;H.ground=true;H.ladOff=L.up?null:root.position.clone();if(H.ladOff)H.ladOff.f=root.rotation.y;/* facing the rungs *//* WALK: only at the foot of a ladder (the rungs are in front of him); at the top he walks on off the ladder (it stopped him dead, 0.19 -> 0.01 m/s) */H.v=L.up?.45:0;H.av=0;H.stk=null;const f=floorAt(root.position.x,root.position.y,root.position.z,.2);H.floorY=(f!=null&&Math.abs(f-target.y)<.25)?f:target.y;H.fit=null;};
  // watchdog (QA P0: froze on the rope ladder for minutes): a ladder never takes longer than a slow climb; past that, land on the target
  L.age=(L.age||0)+dt;if(L.age>14+(L.yTop-L.yBot)/.3){p.copy(target);const f0=floorAt(p.x,p.y+.3,p.z,.4);if(f0!=null)p.y=f0;play(IDLE()||'0',{fade:.3});done();return;}
  if(L.phase==='mount'){H.ground=true;if(ladApproach(V(L.x,p.y,cz),F,dt,L.up)&&!(STW&&STW.mode==='off')){if(H.stowPre){(H.stowed=H.stowed||[]).push(...H.stowPre);H.stowPre=null;}L.phase='climb';}}
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
 const DOOR_E=(a,b)=>(a==='bdoor2'&&b==='ledge_a')||(a==='ledge_a'&&b==='bdoor2')||(a==='bdoor'&&b==='bdoor2')||(a==='bdoor2'&&b==='bdoor')||(a==='bdoor2'&&b==='ledge')||(a==='ledge'&&b==='bdoor2')||(a==='bdoor'&&b==='ledge')||(a==='ledge'&&b==='bdoor');
 function doorShut(){const P=window.__props;const D=P&&P.door;return !!(D&&typeof D.open==='number'&&(D.bolt>.1||D.open<.4));}
 function goTo(node,then){if(node===H.node&&!H.path.length){then&&then();return;}
  // on a ladder: finish this rung run first, the new route starts where the ladder ends (QA: H.lad left set, then a 67 cm teleport)
  if(H.lad&&H.path[0]&&H.path[0].t==='ladder'){const first=H.path[0];H.path=[first,...(first.node===node?[]:route(first.node,node))];H.then=then;return;}
  H.path=route(H.node,node);if(!H.path.length){then&&then();return;}
  /* BRAIN (critic W6): never through the bedroom door leaf while it is bolted or not open (open < .4). The walk stops at the
     door node on this side and H.doorBlocked asks for the door; the brain puts bolt {lock:false, open:true} first, and once
     the leaf is open the same walk goes on (update below). The bolt task itself walks only to the knob, inside. */
  if(H.task!=='bolt'&&doorShut()){let a=H.node;for(let i=0;i<H.path.length;i++){const b=H.path[i].node;if(DOOR_E(a,b)){H.path.length=i;const nd=node,th=then;H.doorBlocked=null;
   const block=()=>{H.doorBlocked={node:nd,then:th,t:0};};if(!H.path.length){block();return;}H.then=block;H.av=0;H.walkV=WALK_V*(brain?lerp(.86,1.04,clamp(((gait.speed||1)-.7)/.42,0,1)):rnd(.92,1.04));return;}a=b;}}
  H.doorBlocked=null;H.then=then;H.av=0;H.walkV=WALK_V*(brain?lerp(.86,1.04,clamp(((gait.speed||1)-.7)/.42,0,1)):rnd(.92,1.04));}
 const sidePole=(side,down=1)=>{const f=fwd(root.rotation.y);const right=V(-f.z,0,f.x);return right.multiplyScalar(side==='Right'?1:-1).add(V(0,-down,0)).add(f.clone().multiplyScalar(-.3));};
 function ikList(list){if(!list)return;for(const [s,t,w] of list)if(t&&w>.001)armIK(s,t,sidePole(s),clamp(w,0,1));}

 // a small pot on the stove while cooking
 const pot=sh((()=>{const g=new THREE.Group();const m=new THREE.MeshStandardMaterial({color:0x3A3A3C,metalness:.5,roughness:.45});const b=new THREE.Mesh(new THREE.CylinderGeometry(.1,.09,.12,20,1,true),m);b.position.y=.06;g.add(b);
  const bt=new THREE.Mesh(new THREE.CircleGeometry(.09,20),m);bt.rotation.x=-Math.PI/2;bt.position.y=.005;g.add(bt);const soup=new THREE.Mesh(new THREE.CircleGeometry(.095,20),new THREE.MeshStandardMaterial({color:0x9A5A2A,roughness:.3}));soup.rotation.x=-Math.PI/2;soup.position.y=.09;g.add(soup);
  const hd=new THREE.Mesh(new THREE.BoxGeometry(.12,.015,.025),m);hd.position.set(.15,.1,0);g.add(hd);return g;})());pot.visible=false;scene.add(pot);
 const potSpot=()=>{const st=N.stove;const f=fwd(st.face),r=V(-f.z,0,f.x);const top=floorTop(KT,st.p.x,st.p.z)+.9;return st.p.clone().addScaledVector(f,.62).addScaledVector(r,.17).setY(top);};

 // the activity currently running: a small state machine with its own update
 let act=null;
 function startTask(name,opts){if(name===H.task&&act&&!act.left&&(!opts||!Object.keys(opts).length)&&name!=='micro'&&name!=='switch')return;H.doorBlocked=null;if(H.trans||H.lad){H.pending=name;H.pendingOpts=opts;return;}
  if(act&&act.leave&&!act.left){const nm=name;act.left=true;H.trans=true;act.leave(()=>{H.trans=false;act=null;startTask(nm,opts);});return;}
  /* GRAB P1: a task that is already putting its tools back (its leave runs) finishes that first; the new task waits for it (it used to drop the act, the ladle stayed in his fist) */
  if(act&&(act.left||act.stow)&&(act.lq=(act.lq||0)+1)<1200){H.pending=name;H.pendingOpts=opts;return;}
  /* GRAB P1: whatever cut the task short, a hand tool still in his hand is put back by hand (walked to its spot, set down, or onto the belt) before the next task */
  if(!(act&&act.stow)){const ht=handTools();if(ht.length){const nm=name;act=stowAct(ht,()=>{act=null;startTask(nm,opts);});return;}}
  // still seated when a task without its own leave ends (or is cut short): stand up properly first, never slide off in a sitting pose
  if(H.seated&&!H.inBed&&!H.bedB&&!H.swing&&H.fit){const sp=H.seated;act=null;H.trans=true;standUp(sp,()=>{H.node=sp.node||nearNode(root.position.clone().add(V(0,.3,0)))||H.node;startTask(name,opts);});return;}
  if(H.sqJob){H.squat=0;H.sqJob=false;}/* GRAB: a job's knee bend never carries over into the next task */
  act=null;H.then=null;/* a walk left over from the task that was cut short must not fire its arrival (QA: the old 'read' sat him down in the middle of a stretch) */H.task=name;actT=0;const A=ACT[name]||{};actDur=A.dur?rnd(A.dur[0],A.dur[1]):8;lastAct.unshift(name);lastAct.length=3;H.look=null;H.lookW=0;
  const mk=MAKE[name];if(!mk)return;act=mk(opts||{});act.name=name;}
 // ===== BRAIN HOOK state: setBrain / gait / onTaskEnd =====
 let brain=null;let motion=null;let climb=null;/* CLIMB HOOK: game/climb.js, see setClimb *//* MOTION HOOK: game/motion.js, see setMotion */const gait={speed:1,turn:1};const endCbs=[];
 function endTask(res){kSlow(false);REACH_LEAN=.6;/* eat left it at .3 for every task after it */H.kSquat=0;const n=H.task;act=null;H.task=null;H.look=null;H.lookW=0;for(const cb of endCbs){try{cb(n,res);}catch(e){console.error(e);}}}
 // lamps with a wall switch (props.js switchPlate): the hand goes to the plate, not to the lamp
 const SWITCH_AT=(ctx.props&&ctx.props.switches)?Object.fromEntries(Object.entries(ctx.props.switches).map(([k,v])=>[k,v.clone()])):{bedroom:V(.372,lv.BD+1.15,2.15)};// wall switch positions come from props.js
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
   // a wall plate: the room side of the wall is found from the collide grid; he stands square to the plate, an arm's length off
   const plateN=()=>{const PN=ctx.props&&ctx.props.switchN&&ctx.props.switchN[o.light];if(PN)return PN.clone();/* the plate's own facing (props.js) */const C=window.__collide;if(!C||!C.depthAt)return null;let best=null,bd=1e9;for(const d of [V(1,0,0),V(-1,0,0),V(0,0,1),V(0,0,-1)]){const o1=sp.clone().addScaledVector(d,.3),o2=sp.clone().addScaledVector(d,-.06);if(C.depthAt(o1.x,o1.y,o1.z)>.005||C.depthAt(o2.x,o2.y,o2.z)<=.005)continue;const dd=Math.hypot(o1.x-root.position.x,o1.z-root.position.z);if(dd<bd){bd=dd;best=d;}}return best;};
   const isOn=()=>{try{const g=L.get&&L.get(o.light);return !!(g&&(g.on!=null?g.on:g));}catch(e){return false;}};const lighting=!plate&&(o.on!=null?!!o.on:!isOn());/* GRAB: an oil lamp is lit with a match (lights.js strikes it in the hand that is at the lamp) or put out at the wick knob */
   const MT=(L&&L.matchTimes)||{catch:.62,out:1.35};
   const toggle=()=>{if(a.done)return;a.done=true;a.tSet=a.t;try{L.set(o.light,o.on!=null?!!o.on:!isOn());}catch(e){}if(plate)sfx&&sfx.click&&sfx.click();};
   const reach=()=>{a.step='reach';a.t=0;H.state='work';if(a.low&&has('hy_take'))once('hy_take',{fade:.4,then:()=>play(IDLE(),{fade:.5})});else play(IDLE(),{fade:.4});};
   const approach=()=>{const p=root.position;H.state='work';const fl=floorAt(p.x,p.y+.3,p.z,.5)??p.y;a.low=sp.y-fl<.75;
    const n=plate?plateN():null;
    if(n){/* PLATE: square to the wall (the hand straight in front of the right shoulder), turned to it while he steps, no squeeze past the door leaf or the frame */
     a.from=a.viaNode?p.clone():null;a.knob=sp.clone().addScaledVector(n,.035)/* the fingers on the rocker, the palm clear of the wall boards */;const st=sp.clone().addScaledVector(n,.36).add(V(-n.z,0,n.x).multiplyScalar(.17))/* the body left of the plate: it is in front of the right shoulder */;st.y=p.y;a.faceYaw=Math.atan2(-n.x,-n.z);let k=0;
     const go=()=>{if(Math.hypot(st.x-root.position.x,st.z-root.position.z)>.12)play('30',{fade:.3,speed:1})/* steps, not a glide in the idle clip */;approachTo(a,st,0,()=>{if(Math.hypot(root.position.x-st.x,root.position.z-st.z)>.06&&++k<4)go();else{a.faceYaw=null;reach();}});H.turnStep=false;/* the step owns the walk clip now: a turn-on-the-spot left over from before dropped it to idle as the turn lined up, and he glided the last 55 cm (gate, switch after the chair) */};go();return;}
    a.step='approach';a.t=0;const dx=sp.x-p.x,dz=sp.z-p.z,d=Math.hypot(dx,dz);const yaw=Math.atan2(dx,dz);H.face=yaw;
    a.knob=a.low||plate?sp.clone().add(V(-.03,0,0)):(()=>{/* GRAB: the lamp's own side toward him: at the wick to light it, at the knob under the font to put it out */const k=sp.clone();const h=V(p.x-sp.x,0,p.z-sp.z);if(h.lengthSq()>1e-6)k.addScaledVector(h.normalize(),.07);k.y-=lighting?.04:.09;return k;})();
    const move=Math.max(0,Math.min(.9,d-(a.low?.45:.27)));const q=p.clone().add(V(dx/d*move,0,dz/d*move));pushOut(q);
    a.adur=Math.max(.35,move/.8);a.next=reach;H.slide={x:q.x-p.x,z:q.z-p.z,yaw:0,k:0,d:a.adur};if(move>.1)play('30',{fade:.3,speed:1.1});};
   {/* PLATE close by on the same floor (the reading chair is 60 cm from it): straight there, no loop out to the door node and back */const p=root.position;const near=plate&&Math.hypot(sp.x-p.x,sp.z-p.z)<1.8&&Math.abs(sp.y-1.15-p.y)<.15&&!H.path.length;if(near||!node)approach();else{a.viaNode=true;goTo(node,approach);}}
   a.update=dt=>{a.t+=dt;if(a.back)H.look=null;else{H.look=sp.clone();H.lookW=a.step==='reach'?1:.55;/* while he turns to it, the eyes lead and the head follows half way (gate owl-head 74 deg on orig) */}
    if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    if(a.step==='reach'){const clip=a.low&&has('hy_take');const tT=clip?durOf('hy_take')*.45:plate?.42:.7,tE=clip?durOf('hy_take'):plate?1.5:a.tSet!=null?a.tSet+(lighting?MT.out+.5:.85):1.6;
     /* the light changes when the fingers touch the switch (palm on it), not on a timer */
     if(clip){if(a.t>tT)toggle();}else if(!plate){if(!a.done&&a.t>.3&&(palmTo('Right',a.knob)<.06||a.t>tT))toggle();}/* GRAB: the oil lamp: the match is struck as the fingers get there, held at the wick until it is shaken out */else if(!a.done&&a.t>.2&&palmTo('Right',a.knob)<.05)toggle();/* a lamp of its own (no plate) keeps the timed click */
     if(a.t>tE){toggle()/* never leaves the light as it was: the brain came back for it again and again (full gate: extra walks) */;
      /* PLATE: square to the wall he would set off sideways along it; he turns back to the room on the spot first (full gate: walks off
         the goal line 95 deg and slow after every switch) */
      if(plate&&!a.turned&&node&&N[node]){a.turned=true;const q=N[node].p,p=root.position;const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz)||1;/* a real step off the wall toward the room: approachTo's turn, step, turn (a turn on the spot shuffled the feet: gate jitter) */const t=p.clone().add(V(dx/d*.45,0,dz/d*.45));a.faceYaw=null;a.back=true;play('30',{fade:.3,speed:1});approachTo(a,t,0,()=>endTask());return;}
      endTask();}}
    if(a.step==='ret'){if(a.t>=a.adur)a.next();}};
   a.post=()=>{if(a.step!=='reach'||(a.low&&!plate))return;const tE2=a.tSet!=null?a.tSet+(lighting?MT.out+.5:.85):1.6;const w=plate?smooth(0,.55,a.t)*(1-smooth(.8,1.45,a.t))/* a slower press and let-go: the arm fell back 33 cm in .27 s (gate jitter 13 mm at 5 Hz) */:smooth(0,.5,a.t)*(1-smooth(tE2-.5,tE2,a.t))/* GRAB: held at the lamp until the match is out */;const sh=bones.RightArm;const from=sh.getWorldPosition(V());
    const v=a.knob.clone().sub(from);v.setLength(Math.max(0,v.length()-PALM))/* the wrist a palm short of the rocker along the arm (a target read back from the hand's own pose fed back on itself: 5 Hz shake) */;const reach=armLen*.97;if(v.length()>reach)v.setLength(reach);ikList([['Right',from.add(v),w]]);if(!plate&&a.tSet!=null&&w>.5){/* GRAB: the strike of the match (or the knob's turn): a short flick of the wrist */const u=(a.t-a.tSet)/(lighting?.22:.35);if(u>0&&u<1){const hb=bones.RightHand;hb.rotateX((lighting?.45:.3)*Math.sin(Math.PI*u)*w);hb.updateMatrixWorld(true);}}void 0/* the arm alone (reachGrip's waist lean shook the hand at 5-8 Hz: gate jitter) */;};
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
   const standZ=g=>clamp(g.z+(want?.1:.2),z0+.12,z1+.5);/* right shoulder in line with the ring (GRAB: closing, a step further back: the crouched knees were in the leaning lid, collide threw the knee 11 cm) */
   const sqFor=t=>{/* from the standing shoulder (measured as he arrives), not the leaning one */const p=root.position;const SH=a.SH||1.12;const hz=Math.max(0,Math.hypot(p.x-t.x,p.z-t.z)-.08);const R0=armLen*.9+PALM;const h=Math.min(hz,R0*.8);const dy=p.y+(H.squat||0)+SH-t.y;return clamp(dy-Math.sqrt(Math.max(0,R0*R0-h*h))+.02,0,.45);};/* .45 is the deepest the leg IK keeps the soles on the boards */
   const sqTo=(v,dt,rate=1.6)=>{const c=H.squat||0;const vt=clamp((v-c)*8,-rate,rate);a.sqv=(a.sqv||0)+clamp(vt-(a.sqv||0),-2.5*dt,2.5*dt);/* GRAB: eased knee speed (a flip from going down to coming up kicked the legs 12 cm/frame², gate after hunt) */H.squat=Math.max(0,c+a.sqv*dt);};
   const L=hc.ladder||{top:'bl_t',bottom:'kl_b'};const start=N.bl_m?'bl_m':L.top;
   goTo(start,()=>{a.step='app';const g=ring();const sp=V(footX(g,standZ(g)),root.position.y,standZ(g));a.faceYaw=Math.atan2(g.x-sp.x,g.z-sp.z);/* GRAB: turned to the ring during the approach (it turned 80 deg on the spot as the arm went out: hand jump 4.9) */approachTo(a,sp,0,()=>{a.step='reach';a.t=0;a.SH=bones.RightArm.getWorldPosition(V()).y-root.position.y-(H.squat||0);});});
   const grip=()=>{const G=window.__grab;return G&&G.gripPoint?G.gripPoint('Right'):bones.RightHand.getWorldPosition(V());};
   a.update=dt=>{if(a.step==='approach'){a.t+=dt;if(a.t>=a.adur)a.next();return;}if(a.step==='go'||a.step==='app')return;a.t+=dt;
    const p=root.position,g=ring();H.look=g;H.lookW=1;
    {const fy=Math.atan2(g.x-p.x,g.z-p.z);root.rotation.y+=wrapA(fy-root.rotation.y)*Math.min(1,dt*4);H.face=root.rotation.y;}
    {/* small shuffles along the edge, the right shoulder stays level with the ring as it swings (GRAB: eased in) */const m=.35*dt*smooth(0,.5,a.t);const tz=standZ(g);const dz=clamp(tz-p.z,-m,m);p.z+=dz;const fx=footX(g,p.z);const dx=clamp(fx-p.x,-m,m);p.x+=dx;}
    if(a.step==='reach'){a.w=Math.min(1,a.w+dt/.6);sqTo(sqFor(g),dt,.8);const gd=a.gd!=null?a.gd:grip().distanceTo(g);
     const tip=want&&hc.angle<.3?.07:0;/* a flush lid edge is lifted by the fingertips, which reach ~5 cm past the grip point */
     if(a.w>.95&&gd<.04+tip){a.held=true;a.step='move';a.t=0;AU(want?'hatch_open':'hatch_close',g);}else if(a.t>4){a.step='after';a.t=0;}return;}
    if(a.step==='move'){const gd=a.gd!=null?a.gd:grip().distanceTo(g);if(gd>.05+(want&&hc.angle<.3?.07:0)){a.lost=(a.lost||0)+dt;if(a.lost>2.5){hc.letGo(hc.angle>1.57);a.held=false;a.why=1;a.step='after';a.t=0;}return;}a.lost=0;
     // the next lid angle the palm can follow this frame (palm within reach of the shoulder after the knees straighten a little)
     const sh=bones.RightArm.getWorldPosition(V());const R=armLen*.92+PALM+.06;/* + the small lean reachTo adds */const rate=want?1.1:.9;let nx=want?Math.min(hc.OPEN,hc.angle+rate*dt):Math.max(0,hc.angle-rate*dt);
     if(!want&&sh.distanceTo(P(nx,tmp))>R+.02){/* opening: the palm-distance gate above is the limit (the lid waits for the hand) */let lo=hc.angle,hi=nx;for(let k=0;k<8;k++){const m=(lo+hi)/2;if(sh.distanceTo(P(m,tmp))<=R+.02)lo=m;else hi=m;}nx=lo;}
     if(Math.abs(nx-hc.angle)>1e-4){hc.drive(nx);a.st=0;}else a.st=(a.st||0)+dt;
     sqTo(sqFor(P(nx,tmp)),dt,.9);
     if(want&&hc.angle>=1.68){/* past upright: it tips over onto its rest under its own weight */hc.letGo(true);a.held=false;a.why=2;a.step='after';a.t=0;}
     else if(!want&&hc.angle<=.01){/* GRAB: lowered by hand all the way down onto the frame (it used to be let go at 1.3 rad and drop shut, the palm a metre off) */hc.letGo(false);a.held=false;a.why=3;a.step='after';a.t=0;}
     else if(!want&&(a.mp0||(a.mp0=root.position.clone()))&&Math.hypot(root.position.x-a.mp0.x,root.position.z-a.mp0.z)>.05){/* GRAB: the lid coming down onto him (he stood in its sweep, collide pushed him back in the squat: gate after hunt, foot bent 94 deg): he lets it go and it drops shut */hc.letGo(false);a.held=false;a.why=4;a.step='after';a.t=0;}
     else if(a.st>.5&&!want&&hc.angle<.6){/* GRAB: low over the frame and out of his reach: the last few degrees it drops shut from his fingers */hc.letGo(false);a.held=false;a.why=5;a.step='after';a.t=0;}
     else if(a.st>1.2){/* the hand cannot carry it further: put it back down the way it was */hc.letGo(!want);a.held=false;a.why=6;a.step='after';a.t=0;}
     return;}
    if(a.step==='after'){a.w=Math.max(0,a.w-dt/.6)/* GRAB: a slower let-go (hand jump 6.8 as the lid fell away) */;sqTo(0,dt,.9);if(a.t>.8&&(H.squat||0)<.01){H.squat=0;play(IDLE(),{fade:.4});endTask({ok:hc.isOpen()===want,open:hc.isOpen()});}}};
   a.post=()=>{const G=window.__grab;const aw=a.w;a.w=aw*aw*(3-2*aw);/* GRAB: eased in and out (a linear weight started the arm with a kick: hand jump 4.2) */try{if(a.w>.01){const g=ring();if(G&&G.palmTarget&&G.gripPoint){/* the grip point turns with the forearm: aim, measure, re-aim (3 passes) */let t=G.palmTarget('Right',g);REACH_LEAN=want?1.1:.6;/* down to the floor boards he bends at the waist too */for(let k=0;k<4;k++){if(k===1)REACH_LEAN=want?.5:0;if(k===2)REACH_LEAN=0;/* lean once; the re-aims move the arm only */reachTo('Right',t,a.w);root.updateMatrixWorld(true);const e=g.clone().sub(G.gripPoint('Right'));if(e.length()<.01)break;t=t.add(e.multiplyScalar(a.w));}a.gd=G.gripPoint('Right').distanceTo(g);REACH_LEAN=.6;}else reachTo('Right',g,a.w);}{/* crouched, the free hand rests on the left knee (not pushed up by the thigh) */const sq=clamp(((H.squat||0)-.1)/.2,0,1)*a.w;if(sq>.01&&bones.LeftLeg){const kn=bones.LeftLeg.getWorldPosition(V());const f=fwd(root.rotation.y);const t=kn.add(V(0,.07,0)).addScaledVector(f,.03);const RL=REACH_LEAN;REACH_LEAN=0;reachTo('Left',G&&G.palmTarget?G.palmTarget('Left',t):t,sq);REACH_LEAN=RL;}}
    if(G){if(a.held||(a.step==='reach'&&a.w>.02))G.hold('Right',hc.lid,ring)/* GRAB: from the start of the reach (from w .5 collide let go of a palm it had held 5 cm off the lid: hand jump 9 cm/frame²) */;else G.free(hc.lid);}}finally{a.w=aw;}};/* the palm on the ring is a grip: collide leaves it there */
   a.leave=cb=>{try{window.__grab&&window.__grab.free(hc.lid);}catch(e){}if(a.held){try{hc.letGo(hc.angle>1.57);}catch(e){}}H.squat=0;cb();};
   return a;},
  // a short gesture in place (stretch, look around, scratch the head, inspect); ends by itself
  micro:(o={})=>{const a={step:'do',t:0};const c=o.clip&&has(o.clip)?o.clip:IDLE();const one=['hy_stretch','stretch_yawn','hy_inspect','hy_take','hy_drink'].includes(c);
   const dur=o.dur||(one?durOf(c):3);if(H.seated){a.update=()=>endTask();return a;}
   const go0=(cl=c)=>{a.on=1;a.t=0;a.step='do';H.state='work';/* a stretch or a scratch is an action, not standing about (gate: 6.5 s 'standing still between phases' over the whole stretch, the state stayed 'idle' when no walk came first) */if(cl!==c)play(cl,{fade:.5});else if(one)once(c,{fade:.5});else play(c,{fade:.5});};
   /* STRETCH (gate: a hand 7.8 cm into the shelf beside him): arms out and up need room; next to furniture he first steps to a free spot */
   const go=()=>{if(STRETCHES.includes(c)&&!armsFree(root.position,root.rotation.y,c)){const y=armsYaw(root.position,root.rotation.y,c);if(y!=null){a.faceYaw=y;a.noPush=true;approachTo(a,root.position.clone(),0,()=>go0(armsFree(root.position,root.rotation.y,c)?c:alt()));return;}/* turning on the spot is enough */
    a.step='seek';a.gen=stretchSpot(c);play(IDLE(),{fade:.4});return;}go0();};
   const alt=()=>{const L=['hy_scratch','336'].filter(has);return L.length?pick(L):IDLE();};/* no room for the arms: another small gesture, never 3 s of standing (visual watch R25-3) */
   const seek=()=>{for(let i=0;i<14;i++){const r=a.gen.next();if(!r.done)continue;const v=r.value;if(v){a.noPush=true;a.faceYaw=v.yaw;approachTo(a,v.q,0,()=>go0(armsFree(root.position,root.rotation.y,c)?c:alt()));}else go0(alt());/* no room anywhere near: no stretch this time */return;}};/* 14 probes a frame: the search ends in a few frames, not 6 s of IDLE at the desk chair */
   if(H.path.length){H.then=go;}else go();/* finish the step to the next spot first: a stretch is done standing, not mid-stride */
   a.update=dt=>{if(a.step==='seek'){seek();return;}if(a.step==='approach'){a.t+=dt;if(a.t>=a.adur)a.next();return;}if(!a.on)return;a.t+=dt;if(o.look){H.look=o.look.clone?o.look.clone():V(o.look.x,o.look.y,o.look.z);H.lookW=.8;}else if(c==='stretch_yawn'){/* the yawn clip swings the head ~60-90 deg to the left of the pelvis at its end (gate owl-head on v6, seen side-on in frames): keep the gaze ahead, a little up while the arms are up */const f=fwd(root.rotation.y);H.look=root.position.clone().addScaledVector(f,3).add(V(0,1.55+.5*Math.max(0,Math.sin(Math.min(1,a.t/dur)*Math.PI)),0));H.lookW=.75;}const fo=a.post?.6:0;if(a.t>=dur-fo&&!a.fin){a.fin=1;play(IDLE(),{fade:.6});}if(a.t>=dur)endTask();/* a stretch blends back to idle in its last 0.6 s while its lowered hips ease back up together (gate: boots 8 cm up in the fade); same length as before */};
   /* LEISURE (gate: both boots 5-8 cm over the boards for the whole stretch): the yawn clip pushes the pelvis
      forward at standing height, so the straight legs swing 19 cm back and the soles rise; the hips come down instead, easing in and out with the clip */
   if(STRETCHES.includes(c))a.post=dt=>{if(!a.on||H.floorY==null||window.__noStretchPlant)return;const Hp=bones.Hips;if(a.hY!=null&&Math.abs(Hp.position.y-a.hY)<1e-7)Hp.position.copy(a.hP0);/* last frame's drop is still on the pelvis (no clip track rewrote it): take it off before measuring, so it never adds up */root.updateMatrixWorld(true);const g=H.floorY,toe=()=>Math.min(bones.LeftToeBase.getWorldPosition(V()).y,bones.RightToeBase.getWorldPosition(V()).y)-g;if(a.toe0==null)a.toe0=clamp(toe(),.02,.08);/* the boots' own rest height, measured before the clip has blended in */const w=smooth(0,.45,a.t)*(1-smooth(dur-.6,dur,a.t));a.sDrop=(a.sDrop||0)+Math.max(0,clamp(toe()-a.toe0-.03,0,.12)-(a.sDrop||0))*(1-Math.exp(-dt*4));/* it only ever goes down (following the clip's feet up and down shook the hands, gate), and stops 3 cm short of the rest height: boots pressed onto the boards fight the floor guards and shake */const drop=a.sDrop*w;/* eased: the clip's fast first swing must not shake the pelvis */a.hP0=(a.hP0||V()).copy(Hp.position);if(drop>.002){const hw=Hp.getWorldPosition(V());hw.y-=drop;Hp.position.copy(Hp.parent.worldToLocal(hw));Hp.updateMatrixWorld(true);}a.hY=Hp.position.y;/* the clip's forward pelvis swings the straight legs back and up: the hips come down until the lower boot is within 3 cm of its rest height */if(w>.01&&window.__stretchLP)legPlant(g,dt,w);/* planting the feet too only added foot jitter (gate) */
    if(!window.__noStretchLock){const lock=()=>{root.updateMatrixWorld(true);/* LEISURE: a game-walk step still landing (the turn into the stretch): the soles are taken where it puts them, and the lock comes in as the walk lets go (it caught the right foot mid-step: leg jitter 8 cm/frame²) */const gwS=window.__gamewalk&&window.__gamewalk.S,gwW=window.__noStretchGW||!gwS?0:Math.min(1,gwS.w||0);if(gwW>.01)a.fl=null;if(!a.fl){a.fl={};for(const s of ['Left','Right'])a.fl[s]=bones[s+'Foot'].getWorldPosition(V());}const lw=smooth(0,.12,a.t)*(1-smooth(dur-.6,dur,a.t))*(1-gwW);if(lw>.01&&!window.__noFeetIK)H.feetIK=1;a.ownSoles=lw>.01;if(lw>.01)for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];const an=F.getWorldPosition(V()),hp=U.getWorldPosition(V()),kn=L.getWorldPosition(V());const T=a.fl[s].clone();{const Ln=(hp.distanceTo(kn)+kn.distanceTo(an))*.995,d=T.clone().sub(hp);if(d.length()>Ln)T.copy(hp).add(d.setLength(Ln));}/* up on the toes the leg is straight: never past its length (the IK snapped the knee, 11 cm) */const pole=kn.clone().sub(hp.clone().add(an).multiplyScalar(.5));const pl=pole.length();pole.multiplyScalar(1/Math.max(pl,1e-6)).lerp(fwd(root.rotation.y),1-smooth(.01,.04,pl)).normalize();/* a straight leg has no knee direction: the body's forward then (the knee snapped 15 cm when the up-on-the-toes leg straightened) */ik2(U,L,F,T,pole,lw,true);}};lock();}/* the soles stay where they stood: the yawn clip's quick shuffle of the left foot (12 cm in 2 frames) read as a 21 cm jitter */};
   return a;},
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
  cook:(co={})=>{const a={step:'go',t:0};
   // KITCHEN: a look at the fire first, by hand (the hy_oven clip stooped bow-legged with the hand hovering while the door dropped by
   // itself): squat at the oven, the right palm on the handle lowers the door, a look at the embers, the hand lifts it shut, stand up
   const OVP=()=>{const P=window.__props||P3;return P&&P.oven&&P.oven.handle?P.oven:null;};const ovp=PT('oven');
   const sqTo=(v,dt,rate=1.0)=>{const c=H.squat||0;H.squat=c+clamp(v-c,-rate*dt,rate*dt);H.kSquat=H.squat>.001;H.kSqA=act;};
   const sqFor=t=>{const sh=bones.RightArm.getWorldPosition(V());const hz=Math.hypot(sh.x-t.x,sh.z-t.z);const R0=armLen*.9+PALM-.03;const dy=sh.y+(H.squat||0)-t.y;return clamp(dy-Math.sqrt(Math.max(0,R0*R0-hz*hz))+.03,0,.45);};
   const afterOven=()=>{/* GRAB: no spoon out of thin air and no clip stirring the air beside the stove: he steps up to the
     pot, takes the ladle out of it with his hand, then stirs in it (stirPost) */const PO=PP();const pp=PO&&PO.tools&&PO.tools.pot;
     if(pp&&PO.tools.ladle){pot.visible=false;a.pot2=1;a.step='topot';a.t=0;play(IDLE(),{fade:.5});approachTo(a,pp.getWorldPosition(V()),.45,()=>{a.step='getladle';a.t=0;});}
     else{a.step='stir';a.t=0;grab(spoon,'Right',[0,.06,.02],[0,0,-Math.PI/2]);play('hy_stir',{fade:.7});}};
   const toOven=()=>{if(OVP()&&ovp){a.ovh=1;ovenSpot(a,()=>{a.step='ovsq';a.t=0;});}
    else{a.step='oven';a.t=0;once('hy_oven',{fade:.5,then:afterOven});}};
   goTo('stove',()=>{pot.visible=true;pot.position.copy(potSpot());pot.rotation.y=rnd(0,6);
    /* GRAB: the meat from the fridge goes into the pan from his own hand (it used to appear there while he was still at the fridge): a short
       step in to the pan from the stove spot, the fist over it, let go, and the same step back onto the spot, so the oven approach and the
       rest of the cooking start from exactly where they always did */
    const PO=PP();if(co.meat&&PO&&PO.pan&&PO.tools&&PO.tools.meatBag&&PO.tools.meatBag.parent===bones.RightHand){a.p0=root.position.clone();a.y0=root.rotation.y;a.mApp=1;
     a.meatDone=()=>{a.faceYaw=a.y0;a.noPush=1;approachTo(a,a.p0,0,()=>{a.faceYaw=null;a.noPush=0;a.mApp=0;toOven();});};
     approachTo(a,PO.pan.obj.getWorldPosition(V()),.42,()=>{a.step='meatin';a.t=0;});}else toOven();});
   const oven=()=>P3&&P3.oven?P3.oven:(ctx.ovenDoor&&ctx.ovenDoor());
   a.update=dt=>{if(a.step==='approach'){if(a.pot2||a.ovh||a.mApp){stepTick(a,dt);return;}}a.t+=dt;
    if(a.step==='meatin'){const PO=PP();const pan=PO.pan.obj.getWorldPosition(V()).add(V(0,.19,0));H.look=pan;H.lookW=1;/* the fist over the pan, the meat let down into it (lower, the fist went into the pan) */
     const G=window.__grab;const gp=G&&G.gripPoint?G.gripPoint('Right'):bones.RightHand.getWorldPosition(V());
     if(!a.mIn){a.mreach=['Right',reachArc(a,'Right',pan,dt),smooth(0,.3,a.t)];/* up first, then over: straight from his hip the fist went through the stove front */if((a.t>.6&&gp.distanceTo(pan)<.06)||a.t>1.4){a.mIn=1;a.mt=a.t;try{PO.pan.setMeat(true);PO.release('meatBag');}catch(e){}AU('cloth');}}
     else{a.mreach=['Right',pan.clone().add(V(0,.05*smooth(0,.3,a.t-a.mt),0)),1-smooth(.15,.6,a.t-a.mt)];/* the empty hand comes up off the pan and back */if(a.t-a.mt>.65){a.mreach=null;const f=a.meatDone;a.meatDone=null;f&&f();}}
     return;}
    kSlow(/^(ovsq|open|peek|shut)$/.test(a.step)&&(H.squat||0)>.05);if(/^(ovsq|open|peek|shut|up)$/.test(a.step)){const o=OVP();const h=o.handle(V());const m=ovp.clone().add(V(h.x-ovp.x,0,h.z-ovp.z).multiplyScalar(-.15)).setY(ovp.y+.02);const G=window.__grab;a.oik=null;
     if(a.step==='ovsq'){H.look=h;H.lookW=1;if(!a.ovSt){a.ovSt=1;/* GRAB (frame check: his fist stayed 26 cm short of the handle and the door opened anyway): first a short step in to arm's reach
      (the stove's obstacle box kept him ~0.75 m off; the boards in front of the door are free: checked with collide.js) */const sh=bones.RightArm.getWorldPosition(V());const d=V(h.x-sh.x,0,h.z-sh.z);const L=d.length();
      if(L>.62){d.normalize();const CL=window.__collide;let mv=Math.min(.3,L-.62);/* not closer: the lowered door comes out to his shins */const p=root.position;while(mv>.03){const x=p.x+d.x*mv,z=p.z+d.z*mv;if(!CL||!CL.clearance||CL.clearance(x,p.y,z,.17)<.005)break;mv-=.03;}
       if(mv>.03){H.slide={x:d.x*mv,z:d.z*mv,yaw:0,k:0,d:Math.max(.35,mv/.5)};a.stepIn=V(d.x*mv,0,d.z*mv);play('30',{fade:.25,speed:.9});}}}if(H.slide&&H.slide.k<1){a.t=0;return;}if(H.cur===actions['30'])play(IDLE(),{fade:.35});/* the step in done: no walk clip left running under the squat */if(a.sqd===undefined)a.sqd=Math.max(sqFor(h),sqFor(m)*.8);sqTo(a.sqd,dt);a.oik=['Right',h,smooth(.2,.8,a.t)];if(a.t>.85&&palmTo('Right',h)<.04||a.t>1.6){a.step='open';a.t=0;AU('ovenDoor',h);}}
     else if(a.step==='open'){const o0=o.open;const OPK=.62;/* GRAB: lowered to ~70% only: further down the handle leaves his reach and the door could not be shut by hand */o.setOpen(Math.min(OPK,o.open+dt/.9));a.ost=o.open>o0?0:(a.ost||0)+dt;if(a.ost>.4&&o.open>.15){a.step='peek';a.t=0;}/* GRAB: lowered as far as his hand goes: he looks in from there, the hand stays on (it used to give up and leave the door open) */else if(a.ost>2){if(G)G.free(o.door);a.step='up';a.t=0;}H.look=m;H.lookW=.9;a.oik=['Right',o.handle(V()),1];if(G)G.hold('Right',o.door,()=>o.handle(V()));if(o.open>=OPK-1e-3){a.step='peek';a.t=0;}}
     else if(a.step==='peek'){/* GRAB: the hand stays on the handle of the lowered door while he looks at the fire (let go, the low open door's handle was out of his reach again: 10-17 cm) */H.look=m;H.lookW=1;a.oik=['Right',o.handle(V()),1];if(G)G.hold('Right',o.door,()=>o.handle(V()));if(a.t>1.7){a.step='shut';a.t=0;a.sh=1;}}
     else if(a.step==='shut'){H.look=h;H.lookW=1;if(!a.sh){a.oik=['Right',h,smooth(0,.4,a.t)];if(a.t>.45){a.sh=1;a.t=0;}}else{const o1=o.open;o.setOpen(Math.max(0,o.open-dt/.7));a.ost2=o.open<o1?0:(a.ost2||0)+dt;if(a.ost2>2){/* no hand on it: he leaves it (never shuts by itself) */if(G)G.free(o.door);a.step='up';a.t=0;}a.oik=['Right',o.handle(V()),1];if(G)G.hold('Right',o.door,()=>o.handle(V()));if(o.open<=0){if(G)G.free(o.door);a.step='up';a.t=0;AU('ovenDoor',h);}}}
     else if(a.step==='up'){a.oik=['Right',h,1-smooth(0,.7,a.t)];sqTo(0,dt,.9);if(a.t>.75&&(H.squat||0)<.01){H.squat=0;H.kSquat=0;kSlow(false);a.oik=null;if(a.lvCb){const c=a.lvCb;a.step='left';c();return;}afterOven();}}
     return;}if(a.step==='topot'||a.step==='getladle'||a.step==='stir2'||a.step==='putladle'){
     const PO=PP();const pp=PO&&PO.tools&&PO.tools.pot;if(pp){H.look=pp.getWorldPosition(V()).add(V(0,.08,0));H.lookW=.9;}
     if(a.step==='getladle'){const g=gripHome('ladle');a.reach=['Right',g,smooth(0,.5,a.t)];const G=window.__grab;const dd=G&&G.gripPoint?G.gripPoint('Right').distanceTo(g):0;if(!H.hold.Right||H.hold.Right.tool!=='ladle'){if(dd<.03||a.t>1.3){/* the palm where it took the ladle: the hand eases from there into the stir (it fell to the clip pose for a frame: 27 cm, head 15 cm) */a.lpa=G&&G.palmTarget?G.palmTarget('Right',G.gripPoint('Right')).clone():null;grabTool('ladle','Right');a.step='stir2';a.t=0;a.reach=null;}}}
     return;}
    H.face=N.stove.face;const ov=oven();
    if(a.step==='oven'){const k=a.t/durOf('hy_oven');const open=smooth(.24,.36,k)-smooth(.6,.72,k);ov&&ov.setOpen&&ov.setOpen(open);
     H.look=root.position.clone().addScaledVector(fwd(H.face),.6).add(V(0,.35,0));H.lookW=.7;
     a.ik=ov&&ov.handle?[['Right',ov.handle(),smooth(.16,.25,k)-smooth(.7,.8,k)]]:null;}
    else if(a.step==='stir'){const pp=pot.position.clone().add(V(0,.1,0));H.look=pp;H.lookW=1;
     a.ik=[['Right',pp.clone().add(V(Math.cos(a.t*3)*.045,.12,Math.sin(a.t*3)*.045)),.75]];}};
   // while crouched at the oven the free hand rests on its knee (never hanging behind him or to the floor)
   const knee=sd=>bones[sd+'Leg'].getWorldPosition(V()).addScaledVector(fwd(root.rotation.y),.02).add(V(0,.07,0));
   a.post=dt=>{ikList(a.ik);{/* the short steps to the pan and back with the sack: carried up at his hip, not swinging at his shins */const PO=PP();const mb=PO&&PO.tools&&PO.tools.meatBag;const on=co.meat&&mb&&mb.parent===bones.RightHand&&a.step!=='meatin';a.hcw=Math.min(1,Math.max(0,(a.hcw||0)+(on&&(a.step==='approach'||a.step==='go')?1:-1)/60/.35));if(a.hcw>.01&&on){const hp=bones.Hips.getWorldPosition(V());const fw=fwd(root.rotation.y);const cp=hp.addScaledVector(V(-fw.z,0,fw.x),.28).addScaledVector(fw,.16).add(V(0,.16,0));reachGrip('Right',cp,smooth(0,1,a.hcw));}}
    if(a.mreach&&a.mreach[2]>.01)reachGrip(a.mreach[0],a.mreach[1],Math.min(1,a.mreach[2]));const crouch=/^(ovsq|open|peek|shut|up)$/.test(a.step)?clamp((H.squat||0)/.18,0,1):0;
    if(crouch>.01){gripNoLean('Left',knee('Left'),crouch);if(a.oik&&a.oik[2]<1)gripNoLean('Right',knee('Right'),crouch*(1-(a.oik?a.oik[2]:0)));}
    if(a.oik&&a.oik[2]>.01)reachGrip(a.oik[0],a.oik[1],Math.min(1,a.oik[2]));if(a.step==='stir2'){if(a.lpa&&a.t<.7)reachTo('Right',a.lpa,1-smooth(.1,.7,a.t));stirPost(a,dt);}if(a.reach&&a.reach[2]>.01)reachGrip(a.reach[0],a.reach[1],a.reach[2]);};
   a.leave=cb=>{{const ov=oven();/* GRAB: called away with the oven door down: his hand shuts it first (it used to snap shut by itself) */if(ov&&ov.open>.01&&/^(open|peek|shut)$/.test(a.step)&&!a.lvCb){a.lvCb=()=>a.leave(cb);if(a.step!=='shut'){a.step='shut';a.sh=1;a.t=0;}return;}}a.ik=null;a.oik=null;a.mreach=null;if(co.meat){try{const PO=PP();if(PO.tools.meatBag&&PO.tools.meatBag.parent===bones.RightHand)PO.release('meatBag');}catch(e){}}H.squat=0;H.kSquat=0;kSlow(false);const ov=oven();try{window.__grab&&ov&&ov.door&&window.__grab.free(ov.door);}catch(e){}ov&&ov.setOpen&&ov.setOpen(0);pot.visible=false;
    if(H.hold.Right&&H.hold.Right.tool==='ladle'){/* the ladle goes back into the pot from his hand */try{window.__grab.free('Left');window.__grab.free('Right');}catch(e){}a.step='putladle';a.t=0;
     a.update=dt=>{a.t+=dt;const g=gripHome('ladle');a.reach=['Right',g,smooth(0,.45,a.t)*(1-smooth(.75,1.1,a.t))];const G=window.__grab;const dd=G&&G.gripPoint?G.gripPoint('Right').distanceTo(g):0;
      if(H.hold.Right&&(dd<.03||a.t>.7))relTool('Right','ladle',.14);if(a.t>1.1){a.reach=null;cb();}};return;}
    if(H.hold.Right){release('Right');spoon.visible=false;}cb();};return a;},
  tea:()=>{// KITCHEN: a real cup of tea. The mug from the sink rest in the drinking hand, over to the stove, the kettle by its handle in the
   // other hand, poured: the spout over the mug, tipped, then the kettle back on its ring; sip by the window; the mug back to the sink.
   const a={step:'go',t:0};const hand=POSE.drinkHand||'Right',oth=hand==='Right'?'Left':'Right';const P=window.__props||P3;
   const ket=()=>P&&P.tools&&P.tools.kettle;const kHandle=()=>{const k=ket();k.updateMatrixWorld(true);return k.localToWorld(V(0,.21,0));};
   const kSpout=()=>ket().localToWorld(V(.17,.155,0));const rgt=()=>{const f=fwd(root.rotation.y);return V(-f.z,0,f.x);};
   const cupAt=()=>{const hp=bones.Spine1.getWorldPosition(V());const nearSt=/^(kreach|pour|kback)$/.test(a.step);const nf=a.nf==null?(nearSt?1:0):a.nf;hp.addScaledVector(fwd(root.rotation.y),.32-.08*nf+(a.cfw||0)).addScaledVector(rgt(),(hand==='Right'?1:-1)*(.04+.06*nf)).add(V(0,-.12-(a.cd||0)+(a.cup==null?(a.step==='kreach'?.1:nearSt?.04:0):a.cup),0));/* eased (a.nf, a.cup): switched at the step change, the mug target jumped 6-8 cm and the reach jerked his chest and head (gate: head 14 cm at pour) */if(nearSt){if(a.kHy==null){const kh=toolHome('kettle');a.kHy=kh&&Math.abs(kh.y-root.position.y)<1.6?kh.y:-1e9;}if(a.kSt===undefined){const kh=toolHome('kettle');a.kSt=kh?OBST.find(o=>o.x1!=null&&!o.seat&&kh.x>o.x0&&kh.x<o.x1&&kh.z>o.z0&&kh.z<o.z1&&Math.abs(o.y-root.position.y)<.6)||null:null;}const o=a.kSt,r=.07,over=o&&hp.x>o.x0-r&&hp.x<o.x1+r&&hp.z>o.z0-r&&hp.z<o.z1+r;const fl=a.kHy+(over?.07:.04);if(over&&hp.y<fl)hp.y=fl;}/* pouring, the mug comes back off the stove edge and down to his waist: held over the stove top it lifted the kettle fist to his shoulder (watch R28-2) *//* never below the stove top, and over its edge the fist with the mug clears it: on the shorter hero, right up at the stove, the mug sank under the top, collide shoved the fist 13 cm down and back out of the stove and the kettle chased it down through his hips *//* never below the stove top: on the shorter hero the lowered mug sank under it and the kettle followed it down through his hips */return hp;/* right up at the stove the mug keeps off its top edge: nearer the belly, out to the side */};// mug held in front of the belly (lower while he pours: the spout comes over it with the fist at his chest)
   /* KITCHEN: step up facing the mug (reaching sideways for it from the sink spot bent him over to one side) */
   goTo('sink',()=>approachTo(a,rest.mug.clone(),.42,()=>{a.step='take';a.t=0;play(IDLE(),{fade:.4});}));
   a.ik=null;
   a.update=dt=>{a.t+=dt;{const hb=bones[oth+'Hand'];a.hFin=hb?hb.getWorldPosition(V()):null;}/* last frame's final kettle fist (the pour's rate limit) */a.cd=(a.cd||0)+(((a.step==='pour')?.2:0)-(a.cd||0))*Math.min(1,dt*3);{const k=Math.min(1,dt*4),ns=/^(kreach|pour|kback)$/.test(a.step);a.nf=(a.nf==null?(ns?1:0):a.nf)+((ns?1:0)-(a.nf==null?0:a.nf))*k;const cu=a.step==='kreach'?.1:ns?.04:0;a.cup=(a.cup==null?cu:a.cup)+(cu-(a.cup==null?cu:a.cup))*k;}a.cfw=(a.cfw||0)+(((a.step==='pour')?.03:0)-(a.cfw||0))*Math.min(1,dt*3);/* while he pours the mug goes out over the stove's front edge (above its top): right in front of his belly the kettle's handle came back into his chest */
    if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    if(a.step==='take'){H.look=rest.mug.clone();H.lookW=1;/* the mug comes up from the counter into his hand in front of the belly (it never drops to dangle by his side) */a.ik=[[hand,rest.mug.clone().add(V(0,.05,0)).lerp(cupAt(),smooth(.9,1.4,a.t)),smooth(.1,.8,a.t)]];
     if(a.t>.85&&!H.hold[hand]){grab(mug,hand,hand==='Right'?[-.05,.136,.035]:[.05,.136,.035],[0,0,hand==='Right'?-Math.PI/2:Math.PI/2])/* KITCHEN: by its handle (the handle in the palm, not the mug's bottom on an open hand) */;}
     if(a.t>1.4){a.ik=null;if(!ket()){a.step='drink';a.t=0;a.turn=rnd(-1.1,-.5);return;}a.step='tostove';const kp=ket().getWorldPosition(V());const nn=nearNode(kp)||'stove';goTo(nn,()=>{a.pushR=.3;/* right up to the stove front: the kettle is on the back ring */approachTo(a,kp,.3,()=>{a.step='kreach';a.t=0;});a.pushR=undefined;});}return;}
    if(a.step==='tostove'||a.step==='go')return;
    if(a.step==='kreach'){const h=kHandle().add(V(0,.025,0));/* the fist round the top of the arch, its fingers not down in the lid (collide: 4-6 cm into the kettle) */H.look=h;H.lookW=1;a.ik=[[oth,h,smooth(0,.6,a.t)],[hand,cupAt(),smooth(0,.6,a.t)]];
     if((a.t>.3&&palmTo(oth,h)<.04)||a.t>1.3){try{a.k0=(window.__grab&&window.__grab.gripPoint?window.__grab.gripPoint(oth):bones[oth+'Hand'].getWorldPosition(V())).clone().add(V(0,.04,0));a.w0=bones[oth+'Hand'].getWorldPosition(V());a.d0=a.k0.clone().sub(a.w0);bones[oth+'Hand'].attach(ket());/* as it stands, upright, the palm on its handle: no re-seat (a spec seat swung it, then the wrist snapped it level) */a.kh=1;AU('cloth');
      /* holding it, the grip point is the kettle's own (its GRIP spec), not the empty fist's: measure it again, or the fist was pulled 8-14 cm down onto the old point (a 27 cm pop after the pops filter) */{const G=window.__grab;if(G&&G.palmTarget){try{G.hold&&G.hold(oth,ket(),null);}catch(e){}/* registered first: until post2 told grab.js, gripPoint was still the empty fist's and the first pour frame threw the kettle 38 cm down (gate orig, LeftHand jump) */const g0=G.gripPoint(oth).clone();a.pa0=G.palmTarget(oth,g0).clone();a.k0=g0.add(V(0,.04,0));a.ik=[['palm',a.pa0.clone(),1],[hand,cupAt(),1]];a.lk0=h.clone();}H.noPop={side:oth,until:performance.now()+250};/* motion.js: the palm stays put while the arm's IK solution changes (the pop filter turned that into an 11 cm jerk) */}}catch(e){}a.step='pour';a.t=0;}return;}
    if(a.step==='pour'){// lift, bring the spout over the mug, tip it for ~2 s, level it again
     const m=mug.getWorldPosition(V()).add(V(0,.15,0));/* the spout 6 cm over the rim (the mug is 9 cm tall) */H.look=(a.lk0||a.k0)?(a.lk0||a.k0).clone().lerp(m,smooth(0,.7,a.t)):m;/* the gaze follows the kettle up from the ring (a jump of the look target popped the chest up) */H.lookW=1;a.tip=.75*(smooth(.7,1.2,a.t)-smooth(3.0,3.5,a.t));
     a.ik=[['pour',m,smooth(0,.6,a.t)],[hand,cupAt(),1]];/* the kettle arm first: its reach turned the chest after the mug hand was placed and carried the mug 20 cm off to the side, the spout chasing it */H.noPop={side:oth,until:performance.now()+120};/* the kettle arm is IK'd smoothly every frame: the pop filter only added jerks to it (6-11 cm) */if(a.t>1.2&&!a.snd){a.snd=1;AU('pour',m);}
     if(a.t>3.7){a.step='kback';a.t=0;a.tip=0;}return;}
    if(a.step==='kback'){const hm=toolHome('kettle');if(!a.kbL){a.kbL=(H.look||hm).clone();}H.look=a.kbL.clone().lerp(hm,smooth(0,.5,a.t));H.lookW=1;const t=gripHome('kettle')||hm;a.ik=[[hand,cupAt(),1],[oth,t,1]];
     /* back to the ring by the palm, from where the pour left it (the grip target with full weight at once dropped the fist 5 cm, 20 after the pops filter) */{const G=window.__grab;if(!a.rel&&G&&G.palmTarget&&ket()&&ket().parent===bones[oth+'Hand']){if(!a.pk)a.pk=G.palmTarget(oth,G.gripPoint(oth)).clone();a.ik=[[hand,cupAt(),1],['palm',a.pk.clone().lerp(G.palmTarget(oth,t.clone()),smooth(0,.7,a.t)),1]];}}
     if(!a.rel&&((a.t>.5&&palmTo(oth,t)<.03)||a.t>1.3)){a.rel=1;a.tr=a.t;try{P.release('kettle',{blend:.14});}catch(e){}}
     if(a.rel){const u=smooth(a.tr,a.tr+.6,a.t);const off=t.clone().addScaledVector(fwd(root.rotation.y),-.36*u).add(V(0,.05*u,0));/* let go, the hand comes up and back off the stove top before it drops (straight down from the handle it went through the stove's front edge, 4-5 cm) */a.ik=[[hand,cupAt(),1],[oth,off,1-smooth(a.tr+.6,a.tr+1.2,a.t)]];if(a.t>a.tr+1.25){a.step='drink';a.t=0;a.turn=rnd(-.8,.8);a.ik=null;{const b=fwd(root.rotation.y);H.slide={x:-b.x*.16,z:-b.z*.16,yaw:0,k:0,d:.5};a.y0=root.rotation.y;}/* a step back off the stove before he turns: right up at it, the turn swept the hanging hand through its corner */}}return;}
    if(a.step==='drink'){// turn toward the window, sip slowly, rest between sips
     const w=N.kwin?N.kwin.p:root.position;H.face=a.y0!=null&&a.t<.5?a.y0:Math.atan2(w.x-root.position.x,w.z-root.position.z)+a.turn*.3;H.look=w.clone().add(V(0,1.5,2));H.lookW=.5;
     // a sip: the mug up to the lips by the arm (no clip miming it at the hip), a moment, down to the belly, a pause
     if(a.sip===undefined){a.sip=.8;a.sd=rnd(1.1,1.6);play(IDLE(),{fade:.6});}const u=a.t-a.sip;const k=u<0?0:smooth(0,.6,u)*(1-smooth(.6+a.sd,1.2+a.sd,u));
     if(u>1.2+a.sd){a.sip=a.t+rnd(2.5,5);a.sd=rnd(1.1,1.6);}
     const hd=bones.Head.getWorldPosition(V());const lip=hd.addScaledVector(fwd(root.rotation.y),.12).add(V(0,.0,0));const c=cupAt();a.sk=k;a.ik=[[hand,c.lerp(lip,k),1]];if(k>.6){H.look=null;}}};
   // the mug stays upright in his hand (the wrist turns it level; it hung upside down off the IK'd hand); tilted toward him only at the lips
   const level=w=>{if(w<.01||mug.parent!==bones[hand+'Hand'])return;const hb=bones[hand+'Hand'];mug.updateMatrixWorld(true);const u=V(0,1,0).applyQuaternion(mug.getWorldQuaternion(new THREE.Quaternion()));
    const q=new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(u,V(0,1,0)),w);const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(q.multiply(cq)));hb.updateMatrixWorld(true);};
   a.post=dt=>{dt=dt||1/60;{/* life at the stove and by the window: a breath and the eyes always; the weight shift only while he just stands and sips (at the kettle the pour solve owns the body) */const on=/^(take|kreach|pour|kback|drink|putmug)$/.test(a.step);a.lw=(a.lw||0)+((on?1:0)-(a.lw||0))*Math.min(1,dt*1.5);a.lsw=(a.lsw||0)+((a.step==='drink'?1:0)-(a.lsw||0))*Math.min(1,dt*1.2);lifePre(a,dt,a.lw,{sw:a.lsw});}
    /* carrying the mug: held upright in front of him while he walks */if(H.hold[hand]&&/^(tostove|go|approach)$/.test(a.step))reachGrip(hand,cupAt(),1);
    a.post2();REACH_LEAN=.6;if(a.step==='drink')lifeLook(a,dt,a.lw,.03);const lv=()=>{if(H.hold[hand])level(a.step==='drink'?1-(a.sk||0):a.step==='take'?smooth(.85,1.3,a.t):1);};lv();
    /* the gaze (lookAt) turns the chest a quarter of the head's yaw AFTER this: at the stove that carried the mug hand 18 cm off its spot and the spout chased it; the hands are put back once the look is done */a.relook=()=>{if(!a.re||!a.re.length)return;REACH_LEAN=0;for(const f of a.re)f();REACH_LEAN=.6;lv();};
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
   const kPalm=pT=>{const G=window.__grab;reachTo(oth,pT,1);if(!G||!G.palmTarget)return;for(let i=0;i<3;i++){const pa=G.palmTarget(oth,G.gripPoint(oth));const e=pT.clone().sub(pa);if(e.length()<.004)break;romArmIK(oth,bones[oth+'Hand'].getWorldPosition(V()).add(e),sidePole(oth),1);}};/* inside the shoulder's range: a plain IK raised the shoulder 15-19 deg past it, the guard pulled the hand back down 12 cm, and the first frame with the kettle threw it 25-38 cm (gate orig, LeftHand jump) */
   const levelK=()=>{const k=ket();if(!k||k.parent!==bones[oth+'Hand'])return;const hb=bones[oth+'Hand'];k.updateMatrixWorld(true);const u=V(0,1,0).applyQuaternion(k.getWorldQuaternion(new THREE.Quaternion()));
    const q=new THREE.Quaternion().setFromUnitVectors(u,V(0,1,0));const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(q.multiply(cq)));hb.updateMatrixWorld(true);};
   /* the kettle turned about the vertical so its spout points along dir (weight w): set from pour on, eased back off in kback */
   const yawK=(dir,w)=>{const k=ket();if(!k||!dir||k.parent!==bones[oth+'Hand']||w<.001)return;const hb=bones[oth+'Hand'];k.updateMatrixWorld(true);const x=V(1,0,0).applyQuaternion(k.getWorldQuaternion(new THREE.Quaternion())).setY(0);if(x.lengthSq()<1e-6)return;x.normalize();
    const ang=Math.atan2(x.clone().cross(dir).y,x.dot(dir))*w;const q=new THREE.Quaternion().setFromAxisAngle(V(0,1,0),ang);const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(q.multiply(cq)));hb.updateMatrixWorld(true);};
   relookReg();a.post2=()=>{REACH_LEAN=a.step==='kreach'?1.0:a.step==='pour'?1-.4*smooth(0,.9,a.t):.6;/* the kettle stands on the back ring: he leans in for its handle (the adult arm fell 17 cm short and the kettle was stuck to the fist that far off) */levelK();/* from the very frame it leaves the stove */{const G=window.__grab;const k=ket();if(G&&k){if(k.parent===bones[oth+'Hand'])G.hold(oth,k,null);else G.free&&G.free(oth);}}/* collide.js leaves the hand holding it where it is (it shoved the fist and kettle up past his face) */a.re=[];if(!a.ik)return;for(const [sd,t,w] of a.ik){if(!t||(w<.01&&sd!=='pour'))continue;
     if(sd==='palm'){const yw=a.step==='kback'?1-smooth(0,.6,a.t):0;const pl=()=>{kPalm(t);levelK();yawK(a.kDir,yw);};pl();a.re.push(pl);continue;}
     if(sd==='pour'){// the kettle hand: put the spout above the mug (a few corrections), then tip it round the axis across the spout
      const k=ket();if(!k||k.parent!==bones[oth+'Hand'])continue;let tgt=t.clone().addScaledVector(rgt(),oth==='Left'?-.12:.12).add(V(0,.08,0));
      const tipNow=()=>{if(a.tip<=.01)return;const hb=bones[oth+'Hand'];const sp=kSpout().sub(hb.getWorldPosition(V())).setY(0).normalize();const ax=sp.clone().cross(V(0,1,0)).normalize();
       const q=new THREE.Quaternion().setFromAxisAngle(ax,-a.tip*w);const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());const cq=hb.getWorldQuaternion(new THREE.Quaternion());hb.quaternion.copy(pq.invert().multiply(q.multiply(cq)));hb.updateMatrixWorld(true);};
      // the spout is steered onto the rim WITH the kettle tipped (a few corrections of the fist), height included: never lifted above the chest
      /* the fist carried from where it lifted the kettle off the ring, low, over to the mug; the spout error is folded into a target kept
       from frame to frame (one gentle correction a frame: steady, no pop, no jitter) */
      /* SOLVED, not chased: the kettle is turned so its spout points across at the mug (yawK), tipped, and the fist is put where that
       kettle's spout lands over the rim. The old loop integrated the spout error frame to frame while the kettle's own yaw followed the
       fist: on the shorter hero it never settled (the kettle swung 20-50 cm, through his hips and shins; gate orig) */
      const G=window.__grab;const dir=rgt().multiplyScalar(oth==='Left'?1:-1).addScaledVector(fwd(root.rotation.y),-.3).normalize();a.kDir=dir.clone();/* across and a little back towards him: the kettle body stays out in front, off his chest */
      if(!a.kOff)a.kOff=dir.clone().multiplyScalar(.17).add(V(0,-.1,0));/* spout from the grip point: 17 cm across, 10 down (tipped) */
      const cyT=bones.Spine2.getWorldPosition(V()).y;if(a.cyv==null)a.cyv=Math.max(cyT,(G&&G.gripPoint?G.gripPoint(oth).y:cyT));a.cyv+=(cyT-a.cyv)*.06;const cy=Math.max(cyT,a.cyv);/* the cap comes down to the chest over ~0.7 s from where the fist is: clamped at once it pulled the kettle fist down 10-20 cm in a frame *//* the fist at chest height at most: lifted to fix the spout height it went up to his forehead, the forearm across the face (watch r24) */
      const g=t.clone().sub(a.kOff);if(g.y>cy)g.y=cy;const k0=a.k0?a.k0.clone().add(V(0,-.04,0)):g;const gb=k0.clone().lerp(g,w);
      const pp=a.pa0&&G?a.pa0.clone().add(gb.clone().sub(a.k0).add(V(0,.04,0))):null;
      const put=()=>{if(!pp)reachTo(oth,a.k0||gb,1-w);/* the stoop he reached the ring with straightens as the kettle comes in (no snap upright); kPalm leans by itself: a second lean toward the grip point on top of it pushed his head 6 cm forward on the first pour frame (gate: head 14 cm) */if(pp)kPalm(pp);else reachGrip(oth,gb,1);levelK();yawK(dir,w);tipNow();
       if(pp&&G){k.updateMatrixWorld(true);const e=t.clone().sub(kSpout()).multiplyScalar(w);if(e.length()>.15)e.setLength(.15);const gy=G.gripPoint(oth).y;if(gy+e.y>cy)e.y=Math.min(0,cy-gy);/* one correction: the fist turned with the kettle, the spout came out a few cm off */kPalm(pp.clone().add(e));levelK();yawK(dir,w);tipNow();}{/* KITCHEN: the kettle fist moves at most 2.5 cm a frame: each aim starts from a differently turned fist (levelling moves its grip point
         5-10 cm), and on the first pour frames the solve swung it 9-16 cm back and forth (?style=game film) */const hb=bones[oth+'Hand'];const h=hb.getWorldPosition(V());if(a.hFin){const d=h.clone().sub(a.hFin);if(d.length()>.025){d.setLength(.025);armIK(oth,a.hFin.clone().add(d),sidePole(oth),1);levelK();yawK(dir,w);tipNow();}}}
       if(G&&w>.5){k.updateMatrixWorld(true);const o=kSpout().sub(G.gripPoint(oth));a.kOff.lerp(o,.3);}};
      put();a.re.push(put);/* again after the gaze turned the chest */
      continue;}
     const rg=()=>{if(sd===oth&&a.step==='kreach'&&w>.98&&window.__grab&&window.__grab.palmTarget){kPalm(window.__grab.palmTarget(oth,t));}else reachGrip(sd,t,w);if(sd===oth)levelK();};rg();a.re.push(rg);/* the reach for the handle too: within the shoulder's range, so the palm the guard leaves is the palm on the handle */}};
   a.leave=cb=>{try{window.__grab&&window.__grab.free(oth);}catch(e){}try{if(ket()&&ket().parent!==ket().userData.home.parent)P.release('kettle');}catch(e){}if(!H.hold[hand]){cb();return;}a.t=0;a.ik=null;
    const back=()=>{a.step='approach';a.t=0;a.ik=null;approachTo(a,rest.mug.clone(),.42,()=>{a.step='putmug';a.t=0;});a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}a.ik=[[hand,cupAt().lerp(rest.mug.clone().add(V(0,.05,0)),smooth(0,.7,a.t)),1-smooth(.9,1.4,a.t)]];
     if(a.t>.75&&H.hold[hand]){release(hand);park(mug,rest.mug);}if(a.t>1.4){a.ik=null;cb();}};};
    if(root.position.distanceTo(N.sink.p)>.8){a.step='go';a.update=()=>{};play(IDLE(),{fade:.4});goTo('sink',back);}else back();};return a;},
  wash:(o)=>dishesAction(o),/* the old gesture: the real dishes job now */
  look:()=>{const a={step:'go'};goTo('deck',()=>{a.step='look';a.t=0;play(IDLE(),{fade:.6});});a.update=dt=>{if(a.step!=='look')return;a.t+=dt;H.face=N.deck.face;
    const sweep=Math.sin(a.t*.25)*6;H.look=root.position.clone().add(V(sweep,1.2+Math.sin(a.t*.13)*.6,8));H.lookW=.8;};a.leave=cb=>cb();return a;},
  // LEISURE (phone watch 04d8f62: he stood mid-room facing the viewer with the window at his back, arms in an A-pose): looking out
  // is done like listening, at a real glazed window facing the pane with a hand on the sill, the gaze wandering over the dark outside
  window:(o={})=>MAKE.listen({...o,gaze:true}),
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
 function pantryFront(){try{let s=root;while(s.parent)s=s.parent;const o=s.getObjectByName('pantry');if(!o)return null;const q=o.getWorldQuaternion(new THREE.Quaternion());const f=V(0,0,1).applyQuaternion(q);f.y=0;return f.lengthSq()>1e-4?f.normalize():null;}catch(e){return null;}}/* the pantry shelf's open side, world */
 const PT=(n)=>{try{const P=window.__props||P3;return P&&P.point?P.point(n):null;}catch(e){return null;}};
 const AU=(n,pos)=>{try{window.__audio&&window.__audio.play&&window.__audio.play(n,pos);}catch(e){}};
 const toolHome=n=>{try{const P=window.__props||P3;return P&&P.toolHome?P.toolHome(n,V()):null;}catch(e){return null;}};
 const hasTool=n=>{const P=window.__props||P3;return !!(P&&P.tools&&P.tools[n]);};
 // slide the last bit up to a work point and face it
 // the spot must leave room for his head (a low eave, a roof edge, a beam): step back from the work until it does
 function headroom(q,ux,uz){const C=window.__collide;if(!C||!C.depthAt)return;const hit=(x,z)=>{for(const hy of [1.5,1.68,1.82])for(const f of [0,.12])if(C.depthAt(x+ux*f,q.y+hy,z+uz*f)>.005)return true;return false;};
  if(!hit(q.x,q.z))return;for(let b=.1;b<=.9;b+=.1){for(const sd of [0,.15,-.15]){const x=q.x-ux*b-uz*sd,z=q.z-uz*b+ux*sd;if(!hit(x,z)){const t=V(x,q.y,z);pushOut(t);if(!hit(t.x,t.z)){q.x=t.x;q.z=t.z;return;}}}}}
 // STRETCH room: the hands of hy_stretch reach 0.56 m out at shoulder height and 1.74 m up (measured, both heroes); a ring of points
 // around the standing spot with a hand's margin, yaw-free (he may turn while he stretches). Walls, ladders, shelves: the collide grid.
 // STRETCH room (stretchroom.js): the arms' measured path through the clip, against the collide grid
 const STRETCHES=['hy_stretch','stretch_yawn'];
 function armsFree(p,yaw=root.rotation.y,clip='hy_stretch'){return window.__noStretchRoom?true:armsFreeAt(window.__collide,p,yaw,clip);}
 // a facing at p that has room (the current one first, then turning by up to 180 deg), or null
 function armsYaw(p,yaw,clip){for(const d of [0,.5,-.5,1,-1,1.6,-1.6,2.3,-2.3,Math.PI])if(armsFree(p,yaw+d,clip))return yaw+d;return null;}
 H.armsFree=(p,y,c)=>armsFree(p||root.position,y,c);
 // a generator: one candidate's arms check (~4000 probes) per step, so the search runs over a few frames instead of one hitch
 function* stretchSpot(clip){const C=window.__collide;const p=root.position;const lvl=(x,z)=>{const g=floorAt(x,p.y+.3,z,.45,.5);return g!=null&&Math.abs(g-p.y)<.06;};
  const inObst=(x,z)=>{for(const o of OBST){if(o.x1==null||Math.abs(o.y-p.y)>.5)continue;const r=.22;if(p.x>o.x0-r&&p.x<o.x1+r&&p.z>o.z0-r&&p.z<o.z1+r)continue;if(x>o.x0-r&&x<o.x1+r&&z>o.z0-r&&z<o.z1+r)return true;}return false;};
  let tries=0,cheap=0;for(let r=.2;r<=1.51;r+=.1)/* 1-2 steps, up to 1.5 m */for(let k=0;k<16;k++){if(++cheap%6===0)yield null;const an=k*Math.PI/8+(r*7%1),ux=Math.cos(an),uz=Math.sin(an),x=p.x+ux*r,z=p.z+uz*r;
   let ok=lvl(x,z)&&[[.15,0],[-.15,0],[0,.15],[0,-.15]].every(([u,v])=>lvl(x+u,z+v))&&!inObst(x,z)&&(!C||!C.room||C.room(x,p.y,z)<=.004);
   for(let t=.08;ok&&t<r;t+=.08){const xx=p.x+ux*t,zz=p.z+uz*t;if(!lvl(xx,zz)||inObst(xx,zz)||(C&&C.room&&C.room(xx,p.y,zz)>.004))ok=false;}/* room: legs and the swinging arms of the walk */
   if(!ok)continue;if(++tries>45)return null;const q=V(x,p.y,z);const y=armsYaw(q,Math.atan2(ux,uz),clip);if(y!=null)return {q,yaw:y};yield null;}
  return null;}
 // COLLIDE (R43-2: stoke walked from the ladder foot kl_b straight through the kitchen ladder to the woodpile behind it): an approach
 // whose straight line would take the body through something (ladder rails and rungs, a post, furniture) goes round it: two legs via
 // the nearest clear point to the side (collide.js clearance: knee to head height, 18 cm round the line). The end spot itself may be
 // tight (he works close to things), so the last 15% of the line is not checked.
 function viaAround(p,sp,stand){const C=window.__collide;if(!C||!C.sweep||window.__noVia)return null;const dx=sp.x-p.x,dz=sp.z-p.z,d=Math.hypot(dx,dz);if(d-stand<.3)return null;
  const q=V(p.x+dx/d*(d-stand),p.y,p.z+dz/d*(d-stand));const lim=.015;
  const legOk=(A,B,t0,t1)=>C.sweep(A.x,A.z,B.x,B.z,p.y,.09,t0,t1,.003,.25)<=.003&&C.sweep(A.x,A.z,B.x,B.z,p.y,.18,t0,t1,lim)<=lim;/* core line: nothing at all (a thin rung); full width: grazes only */
  if(legOk(p,q,.15,.85))return null;
  const m=V((p.x+q.x)/2,p.y,(p.z+q.z)/2),L=Math.hypot(q.x-p.x,q.z-p.z),u=V(-(q.z-p.z)/L,0,(q.x-p.x)/L);
  for(let off=.3;off<=1.01;off+=.1)for(const sg of [1,-1]){const v=m.clone().addScaledVector(u,off*sg);const y=floorAt(v.x,p.y+.3,v.z,.45,.5);if(y==null||Math.abs(y-p.y)>.06)continue;
   if(legOk(p,v,.1,1)&&legOk(v,q,0,.85))return v;}
  return null;}
 function approachTo(a,sp,stand,then){const p=root.position;if(!a._via){const v=viaAround(p,sp,stand);if(v){const fy=a.faceYaw;a._via=1;a.faceYaw=Math.atan2(v.x-p.x,v.z-p.z);approachTo(a,v,0,()=>{a.faceYaw=fy;a._via=1;approachTo(a,sp,stand,then);a._via=0;});a._via=0;return;}}const dx=sp.x-p.x,dz=sp.z-p.z,d=Math.hypot(dx,dz)||1e-3;H.face=a.faceYaw!=null?a.faceYaw:Math.atan2(dx,dz);/* faceYaw: the job's own facing (a window pane), turned to during the slide, not on the spot after it */
  let cap=1.2;if(a.reach&&d-stand>1.2){/* WEAR: a fault far from the walk graph (a long kitchen board's lifted end, 2.7 m off the node): walk on to it when the floor between is clear and level */const qq=p.clone().add(V(dx/d*(d-stand),0,dz/d*(d-stand)));let ok=segClear(p,qq);for(let t=.25;ok&&t<1;t+=.25){const y=floorAt(p.x+(qq.x-p.x)*t,p.y+.3,p.z+(qq.z-p.z)*t,.45,.5);if(y==null||Math.abs(y-p.y)>.06)ok=false;}if(ok)cap=Math.min(a.reach,d-stand);}
  const move=Math.max(0,Math.min(cap,d-stand));const q=p.clone().add(V(dx/d*move,0,dz/d*move));if(!a.noPush)pushOut(q,a.pushR);headroom(q,dx/d,dz/d);const dur=Math.max(.3,move/.8,Math.abs(wrapA(H.face-root.rotation.y))/2.4);/* never faster than ~140 deg/s */
  const mv=Math.hypot(q.x-p.x,q.z-p.z);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(H.face-root.rotation.y),k:0,d:dur};if(mv>.35){/* a real step over there: face the way he goes, turn to the work at the end (no gliding sideways) */const yT=Math.atan2(q.x-p.x,q.z-p.z);H.slide.y0=root.rotation.y;H.slide.yT=root.rotation.y+wrapA(yT-root.rotation.y);H.slide.yF=H.slide.yT+wrapA(H.face-yT);
   /* WALK: three phases with their own time: turn toward the spot (<=150 deg/s, it used to be 30% of the slide: up to 380 deg/s), step there, turn to the work */
   const t1=Math.abs(wrapA(yT-root.rotation.y))/2.6,t2=mv/.8,t3=Math.abs(wrapA(H.face-yT))/2.6;H.slide.d=Math.max(dur,t1+t2+t3);H.slide.a=t1/H.slide.d;H.slide.b=(t1+t2)/H.slide.d;}if(move>.08){play('30',{fade:.3,speed:1});H.turnStep=false;/* the step owns the walk clip: a turn-on-the-spot left over from before dropped it to idle mid-step (a 35 cm glide in the idle clip; game style: the feet then caught up in a hurried settle, leg jitter 6-8 cm) */}else if(H.cur&&H.cur===actions['30']&&!window.__keepWalk)play(IDLE(),{fade:.3});/* already there: the route's walk does not go on in place */
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
     goTo('kmid',()=>approachTo(a,wayPt,0,()=>{say('go2');approachTo(a,standPt.clone().addScaledVector(F,1),1,()=>{say('pdown');});}));}return;}
   if(a.step==='pdown'){/* EAT (watch R25-5): the plate goes onto the barrel by hand while he still stands; sitting down with it in his hand, the sit clip's lean lifted it to his face */H.look=plateSpot.clone().add(V(0,.15,0));H.lookW=.7;if(a.t>.85&&a.plate==='hand'){a.plate='table';plateDown(plateSpot);AU('cup',plateSpot);}
    if(a.t>1.35){say('sit');sitDown(seat,()=>{say('pick');play(has('mc_stoolidle')?'mc_stoolidle':has('33')?'33':SITIDLE,{fade:.5});/* straight onto the upright stool idle */});}return;}
   if(a.step==='go2'||a.step==='sit'){H.look=null;return;}
   {const B=actions.mc_stoolidle;if(B&&B.isRunning()&&/^(place|pick|eat|putspoon|lift)$/.test(a.step)){a.T2=(a.T2||0)+dt;B.time=.3+.28*Math.sin(a.T2*.9);}}
   if(a.step==='place'){H.look=plateSpot.clone().add(V(0,.15,0));H.lookW=.55;if(a.t>.9&&a.plate==='hand'){a.plate='table';plateDown(plateSpot);AU('cup',plateSpot);}if(a.t>1.3){say('pick');}return;}
   if(a.step==='pick'){H.look=plateSpot.clone().add(V(0,.15,0));H.lookW=.55;if(a.t>.6&&a.spoon==='plate')spoonToHand();if(a.t>1){say('eat');a.cyc=0;a.T=0;a.cu=0;a.per=rnd(2.6,3.3);a.rest=0;play(has('mc_stoolidle')?'mc_stoolidle':has('33')?'33':SITIDLE,{fade:.8});}return;}/* '33' (Mixamo seated idle): the Hunyuan sit idle folds the chest back over the stool on this rig */
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
  a.post=dt=>{const st=a.step;const k=x=>Math.min(1,x);REACH_LEAN=H.seated===seat||st==='sit'||st==='up'?.12:st==='pdown'?.5:.3;/* he never folds over the plate: the plate comes to him */const sat=H.seated===seat&&st!=='up';a.lw=(a.lw||0)+((sat?1:0)-(a.lw||0))*Math.min(1,(dt||1/60)*1.5);lifePre(a,dt||1/60,a.lw,{shift:false});/* seated: a breath, no weight shift */try{post2(dt);}finally{REACH_LEAN=.6;}lifeLook(a,dt||1/60,a.lw,.025);};
  const post2=dt=>{const st=a.step;
   const wantL=a.plate==='hand'||st==='take'&&a.t<.7||st==='place'||st==='pdown'&&a.t<1.1||st==='lift'||(st==='eat'||st==='pick'||st==='putspoon');
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
    else if(st==='pdown'&&a.plate==='hand'){t=carry.lerp(palmFor(plateSpot),smooth(.05,.8,a.t));}else if(st==='pdown'){t=palmFor(plateSpot).add(V(0,.06*smooth(.85,1.1,a.t),0));/* lets go: the palm lifts off the rim */}
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
  /* GRAB: the tap's cross-handle (8 cm beside the spout on the counter's x axis), the one nearer his right shoulder: the right hand turns it on and off */
  const knobP=()=>{const W=P&&P.water;const k=W&&W.lever?W.lever(V()):null;return k&&k.add(V(0,.02,0));};/* the tap lever's ball on the front corner of the basin rim (props.js) */
  a.wL=0;a.wR=0;a.n=0;a.piece=null;let lk=null;
  const say=s=>{a.step=s;a.t=0;};const sh0=()=>bones.LeftArm.getWorldPosition(V());
  const face2=()=>{const f=fwd(root.rotation.y);return f;};
  const nn=N.sink?'sink':nearNode(sinkP);const go=()=>approachTo(a,sinkP,.36,()=>{play(IDLE(),{fade:.6});next();});if(nn)goTo(nn,go);else go();
  // what next: dry ones up to the shelf (at most 2 a visit), then the dirty ones
  function next(){const st=D.state();if(false&&st.rack>0&&(a.up||0)<2&&shelfP&&!(st.dirty>0&&Math.random()<.5)){/* the wall shelf is 0.8 m over his shoulder and 0.65 m past the counter: out of reach by hand, so the clean dishes stay stood in the plate rack (their place) */a.up=(a.up||0)+1;a.kind='shelf';say('reachR');return;}
   if(st.dirty>0&&a.n<4){a.kind='wash';say('reachR');return;}
   if(a.tapOn){say('tapoff');return;}/* GRAB: his hand turns it off */say('end');}
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
   if(a.step==='totap'){const kp=knobP();if(!a.tapOn&&a.t>.25&&(!kp||palmTo('Right',kp)<.04)){try{P.water.tap(true);}catch(e){}a.tapOn=true;a.tapT=a.t;a.tapAt=a.T;AU('tap',kp||tapP);}/* GRAB: on only at the touch of the hand on the handle (it used to run by itself) */if(a.t>(a.tapOn?Math.max(.8,a.tapT+.35):1.6)){say('scrub');a.dur=rnd(2.6,4);}return;}
   if(a.step==='tapoff'){const kp=knobP();if(a.tapOn&&a.t>.25&&(!kp||palmTo('Right',kp)<.04||a.t>1.6)){try{P.water.tap(false);}catch(e){}a.tapOn=false;a.tapT=a.t;a.tapAt=a.T;}if(!a.tapOn&&a.t>a.tapT+.35&&(((a.wR||0)<.03&&(a.wL||0)<.03&&(a.kW||0)<.03)||a.t>a.tapT+2)){/* only once both hands have eased off (the next step drops them) */if(a.lvCb){const c=a.lvCb;a.lvCb=null;a.post=null;c();return;}say('end');}return;}
   if(a.step==='scrub'){if(a.t>a.dur*.6&&a.piece.show!==a.piece.clean){const ob=a.piece.obj;ob.visible=false;a.piece.show=a.piece.clean;}if(a.t>a.dur){say('torack');}return;}
   if(a.step==='torack'){if(a.t>.9){D.settle(a.piece.i,'rack');AU('plate',sinkP);a.piece=null;say('back');}return;}
   if(a.step==='lift'){if(a.t>1.1){say('shelf');}return;}
   if(a.step==='shelf'){if(a.t>1.0){D.settle(a.piece.i,'shelf');AU('plate',shelfP);a.piece=null;say('back');}return;}
   if(a.step==='back'){if(a.t>.35)next();return;}
   if(a.step==="end"){if(a.t>1.7||a.t>.5&&a.wL<.03&&a.wR<.03)endTask({ok:true});return;}};
  a.post=dt=>{const st=a.step;a.lw=(a.lw||0)+((/^(go|approach)$/.test(st)?0:1)-(a.lw||0))*Math.min(1,dt*1.5);lifePre(a,dt,a.lw,{sw:.5});/* life at the sink: weight shift, breath (before the hands are placed) */const f=face2(),r=V(-f.z,0,f.x),up=V(0,1,0);const hp=bones.Hips.getWorldPosition(V());
   let look=sinkP;let tR=null,tL=null;
   if(st==='reachR'){const from=a.kind==='shelf'?'rack':'dirty';const st2=D.state();const i=Array.from({length:4},(_,k)=>k).find(k=>D.where(k)===from);if(i!=null){const s=D.slot(i,from).pos;tR=s.clone().add(V(0,from==='dirty'?.05:.03,0));look=s;}
    if(a.kind==='wash')tL=holdC().addScaledVector(r,-.1).add(V(0,.07,0)).addScaledVector(f,-.06);/* waits up over the front of the basin: the elbow stays above the countertop */}
   else if(a.piece){const pc=a.piece.show;
    if(st==='totap'){const k=smooth(0,.8,a.t);const c=a.p0.clone().lerp(holdC(),k);c.y+=Math.sin(k*Math.PI)*.06;const q=a.q0.clone().slerp(holdQ(),k);pieceAt(c,q);tL=k>.5?c.clone().addScaledVector(r,-.08):holdC().addScaledVector(r,-.1).add(V(0,.07,0)).addScaledVector(f,-.06);/* the left hand waits over the basin and joins once the piece is out of it, never down into the counter */tR=c.clone().addScaledVector(r,.07);look=c;
     {const kp=knobP();a.tapK=0;if(kp&&(!a.tapOn||a.T<(a.tapAt??-9)+.3)){tR=kp;look=kp;a.tapK=1;}}/* GRAB: the right hand on the tap handle first, then back to the piece */}
    else if(st==='scrub'){const c=holdC();const w=Math.sin(a.t*1.3)*.15;const q=holdQ().multiply(new THREE.Quaternion().setFromAxisAngle(V(0,0,1),w));pieceAt(c,q);
     const n=V(0,1,0).applyQuaternion(q);const ph=a.t*2*Math.PI*1.6;const e1=V(1,0,0).applyQuaternion(q),e2=V(0,0,1).applyQuaternion(q);
     tR=c.clone().addScaledVector(n,.03).addScaledVector(e1,Math.cos(ph)*.035).addScaledVector(e2,Math.sin(ph)*.035);tL=c.clone().addScaledVector(r,-.08);look=c;}
    else if(st==='torack'){const sl=D.slot(a.piece.i,'rack');const k=smooth(0,.85,a.t);const c=holdC().lerp(sl.pos,k);c.y+=Math.sin(k*Math.PI)*.05;pieceAt(c,holdQ().slerp(sl.quat,k));const top=a.piece.kind==='cup'?.05:.085;/* the fingers on the edge: the side rim while it is flat, the top rim once it stands in the rack */tL=c.clone().addScaledVector(r,-.06*(1-k)).add(V(0,.02+(top-.02)*k,0));a.relL=tL.clone();look=c;/* the eyes ride with the plate: on the slot itself the head turned 73 deg past the chest */}
    else if(st==='lift'||st==='shelf'){const sl=D.slot(a.piece.i,'shelf');const k=st==='lift'?smooth(0,1.1,a.t)*.6:.6+.4*smooth(0,.9,a.t);
     const mid=a.p0.clone().lerp(sl.pos,.5).add(V(0,.15,0)).addScaledVector(f,-.12);const c=k<.6?a.p0.clone().lerp(mid,smooth(0,.6,k)):mid.clone().lerp(sl.pos,smooth(.6,1,k));a.shelfC=c;a.shelfQ=a.q0.clone().slerp(sl.quat,k);a.shelfK=k;tR=c.clone().add(V(0,-.01,0));look=c;}}
   /* the counter front is a hand's breadth from his thighs: the left hand comes up in front of his belly before it goes over the counter, and goes back there before it drops to his side (the straight blend to the clip ran it through the cabinet front) */
   const tuck=hp.clone().addScaledVector(f,.2).addScaledVector(r,-.2);tuck.y=hp.y+.12;
   if(st==='reachR'&&a.kind==='wash'&&a.t<.5&&a.n===0&&tL)tL=tuck.clone().lerp(tL,smooth(.12,.5,a.t));
   if(st==='end'){const side=hp.clone().addScaledVector(f,.03).addScaledVector(r,-.22);side.y=hp.y-.1;tL=a.t<.35?tuck:a.t<.85?tuck.lerp(side,smooth(.35,.85,a.t)):null;/* then down his side, and only there back to the clip */}
   if(st==='tapoff'){tL=tuck.clone();/* GRAB: while the right hand turns the tap off, the left waits in front of his belly (its fade to the clip ran it down through the counter, gate wash 7.8-10 cm) */const kp=knobP();a.tapK=0;if(kp&&(a.tapOn||a.T<(a.tapAt??-9)+.3)){tR=kp;look=kp;a.tapK=1;}}
   if(st==='back'&&a.relL&&a.t<.3)tL=a.relL.clone().add(V(0,.1*smooth(0,.3,a.t),0)).addScaledVector(f,-.05*smooth(0,.3,a.t));/* let go off the top edge: up and back, never down through the plate */
   else if(st==='back'&&a.kind==='wash'){a.relL=null;tL=holdC().addScaledVector(r,-.08);}
   /* a hand with nothing to do goes back to the clip (weights ramp, the hand glides) */a.wR+=((tR?1:0)-a.wR)*Math.min(1,dt*3.5);a.wL+=((tL?1:0)-a.wL)*Math.min(1,dt*3.5);
   H.look=lk=lk?lk.lerp(look,1-Math.exp(-dt*6)):look.clone();H.lookW=.85;lifeLook(a,dt,a.lw,.03);
   /* the hand glides to its target, lifted over the counter / basin edge on the way (never through the furniture) */
   const C=window.__collide;const clear=q=>{if(!C||!C.depthAt)return q;for(let i=0;i<20;i++){let hit=false;for(const dy of [-.04,-.015,0])if(C.depthAt(q.x,q.y+dy,q.z)>.003){hit=true;break;}if(!hit)break;q.y+=.01;}return q;};
   const gl=(k,v,from)=>{if(!a[k])a[k]=from.clone();if(v){const g=a[k];let w=v;
     g.lerp(w,1-Math.exp(-dt*12));if(g.distanceTo(v)>.03)clear(g);}return a[k];};
   REACH_LEAN=st==='shelf'||st==='lift'?.65:.3;/* at the sink he leans a little towards the rack (a little more up to the shelf), never folds over it */
   if(!a.lsR){a.lsR={v:0};a.lsL={v:0};}if(a.wR>.01||a.lsR.v>.004){const t=gl('gR',tR||null,palmPt('Right'));reachGrip('Right',t,a.wR,a.lsR);}else{a.gR=null;a.lsR.v=0;}
   {const G=window.__grab,LO=P.water&&P.water.leverObj;if(G&&LO){const kq=knobP();if(a.tapK&&a.wR>.6&&kq&&palmTo('Right',kq)<.05)G.hold('Right',LO,knobP);else G.free(LO);}}/* GRAB: the palm on the tap lever is a grip: collide leaves it there */
   /* up to the shelf the piece rides in the palm (where the hand really is), and only the last few cm go onto the shelf board */
   if((st==='lift'||st==='shelf')&&a.piece&&a.shelfC){const pp=palmPt('Right').add(V(0,.015,0));const e=smooth(.88,1,a.shelfK);pieceAt(pp.lerp(a.shelfC,e),a.shelfQ);}
   if(a.wL>.01||a.lsL.v>.004){const t=gl('gL',tL,palmPt('Left'));reachGrip('Left',t,a.wL,a.lsL);}else{a.gL=null;a.lsL.v=0;}
   a.kW=(a.kW||0)+((a.tapK?1:0)-(a.kW||0))*Math.min(1,dt*5);if(a.kW>.01&&a.gR&&a.wR>.01){REACH_LEAN=0;reachGrip('Right',a.gR,a.wR*a.kW);}/* GRAB: the left hand's lean moved the right fist off the tap lever (10 cm down): the right arm once more, arm only */REACH_LEAN=.6;};
  a.leave=cb=>{if(a.piece){D.settle(a.piece.i,a.piece.from==='dirty'&&a.piece.show!==a.piece.clean?'dirty':a.piece.from==='rack'?'rack':'rack');a.piece=null;}if(a.tapOn&&!a.lvCb&&a.step!=='go'&&a.step!=='approach'){a.lvCb=cb;say('tapoff');return;}/* GRAB: called away with the water running: his hand turns it off first */if(a.tapOn){try{P.water.tap(false);}catch(e){}}a.post=null;cb();};
  return a;}
 // KITCHEN B16: the crouch spot in front of the oven: behind the end of its open drop-door (42 cm) so knees and feet stay clear of it.
 // A short shuffle there (forward or back), facing the oven.
 /* GRAB: the shoulder's distance from the oven handle after the step in: at .6 the crouched arm ended 17 cm short of it, the door never
    came down and not one log went into the fire (fresh master, both heroes) */
 const OVR=.42;let LAPY=.1;/* GRAB: the armful ON the left thigh: at -2 cm the logs lay 10-12 cm inside it for the whole feed */
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
 /* GRAB: the bunk bed and the bedroom door leaf (open or shut) are not in collide.js's shapes (depthAt 0 there), so the sweep checks them itself:
    how deep a body of radius r standing at (x,z) sits in the bunk's box or the leaf's own box (the leaf turns with its hinge) */
 /* GRAB (watch r12: he swept standing inside the desk chair, the broom over the table top): all furniture boxes count, not only the bunk;
    the boxes are re-read once a frame, the chair moves */
 let HPB=[],HPF=-1;function hardBoxes(){const fr=Math.floor(performance.now()/16);if(fr===HPF)return HPB;HPF=fr;HPB=[];
  /* the solid props' boxes (props.js place(): table, chest, stove...; a merged table has no meshes of its own to measure), the chair live, the bunk */
  for(const o of OBST)if(o.n!=='chair'&&o.x1!=null)HPB.push(new THREE.Box3(V(o.x0,o.y,o.z0),V(o.x1,o.y+1,o.z1)));
  for(const o of [ctx.chair,ctx.bunk])if(o){const b=new THREE.Box3().setFromObject(o);if(!b.isEmpty())HPB.push(b);}
  /* the floor hatch: its hole (the broom went over and into it, watch r16) and the raised lid */
  {const hc=window.__house&&window.__house.hatch;if(hc&&hc.box){const b=hc.box;HPB.push(new THREE.Box3(V(b[0],b[2]-.5,b[4]),V(b[1],b[3]+1,b[5])));if(hc.lid&&hc.angle>.05){const lb=new THREE.Box3().setFromObject(hc.lid);if(!lb.isEmpty())HPB.push(lb);}}}
  return HPB;}
 function hardPen(x,y,z,r){let d=0;
  for(const B of hardBoxes())if(y+1.7>B.min.y&&y<B.max.y)d=Math.max(d,Math.min(x+r-B.min.x,B.max.x+r-x,z+r-B.min.z,B.max.z+r-z));
  const P=window.__props||P3,D=P&&P.door;if(D&&D.leaf){const L=D.leaf();L.updateMatrixWorld(true);const w=(D.width||.77)/2;for(const h of [.5,1.2]){const q=L.worldToLocal(V(x,y+h,z));if(q.y>-.2&&q.y<2.1)d=Math.max(d,Math.min(q.x+w+r,w+r-q.x,q.z+.09+r,.15+r-q.z));}}
  return Math.max(0,d);}
 function roomy(x,y,z){const CL=window.__collide;if(hardPen(x,y,z,.45)>0)return false;if(!CL||!CL.depthAt)return true;for(const r of [.3,.45,.58])for(let k=0;k<16;k++){const an=k*Math.PI/8;for(const h of [.95,1.15,1.3])if(CL.depthAt(x+Math.sin(an)*r,y+h,z+Math.cos(an)*r)>.003)return false;}return true;}
 /* the bedroom box (x -4.2..0.4, z 0.5..3.95): when he starts in there, a spot or step must stay that far (+m) inside it */
 function bedOver(p,x,z,m=0){if(!(Math.abs(p.y-lv.BD)<.3&&p.x<.4))return 0;return Math.max(0,x-(.4-.32-m),(-4.2+.3+m)-x,(.5+.3+m)-z,z-(3.95-.3-m));}
 function bedOut(p,x,z,m=0){return bedOver(p,x,z,m)>0;}
 function sweepSpot(){const p=root.position.clone();if(roomy(p.x,p.y,p.z))return p;
  for(let r=.2;r<=2.6;r+=.1)for(let k=0;k<16;k++)/* GRAB: the bedroom is tight (bunk, chair, table, door): look as far as the open floor before the door */{const an=k*Math.PI/8,x=p.x+Math.sin(an)*r,z=p.z+Math.cos(an)*r;const y=floorAt(x,p.y,z,.25,.25);if(y==null||Math.abs(y-p.y)>.04)continue;if(bedOut(p,x,z,.12))continue;if(roomy(x,y,z))return V(x,y,z);}
  return p;}
 /* the belt: a tool fetched from far away is hung on his right hip when the work is done (it used to ease home across the house by
    itself); the next job that needs it takes it from there, by hand. H.belt names the tool on the belt */
 function beltPt(){const f=fwd(root.rotation.y);const r=V(-f.z,0,f.x);return bones.Hips.getWorldPosition(V()).addScaledVector(r,.17).addScaledVector(f,.03).add(V(0,-.06,0));}
 function toBelt(n,hand){const P=window.__props||P3;if(!P||!P.grab||!bones.Hips)return false;const o=P.grab(n,bones.Hips,{offset:V()});if(!o){relTool(hand,n);return false;}
  /* fixed in the pelvis' own frame (x left, y up, z forward, metres on both rigs): head up, handle down along the right thigh, tipped out a little */
  const ws=bones.Hips.getWorldScale(V()).x||1;o.quaternion.setFromAxisAngle(V(0,0,1),-.12).multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),Math.PI/2));/* head fore-and-aft, not into the hip */o.position.set(-.2/ws,-.05/ws,0);if(H.hold[hand]&&H.hold[hand].tool===n)H.hold[hand]=null;H.belt=n;return true;}
 const beltHas=n=>{const P=window.__props||P3;const o=P&&P.tools&&P.tools[n];return H.belt===n&&!!o&&o.parent===bones.Hips;};
 /* GRAB (watch r14: the 1.2 m broom jumped onto his hip upside down, the stick through the ceiling, and rode along all day): only small
    tools go on the belt. A long one he carries home by hand (put), or, when a job is cut short, stands it down by hand where he is */
 const SMALL=/^(knife|hammer|benchHammer|pencil|screwdriver\d*|wrench\w*|benchWrench|pliers)$/;
 const farHome=n=>{if(!SMALL.test(n))return false;const h=toolHome(n);return !!h&&h.distanceTo(root.position)>1.6;};
 const awayHome=n=>{const h=toolHome(n);return !SMALL.test(n)&&!!h&&h.distanceTo(root.position)>1.0;};
 function standDown(n,hand){const P=window.__props||P3;const o=P&&P.tools&&P.tools[n];const hm=o&&o.userData.home;if(!o||!hm){relTool(hand,n);return;}
  /* the hand sets it down upright right under itself (its resting pose), and that spot is where it is fetched from next time; taking it
     there gives it its real home back, so the put afterwards carries it home */
  const hp=bones[hand+'Hand'].getWorldPosition(V());const f=fwd(root.rotation.y);hp.addScaledVector(f,.05);const y=floorAt(hp.x,root.position.y+.3,hp.z,.4,.6)??root.position.y;
  try{if(P.release)P.release(n);}catch(e){}if(H.hold[hand]&&H.hold[hand].tool===n)H.hold[hand]=null;
  const q=new THREE.Quaternion();hm.parent.getWorldQuaternion(q);q.multiply(hm.quat);scene.attach(o);o.position.set(hp.x,y,hp.z);o.quaternion.copy(q);o.visible=true;
  if(!o.userData.home0)o.userData.home0=hm;const ip=hm.parent===scene?o.position.clone():hm.parent.worldToLocal(o.position.clone());
  hm.parent.updateMatrixWorld(true);const iq=new THREE.Quaternion();hm.parent.getWorldQuaternion(iq);iq.invert().multiply(o.quaternion);
  o.userData.home={...hm,pos:ip,quat:iq};if(hm.parent!==scene)hm.parent.attach(o);}

 // squatting at a block or crate the knees go forward: he stays back so shins and feet never enter it (gate: shins 6.6 cm and
 // feet in the chopblock while the axe went back into it). job({clear:obj}) runs it in take/put too.
 function kneesClear(obj,dt,any){if(!obj||(!any&&(H.squat||0)<.05))return;const bb=new THREE.Box3().setFromObject(obj);const bc=bb.getCenter(V());const R=Math.min(bb.max.x-bb.min.x,bb.max.z-bb.min.z)/2;let need=0;
  for(const n of ['LeftLeg','RightLeg','LeftFoot','RightFoot','LeftToeBase','RightToeBase']){const b=bones[n];if(!b)continue;const q=b.getWorldPosition(V());if(q.y>bb.max.y+.05)continue;need=Math.max(need,R+.075-Math.hypot(q.x-bc.x,q.z-bc.z));}
  if(need>0){const p=root.position;const v=V(p.x-bc.x,0,p.z-bc.z).normalize();const m=Math.min(need,.4*dt);/* a smooth shuffle back, never a pop (gate: head jerk) */p.x+=v.x*m;p.z+=v.z*m;}}
 /* GRAB P1: hand tools that must never ride along into another task (loads such as buckets, the meat sack, logs and the gear go their own way) */
 const HANDTOOL=/^(ladle|knife|kettle|hammer|benchHammer|saw|plankSaw|axe|broom|wateringCan|pencil|pliers|screwdriver\d*|wrench\w*|benchWrench|supplyCan|supplyJar)$/;
 function handTools(){const r=[];for(const h of ['Right','Left']){const n=H.hold[h]&&H.hold[h].tool;if(n&&HANDTOOL.test(n)&&hasTool(n)&&toolHome(n))r.push([n,h]);}return r;}
 function stowAct(ht,cb){H.squat=0;H.path=[];H.then=null;const a=job({pt:()=>root.position.clone().add(V(0,1,0)),tools:ht,stow:true});a.stow=true;a.held=ht.map(x=>x[0]);a.step='put';a.t=0;a.putCb=cb;return a;}
 function job(o){const a={step:'go',t:0,T:0,held:[],faceYaw:o.faceYaw??null};const sp0=typeof o.pt==='function'?o.pt():o.pt;
  if(!sp0&&!o.node){a.update=()=>endTask(false);return a;}
  const sp=()=>(typeof o.pt==='function'?o.pt():o.pt)||(o.node&&N[o.node]?N[o.node].p.clone().addScaledVector(fwd(N[o.node].face??0),.5).add(V(0,1,0)):root.position.clone().add(V(0,1,0)));
  const dur=o.dur?rnd(o.dur[0],o.dur[1]):(o.clip&&!o.loop&&has(o.clip)?durOf(o.clip)*(o.reps||1):8);a.jdur=dur;
  const tools=(o.tools||[]).filter(([n])=>hasTool(n));
  const begin=()=>{a.standAt=root.position.clone();H.state='work';/* at the work: from a spot a step away (no walk, e.g. the plant by the reading table) the state stayed 'idle' and the gate saw him standing about through the whole pour */const tk=tools.length&&!a.fetched;a.step=tk?'take':'work';a.t=0;o.start&&o.start(a);if(!tk)work();};
  const work=()=>{a.step='work';a.t=0;if(o.clip&&has(o.clip)){if(o.loop)play(o.clip,{fade:window.__fadeIn??o.fadeIn??.5,speed:o.speed||1});else once(o.clip,{fade:.45,speed:o.speed||1,then:()=>{if(a.step==='work'&&a.T<dur-1)play(o.idle&&has(o.idle)?o.idle:IDLE(),{fade:.5});}});}else play(IDLE(),{fade:.5});};
  const go=()=>{const s=sp();if(o.pushR!=null)a.pushR=o.pushR;/* how close to the furniture box he may stand (the pot: right up at the stove) */if(o.node){goTo(o.node,()=>{if(o.slide===false){H.face=N[o.node].face??H.face;begin();}else approachTo(a,s,o.stand??.45,begin);});}
   else{const nn=nearNode(s);a.nn=nn;/* o.via: a point to step to first, so the turn on the way happens in the open (gate: the telescope turn kicked a deck post) */const fin=()=>{const v=o.via&&o.via(s);if(v)approachTo(a,v,0,()=>{a.noPush=true;const fy=a.faceYaw;if(o.viaFace)a.faceYaw=o.viaFace();approachTo(a,s,o.stand??.45,()=>{a.noPush=false;a.faceYaw=fy;begin();});});/* the last short step straight in: the obstacle box round the work (the tripod) pushed the target out past it, behind the rail */else approachTo(a,s,o.stand??.45,begin);};if(nn)goTo(nn,fin);else fin();}};
  /* a tool that lives somewhere else (the hammer on the workshop bench, the wrench) is fetched by walking there and taking it in the hand,
     then he goes to the work with it: never reached for from across the house (it used to fly into his hand) */
  const far=tools.length&&!beltHas(tools[0][0])&&(()=>{const h=toolHome(tools[0][0]);return h&&h.distanceTo(sp())>1.6&&h.distanceTo(root.position)>1.1;})();
  if(o.stow){}/* GRAB P1: only puts back what is in his hands */
  else if(far){const h=toolHome(tools[0][0]);const fetch=()=>approachTo(a,h.clone().setY(root.position.y),.42,()=>{a.step='take';a.t=0;a.afterTake=()=>{a.fetched=true;a.step="go";a.t=0;go();};});const nn=nearNode(h);if(nn)goTo(nn,fetch);else fetch();}
  else go();
  a.update=dt=>{a.t+=dt;const s=sp();
   if(a.step==='go'&&!o.noCut&&!a.cut&&a.nn&&motion&&H.path.length&&!window.__noCut)cutShort(a,s,o.stand??.45);
   if(a.step==='approach'){H.look=s;{/* no owl: the work behind him (stepping away first, then turning back to it) is not looked at over the shoulder */const fw=fwd(root.rotation.y),dx=s.x-root.position.x,dz=s.z-root.position.z,dl=Math.hypot(dx,dz)||1;H.lookW=.6*smooth(.1,.7,(fw.x*dx+fw.z*dz)/dl);}/* the work starts once he has turned to it: a squat that began mid-turn swivelled on the spot, motion.js took the
     legs for the turn (standing hips) and gave them back with a 30 cm drop (fix_rope) */const sk=H.slide?H.slide.k:1;a.skN=sk===a.skL?(a.skN||0)+1:0;a.skL=sk;if(a.t>=a.adur&&(sk>=1||a.skN>2||a.t>a.adur+1.2||window.__noTurnWait)){a.next();}return;}
   if((a.step==='take'||a.step==='put')&&o.reachT&&!(H.slide&&H.slide.k<1))a.t-=dt*(1-1/o.reachT);/* a slower hand for a tool set on a table top: the quick .45 s reach up and down read as a 5 Hz shake (gate jitter, watering can) */
   if(a.step==='take'){// GRAB: step in until the tool's grip is within arm's reach, the fist onto the grip (not the tool's origin), close the hand only there
    const [n,hand]=tools[a.held.length]||[];if(!n){work();return;}const bl=beltHas(n);const h=bl?beltPt():gripHome(n)||toolHome(n)||s;H.look=bl?null:h;H.lookW=1;
    if(!a.st){a.st=1;a.pk=0;if(!bl){const yw=Math.atan2(h.x-root.position.x,h.z-root.position.z);if(o.faceTool&&!window.__noTakeFace&&Math.abs(wrapA(yw-root.rotation.y))>.6)H.face=yw;/* the tool well off to one side (the watering can on the table at his left while he stood side-on to it): he turns to it first; reaching across the body the grip stayed 12-19 cm out of reach and the tool was taken by the timeout, the hand jumping 9 cm onto it, and his shins went through the can */stepNear(h,hand);}}if(H.slide&&H.slide.k<1){a.t=0;return;}if(a.st===1&&Math.abs(wrapA(H.face-root.rotation.y))<.12){a.st=2;/* once the turn on the spot is done too: the turn steps use the walk clip (stopping it mid-turn flickered idle/walk: hand jitter, fix_hinge) *//* the step to the tool is over: the walk clip stops with it (it went on looping through the reach: walking on the spot at the bench, fix_wall) */if(H.cur&&H.cur===actions['30']&&!window.__keepWalk)play(IDLE(),{fade:.3});}
    const low=!bl&&h.y<root.position.y+.7;jobSquat(a,dt,h,hand,!a.gotIt);if(o.clear)kneesClear(o.clear,dt);/* low down: he bends his knees to it (feet stay on the boards) */
    if(a.gotIt&&low){/* GRAB: taken off the floor, the tool rises with him in front of his shins (it used to swing back through them) */if(a.sq0==null)a.sq0=H.squat||0;const up=Math.max(0,a.sq0-(H.squat||0));if(H.squat>.02)a.tsU=a.t;
     a.rg=[hand,h.clone().add(V(0,up+.06*smooth(0,.3,a.t-a.tg),0)),1-smooth(0,.35,a.t-(a.tsU??a.t))];}
    else if(a.gotIt&&o.keepGrip){/* POT: the ladle stays up at the stove and goes straight into the stir (it fell to his hip first: the ladle through his shins, arm and head on the way back up) */a.kgP=h.clone().add(V(0,.05*smooth(0,.2,a.t-a.tg),0));a.rg=[hand,a.kgP,1];}
    else a.rg=[hand,h,(low?smooth(.4,.85,a.t):smooth(0,.45,a.t))*(a.gotIt?1-smooth(0,.35,a.t-a.tg):1)];
    if(!a.gotIt&&a.t>(low?.8:.45)&&(palmTo(hand,h)<.06||a.t>(low?1.5:1.6))){a.gotIt=true;a.tg=a.t;grabTool(n,hand);if(H.belt===n)H.belt=null;AU('cloth');}
    if(a.gotIt&&a.t-a.tg>(o.keepGrip?.2:.4)&&!(H.squat>0)&&(!low||a.t-(a.tsU??0)>.35)){a.held.push(n);a.gotIt=false;a.t=0;a.rg=null;a.st=0;a.sq0=null;a.tsU=null;if(a.held.length>=tools.length){if(a.afterTake){const f=a.afterTake;a.afterTake=null;f();}else if(o.restand){const q=o.restand();q.y=root.position.y;const s=sp();const fy=a.faceYaw;a.faceYaw=Math.atan2(s.x-q.x,s.z-q.z);play('30',{fade:.3,speed:1});approachTo(a,q,0,()=>{a.faceYaw=fy;a.fetched=true;work();});/* GRAB: the step in for the tool left him beside its shelf; he steps back to a stand of the work's own (the watering can: the pour swept the can through the table's end) */}else if(a.standAt&&!a.reApp&&Math.hypot(a.standAt.x-root.position.x,a.standAt.z-root.position.z)>.12){/* REPAIRS: the step to the tool took him off his work spot: back to it first (he hammered a wall 1.1 m away, from beside the bench) */a.reApp=1;approachTo(a,sp(),o.stand??.45,work);}else work();}}return;}
   if(a.step==='work'){a.T+=dt;H.look=o.look?o.look(a):s;H.lookW=o.lookW??.85;o.tick&&o.tick(a,dt);
    // small variations so a long job is never a frozen loop: pause and look round, scratch, stretch, sigh
    if(o.vary!==false&&dur>14){a.vt=(a.vt??rnd(9,16))-dt;if(a.vt<=0&&!a.pause){a.vt=rnd(10,18);const r=Math.random();
      if(r<.45){a.pause=rnd(2.5,4.5);a.pl=root.position.clone().add(V(rnd(-3,3),rnd(1.2,1.8),rnd(-3,3)));play(IDLE(),{fade:.6});}
      else if(r<.65&&has('hy_scratch'))overlay('hy_scratch',{fade:.4,speed:1.2});else if(r<.8&&has('hy_stretch')&&armsFree(root.position,root.rotation.y,'hy_stretch'))overlay('hy_stretch',{fade:.5,speed:1.15,weight:.7});else AU('sigh',root.position);}
     if(a.pause){a.pause-=dt;H.look=a.pl;H.lookW=.7;if(a.pause<=0){a.pause=0;if(o.clip&&o.loop&&has(o.clip))play(o.clip,{fade:.6,speed:o.speed||1});else if(o.clip&&has(o.clip))once(o.clip,{fade:.45,speed:o.speed||1});}}}
    if(!o.loop&&o.clip&&o.reps&&!H.once&&!a.pause&&a.T<dur-1)once(o.clip,{fade:.4,speed:o.speed||1});
    if(a.T>=dur){a.step='put';a.t=0;o.end&&o.end(a);play(IDLE(),{fade:.5});}return;}
   if(a.step==='put'){const n=a.held[a.held.length-1];if(!n){finish();return;}const hand=(tools.find(t=>t[0]===n)||[])[1]||'Right';if(!a.carried&&(awayHome(n)||farHome(n)&&window.__belt!==true)){/* GRAB: a tool is walked home in the hand and put there; a small one used to go on the belt and rode on his hip all day (critic W1: the bench hammer through cooking, sleep and trips) */a.carried=true;a.step='carry';a.t=0;const hh=toolHome(n);const back=()=>approachTo(a,hh.clone().setY(root.position.y),.42,()=>{a.step='put';a.t=0;a.st=0;});const me=nearNode(root.position.clone());if(me)H.node=me;/* he swept away from the job's node */const nn=nearNode(hh);if(nn)goTo(nn,back);else back();return;}
    if(a.toBelt==null)a.toBelt=farHome(n);const bt=a.toBelt;const h=bt?beltPt():gripHome(n)||toolHome(n)||s;H.look=bt?null:h;H.lookW=1;
    /* a far home: the tool goes on the belt (right hip), no trip back across the house and no flying home */
    // GRAB: the hand carries the tool onto its hook / spot and lets go there (the release only eases the last few mm), never from afar
    if(!a.st){a.st=1;a.pk=0;if(!bt){const yw=Math.atan2(h.x-root.position.x,h.z-root.position.z);if(o.faceTool&&!window.__noPutFace&&Math.abs(wrapA(yw-root.rotation.y))>.6)H.face=yw;/* LEISURE: as at the take: a spot 66 deg off to his side is faced first (the watering can was swept across in front of his knee: through the shins 7.8 cm) */stepNear(h,hand);}}if(H.slide&&H.slide.k<1){a.t=0;return;}if(a.st===1&&Math.abs(wrapA(H.face-root.rotation.y))<.12){a.st=2;/* once the turn on the spot is done too: the turn steps use the walk clip (stopping it mid-turn flickered idle/walk: hand jitter, fix_hinge) */if(H.cur&&H.cur===actions['30']&&!window.__keepWalk)play(IDLE(),{fade:.3});}
    const low=!bt&&h.y<root.position.y+.7;jobSquat(a,dt,h,hand,!a.rel);if(o.clear)kneesClear(o.clear,dt);
    a.rg=[hand,h,(low?smooth(.4,.85,a.t):smooth(0,.45,a.t))*(a.rel?1-smooth(0,.35,a.t-a.tr):1)];
    if(!a.rel&&a.t>(low?.8:.45)&&(palmTo(hand,h)<.08||a.t>(low?1.5:1.6))){a.rel=true;a.tr=a.t;if(bt)toBelt(n,hand);else relTool(hand,n);}
    if(a.rel&&a.t-a.tr>.4&&!(H.squat>0)){a.held.pop();a.rel=false;a.toBelt=null;a.t=0;a.rg=null;a.st=0;}}};
  const finish=()=>{a.ik=null;H.squat=0;if(a.putCb){const c=a.putCb;a.putCb=null;c();return;}endTask(o.result?o.result(a):undefined);};
  a.post=dt=>{if(a.step==='work'&&o.post)o.post(a,dt);ikList(a.ik);if(a.rg&&a.rg[2]>.01){if(o.reAim&&!window.__noReAim)reachGripN(a.rg[0],a.rg[1],a.rg[2],REACH_LEAN);else reachGrip(a.rg[0],a.rg[1],a.rg[2]);}};/* LEISURE: reAim: the palm target is corrected by where the held tool's grip really is (the watering can's handle sat 9-15 cm past its spot: he let go in the air and the hand jumped) */
  a.leave=cb=>{H.squat=0;if(a.step==='work'||a.step==='take')o.end&&o.end(a);a.ik=null;
   /* GRAB P1: cut short, the tools in his hands still go back by hand through the put step (carried home, set on the spot, or onto the belt), not flown off from where he stands */
   for(const h of ['Right','Left']){const n=H.hold[h]&&H.hold[h].tool;if(n&&!a.held.includes(n)&&tools.some(x=>x[0]===n))a.held.push(n);}
   if(a.held.length){a.putCb=cb;H.trans=false;if(a.step!=='put'&&a.step!=='carry'){H.path=[];H.then=null;a.step='put';a.t=0;a.st=0;a.rel=false;a.toBelt=null;a.rg=null;a.gotIt=false;}return;}
   cb();};
  return a;}
 // GRAB: knees bent just enough that the shoulder is within arm's reach of a low grip, then up again (the code squat keeps the feet planted)
 function jobSquat(a,dt,h,hand,down){const sh=bones[hand+'Arm'].getWorldPosition(V());const hz=Math.hypot(sh.x-h.x,sh.z-h.z);const R0=armLen*.9+PALM-.03;
  const want=down&&h.y<root.position.y+.7&&hz<R0*.95?clamp(sh.y+(H.squat||0)-h.y-Math.sqrt(Math.max(0,R0*R0-hz*hz))+.03,0,.4):0;/* only for a grip low down and within reach sideways (it squatted at the counter for an out-of-reach knife) */const c=H.squat||0;H.squat=c+clamp(want-c,-1.1*dt,1.1*dt);if(!want&&H.squat<.012)H.squat=0;H.sqJob=H.squat>0;}
 // GRAB: a small step so the shoulder ends within ~0.36 m (level) of p: a reach, not a lean or a stretch
 function stepNear(p,hand){const sh=bones[hand+'Arm'];if(!sh||!p)return;const s0=sh.getWorldPosition(V());const d=V(p.x-s0.x,0,p.z-s0.z);const L=d.length();if(L<=.4)return;
  const q=root.position.clone().addScaledVector(d.normalize(),Math.min(.6,L-.34));pushOut(q);const mv=Math.hypot(q.x-root.position.x,q.z-root.position.z);if(mv<.04)return;
  {const p=root.position;for(const k of [.5,1]){const x=p.x+(q.x-p.x)*k,z=p.z+(q.z-p.z)*k;let y=floorAt(x,p.y+.2,z,.3,.5);/* LEISURE: a ray down a gap between planks is not another floor (the boards around it count, as in the floor follow): the can's put found 6 cm lower there and he reached 0.7 m from where he stood */if(y!=null&&y<p.y-.04&&!window.__noStepGap)for(const [ox,oz] of [[.07,0],[-.07,0],[0,.07],[0,-.07]]){const g2=floorAt(x+ox,p.y+.2,z+oz,.3,.5);if(g2!=null&&g2>y&&g2<=p.y+.04)y=g2;}if(y==null||Math.abs(y-p.y)>.04)return;}}/* only on the same floor: never a step off an edge or onto a ledge */
  H.slide={x:q.x-root.position.x,z:q.z-root.position.z,yaw:0,k:0,d:Math.max(.4,mv/.6)};if(mv>.12)play('30',{fade:.25,speed:.9});}
 function relTool(hand,n){const P=window.__props||P3;try{if(P&&P.release)P.release(n,{blend:.35});}catch(e){}if(H.hold[hand]&&H.hold[hand].tool===n)H.hold[hand]=null;}
 function teleParts(){const P=window.__props||P3;let t=P&&P.placed&&P.placed.telescope;if(!t){t=null;scene.traverse(o=>{if(!t&&o.name==='telescope'&&o.userData&&o.userData.tube)t=o;});if(!t)scene.traverse(o=>{if(!t&&o.userData&&o.userData.tube&&o.userData.tube.parent)t=o;});}const tube=t&&t.userData&&t.userData.tube;if(!tube||!tube.parent)return null;
  const W=(x,y,z)=>{tube.updateMatrixWorld(true);return tube.localToWorld(V(x,y,z));};
  return {t,tube,yoke:tube.parent,eye:()=>W(-.5,0,0),dir:()=>W(1,0,0).sub(W(0,0,0)).normalize(),gripR:()=>W(-.27,.065,0)/* LEISURE: the fist on top of the tube just ahead of the left hand. It was 15 cm further on (-.12): 0.55 m from his shoulder against a 0.47 m arm, so the hand fell short beside the tube and the fingers went 4 cm into it. The fist centre sits a fist's half-thickness over the brass (r .03-.038) */,gripL:()=>W(-.3,-.045,0),floor:t.position.y};}
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
  // after the head has turned to look along the tube (lookAt runs after this post) the head is pitched up with the tube and the
  // eye rode 9-10 cm over the eyepiece (visual watch: the eyepiece at his chin, the gaze past it): the eye is measured from the
  // head as it now is and the spine stoops it down onto the eyepiece, then the hands go back on the tube
  const EYE_UP=(()=>{try{return new URLSearchParams(location.search).get('hero')==='orig'?.085:.05;}catch(e){return .05;}})();
  const eyeNow=()=>{const hp=Hd.getWorldPosition(V());const q=Hd.getWorldQuaternion(new THREE.Quaternion());const hf=V(0,0,1).applyQuaternion(q);if(bones.HeadTop_End){const top=bones.HeadTop_End.getWorldPosition(V());return hp.clone().lerp(top,.42).addScaledVector(hf,.085);}/* the head-top is not a Bone on either rig, so this is the path used: v6 (smaller head set lower) eyes 5 cm over the head joint, the bigger ?hero=orig head 8.5 cm; 7 cm forward (frame-checked from the side on both) */const hu=V(0,1,0).applyQuaternion(q);return hp.addScaledVector(hu,EYE_UP).addScaledVector(hf,.07);};
  const settle=()=>{for(let it=0;it<4;it++){const eye=eyeNow();const want=E.clone().addScaledVector(d,-.03);const hip=bones.Spine.getWorldPosition(V());
    const v=eye.clone().sub(hip),u=want.clone().sub(hip);const a1=Math.atan2(v.dot(dh),v.y),a2=Math.atan2(u.dot(dh),u.y);const ang=clamp(a2-a1,-.05,.3)*w;if(Math.abs(ang)<.003)break;
    rotW(bones.Spine,ax,ang*.4);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.25);root.updateMatrixWorld(true);}
   /* the eye still above the eyepiece (a stoop moves an eye over the hips forward, hardly down): he bends the knees that much,
      eased over the next frames (H.squat lowers the root, the feet stay on the boards) */{const dy=eyeNow().y-(E.y-.008);H.sqJob=true;a.sq=clamp((a.sq||0)+dy*Math.min(1,dt*3),0,.13);H.squat=a.sq*w;}
gripNoLean('Left',T.gripL(),w*.95);gripNoLean('Right',T.gripR(),w);};
  if(G&&G.late)G.late(settle);}
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
 function reachTo(side,t,w,ls){const sh=bones[side+'Arm'];if(!sh||!t)return;let tot=0;
  if(ls){/* rate-limited lean (ls={v,ax} kept by the caller): a target switching to one in reach used to drop the whole lean in one frame (gate: sink, chest 12 cm) */let want=0,ax=null;const hp=bones.Hips.getWorldPosition(V());const ex=sh.getWorldPosition(V()).distanceTo(t)-(armLen*.92+PALM);const d=V(t.x-hp.x,0,t.z-hp.z);
   if(ex>.01&&d.lengthSq()>1e-4){d.normalize();const fd=d.dot(fwd(root.rotation.y));if(fd>-.1){ax=V(0,1,0).cross(d).normalize();want=Math.min(REACH_LEAN,ex*3)*clamp(w,0,1)*smooth(-.1,.35,fd);}}
   const v=(ls.v||0)+clamp(want-(ls.v||0),-.012,.012);ls.v=v;if(ax)ls.ax=ax;ax=ls.ax;if(ax&&v>.002){rotW(bones.Spine,ax,v*.45);rotW(bones.Spine1,ax,v*.35);rotW(bones.Spine2,ax,v*.2);}}
  else for(let it=0;it<3;it++){const hp=bones.Hips.getWorldPosition(V());const s0=sh.getWorldPosition(V());const ex=s0.distanceTo(t)-(armLen*.92+PALM);if(ex<=.01)break;
   const d=V(t.x-hp.x,0,t.z-hp.z);if(d.lengthSq()<1e-4)break;d.normalize();if(d.dot(fwd(root.rotation.y))<-.1)break;/* never arch backwards to reach: the arm alone goes there */const ax=V(0,1,0).cross(d).normalize();const ang=Math.min(REACH_LEAN-tot,ex*3)*w;if(ang<=.005)break;tot+=ang;
   rotW(bones.Spine,ax,ang*.45);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.2);}
  const s1=sh.getWorldPosition(V());const tw=t.clone().sub(s1);const tl=tw.length();const wt=tl>PALM*1.5?s1.clone().addScaledVector(tw,(tl-PALM)/tl):t;/* the palm, not the wrist, on the point */
  armIK(side,wt,sidePole(side),clamp(w,0,1));}
 /* GRAB: reach with a lean, then measure the grip point and re-aim twice (the grip-palm offset turns with the wrist the IK just set) */
 function reachGripN(side,t,w,lean,ls){const RL=REACH_LEAN;try{REACH_LEAN=lean;reachGrip(side,t,w,ls);/* ls={v,ax}: the rate-limited lean (no on/off flicker at the reach limit) */REACH_LEAN=0;const G=window.__grab;const c=smooth(0,1,w);/* GRAB: the re-aim fades in with the weight (it switched off at w .5: the palm dropped 7 cm in a frame putting the book down) */if(!G||!G.gripPoint||c<.001)return;const e=V();let a=t.clone();for(let i=0;i<2;i++){e.copy(t).sub(G.gripPoint(side));/* GRAB: always both passes (an 8 mm early-out switched frame to frame: hand stutter) */a.add(e.multiplyScalar(c));reachGrip(side,a,w*c);/* GRAB: the re-aim passes weigh w*c, so a fading reach fades as w (three full-w passes held the hand near the target until w ~.02, then it dropped 12 cm in a frame) */}}finally{REACH_LEAN=RL;}}
 function palmTo(side,t){const G=window.__grab;const p=G&&G.gripPoint?G.gripPoint(side):bones[side+'Hand'].getWorldPosition(V());return p&&t?p.distanceTo(t):9;}
 const gripHome=n=>{const G=window.__grab;return G&&G.toolGripHome?G.toolGripHome(n):toolHome(n);};
 function reachGrip(side,t,w,ls){const G=window.__grab;if(!G||!G.gripPoint){reachTo(side,t,w,ls);return;}reachTo(side,G.palmTarget(side,t),w,ls);
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
 // KITCHEN: a hand goes to the pot over the top: from where it hangs it rises in an arc and comes down onto the handle (Walk aca2dc2)
 function reachArc(a,side,t,dt){const R=a.arc||(a.arc={});let r=R[side];if(!r){r=R[side]={p0:bones[side+'Hand'].getWorldPosition(V()),k:0};}r.k=Math.min(1,r.k+dt/.7);const k=smooth(0,1,r.k);
  if(r.k>=1)return t;/* up first, then over, then a few cm down onto it: no loop above the target (the old arc lifted the shorter hero's fist over his shoulder, a 12 cm jump and a 40 cm jitter, gate orig) */const ky=smooth(0,.4,r.k),kx=smooth(.2,1,r.k);const q=r.p0.clone().lerp(t,kx);q.y=r.p0.y+(t.y-r.p0.y)*ky+.05*Math.sin(Math.PI*kx);return q;}
 function stirPost(a,dt){const P=PP();const pot=P&&P.tools&&P.tools.pot,la=P&&P.tools&&P.tools.ladle;if(!pot||!la||la.parent!==bones.RightHand)return;
  a.sw=Math.min(1,(a.sw||0)+dt/.6);a.sa=(a.sa||0)+dt*4.6;if(a.kgP&&a.sw<1)gripNoLean('Right',a.kgP,1);/* the stir blends in from the fist where the take left it, not from the clip's hanging arm */pot.updateMatrixWorld(true);const c=pot.localToWorld(V(0,.07,0));const sh=bones.RightArm.getWorldPosition(V());
  const toMe=V(sh.x-c.x,0,sh.z-c.z).normalize();const B=c.clone().add(V(Math.cos(a.sa)*.045,0,Math.sin(a.sa)*.045));// the bowl in the soup
  // the handle leans toward him; pick the lean (and a little to his right) that keeps the fist a comfortable ~0.42 m from the shoulder
  /* POT (watch R25-7): the fist on the upper third of the handle (grab.js ladle grip, 24 cm from the bowl), 15-20 cm over the rim, the
     elbow bent down by his waist: before, the fist held the very end at ~42 cm from the shoulder, the arm straight out at shoulder
     height and the hand up among the ladles on the rail */
  const sp0=window.__grab&&window.__grab.GRIP&&window.__grab.GRIP.ladle;const L=sp0?.16+sp0.g[1]:.29;const rim=pot.localToWorld(V(0,.115,0)).y;
  const rt=V(-toMe.z,0,toMe.x);let Gp=null,bd=9;for(const el of [1.4,1.3,1.2,1.1,1.0,.9,.8])for(const sd of [0,.35,-.2]){const dir=toMe.clone().multiplyScalar(Math.cos(el)).addScaledVector(rt,sd*Math.cos(el)).add(V(0,Math.sin(el),0)).normalize();
   const g=B.clone().addScaledVector(dir,L);const dy=g.y-rim;const e=Math.max(0,.15-dy)+Math.max(0,dy-.2)+.5*Math.abs(g.distanceTo(sh)-.32)+(sd?.02:0);if(e<bd){bd=e;Gp=g;}}
  a.gs=a.gs?a.gs.lerp(Gp,1-Math.exp(-dt*10)):Gp.clone();Gp=reachArc(a,'Right',a.gs,dt);/* the ladle comes over the stove top, not through its front (Walk aca2dc2, folded in) */
  const G=window.__grab;if(G){const ld=PP().tools&&PP().tools.ladle;G.hold('Right',ld&&ld.parent===bones.RightHand?ld:pot,null);a.stirHold=1;}/* W4: registered as holding what it holds (the ladle), not the whole stove: __grab.held said 'right hand' for the kettle, the plate and the pot at once *//* the stove and pot are what his hands work at: collide.js leaves them there */
  /* W10: no torso lean toward the pot; he stands close instead */holdToolAt('Right','ladle',Gp,B,a.sw);a.dbg=[Gp,B];{const G2=window.__grab,sw=a.sw;if(G2&&G2.late)G2.late(()=>holdToolAt('Right','ladle',Gp,B,sw));}
  // left hand on the pot handle nearer his left
  const hs=[pot.localToWorld(V(-.1,.09,0)),pot.localToWorld(V(.1,.09,0))];const ls=bones.LeftArm.getWorldPosition(V());const lh=hs[0].distanceTo(ls)<hs[1].distanceTo(ls)?hs[0]:hs[1];
  /* KITCHEN: the left hand is let into the stove only while it is really on the pot or the stove edge, and it comes there over the top
     in an arc (reachArc); a hand left hanging by his side is collide's again (gate pot: 10 cm inside the stove front) */
  let lOn=false;if(lh.distanceTo(ls)<armLen*.95+PALM+(a.lHd?.04:0)){a.lHd=1;/* hysteresis: at the edge of reach the stir's sway switched the left hand between the handle and the stove edge every 2 s (cook) */gripNoLean('Left',reachArc(a,'Left',lh,dt),.95*Math.min(1,a.sw*1.8));lOn=2;}
  else{a.lHd=0;// KITCHEN: the handle is out of reach: the left palm rests flat on the stove's front edge beside the pot (steadying himself), never stretched or leaning
   if(!a.sbox){const st=pot.parent;a.sbox=new THREE.Box3().setFromObject(st);a.sy=pot.getWorldPosition(V()).y;}const b=a.sbox;
   const e0=V(clamp(ls.x,b.min.x+.04,b.max.x-.04),a.sy+.012,clamp(ls.z,b.min.z+.04,b.max.z-.04));
   /* the palm only where it lies on top of something with nothing over it (the kettle beside the pot, the taller counter): walk the spot toward the pot until the collide grid has room for a hand */
   const C=window.__collide;const pc=pot.getWorldPosition(V());let e=null;for(let k=0;k<=5&&!e;k++){const q=e0.clone().lerp(V(pc.x,e0.y,pc.z),k*.12);if(!C||!C.depthAt||(C.depthAt(q.x,q.y+.035,q.z)<=0&&C.depthAt(q.x,q.y+.07,q.z)<=0))e=q;}
   if(e&&e.distanceTo(ls)<armLen*.98+PALM){gripNoLean('Left',reachArc(a,'Left',e,dt),.9*Math.min(1,a.sw*1.8));lOn=true;}}
  if(G){if(lOn&&a.sw>.5)G.hold('Left',lOn===2?pot:(pot.parent||pot),null);else G.free&&G.free('Left');}/* W4: on the handle it holds the pot; only a palm resting on the stove edge counts as on the stove */
  // a scrape each half turn (Sound): the bowl along the pot side
  const half=Math.floor(a.sa/Math.PI);if(half!==a.sh){a.sh=half;try{window.__audio&&window.__audio.contact&&window.__audio.contact({tool:'spoon',kind:'scrape',pos:B.toArray(),strength:.45,dur:Math.PI/4.6});}catch(e){}}}
 // KITCHEN chop: the knife tip stays on the board beyond the carrot, the handle rocks down through it (a cut every ~0.5 s: slow lift,
 // quick press), each cut a few mm further along; the left palm holds the carrot a finger's width from the blade
 /* GRAB (watch r16): each cut leaves a carrot round on the board beside the blade, tipping over flat and pushed aside by the next ones;
    up to six, gone when he puts the knife down */
 let SLM=null;function chopSlice(a,bd,x){if(!SLM)SLM=new THREE.MeshStandardMaterial({color:0xE07A2A,roughness:.6});a.sl=a.sl||[];
  for(const m of a.sl)m.position.x+=Math.sign(x||1)*.007;let m=a.sl.length>=6?a.sl.shift():new THREE.Mesh(new THREE.CylinderGeometry(.014,.015,.006,12),SLM);
  if(m.parent!==bd)bd.add(m);m.position.set(x,.026,.008+(Math.random()-.5)*.012);m.rotation.set(0,0,Math.PI/2*.15*Math.sign(x||1));m.userData.t=0;a.sl.push(m);}

 // ===== KITCHEN: life while he works at a counter (coordinator round 27): a slow weight shift from one leg to the other (the pelvis
 // slides 1.5-2 cm over the loaded foot and drops a little on the free side, the feet stay planted by a two-bone leg IK), a breath in
 // the chest, and the eyes wandering a few cm over the work with quick saccades. lifePre runs before the hands are placed (so the
 // hands stay on their targets), lifeLook after the task has set H.look. w: 0..1 (fade in/out with the work).
 /* its own PRNG: drawing from Math.random here would shift every later random choice of the shared (seeded) stream */
 let lifeS=12345;const lr=(a=0,b=1)=>{lifeS=(lifeS*1103515245+12345)%2147483648;return a+(b-a)*lifeS/2147483648;};
 function lifePre(a,dt,w=1,o={}){const L=a.life||(a.life={t:lr(0,20),T:lr(5,8),ph:lr(0,6.28),lk:V(),lkT:V(),nx:lr(.8,2)});L.t+=dt;if(window.__noLife)w=0;if(w<.01)return;
  const LB=[bones.Hips,bones.Spine,bones.Spine1,bones.Spine2].filter(Boolean),base=LB.map(b=>[b.position.clone(),b.quaternion.clone()]);
  const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
  const sw=o.shift===false?0:(o.sw??1);if(sw*w>.01){const Hb=bones.Hips;const pre={};for(const sd of ['Left','Right']){const F=bones[sd+'Foot'];if(F)pre[sd]=[F.getWorldPosition(V()),F.getWorldQuaternion(new THREE.Quaternion())];}
   const x=sw*Math.sin(L.t*2*Math.PI/L.T+L.ph);/* -1..1: which foot carries him */
   const d=r.clone().multiplyScalar(.018*x*w).add(V(0,-.006*Math.abs(x)*w,0));const wp=Hb.getWorldPosition(V()).add(d);Hb.position.copy(Hb.parent.worldToLocal(wp));Hb.updateMatrixWorld(true);
   rotW(Hb,f,-.035*x*w);rotW(bones.Spine,f,.022*x*w);rotW(bones.Spine1,f,.013*x*w);/* the pelvis drops on the free side, the chest stays upright */root.updateMatrixWorld(true);
   for(const sd of ['Left','Right']){const P=pre[sd];if(!P)continue;const U=bones[sd+'UpLeg'],Lg=bones[sd+'Leg'],F=bones[sd+'Foot'];const k=Lg.getWorldPosition(V()),hp=U.getWorldPosition(V());const pole=k.clone().sub(hp.clone().add(P[0]).multiplyScalar(.5));if(pole.lengthSq()<1e-6)pole.copy(f);pole.normalize().lerp(f,.3);
    ik2(U,Lg,F,P[0],k.clone().add(pole),w*sw,false);/* weighted by the fade: at its first frames a full re-solve snapped the knee into the pole plane (a 12 cm leg jump); the slide left is (1-w)·w·1.8 cm, under 5 mm */const pq=F.parent.getWorldQuaternion(new THREE.Quaternion());F.quaternion.copy(pq.invert().multiply(P[1]));F.updateMatrixWorld(true);}}
  {const b=Math.sin(L.t*2*Math.PI/4.3);rotW(bones.Spine2,r,-.012*b*w);/* a breath: the chest rises and opens a little */}root.updateMatrixWorld(true);
  lifeUndo=LB.map((b,i)=>[b,b.position.clone().sub(base[i][0]),b.quaternion.clone().invert().premultiply(new THREE.Quaternion()).multiply(base[i][1])]);if(!lifeReg){lifeReg=1;stage('pre',()=>{/* next frame's start, before the clip: take our offset back off. A bone the clip rewrites loses it anyway; one it leaves (a held or slowed pose) must not pile it up */if(!lifeUndo)return;for(const [b,dp,dq] of lifeUndo){b.position.sub(dp);b.quaternion.multiply(dq);}lifeUndo=null;});}}
 let lifeUndo=null,lifeReg=0;
 function lifeLook(a,dt,w=1,amp=.035){const L=a.life;if(window.__noLife)return;if(!L||w<.01||!H.look||!H.look.isVector3)return;L.nx-=dt;if(L.nx<=0){L.nx=lr(.7,2.4);L.lkT.set(lr(-1,1),lr(-.6,.6),lr(-1,1)).multiplyScalar(amp);}
  L.lk.lerp(L.lkT,1-Math.exp(-dt*14));/* a saccade: quick, then still */if(L.lo&&H.look===L.lo)H.look=L.lb;/* a look target not set again this frame: offset the base, never pile it up */L.lb=H.look;H.look=H.look.clone().addScaledVector(L.lk,w);L.lo=H.look;}
 function chopPost(a,dt){const P=PP();const bd=P&&P.tools&&P.tools.board,kn=P&&P.tools&&P.tools.knife;if(!bd||!kn||kn.parent!==bones.RightHand)return;
  a.cw=Math.min(1,(a.cw||0)+dt/.7);lifePre(a,dt,smooth(.3,1,a.cw));bd.updateMatrixWorld(true);const L=v=>bd.localToWorld(v);
  const sh=bones.RightArm.getWorldPosition(V());const c0=L(V(0,.022,.045));const toMe=V(sh.x-c0.x,0,sh.z-c0.z).normalize();
  const xr=L(V(1,0,0)).sub(L(V(0,0,0)));xr.y=0;xr.normalize();const rt=V(-toMe.z,0,toMe.x).multiplyScalar(-1);/* his right */const sx=xr.dot(rt)>=0?1:-1;// board +x on his right?
  // the cut moves along the carrot toward its thin end, then starts again
  a.cp=(a.cp||0)+dt;const per=.52;const ph=(a.cp%per)/per;const n=Math.floor(a.cp/per);const off=.012-(n%6)*.007;/* GRAB: every cut on the carrot (it runs x -.09..+.04 on the board), not past its thick end */
  const cut=L(V(off*sx,.022,.045));const away=toMe.clone().multiplyScalar(-1);
  const T=cut.clone().addScaledVector(away,.075).add(V(0,.004,0));// the tip rests on the board past the carrot
  const lift=ph<.72?.012+.075*Math.sin(ph/.72*Math.PI/2):.087-.075*smooth(.72,1,ph);// slow lift, quick press down
  const dir=toMe.clone().addScaledVector(rt,.25).normalize();const dy=Math.min(.19,.018+lift);const hd=Math.sqrt(.2*.2-dy*dy);
  const gp=T.clone().addScaledVector(dir,hd).add(V(0,dy,0));
  if(n!==a.cn&&ph>.95){}if(n!==a.cn){a.cn=n;if(a.cw>.9){chopSlice(a,bd,.05*sx);AU('chop',cut);try{window.__audio&&window.__audio.contact&&window.__audio.contact({tool:'knife',kind:'hit',pos:cut.toArray(),strength:.35});}catch(e){}}}
  {/* bend a little over the board from the chest (people lean over a cutting board; the counter keeps his hips ~0.5 m away) */const ax=V(0,1,0).cross(away).normalize();const ang=.16*a.cw;rotW(bones.Spine,ax,ang*.45);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.2);root.updateMatrixWorld(true);}
  const G=window.__grab;if(G){G.hold('Right',bd,null);G.hold('Left',bd,null);a.chHold=1;}
  holdToolAt('Right','knife',gp,T,a.cw,V(0,-1,0));{const w=a.cw;if(G&&G.late)G.late(()=>holdToolAt('Right','knife',gp,T,w,V(0,-1,0)));}
  // left palm on the carrot, 5 cm to the far side of the cut (toward the carrot's tip), fingers curled over it
  const lp0=L(V((off-.055)*sx,.058,.045));
  /* GRAB (gate: left hand 4.2 cm into the worktop): the palm does not blend straight from where it hangs to the carrot (that line cuts
     the counter's front edge); it is carried at full IK from where it was, up over the edge in an arc, and down onto the carrot */
  if(!a.lh0)a.lh0=bones.LeftHand.getWorldPosition(V());const e=smooth(0,1,a.cw);const lp=a.lh0.clone().lerp(lp0,e).add(V(0,.16*Math.sin(Math.PI*Math.min(1,e*1.15)),0));if(e>=1)lp.copy(lp0);
  const lw=Math.min(1,a.cw*4)*.95;gripNoLean('Left',lp,lw);if(G&&G.late)G.late(()=>gripNoLean('Left',lp,lw));
  H.look=cut;H.lookW=1;lifeLook(a,dt,smooth(.3,1,a.cw),.03);}
 Object.assign(MAKE,{
  // kitchen
  chop:(o)=>job({pt:()=>PT('board'),stand:.3,/* KITCHEN (watcher B8): no hy_chop clip (it chopped at hip height under the worktop, bow-legged, the left hand hanging): he stands upright at the board, the knife is held by hand IK and rocks on its tip over the carrot, the left hand holds the carrot */loop:true,dur:[22,40],tools:[['knife','Right']],vary:false,post:(a,dt)=>chopPost(a,dt),end:a=>{if(a.sl){for(const m of a.sl)m.parent&&m.parent.remove(m);a.sl=null;}if(a.chHold){a.chHold=0;try{window.__grab.free('Left');window.__grab.free('Right');}catch(e){}}}}),
  pot:(o)=>job({pt:()=>PT('pot')||PT('pan'),stand:.45,pushR:.23,/* the oven door's handle bar stands out past the stove box: 3 cm more room for his toes *//* POT: standing right up at the stove (pushR .15) put his feet in the oven door and the fist through the stove front: back at .45 *//* KITCHEN: no hy_stir clip (it sways the whole body and mimes beside the pot): the stirring arm is hand IK (stirPost), the body stands calm */loop:true,dur:[25,45],tools:[['ladle','Right']],keepGrip:true,vary:false,post:(a,dt)=>stirPost(a,dt),end:a=>{if(a.stirHold){a.stirHold=0;try{window.__grab.free('Left');window.__grab.free('Right');}catch(e){}}}}),
  stoke:(o)=>{// KITCHEN: logs from the woodpile into the oven, all by hand. Squat at the pile, both palms on the logs, the armful goes into the
   // left arm; walk over cradling it; squat at the oven, the right hand takes the door handle and lowers the door as far as the hand carries it;
   // one log after another: the right hand takes it out of the left arm and pushes it into the fire; the right hand lifts the door shut; stand up.
   const a={step:'go',t:0};const wp=PT('woodpile'),ovp=PT('oven');const P=window.__props||P3;const OV=()=>P&&P.oven;if(!wp||!ovp||!OV()||!OV().handle){a.update=()=>endTask(false);return a;}
   const G=()=>window.__grab;const rightOf=()=>{const f=fwd(root.rotation.y);return V(-f.z,0,f.x);};
   const arm=()=>P.tools&&P.tools.logArmful;let logs=[],home=[];
   const sqTo=(v,dt,rate=1.0)=>{const c=H.squat||0;H.squat=c+clamp(v-c,-rate*dt,rate*dt);H.kSquat=H.squat>.001;H.kSqA=act;};
   // how far the hips must go down for the palm to reach t from the shoulder (feet stay put), +3 cm to spare
   const sqFor=(t,side='Right',mx=.45)=>{const sh=bones[side+'Arm'].getWorldPosition(V());const hz=Math.hypot(sh.x-t.x,sh.z-t.z);const R0=armLen*.9+PALM-.03;const dy=sh.y+(H.squat||0)-t.y;return clamp(dy-Math.sqrt(Math.max(0,R0*R0-hz*hz))+.03,0,mx);};
   const mouth=()=>{const o=OV();const h=o.handle(V());const c=ovp.clone();return c.add(V(h.x-c.x,0,h.z-c.z).multiplyScalar(-.15)).setY(ovp.y+.02);};// inside the opening, above the embers
   a.ik=[];
   const toOven=()=>{const nn=nearNode(ovp)||'stove';goTo(nn,()=>approachTo(a,ovp,.62,()=>ovenSpot(a,()=>{a.step='ovsq';a.t=0;H.carry=null;play(IDLE(),{fade:.4});})));};
   const nn=nearNode(wp)||'kmid';goTo(nn,()=>approachTo(a,wp,.5,()=>{a.step='pksq';a.t=0;AU('grunt');}));
   a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    const o=OV();a.ik=[];kSlow(/^(pksq|ovsq|open|let|log|shut|up)$/.test(a.step)&&(H.squat||0)>.05);
    if(a.step==='pksq'){// squat down to the pile, both hands onto the top logs
     H.look=wp;H.lookW=1;if(a.t<=1.0){if(a.sqd===undefined)a.sqd=sqFor(wp);sqTo(a.sqd,dt);}const w=smooth(.25,.9,a.t);a.ik=[['Left',wp.clone().add(V(0,.04,0)).addScaledVector(rightOf(),-.12),w],['Right',wp.clone().add(V(0,.04,0)).addScaledVector(rightOf(),.12),w]];
     if(a.t>1.0&&!a.got){a.got=1;try{P.grab('logArmful',bones.LeftHand,{offset:V(.1,.12,.1)});const ar=arm();if(ar){logs=ar.children.slice();home=logs.map(l=>({p:l.position.clone(),q:l.quaternion.clone(),v:l.visible}));}window.__audio&&window.__audio.carry&&window.__audio.carry(true);}catch(e){}
      try{P.woodpile&&P.woodpile.setCount&&P.woodpile.setCount(Math.max(0,(P.woodpile.count||1)-1));}catch(e){}}
     if(a.t>1.0){a.ik=[['Right',a.ik[1][1],1-smooth(1.0,1.5,a.t)]];sqTo(0,dt,1.1);}
     if(a.t>1.6&&(H.squat||0)<.01){a.step='carry';H.carry='hy_carrylogs';toOven();}return;}
    if(a.step==='carry'||a.step==='go'){if(H.carry&&H.path.length&&has(H.carry)&&!H.ov)overlay(H.carry,{fade:.3,until:.98,weight:.9});return;}
    if(a.step==='ovsq'){// down to the oven, the right palm onto the door handle
     const h=o.handle(V());H.look=h;H.lookW=1;
     if(!a.ovSt&&(H.squat||0)>.02){const sh=bones.RightArm.getWorldPosition(V());if(Math.hypot(h.x-sh.x,h.z-sh.z)>.5){sqTo(0,dt,.9);a.t=0;return;}}/* up from the log pile first, then the step in (a walk clip while squatting jerked the legs) */
     if(!a.ovSt){a.ovSt=1;/* GRAB (frame check: the fist stayed 27 cm short of the handle): first a short step in to arm's reach, on free boards only (collide.js) */const sh=bones.RightArm.getWorldPosition(V());const d=V(h.x-sh.x,0,h.z-sh.z);const L=d.length();
      const R0=armLen*.9+PALM-.03,dy=sh.y-.36-h.y,ovr=clamp(Math.sqrt(Math.max(0,R0*R0-dy*dy))-.03,OVR,.6);/* as near as the crouched arm needs, no nearer */if(L>ovr){d.normalize();const CL=window.__collide;let mv=Math.min(.35,L-ovr);/* not closer: the lowered door comes out to his shins */const p=root.position;while(mv>.03){const x=p.x+d.x*mv,z=p.z+d.z*mv;if(!CL||!CL.clearance||CL.clearance(x,p.y,z,.17)<.005)break;mv-=.03;}
       if(mv>.03){H.slide={x:d.x*mv,z:d.z*mv,yaw:0,k:0,d:Math.max(.35,mv/.5)};a.stepIn=V(d.x*mv,0,d.z*mv);play('30',{fade:.25,speed:.9});}}}if(H.slide&&H.slide.k<1){a.t=0;return;}if(H.cur===actions['30'])play(IDLE(),{fade:.35});/* the step in done: no walk clip left running under the squat */
     if(a.sqd2===undefined)a.sqd2=Math.min(a.stepIn?.36:1,Math.max(sqFor(h),sqFor(mouth())*.8));/* GRAB: stepped in, the handle is nearer: a shallower crouch (at .45 the code squat bent the foot 87 deg) */sqTo(a.sqd2,dt);a.ik=[['Right',h,smooth(.2,.8,a.t)]];
     if(a.t>.85&&palmTo('Right',h)<.04||a.t>1.6){a.step='open';a.t=0;AU('ovenDoor',h);}return;}
    if(a.step==='open'){// the door goes down only with the hand on it
     {const o0=o.open;o.setOpen(Math.min(.62,o.open+dt/.9));/* GRAB: ~70% down: past that the handle leaves his reach and he could not shut it by hand */a.ost=o.open>o0?0:(a.ost||0)+dt;}const h=o.handle(V());H.look=mouth();H.lookW=.9;a.ik=[['Right',h,1]];if(G())G().hold('Right',o.door,()=>o.handle(V()));
     if(a.ost>.5&&o.open>.3){a.step='let';a.t=0;if(G())G().free(o.door);return;}/* GRAB: lowered as far as his hand takes it */if(o.open>.3&&Math.hypot(h.x-root.position.x,h.z-root.position.z)<.34){a.step='let';a.t=0;if(G())G().free(o.door);return;}/* GRAB: down far enough to feed it, before its edge comes to his shins */if(a.ost>2.5){if(G())G().free(o.door);a.step='up';a.t=0;return;}/* the hand never got there: he leaves it */
     if(o.open>=.62-1e-3){a.step='let';a.t=0;if(G())G().free(o.door);}return;}
    if(a.step==='let'){const h=o.handle(V());a.ik=[['Right',h,1-smooth(0,.3,a.t)]];if(a.t>.3){a.step='log';a.t=0;a.li=0;}return;}
    if(a.step==='log'){// one log: from the left arm into the fire
     const L=logs[a.li];if(!L){a.step='shut';a.t=0;a.ik=[['Right',(a.pf||mouth()).clone(),1]];/* no frame without the hand's target (it fell to the clip pose for one frame: 24 cm) */return;}const src=L.parent===bones.RightHand?null:L.getWorldPosition(V());const m=mouth();H.look=m;H.lookW=1;
     /* the hand travels: log -> fire -> next log, the target carried along a path (a full-weight target switch threw the hand 25 cm and his head 16 cm in one frame) */
     {const ar=arm();if(G()&&ar){if(L.parent!==bones.RightHand)G().hold('Right',ar,()=>L.getWorldPosition(V()));else G().free(ar);}}/* GRAB: the hand goes into the armful for a log: collide pushing it back out of the other logs made it stop and go (jitter 10) */
     if(!a.lt){const tg=src||m;a.ik=a.li>0&&a.pf?[['Right',a.pf.clone().lerp(tg,smooth(0,.45,a.t)),1]]:[['Right',tg,smooth(0,.45,a.t)]];if(a.t>.5){a.p0=tg.clone();bones.RightHand.attach(L);a.lt=1;a.t=0;}}
     else{const tg=(a.p0||m).clone().lerp(m,smooth(0,.4,a.t));a.ik=[['Right',tg,1]];if(a.t>.55&&a.lt===1){a.lt=2;L.visible=false;AU('stoke',m);}if(a.t>.8){a.pf=m.clone();a.lt=0;a.t=0;a.li++;}}
     return;}
    if(a.step==='shut'&&!a.arF){a.arF=1;const ar=arm();if(G()&&ar)G().free(ar);}
    if(a.step==='shut'){const h=o.handle(V());H.look=h;H.lookW=1;if(a.sh&&a.stepIn&&o.open<.35){/* GRAB: the door coming up toward his chest: he eases back off the step in (gate f19921: chest into the oven top) */a.sbt=(a.sbt||0)+dt;const k=Math.max(0,smooth(0,1.1,a.sbt)-(a.sbk||0));/* eased, not a constant speed from rest (head jump 15) */root.position.addScaledVector(a.stepIn,-k);a.sbk=(a.sbk||0)+k;if(a.sbk>=.999)a.stepIn=null;}if(!a.sh){a.ik=[['Right',a.pf?a.pf.clone().lerp(h,smooth(0,.4,a.t)):h,a.pf?1:smooth(0,.4,a.t)]];if(a.t>.2&&G())G().hold('Right',o.door,()=>o.handle(V()));/* GRAB: a grip as it closes on the handle: collide let go of a hand it had been pushing off the door (fist jump 7) */if(a.t>.45){a.sh=1;a.t=0;}return;}
     {const o1=o.open;o.setOpen(Math.max(0,o.open-dt/.7*smooth(0,.35,a.t)));/* GRAB: the push starts gently (the fist jerked as the door set off at full speed) */a.sst=o.open<o1?0:(a.sst||0)+dt;}a.ik=[['Right',o.handle(V()),1]];if(G())G().hold('Right',o.door,()=>o.handle(V()));
     if(a.sst>2){/* the hand never got onto it: he leaves it (it never shuts by itself) */if(G())G().free(o.door);a.step='up';a.t=0;}
     if(o.open<=0){if(G())G().free(o.door);a.step='up';a.t=0;AU('ovenDoor',h);}return;}
    if(a.step==='up'){const h=o.handle(V());a.ik=[['Right',h,1-smooth(0,.7,a.t)]];sqTo(0,dt,.9);if(a.t>.75&&(H.squat||0)<.01){cleanup();play(IDLE(),{fade:.5});if(a.lvCb){const c=a.lvCb;a.lvCb=null;a.step='done';c();return;}endTask({ok:true});a.step='done';}return;}};
   // while squatting at the oven the armful rests on his left thigh (the left forearm across it), never dangling to the floor
   const lap=()=>{const hp=bones.Hips.getWorldPosition(V());const f=fwd(root.rotation.y);return hp.addScaledVector(f,.36).addScaledVector(rightOf(),-.14).add(V(0,LAPY+(a.lapY||0)*smooth(0,.6,a.lapT||0),0));};
   a.post=dt=>{dt=dt||1/60;{const on=/^(ovsq|open|let|log|shut)$/.test(a.step);a.lw=(a.lw||0)+((on?1:0)-(a.lw||0))*Math.min(1,dt*1.5);lifePre(a,dt,a.lw,{shift:false});/* squatting at the oven: a breath, no weight shift */}/* the gaze glides between the handle, the fire and the logs (a new look target turned head and spine at once: the head jumped 16 cm and the arms with it) */if(H.look){a.lk=a.lk?a.lk.lerp(H.look,1-Math.exp(-6/60)):H.look.clone();H.look=a.lk.clone();}lifeLook(a,dt,a.lw,.04);
    const ik=(a.ik||[]).slice();if(/^(ovsq|open|let|log|shut)$/.test(a.step)&&a.got&&logs.some(l=>l.visible&&l.parent!==bones.RightHand)){ik.unshift(['Left',lap(),a.step==='ovsq'?smooth(0,.6,a.t):1]);a.lapW=1;}
    else if((a.lapW||0)>0){/* the last log gone: the left arm leaves his lap slowly (it dropped 7-15 cm at once) */a.lapW=Math.max(0,a.lapW-1/60/.5);ik.unshift(['Left',lap(),smooth(0,1,a.lapW)]);}
    {const ar=arm();if(ar&&ar.parent===bones.LeftHand&&/^(let|log)$/.test(a.step)&&a.lapW>0){/* GRAB: the thigh still inside the armful lifts the lap rest by that much: only ever up, and slowly (a per-frame loop both ways shook the arm) */const pe=loadPen(ar);a.lapY=a.lapY||0;if(pe>-.015)a.lapY=Math.min(.2,a.lapY+Math.min(pe+.02,dt*.15));a.lapT=1;}}
    {const RL=REACH_LEAN;{const tl=/^(ovsq|open|shut)$/.test(a.step)?1.1:RL;a.rlv=a.rlv==null?RL:a.rlv+(tl-a.rlv)*Math.min(1,dt*3);REACH_LEAN=a.rlv;}/* eased (a switch of the lean bent the spine 12 cm in a frame) *//* GRAB: crouched with the knees against the stove front he leans in from the hips for the handle */for(const [sd,t,w] of ik)if(t&&w>.01)reachGrip(sd,t,Math.min(1,w));REACH_LEAN=RL;}
    /* the armful lies ACROSS his arms (logs left-right, hugged to the belly), not end-on along his line of sight: held that way its far end
       ran back through his shins on the squat at the pile and the walk to the oven (gate: 10-11 cm for 2-3 s). Turned about the fist,
       eased in after the grab */
    {const ar=arm();if(ar&&ar.parent===bones.LeftHand&&/^(pksq|carry|go|approach|ovsq)$/.test(a.step)){a.xw=Math.min(1,(a.xw||0)+1/60/.4);const k=a.xw*a.xw*(3-2*a.xw);
      ar.updateMatrixWorld(true);const q=ar.getWorldQuaternion(new THREE.Quaternion());const L=V(0,0,1).applyQuaternion(q);L.y=0;const r=rightOf();
      if(L.lengthSq()>1e-4){L.normalize();const piv=bones.LeftHand.getWorldPosition(V());if(!a.xD){const c0=new THREE.Box3().setFromObject(ar).getCenter(V()).sub(piv);const hp=bones.Hips.getWorldPosition(V());let bd=1e9;for(const sg of [1,-1]){const D=r.clone().multiplyScalar(sg);const c=c0.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(L,D)).add(piv);const d=Math.hypot(c.x-hp.x,c.z-hp.z);if(d<bd){bd=d;a.xD=sg;}}}/* the way that lays the bundle across his belly, not out past his left hip */
       const D=r.clone().multiplyScalar(a.xD);const full=new THREE.Quaternion().setFromUnitVectors(L,D);const qr=new THREE.Quaternion().slerp(full,k);const wp=ar.getWorldPosition(V()).sub(piv).applyQuaternion(qr).add(piv);const wq=q.clone().premultiply(qr);
       const pq=ar.parent.getWorldQuaternion(new THREE.Quaternion()).invert();ar.position.copy(ar.parent.worldToLocal(wp));ar.quaternion.copy(pq.multiply(wq));ar.updateMatrixWorld(true);}}
     else{a.xw=0;a.xD=0;}}};
   function cleanup(){const ar=arm();try{logs.forEach((l,i)=>{if(ar&&l.parent!==ar)ar.attach(l);if(home[i]){l.position.copy(home[i].p);l.quaternion.copy(home[i].q);l.visible=home[i].v;}});P.release('logArmful');}catch(e){}
    try{window.__audio&&window.__audio.carry&&window.__audio.carry(false);}catch(e){}H.carry=null;H.squat=0;H.kSquat=0;kSlow(false);a.ik=[];}
   a.leave=cb=>{const o=OV();/* GRAB: called away with the door down: his hand shuts it first (it used to snap shut by itself) */if(o&&o.open>.01&&/^(open|let|log|shut)$/.test(a.step)&&!a.lvCb){a.lvCb=cb;if(a.step!=='shut'){a.step='shut';a.sh=0;a.t=0;}return;}
    cleanup();try{if(o&&o.open>0){if(G())G().free(o.door);o.setOpen(0);}}catch(e){}cb();};return a;},
  dishes:(o)=>dishesAction(o),
  supplies:(o)=>{const pf=pantryFront();/* GRAB: the woodpile and the stove fill the space in front of the shelf, so he stands at its open end (the stove's far side), walked to from the room side (kl_m; from the ladder foot kl_b the straight line went under the leaning ladder, watch R31-1), one step from the end where the can and jar stand, takes one in his right hand, counts over it and puts it back */const sd=pf?V(-pf.z,0,pf.x):null;const spt=()=>{const s=PT('pantry');return s&&sd?s.clone().addScaledVector(sd,.22):s;};return job({pt:spt,node:pf&&N.kl_m?'kl_m':undefined,stand:pf?.3:.66,clip:'hy_count',loop:true,dur:[15,28],tools:pf?[[Math.random()<.5?'supplyCan':'supplyJar','Right']]:[],post:pf?((a,dt)=>{/* GRAB: the tin is held up in front of his chest and turned a little as he counts (the count clip's hand went into the shelf with it); eased in from the take, eased out before he puts it back */const k=smooth(0,.7,a.t)*(1-smooth(a.jdur-.7,a.jdur,a.T));if(k<.001)return;const f=fwd(root.rotation.y),r=V(-f.z,0,f.x),q=Math.sin(a.t*1.3);a.hold=root.position.clone().addScaledVector(f,.27).addScaledVector(r,.07+.02*q).add(V(0,.98+.015*Math.sin(a.t*.9),0));reachGripN('Right',a.hold,k,0);}):null,look:pf?(a=>a.hold&&a.t>.4?a.hold:spt()):null,faceYaw:pf?Math.atan2(-pf.x,-pf.z):null,via:pf?(s=>s.clone().addScaledVector(pf,.35).addScaledVector(sd,.5)):null});},/* WATCH R27-3: in front of the shelf facing it (he came at it from the side and counted the jars at his left hip) */
  tea:MAKE.tea,
  // workshop
  saw:(o)=>job({pt:()=>PT('bench'),stand:.45,clip:'hy_saw',loop:true,dur:[20,40],tools:[['plankSaw','Right']],tick:(a,dt)=>{a.ct=(a.ct||0)+dt;if(a.ct>.8){a.ct=0;AU('saw',PT('bench'));}}}),
  hammer:(o)=>MAKE.craft(o),
  sharpen:(o)=>job({pt:()=>PT('whetstone'),stand:.42,clip:'hy_sharpen',loop:true,dur:[18,30],tools:[['knife','Right']],tick:(a,dt)=>{a.ct=(a.ct||0)+dt;if(a.ct>1.1){a.ct=0;AU('sharpen',PT('whetstone'));}}}),
  fixlamp:(o)=>job({pt:()=>PT('bench'),stand:.45,clip:'hy_lantern',loop:true,dur:[25,45],tools:[['lantern','Left']],
   start:a=>{const L=window.__lights;try{L&&L.attachHand&&L.attachHand(bones.LeftHand);}catch(e){}},tick:a=>{if(a.step==='work'&&!a.lit&&a.T>2){a.lit=1;try{window.__lights.set('hand',true);}catch(e){}}},
   end:a=>{const L=window.__lights;try{L&&L.set&&L.set('hand',false);L&&L.detachHand&&L.detachHand();}catch(e){}}}),
  // bedroom and anywhere
  stretch:(o)=>MAKE.micro({clip:has('stretch_yawn')?'stretch_yawn':'hy_stretch'}),/* stretch_yawn: real mocap, arms up and out, no step */
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
    a.dPose(dt);{const G2=window.__grab;if(a.dh&&!(a.lapK>0)&&G2&&G2.late)G2.late(()=>a.dPose(0));/* GRAB: the diary stays on the palm after the head turn and collide moved the arm (it lagged 8-13 cm) */}
    if(a.dh&&(a.step==='open'||a.step==='write'||a.step==='think'||a.step==='close')){const k=smooth(0,1,a.lapK||0);
     // left hand on the diary's outer edge, the pencil on the page: a line is ~4 cm of small strokes, then the next line down
     const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const c=DY.position.clone();/* GRAB: the palm carries it from under the diary (as he brought it) to its outer edge on his thighs, never lets go in between (it slid 12 cm off the palm) */a.tL=c.clone().add(V(0,-.03,0)).lerp(c.clone().addScaledVector(r,-.07).add(V(0,.015,0)),k);{const RL=REACH_LEAN;REACH_LEAN=0;try{reachTo('Left',a.tL,1);}finally{REACH_LEAN=RL;}}
     if(a.step==='write'){a.wt=(a.wt||0)+dt;const ln=Math.floor(a.wt/3.2)%5,u=(a.wt%3.2)/3.2;const pt=c.clone().addScaledVector(r,-.02+u*.07+Math.sin(a.wt*19)*.004).addScaledVector(f,.05-ln*.022).add(V(0,.035+Math.max(0,Math.sin(a.wt*9))*.006,0));
      a.pw=Math.min(1,(a.pw||0)+dt/.5);a.tR=pt;const wR=smooth(0,1,a.pw)*k;const PC=P.tools.pencil;if(PC&&PC.parent===bones.RightHand){bones.RightHand.updateMatrixWorld(true);const hw=bones.RightHand.getWorldPosition(V());const Lt=PC.localToWorld(V(.09,.0045,0)).distanceTo(hw);const DW=window.__DW||[.1,.8,.6];const W=pt.clone().addScaledVector(V(0,1,0).multiplyScalar(DW[0]).addScaledVector(f,-DW[1]).addScaledVector(r,DW[2]).normalize(),Lt);armIK('Right',W,sidePole('Right'),wR);bones.RightHand.updateMatrixWorld(true);turnBone(bones.RightHand,PC.localToWorld(V(.09,.0045,0)),pt,wR);}else gripNoLean('Right',pt,wR);/* the fist just over the page, the wrist turned so the pencil TIP is on the line */}
     else{a.pw=Math.max(0,(a.pw||0)-dt/.6);if(a.pw>.01)gripNoLean('Right',c.clone().addScaledVector(r,.04).add(V(0,.06,0)),smooth(0,1,a.pw)*k);}}};
   // cut short (an urgent need): he still puts the diary and pencil back on the table by hand first, never teleports them home
   a.leave=cb=>{if(!a.dh){if(a.got){relTool('Right','pencil');a.got=0;}if(H.seated){standUp(N.chair,cb);return;}cb();return;}a.after=cb;
    if(a.step==='take'||a.step==='at'||a.step==='turn'){a.step='put';a.t=0;return;}if(a.step==='put'||a.step==='back'||a.step==='up'||a.step==='close')return;
    if(a.step==='open'||a.step==='write'||a.step==='think'){a.step='close';a.t=0;return;}
    a.step='back';H.then=null;toTable(()=>{a.step='put';a.t=0;play(IDLE(),{fade:.4});});};return a;},
  sweep:(o)=>job({pt:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),1).add(V(0,.1,0)),stand:.9,clip:'hy_sweep',loop:true,dur:[15,28],tools:[['broom','Right']],
   tick:(a,dt)=>{// shuffles slowly across the floor while sweeping, turning back at walls
    if(a.pause)return;
    if(!a.spotDone){/* GRAB: with the broom in hand, first out into open floor (roomy), facing the way he goes, away from the furniture.
       A far spot (over .5 m) he walks to with the walk clip, not shuffling in the sweep clip; on the way he steers off the furniture boxes
       (gate: his right hand brushed the bunk on the long walk out) */const p=root.position;
     if(!a.spot){a.spot=sweepSpot();a.spT=0;a.spL=Math.hypot(a.spot.x-p.x,a.spot.z-p.z);if(a.spL>.5&&has('30')){play('30',{fade:.35,speed:.8});a.spW=1;}}
     const d=V(a.spot.x-p.x,0,a.spot.z-p.z);const l=d.length();
     if(l<.04||(a.spT+=dt)>a.spL/.25+2){a.spotDone=true;if(a.spW){a.spW=0;play('hy_sweep',{fade:.45,speed:o.speed||1});}}
     else{const n=d.clone().divideScalar(l),sd=V(n.z,0,-n.x);const g=hardPen(p.x+sd.x*.06,p.y,p.z+sd.z*.06,.35)-hardPen(p.x-sd.x*.06,p.y,p.z-sd.z*.06,.35);if(Math.abs(g)>1e-4&&l>.3)n.addScaledVector(sd,-Math.sign(g)*.5).normalize();
      const yT=Math.atan2(n.x,n.z);root.rotation.y+=clamp(wrapA(yT-root.rotation.y),-2.2*dt,2.2*dt);H.face=root.rotation.y;H.lookW=.3;
      const v=a.spW?Math.min(.55,.12+l*1.2):.3;if(Math.abs(wrapA(yT-root.rotation.y))<.6)p.addScaledVector(n,Math.min(l,v*dt));return;}}
    const p=root.position;const free=(ry,head)=>{const f=fwd(ry);const q=p.clone().addScaledVector(f,.25);pushOut(q);const y=floorAt(q.x,p.y+.2,q.z,.3,.5);
    /* GRAB: he stoops over the broom, so his head and the bristles are ~0.7 m ahead of his feet: keep that much clear of furniture too */const blocked=[.35,.55,.75].some(k=>{const x=p.x+f.x*k,z=p.z+f.z*k;return OBST.some(o=>Math.abs(o.y-p.y)<.6&&x>o.x0-.12&&x<o.x1+.12&&z>o.z0-.12&&z<o.z1+.12);});
    /* GRAB: and by the real furniture/wall shapes (collide.js): shoulders and hips 25 cm round the next step, the stooped head ~0.5 m ahead
       (corner post by the door, the bunk's rails); only a step that gets him deeper in is refused, so a tight spot never locks him */
    const CL=window.__collide;let blk2=false;if(CL&&CL.clearance){const c0=CL.clearance(p.x,p.y,p.z,.25),c1=CL.clearance(p.x+f.x*.15,p.y,p.z+f.z*.15,.25),c2=CL.clearance(p.x+f.x*.5,p.y,p.z+f.z*.5,.12);blk2=c1>Math.max(.01,c0+.003)||c2>.02;if(head&&!blk2&&CL.depthAt&&bones.Head){/* the stooped head itself, a hand ahead (the bunk's upper rail) */const hd=bones.Head.getWorldPosition(V());for(const k of [.08,.16])if(CL.depthAt(hd.x+f.x*k,hd.y,hd.z+f.z*k)>.005){blk2=true;break;}}}/* beds and seats too (pushOut lets him sit on those) */
    /* GRAB: the bunk's end and ladder post, the door leaf (open or shut; collide.js has neither): no step deeper into them, nothing in the stooped head/bristle line ~.6 ahead */
    if(!blk2){const h0=hardPen(p.x,p.y,p.z,.25),h1=hardPen(p.x+f.x*.25,p.y,p.z+f.z*.25,.25),hh=hardPen(p.x+f.x*.6,p.y,p.z+f.z*.6,.1);blk2=h1>h0+.003||hh>0;}
    /* GRAB: he sweeps the room he is in: never out through the door onto the ledge (broom in the air at the threshold, turning at the deck edge); past the box edge he may still step back in */
    const out=bedOver(p,p.x+f.x*.25,p.z+f.z*.25)>bedOver(p,p.x,p.z)+1e-4;
    return !(blocked||blk2||out||y==null||Math.abs(y-p.y)>.1||q.distanceTo(p.clone().addScaledVector(f,.25))>.02);};
    /* GRAB: blocked ahead: he turns (slowly, the head with the chest) the shorter way to the nearest free heading; with none free he sweeps on the spot
       instead of spinning round and round (watch: 20 s of turning in place between the table, the chair and the bunk) */
    /* GRAB (gate: head jerks of 11-15 cm/frame² while sweeping): walking and turning start and stop eased, never at full speed at once;
       the stooped head is ~.5 m from his axis, so a sudden turn whips it */
    let vT=0,wT=0;
    if(a.toY==null&&free(root.rotation.y,true))vT=.22;
    else{if(a.toY==null&&Math.abs(a.v||0)<.03){a.toY=false;for(let k=1;k<=8&&a.toY===false;k++)for(const sg of [1,-1]){const ry=root.rotation.y+sg*k*Math.PI/8;if(free(ry,false)){a.toY=ry;break;}}}
     if(a.toY===false){a.reT=(a.reT||0)+dt;if(a.reT>2.5){a.reT=0;a.toY=null;}}
     else if(a.toY!=null){const dA=a.toY-root.rotation.y;wT=Math.sign(dA)*Math.min(Math.PI*.5,Math.sqrt(2*2.5*Math.abs(dA)));if(Math.abs(dA)<.02&&Math.abs(a.w||0)<.15){a.toY=null;wT=0;}}}
    a.v=(a.v||0)+clamp(vT-(a.v||0),-.6*dt,.5*dt);a.w=(a.w||0)+clamp(wT-(a.w||0),-3*dt,3*dt);
    if(a.v>1e-4)p.addScaledVector(fwd(root.rotation.y),a.v*dt);if(Math.abs(a.w)>1e-4){root.rotation.y+=a.w*dt;H.face=root.rotation.y;H.lookW=.25;}
    a.ct=(a.ct||0)+dt;if(a.ct>1.2){a.ct=0;AU('sweep',p);}},look:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),.8)}),
  water:(o)=>job({pt:()=>PT('plant'),stand:.45,clip:'hy_water',reachT:1.6,reAim:true,restand:()=>PT('plant').add(V(-.3,0,.25))/* front left of the plant (it stands by the side wall at the table's corner): the pouring hand clear of the wall boards */,reps:Math.random()<.5?1:2,faceTool:true,/* the job lasts the pour(s): with dur 5-6 s the 3 s clip ended and he stood 2-3 s frozen, can in hand, before putting it back (frames) */tools:[['wateringCan','Right']]}),
  listen:(o)=>{
   // LEISURE (phone watch 2e3a58e: he stood 50 s in the middle of the workshop facing the viewer with the window at his back, and the
   // cupped hand read as a wave): he goes to a real glazed window of the room he is in (index.html win(): centre, inward normal),
   // stands close, faces the glass, rests a hand on the frame, leans in, turns an ear to the pane, holds still, shifts his weight
   const XL=lv.XL||0,XR=lv.XR||0;const G=(x,y,z,nx,nz,lo)=>({c:V(x+(x<0?XL:XR),y,z),n:V(nx,0,nz),lo});
   const GL=[G(-2.33,KT+1.5,1.04,0,1,KT+1.15),G(-4.37,KT+1.38,2.7,1,0,KT+1.0),G(-4.17,BD+1.2,2.4,1,0,BD+.8),G(3.575,WS+1.4,1.24,0,1,WS+1.05),G(4.57,WS+1.25,2.85,-1,0,WS+.85)];
   const here=GL.filter(g=>Math.abs(g.c.y-1.3-root.position.y)<1.2);const ok=g=>{const q=g.c.clone().addScaledVector(g.n,.5);q.y=g.c.y-1.3;const t=q.clone();pushOut(t);return t.distanceTo(q)<.12&&floorAt(q.x,q.y+.3,q.z,.3,.6)!=null&&!['kh_t','bl_t','ll_t','kh_b','kl_b','ll_b'].some(k=>N[k]&&Math.hypot(N[k].p.x-q.x,N[k].p.z-q.z)<.75&&Math.abs(N[k].p.y-q.y)<.6);};/* never the spot at a ladder's head or foot (gate: off the kitchen ladder he stopped dead at the window right there, 0.48 -> 0.08 m/s; and he would stand in the way of the ladder) */
   const gl=pick(here.filter(ok))||pick(GL.filter(ok));const wn=gl?(nearNode(gl.c.clone().addScaledVector(gl.n,.6).setY(gl.c.y-1.3))||pick(WINDOWS)):pick(WINDOWS);
   if(!gl){const fw=()=>fwd(N[wn].face??0);return job({node:wn,slide:false,clip:IDLE(),loop:true,dur:[10,16],look:()=>bones.Head.getWorldPosition(V()).addScaledVector(fw(),3),lookW:.8});}
   /* listen_window (clip supplier, 7.8 s): leans in, ear to the glass, holds with weight shifts, eases out; the code then only adds the hand on the sill */
   const GZ=!!(o&&o.gaze);const LW=!GZ&&has('listen_window');
   return job({node:wn,pt:()=>gl.c.clone().setY(root.position.y),stand:.42,faceYaw:Math.atan2(-gl.n.x,-gl.n.z),clip:LW?'listen_window':IDLE(),loop:!LW,dur:LW?null:GZ?[10,18]:[14,24],reps:LW?(Math.random()<.5?1:2):1,vary:false,
    start:a=>{a.side=Math.random()<.5?1:-1;a.ph=0;a.pt=rnd(2,3.5);a.hw=0;a.ws=rnd(4,7);a.shw=.5;a.sh=1;},
    // through the glass at the dark; with the ear turned the gaze drops and goes past the pane
    look:a=>{const r=V(-gl.n.z,0,gl.n.x);if(GZ)return gl.c.clone().addScaledVector(gl.n,-4).addScaledVector(r,Math.sin(a.T*.35+1)*2.2).add(V(0,-.3+Math.sin(a.T*.21)*.3,0));const k=a.ear||0;return gl.c.clone().addScaledVector(gl.n,-3).addScaledVector(r,a.side*2.4*k).add(V(0,-.2-.3*k,0));},lookW:LW?0:.9,
    tick:(a,dt)=>{a.pt-=dt;if(a.pt<0){a.ph^=1;a.pt=a.ph?rnd(3.5,6):rnd(2.5,4);if(a.ph&&Math.random()<.4)a.side=-a.side;}
     a.ear=GZ?0:clamp((a.ear||0)+(a.ph?dt/1.1:-dt/1.1),0,1);a.hw=clamp(a.hw+(a.T>1.2&&a.T<(a.jdur||99)-1.2?dt/.8:-dt/.6),0,1);
     a.ws-=dt;if(a.ws<0){a.ws=rnd(5,8);a.sh=(a.sh?0:1);}a.shw=clamp((a.shw||0)+((a.sh?1:0)-(a.shw||0))*Math.min(1,dt*1.2),0,1);},
    post:(a,dt)=>{const f=V(-gl.n.x,0,-gl.n.z),ax=V(0,1,0).cross(f).normalize();if(!LW){const lean=(.05+.07*smooth(0,1,a.ear||0))*smooth(0,1,a.hw);rotW(bones.Spine1,ax,lean);rotW(bones.Spine2,ax,lean*.6);
     /* weight shift: the hips sway a little toward one foot and back (no clip needed) */rotW(bones.Spine,f,((a.shw??.5)-.5)*.05);}
     const w=smooth(0,1,a.hw);if(w>.01){const s=a.side>0?'Left':'Right';/* the hand AWAY from the turned ear rests on the sill (the bottom rail of the frame; the curtains hang at the sides) */
      const r=V(-gl.n.z,0,gl.n.x);const t=gl.c.clone().addScaledVector(r,-a.side*.16).addScaledVector(gl.n,window.__LWN??.08);t.y=gl.lo+(window.__LWY??.08);
      const put=()=>gripNoLean(s,t,w);put();const GG=window.__grab;if(GG&&GG.late)GG.late(put);}}});},
  bolt:(o)=>{const P=window.__props||P3;const D=P&&P.door;const to=o&&o.lock===false?0:1;const OPEN=.85;/* {lock:false,open:true} (morning): bolt drawn, then the leaf swung open by hand to here (critic W6: he walked through the shut leaf). .85, not 1: past that the leaf would sweep through the spot he pulls it from */const wantOpen=!!(o&&o.open&&to===0);
   // GRAB DOOR: the door and its bolt move only under his palm (grab.js door hand + props door.hand). The open door sweeps a
   // quarter circle (0.77 m) round its hinge, so he walks round just outside that sweep, a little ahead of the leaf, his palm
   // on it, and ends beside the shut door at the bolt. Spots in the door's frame: hinge + r * (-cos th, 0, sin th), th = open * 1.66.
   const spot=(th,r)=>{const w=D.width||.77;return D.obj.localToWorld(V(w/2-Math.cos(th)*r,0,Math.sin(th)*r));};
   const want=()=>{const th=D.open*1.66;return spot(Math.min(th+.4,1.5),.8+.13*smooth(0,.6,th));};
   /* GRAB (watch r10: coming in with the door ~30 deg open he walked straight to the closing spot behind the leaf, through it: hips 23 cm
      inside): on the leaf's front side he first steps out to 1.1 m from the hinge (past the leaf's tip with his body), then round that
      circle to behind the leaf, and only then to the closing spot. Polar spots in the door's frame as above. */
   const polar=p=>{const l=D.obj.worldToLocal(p.clone());const w=D.width||.77;const x=w/2-l.x;return [Math.atan2(l.z,x),Math.hypot(x,l.z)];};
   const route=(p,q)=>{if(D.open<=.02)return q;const thL=D.open*1.66,[thW]=polar(q),[thP,rP]=polar(p);if(thW<=thL||thP>thL+.12)return q;
    if(rP<1.03)return spot(Math.min(Math.max(thP,.12),Math.max(.12,thL-.12)),1.1);return spot(Math.min(thP+.6,thL+.3),1.1);};
   const follow=(a,dt)=>{const p=root.position,q=route(p,want());const dx=q.x-p.x,dz=q.z-p.z,m=Math.hypot(dx,dz);a.v=Math.min(.75,Math.max(0,(a.v||0)+(m>.03?2:-3)*dt),Math.sqrt(2*2*m));const st=Math.min(m,a.v*dt);/* eased start and stop: no jerk in the feet */if(m>1e-4){p.x+=dx/m*st;p.z+=dz/m*st;}
    const lk=D.open>.02?spot(D.open*1.66,.62):D.boltKnob(V());const yF=Math.atan2(lk.x-p.x,lk.z-p.z);const dy=wrapA(yF-root.rotation.y);root.rotation.y+=Math.sign(dy)*Math.min(Math.abs(dy),2.4*dt);H.face=root.rotation.y;
    const mv=st/dt>.12;if(mv&&!a.walk){a.walk=1;play('30',{fade:.25,speed:.8});}else if(!mv&&a.walk&&m<.03){a.walk=0;play(IDLE(),{fade:.4});}return m;};
   return job({pt:()=>D&&D.boltKnob?D.boltKnob(V()):null,stand:.42,node:'bdoor'/* W7: always from the room side (the knob's nearest node is bdoor2 in the doorway: he walked into the shut leaf to x .55) */,clip:null,dur:[14,14],vary:false,
   look:a=>D.open>.02?spot(D.open*1.66,.62).setY(root.position.y+.95):D.boltKnob(V()),
   start:a=>{a.ds=wantOpen&&D.bolt<1e-3?'open':'shut';a.dt=0;},
   tick:(a,dt)=>{a.dt+=dt;const m=follow(a,dt);
    if(a.ds==='shut'){if(m<.12&&D.target!==0)D.openTo(0);if(D.open<=1e-3&&m<.05){D.openTo(D.open);D.boltTo(to);a.ds='bolt';a.dt=0;}else if(a.dt>11){D.openTo(D.open);a.ds='done';a.dt=0;/* not shut in time: the bolt is never pushed on an open door */}return;}
    if(a.ds==='bolt'){if(Math.abs(D.bolt-to)<1e-3){AU('bolt',D.boltKnob(V()));a.ds=wantOpen?'open':'done';a.dt=0;}else if(a.dt>3){D.boltTo(D.bolt);a.ds='done';a.dt=0;}return;}
    /* the reverse of the shut stage: his palm on the leaf (grab.js doorDrive), he backs round the sweep as it comes toward him; the door moves only under the palm */
    if(a.ds==='open'){if(D.open<OPEN-1e-3){if(D.target!==OPEN&&D.bolt<1e-3)D.openTo(OPEN);if(a.dt>11){D.openTo(D.open);a.ds='done';a.dt=0;}}else{D.openTo(D.open);a.ds='done';a.dt=0;}return;}
    if(a.ds==='done'&&a.dt>.6)a.T=1e3;}});},
  radio:(o)=>{const P=window.__props||P3;const R=P&&P.radio;if(!R||!R.knob)return job({pt:()=>PT('radio'),stand:.45,clip:'hy_radio',loop:true,dur:[30,60]});
   // LEISURE: the radio sits low on the crate by the bed. He bends his knees to it, switches it on and turns the dial with his
   // right hand ON the knob (it only turns while the fingers are there), straightens up and listens, now and then bends again
   // to retune, and switches it off by hand before he goes (QA: the dial turned while his palms were 60-100 cm away)
   const D=rnd(30,60);const kn=()=>R.knob(V());
   const reachK=(a,dt,on)=>{a.kw=clamp((a.kw||0)+(on?dt/.6:-dt/.5),0,1);const k=kn();const kh=k.y-root.position.y;if(on&&!a.sq&&kh<.8&&has('cm_squat')){a.sq=1;play('cm_squat',{fade:.55});}else if(!on&&a.sq&&a.kw<.35){a.sq=0;play(IDLE(),{fade:.6});}/* a real crouch (CMU squat) to the low crate, not a stoop */
    {const o3=R.obj;const ff=fwd(o3.rotation.y);a.kp=k.clone().addScaledVector(ff,+(window.__RKO??.03));}/* the fingertips on the knob, not the grip point in it (gate: hand 4 cm into the set) */const G=window.__grab;return G&&G.gripPoint?G.gripPoint('Right').distanceTo(a.kp)<.06:a.kw>.95;};/* the fingers on the dial (Grab's grip point): gripNoLean in post */
   // the stand spot: half a metre in front of the dial, 30 cm clear of the watering can (QA: the can went through his shins and
   // chest in the crouch; beside the crate he had to fold over 50 deg between it and the bunk); the approach line is aimed so he stops there
   const S0=()=>{const o3=R.obj;const f=fwd(o3.rotation.y),r=V(-f.z,0,f.x);const q=kn().addScaledVector(f,+(window.__RST??.46)).addScaledVector(r,.05);q.y=root.position.y;return q;};/* square in front of the dial, in the 47 cm gap between the bunk end (x -1.15) and the watering can (gate: at +12 cm right the squat hit the bunk, at -6 cm the can) */
   const PTr=()=>{const S=S0();const nn=nearNode(S);const from=nn&&N[nn]?N[nn].p:root.position;const u=V(S.x-from.x,0,S.z-from.z);if(u.lengthSq()<1e-4)u.set(0,0,1);u.normalize();return S.clone().addScaledVector(u,.3).setY(kn().y);};
   // LEISURE (phone watch 7914e3f: 30 s crouched behind the chair, then standing with his back to the room and no radio in sight):
   // he tunes it in at the crate, then sits back in the chair by the table with the radio in view to listen (the bunk edge forces
   // a hunch under the upper bed), and goes back to switch it off
   const BED=!!(N.chair&&N.chair_app)&&!(o&&o.nobed);const ahead=()=>root.position.clone().addScaledVector(fwd(root.rotation.y),3).add(V(0,.9,0));
   const gap=()=>{const q=S0();q.x=(-1.15+N.chair.p.x-.25)/2;q.z+=.42;return q;};/* between the bunk end and the chair, a step back from the crate */
   const bedPh=(a,dt)=>{const T=a.T;if(!BED)return false;a.bs=a.bs||0;
    if(a.bs===0){if(T>7.5&&R.on&&!a.sq&&(a.sqw||0)<.05&&(a.kw||0)<.05&&T<a.jdur-25){a.bs=1;a.pin=null;a.lis=clamp(a.jdur-T-22,10,60);/* first a step straight back from the crate (the direct line to the chair crossed the watering can) */approachTo(a,gap(),0,()=>{a.step='work';goTo('chair_app',()=>{a.bs=2;sitDown(N.chair,()=>{a.bs=3;a.st=0;play(has('seated_listen')?'seated_listen':SITIDLE,{fade:.8});AU('sigh');});});});return true;}return false;}
    if(a.bs===3){a.st+=dt;if(a.st>a.lis){a.bs=4;standUp(N.chair,()=>{a.bs=5;/* back the way he came: through the gap between the bunk end and the chair, clear of the watering can */approachTo(a,gap(),0,()=>approachTo(a,S0(),0,()=>{a.step='work';a.bs=6;a.T=Math.max(a.T,a.jdur-3.4);a.pin=null;}));});}return true;}
    return a.bs<6;};
   return job({pt:PTr,stand:.3,loop:true,dur:BED?[D+30,D+30]:[D,D],vary:false,look:a=>a.bs>0&&a.bs<6&&a.bs!==3?ahead():kn(),lookW:.9,
    tick:(a,dt)=>{if(bedPh(a,dt))return;const T=a.T;{const p=root.position;if(!a.pin)a.pin=p.clone();else if(a.sq||a.sqw>0){p.x=a.pin.x;p.z=a.pin.z;}}/* he stays on his spot in the crouch (gate: contact pushes walked him 30 cm into the can and the bunk end) */{const k=kn(),p=root.position;const y=Math.atan2(k.x-p.x,k.z-p.z);const d=wrapA(y-root.rotation.y);root.rotation.y+=Math.sign(d)*Math.min(Math.abs(d),2.4*dt);H.face=root.rotation.y;}/* square up to the radio */let want=T<6.5&&T>.4;// tune on arrival
     if(!want&&!(o&&o.keepOn)&&T>(a.jdur||D)-3)want=true;// switch off before leaving
     if(!want){a.rt=(a.rt??rnd(14,24))-dt;if(a.rt<0){a.rr=(a.rr||0)+dt;want=true;if(a.rr>3.2){a.rt=rnd(14,24);a.rr=0;a.t0=null;}}}
     const touch=reachK(a,dt,want);a.sqw=clamp((a.sqw||0)+(a.sq?dt/.6:-dt/.6),0,1);H.squat=+(window.__RSQ??.15)*smooth(0,1,a.sqw);/* hips down into a real crouch, the feet stay on the boards (post) */
     if(touch){if(T<6.5){if(!R.on)R.setOn(1);a.tn=.3+.4*smooth(1,6,T);R.setTune(a.tn);}
      else if(T>(a.jdur||D)-3){if(R.on&&!(o&&o.keepOn))R.setOn(0);}
      else if(a.rr>.5){a.t0=a.t0??(a.tn??.7);R.setTune(clamp(a.t0+Math.sin((a.rr-.5)*1.4)*.05,0,1));}}},
    post:(a,dt)=>{const sw=smooth(0,1,a.sqw||0);if(sw>.01){if(H.floorY!=null)legPlant(H.floorY,dt,sw);/* QA: in the CMU squat both soles hung 12-20 cm over the boards */
      const f=fwd(root.rotation.y),ax=V(0,1,0).cross(f).normalize();rotW(bones.Spine,ax,-(window.__RB1??.65)*sw);rotW(bones.Spine1,ax,-(window.__RB2??.4)*sw);/* a crouch, not a 60 deg stoop: the lowered hips take the height, the back straightens */}
     if(a.kp&&a.kw>.01){gripNoLean('Right',a.kp,smooth(0,1,a.kw));const G=window.__grab;if(G&&G.late){const k=a.kp,w=smooth(0,1,a.kw);G.late(()=>gripNoLean('Right',k,w));}}},
    end:a=>{a.ik=null;H.squat=0;legPlantOff();if(a.sq){a.sq=0;play(IDLE(),{fade:.5});}}});},
  telescope:(o)=>{const T=teleParts();if(T)window.__tele=T;if(!T)return job({pt:telePt,stand:.5,clip:'hy_telescope',loop:true,dur:[40,90],start:()=>AU('sigh')});
   // LEISURE + GRAB: at the real telescope, not mimed in the air a metre away: he stands behind the eyepiece facing along the tube,
   // the calm standing mocap (cm_tele, CMU 77_02 legs + hands held up at the face) is the base, the spine stoops until his eye is
   // at the eyepiece, the left hand cups the tube under the eyepiece, the right rests on top of the tube; now and then he swings it a little
   return job({pt:()=>teleStand(T),via:st=>{/* from straight behind the eyepiece: he came in across the front of the tube and his face passed right at the eyepiece (hero watch R38-2); the point behind is on the boards and clear of posts */{const d=T.dir(),dh=V(d.x,0,d.z).normalize(),C=window.__collide;for(const k of [.55,.45,.35]){const q=st.clone().addScaledVector(dh,-k);if(floorAt(q.x,st.y+.3,q.z,.3,.6)==null)continue;if(C&&C.depthAt&&[.3,.75,.9].some(h=>[[0,0],[.3,0],[-.3,0],[0,.3],[0,-.3],[.21,.21],[-.21,.21],[.21,-.21],[-.21,-.21]].some(([ox,oz])=>C.depthAt(q.x+ox,st.y+h,q.z+oz)>.005)))continue;/* a body's width clear: his swinging hand hit the rail beyond it */return q;}}const n=N.deck;if(!n||st.distanceTo(V(n.p.x,st.y,n.p.z))<.9)return null;const u=V(n.p.x-st.x,0,n.p.z-st.z).normalize();return st.clone().addScaledVector(u,.3);},viaFace:()=>{const d=T.dir();return Math.atan2(d.x,d.z);}/* the last 30 cm is a side-step that turns him to the tube on the way: no turn on the spot between the rail posts */,stand:.05,clip:IDLE()/* hips over the feet; cm_tele pushed the pelvis 10 cm ahead of the feet (a plank leaning back) */,loop:true,dur:[40,90],vary:false,start:a=>{AU('sigh');a.pan0=T.yoke.rotation.y;},
    look:a=>{const E=T.eye();const d=T.dir();return E.addScaledVector(d,6);},lookW:1,
    post:(a,dt)=>telePost(a,dt,T),end:a=>{H.squat=0;H.sqJob=false;a.sq=0;play(IDLE(),{fade:.6});try{window.__grab.free(T.tube);}catch(e){}}});},
  look:(o)=>{// LEISURE: out on the deck he goes up to the railing, rests both hands on the top rail and leans on it a little, looking
   // out over the forest (the head sweeps slowly, now and then down at the ground); every so often he straightens up, hands off
   // the rail, and then leans on it again (frame check: he stood in the middle of the deck with his arms hanging for a minute)
   const n=N.deck;const rayD=(x,y,z,dx,dy,dz,len)=>{const r=new RAPIER.Ray({x,y,z},{x:dx,y:dy,z:dz});const h=world.castRay(r,len,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});return h?(h.toi??h.timeOfImpact):null;};const rail=(()=>{if(!n)return null;const f=fwd(n.face??0);/* scan forward with downward rays for the top rail (a thin cap: level rays slip under or over it) */for(let d=.2;d<1.5;d+=.025){const x=n.p.x+f.x*d,z=n.p.z+f.z*d;const dn=rayD(x,n.p.y+1.5,z,0,-1,0,1.6);if(dn==null)continue;const top=1.5-dn;if(top>.75&&top<1.25){const p0=V(x+f.x*.02,n.p.y+top,z+f.z*.02);/* gate: the first spot was right at a rail post (hands and a foot in it): slide along the rail to a bay
     with no post across his body (feet to shoulders, a shoulder width either side) */const C=window.__collide,r=V(-f.z,0,f.x);const post=q=>{if(!C||!C.depthAt)return false;for(const sd of [-.28,-.14,0,.14,.28])for(const h of [.08,.4,.75])for(const o of [-.06,-.2]){const b=q.clone().addScaledVector(r,sd).addScaledVector(f,o);if(C.depthAt(b.x,n.p.y+h,b.z)>.005)return true;}return false;};
     for(const sd of [0,.1,-.1,.2,-.2,.3,-.3,.4,-.4,.5,-.5,.6,-.6]){const q=p0.clone().addScaledVector(r,sd);if(!post(q)&&floorAt(q.x-f.x*.35,n.p.y+.3,q.z-f.z*.35,.3,.6)!=null)return {p:q,f};}return {p:p0,f};}}return null;})();
   const sweep=a=>root.position.clone().add(V(Math.sin(a.T*.22)*6,1.2+Math.sin(a.T*.13)*.6-(a.dwn||0)*1.4,8));
   if(!rail)return job({node:'deck',slide:false,dur:[40,80],look:sweep});
   /* rail_lean / rail_lean_b (clip supplier): forearms on a ~1.0 m rail, weight on one leg, slow looks; with them the code adds no lean or hand IK */
   const RL=['rail_lean','rail_lean_b'].filter(has);const RLn=RL.length?RL:null;
   return job({pt:()=>rail.p.clone(),stand:RLn?.40:.27,dur:[40,80],vary:false,clip:RLn?pick(RLn):IDLE(),loop:true,
    start:a=>{a.on=1;a.nx=rnd(12,20);},
    look:a=>{const f=rail.f;const hd=bones.Head.getWorldPosition(V());return hd.addScaledVector(f,8).add(V(Math.sin(a.T*.21)*5,-.3+Math.sin(a.T*.13)*.4-(a.dwn||0)*3,0));},lookW:.85,
    tick:(a,dt)=>{H.face=Math.atan2(rail.f.x,rail.f.z);root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*3);{/* in to the rail, belly a hand's width off it (the obstacle box kept him an arm's length back: hands in the air over it) */const gap=rail.p.clone().sub(root.position).dot(rail.f)-(RLn?.40:.31);const st=clamp(gap,-.2*dt,.2*dt)*(a.on?1:0);if(Math.abs(st)>1e-5)root.position.addScaledVector(rail.f,st);}a.nx-=dt;if(a.nx<0){a.on^=1;a.nx=a.on?rnd(12,20):rnd(3,6);if(RLn)play(a.on?pick(RLn):IDLE(),{fade:.8});}
     a.hw=clamp((a.hw||0)+(a.on?dt/.8:-dt/.7),0,1);a.dwn=Math.max(0,Math.sin(a.T*.09)-.75)*4;},
    post:(a,dt)=>{const w0=smooth(0,1,a.hw||0);
     if(RLn&&!window.__noRailKnees){let rw=0;if(!window.__railKFull){for(const n of RLn){const ac=actions[n];if(ac&&ac.isRunning())rw=Math.max(rw,ac.getEffectiveWeight());}}else rw=1;if(rw>.001)railKnees((window.__railKW??1)*rw);}/* LEISURE: as much as the rail clip is on (at full weight from its first frame the knee jumped 7.6 cm while the clip was still fading in: gate game style) *//* hero watch R38-1: the clip's knees knock together over turned-out feet (a taller body's pose): each knee goes out over its own toes, the feet a little apart, the soles where they are */
     if(RLn){const w=1;/* the clip's forearms rest on a 1.0 m rail of a taller body: the hero's hands came 9 cm into the rail beam (gate); a hand
       that is at or under the rail top is lifted onto it, where it is */const lw0=!a.lw;a.lw=a.lw||{Left:0,Right:0};a.lt=a.lt||{};for(const sd of ['Left','Right']){const h=bones[sd+'Hand'].getWorldPosition(V());const d=rail.p.clone().sub(h).dot(rail.f);const was=a.lw[sd]>.5,m=was?.05:0;const on=h.y<rail.p.y+.1+m&&d<.4+m&&d>-.25-m;/* a band, not a line: on the edge it flapped on and off (v6 hand jump) */if(on)a.lt[sd]=h.clone().addScaledVector(rail.f,d-.05).setY(rail.p.y+.1);a.lw[sd]=lw0?(on?1:0):clamp(a.lw[sd]+((on?1:0)-a.lw[sd]>0?dt/.25:-dt/.35),0,1);}/* the lift fades in and out (it switched off in one frame: the hand fell 5 cm, gate jitter 11 mm on orig) */
       const lift=()=>{for(const sd of ['Left','Right']){const k=smooth(0,1,a.lw[sd]);if(k<.002||!a.lt[sd])continue;/* the wrist on top of the cap, a little on his side of it: the fingers hung down into the 20 cm deep posts under the cap */gripNoLean(sd,a.lt[sd],w*k);}};lift();const G=window.__grab;if(G&&G.late)G.late(lift);return;}const w=w0;if(w<.01)return;const f=rail.f,r=V(-f.z,0,f.x),ax=V(0,1,0).cross(f).normalize();rotW(bones.Spine,ax,.1*w);rotW(bones.Spine1,ax,.06*w);
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
    const tgt=e.p.clone().addScaledVector(e.f,-.06);/* the hips 6 cm in from the edge, not 12: the calves near the knees went 4-6 cm into the landing's rim beam (gate, Collide audit) */let tries=0;/* approachTo moves at most 1.2 m per call: step on until the hips are over the edge (he sat 1 m short on the workshop step) */const near=()=>{const sp=V(tgt.x,0,tgt.z).addScaledVector(e.f,.5);const go=()=>Math.hypot(root.position.x-tgt.x,root.position.z-tgt.z)>.06&&++tries<4;approachTo(a,sp,.5,()=>{if(go())near();else seat();});};const seat=()=>{a.step='sit';a.t=0;H.face=yaw;a.hy0=bones.Hips.getWorldPosition(V()).y;
     H.fit={mode:'hold',base:e.y,y:a.hy0,dangle:true};H.ground=false;AU('sigh');};near();});
   // LEISURE: sitting down is one motion: the hips sink while the legs fold over the edge (the dangle clip fades in from
   // the middle of the descent, never a seated pose in mid-air) and both palms go down onto the boards beside the hips to
   // take the weight and stay there while he sits; getting up is the same backwards.
   const SIT=window.__LSIT??2.4,UP=1.5;const LK0=window.__LK0??.12,LK1=window.__LK1??.95,LW0=window.__LW0??.5;const seatY=()=>a.e.y+SEAT_CLEAR+(window.__LSC??.03);/* LEISURE: 3 cm higher on the rim (collide sweep: calves 2-6 cm into the landing edge board, the hips 1.5 cm into the deck) */
   const palms=w=>{if(w<.01){a.ik=null;return;}const f=a.e.f,r=V(-f.z,0,f.x);const hp=bones.Hips.getWorldPosition(V());
    const G=window.__grab;/* LEISURE (Pavel: real contact): the palms rest ON THE THIGHS, two thirds of the way to the knee. Measured: seated on
       the edge his arms cannot reach the boards beside the hips (the palms hung 10-14 cm over them, one over the drop) */
    const at=(s)=>{const U=bones[s+'UpLeg'],L=bones[s+'Leg'];const hj=U.getWorldPosition(V()),kn=L.getWorldPosition(V());const q=hj.lerp(kn,window.__LTK??.35).add(V(0,window.__LTY??.075,0));if(G&&G.palm){const off=G.palm(s,V()).sub(bones[s+'Hand'].getWorldPosition(V()));q.sub(off);}const rw=a.rw||0;if(s==='Right'&&rw>.01&&!window.__noRim){/* LEISURE (watch R50-1): lowering himself, the right palm is flat on the boards beside the hip and takes the weight, then goes back to the thigh as he settles */const hc=bones.Hips.getWorldPosition(V());const sd=bones.RightUpLeg.getWorldPosition(V()).sub(hc);sd.y=0;sd.normalize();const fh=V(a.e.f.x,0,a.e.f.z).normalize();const rim=hc.clone().addScaledVector(sd,window.__RIMS??.24).addScaledVector(fh,window.__RIMF??-.16);rim.y=a.e.y+(window.__RIMY??.12);{/* only where there are boards under it (never over the drop or into the rim board) */const C=window.__collide;const fy=floorAt(rim.x,a.e.y+.15,rim.z,.3);if(fy==null||Math.abs(fy-a.e.y)>.03||(C&&C.depthAt&&C.depthAt(rim.x,rim.y+.01,rim.z)>0))return q;}if(G&&G.palm){const off=G.palm(s,V()).sub(bones[s+'Hand'].getWorldPosition(V()));rim.sub(off);}q.lerp(rim,rw);}return q;};
    a.pw=w;const wr=Math.max(w,a.rw||0);a.ik=[['Left',at('Left'),w],['Right',at('Right'),wr]];a.at=at;a.wr=wr;};
   // the legs hang over the drop: thighs along the boards to the edge, knees bent, shins down, a lazy swing (watcher P2: the clip held
   // them nearly straight, sticking out forward at knee height)
   const legsHang=w=>{if(w<.01||!a.e)return;const f=V(a.e.f.x,0,a.e.f.z).normalize();const T=a.T||0;
    for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const hp=U.getWorldPosition(V()),kn=L.getWorldPosition(V()),an=F.getWorldPosition(V());
     const th=hp.distanceTo(kn),sh=kn.distanceTo(an);const lat=kn.clone().sub(hp);lat.addScaledVector(f,-lat.dot(f));lat.y=0;if(lat.length()>.12)lat.setLength(.12);
     const dh=window.__noLegDrop?0:clamp((a.hAbove||0)/th,0,.85);/* the hips still above the seat (lowering himself): the thighs slope down over the edge, the feet go down past the rim, never straight out level (watch R50-1) */const K=hp.clone().addScaledVector(f,th*.96*Math.sqrt(1-dh*dh)).add(lat).add(V(0,-(window.__LKY??.04)-th*dh,0));const sw=Math.sin(T*1.25+(s==='Left'?0:2.1))*(window.__LSW??.07);
     const arc=Math.sin(Math.PI*clamp(w,0,1));/* on the way over the edge (sitting down, getting up) the feet swing out and up round the rim board, never through it (gate: feet and shins 6 cm into it) */const A=K.clone().add(V(0,-sh*.97+arc*(window.__LAU??.12),0)).addScaledVector(f,(window.__LAB??.05)+sw+arc*(window.__LAF??.12));ik2(U,L,F,A,f.clone().add(V(0,.3,0)).normalize(),Math.max(w,arc*.9),true);
     {/* a relaxed hanging foot: toes ~30 deg pointed from his standing ankle angle (gate: 55 deg, or flexed up as the clip swung) */const T2=bones[s+'ToeBase'];if(T2){F.updateMatrixWorld(true);const k2=L.getWorldPosition(V()),a2=F.getWorldPosition(V()),t2=T2.getWorldPosition(V());const sd=a2.clone().sub(k2).normalize();const pp=f.clone().addScaledVector(sd,-f.dot(sd));if(pp.lengthSq()>1e-6){pp.normalize();const an=50*Math.PI/180;const d=sd.clone().multiplyScalar(Math.cos(an)).addScaledVector(pp,Math.sin(an));turnBone(F,t2,a2.clone().addScaledVector(d,t2.distanceTo(a2)),w);}}}}};
   a.post=dt=>{if((a.step==='sit'||a.step==='up')&&!window.__noLedgePlant){const pw=1-smooth(0,.25,a.lw||0);if(pw>.01){const lo=H.fit.liftOK;H.fit.liftOK=true;/* only holds them up, never pulls a folding leg back down (that bent the ankle 45 deg in the hand-over) */legPlant(a.e.y,dt,pw);H.fit.liftOK=lo;}}/* the boots stay on the boards while the hips go down (knees bend) until the legs fold over the edge: they sank with the root through the rim board (gate: feet and shins 6 cm into it) */legsHang(a.lw||0);/* the legs first, then the palms on the thighs where the legs now are */if(a.ik&&a.at){const put=()=>{/* the back inside the pose guard's range first: it runs last and straightened a 17 deg over-bent Spine, which lifted both palms 8-20 cm off the thighs */const PG=window.__poseGuard;if(PG&&PG.fit&&!window.__poseOff){for(const n of ['Spine','Spine1','Spine2'])if(bones[n])PG.fit(bones[n]);if(PG.fitSpine)PG.fitSpine();root.updateMatrixWorld(true);}a.ik=[['Left',a.at('Left'),a.pw],['Right',a.at('Right'),a.wr??a.pw]];ikList(a.ik);};put();const G=window.__grab;if(G&&G.late)G.late(put);/* again after the head turn and collide.js have moved the chest */}};
   a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    if(a.step==='sit'){const KA=window.__LKA??.15;const k=KA*smooth(SIT*LK0,SIT*(window.__LKM??.5),a.t)+(1-KA)*smooth(SIT*LW0,SIT*LK1,a.t);/* knees first, soles on the boards, down to about half way (deeper the ankles bent 66-88 deg); the rest as the legs go over the edge */a.rw=smooth(.2,.55,k)*(1-smooth(SIT*.92,SIT+.45,a.t));H.fit.y=lerp(a.hy0,seatY(),k);a.hAbove=H.fit.y-seatY();a.lw=smooth(SIT*LW0,SIT,a.t);if(!a.cl&&a.t>SIT*LW0){a.cl=1;play(has('cm_dangle')?'cm_dangle':'hy_dangle',{fade:SIT*.6});}
     palms(smooth(.1,.55,k)*lerp(1,.85,smooth(SIT,SIT+.5,a.t)));if(a.t>SIT+.5){a.step='work';a.t=0;a.rw=0;a.hAbove=0;}return;}
    if(a.step==='work'){a.T+=dt;a.lw=1;/* palms stay on the thighs (the clip's hands hovered in front of the belly) */palms(.95);H.look=root.position.clone().add(V(Math.sin(a.T*.2)*5,.4+Math.sin(a.T*.11)*.5,0)).addScaledVector(a.e.f,6);H.lookW=.8;
     if(a.T>dur){a.step='up';a.t=0;}return;}
    if(a.step==='up'){const k=smooth(.35,UP+.35,a.t);a.lw=1-smooth(0,.6,k);palms(lerp(.85,1,smooth(0,.35,a.t))*(1-smooth(.75,1,k)));if(!a.cl2&&a.t>.45){a.cl2=1;play(IDLE(),{fade:UP*.7});}
     H.fit.y=lerp(seatY(),a.hy0,k);a.hAbove=H.fit.y-seatY();if(a.t>UP+.4){a.ik=null;H.fit=null;H.ground=true;H.floorY=a.e.y;endTask();}}};
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
 // close (or open) the window shutters one window after another (opts: {close:true|false, windows:['bwin','kwin','wwin']}).
 // GRAB: each room's shutter hangs on a pull cord (index.html SHUT): he walks to the window, his right palm takes the toggle and
 // pulls it down (or lets it up), and the shutter follows his palm on the cord (S.pull). It never moves at a touch by itself.
 MAKE.shutters=(o={})=>{const a={step:'go',t:0,w:0};const close=o.close!==false;const list=(o.windows||WINDOWS).filter(w=>N[w]);
  const S=()=>window.__house&&window.__house.shutters;const ROOM={bwin:'bedroom',kwin:'kitchen',wwin:'workshop'};let room=null,cd=null;
  const want=close?1:0;const kNow=()=>{const s=S();return s&&s.k?s.k[room]??0:0;};
  const next=()=>{a.step='go';a.t=0;a.kt=null;const w=list.shift();const s=S();if(!w||!s||!s.cord){play(IDLE(),{fade:.4});endTask({ok:true,close});return;}
   room=ROOM[w]||w;cd=s.cord(room);if(!cd||Math.abs(kNow()-want)<.01){next();return;}
   const yf=N[w].face??0;const fw=fwd(yf);const sp=cd.toggle(V()).addScaledVector(V(fw.z,0,-fw.x),-.17).addScaledVector(fw,-.34);sp.y=root.position.y;/* he stands 0.34 m behind the toggle, with it in front of his right shoulder (low down the right hand cannot cross to his middle) */
   const go=()=>{const p=root.position;const q=sp.clone();pushOut(q);H.face=yf;const d=Math.hypot(q.x-p.x,q.z-p.z);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(yf-root.rotation.y),k:0,d:Math.max(.4,d/.5,Math.abs(wrapA(yf-root.rotation.y))/2.4)};/* the last short step onto the spot (back or forth), turned to the window */
    a.step='approach';a.t=0;a.adur=H.slide.d;a.next=()=>{play(IDLE(),{fade:.5});a.step='reach';a.t=0;};};goTo(w,go);};
  const done=()=>{if(a.lvCb){const c=a.lvCb;a.lvCb=null;a.step='done';c();return;}next();};
  a.update=dt=>{a.t+=dt;
   if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
   if(a.step==='reach'){a.w=Math.min(1,a.w+dt/.4);if(a.w>=1&&cd&&palmTo('Right',cd.toggle(V()))<.04){a.step='pull';a.t=0;a.st=0;AU(close?'shutter_close':'shutter_open',cd.toggle(V()));}else if(a.t>2.2){a.step='let';a.t=0;/* out of reach: he lets it be, it does not move */}return;}
   if(a.step==='let'){a.w=Math.max(0,a.w-dt/.35);if(a.w<=0)done();return;}};
  a.post=dt=>{const G=window.__grab;const s=S();if(!s||!cd)return;
   if(a.w<=.01){if(G)G.free(cd.obj);return;}
   let kt=kNow();if(a.step==='pull'){if(a.kt==null)a.kt=kt;if((want-a.kt)*(kt-a.kt)>-.12*Math.abs(want-a.kt))a.kt+=Math.sign(want-a.kt)*Math.min(Math.abs(want-a.kt),dt*.5);kt=a.kt;}/* the hand leads the cord by a hair; the shutter follows the hand */
   const t=cd.toggleAt(kt,V());REACH_LEAN=.3;try{reachGrip('Right',t,a.w);}finally{REACH_LEAN=.6;}H.look=t;H.lookW=.6;
   if(a.step==='pull'){const g=G&&G.gripPoint?G.gripPoint('Right'):t;const k0=kNow();s.pull(room,g);a.st=Math.abs(kNow()-k0)>1e-4?0:(a.st||0)+dt;
    if(Math.abs(kNow()-want)<.008||a.st>1.5){a.step='let';a.t=0;}}
   if(G){if(a.step==='pull'||(a.step==='reach'&&a.w>.6&&palmTo('Right',cd.toggle(V()))<.05))G.hold('Right',cd.obj,()=>cd.toggle(V()));else G.free(cd.obj);}};
  a.leave=cb=>{if((a.step==='pull'||a.step==='reach')&&!a.lvCb){a.lvCb=cb;a.step='let';a.t=0;return;}/* GRAB: called away mid-pull: the hand lets go of the toggle first; the shutter stays where his hand left it */const G=window.__grab;if(G&&cd)G.free(cd.obj);cb();};
  next();return a;};
 // house repairs: walk to the worn part (Brain passes opts.pos), kneel / stand and work there with the right tools
 const REPAIR={
  /* a slate at the eave (Brain picks one; pickSlate keeps it only if he can reach it): he walks out only as far as the boards carry him
     and hammers it standing, bent over a chest-high one, straight up for a head-high one */
  fix_shingle:{clip:pos=>hamClip(pos,'hy_shingle'),tools:[['benchHammer','Right']],stand:.55,standFn:pos=>has('hy_standhammer')?safeStand(pos,.38,nodeP(pos),[1.15,1.4]):.55,nail:'roof',def:()=>N.deck&&N.deck.p.clone().add(V(0,.2,-.5))},
  /* one knee down on the boards, bent ~70 deg over the board Brain picked (kneel + hammer mocap, lean baked into the clip data) */
  fix_board:{clip:has('hy_kneelfloor')?'hy_kneelfloor':'hy_nailboard',tools:[['benchHammer','Right']],stand:has('hy_kneelfloor')?.45:.5,nail:'floor',def:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),.8)},
  fix_wall:{nail:'wall',clip:pos=>hamClip(pos,'hy_patchwall'),tools:[['benchHammer','Right']],stand:.45,standFn:pos=>has('hy_standhammer')?safeStand(pos,.5,nodeP(pos)):.45/* a blow at a wall needs the elbow's room: from .36 m his shoulder was a hand from the boards and the arm folded shut at every blow */,def:()=>{const w=pick(WINDOWS);const n=N[w];const f=fwd(n.face??0);return n.p.clone().addScaledVector(f,.55).add(V(-f.z*.9,1.2,f.x*.9));}},
  fix_rope:{clip:has('hy_squatwork')?'hy_squatwork':'hy_ropeknot',wipe:'rope',node:'gate',stand:.45,def:()=>N.gate&&N.gate.p.clone().add(V(0,.3,.6))},
  fix_hinge:{clip:null,wipe:'hinge',tools:[['benchWrench','Right']],stand:.45,def:()=>{const P=window.__props||P3;return P&&P.door&&P.door.handle?P.door.handle(V()):null;}},
  fix_window:{clip:null,wipe:true,stand:.5,def:()=>{const ps=panes();const near=ps.filter(q=>Math.abs(q.floor-root.position.y)<.8);const q=pick(near.length?near:ps);if(q){winPick=q;return q.p.clone();}winPick=null;const w=pick(WINDOWS);return N[w].p.clone().addScaledVector(fwd(N[w].face??0),.5).add(V(0,1.3,0));}},
  fix_railing:{nail:'rail',clip:pos=>hamClip(pos,'hy_railing'),standFn:pos=>has('hy_standhammer')?safeStand(pos,.38,nodeP(pos)):.45,tools:[['benchHammer','Right']],stand:.45,def:()=>N.deck&&N.deck.p.clone().add(V(0,1,.6))},
  clear_roof:{clip:'hy_clearleaves',floorHands:true,fadeIn:1,/* 50 cm down into the crouch: over a second, not at 1 m/s from a standstill */stand:.6,def:()=>N.deck&&N.deck.p.clone().add(V(-.6,0,-.3))},
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
 /* the stand is measured from the walk-graph node the part was checked from (reachOK), not from wherever his root stopped: 8 cm off the
    workshop step node, the line crossed the step edge and the stand came out 1.14 m instead of 0.39 (he hammered a wall from a metre away) */
 const nodeP=pos=>{const n=nearNode(pos);return n&&N[n]?N[n].p:null;};
 function safeStand(pt,min,from,hs){const p0=from||root.position;const g0=floorAt(p0.x,p0.y+.3,p0.z,.45,.9);const p=V(p0.x,g0!=null?g0:p0.y,p0.z);/* a graph node may sit above the boards (a ladder top) */const dx=pt.x-p.x,dz=pt.z-p.z,d=Math.hypot(dx,dz);if(d<1e-3)return min;const ux=dx/d,uz=dz/d;const C=window.__collide;
  let ok=0;for(let t=0;t<=d-min+1e-6;t+=.05){let good=true;for(const e of [0,.22]){const x=p.x+ux*(t+e),z=p.z+uz*(t+e);const g=floorAt(x,p.y+.3,z,.45,.5);if(g==null||Math.abs(g-p.y)>.12){good=false;break;}}
   if(good&&C&&C.depthAt){const x=p.x+ux*t,z=p.z+uz*t;for(const hy of hs||[.2,.5,.75,1,1.25])if(C.depthAt(x,p.y+hy,z)>.01){good=false;break;}}
   /* furniture has no collider: the desk, the bench, a barrel stop him like a wall does (he stood behind the bedroom desk, a hammer's length short of the wall) */if(good&&!window.__noFurnStand){const x=p.x+ux*t,z=p.z+uz*t,r=.2;for(const o of OBST){if(Math.abs(o.y-p.y)>.5)continue;const rr=p.x>o.x0-r&&p.x<o.x1+r&&p.z>o.z0-r&&p.z<o.z1+r?0:r;/* he starts beside it already: only the furniture itself stops him (the bunk end by the node let him plan a stand behind the bunk, 1.2 m short of the wall) */if(x>o.x0-rr&&x<o.x1+rr&&z>o.z0-rr&&z<o.z1+rr){good=false;break;}}}if(!good)break;ok=t;}
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
  /* and his head fits there (approachTo steps back from a low eave: then the part would be out of reach) */if(dd>1e-3){const k=(dd-st)/dd,S=V(f.x+(q.x-f.x)*k,g!=null?g:f.y,f.z+(q.z-f.z)*k),S2=S.clone();pushOut(S2);if(S2.distanceTo(S)>.05)return false;}/* nor is he pushed off it by furniture (approachTo's pushOut: 1.1 m from the wall at the workbench) */if(C&&C.depthAt&&dd>1e-3){const k=(dd-st)/dd,x=f.x+(q.x-f.x)*k,z=f.z+(q.z-f.z)*k,y=g!=null?g:f.y;for(const hy of [1.5,1.68,1.82])if(C.depthAt(x,y+hy,z)>.005)return false;}return true;}

 const PKIND={fix_shingle:'shingle',fix_railing:'beam',fix_wall:'wall',fix_board:'floor'};
 /* a floor board to kneel at needs room round it for the hammer arm and the knee (not tight against the bunk bed or a chest) */
 function floorClear(x,y,z){const C=window.__collide;if(!C||!C.depthAt)return true;for(const r of [0,.2,.35])for(let i=0;i<(r?8:1);i++){const a=i*Math.PI/4;const px=x+Math.sin(a)*r,pz=z+Math.cos(a)*r;for(const h of [.12,.35,.6])if(C.depthAt(px,y+h,pz)>.005)return false;
   for(const b of furnBoxes())if(px>b.min.x-.05&&px<b.max.x+.05&&pz>b.min.z-.05&&pz<b.max.z+.05&&y+.6>b.min.y&&y+.12<b.max.y)return false;/* the bunk bed, the stove, a chair: furniture has no colliders */}return true;}
 let FB=null;function furnBoxes(){if(FB)return FB;FB=[];let s=root;while(s.parent)s=s.parent;s.traverse(o=>{if(/^(stove|counter|fridge|bunkbed|chair|toolwall|telescope|woodpile|pantry|table|chest|barrel|bench)$/i.test(o.name||'')){const b=new THREE.Box3().setFromObject(o);if(!b.isEmpty())FB.push(b);}});return FB;}
 function roomyFloor(o){const p=V(...o.pos);const g0=floorAt(p.x,p.y+.3,p.z,.45,.6);const y=g0!=null?g0:p.y;if(floorClear(p.x,y,p.z))return;
  for(const r of [.3,.6,.9,1.2])for(let i=0;i<12;i++){const a=i*Math.PI/6,x=p.x+Math.sin(a)*r,z=p.z+Math.cos(a)*r;const g=floorAt(x,y+.3,z,.45,.6);if(g==null||Math.abs(g-y)>.05)continue;if(floorClear(x,g,z)){o.pos=[x,g,z];return;}}}
 function pickPart(k,o){window.__pk=window.__pk||[];window.__pk.push({k,in:o.pos&&o.pos.slice()});if(PKIND[k]&&!o.pos&&REPAIR[k].def){const d=REPAIR[k].def();if(d)o.pos=d.toArray();}if(PKIND[k]==='floor'&&o.pos){try{roomyFloor(o);}catch(e){}}const kind=PKIND[k];const P=window.__planks;if(!kind||!P||!P.list||!o.pos)return;const Wr=window.__wear;const fpt=id=>{const f=Wr&&Wr.fault&&id!=null?Wr.fault(id):null;return f?f.p:null;};/* WEAR: a damaged part is judged by its fault (a post's centre is knee-high, its leaning top is where the work is) */if(reachOK(kind,fpt(o.target)||o.pos))return;const want=V(...o.pos);
  let best=null,bs=1e9;for(const c of P.list(kind)){const d=Math.hypot(c.pos[0]-want.x,c.pos[1]-want.y,c.pos[2]-want.z);const sc=d*.3+(c.fresh||0)*2;if(sc>=bs||!reachOK(kind,fpt(c.dmg>0?c.id:null)||c.pos))continue;bs=sc;best=c;}
  if(best){o.pos=best.pos.slice();o.target=best.id;}window.__pk.at(-1).out=o.pos&&o.pos.slice();window.__pk.at(-1).ok=reachOK(kind,o.pos);{const q=V(...o.pos),nn=nearNode(q);window.__pk.at(-1).nn=nn;window.__pk.at(-1).np=N[nn]&&N[nn].p.toArray();window.__pk.at(-1).st=safeStand(q,.38,N[nn].p,PART[kind].hs);window.__pk.at(-1).st2=safeStand(q,.36);}}
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
  const sh=bones.RightArm.getWorldPosition(V());const S=a.hm||(a.hm={ph:Math.random()*.3,w:0,n:0,T:rnd(.72,.9),noWF:!window.__wristFit});
  /* out of reach (hysteresis, so it never flickers): the IK fades out over half a second and the clip swings alone */
  const dn=sh.distanceTo(nail);a.hmFar=a.hmFar?dn>armLen+.42:dn>armLen+.5;const fade=a.endIn!=null&&a.endIn<.9;S.w=a.hmFar||fade?Math.max(0,S.w-dt/(S.fastOut?.33:fade?.7:.5)):Math.min(1,S.w+dt/.6);if(S.w<=0)return;S.ph+=dt;if(S.ph>S.T){S.ph-=S.T;S.T=rnd(.72,.9);S.hit=0;S.n++;if(S.n%6===5)S.ph-=rnd(.6,1.1);}
  H.noPop={side:'Right',until:performance.now()+150};/* motion.js: the blow is sharp on purpose */
  const u=S.ph/S.T;const lift=u<0?0:u<.5?smooth(0,.5,u):u<.6?1:u<.8?1-Math.pow((u-.6)/.2,2):0;
  const up=nrm.clone().normalize();const d=nail.clone().sub(sh);d.addScaledVector(up,-d.dot(up));if(d.lengthSq()<1e-4)d.set(0,0,1);d.normalize();
  // fist at impact: a handle's length back toward him and a little up; lifted: up and back round the elbow
  const hit=nail.clone().addScaledVector(d,-.24).addScaledVector(up,.06);const T=hit.clone().addScaledVector(up,.15*lift).addScaledVector(d,-.07*lift);
  /* an arm folds no shorter than this from the shoulder: at a wall a hand from his chest the lifted fist came up onto the shoulder itself */for(const q of [hit,T]){const r=q.clone().sub(sh),l=r.length();if(l<.3&&l>1e-4)q.copy(sh).addScaledVector(r,.3/l);}
  const pole=V(0,-1,0).addScaledVector(d,-.3);
  const w=S.w;const solve=()=>{root.updateMatrixWorld(true);const PG0=window.__poseGuard;
   /* still out of reach: he leans in from the hips (spine bent toward the nail, eased, at most ~30 deg), never the arm stretching */
   {const hp=bones.Hips.getWorldPosition(V());const dir=V(nail.x-hp.x,0,nail.z-hp.z);const s0=bones.RightArm.getWorldPosition(V());const need=s0.distanceTo(nail)-(armLen+(window.__lean0?.17:.06));
    S.lean=(S.lean||0)+(clamp(need/(window.__lean0?.5:.25),0,window.__lean0?.55:1.1)-(S.lean||0))*(1-Math.exp(-dt*4));if(S.lean>.005&&dir.lengthSq()>1e-4){const ax=V(0,1,0).cross(dir.normalize()).normalize();
     /* half of it (up to ~35 deg) is a hinge at the hips, as people bend: the pelvis tips forward and the thighs keep their place */
     const hh=window.__noHinge?0:Math.min(S.lean*.5,.6);if(hh>.005){const Hb=bones.Hips,ups=['LeftUpLeg','RightUpLeg'].map(n=>bones[n]).filter(Boolean);const uw=ups.map(b=>b.getWorldQuaternion(new THREE.Quaternion()));
      const hw=Hb.getWorldQuaternion(new THREE.Quaternion()),hp=Hb.parent.getWorldQuaternion(new THREE.Quaternion());Hb.quaternion.copy(hp.invert().multiply(new THREE.Quaternion().setFromAxisAngle(ax,hh).multiply(hw)));Hb.updateMatrixWorld(true);
      ups.forEach((b,i)=>{const pq=b.parent.getWorldQuaternion(new THREE.Quaternion());b.quaternion.copy(pq.invert().multiply(uw[i]));b.updateMatrixWorld(true);});}
     for(const n of ['Spine','Spine1','Spine2']){const b=bones[n];if(!b)continue;const qw=new THREE.Quaternion().setFromAxisAngle(ax,(S.lean-hh)/3);const bw=b.getWorldQuaternion(new THREE.Quaternion());const pq=b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(pq.invert().multiply(qw.multiply(bw)));b.updateMatrixWorld(true);}}}
   /* the back inside its range before the arm is solved on it (else the guard straightens it afterwards and carries the fist off the nail) */
   if(PG0&&PG0.fit&&!window.__noFit){for(const n of ['Spine','Spine1','Spine2'])if(bones[n])PG0.fit(bones[n]);if(PG0.fitSpine)PG0.fitSpine();bones.Hips.updateMatrixWorld(true);}
   {const ls=bones.LeftArm.getWorldPosition(V());const k=d.clone().cross(up).normalize();const lp=nail.clone().addScaledVector(k,-.13).addScaledVector(d,-.05).addScaledVector(up,.045);/* the wrist a palm above the surface: the hand rests ON it *//* in reach or not, the hand eases on and off the boards (at the edge of reach it flickered between the two every few frames: gate fix_wall LeftHand jitter) */const lr=ls.distanceTo(lp);S.lw=(S.lw||0)+(clamp((armLen*.97-lr)/(armLen*.06),0,1)-(S.lw||0))*(1-Math.exp(-dt*5));if(S.lw>.01)armIK('Left',lp,V(0,-1,0),w*.9*S.lw);}
   /* the face, not the fist, goes onto the nail: the hammer is turned whole (handle along the blow, face toward the surface, raised
      back round the wrist while lifting), the hand follows it, and the wrist target is corrected by the face's measured miss */
   const k=d.clone().cross(up).normalize();
   /* a low nail (floor, a kneeling blow): the handle comes down steeper at impact so the fist stays within the arm's reach */
   let al=0;for(let t=0;t<=1.1;t+=.05){al=t;const q=new THREE.Quaternion().setFromAxisAngle(k,-t);const y=d.clone().applyQuaternion(q),x=up.clone().negate().applyQuaternion(q);
    const g=nail.clone().addScaledVector(y,-.23).addScaledVector(x,-.1);if(g.distanceTo(sh)<=armLen*.97)break;}
   /* the hammer's pose (handle steepness al, handle turned sideways yw) is the one the arm can really give with the wrist and forearm
      inside their range: a few candidates are solved and the one with the face nearest the nail wins; both ease, never flip */
   /* the hammer's pose: steepness al and sideways turn yw (the face stays toward the surface), cocked back by lf while lifting, plus the
      forearm's roll ps (pronation). The arm, wrist and forearm stay inside the pose guard's ranges (a world-fixed hammer bent the
      wrist 45-50 deg past its range and the guard then threw the face 40 cm off the nail).
      Two key poses per blow are solved (the face on the nail, and the top of the lift) and the arm swings between them by the lift:
      solving every frame jumped between answers (up to 1 m/frame2 at the fist). They are solved again at each new blow. */
   let LF=lift;const mkQh=(al_,yw)=>{const dd=d.clone().applyAxisAngle(up,yw),kk=dd.clone().cross(up).normalize();const R=new THREE.Quaternion().setFromAxisAngle(kk,-.75*LF-al_);
    const Y=dd.applyQuaternion(R),X=up.clone().negate().applyQuaternion(R);const Z=X.clone().cross(Y);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X,Y,Z)).multiply(hm.quaternion.clone().invert());};
   const hb=bones.RightHand;const Tf=lf=>hit.clone().addScaledVector(up,.15*lf).addScaledVector(d,-.07*lf),Wf=lf=>nail.clone().addScaledVector(up,.2*lf).addScaledVector(d,-.07*lf);
   /* solved at full weight, then blended from the clip's arm by w (iterating at weight w compounded to ~1-(1-w)^8: a 20+ cm snap on the first frame) */
   const AB=[bones.RightArm,bones.RightForeArm,hb],q0=AB.map(b=>b.quaternion.clone());
   const PG=window.__poseGuard,fit=PG&&PG.fit&&!window.__noFit?b=>PG.fit(b):()=>0;
   const fa=bones.RightForeArm,qy=new THREE.Quaternion(),Y1=V(0,1,0);let PS=0,Qh=null,want=null,TT=null;
   const poseAt=(tgt,free)=>{armIK('Right',tgt,pole,1);if(!window.__noArmFit)fit(bones.RightArm);if(PS)fa.quaternion.multiply(qy.setFromAxisAngle(Y1,PS));if(!free&&!S.noWF)fit(fa);bones.RightArm.updateMatrixWorld(true);
     hb.quaternion.copy(fa.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(Qh));if(!free&&!S.noWF)fit(hb);hb.updateMatrixWorld(true);hm.updateMatrixWorld(true);};
   let tEnd=null;
   const run=(n,free,st)=>{AB.forEach((b,i)=>b.quaternion.copy(q0[i]));bones.RightArm.updateMatrixWorld(true);let tgt=(st||TT).clone(),err=9;tEnd=tgt;for(let i=0;i<n;i++){poseAt(tgt,free);
     const f=hm.localToWorld(V(...HFACE));const e=want.clone().sub(f);err=e.length();if(err<.004)break;tgt.addScaledVector(e,free?1:(window.__gainF||.45));const off=tgt.clone().sub(TT);if(off.length()>.45)tgt.copy(TT).add(off.setLength(.45));}return err;};
   const setLF=lf=>{LF=lf;TT=Tf(lf);want=Wf(lf);};
   const key=(lf,starts)=>{setLF(lf);Qh=mkQh(S.al,S.yw);PS=S.ps;let best=null;for(const st of starts){const e=run(30,false,st);if(!best||e<best.e-.002)best={e,t:tEnd.clone(),q:AB.map(b=>b.quaternion.clone())};}return best;};
   const shNow=bones.RightArm.getWorldPosition(V());
   if(!S.K||S.K.n!==S.n||S.K.sh.distanceTo(shNow)>(window.__keyTh??.015)&&!S.Ko||window.__keyEvery){
    setLF(0);
    if(PG&&PG.over&&!window.__noFit&&!window.__noSearch){
     const cost=(ca,cy,cp)=>{Qh=mkQh(ca,cy);PS=cp;const e=run(8,true);return PG.over(hb,hb.quaternion)+PG.over(fa,fa.quaternion)+e*300+(S.ps!=null?4*(Math.abs(ca-S.al)+Math.abs(cy-S.yw)+Math.abs(cp-S.ps)):0);};
     let bc=1e9,bb=null;for(const ca of [0,.3,.6,.9,1.2])for(const cy of [-.5,0,.5])for(const cp of [-1,-.5,0,.5,1]){const v=cost(ca,cy,cp);if(v<bc){bc=v;bb=[ca,cy,cp];}}
     if(S.ps!=null){const v=cost(S.al,S.yw,S.ps);if(v<=bc+.5)bb=[S.al,S.yw,S.ps];}
     /* refined around the best */
     for(const st of [.15,.07])for(const dv of [[st,0,0],[-st,0,0],[0,st,0],[0,-st,0],[0,0,st*2],[0,0,-st*2]]){const c=[bb[0]+dv[0],bb[1]+dv[1],bb[2]+dv[2]];const v=cost(...c);if(v<bc){bc=v;bb=c;}}
     S.al=bb[0];S.yw=bb[1];S.ps=bb[2];}
    else{if(S.al==null)S.al=al;if(S.yw==null)S.yw=0;if(S.ps==null)S.ps=0;}
    const k0=key(0,[Tf(0),...(S.K?[S.K.t0]:[])]);const km=key(.5,[k0.t.clone().add(Tf(.5)).sub(Tf(0)),Tf(.5)]);const k1=key(1,[km.t.clone().add(Tf(1)).sub(Tf(.5)),Tf(1),k0.t.clone().add(Tf(1)).sub(Tf(0))]);
    /* mid-blow the new keys are blended in over 0.2 s (a fresh solve can land on a different elbow: no jump) */if(S.K){S.Ko=S.K;S.kb=0;}else S.Ko=null;/* a new blow's keys can land on the other elbow too (gate fix_wall: 28 cm in one frame): always blended in */
    S.K={n:S.n,sh:shNow.clone(),q0:k0.q,qm:km.q,q1:k1.q,t0:k0.t,t1:k1.t,e0:k0.e};}
   /* this frame: between the two keys by the lift */
   const at=(K,i)=>lift<=.5?K.q0[i].clone().slerp(K.qm[i],lift*2):K.qm[i].clone().slerp(K.q1[i],lift*2-1);if(S.Ko){S.kb=Math.min(1,(S.kb||0)+dt/.2);if(S.kb>=1)S.Ko=null;}
   AB.forEach((b,i)=>{b.quaternion.copy(S.Ko?at(S.Ko,i).slerp(at(S.K,i),smooth(0,1,S.kb)):at(S.K,i));});bones.RightArm.updateMatrixWorld(true);hm.updateMatrixWorld(true);
   /* near the nail the face is put back on it exactly (the body breathes and settles a little between blows): solved from this
      blow's own key, never from last frame, so it cannot flip between answers */
   if(lift<.25&&window.__near){const sl=AB.map(b=>b.quaternion.clone());setLF(lift);Qh=mkQh(S.al,S.yw);PS=S.ps;run(10,false,S.K.t0.clone().add(Tf(lift)).sub(Tf(0)));
    const k=smooth(.25,.08,lift);AB.forEach((b,i)=>{const qn=b.quaternion.clone();b.quaternion.copy(sl[i]).slerp(qn,k);});bones.RightArm.updateMatrixWorld(true);hm.updateMatrixWorld(true);}
   S.e=lift<.01?S.K.e0:hm.localToWorld(V(...HFACE)).distanceTo(Wf(lift));
   if(w<.999){AB.forEach((b,i)=>{const q=b.quaternion.clone();b.quaternion.copy(q0[i]).slerp(q,w);});bones.RightArm.updateMatrixWorld(true);hm.updateMatrixWorld(true);}
   /* never a one-frame teleport of the fist (QA: 83 cm/frame2 on the kitchen-ladder railing, an elbow flip near full reach): against the
      motion of the last two frames the wrist may deviate at most 8 cm per frame (the blow itself stays well inside that) */
   {const hp=hb.getWorldPosition(V());const fresh=S.lt!=null&&Math.abs(a.T-S.lt-dt)<1e-3;S.lt=a.T;
    if(fresh&&S.p1&&S.T1&&!window.__noClamp){/* GRAB: on frames that reuse the blow's key poses no hand turn (Qh) was made this frame: the clamp keeps the turn the hand has now (poseAt multiplied by null: 'grab late TypeError _x' every frame of fix_wall) */if(!Qh)Qh=hb.getWorldQuaternion(new THREE.Quaternion());const pred=S.p1.clone().add(T).sub(S.T1);/* where the fist would be if it only followed the blow's own target */const dv=hp.clone().sub(pred);if(dv.length()>.08){poseAt(pred.add(dv.setLength(.08)));hp.copy(hb.getWorldPosition(V()));}}
    else if(!fresh){S.p1=null;}S.p1=hp;S.T1=T.clone();S.wp=hp.clone();}};
  /* after look / collide have moved the chest (grab.js late slot), else right here */
  const G=window.__grab;if(G&&G.late)G.late(solve);else solve();
  if(u>=.8&&!S.hit&&S.w>.9&&!a.hmFar){S.hit=1;AU('nails',nail);if(a.onHit)try{a.onHit(nail,nrm);}catch(e){}}}
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
  const at=V(-3.25,KT,2.13);/* 3 cm further back than first set: his hair brushed the hood's lower edge (watch R49-1) */const p=V(-3.2,KT+1.5,1.53);return {p,n:V(0,0,1),fixed:true,circle:true,t:0,lv:V(-.3,-.06,.06),at};}
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
 for(const [k,R] of Object.entries(REPAIR))MAKE[k]=(o={})=>{if(has('hy_standhammer'))try{pickPart(k,o);}catch(e){}const WF=o.target!=null&&window.__wear&&window.__wear.fault?window.__wear.fault(o.target):null;/* WEAR: he goes to the fault itself (a long floor board lifts at its far end, 1.5 m from its centre) */const pos=WF?V(...WF.p):o.pos?V(...o.pos):(R.def?R.def():null);
  const hamr=/benchHammer/.test(JSON.stringify(R.tools||[]));const clip=typeof R.clip==='function'?R.clip(o.pos?pos:null):R.clip;
  const D=rnd(18,35);/* known here, so the blow's IK fades out before the job ends (no snap back to the clip) */
  const W0=R.wipe==='hinge'?hingeW():R.wipe==='rope'?ropeW():R.wipe==='chimney'?chimneyW():R.wipe&&pos?(winPick&&winPick.p.distanceTo(pos)<.01?{p:winPick.p.clone(),n:winPick.n.clone(),t:0}:wallNear(pos)):null;/* the window: walk up to the pane itself, not to a point in front of it */
  const J=job({noCut:!!(R.standFn&&o.pos),/* the stand is measured from the node the part was checked from: no short cut off the route */faceYaw:W0?Math.atan2(-W0.n.x,-W0.n.z):null,pt:()=>W0?(W0.at?W0.at.clone():W0.p.clone().addScaledVector(W0.n,.42)):pos,/* the spot ~42 cm in front of the pane, then he turns to face it */node:pos?null:R.node,get stand(){return W0?.02:R.standFn&&o.pos?R.standFn(pos):R.stand;},clip,loop:true,dur:[D,D],tools:R.tools||[],fadeIn:R.fadeIn,vary:hamr&&has('hy_standhammer')?false:undefined,/* no look-round pauses mid-blow */lookW:R.wipe==='rope'?.45:undefined,/* fix_rope: eyes down on the low knots without folding the neck past 70 deg over the squat's bent chest (gate owl-head 72) */
   post:R.floorHands?(a,dt)=>{squatDrop(a,dt,floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y,D-a.T<.6);handsOnFloor(floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y);}:R.wipe&&pos?(a,dt)=>{const W=a.win||(a.win=W0);if(W&&W.upd)W.upd(a,dt);if(R.wipe==='rope')squatDrop(a,dt,floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y,D-a.T<.6);wipeWindow(a,dt,W,D-a.T<.8);}:hamr&&has('hy_standhammer')&&pos?(a,dt)=>{if(R.nail==='floor')kneelDrop(a,dt,floorOf(pos),D-a.T<.6);/* a floor nail is placed once he has knelt (the pelvis still turns for the first moments of the kneel) */if(R.nail==='floor'&&(a.nlT=(a.nlT||0)+dt)<1.2&&!window.__nail0)a.nl=null;/* WEAR: the blow goes to the fault itself (the lifted end, the sprung end, the post top, the loose rail end, the slate's edge) */const n=a.nl||(a.nl=(()=>{const Wr=window.__wear;const f=Wr&&Wr.fault&&o.target!=null?Wr.fault(o.target):null;if(f&&(R.nail==='floor'?(()=>{const hp=bones.Hips.getWorldPosition(V());return Math.hypot(hp.x-f.p[0],hp.z-f.p[2])<.6;})():bones.RightArm.getWorldPosition(V()).distanceTo(V(...f.p))<(R.nail==='roof'?.8:.9))){/* an arm (0.4 m) and a hammer, with the lean: further up a roof he folded flat over the eave */a.fn=V(...f.n).normalize();return V(...f.p);}/* out of his reach from where he could kneel or stand: the same part, nailed where he can */a.fn=null;return nailOf(R,pos);})());if(a.nlRe&&a.fn){const f=window.__wear&&window.__wear.fault(o.target);if(f)n.lerp(V(...f.p),Math.min(1,dt*3));}if(!a.onHit&&o.target!=null)a.onHit=(q,nr)=>{const Wr=window.__wear;if(!Wr)return;a.nb=(a.nb||0)+1;if(Wr.blow)Wr.blow(o.target,.22);if(a.nb===1&&Wr.nail)Wr.nail(q.clone(),(a.fn||nr).clone(),o.target);if(a.fn)a.nlRe=1;/* the part moved back: the aim glides after it (a reset here made the arm snap 15-20 cm at every blow) */};
     /* a wall or rail nail right under his chin can't be struck with a hammer held in a real wrist: the blow goes a little to his right
        along the board instead (the same board, ~0.58 m from the shoulder) */
     if(!a.nlFix&&!a.fn&&R.nail!=='floor'&&R.nail!=='roof'&&!window.__nail0&&a.T>.3){a.nlFix=1;const sh=bones.RightArm.getWorldPosition(V());const nr=nrmOf(R,n).clone().normalize();
      if(sh.distanceTo(n)<.55){const f=V(Math.sin(H.face),0,Math.cos(H.face)),rt=V(-f.z,0,f.x);
       /* candidate directions along the surface (his right first), each kept only if the same surface is still there (a ray back along the normal) */
       const dirs=[rt,rt.clone().add(f).normalize(),f,rt.clone().negate(),rt.clone().negate().add(f).normalize()].map(d=>d.addScaledVector(nr,-d.dot(nr))).filter(d=>d.lengthSq()>.05).map(d=>d.normalize());
       for(const tg of dirs){const w0=n.clone().sub(sh);const b=w0.dot(tg),c=w0.lengthSq()-.58*.58;const sl=Math.min(.4,Math.max(0,-b+Math.sqrt(Math.max(0,b*b-c))));if(sl<.02)continue;
        const q=n.clone().addScaledVector(tg,sl);const o=q.clone().addScaledVector(nr,.08);const r=new RAPIER.Ray({x:o.x,y:o.y,z:o.z},{x:-nr.x,y:-nr.y,z:-nr.z});
        const hh=world.castRay(r,.14,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});const t=hh?(hh.toi??hh.timeOfImpact):null;
        /* nrmOf is only the way back to him, not the wall's own normal: an oblique wall answers nearer or further, so any hit close by is the surface (taken where the ray met it) */if(t!=null&&t>.02&&t<.14){a.nlTo=o.addScaledVector(nr,-t);break;}}}}
     /* the aim glides to the better spot (a copy in one frame threw the fist 13 cm) */if(a.nlTo){n.lerp(a.nlTo,Math.min(1,dt*4));if(n.distanceTo(a.nlTo)<.003)a.nlTo=null;}
     a.endIn=D-a.T;repairHammer(a,dt,n,a.fn||nrmOf(R,n));}:undefined,
   tick:(a,dt)=>{if(!/hammer|nail/i.test(JSON.stringify(R.tools||[])))return;if(hamr&&a.hm&&!a.hmFar)return;a.ct=(a.ct||0)+dt;if(a.ct>1.3){a.ct=0;AU('nails',pos);}},result:()=>({ok:true,target:o.target})});
  /* called away mid-blow (Brain, the tour): the arm eases back to the clip over a third of a second instead of snapping */
  if(J.post){const p0=J.post;J.post=dt=>{p0(dt);if(J.step!=='work'&&J.ww>0)wipeWindow(J,dt,J.win,true);if(J.step!=='work'&&J.sw2>0)squatDrop(J,dt,floorAt(root.position.x,root.position.y+.3,root.position.z,.45,.6)??root.position.y,true);if(J.step!=='work'&&J.kw>0&&R.nail==='floor')kneelDrop(J,dt,floorOf(pos),true);if(J.step!=='work'&&J.hm&&J.hm.w>0&&J.nl){J.endIn=0;J.hm.fastOut=1;repairHammer(J,dt,J.nl,nrmOf(R,J.nl));}};}
  if(WF)J.reach=3;
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
 /* the quiver lies on his back whatever the body: the back's surface is found on the skinned mesh itself (the adult hero's thick
    jumper needed it 5 cm further out than the slim original, where it then floated a hand's width off the vest: film, hunt) */
 function quiverSpot(){const x=.06,y=.2;let zb=null;/* y = the strap ring at its top; the tube (radius .055) runs .52 down from it */
  try{bones.Spine2.updateWorldMatrix(true,false);const ms=[];root.traverse(o=>{if(o.isSkinnedMesh&&o.visible)ms.push(o);});
   for(const yy of [-.25,-.15,-.05,.05,.12]){const from=bones.Spine2.localToWorld(V(x,yy,-.6)),to=bones.Spine2.localToWorld(V(x,yy,0));const rc=new THREE.Raycaster(from,to.clone().sub(from).normalize(),0,.6);
    const hit=rc.intersectObjects(ms,false)[0];if(hit){const z=bones.Spine2.worldToLocal(hit.point.clone()).z;zb=zb==null?z:Math.min(zb,z);}}}catch(e){}
  return V(x,y,clamp(zb??-.1,-.3,0)-.065);}/* the tube's side on the furthest-out point of his back over its length */
 function onBack(n,off,rot){try{PP().grab(n,bones.Spine2,{offset:off,rot:new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot))});}catch(e){}}
 // a short station step: walk up to a world point, play a one-off clip, call cb at fraction `at` of the clip, then go on
 /* the supply bucket shelf: he always stands square in front of it, wherever he comes from (from the sink side approachTo + pushOut
    left him 50 cm off to the side: the bail was out of reach and the hand went 27 cm into the shelf, full gate f19055) */
 function shelfVisit(a,clip,hits,then){const pt=PT('waterShelf');const P=PP();const h=P&&P.toolHome?P.toolHome('waterBucket'):null;if(!pt||!h){visit(a,pt,.45,clip,hits,then);return;}
  const S=h.clone().add(V(-.2,0,.65));{const fy=floorAt(S.x,h.y-.3,S.z,.1,1.6);S.y=fy!=null?fy:h.y-1.26;}/* the kitchen floor under the shelf, not the floor he is on now (from the bedroom it sent him to a bedroom node) */const yaw=Math.atan2(h.x-S.x,h.z-S.z);
  const run=()=>{const fy=a.faceYaw;a.faceYaw=yaw;approachTo(a,S,0,()=>{a.faceYaw=fy;a.step='clip';a.t=0;a.hits=hits.slice();a.clipDur=has(clip)?durOf(clip):1.2;a.pt=pt;
   if(has(clip))once(clip,{fade:.35,then:()=>{a.step='next';for(const x of a.hits)x[1]();a.hits=[];play(IDLE(),{fade:.4});then();}});else{for(const x of hits)x[1]();then();}});};
  const nn=nearNode(S);if(nn)goTo(nn,run);else run();}
 // the bow peg (workshop wall): always from the same spot on the boards beside it (from the other side the adult hero's foot was
 // 20 cm out over the edge of the deck for half a second, full gate)
 function bowVisit(a,clip,hits,then){const pt=peg('bowPeg');const P=PP();const h=P&&P.toolHome?P.toolHome('bow'):null;if(!pt||!h){visit(a,pt,.45,clip,hits,then);return;}
  const S=h.clone().add(V(.07,0,.44));{const fy=floorAt(S.x,h.y-1.2,S.z,.3,.6);S.y=fy!=null?fy:h.y-1.42;}const yaw=Math.atan2(h.x-S.x,h.z-S.z);
  const run=()=>{const fy=a.faceYaw;a.faceYaw=yaw;approachTo(a,S,0,()=>{a.faceYaw=fy;a.step='clip';a.t=0;a.hits=hits.slice();a.clipDur=has(clip)?durOf(clip):1.2;a.pt=pt;
   if(has(clip))once(clip,{fade:.35,then:()=>{a.step='next';for(const x of a.hits)x[1]();a.hits=[];play(IDLE(),{fade:.4});then();}});else{for(const x of hits)x[1]();then();}});};
  const nn=nearNode(S);if(nn)goTo(nn,run);else run();}
 /* a deep mocap squat (hy_pickground) rocks both boots back onto the heels, toes up off the boards (ToeBase 6-10 cm over its planted
    height, gate: orig hero stands on air 8 cm): each boot is turned about the ankle until its toes are back on the floor */
 const tdL={};function toesDown(rest=.05,W=1){const fl=H.floorY;if(fl==null)return;for(const s of ['Left','Right']){const F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)continue;
   {const L=tdL[s];tdL[s]=null;if(L&&F.quaternion.equals(L.q)){F.quaternion.copy(L.base);F.updateMatrixWorld(true);}}/* unchanged since my turn last frame: from the boot as the pose left it, not turned again on top */
   const qb=F.quaternion.clone();
   const a=F.getWorldPosition(V()),t=T.getWorldPosition(V());const v=t.clone().sub(a);const L=v.length();const want=Math.max(-.92*L,fl+rest-a.y);if(t.y-fl-rest<.002||L<.03||want>=t.y-a.y)continue;/* as far down as the boot can tip (it skipped a boot it could not quite reach: legs jittered 13 cm) */
   const hz=Math.sqrt(L*L-want*want),h0=Math.hypot(v.x,v.z);if(h0<1e-4)continue;const v2=V(v.x/h0*hz,want,v.z/h0*hz);
   const q=new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(v.clone().normalize(),v2.normalize()),W);const pw=F.parent.getWorldQuaternion(new THREE.Quaternion());const fw=F.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
   F.quaternion.copy(pw.invert().multiply(fw));F.updateMatrixWorld(true);tdL[s]={base:qb,q:F.quaternion.clone()};}}
 let sqA=null,sqOn=0;/* run last (guard stage): earlier, the leg planting after the task's post put the boots back on their toes */
 function squatFeet(a){const fl=H.floorY;if(fl==null)return;const hy=n=>bones[n]?bones[n].getWorldPosition(V()).y-fl:9;
  if(!a.sf0)return;
  /* only where the boots really come off the boards (toes 1.5-4 cm over their rest), eased in and out: always on, it shook the old hero's right boot */
  const need=Math.min(hy('LeftToeBase'),hy('RightToeBase'))-a.sf0.toe;if(a.step==='clip'&&need>.03)a.sqOn=1;const tg=a.step==='clip'&&a.sqOn&&a.t<(a.clipDur||1.2)-.7?1:0;a.sqW=(a.sqW||0)+clamp(tg-(a.sqW||0),-.025,.025);/* latched for the squat, out before he is up: following the toes frame by frame it wavered and shook the boots */const W=a.sqW;if(W<.01)return;
  /* the toes only: lowering the whole body with the legs as well shook the boots (gate jitter 8-9 mm, 5 Hz) */
  toesDown(Math.max(.02,a.sf0.toe),W);}
 /* OUTDOOR: the drain bucket under the counter is taken and put back with the right hand from beside it: the pail stands ahead of his right
    foot, out at that side, never between his knees (from straight in front, 0.15 m to his left, the squat's shins went through it 8-9 cm) */
 function drainVisit(a,clip,hits,then){if(!a.sf0&&H.floorY!=null&&!H.path.length){const hy=n=>bones[n]?bones[n].getWorldPosition(V()).y-H.floorY:9;const k=Math.min(hy('LeftFoot'),hy('RightFoot')),t=Math.min(hy('LeftToeBase'),hy('RightToeBase'));if(k>0&&k<.2&&t>0&&t<.12)a.sf0={ank:k,toe:t};}/* his standing boots, before he sets off */const pt=PT('drainBay');const P=PP();const bk=P&&P.tools&&P.tools.drainBucket;const h=P&&P.toolHome?P.toolHome('drainBucket'):null;const cn=bk&&bk.userData.home&&bk.userData.home.parent;
  if(!pt||!h||!cn){visit(a,pt,.22,clip,hits,then);return;}
  const n=V(0,0,1).applyQuaternion(cn.getWorldQuaternion(new THREE.Quaternion()));n.y=0;if(n.lengthSq()<1e-6){visit(a,pt,.22,clip,hits,then);return;}n.normalize();const f=n.clone().negate(),r=V(-f.z,0,f.x);
  const S=h.clone().addScaledVector(f,-.58).addScaledVector(r,-.27);/* OUTDOOR: 24 cm further back than before: the approach and the squat pushed him to the same spot for anything up to ~.5 (collide), with the shins 7-9 cm and the free hand 5-10 cm in the cupboard front; from here no part of him is in it (gate, both heroes) *//* the pail ahead of him, turned 25 deg along the counter (square to it the feet swept round at the squat start: jitter 11, collide: shins 5 cm in the counter; 45 deg and further left: shins, hand and the hatch edge) */{const fy=floorAt(S.x,h.y+.3,S.z,.4,.6);S.y=fy!=null?fy:root.position.y;}const fd=f.clone().addScaledVector(r,.45).normalize();const yaw=Math.atan2(fd.x,fd.z);
  let tries=0;const run=()=>{const fy=a.faceYaw;a.faceYaw=yaw;approachTo(a,S,0,()=>{a.faceYaw=fy;if(Math.abs(wrapA(yaw-root.rotation.y))>.08&&tries++<2){run();return;}/* square to the counter before squatting: turning in the squat slid the right foot 8 cm */a.step='clip';a.t=0;a.hits=hits.slice();a.clipDur=has(clip)?durOf(clip):1.2;a.pt=h.clone().add(V(0,.25,0));/* he looks at the pail itself, out ahead of his right foot (at the bay point, right under his face in the squat, the head turned 75 deg off the chest) */
   if(has(clip))once(clip,{fade:.35,then:()=>{a.step='next';for(const x of a.hits)x[1]();a.hits=[];play(IDLE(),{fade:.4});then();}});else{for(const x of hits)x[1]();then();}});};
  const nn=nearNode(S);if(nn)goTo(nn,run);else run();}
 function visit(a,pt,stand,clip,hits,then){if(!pt){then();return;}const nn=nearNode(pt);const run=()=>approachTo(a,pt,stand,()=>{a.step='clip';a.t=0;a.hits=hits.slice();if(pt.faceTo)H.face=Math.atan2(pt.faceTo.x-root.position.x,pt.faceTo.z-root.position.z);a.clipDur=has(clip)?durOf(clip):1.2;a.pt=pt;
   if(has(clip))once(clip,{fade:.35,then:()=>{a.step='next';for(const h of a.hits)h[1]();a.hits=[];play(IDLE(),{fade:.4});then();}});else{for(const h of hits)h[1]();then();}});
  if(nn)goTo(nn,run);else run();}
 // KITCHEN (re-added on the rolled-back body): the fridge by hand. He stands on the latch side clear of the door's swing, takes the handle, the door opens only as
 // far as his hand carries it (then a little push), the meat goes in / comes out with the hand inside, he takes the handle again and
 // pushes it shut. mode 'in' puts the held meatBag in, 'out' takes one out into the right hand.
 function fridgeAt(F,k,out){const so=F.setOpenRaw||F.setOpen;const k0=F.open;so(k);F.handle(out);so(k0);return out;}
 function fridgeVisit(a,mode,then){const F=PP().fridge;if(!F||!F.handle||!F.setOpen){then();return;}
  const h0=fridgeAt(F,0,V()),h5=fridgeAt(F,.5,V()),h1=fridgeAt(F,1,V());const ins=F.inside?F.inside(V()):PT('fridge');
  // the hinge: centre of the circle through the three handle positions (xz)
  const cx=(()=>{const ax=h0.x,az=h0.z,bx=h5.x,bz=h5.z,qx=h1.x,qz=h1.z;const d=2*(ax*(bz-qz)+bx*(qz-az)+qx*(az-bz));if(Math.abs(d)<1e-6)return null;
   const ux=((ax*ax+az*az)*(bz-qz)+(bx*bx+bz*bz)*(qz-az)+(qx*qx+qz*qz)*(az-bz))/d,uz=((ax*ax+az*az)*(qx-bx)+(bx*bx+bz*bz)*(ax-qx)+(qx*qx+qz*qz)*(bx-ax))/d;return V(ux,h0.y,uz);})();
  const nrm=V(h0.x-ins.x,0,h0.z-ins.z).normalize();const lat=cx?V(h0.x-cx.x,0,h0.z-cx.z).normalize():V();
  const S=h0.clone().addScaledVector(nrm,.28).addScaledVector(lat,.1);S.y=F.obj?F.obj.getWorldPosition(V()).y:h0.y-.9;{const fy=floorAt(S.x,S.y+.3,S.z,.6);if(fy!=null)S.y=fy;}
  const nn=nearNode(S);const run=()=>approachTo(a,S.clone().addScaledVector(nrm,.01),.01,()=>{H.face=Math.atan2(h0.x-root.position.x,h0.z-root.position.z);play(IDLE(),{fade:.4});
    a.step='fridge';a.t=0;a.fr={st:'reachO',w:0,t:0,k:F.open,mode,then,ins,nrm,hc:cx,hr:cx?Math.hypot(h0.x-cx.x,h0.z-cx.z):0,th0:cx?Math.atan2(h0.z-cx.z,h0.x-cx.x):0,th1:cx?Math.atan2(h1.z-cx.z,h1.x-cx.x):0};});
  if(nn)goTo(nn,run);else run();}
 /* GRAB: called away at the open fridge: the hand shuts it first (it used to swing shut by itself, openTo) */
 function fridgeLeave(a,cb){const F=PP().fridge,R=a.fr;if(!R||!F||F.open<=.01||a.step!=='fridge'||a.lvF)return false;a.lvF=1;R.then=cb;
  if(R.st==='open'||R.st==='reachO'){R.st='close';R.t=0;}else if(R.st==='close'||R.st==='reachC'||R.st==='after'){}else{if(R.st==='move')R.nx='in';else{R.st='in';R.t=0;}R.did=1;R.tdid=-1;}return true;}
 const FR_IN=.19;/* KITCHEN: the meat goes on the FRONT of the low shelf: deeper in, his head hit the fridge front and collide pushed the arm 20 cm back */
 function fridgeTick(a,dt){const F=PP().fridge,R=a.fr;R.t+=dt;const R0=armLen*.92+PALM-.03;const tmp=V();const p=root.position;
  const grip=()=>{const G=window.__grab;return G&&G.gripPoint?G.gripPoint('Right'):bones.RightHand.getWorldPosition(V());};
  const hk=F.handle(V());H.look=R.st==='in'?R.ins:hk;H.lookW=1;
  // GRAB: the door goes where the hand has taken it: the hand reaches a little ahead along the handle's arc and the door follows its angle
  const kAt=q=>{if(!R.hc)return null;const d=wrapA(R.th1-R.th0);if(Math.abs(d)<1e-3)return null;return wrapA(Math.atan2(q.z-R.hc.z,q.x-R.hc.x)-R.th0)/d;};
  // a short shuffle to a spot (walk clip while it slides), then the next state
  const slideTo=(q,faceAt,nx)=>{q=q.clone();q.y=p.y;pushOut(q);const d=Math.hypot(q.x-p.x,q.z-p.z);const yaw=Math.atan2(faceAt.x-q.x,faceAt.z-q.z);H.face=yaw;
   const dur=Math.max(.35,d/.7,Math.abs(wrapA(yaw-root.rotation.y))/2.4);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(yaw-root.rotation.y),k:0,d:dur};if(d>.08)play('30',{fade:.25,speed:.9});R.st='move';R.t=0;R.md=dur;R.nx=nx;};
  // while pulling / pushing the door the body goes with the hand (a step back or in), the hand never leaves the handle
  const keep=()=>{const sh=bones.RightArm.getWorldPosition(V());const v=V(hk.x-sh.x,0,hk.z-sh.z);const dy=hk.y-sh.y;const want=Math.sqrt(Math.max(0,R0*R0-dy*dy));const l=v.length();
   if(l>want){const m=Math.min(l-want,.6*dt);const q=p.clone().addScaledVector(v.normalize(),m);pushOut(q);p.x=q.x;p.z=q.z;}H.face=Math.atan2(hk.x-p.x,hk.z-p.z);};
  // KITCHEN: the meat shelf is low (~0.6 m): he bends his knees to bring the shoulder down to it (feet stay planted), only while the hand is in
  {if(R.st==='in'&&R.sq0===undefined){const sh=bones.RightArm.getWorldPosition(V());const hz=Math.hypot(sh.x-R.ins.x,sh.z-R.ins.z);const dy=sh.y+(H.squat||0)-R.ins.y;R.sq0=clamp(dy-Math.sqrt(Math.max(0,(R0*.9)**2-hz*hz))+.04,0,.42);}const want=R.st==='in'&&R.sq0?R.sq0*smooth(0,1,R.w):0;R.sq=(R.sq||0)+(want-(R.sq||0))*(1-Math.exp(-dt*6));H.squat=R.sq;H.kSquat=R.sq>.001;H.kSqA=act;}
  if(R.mbO){R.mbT-=dt;if(R.mbT<=0){try{if(R.mbO.parent===scene)PP().release('meatBag');}catch(e){}R.mbO=null;}}/* behind the shut door: put away (hidden) */
  if(R.st==='move'){if(R.t>=R.md){play(IDLE(),{fade:.35});R.st=R.nx;R.t=0;}return;}
  if(R.st==='reachO'||R.st==='reachC'){const mbH=PP().tools&&PP().tools.meatBag;/* with the sack in that fist the arm waits for the walk to settle: the stepping knees kicked the sack as it came up in front of them */if(!(mbH&&mbH.parent===bones.RightHand&&R.t<.35))R.w=Math.min(1,R.w+dt/.35);R.tgt='h';if((R.w>=1&&grip().distanceTo(hk)<.03)||R.t>1.2){R.st=R.st==='reachO'?'open':'close';R.t=0;}}
  else if(R.st==='open'){keep();F.setOpen(Math.min(.6,F.open+1.0*dt));if(F.open>=.6){F.openTo(.92);/* a last pull and it swings wide */R.w=Math.max(.0,R.w);R.st='letgo';R.t=0;}}
  else if(R.st==='letgo'){R.w=Math.max(0,R.w-dt/.25);if(R.w<=0){const fr=R.ins.clone().sub(fridgeAt(F,0,tmp).clone().setY(R.ins.y)).setY(0);const front=R.ins.clone().addScaledVector(R.nrm,.5);/* KITCHEN: half a metre back, so the knees bend and the head stays out of the fridge */slideTo(front,R.ins,'in');}}
  else if(R.st==='in'){R.tgt='i';R.w=Math.min(1,R.w+dt/.35);if(R.t>.3&&!R.did&&(grip().distanceTo(R.ins.clone().addScaledVector(R.nrm,FR_IN))<.05||R.t>2.2)){R.did=1;R.tdid=R.t;try{if(R.mode==='in'){PP().release('meatBag',{blend:.25});/* eased onto the shelf from where the fist set it down */window.__audio.carry(false);H.carry=null;}else PP().grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}}
   if(R.did&&R.t>R.tdid+.25){R.w=Math.max(0,R.w-dt/.2);if(R.w<=0){const ho=F.handle(V());slideTo(ho.clone().addScaledVector(R.nrm,.28).addScaledVector(V(ho.x-R.ins.x,0,ho.z-R.ins.z).normalize(),.1),ho,'reachC');}}}
  else if(R.st==='close'){keep();F.setOpen(Math.max(0,F.open-1.0*dt));if(F.open<=.3){F.openTo(0);if(R.mbShelf){const mb=R.mbShelf;R.mbShelf=null;R.mbT=.45;R.mbO=mb;}/* a push and it swings shut */R.st='after';R.t=0;}}
  else if(R.st==='after'){R.w=Math.max(0,R.w-dt/.3);if(R.w<=0&&!(R.mode==='out'&&R.cw>0&&(R.cf??1)>0)){if(!R.bk&&R.mode!=="out"){R.bk=1;/* GRAB: a small step back off the shut door before he turns away (his toes caught its front) */const q=p.clone().addScaledVector(R.nrm,.08);slideTo(q,hk,'after');return;}if(R.mbO){try{if(R.mbO.parent===scene)PP().release('meatBag');}catch(e){}R.mbO=null;}a.fr=null;H.squat=0;H.kSquat=0;a.step='next';R.then();}}}
 function fridgePost(a){const R=a.fr;if(!R)return;const mb0=PP().tools&&PP().tools.meatBag;const bag=R.mode==='out'&&mb0&&mb0.parent===bones.RightHand;if(R.w<=.01&&!bag)return;const F=PP().fridge;const G=window.__grab;
  const t=R.tgt==='i'?R.ins.clone().addScaledVector(R.nrm,FR_IN):F.handle(V());/* the meat at the front of the shelf, not its back wall */if(R.w>.01){if(R.tgt==='i')REACH_LEAN=0;try{reachGrip('Right',t,R.w);}finally{REACH_LEAN=.6;}}if(!a.relook||a.relook.fr){const rl=()=>{const R=a.fr;if(!R||R.tgt!=='i'||R.w<=.01)return;REACH_LEAN=0;try{reachGrip('Right',R.ins.clone().addScaledVector(R.nrm,FR_IN),R.w);}finally{REACH_LEAN=.6;}};rl.fr=1;a.relook=rl;relookReg();}/* and once more after the gaze has turned his chest (it carried the fist 5 cm off the shelf) *//* at the shelf he stays upright on bent knees: the waist lean put his head into the fridge front, and collide's push on the head carried the arm 20 cm back */ /* the meat taken out: between the shelf and the door handle the sack hangs in his fist at his right hip, not swinging in front of his shins */if(R.mode==='out'&&R.w<.999){const mb=PP().tools&&PP().tools.meatBag;if(mb&&mb.parent===bones.RightHand){const hp=bones.Hips.getWorldPosition(V());const fw=fwd(root.rotation.y);const cp=hp.addScaledVector(V(-fw.z,0,fw.x),.28).addScaledVector(fw,.16).add(V(0,.16,0));R.cw=Math.min(1,(R.cw||0)+1/60/.4);{const l=root.worldToLocal(cp.clone());R.cs=R.cs?R.cs.lerp(l,.15):l;}/* eased in his own frame: the hips lurch as the walk starts */{const G=window.__grab;if(R.st==='after')R.cf=Math.max(0,(R.cf??1)-1/60/.28);const w=(1-R.w)*smooth(0,1,R.cw)*smooth(0,1,R.cf??1);/* eased off as the fridge step ends: it used to stop at once, a 20 cm drop of the fist */const c=root.localToWorld(R.cs.clone());/* full weight on a blended target: reachGrip's fist correction only runs at w>.98 and switched on with a 14 cm drop */reachGrip('Right',G&&G.gripPoint&&w<.999?G.gripPoint('Right').lerp(c,w):c,1);}H.noPop={side:'Right',until:performance.now()+150};/* the pop filter dragged the carry arm back toward the walk swing, the sack into the hips */}}if(G){if(R.st==='open'||R.st==='close'||((R.st==='reachO'||R.st==='reachC')&&R.w>.6))G.hold('Right',F.obj,()=>F.handle(V()));else G.free(F.obj);}}
 function stepTick(a,dt){a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return true;}if(a.step==='fridge'){if(a.fr)fridgeTick(a,dt);return true;}
  if(a.step==='clip'){H.look=a.pt;H.lookW=.9;const k=a.t/Math.max(.3,a.clipDur);while(a.hits.length&&k>=a.hits[0][0]){a.hits.shift()[1]();}return true;}return false;}
 // the same one-off clip n times in a row (gathering logs, scooping), each with a small shift of the gaze
 function reps(clip,n,then){if(n<=0||!has(clip)){then();return;}once(clip,{fade:.35,then:()=>{H.face+=rnd(-.25,.25);reps(clip,n-1,then);}});}
 const peg=n=>{const p=PT(n);if(!p)return null;const q=p.clone();q.hand=true;/* hand height: stand on the floor below it, not on a floor level with it */return q;};
 /* GRAB: the peg clips (gear on / off) drive no hands by themselves: the lantern, bow and quiver jumped 9-84 cm between hook, fist and
    back. a.cr lists clip-timed reaches {hand, at(), k0, k1, k2} (clip fraction): the palm arrives on at() by k1, where that clip's hit
    takes or lets go, and eases off by k2. */
 function clipReach(a){a.relook=null;if(a.step!=='clip'||!a.cr||!a.cr.length)return;relookReg();const k=a.t/Math.max(.3,a.clipDur||1.2);const L=[];
  for(const c of a.cr){let gk=-1;/* c.glide: the reach comes in from where the hand was when it started, along a straight eased path at full weight (a weight ramp toward a fixed mark let the clip's own swing pass through it: the hand went out past the peg and came back, gate trip jitter 18-20 cm) */if(c.glide){gk=smooth(c.k0,c.k1,k);if(k>=c.k0){const G=window.__grab;bones[c.hand+'Hand'].updateWorldMatrix(true,false);c.p0=G&&G.gripPoint?G.gripPoint(c.hand).clone():null;}else c.p0=null;if(!c.p0)gk=-1;}let go=0;if(gk>=0)go=smooth(c.k1+(c.hold||0),c.k2-.05,k);/* and goes back out the same way: the mark slides to where the clip has the hand now, at full weight, so at k2 there is nothing left to let go of (a fading weight dropped the hand off the shoulder 59 cm in 15 frames) */const w0=gk>=0?(k>=c.k0?1-smooth(c.k2-.05,c.k2,k):0)/* on the clip's hand by then: the solved arm hands back to the clip's own elbow and wrist */:smooth(c.k0,c.k1,k)*(1-smooth(c.k1+(c.hold||0),c.k2,k));/* GRAB: the reach and the relook after the gaze each pull the arm by w, so it acts like 1-(1-w)^2: the hand stuck to the mark and then fell 50 cm in 10 frames (bow over the shoulder); c.lin (bow, quiver, jacket) takes 1-sqrt(1-w) so the hand follows the curve itself; the lantern's quick take keeps w */const w=c.lin&&gk<0?1-Math.sqrt(Math.max(0,1-w0)):w0;if(w>.01){let t=c.at();if(t&&gk>=0&&gk<1)t=c.p0.clone().lerp(t,gk);/* c.to: one reach that carries on from its first mark to the next (peg -> over the shoulder) instead of two reaches crossfading (between them the hand fell back toward the clip's pose and came again: gate trip jitter 20 cm) */if(t&&c.to){const m=smooth(c.m0,c.m1,k);if(m>0){if(!c.atC)c.atC=t.clone();const t2=c.to();if(t2)t=c.atC.clone().lerp(t2,m);}}if(t&&go>0){const G=window.__grab;bones[c.hand+'Hand'].updateWorldMatrix(true,false);/* this frame's clip pose, not last frame's solved one (it followed itself and stuck) */if(G&&G.gripPoint)t=t.clone().lerp(G.gripPoint(c.hand),go);}if(t)L.push([c.hand,t,w,(c.lean??.3)*(1-go)*(gk>=0?gk:1)]);}}
  for(const [h,t,w,l] of L)reachGripN(h,t,w,l);/* the gaze turns the chest after this: the palms go back on their marks once it is done */a.relook=L.length?()=>{for(const [h,t,w] of L)reachGripN(h,t,w,0);}:null;}
 /* GRAB: the jacket into the right hand by its collar, hanging as it hung on the peg */
 const jacketToHand=()=>{const P=PP();const o=P.tools.jacket;const hq=bones.RightHand.getWorldQuaternion(new THREE.Quaternion());const rot=hq.invert().multiply(o.getWorldQuaternion(new THREE.Quaternion()));o.updateMatrixWorld(true);const w0=o.matrixWorld.clone();P.grab('jacket',bones.RightHand,{offset:V(0,.07,.03),rot});/* kept exactly where it hung (the grip offset moved it 7 cm up) */bones.RightHand.updateMatrixWorld(true);const lm=bones.RightHand.matrixWorld.clone().invert().multiply(w0);const sc=V();lm.decompose(o.position,o.quaternion,sc);o.scale.copy(sc);JK_IN_HAND={p:o.position.clone(),q:o.quaternion.clone()};};
 /* the jacket's hold in the right hand as taken off the peg (hand-local), reused to bring it back so the collar loop lands on the peg */
 let JK_IN_HAND=null;
 const gripNow=n=>{const G=window.__grab;return G&&G.toolGripNow?G.toolGripNow(n):(PP().tools[n]?PP().tools[n].getWorldPosition(V()):null);};
 /* over that shoulder, a little behind it: where a hand puts a bow or quiver to sling it on (or takes it off) */
 const overShoulder=side=>{const s=bones[side+'Arm'].getWorldPosition(V());const f=fwd(root.rotation.y),r=V(-f.z,0,f.x).multiplyScalar(side==='Left'?-1:1);return s.addScaledVector(f,.13).addScaledVector(r,.1).add(V(0,.07,0));};/* GRAB: up in front of that shoulder at chin height, where the bent arm can take the hand (behind and over it, or tight on the shoulder, the elbow ran out of bend: the hand stuck 20 cm short and then jumped) */
 /* slung on from the hand: it settles onto the back from where the hand left it (it used to jump there) */
 const BKE=new Map();let bkeOn=0;
 function onBackEase(n,off,rot,d=.35){const o=PP().tools&&PP().tools[n];if(!o){onBack(n,off,rot);return;}o.updateMatrixWorld(true);const w0=o.matrixWorld.clone();onBack(n,off,rot);if(o.parent!==bones.Spine2)return;
  const p1=o.position.clone(),q1=o.quaternion.clone();bones.Spine2.updateMatrixWorld(true);const lm=bones.Spine2.matrixWorld.clone().invert().multiply(w0);const p0=V(),q0=new THREE.Quaternion(),s0=V();lm.decompose(p0,q0,s0);
  if(p0.distanceTo(p1)>.9/(bones.Spine2.getWorldScale(V()).x||1))return;o.position.copy(p0);o.quaternion.copy(q0);BKE.set(o,{p0,q0,p1,q1,t:0,d});
  if(!bkeOn){bkeOn=1;lateFn(()=>{for(const [ob,m] of BKE){if(ob.parent!==bones.Spine2){BKE.delete(ob);continue;}m.t=Math.min(1,m.t+1/60/m.d);const e=smooth(0,1,m.t);ob.position.copy(m.p0).lerp(m.p1,e);ob.quaternion.copy(m.q0).slerp(m.q1,e);if(m.t>=1)BKE.delete(ob);}});}}
 function gearOn(a,o,then){const seq=[];
  if(o.jacket&&!GEAR.coat&&COAT)seq.push(next=>{/* GRAB: the right hand goes to the jacket on the peg before it leaves the peg */a.cr=[{hand:'Right',at:()=>gripHome('jacket'),k0:0,k1:.13,hold:.03,k2:.42,lin:1}];visit(a,peg('jacketPeg'),.45,'hy_jacketon',[[.14,()=>{try{PP().setHere&&PP().setHere('jacket',false);}catch(e){}COAT.on=true;GEAR.coat=true;}],[.55,()=>AU('zip')]]/* no rigid jacket in the hand: it leaves the peg at the touch and settles on the body (skinned coat fades in) */,()=>{a.cr=null;next();});});
  if(o.bow&&!GEAR.bow)seq.push(next=>{/* GRAB: the left hand goes to the bow's grip on its peg before it takes it (it was taken from 30-60 cm off) */a.cr=[{hand:'Left',at:()=>gripHome('bow'),k0:.1,k1:.33,hold:.04,k2:.62,lin:1}];bowVisit(a,'hy_bowtake',[[.35,()=>{try{PP().grab('bow',bones.LeftHand,{offset:V(0,.08,.03)});}catch(e){}}],[.7,()=>{onBack('quiver',quiverSpot(),[0,0,-.18]);onBackEase('bow',V(-.02,.03,-.18),[0,0,.55]);/* OUTDOOR: slung across the back, both hands free for the ladder (Pavel: bow on the back); GRAB: it settles there from the hand */GEAR.bow=true;}]],()=>{a.cr=null;next();});});
  if(o.lantern&&!GEAR.lantern&&hasTool('lantern'))seq.push(next=>lanternBench(a,true,next));
  const run=i=>{if(a.leaving)return;if(i>=seq.length){then();return;}seq[i](()=>run(i+1));};run(0);}
 /* OUTDOOR: the lantern off the bench and back by hand, at bench height: the palm goes to the bail, closes, and the lantern comes
    down to his side (hy_take, a high-shelf clip, swung it up over his head and back down: watch) */
 const LB={s:null};let lbOn=0;
 function lanternBench(a,take,then){const home=toolHome('lantern');if(!home){then();return;}const pt=home.clone();
  const run=()=>approachTo(a,pt,.3,()=>{if(a.leaving&&take){then();return;}a.step='clip';a.t=0;a.hits=[];a.clipDur=1.5;a.pt=pt.clone().add(V(0,.15,0));play(IDLE(),{fade:.3});
   LB.s={act:a,take,t:0,did:0,home:pt};if(!lbOn){lbOn=1;lateFn(lbLate);}
   H.wait={t:1.6,then:()=>{const S=LB.s;LB.s=null;if(S&&!S.did)lbDo(S);a.step='next';then();}};});const nn=nearNode(pt);if(nn)goTo(nn,run);else run();}
 function lbDo(S){S.did=1;const P=PP();try{if(S.take){P.grab('lantern',bones.RightHand,{offset:V(0,.06,.03)});const Lg=window.__lights;if(Lg){Lg.attachHand&&Lg.attachHand(bones.RightHand);Lg.set('hand',true);}GEAR.lantern=true;}
  else{const Lg=window.__lights;if(Lg){Lg.set('hand',false);Lg.detachHand();}P.release('lantern',{blend:.3});GEAR.lantern=false;}}catch(e){}AU('cloth');}
 function lbLate(){const S=LB.s;if(!S||act!==S.act){LB.s=null;return;}S.t+=1/60;const t=S.t;const P=PP();const l=P.tools&&P.tools.lantern;if(!l)return;
  const G=window.__grab;const g=V(...((G&&G.GRIP&&G.GRIP.lantern&&G.GRIP.lantern.g)||[0,.24,0]));const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
  const bail=S.take&&!S.did?l.localToWorld(g.clone()):S.home.clone().add(g.clone().multiply(l.getWorldScale(V())));/* the bail on the bench (the put: where it will be once set down) */
  const side=bones.Hips.getWorldPosition(V()).addScaledVector(r,.22).addScaledVector(f,.08).add(V(0,.15,0));/* where his carrying fist holds it once the reach lets go (lower, it rose 30 cm as the reach faded) */
  let tg,w;if(S.take){w=smooth(0,.45,t)*(1-smooth(1.05,1.45,t));const hold=S.act.lswNext;if(hold)w=smooth(0,.45,t);tg=t<.6?bail:bail.clone().lerp(side,smooth(.6,1.15,t));if(!hold)tg.lerp(odPalm('Right'),smooth(1.1,1.5,t));if(hold)LB.end={act:S.act,p:tg.clone()};}/* down into where his own carrying pose holds it this frame: a reach fading out between two arm poses sagged the fist 20 cm and sprang it back */
  else{w=smooth(0,.5,t)*(1-smooth(.85,1.3,t));tg=t<.6?side.clone().lerp(bail,smooth(.1,.6,t)).add(V(0,.04*Math.sin(Math.PI*clamp(t/.6,0,1)),0)):bail;}
  S.ls=S.ls||{};if(w>.01||(S.ls.v||0)>.002)reachTo('Right',tg,Math.max(w,.0101),S.ls);/* kept on till the lean has eased off (dropped with the reach, the shoulder sprang 18 cm up) *//* with a rate-limited lean from the hips: the bail at the bench's front edge is past arm's length from where the bench lets him stand */if(!S.did&&t>.62&&(S.take?odPalm('Right').distanceTo(bail)<.09||t>.8:true))lbDo(S);
  H.look=S.home;H.lookW=.7*(1-smooth(1,1.4,t));if(S.did===+!!S.take)lanternPlumb();/* in the fist (taken, or not yet set down) *//* hanging from its bail as it comes off the bench, not lying on its side in the fist */}
 function gearOff(a,then){const seq=[];
  if(GEAR.lantern)seq.push(next=>lanternBench(a,false,next));
  if(GEAR.bow)seq.push(next=>{/* GRAB: the left hand takes the bow to its peg: on the grip spot as it lets go */a.cr=[{hand:'Left',at:()=>gripHome('bow'),k0:.42,k1:.68,hold:.03,k2:.93,lin:1}];bowVisit(a,'hy_bowhang',[[.2,()=>{try{PP().grab('bow',bones.LeftHand,{offset:V(0,.08,.03)});}catch(e){}/* off the back into the hand first */}],[.4,()=>{try{PP().release('quiver',{blend:.4});}catch(e){}}],[.7,()=>{try{PP().release('bow',{blend:.4});}catch(e){}GEAR.bow=false;}]],()=>{a.cr=null;next();});});
  if(GEAR.coat)seq.push(next=>{/* GRAB: the right hand hangs the jacket on its peg: there as it appears on the peg */a.cr=[{hand:'Right',at:()=>gripHome('jacket'),k0:.45,k1:.69,hold:.04,k2:.95,lin:1}];visit(a,peg('jacketPeg'),.45,'hy_jacketoff',[[.25,()=>AU('unzip')],[.55,()=>{COAT.on=false;}],[.7,()=>{try{PP().setHere&&PP().setHere('jacket',true);}catch(e){}GEAR.coat=false;}]],()=>{a.cr=null;next();});});
  const run=i=>{if(i>=seq.length){then();return;}seq[i](()=>run(i+1));};run(0);}
 /* OUTDOOR: the lantern on a water run (Lights: at night he went to the pond in the dark). The take and the put-back are the
    right hand's (hy_take at the bench); the bucket is the right hand's too, so in between the lantern goes over into the LEFT
    hand: standing, both fists meet in front of his belly, the left closes on the bail beside the right, the right lets go */
 const LSW={a:null};let lswOn=0;
 function lanternLeft(){const l=PP().tools&&PP().tools.lantern;return !!(l&&l.parent===bones.LeftHand);}
 function lanternSwap(a,from,to,then){const l=PP().tools&&PP().tools.lantern;if(!l||l.parent!==bones[from+'Hand']){then();return;}
  play(IDLE(),{fade:.3});H.path.length=0;const E=LB.end&&LB.end.act===a&&from==='Right'?LB.end.p:null;LB.end=null;LSW.a={act:a,from,to,t:0,done:0,then,p0:E};H.wait={t:1.25,then:()=>{const S=LSW.a;LSW.a=null;if(S&&!S.done)lswHand(S);then();}};
  if(!lswOn){lswOn=1;lateFn(lswLate);}}
 function lswHand(S){S.done=1;try{PP().grab('lantern',bones[S.to+'Hand'],{offset:V(0,.06,.03)});const Lg=window.__lights;if(Lg&&GEAR.lantern){Lg.detachHand();Lg.attachHand(bones[S.to+'Hand']);Lg.set('hand',true);}}catch(e){}AU('cloth');}
 function lswLate(){const S=LSW.a;if(!S||act!==S.act){LSW.a=null;return;}S.t+=1/60;const t=S.t;const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
  const M=bones.Hips.getWorldPosition(V()).addScaledVector(f,.27).add(V(0,.1,0));/* in front of the belly, the lantern hanging below the fists */
  const sd=s=>s==='Right'?1:-1;const wF=(S.p0?1:smooth(0,.4,t))*(1-smooth(.62,.95,t)),wT=smooth(.15,.5,t)*(1-smooth(.85,1.2,t));
  if(wF>.01){const mf=M.clone().addScaledVector(r,.035*sd(S.from));odReach(S.from,S.p0?S.p0.clone().lerp(mf,smooth(0,.4,t)):mf,wF);}/* straight on from where the take left the fist at his side */if(wT>.01)odReach(S.to,M.clone().addScaledVector(r,.035*sd(S.to)).add(V(0,.01,0)),wT);
  if(!S.done&&t>.55)lswHand(S);H.look=M;H.lookW=.6*Math.max(wF,wT);
  /* it hangs plumb from its bail the whole time: the fists turn to meet and it lay over on its side between them (film) */
  lanternPlumb();}
 function lanternPlumb(){const l=PP().tools.lantern;if(l&&(l.parent===bones.LeftHand||l.parent===bones.RightHand)){const G=window.__grab;const g=V(...((G&&G.GRIP&&G.GRIP.lantern&&G.GRIP.lantern.g)||[0,.24,0]));l.updateMatrixWorld(true);const gw=l.localToWorld(g.clone()),sc=l.getWorldScale(V());
   const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,root.rotation.y,0,'YXZ'));const wp=gw.sub(g.clone().multiply(sc).applyQuaternion(q));const M2=new THREE.Matrix4().compose(wp,q,sc);l.parent.updateWorldMatrix(true,false);M2.premultiply(l.parent.matrixWorld.clone().invert());M2.decompose(l.position,l.quaternion,l.scale);l.updateMatrixWorld(true);}}
 function lswLeave(a){const S=LSW.a;if(S&&S.act===a){LSW.a=null;H.wait=null;if(!S.done)lswHand(S);}}
 function gearSync(){try{const T=PP().tools||{};const on=o=>{for(let p=o&&o.parent;p;p=p.parent)if(p===root)return true;return false;};if(on(T.bow)||on(T.quiver))GEAR.bow=true;if(on(T.lantern))GEAR.lantern=true;}catch(e){}}
 function dropGearNow(){if(GEAR.coat&&COAT){COAT.on=false;try{PP().setHere&&PP().setHere('jacket',true);}catch(e){}GEAR.coat=false;}
  for(const n of ['bow','quiver','lantern','meatBag','logArmful','waterBucket','drainBucket','plate'])try{PP().release(n);}catch(e){}
  if(GEAR.lantern)try{window.__lights.set('hand',false);window.__lights.detachHand();}catch(e){}GEAR.bow=GEAR.lantern=false;try{window.__audio.carry(false);}catch(e){}H.carry=null;}
 // ---- OUTDOOR helpers (self-contained on this hero.js): reach with a little lean, the palm (not the wrist) on a point,
 // and a tool driven in the world while the hands hold its handle (the tool follows the real palm, never floats off it)
 const OD_PALM=.07;
 function odPalm(side){const h=bones[side+'Hand'].getWorldPosition(V()),f=bones[side+'ForeArm'].getWorldPosition(V());return h.add(h.clone().sub(f).normalize().multiplyScalar(OD_PALM));}
 function odPalmTo(side,t){return t?odPalm(side).distanceTo(t):9;}
 const odLean={Left:{v:0,f:-9},Right:{v:0,f:-9}};let odFrame=0,odFrameOn=0;
 function odReach(side,t,w){/* OUTDOOR: palm-target reach (targets here are odPalm points); the kitchen's reachGrip aims the fist's grip point */const sh=bones[side+'Arm'];if(!sh||!t)return;
  if(!odFrameOn){odFrameOn=1;stage('pre',()=>{odFrame++;});}
  /* the lean toward a target out of reach is rate-limited (~1.1 rad/s): it used to follow 3x the shortfall in one frame, so a target
     sliding out of or into reach threw the head 8 cm/frame² (gate: fetchwater shelf) */
  const L=odLean[side];const again=L.f===odFrame;const prev=L.f>=odFrame-1?L.v:0;let want=0,ax=null;if(!again){
  {const hp=bones.Hips.getWorldPosition(V());const s0=sh.getWorldPosition(V());const ex=s0.distanceTo(t)-(armLen*.92+OD_PALM);const d=V(t.x-hp.x,0,t.z-hp.z);
   if(ex>.01&&d.lengthSq()>1e-4){d.normalize();const fd=d.dot(fwd(root.rotation.y));/* never arch backwards to reach (a banana back at the top of the axe swing); fading out as the target comes round beside him */
    if(fd>-.1){ax=V(0,1,0).cross(d).normalize();want=Math.min(REACH_LEAN,ex*3.4)*clamp(w,0,1)*smooth(-.1,.35,fd);}}}
  const v=prev+clamp(want-prev,-.019,.019);L.v=v;L.f=odFrame;if(ax)L.ax=ax;else ax=L.ax;
  if(ax&&v>.002){rotW(bones.Spine,ax,v*.45);rotW(bones.Spine1,ax,v*.35);rotW(bones.Spine2,ax,v*.2);}}/* once a frame: a second reach in the same frame (a guard re-place) only moves the arm */
  const s1=sh.getWorldPosition(V());const tw=t.clone().sub(s1);const tl=tw.length();const wt=tl>OD_PALM*1.5?s1.clone().addScaledVector(tw,(tl-OD_PALM)/tl):t;armIK(side,wt,sidePole(side),clamp(w,0,1));}
 // the axe in the world: head at `head`, handle running from the head along -dir, edge toward `blade`
 const _odM=new THREE.Matrix4();
 function axeWorld(head,dir,blade){const P=PP();const ax=P&&P.tools&&P.tools.axe;if(!ax)return;if(ax.parent!==scene)scene.attach(ax);
  const y=dir.clone().normalize();const x=blade.clone().addScaledVector(y,-blade.dot(y)).normalize();const z=x.clone().cross(y);_odM.makeBasis(x,y,z);
  ax.quaternion.setFromRotationMatrix(_odM);ax.position.copy(head);const hs=ax.userData.home&&ax.userData.home.scale;ax.scale.setScalar(hs||1);ax.visible=true;ax.updateMatrixWorld(true);}
 const AXE_G=.56;/* the right fist this far below the head along the handle */
 // ---- OUTDOOR: wood splitting (MAKE.splitwood) -------------------------------------------------------------------------
 const SPL_RH=.26,SPL_RR=.115,SPL_T={place:4.4,pre:1.2,swing:1.9,after:.9};
 const SPLM={bark:new THREE.MeshStandardMaterial({color:0x5a4330,roughness:.95}),wood:new THREE.MeshStandardMaterial({color:0xcfa572,roughness:.85})};
 // a sawn round (bark round the side, pale end grain) and the half of one (flat split face)
 function roundMesh(){splGuard();const g=new THREE.Group();g.userData.splRound=1;const c=new THREE.Mesh(new THREE.CylinderGeometry(SPL_RR*.97,SPL_RR,SPL_RH,14),[SPLM.bark,SPLM.wood,SPLM.wood]);c.position.y=SPL_RH/2;g.add(c);c.castShadow=true;return g;}
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
  N.g_block={p,face:Math.atan2(-u.x,-u.z)};
  /* WALK: the straight line from the nearest node to the block ran over the oak's big root (70 cm high): the body walked through
     it at 20 cm while the feet stood on top, knees up at the hips (gate: splitwood right leg 20-54 cm jumps). Walk round the roots:
     a grid search over the root map, kept as tight waypoints */
  const way=G&&G.rootTop?rootDetour(b,p):null;let prev=best;if(way)way.forEach((q,i)=>{const k='g_blk'+i;N[k]={p:q,tight:true};(adj[prev]=adj[prev]||[]).push({to:k});(adj[k]=adj[k]||[]).push({to:prev});prev=k;});
  (adj.g_block=adj.g_block||[]).push({to:prev});(adj[prev]=adj[prev]||[]).push({to:'g_block'});}
 // waypoints from a to b over the ground that stay off the roots (rootTop < 12 cm within a sole's reach); null if the line is clear
 function rootDetour(a,b){const G=window.__ground;const R=(x,z)=>{let m=0;for(const [ox,oz] of [[0,0],[.22,0],[-.22,0],[0,.22],[0,-.22]])m=Math.max(m,G.rootTop(x+ox,z+oz));return m;};
  const clear=(p,q)=>{const n=Math.ceil(Math.hypot(q.x-p.x,q.z-p.z)/.08);for(let i=0;i<=n;i++){const t=i/n;if(R(p.x+(q.x-p.x)*t,p.z+(q.z-p.z)*t)>.12)return false;}return true;};
  if(clear(a,b))return null;const S=.25,x0=Math.min(a.x,b.x)-4,z0=Math.min(a.z,b.z)-4,nx=Math.ceil((Math.abs(a.x-b.x)+8)/S),nz=Math.ceil((Math.abs(a.z-b.z)+8)/S);
  const id=(i,j)=>i*nz+j,cx=i=>x0+i*S,cz=j=>z0+j*S,ok=new Uint8Array(nx*nz);for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)ok[id(i,j)]=R(cx(i),cz(j))<=.12?1:0;
  const ia=Math.round((a.x-x0)/S),ja=Math.round((a.z-z0)/S),ib=Math.round((b.x-x0)/S),jb=Math.round((b.z-z0)/S);ok[id(ia,ja)]=ok[id(ib,jb)]=1;
  const g=new Float32Array(nx*nz).fill(1e9),from=new Int32Array(nx*nz).fill(-1),done=new Uint8Array(nx*nz);g[id(ia,ja)]=0;const open=[id(ia,ja)];
  while(open.length){let bi=0;for(let k=1;k<open.length;k++)if(g[open[k]]+Math.hypot(cx((open[k]/nz)|0)-b.x,cz(open[k]%nz)-b.z)<g[open[bi]]+Math.hypot(cx((open[bi]/nz)|0)-b.x,cz(open[bi]%nz)-b.z))bi=k;
   const c=open.splice(bi,1)[0];if(done[c])continue;done[c]=1;if(c===id(ib,jb))break;const ci=(c/nz)|0,cj=c%nz;
   for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){if(!di&&!dj)continue;const i=ci+di,j=cj+dj;if(i<0||j<0||i>=nx||j>=nz)continue;const n=id(i,j);if(!ok[n]||done[n])continue;const ng=g[c]+S*Math.hypot(di,dj);if(ng<g[n]){g[n]=ng;from[n]=c;open.push(n);}}}
  if(from[id(ib,jb)]<0)return null;const cells=[];for(let c=id(ib,jb);c>=0;c=from[c])cells.push(V(cx((c/nz)|0),0,cz(c%nz)));cells.reverse();cells[0]=a.clone();cells[cells.length-1]=b.clone();
  // keep only the corners: from each kept point, the farthest cell still in clear sight
  const out=[];let k=0;while(k<cells.length-1){let f=k+1;for(let m=cells.length-1;m>k+1;m--)if(clear(cells[k],cells[m])){f=m;break;}if(f<cells.length-1){const q=cells[f].clone();q.y=G.heightAt?G.heightAt(q.x,q.z):a.y;out.push(q);}k=f;}
  return out.length?out:null;}
 function splitStock(S,n){// the rounds he sawed earlier stand by the block; topped up only while he is away from it (never under his eyes)
  if(S.stack.length>=n)return;const G=window.__ground;const c=S.top;const st=N.g_block?N.g_block.p.clone():root.position.clone();const d=V(c.x-st.x,0,c.z-st.z).normalize();const r=V(d.z,0,-d.x);/* his left */
  /* the rounds stand on a low pallet (13 cm: kept off the wet ground). Picked up from the bare ground the top of a round is 26 cm
     up, and a squat with a straight back only gets the hand down to about 40 cm (the clip thread's limit) */
  if(!S.pallet){const rows=Math.max(2,Math.ceil((n+1)/2));const pc=st.clone().addScaledVector(r,.42).addScaledVector(d,.42-(rows-1)*.12);pc.y=G&&G.heightAt?G.heightAt(pc.x,pc.z):pc.y-.42;
   const g=new THREE.Group();const M=SPLM.pal||(SPLM.pal=new THREE.MeshStandardMaterial({color:0x6e5238,roughness:.92}));const L=.26+rows*.24;
   for(const x of [-.19,0,.19]){const b=new THREE.Mesh(new THREE.BoxGeometry(.07,.09,L),M);b.position.set(x,.045,0);b.castShadow=true;g.add(b);}
   for(let k=0;k<Math.round(L/.13);k++){const b=new THREE.Mesh(new THREE.BoxGeometry(.54,.035,.1),M);b.position.set(0,.09+.0175,-L/2+.065+k*((L-.13)/Math.max(1,Math.round(L/.13)-1)));b.castShadow=b.receiveShadow=true;g.add(b);}
   g.position.copy(pc);g.rotation.y=Math.atan2(d.x,d.z);scene.add(g);S.pallet=g;S.pc=pc;S.pd=d.clone();S.pL=L;S.ptop=pc.y+.125;}
  while(S.stack.length<n+1){const i=S.stack.length;const m=roundMesh();const p=st.clone().addScaledVector(r,.3+(i%2)*.24).addScaledVector(d,.42-Math.floor(i/2)*.24);/* in front, to his left: the squat reaches it */p.y=S.ptop;m.position.copy(p);m.rotation.y=Math.random()*6;scene.add(m);S.stack.push(m);}
  while(S.halves.length>12){const h=S.halves.shift();scene.remove(h);}}
 /* a round never rides along out of the split job: if the task was cut off (or ended) with it in the hand, it is set down on the
    ground under the hand (integrator gate, orig: 'held passes through the shins' x137 on ladders and seats after splitwood) */
 let splGuardOn=0;function splGuard(){if(splGuardOn)return;splGuardOn=1;stage('pre',()=>{const hb=bones.LeftHand;if(!hb)return;
  for(const ch of hb.children.slice()){if(!ch.userData||!ch.userData.splRound)continue;const A=act;if(A&&A.axeOn&&A.rd===ch&&H.task==='splitwood')continue;
   scene.attach(ch);const p=ch.position;let gy=p.y-.3;try{gy=window.__ground.heightAt(p.x,p.z);}catch(e){}p.y=gy;ch.quaternion.set(0,0,0,1);ch.updateMatrixWorld(true);if(A&&A.rd===ch)A.rd=null;}});}
 let rdLateOn=0;function roundLock(a,rd){const hb=bones.LeftHand;hb.updateWorldMatrix(true,false);const wp=odPalm('Left').sub(a.rOff);if(a.cTop&&wp.y>a.cTop.y+.02)a.overTop=1;if(!a.overTop&&a.r0&&wp.y<a.r0.y)wp.y=a.r0.y;/* never pressed down into the pallet it stood on */if(a.cTop&&a.overTop&&Math.hypot(wp.x-a.cTop.x,wp.z-a.cTop.z)<.42)wp.y=Math.max(wp.y,a.cTop.y+.003);/* only once it has been lifted over it: the stock stands within 42 cm of the block and the round popped up 45 cm the moment he took it *//* over the block it rests on its top, never sinks into it */const M=new THREE.Matrix4().compose(wp,a.rQ,rd.getWorldScale(V()));M.premultiply(hb.matrixWorld.clone().invert());M.decompose(rd.position,rd.quaternion,rd.scale);rd.updateMatrixWorld(true);a.rW=wp.clone();}
 /* OUTDOOR: deep down for a round the heels come up off the ground: past what an ankle bends (his standing angle + 24 deg) the foot
    turns about its planted toes, the ankle rises and the knee and hip take the rest (gate: floor pick, ankle bent up 43-44 deg past neutral) */
 function ankAng(s){const K=bones[s+'Leg'].getWorldPosition(V()),A=bones[s+'Foot'].getWorldPosition(V()),T=bones[s+'ToeBase'].getWorldPosition(V());return A.clone().sub(K).normalize().angleTo(T.clone().sub(A).normalize());}
 function heelUp(a){if(!a.ank0)return;for(const s of ['Left','Right']){const L=bones[s+'Leg'],F=bones[s+'Foot'],Tb=bones[s+'ToeBase'];if(!L||!F||!Tb)continue;
   const lim=a.ank0[s]+.42;let ang=ankAng(s);if(ang<=lim)continue;
   const K=L.getWorldPosition(V()),A=F.getWorldPosition(V()),T=Tb.getWorldPosition(V());const sh=A.clone().sub(K).normalize(),ft=T.clone().sub(A);const ax=sh.clone().cross(ft).normalize();if(ax.lengthSq()<1e-6)continue;
   /* the foot turned about the toe by the excess (toe stays, heel rises): its new ankle */const ft2=ft.clone().applyAxisAngle(ax,-(ang-lim));const A2=T.clone().sub(ft2);
   const hp=bones[s+'UpLeg'].getWorldPosition(V());const pole=K.clone().sub(hp.clone().add(A).multiplyScalar(.5)).normalize();
   ik2(bones[s+'UpLeg'],L,F,A2,pole,1,true);
   /* the toes back on their spot */const A3=F.getWorldPosition(V()),cur=Tb.getWorldPosition(V()).sub(A3),want=T.clone().sub(A3);const ax2=cur.clone().cross(want);const an=cur.angleTo(want);if(ax2.lengthSq()>1e-9&&an>1e-3)rotW(F,ax2.normalize(),an);}}
 let huOn=0;
 // a short walk to a spot, facing 'face' at the end (turn, step, turn as approachTo); returns its length in s
 function splSlide(q,face,spd){const p=root.position;const mv=Math.hypot(q.x-p.x,q.z-p.z);const d=Math.max(.4,mv/spd,Math.abs(wrapA(face-root.rotation.y))/2.4);
  H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(face-root.rotation.y),k:0,d};if(mv>.35){const yT=Math.atan2(q.x-p.x,q.z-p.z);const S=H.slide;S.y0=root.rotation.y;S.yT=root.rotation.y+wrapA(yT-root.rotation.y);S.yF=S.yT+wrapA(face-yT);
   const t1=Math.abs(wrapA(yT-root.rotation.y))/2.6,t2=mv/spd,t3=Math.abs(wrapA(face-yT))/2.6;S.d=Math.max(d,t1+t2+t3);S.a=t1/S.d;S.b=(t1+t2)/S.d;}
  if(mv>.06)play('30',{fade:.3,speed:1});return H.slide.d;}
 function splitPost(a,dt,S){const P=PP();const ax=P&&P.tools&&P.tools.axe;if(!ax||!a.axeOn)return;
  const T=SPL_T;a.pt+=dt;const c=S.top;const rp=root.position;const d=V(c.x-rp.x,0,c.z-rp.z);const hd=d.length();d.normalize();const r=V(-d.z,0,d.x),up=V(0,1,0);
  H.face=Math.atan2(d.x,d.z);
  const hits=a.plan[a.ri];if(hits==null){a.w=Math.max(0,(a.w||0)-dt/.4);H.squat=0;return;}
  if(!huOn){huOn=1;lateFn(()=>{const A=act;if(A&&A.axeOn&&A.ph==='place'&&A.huOK)heelUp(A);});}
  if(a.ph==='lead'){axeRest(a,d,smooth(0,.5,a.pt));if(a.pt>.45&&!a.ank0)a.ank0={Left:ankAng('Left'),Right:ankAng('Right')};/* his standing ankle, for heelUp */if(a.pt>.6){a.ph='place';a.pt=0;a.pk=0;/* the tool take left its own pk set: the first round got no squat clip at all */}return;}
  // 1. a round from the stack onto the block: squat, left palm on its top, lift, stand it on the block
  if(a.ph==='place'){a.cTop=c;if(!a.axDn){axeDown(a,c,d,r,rp,dt);return;}const u=a.pt/T.place;let rd=a.rd;if(!rd){rd=a.rd=S.stack.pop()||(()=>{const m=roundMesh();m.position.copy(c).addScaledVector(r,.5);m.position.y-=.42;scene.add(m);return m;})();a.r0=rd.position.clone();}
   // the body: real mocap squat-and-lift (hy_pickground, CMU: hips lowest 0.9-1.3 s); without it a code squat
   /* first a step over to the round: it stands by the block, beside where he swings (60 cm to his side his hands never got to it,
      in master too: the round was split where it lay); he faces it, 33 cm out in front of his hips (closer, his boots touched it and the shuffle back woke the walk legs), between his feet */
   if(a.pre==null){/* the nearest spot 37 cm off the round (34: shins 4 cm into it as he took it) that keeps his boots (and his way there) off the pallet */let v=V(a.r0.x-rp.x,0,a.r0.z-rp.z).normalize();
    if(S.pc){const inP=(x,z,m)=>{const dx=x-S.pc.x,dz=z-S.pc.z,D=S.pd;return Math.abs(dx*D.z-dz*D.x)<.29+m&&Math.abs(dx*D.x+dz*D.z)<S.pL/2+m;};let best=null,bd=1e9;
     for(let k=0;k<16;k++){const an=k*Math.PI/8;const u=V(Math.sin(an),0,Math.cos(an));const q=a.r0.clone().addScaledVector(u,.37);q.y=rp.y;if(inP(q.x,q.z,.16))continue;{const q2=q.clone();pushOut(q2);if(Math.hypot(q2.x-q.x,q2.z-q.z)>.03)continue;}/* not in the block or anything else (pushed out of the block, the spot landed on the round) */let ok=true;for(let f=.15;f<.96;f+=.1)if(inP(lerp(rp.x,q.x,f),lerp(rp.z,q.z,f),.1)){ok=false;break;}
      const c=Math.hypot(q.x-rp.x,q.z-rp.z)+(ok?0:5);if(c<bd){bd=c;best=u;}}if(best)v=best.negate();}
    a.preF=Math.atan2(v.x,v.z);const q=a.r0.clone().addScaledVector(v,-.37);q.y=rp.y;pushOut(q);a.pre=Math.hypot(q.x-rp.x,q.z-rp.z)>.05||Math.abs(wrapA(a.preF-root.rotation.y))>.1?splSlide(q,a.preF,.7)+.1:0;}
   if(!a.st1)H.face=a.preF;
   /* the squat waits for the motion-matched legs to finish their last step (they hold the lower body until settled: the first
      round squatted 1.1 s late, standing legs under a bent back, hips not below 0.68) */
   {const M=window.__motion&&window.__motion.S;if(!a.pk&&a.pt>=a.pre&&M&&M.on&&(a.preW=(a.preW||0)+dt)<.9)a.pre+=dt;}
   const t=(a.pt-a.pre)/(PICKC()==='hy_floorpick'?durOf('hy_floorpick')/2.333:1);a.huOK=t>0&&t<2.05&&PICKC()!=='hy_logpick';/* hy_logpick lifts the heels itself (ankles within 11 deg): the extra turn about the toes kicked the knees 11 cm/frame² *//* heels up only in the deep squat: during the steps a near-straight knee flipped its IK pole (gate: knee 26 cm/frame²) */if(t<0){H.squat=0;axeHold(a,V(Math.sin(root.rotation.y),0,Math.cos(root.rotation.y)));return;}/* the knee-safe pickup runs 3 s (sped up to 2.33 s it jerked the head 26): the place timings stretch with it */if(!a.pk){a.pk=1;if(has(PICKC()))once(PICKC(),{fade:.3});}const PK=has(PICKC());
   H.squat=(PK?0:.42*smooth(.15,.8,t)*(1-smooth(1.3,1.9,t)))+.11*smooth(2.5,2.95,t)*(1-smooth(3.55,3.95,t));/* and still down for the axe at the block's side *//* bends only once the step in has landed: squatting mid-stride bent the ankle up 53 deg (gate foot-bend) *//* knees bend to set the round down on the block (standing, the palm stayed 14 cm high and the round dropped) */const fwY=root.rotation.y,lftV=V(Math.cos(fwY),0,-Math.sin(fwY));const tp=rd.getWorldPosition(V()).add(V(0,SPL_RH+.01,0)).addScaledVector(lftV,SPL_RR*.62);/* R55-1: both hands take it by its top rim, left and right (it stands packed against the next ones on the stack, there is no room at its sides), and slide down its sides as it comes up: carried in both hands, not hung from the fingertips of one */const sideK=smooth(1.15,1.85,t);const sideOff=(s0=>V(0,SPL_RH*.55,0).addScaledVector(s0,SPL_RR+.015))(lftV);
   const w=smooth(.35,.85,t)*(1-smooth(3.0,3.3,t));
   if(rd.parent===bones.LeftHand&&(t>3.05||(t>2.9&&rd.getWorldPosition(V()).distanceTo(c)<.04))){scene.attach(rd);if(a.rW){rd.position.copy(a.rW);rd.quaternion.copy(a.rQ);}/* from where it was last frame (the hand has already moved on this frame) */a.settle={p:rd.position.clone(),q:rd.quaternion.clone(),t:0};a.placed=1;}
   if(a.settle){/* set down: the last few cm with the palm still on it, then the knock of wood on wood */const S2=a.settle;S2.t=Math.min(1,S2.t+dt/.4)/* pushed the last bit across the block top */;rd.position.lerpVectors(S2.p,c,smooth(0,1,S2.t));rd.quaternion.slerpQuaternions(S2.q,new THREE.Quaternion().setFromEuler(new THREE.Euler(0,S2.yaw??(S2.yaw=Math.random()*6),0)),S2.t);if(S2.t>=1){a.settle=null;AU('wood',c);}}
   let at=tp;if(rd.parent===bones.LeftHand){/* up first, straight in front of him, to just over the block-top height (the round low before
    him went through his shins as he rose: gate 8.8 cm), then over to the block once he has stepped in, and down onto it */
    const kU=smooth(1.2,1.95,t),kH=smooth(2.45,2.95,t);const fw=V(Math.sin(root.rotation.y),0,Math.cos(root.rotation.y));if(a.carD==null)a.carD=clamp(Math.hypot(a.r0.x-rp.x,a.r0.z-rp.z),.34,.5);const fr=rp.clone().addScaledVector(fw,a.carD).addScaledVector(V(fw.z,0,-fw.x),.06);/* carried at the same reach in front of him (never pulled in toward the knees as he rises: gate 7.5 cm), on his left *//* held out in front of him while he rises and steps (made from the ground spot to the block, the path ran through his thighs as he stepped in: gate 10 cm) */const want=a.r0.clone().lerp(fr,kU).lerp(c,kH);want.y=a.r0.y+(c.y+.08-a.r0.y)*kU-.08*smooth(2.75,3.0,t);
    if(a.rOff0)a.rOff=a.rOff0.clone().lerp(sideOff,sideK);at=want.add(a.rOff||sideOff);/* the fixed palm-to-round offset from the grip (the palm now minus the round as last placed mixed two frames' poses: the target swung 25 cm in toward his shins) */}
   else if(a.placed)at=c.clone().add(sideOff);
   if(w>.01)odReach('Left',at,w);a.lk=at;
   {/* the right hand: on the round's right side until it stands on the block, then over to the leant axe's handle and up with it */const rgtV=lftV.clone().negate();const rs=rd.getWorldPosition(V()).add(V(0,SPL_RH+.01,0).lerp(V(0,SPL_RH*.55,0),rd.parent===bones.LeftHand?sideK:0)).addScaledVector(rgtV,rd.parent===bones.LeftHand?lerp(SPL_RR*.62,SPL_RR+.015,sideK):SPL_RR*.62);let tR=rs,wR=w;
    if(a.lean&&!a.axUp){const g=a.lean.grip;tR=rs.lerp(g,smooth(3.0,3.35,t));wR=t<3.0?w:1;if(t>3.3&&(odPalmTo('Right',g)<.07||t>3.55)){a.axUp=1;a.axUt=t;AU('wood',g);}}
    else if(a.axUp){wR=1-smooth(a.axUt+.05,a.axUt+.45,t);tR=a.lean.grip;}
    if(wR>.01){const RL=REACH_LEAN;if(!a.lean||!a.axDn||t<3.0)REACH_LEAN=0;/* the left arm's reach already bends him to the round: a second lean from this arm fought it (head jitter 9.8 in the squat) */try{odReach('Right',tR,wR);}finally{REACH_LEAN=RL;}}}
   axeHold(a,d,t);
   // a step in to set the round on the block (it is out of reach from where he swings), and a step back out after
   const step=(dist,back)=>{const q=c.clone().addScaledVector(d,-dist);const sx=q.x-rp.x,sz=q.z-rp.z;H.slide={x:sx,z:sz,yaw:wrapA(Math.atan2(d.x,d.z)-root.rotation.y)/* from the round back square to the block */,k:0,d:Math.max(.45,Math.hypot(sx,sz)/(back?.55:.75),Math.abs(wrapA(Math.atan2(d.x,d.z)-root.rotation.y))/2.4)};play('30',{fade:.4});if(actions['30'])actions['30'].timeScale=back?-.8:1;};
   if(t>(PK&&PICKC()==='hy_floorpick'?2.0:PICKC()==='hy_logpick'?2.1:1.85)&&!a.st1){a.st1=1;step(.66,false);}/* the knee-safe pickup is up only at 2.0 s: the step blends in after it (gate: head jerk 26 from a squat cut into the walk) */if(t>2.75&&!a.st1b){a.st1b=1;play(IDLE(),{fade:.3});}
   if(t>3.55&&!a.st2){a.st2=1;step(1.05,true);}if(t>4.2&&!a.st2b){a.st2b=1;if(actions['30'])actions['30'].timeScale=1;play(IDLE(),{fade:.3});}
   /* the palm is on its top now (after the reach this frame): it comes up with the hand */if(t>1.02&&rd.parent!==bones.LeftHand&&!a.placed&&odPalmTo('Left',tp)<.08){bones.LeftHand.updateWorldMatrix(true,false);bones.LeftHand.attach(rd);AU('wood',tp);a.rOff=odPalm('Left').sub(rd.getWorldPosition(V()));a.rOff0=a.rOff.clone();{const e=new THREE.Euler().setFromQuaternion(rd.getWorldQuaternion(new THREE.Quaternion()),'YXZ');a.rQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,e.y,0,'YXZ'));/* stood upright, whatever it was knocked to on the stack */}}
   /* fingers round its top rim: the round stays upright under the palm, it never swings tilted beside the hand (film: it hung 30 deg off at his side) */
   if(!rdLateOn){rdLateOn=1;lateFn(()=>{const A=act;const r2=A&&A.rd;if(!r2||!A.rOff||r2.parent!==bones.LeftHand)return;roundLock(A,r2);});}/* again after the pose guard moved the hand */
   if(rd.parent===bones.LeftHand&&a.rOff)roundLock(a,rd);
   /* the round on the ground before him: his boots and shins stay off it while he bends for it (full gate: feet 9 cm in it) */if(rd.parent===scene&&!a.placed&&t<1.3&&!S.pc)kneesClear(rd,dt,true);/* on the pallet his spot is chosen clear of it: the shuffle back pushed him 30 cm off the round (and woke the walk legs) */
   if(t>=T.place){a.overTop=0;a.carD=null;a.pre=null;a.preW=0;a.rOff=null;a.rOff0=null;a.rW=null;a.ph='swing';a.pt=0;a.hit=0;a.lk=null;a.pk=0;a.placed=0;a.settle=null;a.st1=a.st1b=a.st2=a.st2b=0;a.axDn=0;a.axUp=0;a.lean=null;a.axT=null;a.axRel=0;}return;}
  // 2. the swing: angle th round a pivot just in front of the shoulders, in the vertical plane through the round
  const Ls=bones.LeftArm.getWorldPosition(V()),Rs=bones.RightArm.getWorldPosition(V());const piv=Ls.clone().add(Rs).multiplyScalar(.5).addScaledVector(d,.06).add(V(0,-.04,0));
  const tgt=c.clone().add(V(0,SPL_RH-.015,0));const q=tgt.clone().sub(piv);const qh=V(q.x,0,q.z).length();const rH=q.length();const thS=Math.atan2(q.y,qh);
  if(a.ph==='swing'){// the body is real mocap (hy_axechop, CMU: slow lift 1.2 s, fast drop 0.35 s, hit at 1.57 s of 1.9 s); the axe angle follows its phase
   const C='hy_axechop',cd=has(C)?durOf(C):1.9;if(!a.clipOn&&has(C)){a.clipOn=1;a.cyc0=a.cyc||0;play(C,{fade:.3});const A=actions[C];if(A)A.time=0;}
   const A=has(C)?actions[C]:null;const u=A?(A.time%cd)/cd:a.pt/T.swing;if(a.lu!=null&&u<a.lu-.5){a.struck=0;a.cyc=(a.cyc||0)+1;}a.lu=u;
   const last=a.hit+1>=hits;const thT=1.5,UT=.63,US=.82;/* top of the backswing just past vertical: further back the hands went behind his head and the body guard pulled them off the handle (film) */let th;
   if(u<UT)th=thS+(thT-thS)*smooth(0,UT,u);else if(u<US){const k=(u-UT)/(US-UT);th=thT+(thS-.05-thT)*k*k*(2.2-1.2*k);/* fast through the drop, a touch less at the very end: it slammed from full speed to a dead stop in one frame (gate: fist 11 cm/frame²) */}else th=thS-.05;
   if(u>=US&&!a.struck){a.struck=1;a.hit++;try{window.__audio&&window.__audio.contact?window.__audio.contact({tool:'axe',kind:'hit',pos:tgt.toArray(),strength:rnd(.8,1)}):AU('chop',tgt);}catch(e){AU('chop',tgt);}
    if(a.hit>=hits)splitRound(a,S,d,r);}
   if(u>US&&a.rd&&u<.95)th+=Math.sin((u-US)*60)*.025;/* stuck: rock the handle to free it */
   a.wl=Math.min(1,(a.wl??(a.w||0))+dt/.6);a.w=smooth(0,1,a.wl);H.squat=.04*a.w;/* eased in too: switched on at once it dropped the hips 4 cm in a frame *//* eased in: the linear ramp kicked the fists 10 cm/frame² at the start of the swing (gate) */
   {/* OUTDOOR (watcher R42-4): the first raise comes up from the axe hanging at his side; in the shoulders' middle plane the handle swung
     level across his forehead on the way. Up over the right shoulder instead (a real splitter lifts it past his ear), back to the middle for the drop */
    const k=(a.cyc||0)===(a.cyc0||0)?smooth(.02,.35,u)*(1-smooth(.4,UT,u)):0;holdAxe(a,k>.001?piv.clone().addScaledVector(r,.1*k).add(V(0,.02*k,0)):piv,d,r,th,rH,a.w,k>.001?th+(thT-th)*.75*k:null);}/* and the wrists cocked: the head of the axe comes up ahead of the hands, so the handle stands up past his ear while the fists go by his face (it lay level across his forehead) */
   if(a.hit>=hits&&u>.97){a.wl=null;a.pt=0;a.struck=0;a.clipOn=0;a.lu=null;a.ph='after';play(IDLE(),{fade:.6});}return;}
  if(a.ph==='after'){const u=a.pt/T.after;a.w=Math.max(0,1-smooth(0,.6,u));H.squat=.04*(1-u);axeRest(a,d,1);if(a.w>.01)holdAxe(a,piv,d,r,thS-.05+.3*smooth(0,.6,u),rH,a.w);
   if(u>=1){a.ri++;a.ph=a.plan[a.ri]!=null?'place':'done';a.pt=0;a.hit=0;}}}
 // the axe at rest in the right hand: hanging head down along the leg, the blade forward (never sticking out sideways)
 // OUTDOOR (watcher R55-1): the round goes from the stack to the block in both hands, so the axe is first leant against the block
 // (head on the ground at its right side, the handle on its rim) and taken back up once the round stands on the block
 function axeLeanPose(c,d,r){let gy=c.y-.5;try{gy=window.__ground.heightAt(c.x+r.x*.37,c.z+r.z*.37);}catch(e){}const h=c.clone().addScaledVector(r,.37).addScaledVector(d,-.06);h.y=gy+.05;
  const tp=c.clone().addScaledVector(r,.22).addScaledVector(d,-.14);tp.y=c.y-.03;const dir=h.clone().sub(tp).normalize();return {head:h,dir,blade:r.clone(),grip:h.clone().addScaledVector(dir,-AXE_G)};}
 function axeHold(a,d,t){const L=a.lean;if(L&&a.axDn&&!a.axUp){axeWorld(L.head,L.dir,L.blade);return;}
  if(L&&a.axUp&&t!=null&&t-a.axUt<.4){const k=smooth(0,.4,t-a.axUt);const gp=odPalm('Right');const hang=V(0,-1,0).addScaledVector(d,.22).normalize();const dn=L.dir.clone().lerp(hang,k).normalize();axeWorld(gp.clone().addScaledVector(dn,AXE_G),dn,L.blade.clone().lerp(d,k));return;}
  axeRest(a,d,1);}
 function axeDown(a,c,d,r,rp,dt){if(!a.lean)a.lean=axeLeanPose(c,d,r);const L=a.lean;
  if(a.axT==null){a.axT=0;const q=c.clone().addScaledVector(d,-.5);q.y=rp.y;a.axSl=Math.hypot(q.x-rp.x,q.z-rp.z)>.05?splSlide(q,Math.atan2(d.x,d.z),.7)+.05:0;}/* a step in to the block's side */
  a.axT+=dt;const t=a.axT-a.axSl;if(t<0){axeRest(a,d,1);return;}
  H.squat=.14*smooth(0,.35,t)*(1-smooth(.75,1.05,t));const w=smooth(0,.4,t)*(1-smooth(.7,1.0,t));if(w>.01)odReach('Right',L.grip,w);
  const k=smooth(.3,.55,t);if(k<1){const gp=odPalm('Right');const m=smooth(.05,.45,t);const dn=V(0,-1,0).addScaledVector(d,.22).normalize().lerp(L.dir,m).normalize();const hd=gp.clone().addScaledVector(dn,AXE_G).lerp(L.head,k);axeWorld(hd,dn.lerp(L.dir,k).normalize(),d.clone().lerp(L.blade,m));}
  else{axeWorld(L.head,L.dir,L.blade);if(!a.axRel){a.axRel=1;AU('wood',L.head);}}
  if(t>1.05){a.axDn=1;a.pt=0;H.squat=0;}}
 function axeRest(a,d,w){const gp=odPalm('Right');let dn=V(0,-1,0).addScaledVector(d,.22).normalize();
  // squatting, the head is never in the ground: the handle leans forward until the head just rests on the earth
  let gy=0;try{gy=window.__ground.heightAt(gp.x,gp.z);}catch(e){}const room=gp.y-(gy+.07);if(AXE_G*-dn.y>room){const v=clamp(room/AXE_G,-.2,1);dn=d.clone().setY(0).normalize().multiplyScalar(Math.sqrt(1-v*v)).add(V(0,-v,0)).normalize();}axeWorld(gp.clone().addScaledVector(dn,AXE_G),dn,d.clone());}
 // both hands on the axe handle: right hand at the tool's grip, left hand at the handle's end; the blade faces the way it swings
 function holdAxe(a,piv,d,r,th,rH,w,thA){const dirG=d.clone().multiplyScalar(Math.cos(th)).add(V(0,Math.sin(th),0));if(thA==null)thA=th;const dir=d.clone().multiplyScalar(Math.cos(thA)).add(V(0,Math.sin(thA),0));const tan=d.clone().multiplyScalar(-Math.sin(thA)).add(V(0,Math.cos(thA),0));
  const gR=piv.clone().addScaledVector(dirG,rH-AXE_G);const gL=gR.clone().addScaledVector(dir,-(rH-AXE_G-Math.max(.22,rH-.67))).addScaledVector(r,.01);/* thA: the handle's own angle (cocked wrists); the left fist stays on the handle below the right */
  odReach('Right',gR,w);odReach('Left',gL,w*.95);/* right first: its trunk lean moved the left shoulder and slid the left hand off the handle */
  // the axe goes where the right fist really is (contact first); while blending out it hangs from the fist
  const pR=odPalm('Right');const hang=V(0,-1,0).addScaledVector(d,.22).normalize();const dd=hang.lerp(dir,w).normalize();axeWorld(pR.clone().addScaledVector(dd,AXE_G),dd,tan.clone().negate().lerp(d,1-w));a.dbg=[gR,gL];a.axeLate={w,dd:dd.clone(),blade:tan.clone().negate().lerp(d,1-w)};
  // the guard (last pose step) can still pull the arms back a few cm at the top of the swing: the axe is set again from where
  // both fists really ended up, the handle through both of them (film: hands off the handle above his head)
  if(!axeLateOn){axeLateOn=1;lateFn(()=>{const A=act;const L=A&&A.axeLate;if(!L)return;A.axeLate=null;const ax=PP().tools.axe;if(!ax||ax.parent!==scene)return;
   const pR=odPalm('Right'),pL=odPalm('Left');const v=pR.clone().sub(pL);const l=Math.max(1e-3,v.length());v.divideScalar(l);
   /* faded in and out, not switched, and eased over a few frames: the guard shifts the fists a little differently every frame at
      the top, and the handle put straight through them snapped about with it (Grab: the axe 27-38 cm in one frame) */
   const k=smooth(.85,1,L.w)*smooth(.1,.16,l)*(1-smooth(.5,.6,l))*smooth(.2,.5,v.dot(L.dd));const dv=L.dd.clone().lerp(v,k).normalize();
   const head0=ax.position.clone();const want=pR.clone().addScaledVector(dv,AXE_G).sub(head0).multiplyScalar(k);const wantD=dv.sub(L.dd);
   const C=A.axC||(A.axC={p:V(),d:V()});C.p.lerp(want,.3);C.d.lerp(wantD,.3);const d2=L.dd.clone().add(C.d).normalize();
   axeWorld(head0.add(C.p),d2,L.blade);});}}
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
 const PF={down:1.0,hold:2.6};/* the clip is lowest (hips .38) at 0.93-1.2 s; frozen at 0.7 it held him 16 cm higher *//* held part-way down: a bent-knee crouch with a straight back reaching forward, not a ball curled over the bucket (watcher) */
 const PICKC=()=>has('hy_logpick')?'hy_logpick':has('hy_floorpick')?'hy_floorpick':'hy_pickground';/* hy_logpick: CMU squat-and-lift adapted to the hero (back <=40 deg, knees >=35 deg interior, 2.33 s) */
 function pondFill(a,dt){const PD=window.__ground&&window.__ground.pond;let F=(PD&&PD.fill)||root.position;a.ft+=dt;const t=a.ft;const C='hy_pickground';
  // OUTDOOR: he faces the pond itself (its centre), crouches on the bank with the knees 0.1 m outside the drawn water
  // ellipse (POND in ground.js) and reaches the bucket out at arm's length into the water's edge
  if(!a.fs){a.fs=1;if(has(C))once(C,{fade:.3});const er=(x,z)=>{const dx=x+1.4,dz=z-7.6,c=Math.cos(-.12),sn=Math.sin(-.12);return Math.hypot((dx*c+dz*sn)/1.75,(-dx*sn+dz*c)/1.15);};
   const d=V(-1.4-root.position.x,0,7.6-root.position.z).normalize();H.face=Math.atan2(d.x,d.z);
   // the water starts where the bank dips under the surface (the water plane is drawn where the ground is below it)
   const G=window.__ground,lv=PD?PD.level:0;const p0=root.position.clone();let tW=1;for(let t=0;t<3.5;t+=.03){let h=lv+1;try{h=G.heightAt(p0.x+d.x*t,p0.z+d.z*t);}catch(e){}if(h<lv-.005){tW=t;break;}}
   const st=p0.clone().addScaledVector(d,tW-.08);/* down at the very edge of the water, toes on the waterline: from 0.42 back up the bank the pail never got within 15 cm of the surface (film, both heroes) *//* knees (0.45 ahead in the crouch) 0.1 m short of the water */
   a.stand=st;a.tgt=p0.clone().addScaledVector(d,tW+.34).addScaledVector(V(-d.z,0,d.x),.1);/* out ahead of the knees and a little to his right: right under the knee it went through the shin */a.tgt.y=PD?PD.level:a.tgt.y;}
  if(a.tgt)F=a.tgt;
  const A=has(C)?actions[C]:null;
  if(A){if(t>=PF.down&&t<PF.down+PF.hold)A.timeScale=0;else if(t>=PF.down+PF.hold)A.timeScale=.62;/* full bucket: up slower than he went down */}
  const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const p=root.position;{/* boots on the bank, never in the water (watcher: he stood 1.5 m from the centre among the lilies): the root stays a good
   0.3 m back from the waterline and outside the pond by 0.25 m; the arm and the squat reach the water */

   const tx=a.stand.x,tz=a.stand.z;const m=.45*dt;p.x+=clamp(tx-p.x,-m,m);p.z+=clamp(tz-p.z,-m,m);}
  root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*4);H.look=F.clone();H.lookW=.85*(1-smooth(PF.down+PF.hold,PF.down+PF.hold+.8,t));
  const lv=PD?PD.level:F.y;const end=PF.down+PF.hold+(A?(durOf(C)-PF.down)/.62:1.5);
  if(t>PF.down+.25&&!a.s1){a.s1=1;try{PD&&PD.splash&&PD.splash(F.x,F.z,1);}catch(e){}AU('bucket_fill',F);}
  if(t>PF.down+PF.hold-.2&&!a.s2){a.s2=1;try{PD&&PD.splash&&PD.splash(F.x,F.z,.6);}catch(e){}AU('slosh',F);}
  a.dip=smooth(PF.down-.1,PF.down+.5,t)*(1-smooth(PF.down+PF.hold-.4,PF.down+PF.hold+.1,t));a.lv=lv;
  if(t>=end){a.step='rise';if(A)A.timeScale=1;H.carry=BUCKET();a.fdone();}}
 function pondFillPost(a){const P=PP();const bk=P&&P.tools&&P.tools.waterBucket;if(!bk||!a.dip)return;
  // the fist goes down to the water: the bucket's rim just under the surface, tipped toward the pond so it fills
  const R=odPalm('Right');const want=R.clone();const rimBelow=.35;/* fist to bucket bottom when hanging */const yFist=a.lv+.02;/* the fist at the surface: the whole bucket under */
  // going down the bucket stays out at the side and ahead of the knee (frame by frame it went through his right thigh)
  {const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const d=R.clone().sub(bones.Hips.getWorldPosition(V()));const k=Math.min(1,a.dip*2);want.addScaledVector(r,(.08-d.dot(r))*k).addScaledVector(f,Math.max(0,.5*k-d.dot(f)));}/* ahead of both knees, which splay in the squat */
  // ...and at the bottom out over the water at the fill point (he squats on the bank; the arm and a forward lean reach it),
  // never sunk into the bank: over ground the bucket's bottom stays on top of it
  const PD=window.__ground&&window.__ground.pond;const F0=a.tgt||(PD&&PD.fill);if(F0){const F=F0;const u=smooth(.25,1,a.dip);want.x=lerp(want.x,F.x,u);want.z=lerp(want.z,F.z,u);}
  if(R.y>yFist)want.y=lerp(R.y,yFist,a.dip);
  // the pond is shallow at the edge: the bucket lies over on its side to scoop, its bottom never in the mud of the bed
  {let g=want.y-1;try{g=window.__ground.heightAt(want.x,want.z);}catch(e){}want.y=Math.max(want.y,g+.12);}
  if(want.distanceTo(R)>.005)odReach('Right',want,1);
  const L=odPalm('Left');if(!lanternLeft())odReach('Left',odPalm('Right').addScaledVector(V(-fwd(root.rotation.y).z,0,fwd(root.rotation.y).x),-.14),.7*a.dip);/* the other hand on the rim too (not with the lantern in it: one-handed, the lantern held up beside) */
  odHang('waterBucket',1.3*a.dip);}
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
  hangLate={n,tilt,free};if(!hangLateOn){hangLateOn=1;lateFn(()=>{const L=hangLate;hangLate=null;if(L)hangPlace(L.n,L.tilt,L.free);});}/* again last: the grab tween (grab.js) still turned the bucket toward the fist's frame after this (gate: it lay on its side through his shins) */
  hangPlace(n,tilt,free);}
 let hangLate=null,hangLateOn=0;
 function hangPlace(n,tilt,free){const P=PP();const o=P&&P.tools&&P.tools[n];if(!o||o.parent!==bones.RightHand)return;const hb=bones.RightHand;
  hb.updateWorldMatrix(true,false);
  // carried, the wide pail rests against the outside of his thigh and hangs tipped a little out from it (the arm is no stiff wing)
  const roll=(!tilt&&!free)?-.2:0;const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt,root.rotation.y,roll,'YXZ'));
  /* the hand up above the elbow (taking it off the high shelf): the forearm comes up from below, so the pail, hanging from the bail,
     is pushed out off the forearm and swings about the fist, away from his arm (gate, adult hero: forearm 10 cm inside it) */
  if(!tilt&&n==='waterBucket'){const E=bones.RightForeArm.getWorldPosition(V()),Hh=bones.RightHand.getWorldPosition(V());const fa=Hh.clone().sub(E);const L=fa.length();const up=L>1e-3?fa.y/L:0;
   const d=V(fa.x,0,fa.z);if(up>.05&&d.lengthSq()>1e-5){d.normalize();const ax=V(0,-1,0).cross(d).normalize();const th=Math.min(.6,(up-.05)*1.3);q.premultiply(new THREE.Quaternion().setFromAxisAngle(ax,th));}}const hs=(o.userData.home&&o.userData.home.scale)||1;
  const g=V(0,.35,0).multiplyScalar(hs).applyQuaternion(q);const pos=odPalm('Right').sub(g);
  /* tipped over, the fist holds the rim from above: the pail hangs below the forearm, never round it (gate: forearm 13 cm inside while pouring) */if(tilt>.4&&n==='drainBucket'){const ax=V(0,1,0).applyQuaternion(q);const dn=V(0,-1,0).addScaledVector(ax,ax.y).normalize();pos.addScaledVector(dn,.2*hs*smooth(.4,1.2,tilt));}
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
 const slung={},unsl={},unslF={},slungBy={};
 function ladNear(){if(!(H.path.length>1&&H.path[1].t==='ladder'&&climb&&!window.__noClimb))return false;const q=N[H.path[0].node].p,p0=root.position;return Math.hypot(q.x-p0.x,q.z-p0.z)<1.4&&Math.abs(q.y-p0.y)<.4;}/* CLIMB HOOK: walking the last 1.4 m to a ladder foot */
 function slingTick(){const P=PP();if(!P||!P.tools)return;const lad=!!H.lad;unslingIdle(P);
  for(const n in SLING){const o=P.tools[n];if(!o)continue;const S=SLING[n];
   if((lad||n==='logArmful'&&ladNear())&&o.parent===bones[S.hand+'Hand']){/* CLIMB HOOK: the armful is hugged 27 cm out in front of the chest: slung only at the ladder foot it was still in front, 2-3 cm into the hatch ladder's rung (loads.js). It goes on his back over the last 1.4 m, like the tools to the hip (stowStart) */onBack(n,V(...S.off),S.rot);slungBy[n]=act;if(SLUNG_AT[n])scene.attach(o);/* placed in the world by slungPost every frame */slung[n]=1;AU('cloth');}
   else if(!lad&&slung[n]&&!(H.path[0]&&H.path[0].t==='ladder')&&!(n==='logArmful'&&ladNear())&&bones[S.hand+'Hand'].getWorldPosition(V()).y<bones.Hips.getWorldPosition(V()).y+.05){slung[n]=0;/* only what really hangs on him: a bucket back on its shelf (parent the scene too) is never pulled into the hand from across the house (gate: the trip started with the supply bucket in his fist) */const hm=P.toolHome&&P.toolHome(n);const near=o.getWorldPosition(V()).distanceTo(bones.Hips.getWorldPosition(V()))<.9&&!(hm&&o.getWorldPosition(V()).distanceTo(hm)<.1);if(near&&(o.parent===bones.Spine2||o.parent===scene)){if(SLUNG_AT[n]&&o.parent===scene){slung[n]=1;if(!unsl[n])unsl[n]={t:0,hand:S.hand,ho:S.ho};}/* off the rope by hand: the fist goes to the bail first, then takes it (Grab: it flew 50-60 cm into the fist) */else try{P.grab(n,bones[S.hand+'Hand'],{offset:V(...S.ho)});AU('cloth');}catch(e){}}}}
  if(lad&&H.ov&&H.carry&&H.ov.T===ovTracks(H.carry)&&H.ov.end-H.ov.t>.3)H.ov.end=H.ov.t+.3;}
 // after every pose: what is slung for the ladder hangs on its rope between the shoulder blades, upright in the world,
 // well below the neck (frame by frame the Spine2 offsets put the bucket over his head like a hat and the sack into his head)
 const SLUNG_AT={waterBucket:[.27,-.24,.36],drainBucket:[.29,-.25,.36],meatBag:[.3,-.22,.13]};/* [behind Spine2, below it, the rope's tie point up the load] */
 // the rope it hangs by: from the handle up over the right shoulder, across the chest to the left hip and round the back again
 let strap=null;const strapMat=new THREE.MeshStandardMaterial({color:0x6b4a2a,roughness:1});
 function strapTo(o,f,hs,ty,hip){const r=V(-f.z,0,f.x),l=r.clone().negate();const top=o.localToWorld(V(0,ty,0));const sp=bones.Spine2.getWorldPosition(V()),hp=bones.Hips.getWorldPosition(V());let pts;
  if(hip){/* bandolier: handle -> straight up the back (the load pulls it taut) -> lying ON the left shoulder (between the collar bone and the arm,
     not 4.5 cm over the clavicle bone: it floated) -> across the chest -> down to the handle; extra points keep the taut runs straight, not a hoop (watch R29-1) */
   /* the torso's own axes, not the root's: bent over the ladder rungs his back faces up, and 'behind Spine2' along the root forward stood 20 cm clear of it (the hoop over his back, film) */const rb=bones.RightArm.getWorldPosition(V()).sub(bones.LeftArm.getWorldPosition(V())).normalize(),ub=bones.Neck.getWorldPosition(V()).sub(hp).normalize(),fb=ub.clone().cross(rb).normalize(),ls=bones.LeftShoulder.getWorldPosition(V()).lerp(bones.LeftArm.getWorldPosition(V()),.45);const b1=sp.clone().addScaledVector(fb,-.13).addScaledVector(rb,.05),s1=ls.clone().addScaledVector(fb,-.05).addScaledVector(ub,.03),s2=ls.clone().addScaledVector(fb,.06).addScaledVector(ub,.025),c1=sp.clone().addScaledVector(fb,.15).addScaledVector(rb,.03),h1=hp.clone().addScaledVector(f,.1).addScaledVector(r,.2).add(V(0,.1,0)),t2=top.clone().addScaledVector(f,.05);
   pts=[top,top.clone().lerp(b1,.5),b1,b1.clone().lerp(s1,.6),s1,s2,s2.clone().lerp(c1,.5),c1,c1.clone().lerp(h1,.5),h1,h1.clone().lerp(t2,.5),t2];}
  else{const sh=bones.RightShoulder.getWorldPosition(V());pts=[top,sh.clone().addScaledVector(f,-.1).add(V(0,.07,0)),sh.clone().addScaledVector(f,.06).add(V(0,.05,0)),sp.clone().addScaledVector(f,.14).addScaledVector(l,.02),hp.clone().addScaledVector(f,.1).addScaledVector(l,.15).add(V(0,.05,0)),
   hp.clone().addScaledVector(l,.19).add(V(0,.08,0)),hp.clone().addScaledVector(f,-.14).addScaledVector(l,.08).add(V(0,.12,0)),top.clone().addScaledVector(r,.05).add(V(0,-.02,0))];}
  const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,true,'centripetal'),48,.012,6,true)/* centripetal: no loop overshooting above the shoulder (film: a hoop over his head on the ladder) */;
  if(!strap){strap=new THREE.Mesh(g,strapMat);strap.castShadow=true;strap.frustumCulled=false;scene.add(strap);}else{strap.geometry.dispose();strap.geometry=g;}strap.visible=true;}
 // a task cut short on a ladder left its load slung: it followed his hip into the next job (gate: a bucket round his feet at the sink)
 /* cut off with the load slung on the rope (parent the scene or Spine2, not a hand) the release did nothing and it stayed on him
    into the next task, where the hand took it up again (gate: the supply bucket went hunting) */
 function relLoad(n){const P=PP();const o=P&&P.tools&&P.tools[n];if(!o)return;slung[n]=0;if(o.parent!==bones.RightHand&&o.parent!==bones.LeftHand){const hm=P.toolHome&&P.toolHome(n);if(hm&&o.getWorldPosition(V()).distanceTo(hm)<.05)return;try{P.grab(n,bones.RightHand);}catch(e){}}try{P.release(n);}catch(e){}}
 function unslingIdle(P){if(act&&!act.dead)return;for(const n in slung){if(!slung[n])continue;slung[n]=0;const o=P.tools[n];if(o&&(o.parent===scene||o.parent===bones.Spine2))try{P.release(n);}catch(e){}}}
 /* GRAB: tools off the hands for a climb and back, by hand. STW.mode 'off': each hand with a (non-bulky) tool brings it down to its hip
    (0.45 s) and hangs it there as the hand left it (a reach over the shoulder was pulled back by the pose guard, the tool then jumped);
    'on': the hand reaches to the tool's grip at the hip and takes it (grab.js eases it into the fist) */
 let STW=null;
 function onHeroT(n){const T=PP()&&PP().tools;const o=T&&T[n];for(let x=o&&o.parent;x;x=x.parent)if(x===root)return true;return false;}
 function stowStart(){if(H.stowPre||STW)return;const its=stowItems();if(its.length)STW={mode:'off',t:0,items:its};}
 function stowing(h){return !!(STW&&STW.mode==='off'&&STW.items.some(it=>it.h===h));}
 function stowItems(){const out=[];const T=PP().tools||{};for(const h of ['Left','Right']){const ht=H.hold[h]&&H.hold[h].tool;for(const n in T){const o=T[n];if(!o||o.parent!==bones[h+'Hand'])continue;if(/Bucket|meat|log|plate/i.test(n))continue;out.push({h,n,fromHold:ht===n,pp:o.position.clone(),pq:o.quaternion.clone(),ps:o.scale.x});}}return out;}
 /* CLIMB HOOK: a lantern hung on the hip for a climb hangs plumb from its bail just behind the hip, every frame (as the hand left it the housing
    stuck out 16 cm in front of the hip: 2.3 cm into the hatch ladder's lowest rung at the mount, loads.js) */
 function lanternHang(){const P=PP();const o=P&&P.tools&&P.tools.lantern;if(!o||o.parent!==bones.Hips)return;const Hp=bones.Hips;root.updateMatrixWorld(true);const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
  const side=Hp.worldToLocal(o.getWorldPosition(V())).x>=0?1:-1;const hw=Hp.getWorldPosition(V());const rs=Hp.localToWorld(V(side,0,0)).sub(hw).dot(r)>=0?1:-1;const gw=hw.addScaledVector(r,rs*.24).addScaledVector(f,-.09).add(V(0,-.04,0));
  o.quaternion.copy(Hp.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),root.rotation.y)));o.updateMatrixWorld(true);const g2=o.localToWorld(V(0,.24,0));o.position.add(Hp.worldToLocal(gw.clone()).sub(Hp.worldToLocal(g2.clone())));o.updateMatrixWorld(true);}
 function stowPost(dt){if(!STW)return;STW.t+=dt;const P=PP();const G=window.__grab;const t=STW.t;let all=true;
  for(const it of STW.items){const o=P.tools[it.n];if(!o){continue;}const sp2=bones.Spine2;
   if(STW.mode==='off'){root.updateMatrixWorld(true);const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const lt=it.n==='lantern';const tg=bones.Hips.getWorldPosition(V()).addScaledVector(r,(it.h==='Right'?1:-1)*(lt?.24:.21)).addScaledVector(f,lt?-.09:.03).add(V(0,-.04,0));/* CLIMB HOOK: the lantern hangs 25 cm down from its bail: at the side-front of the hip it swung into the hatch ladder's lowest rung (loads.js, 1.9 cm); it goes a little behind the hip */
    const w=smooth(0,.4,t)*(1-smooth(.6,.95,t));if(w>.01)reachGrip(it.h,tg,w);
    if(!it.set&&t>.45&&(palmTo(it.h,tg)<.06||t>.6)){it.set=1;root.updateMatrixWorld(true);bones.Hips.attach(o);if(H.hold[it.h]&&H.hold[it.h].tool===it.n)H.hold[it.h]=null;AU('cloth');}
    if(t<.95)all=false;}
   else{if(o.parent===bones[it.h+'Hand']&&it.got){if(it.pp&&!it.fromHold){const e=smooth(0,.3,t-it.got);o.position.copy(it.p1).lerp(it.pp,e);o.quaternion.copy(it.q1).slerp(it.pq,e);}if(t-it.got<.35)all=false;continue;}
    root.updateMatrixWorld(true);const g=G&&G.GRIP&&G.GRIP[it.n]&&G.GRIP[it.n].g;const gw=o.localToWorld(g?V(...g):V());const w=smooth(0,.45,t);reachGrip(it.h,gw,w);all=false;
    if(t>.5&&(palmTo(it.h,gw)<.07||t>.9)){it.got=t;root.updateMatrixWorld(true);if(!it.pp)grabTool(it.n,it.h);else{bones[it.h+'Hand'].attach(o);it.p1=o.position.clone();it.q1=o.quaternion.clone();o.scale.setScalar(it.ps);}AU('cloth');}}}
  if(STW.mode==='off'&&all){H.stowPre=STW.items.map(it=>it.fromHold?[it.h,it.n]:[it.h,it.n,it.pp,it.pq,it.ps]);STW=null;}
  else if(STW&&STW.mode==='on'&&(all||t>2)){STW=null;}}
 // OUTDOOR: the last word on where the carried loads are, after the pose guard: late fixes (the axe through both fists, the round
 // under the palm), then the hand-over ease: when a load changes hands (shelf -> fist, fist -> the rope on his hip, back into the
 // fist, fist -> the axe driven in the world) it never jumps: it starts from where it was and eases into its new place
 // (Grab: the pail 35-60 cm and the axe 50-107 cm in the frame it changed parents)
 const LATE=[];let lateOn=0;function lateFn(f){LATE.push(f);lateReg();}
 let relookOn=0;function relookReg(){if(relookOn)return;relookOn=1;stage('look',()=>{if(act&&act.relook){try{act.relook();}catch(e){console.error('relook',e);}}});}
 function lateReg(){if(lateOn)return;lateOn=1;stage('guard',()=>{for(const f of LATE){try{f();}catch(e){console.error(e);}}try{quiverClear();quiverBody();}catch(e){}toolEase();try{loadClear(0);}catch(e){}/* the swing again on the eased pose: a pail being eased from the hip into the fist went 3.4 cm through the shins (collide) */});}
 // the quiver on his back: the arrows clear his head whatever the body does (adult hero, walking out: fletching 7.7 cm in the head).
 // Each frame from its strap place on Spine2, pushed back (and a little down) by just what the head needs, eased
 const QV={base:null,par:null,x:0};
 function quiverClear(){const P=PP();const Q=P&&P.tools&&P.tools.quiver;if(!Q)return;if(Q.parent!==bones.Spine2){QV.base=null;QV.par=Q.parent;QV.x=0;return;}
  if(!QV.base||QV.par!==Q.parent){QV.base={p:Q.position.clone(),q:Q.quaternion.clone()};QV.par=Q.parent;}else{Q.position.copy(QV.base.p);Q.quaternion.copy(QV.base.q);}Q.updateMatrixWorld(true);
  const hd=bones.Head.getWorldPosition(V()),ht=(bones.HeadTop_End||bones.Head).getWorldPosition(V());const c=hd.clone().lerp(ht,.5);const R=hd.distanceTo(ht)*.62+.03;
  let pen=-9,wp0=null;for(const y of [-.15,0,.06,.12,.17])for(const x of [-.03,0,.03]){const w=Q.localToWorld(V(x,y,0));const pn=R-w.distanceTo(c);if(pn>pen){pen=pn;wp0=w;}}
  const away=wp0?wp0.clone().sub(c):V();away.y=Math.min(away.y,0);if(away.lengthSq()<1e-6)away.copy(fwd(root.rotation.y).negate());away.normalize();QV.d=QV.d?QV.d.lerp(away,.2).normalize():away;
  const want=Math.max(0,pen)*1.6;QV.x+=want>QV.x?Math.min(want-QV.x,.05):-Math.min(QV.x-want,.004);if(QV.x<1e-4)return;
  /* tipped away from the head about its bottom end, which stays on his back: moved bodily it floated off his shoulder (film, adult hero drawing the bow) */
  const piv=Q.localToWorld(V(0,-.45,0)),top=Q.localToWorld(V(0,.17,0));const up=top.clone().sub(piv).normalize();const bk=bones.Spine2.getWorldPosition(V()).sub(bones.Spine2.localToWorld(V(0,0,.1))).normalize();/* away from the back mostly, never out sideways off the shoulder */const aw=(QV.d||bk).clone().multiplyScalar(.35).addScaledVector(bk,.65).normalize();const ax=up.clone().cross(aw);if(ax.lengthSq()<1e-6)return;ax.normalize();
  const th=Math.min(.35,QV.x/.6);const qr=new THREE.Quaternion().setFromAxisAngle(ax,th);const wq=Q.getWorldQuaternion(new THREE.Quaternion()).premultiply(qr);const wp=Q.getWorldPosition(V()).sub(piv).applyQuaternion(qr).add(piv);
  Q.parent.updateWorldMatrix(true,false);const pq=Q.parent.getWorldQuaternion(new THREE.Quaternion());Q.position.copy(Q.parent.worldToLocal(wp));Q.quaternion.copy(pq.invert().multiply(wq));Q.updateMatrixWorld(true);}
 /* OUTDOOR: the quiver on his back is never in his body: the tube (r 5.5 cm, from its bottom end up past the strap ring) is pushed straight back
    off the skin of the seat, back and head (gate: hips 3-6 cm on the rungs and picking up the hare, the big-headed hero's head 6 cm while walking) */
 let BSK=null;function bodySkin(){if(!BSK){BSK={m:null,ix:[]};root.traverse(o=>{if(o.isSkinnedMesh&&!BSK.m)BSK.m=o;});const M=BSK.m;if(M){const si=M.geometry.attributes.skinIndex,sw=M.geometry.attributes.skinWeight,n=M.geometry.attributes.position.count;
   for(let i=0;i<n;i+=8){let bi=0,bw=-1;for(let k=0;k<4;k++){const w=GCMP(sw,i,k);if(w>bw){bw=w;bi=GCMP(si,i,k);}}const nm=M.skeleton.bones[bi].name;if(/(Hips|Spine\d?|Neck|Head|HeadTop_End|UpLeg)$/.test(nm))BSK.ix.push(i);}}}
  const M=BSK.m;if(!M)return [];if(BSK.f===FRN)return BSK.p;const out=[];for(const i of BSK.ix){const v=M.getVertexPosition(i,new THREE.Vector3());out.push(v.applyMatrix4(M.matrixWorld));}BSK.f=FRN;BSK.p=out;return out;}
 const QB={b:0};function quiverBody(){const P=PP();const Q=P&&P.tools&&P.tools.quiver;if(!Q||Q.parent!==bones.Spine2||Q.visible===false){QB.b=0;return;}
  Q.updateMatrixWorld(true);const A=Q.localToWorld(V(0,-.45,0)),Bt=Q.localToWorld(V(0,.2,0));const ab=Bt.clone().sub(A);const L2=ab.lengthSq();if(L2<1e-6)return;
  const bk=bones.Spine2.getWorldPosition(V()).sub(bones.Spine2.localToWorld(V(0,0,.1))).normalize();
  const pen=b=>{let m=-1;const sh=bk.clone().multiplyScalar(b);for(const p of bodySkin()){const t=clamp(p.clone().sub(A).sub(sh).dot(ab)/L2,0,1);const d=A.clone().add(sh).addScaledVector(ab,t).distanceTo(p);m=Math.max(m,.075-d);}return m;};
  const p0=pen(QB.b);let want=QB.b;if(p0>0)want=QB.b+p0*1.1;else if(QB.b>0){const p1=pen(Math.max(0,QB.b-.004));if(p1<=-.005)want=Math.max(0,QB.b-.004);}
  QB.b+=clamp(want-QB.b,-.004,.03);if(QB.b<1e-4)return;const wp=Q.getWorldPosition(V()).addScaledVector(bk,QB.b);Q.position.copy(Q.parent.worldToLocal(wp));Q.updateMatrixWorld(true);}
 const EASE_T=['waterBucket','drainBucket','axe','logArmful','lantern'],easeSt={};
 function toolEase(){const P=PP();if(!P||!P.tools)return;const dt=1/60;
  for(const n of EASE_T){const o=P.tools[n];if(!o)continue;const S=easeSt[n];
   /* set once (a grab): nothing re-placed it since our blend last frame, so its real place is the one under the blend */if(S&&S.e&&S.tl&&S.par===o.parent&&o.position.equals(S.lp)&&o.quaternion.equals(S.lq)){o.position.copy(S.tl.p);o.quaternion.copy(S.tl.q);o.scale.copy(S.tl.s);}
   o.updateMatrixWorld(true);const wp=o.getWorldPosition(V()),wq=o.getWorldQuaternion(new THREE.Quaternion());
   if(S&&S.par!==o.parent&&o.visible&&S.vis&&S.w.distanceTo(wp)<1.2&&(o.parent===scene||S.par===scene||isHeroPart(o.parent)||isHeroPart(S.par))){S.e={p:S.w.clone(),q:S.q.clone(),t:0,d:(!isHeroPart(S.par)&&S.par!==scene)?.14:.32};}/* off its rest spot into the fist: quick, the hand is lifting it */
   const tl={p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()};const E=S&&S.e;if(E&&o.parent){E.t+=dt/(E.d||.32);if(E.t>=1)S.e=null;else{const k=E.t*E.t*(3-2*E.t);/* about its grip (the handle in the fist), not its origin: a turning axe swung its handle 18 cm out of the hand */const g=(o.userData.grip||V()).clone(),sc=o.getWorldScale(V()).x;const gW=(pp,qq)=>g.clone().multiplyScalar(sc).applyQuaternion(qq).add(pp);
     const q=E.q.clone().slerp(wq,k);const p=gW(E.p,E.q).lerp(gW(wp,wq),k).sub(g.clone().multiplyScalar(sc).applyQuaternion(q));
     const M=new THREE.Matrix4().compose(p,q,o.getWorldScale(V()));o.parent.updateWorldMatrix(true,false);M.premultiply(o.parent.matrixWorld.clone().invert());M.decompose(o.position,o.quaternion,o.scale);o.updateMatrixWorld(true);wp.copy(p);wq.copy(q);}}
   easeSt[n]={par:o.parent,w:wp,q:wq,vis:o.visible,e:S&&S.e||null,tl,lp:o.position.clone(),lq:o.quaternion.clone()};}}
 function isHeroPart(x){for(let q=x;q;q=q.parent)if(q===root)return true;return false;}
 let slAge=0,slLad=0,slOX=.27,slOZ=-.24,slPlOn=0;
 function slungPost(){const P=PP();if(!P||!P.tools)return;lateReg();
  for(const n in unsl){const U=unsl[n];const o=P.tools[n];if(!o||o.parent!==scene||H.lad||(H.path[0]&&H.path[0].t==='ladder')){delete unsl[n];continue;}U.t+=1/60;
   const g=o.localToWorld((o.userData.grip||V()).clone());odReach(U.hand,g,smooth(0,.3,U.t));
   if((U.t>.25&&odPalmTo(U.hand,g)<.07)||U.t>.7){delete unsl[n];slung[n]=0;try{P.grab(n,bones[U.hand+'Hand'],{offset:V(...U.ho)});AU('cloth');}catch(e){}unslF[n]={t:0,hand:U.hand,g};}}
  for(const n in unslF){const F=unslF[n];F.t+=1/60;if(F.t>=.35||H.lad){delete unslF[n];continue;}odReach(F.hand,F.g,1-smooth(0,.35,F.t));}unslingIdle(P);
  slAge=(H.lad||(H.path[0]&&H.path[0].t==='ladder'))?0:slAge+1/60;if(!slPlOn){slPlOn=1;lateFn(slungPlace);}}
 /* placed at the guard stage, from the body as it is drawn: placed with the act's post the ladder pose was not on him yet, and the rope ran
    to where his shoulder would be standing upright, a stiff hoop 20 cm over his bent back (watch R29-1) */
 function slungPlace(){const P=PP();if(!P||!P.tools)return;let f=null,any=false;
  for(const n in SLUNG_AT){const o=P.tools[n];if(!o||!slung[n]||(o.parent!==bones.Spine2&&o.parent!==scene))continue;
   /* a load is on the rope only for a climb: 2.5 s off any ladder with no hand going for it, it is not on him (the supply bucket, back on its shelf,
      was still flagged and dragged along at his hip with its rope loop through his arm and the oven: watch R26-3) */
   if(slAge>2.5&&!unsl[n]&&o.parent===scene){const hm=P.toolHome&&P.toolHome(n);if(!hm||o.getWorldPosition(V()).distanceTo(hm)<.25){slung[n]=0;continue;}if(slungBy[n]!==act){slung[n]=0;try{P.release(n);}catch(e){}continue;}/* left over from a job that is over: back home, never along on the next one */if(SLING[n])unsl[n]={t:0,hand:SLING[n].hand,ho:SLING[n].ho};}/* his own job's load: the hand takes it off the rope */f=f||fwd(root.rotation.y);const S=SLUNG_AT[n];
   const hs=(o.userData.home&&o.userData.home.scale)||1;const sp=bones.Spine2.getWorldPosition(V());
   // clear of whatever sticks out furthest behind him: on a ladder the hips and thighs push back past the shoulder blades
   // (frame by frame his pelvis sat inside the bucket all the way up the rope ladder)
   let back=sp.dot(f);for(const bn of ['Hips','LeftUpLeg','RightUpLeg','Spine'])if(bones[bn])back=Math.min(back,bones[bn].getWorldPosition(V()).dot(f));
   let pos=sp.clone().addScaledVector(f,back-sp.dot(f)-S[0]).add(V(0,S[1]*hs,0));
   // a bucket hangs at his right hip on a rope across the chest from the left shoulder: rim below the shoulder blades, out
   // beside the thigh (watchers: on the back it either covered his head or read as round his waist)
   if(n!=='meatBag'){const r=V(-f.z,0,f.x);const hp=bones.Hips.getWorldPosition(V());slLad=clamp(slLad+(H.lad?1:-1)/60/.6,0,1);const kb=smooth(0,1,slLad);let dz=-.24-.08*kb,dx=.27-.17*kb;if(H.lad){/* the boards round the hatch: the bucket must hang where nothing is between its bottom and his shoulders, so on the ladder he pulls it in tight behind him, into the opening, until the deck is above it */const clear=(x,z)=>{const fy=floorAt(x,hp.y+.95,z,.05,1.45);return !(fy!=null&&fy>hp.y-.42);};/* and clear of his own seat and thighs, which stick out behind the hips on the rungs (the bucket round his backside once it was placed from the drawn pose) */const bR=back-hp.dot(f)-.16;let ok=0;for(let [cx,cz] of [[dx,dz],[.06,-.2],[.03,-.14],[0,-.09],[0,-.05]]){cz=Math.min(cz,bR);const c=hp.clone().addScaledVector(r,cx).addScaledVector(f,cz);let free=1;for(const [ox,oz] of [[0,0],[.13,0],[-.13,0],[0,.13],[0,-.13]])if(!clear(c.x+ox,c.z+oz)){free=0;break;}if(free){dx=cx;dz=cz;ok=1;break;}}if(!ok){dx=0;dz=Math.min(-.05,bR);}}
   slOX+=(dx-slOX)*Math.min(1,6/60*4);slOZ+=(dz-slOZ)*Math.min(1,6/60*4);if(!H.lad&&slLad<=0){slOX=dx;slOZ=dz;}
   /* never in his body: the hips, thighs, shins and feet in the bucket's height band push it back along his back (gate: on the rungs the
      bent legs and seat went 10-13 cm into it; the bone centres alone are not his surface) */
   {if(!o.userData.slR){const bb=new THREE.Box3().setFromObject(o),sz=bb.getSize(V());o.userData.slR=Math.max(sz.x,sz.z)/2/o.getWorldScale(V()).x;o.userData.slH=sz.y/o.getWorldScale(V()).y;}
    const R=o.userData.slR*hs+.13,y0=hp.y-.3-.04,y1=y0+o.userData.slH*hs+.08;const pts=[];const B=bones;const add=(a,b,n)=>{if(!B[a]||!B[b])return;const pa=B[a].getWorldPosition(V()),pb=B[b].getWorldPosition(V());for(let k=0;k<=n;k++)pts.push(pa.clone().lerp(pb,k/n));};
    add('Hips','Spine',1);for(const q of pts)q.addScaledVector(f,-.04);/* the seat is further back than the hip joint */add('LeftUpLeg','LeftLeg',3);add('RightUpLeg','RightLeg',3);add('LeftLeg','LeftFoot',3);add('RightLeg','RightFoot',3);add('LeftFoot','LeftToeBase',1);add('RightFoot','RightToeBase',1);
    const ho=hp.dot(f);let lim=9;for(const q of pts){if(q.y<y0||q.y>y1)continue;const c=hp.clone().addScaledVector(r,slOX);const lat=Math.abs(q.clone().sub(c).dot(r));if(lat>=R)continue;lim=Math.min(lim,q.dot(f)-ho-Math.sqrt(R*R-lat*lat));}
    if(slOZ>lim)slOZ+=(lim-slOZ)*kb;}/* eased in with the climb: at the sling, out at his side, it eased from the fist straight back through his shins (full gate) */
   pos=hp.clone().addScaledVector(r,slOX).addScaledVector(f,slOZ);pos.y=hp.y-.3;/* where the boards of the hatch edge are at its height it is pulled in tight behind him and comes down through the opening with him *//* on the ladder it swings round behind him, into the open hatch at his back: out at his side it went through the deck boards and the post going down (film) *//* off the boards: at .46 under the hips its bottom sat on the deck at the hatch while he turned to go down (watch R29-1) *//* behind the hip: clear of the right arm reaching down the rungs */}
   const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,root.rotation.y,0,'YXZ'));const par=o.parent;par.updateWorldMatrix(true,false);
   const M=new THREE.Matrix4().compose(pos,q,V(hs,hs,hs));M.premultiply(par.matrixWorld.clone().invert());M.decompose(o.position,o.quaternion,o.scale);o.updateMatrixWorld(true);if(!any){any=true;strapTo(o,f,hs,S[2],n!=='meatBag');}}
  if(!any&&strap)strap.visible=false;}

 // OUTDOOR: the supply bucket on its shelf above the sink is higher than his head: taken down it comes straight down off the
 // shelf, in front of his chest, then to his side (QA: plumb from the fist it came down through his head and arms); put back the same way up
 /* out from the shelf towards where he stands (not his facing: in the full gate he stood turned and the hand went through the board) */
 const shelfOut=P3=>{const n=V(root.position.x-P3.x,0,root.position.z-P3.z);return n.lengthSq()>1e-6?n.normalize():fwd(root.rotation.y).multiplyScalar(-1);};
 function shelfPath(a){const P=PP();const o=P&&P.tools&&P.tools.waterBucket;if(a.step!=='clip'){/* the clip is over: the hand eases from the end of the path into the carry, it does not snap (gate: hand 13, head 8 at the end of the take) */if(a.spLast&&o&&o.parent===bones.RightHand&&!a.put){a.spEnd=(a.spEnd||0)+1/60;const w=1-smooth(0,.4,a.spEnd);if(w>.01){odReach('Right',a.spLast,w);odHang('waterBucket',0,true);return true;}}a.spT=null;a.spOut=null;a.spFrom=null;a.spLast=null;a.spEnd=0;return false;}
  /* blended in from where the clip hand really is when the fist closes, and out after it lets go (gate: the hand jumped 38 between phases) */
  if(!o||o.parent!==bones.RightHand){if(!o)return false;const f=fwd(root.rotation.y);const hs=(o.userData.home&&o.userData.home.scale)||1;
   /* the shelf board is at his chin: the empty hand comes to the bail from in front of its edge, above it, and leaves the same way, never up or down through the board (gate: hand 9 cm in the shelf) */
   if(!a.put&&a.spT==null){const k=a.t/Math.max(.3,a.clipDur);const P3=P.toolHome('waterBucket').add(V(0,.35*hs,0));const Pf=P3.clone().addScaledVector(shelfOut(P3),.24).add(V(0,.05,0));
    const w=smooth(.05,.22,k);/* it rises close in front of his chest first, then out to the shelf edge: straight up his right side it clipped the sink-side corner (gate: hand 6.6 cm, two frames) */const r=V(-f.z,0,f.x);const Pin=Pf.clone().addScaledVector(r,-.16).addScaledVector(f,-.06).add(V(0,-.08,0));const Pe=Pin.lerp(Pf,smooth(.14,.3,k));if(w>.01)odReach('Right',k<.3?Pe:Pf.lerp(P3,smooth(.3,.45,k)),w);return false;}
   if(a.spLast&&a.spT!=null){a.spOut=(a.spOut||0)+1/60;if(!a.spFrom)a.spFrom=a.spLast.clone();const Pf=a.spFrom.clone().addScaledVector(shelfOut(a.spFrom),.24).add(V(0,.05,0));const w=1-smooth(.22,.55,a.spOut);if(w>.01)odReach('Right',a.spFrom.clone().lerp(Pf,smooth(0,.25,a.spOut)),w);}return false;}
  if(a.spT==null)a.spT=a.t;const wIn=a.put?smooth(0,.25,a.t-a.spT):1;/* taking it, the hand is already on the path (it came to the bail along it) */
  const k=a.t/Math.max(.3,a.clipDur);const hs=(o.userData.home&&o.userData.home.scale)||1;const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
  const P3=P.toolHome('waterBucket').add(V(0,.35*hs,0)),n=shelfOut(P3),Pf=P3.clone().addScaledVector(n,.24).addScaledVector(V(n.z,0,-n.x),.16).add(V(0,.05,0)),/* out over the edge to his right, wide of his head */P2=P3.clone().add(V(0,-.24,0)).addScaledVector(n,.3);const fl=root.position.y;
  const P1=root.position.clone().addScaledVector(f,.42).addScaledVector(r,.06);P1.y=fl+1.18;
  const P0=bones.Hips.getWorldPosition(V()).addScaledVector(r,.28).addScaledVector(f,.06).add(V(0,-.12,0));
  const u=a.put?smooth(.08,.47,k):1-smooth(.47,.95,k);/* 1 = at the shelf */const seg=(A,B,x)=>A.clone().lerp(B,smooth(0,1,x));
  /* off the board out over its edge first, then down: the pail's bottom never goes through the shelf */const at=u>.85?seg(Pf,P3,(u-.85)/.15):u>.65?seg(P2,Pf,(u-.65)/.2):u>.4?seg(P1,P2,(u-.4)/.25):seg(P0,P1,u/.4);a.spLast=at.clone();odReach('Right',at,a.put?1:wIn);odHang('waterBucket',0,true);return true;}
 // ===== OUTDOOR hunt at the forest edge (clips from the Fal thread: hy_bowshoot, hy_scanbow, hy_sneak, hy_pickhare) =====
 let hareObj=null,arrowObj=null;
 function hareMesh(){const g=new THREE.Group();const fur=new THREE.MeshStandardMaterial({color:0x6e5a44,roughness:.95}),pale=new THREE.MeshStandardMaterial({color:0xcfc4b0,roughness:.95}),dark=new THREE.MeshStandardMaterial({color:0x2a2018,roughness:.9});
  const body=new THREE.Mesh(new THREE.SphereGeometry(.1,12,9),fur);body.scale.set(1,.85,1.45);body.position.set(0,.09,0);g.add(body);
  const hd=new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),fur);hd.scale.set(.9,.95,1.2);hd.position.set(0,.17,.13);g.add(hd);
  for(const sx of [-1,1]){const ear=new THREE.Mesh(new THREE.SphereGeometry(.02,6,5),fur);ear.scale.set(.8,4,.45);ear.position.set(sx*.022,.25,.1);ear.rotation.x=-.35;g.add(ear);
   const eye=new THREE.Mesh(new THREE.SphereGeometry(.009,6,5),dark);eye.position.set(sx*.04,.185,.17);g.add(eye);
   const leg=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),fur);leg.scale.set(.7,.6,1.6);leg.position.set(sx*.06,.035,-.05);g.add(leg);}
  const tail=new THREE.Mesh(new THREE.SphereGeometry(.025,8,6),pale);tail.position.set(0,.11,-.15);g.add(tail);
  g.traverse(m=>{if(m.isMesh){m.castShadow=true;}});g.name='hare';return g;}
 function arrowMesh(){const g=new THREE.Group();const w=new THREE.MeshStandardMaterial({color:0x8a6a44,roughness:.8});const sh=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.62,5),w);sh.rotation.x=Math.PI/2;g.add(sh);
  const tip=new THREE.Mesh(new THREE.ConeGeometry(.009,.04,5),new THREE.MeshStandardMaterial({color:0x555555,metalness:.6,roughness:.5}));tip.rotation.x=Math.PI/2;tip.position.z=.33;g.add(tip);
  const fl=new THREE.MeshStandardMaterial({color:0xd8d0c0,roughness:.9,side:THREE.DoubleSide});for(const r of [0,2.1,4.2]){const f=new THREE.Mesh(new THREE.PlaneGeometry(.018,.07),fl);f.position.z=-.27;f.rotation.set(0,Math.PI/2,0);f.rotateOnWorldAxis(V(0,0,1),r);g.add(f);}
  g.name='arrow';return g;}
 const gH=(x,z,y)=>{try{const h=window.__ground.heightAt(x,z);if(h!=null)return h;}catch(e){}return y;};
 // the bow from the back into the left hand: up over the left shoulder to the upper limb, then down to his side (and the reverse)
 function bowReach(a,k,toHand){const bw=PP().tools&&PP().tools.bow;if(!bw)return;const sh=bones.LeftArm.getWorldPosition(V());const f=fwd(root.rotation.y);
  const over=sh.clone().add(V(0,.08,0)).addScaledVector(f,-.04).addScaledVector(V(-f.z,0,f.x),-.05);/* a shoulder can do this: higher or further back the pose guard held the hand at the shoulder anyway */const side=bones.Hips.getWorldPosition(V()).addScaledVector(V(f.z,0,-f.x),.24).addScaledVector(f,.12).add(V(0,-.08,0));
  const w=smooth(0,.3,k)*(1-smooth(.7,1,k));if(w<.01)return;const at=k<.4?over:over.clone().lerp(side,smooth(.4,.8,k));odReach('Left',at,w);}
 function huntStart(a,res,goOut){a.step='hunt';a.hp='draw';a.ht=0;a.hres=res;a.goOut=goOut;const f=fwd(N.g_out.face??H.face);H.face=N.g_out.face??H.face;
  const e=root.position;const hp=e.clone().addScaledVector(f,2.6).addScaledVector(V(f.z,0,-f.x),rnd(-.15,.15));/* on the path out, not in the bushes beside it */hp.y=gH(hp.x,hp.z,e.y);a.hareAt=hp;
  hareObj=hareObj||hareMesh();hareTidy();hareObj.position.copy(hp);hareObj.rotation.set(0,Math.atan2(-f.x,-f.z)+rnd(-.8,.8),0);hareObj.visible=true;scene.add(hareObj);
  play(IDLE(),{fade:.4});H.look=hp.clone().add(V(0,.2,0));H.lookW=.5;const p0=a.post;a.post=dt=>{p0&&p0(dt);if(a.step==='hunt'&&a.hp==='shoot')shotPost(a);if(a.step==='hunt'&&(a.hp==='draw'||a.hp==='stow')&&a.rk!=null)bowReach(a,a.rk,a.hp==='draw');if(a.step==='hunt'&&a.hp==='pick'){if(a.ph2)hareCarry(a);else if(hareObj&&hareObj.parent===scene){hareObj.updateMatrixWorld(true);const g=hareObj.localToWorld(V(0,.06,-.14));a.hg0=g;const w=smooth(.3,.75,a.ht);if(w>.01)odReach('Right',g,w);}}};}
 /* the hare never stays in his hand after the hunt is over, however the task ended */
 let hareGuard=0;function hareTidy(){if(!hareGuard){hareGuard=1;stage('pre',()=>{if(hareObj&&hareObj.parent&&hareObj.parent!==scene&&!(act&&act.step==='hunt')){hareObj.parent.remove(hareObj);}});}}
 /* up from the ground the hare is carried out in front and round the outside of his right thigh into the sack, never back
    past his shins and hips (gate: shins 7, hips 6 cm in it); root-local: x left, z forward */
 function hareCarry(a){const t=a.ht;const L=(x,y,z)=>root.localToWorld(V(x,y,z));
  const P1=L(-.14,.62,.36),P2=L(-.34,.82,.06);const t0=a.pkT||(a.pkT=t);const at=t<t0+.65?a.hg0.clone().lerp(P1,smooth(t0,t0+.65,t)):P1.clone().lerp(P2,smooth(1.55,2.15,t));
  const w=1-smooth(2.25,2.7,t);if(w>.01)odReach('Right',at,w);}
 /* HUNT: a real shot, by hand. The right hand goes back over the shoulder into the quiver and draws an arrow, brings it to the bow,
    nocks it on the string and pulls the string back to the cheek (the string bends to the fingers); on the release that same arrow
    leaves from where it lay. (It used to appear out of nothing at the bow hand at the release, the string never moved: watch, v6 at night) */
 let bowStr=null,handArrow=null,shotOn=0,shotA=null;
 function bowString(nock){const bw=PP().tools&&PP().tools.bow;if(!bw)return;
  if(bw.userData.strMesh===undefined){bw.userData.strMesh=null;bw.traverse(o=>{if(o.isMesh&&o.material&&o.material.color&&o.material.color.getHex()===0xE8E2D0)bw.userData.strMesh=o;});}
  const base=bw.userData.strMesh;
  if(!bowStr){const m=new THREE.MeshStandardMaterial({color:0xE8E2D0,roughness:.6});bowStr=[0,1].map(()=>{const c=new THREE.Mesh(new THREE.CylinderGeometry(.0025,.0025,1,4),m);c.castShadow=true;c.frustumCulled=false;c.visible=false;c.name='bowString';scene.add(c);return c;});}
  if(!nock||!bw.visible||!base){if(base)base.visible=true;for(const c of bowStr)c.visible=false;return;}
  base.visible=false;bw.updateMatrixWorld(true);const tips=[bw.localToWorld(V(0,.56,.002)),bw.localToWorld(V(0,-.56,.002))];
  tips.forEach((t,i)=>{const c=bowStr[i];const d=nock.clone().sub(t);const L=d.length();c.position.copy(t).addScaledVector(d,.5);c.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());c.scale.set(1,L,1);c.visible=true;});}
 const SHOT={reach0:.4,reach1:1.25,take:1.3,back0:1.35,back1:2.15,nock:2.15,rel:3.95};/* slow in and out: a 0.4 s reach jumped the right hand 7-11 cm a frame (gate) */
 function shotPost(a){const t=a.ht;const Q=PP().tools&&PP().tools.quiver;if(!Q||Q.parent!==bones.Spine2)return;
  /* into the quiver: the fingers to the fletchings at its mouth */const w=smooth(SHOT.reach0,SHOT.reach1,t)*(1-smooth(SHOT.back0,SHOT.back1,t));if(w>.01&&!a.rel)odReach('Right',Q.localToWorld(V(0,.1,0)),.65*w);/* most of the way to the quiver mouth, eased: at full weight the shoulder could not follow behind the head and the hand jumped 8-11 cm */
  shotA=a;if(!shotOn){shotOn=1;lateFn(()=>{const A=shotA;shotA=null;if(A&&act===A&&A.step==='hunt'&&A.hp==='shoot')shotLate(A);else if(handArrow&&handArrow.visible&&!(act&&act.ar)){handArrow.visible=false;bowString(null);}});}}
 function shotLate(a){const t=a.ht;const Q=PP().tools.quiver,bw=PP().tools.bow;if(a.rel){bowString(null);return;}
  if(t<SHOT.take){if(handArrow)handArrow.visible=false;bowString(null);return;}
  if(!handArrow){handArrow=arrowMesh();handArrow.name='handArrow';scene.add(handArrow);}if(!handArrow.visible){handArrow.visible=true;AU('cloth');}
  const palm=odPalm('Right');const grip=bw?bw.localToWorld(V(0,.03,.02)):odPalm('Left');
  const up=Q.localToWorld(V(0,1,0)).sub(Q.localToWorld(V(0,0,0))).normalize();const toBow=grip.clone().sub(palm).normalize();
  const k=smooth(SHOT.take,SHOT.nock,t);const dir=up.clone().lerp(toBow,k).normalize();
  /* held at the nock end between the fingers; once on the string the shaft runs from the fingers over the bow hand */
  const pos=palm.clone().addScaledVector(dir,.31);handArrow.position.copy(pos);handArrow.lookAt(pos.clone().add(dir));handArrow.updateMatrixWorld(true);
  bowString(t>=SHOT.nock?palm.clone().lerp(grip,1-smooth(SHOT.nock,SHOT.nock+.4,t)):null);}
 function huntEnd(a){if(hareObj&&hareObj.parent)hareObj.parent.remove(hareObj);if(handArrow&&handArrow.parent)handArrow.parent.remove(handArrow);handArrow=null;try{bowString(null);}catch(e){}if(arrowObj&&arrowObj.parent)arrowObj.parent.remove(arrowObj);
  try{const bw=PP().tools.bow;if(bw&&bw.parent===bones.LeftHand)onBack('bow',V(-.02,.03,-.18),[0,0,.55]);}catch(e){}H.look=null;H.lookW=0;H.slide=null;}
 /* the bow changes parent (back <-> fist) without a jump: from where it was it eases into its new place over 0.35 s */
 function bowMove(a,fn){const bw=PP().tools&&PP().tools.bow;if(!bw)return;bw.updateMatrixWorld(true);const M0=bw.matrixWorld.clone();try{fn();}catch(e){}a.bt={M0,tp:bw.position.clone(),tq:bw.quaternion.clone(),ts:bw.scale.clone(),k:0};}
 function bowTween(a,dt){const T=a.bt;if(!T)return;const bw=PP().tools&&PP().tools.bow;if(!bw||!bw.parent){a.bt=null;return;}T.k=Math.min(1,T.k+dt/.35);bw.parent.updateWorldMatrix(true,false);
  const L=bw.parent.matrixWorld.clone().invert().multiply(T.M0);const p0=V(),q0=new THREE.Quaternion(),s0=V();L.decompose(p0,q0,s0);const k=smooth(0,1,T.k);bw.position.lerpVectors(p0,T.tp,k);bw.quaternion.slerpQuaternions(q0,T.tq,k);bw.scale.lerpVectors(s0,T.ts,k);if(T.k>=1)a.bt=null;}
 function huntTick(a,dt){a.ht+=dt;const t=a.ht;const ok=a.hres&&a.hres.ok;bowTween(a,dt);
  if(a.hp==='draw'){a.rk=t/1.6;if(t>.6&&!a.bg){a.bg=1;bowMove(a,()=>PP().grab('bow',bones.LeftHand,{offset:V(0,.08,.03)}));AU('cloth');}
   if(t>1.6){a.hp='shoot';a.ht=0;once('hy_bowshoot',{fade:.35});AU('arrow');}return;}
  if(a.hp==='shoot'){if(t>1.8&&!a.dr){a.dr=1;AU('bow_draw',root.position);}
   if(t>SHOT.rel&&!a.rel){a.rel=1;AU('bow_release',root.position);if(handArrow&&handArrow.visible){if(arrowObj&&arrowObj.parent)arrowObj.parent.remove(arrowObj);arrowObj=handArrow;handArrow=null;}/* the nocked arrow itself flies */else{arrowObj=arrowObj||arrowMesh();arrowObj.position.copy(bones.LeftHand.getWorldPosition(V()));}const from=arrowObj.position.clone();scene.add(arrowObj);arrowObj.visible=true;bowString(null);
    const to=a.hareAt.clone().add(V(0,.1,0));if(!ok)to.addScaledVector(V(fwd(H.face).z,0,-fwd(H.face).x),.5).addScaledVector(fwd(H.face),2.5);arrowObj.lookAt(to);a.ar={from,to,t:0};}
   if(a.ar){const A=a.ar;A.t+=dt/(ok?.18:.3);const k=Math.min(1,A.t);arrowObj.position.lerpVectors(A.from,A.to,k);if(k>=1){a.ar=null;if(ok){hareObj.attach(arrowObj);a.fall=0;}else arrowObj.visible=false;}}
   if(ok&&a.fall!=null&&a.fall<1){a.fall=Math.min(1,a.fall+dt/.25);hareObj.rotation.z=smooth(0,1,a.fall)*Math.PI/2*.95;hareObj.position.y=a.hareAt.y+.0;}
   if(!ok&&a.rel){/* missed: the hare is off into the trees */a.hop=(a.hop||0)+dt;const f=fwd(H.face);const r=V(f.z,0,-f.x);const k=a.hop/1.2;if(k<1){const p=a.hareAt.clone().addScaledVector(f,2.6*k).addScaledVector(r,1.2*k);p.y=gH(p.x,p.z,a.hareAt.y)+.12*Math.abs(Math.sin(k*Math.PI*5));hareObj.position.copy(p);hareObj.rotation.y=Math.atan2(f.x+r.x*.4,f.z+r.z*.4);}else hareObj.visible=false;}
   if(t>durOf('hy_bowshoot')-.05){a.hp='scan';a.ht=0;play('hy_scanbow',{fade:.5});H.lookW=0;}return;}
  if(a.hp==='scan'){if(t>(ok?2.5:5.5)){if(ok){a.hp='stalk';a.ht=0;const f=fwd(root.rotation.y);const fr=V(f.z,0,-f.x);
     /* he stops where his right hand, at the bottom of the pick-up, is on the hare (clip: 17 cm ahead, 1 cm left of the root) */
     const st=a.hareAt.clone().addScaledVector(f,-.43).addScaledVector(fr,.22);/* it lies out front and to the right, past his right knee: the knee he drops onto and his feet stay clear of it (gate: feet 4, shins 7 cm in it) *//* the hand takes it by the hind legs: the body lies out in front, clear of his shins (gate: shins 7 cm in it) */hareObj.rotation.y=Math.atan2(f.x,f.z);hareObj.position.addScaledVector(f,0);const sx=st.x-root.position.x,sz=st.z-root.position.z;const d=Math.hypot(sx,sz);H.face=Math.atan2(sx,sz);
     H.slide={x:sx,z:sz,yaw:0,k:0,d:Math.max(1,d/.42)};play('hy_sneak',{fade:.4,speed:1.3});H.look=a.hareAt.clone();H.lookW=.6;}
    else{a.hp='stow';a.ht=0;play(IDLE(),{fade:.4});}}return;}
  if(a.hp==='stalk'){root.rotation.y+=clamp(wrapA(H.face-root.rotation.y),-2*dt,2*dt);if(!H.slide){a.hp='pick';a.ht=0;once('hy_pickhare',{fade:.3});H.lookW=0;}return;}
  if(a.hp==='pick'){if(t>.85&&!a.ph2&&(odPalmTo('Right',a.hg0||V())<.06||t>1.1)){a.ph2=1;a.hg0=odPalm('Right');bones.RightHand.updateWorldMatrix(true,false);bones.RightHand.attach(hareObj);AU('cloth');}
   if(t>2.25&&!a.ph3){a.ph3=1;hareObj.visible=false;if(hareObj.parent)hareObj.parent.remove(hareObj);AU('zip');}
   if(t>durOf('hy_pickhare')-.05){a.hp='stow';a.ht=0;play(IDLE(),{fade:.4});}return;}
  if(a.hp==='stow'){a.rk=1-t/1.6;if(t>1.0&&!a.bs){a.bs=1;bowMove(a,()=>onBack('bow',V(-.02,.03,-.18),[0,0,.55]));AU('cloth');}
   if(t>1.6){huntEnd(a);const g=a.goOut;a.goOut=null;g&&g();}return;}}
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
   if(kind==='hunt'&&(o.hit!=null?!o.hit:Math.random()<.3))res={ok:false};else res=kind==='hunt'?{ok:true,meat:2}:{ok:true,logs:rnd(0,1)<.5?2:3};
   const goOut=()=>{if(a.leaving)return;a.step='out';goTo('g_out',()=>{if(a.leaving)return;a.step='away';a.t=0;root.visible=false;});};
   /* OUTDOOR hunt (phone watch: three game hours of nothing behind a bush): at the forest edge, in sight, he takes the bow off
      his back, waits for a hare, shoots, stalks up to it and puts it in the sack; then on out of sight for the rest of the trip */
   const canHunt=kind==='hunt'&&!o.lantern&&!GEAR.lantern&&N.g_edge&&['hy_bowshoot','hy_scanbow','hy_sneak','hy_pickhare'].every(has)&&!window.__noHunt;
   gearOn(a,{jacket:o.jacket,bow:o.bow??kind==='hunt',lantern:o.lantern},()=>{if(a.leaving)return;if(canHunt){a.step='out';goTo('g_edge',()=>{if(a.leaving)return;huntStart(a,res,goOut);});}else goOut();});
   a.update=dt=>{if(stepTick(a,dt))return;carryOv();if(a.step==='hunt'){huntTick(a,dt);return;}if(a.step==='away'){/* out of sight he turns round for home at an easy pace: no 180-degree snap when he reappears (QA: 45 cm/frame² hand jumps) */const fh=N.g_out.face!=null?N.g_out.face+Math.PI:H.face;H.face=fh;root.rotation.y+=clamp(wrapA(fh-root.rotation.y),-1.6*dt,1.6*dt);if(a.t>away&&Math.abs(wrapA(fh-root.rotation.y))<.02){root.rotation.y=fh;home();}}};
   // OUTDOOR: called away, he never walks off with the bow, quiver or lantern on him: the meat goes into the fridge and the
   // gear back on its pegs first, by hand (Pavel: worn only for the hunt). Out of sight in the forest he first comes back.
   /* called away in the middle of a peg clip (taking the bow down): that clip's hits would still fire once the next task had begun,
      slinging the bow and quiver on him for the chores (watch: sweeping and chopping indoors with the quiver on). Drop the pending
      clip and go by what is actually on him, not by the flags */
   a.leave=cb=>{a.leaving=true;root.visible=true;if(a.step==='clip'){H.once=null;a.hits=[];}gearSync();if(a.step==='hunt')huntEnd(a);if(a.step==='away'||a.step==='hunt')a.step='home';
    const off=()=>{if(GEAR.bow||GEAR.lantern||GEAR.coat)gearOff(a,()=>{play(IDLE(),{fade:.4});cb();});else cb();};
    if(a.haul&&a.unload){const u=a.unload;a.unload=null;u(off);}else{if(a.haul){try{PP().release(a.haul);window.__audio.carry(false);}catch(e){}H.carry=null;a.haul=null;}off();}};a.post=()=>{if(a.haul==='logArmful')odArmful();clipReach(a);};return a;},
  store:(o={})=>{const a={step:'go',t:0};const P=PP();try{P.grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}H.carry='hy_carrysack';
   fridgeVisit(a,'in',()=>endTask({ok:true}));
   a.update=dt=>{if(!stepTick(a,dt))carryOv();};a.leave=cb=>{const go=()=>{try{P.release('meatBag');P.fridge.openTo(0,.4);}catch(e){}H.carry=null;cb();};if(fridgeLeave(a,go))return;go();};return a;},
  eat:(o={})=>eatAction(o),
  // water: the tap bucket from the pond, the drain bucket emptied outside
  fetchwater:(o={})=>{const a={step:'go',t:0};const P=PP();const pond=window.__ground&&window.__ground.pond&&window.__ground.pond.fill;
   const lit=!!(o.lantern&&hasTool('lantern'));const home=then=>{if(!GEAR.lantern){then();return;}lanternSwap(a,'Left','Right',()=>gearOff(a,then));};
   if(lit&&!GEAR.lantern){a.lswNext=1;gearOn(a,{lantern:true},()=>{a.lswNext=0;if(a.leaving)return;lanternSwap(a,'Right','Left',()=>{if(!a.leaving)fwGo();});});}else if(lanternLeft()||!GEAR.lantern)fwGo();else lanternSwap(a,'Right','Left',fwGo);
   function fwGo(){shelfVisit(a,'hy_take',[[.45,()=>{try{P.grab('waterBucket',bones.RightHand,{offset:V(0,.06,.02)});}catch(e){}H.carry=BUCKET();}]],()=>{a.step='out';
    const spot=pond?pond.clone?pond.clone():V(pond.x,pond.y,pond.z):(N.g_exit1?N.g_exit1.p.clone().add(V(.6,0,.6)):null);
    const fill=()=>{a.step='fill';a.ft=0;a.fdone=()=>{try{window.__audio.carry(true);}catch(e){}play(IDLE(),{fade:.4});H.look=root.position.clone().addScaledVector(fwd(H.face),2.5);H.lookW=.6;/* a breath at the water before carrying it home */
      H.wait={t:rnd(1.5,2.5),then:()=>{a.step='back';a.put=1;H.look=null;H.lookW=0;/* no stale gaze up the ladder (he walked off it staring at the sky) */shelfVisit(a,'hy_take',[[.5,()=>{try{P.release('waterBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>home(()=>endTask({ok:true})));}};};};
    if(N.g_pond){goTo('g_pond',()=>{H.face=N.g_pond.face;a.step='turn';a.t=0;a.next=fill;a.adur=.6;a.step='approach';});return;}
    if(spot){const nn=nearNode(spot)||'g_exit1';goTo(nn,()=>approachTo(a,spot,.5,fill));}else fill();});}
   a.update=dt=>{if(a.step==='fill'){pondFill(a,dt);return;}if(!stepTick(a,dt)){carryOv();if(H.carry&&H.path.length){a.sl=(a.sl||0)+dt;if(a.sl>.55){a.sl=0;AU('slosh',root.position);}}}};
   a.post=()=>{if(a.step==='fill'&&a.dip){H.bucketTilt=true;pondFillPost(a);}else if(!shelfPath(a))odHang('waterBucket',0);};
   /* OUTDOOR: called away with the bucket on him (in the fist, or on the rope up a ladder) he first carries it to the sink and sets
      it down there by hand: dropped back onto the shelf in one frame, or left on the rope, it rode along into the next jobs for hours
      (critic W3) and then jumped home */
   a.leave=cb=>{a.leaving=true;if(a.step==='clip'){H.once=null;a.hits=[];}gearSync();lswLeave(a);H.wait=null;const o=P.tools.waterBucket;
    const done=()=>{try{slung.waterBucket=0;window.__audio.carry(false);}catch(e){}H.carry=null;play(IDLE(),{fade:.4});cb();};
    const onHim=o&&(o.parent===bones.RightHand||slung.waterBucket||onHeroT('waterBucket'));
    if(onHim){a.step='back';a.put=1;a.dip=0;H.bucketTilt=false;shelfVisit(a,'hy_take',[[.5,()=>{try{P.release('waterBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>home(done));}
    else home(done);};return a;},
  setbucket:(o={})=>{const a={step:'go',t:0,put:1,post:()=>{if(!shelfPath(a))odHang('waterBucket',0);}};const P=PP();shelfVisit(a,'hy_take',[[.5,()=>{try{P.release('waterBucket',{blend:.3});}catch(e){}H.carry=null;}]],()=>endTask({ok:true}));
   a.update=dt=>{stepTick(a,dt);};return a;},
  dumpwater:(o={})=>{const a={step:'go',t:0};const P=PP();
   const lit=!!(o.lantern&&hasTool('lantern'));const home=then=>{if(!GEAR.lantern){then();return;}lanternSwap(a,'Left','Right',()=>gearOff(a,then));};
   if(lit&&!GEAR.lantern){a.lswNext=1;gearOn(a,{lantern:true},()=>{a.lswNext=0;if(a.leaving)return;lanternSwap(a,'Right','Left',()=>{if(!a.leaving)dwGo();});});}else if(lanternLeft()||!GEAR.lantern)dwGo();else lanternSwap(a,'Right','Left',dwGo);
   function dwGo(){drainVisit(a,'hy_pickground',[[.45,()=>{try{P.grab('drainBucket',bones.RightHand,{offset:V(0,.06,.02)});window.__audio.carry(true);}catch(e){}H.carry=BUCKET();}]],()=>{a.step='out';
    goTo('gate',()=>{H.face=N.gate.face??0;a.step='pour';a.t=0;play(IDLE(),{fade:.4});/* hy_water (a watering clip) twisted him 90 deg off the edge: the pour is the arms' own work */
     // long enough to empty it (the stream runs 5 s for a full bucket); emptied for sure at the end, else the brain sent him again and again
     let lv=.6;try{lv=P.water.dirty;}catch(e){}a.D=clamp(1.9+lv*5.2,2.8,6.5);H.wait={t:a.D,then:()=>{try{P.water.pour('drainBucket',false);P.water.setDirty(0);}catch(e){}
      a.step='back';a.back=1;drainVisit(a,'hy_pickground',[[.47,()=>{try{P.release('drainBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>home(()=>endTask({ok:true})));}};});});}
   a.update=dt=>{if(stepTick(a,dt))return;carryOv();if(a.step==='pour'){/* up to the very edge (the gap in the rail for the ladder) so the stream goes over it, not onto the boards */if(!a.e0){a.e0=root.position.clone();}const ef=fwd(root.rotation.y);const k=smooth(0,.6,a.t)*(1-smooth(a.D-.6,a.D,a.t));root.position.x=a.e0.x+ef.x*.2*k;root.position.z=a.e0.z+ef.z*.2*k;if(a.t>.8&&!a.p){a.p=1;try{P.water.pour('drainBucket',true);}catch(e){}AU('bucket_dump',root.position);}}};
   // OUTDOOR: the pour: the fist lifts the bucket out over the edge, the other hand under its bottom tips it right over, then back
   // taking it from under the sink and putting it back: the fist carries it on a clean path between its spot and his side,
   // never past his legs (frame by frame his shin went into it as the pick-up clip swung the hand back by the feet)
   a.post=()=>{if(a.step!=='clip')a.sqOn=0;if(a.step==='clip'||(a.sqW||0)>.01){sqA=a;if(!sqOn){sqOn=1;lateFn(()=>{const A=sqA;sqA=null;if(A&&act===A)squatFeet(A);});}}else{a.sqD=0;a.sqW=0;}/* eased out after the squat too (reset at its end, the boots jumped back up) */if(a.step==='clip'&&PP().tools.drainBucket.parent===bones.RightHand){const k=a.t/Math.max(.3,a.clipDur);const hs=PP().tools.drainBucket.userData.home.scale||1;
     const hg=PP().toolHome('drainBucket').add(V(0,.35*hs,0));const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);const cy=bones.Hips.getWorldPosition(V()).addScaledVector(r,.42).addScaledVector(f,.06).add(V(0,-.12,0));cy.y=Math.max(cy.y,root.position.y+.42);/* in the squat the knees splay: the bucket is held up and out past them, its bottom off the floor (gate: shins 15 cm in it) */
     const u=a.back?smooth(.12,.45,k):1-smooth(.5,.85,k);const mid=hg.clone().addScaledVector(r,.36);mid.y=Math.max(mid.y,cy.y);/* out to the right at the bay first, then back to his side: never back past the shins */odReach('Right',u>.5?mid.lerp(hg,smooth(.5,1,u)):cy.clone().lerp(mid,smooth(0,.5,u)),1);odHang('drainBucket',0,true);return;}
    if(a.step!=='pour'){odHang('drainBucket',0);return;}H.bucketTilt=true;const D=a.D||2.8;const t=a.t;const w=smooth(0,.5,t)*(1-smooth(D-.5,D,t));const f=fwd(root.rotation.y);
    if(w>.01)odReach('Right',root.position.clone().addScaledVector(f,.62).addScaledVector(V(-f.z,0,f.x),.2).add(V(0,.85,0)),w);/* from the waist, leaning out over the edge: the tipped pail hangs in front of his belly, never up before his face (phone watch f1040) */const tilt=1.6*smooth(.45,.95,t)*(1-smooth(D-.8,D-.25,t));odHang('drainBucket',tilt);
    const bk=PP().tools.drainBucket;if(bk&&w>.01&&!lanternLeft()){const bt=bk.localToWorld(V(0,.02,0));odReach('Left',bt,.85*w*smooth(.3,.6,t));odHang('drainBucket',tilt);}/* with the lantern in the left hand he tips it one-handed */};
   a.leave=cb=>{a.leaving=true;if(a.step==='clip'){H.once=null;a.hits=[];}gearSync();lswLeave(a);H.wait=null;try{P.water.pour('drainBucket',false);}catch(e){}const o=P.tools.drainBucket;
    const done=()=>{try{slung.drainBucket=0;window.__audio.carry(false);}catch(e){}H.carry=null;play(IDLE(),{fade:.4});cb();};
    const onHim=o&&(o.parent===bones.RightHand||slung.drainBucket||onHeroT('drainBucket'));/* back under the sink by hand first, as for the water bucket (critic W3) */
    if(onHim){a.step='back';a.back=1;drainVisit(a,'hy_pickground',[[.47,()=>{try{P.release('drainBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>home(done));}
    else home(done);};return a;},
  // OUTDOOR (Сделать вылазки наружу естественными): splitting firewood at the chopping block by the oak with the real axe.
  // He takes the axe out of the block, picks a round from the little stack beside it (squat, left hand), stands it on the block,
  // then swings two-handed: the axe goes up over his head round the shoulders and comes down so its edge lands on the round's top
  // (left hand at the handle's end, right hand above it). A blow either sticks (wiggle, pull out, swing again) or splits the round:
  // the halves tip off both sides onto the ground. The axe goes back into the block at the end. Everything moves only in a hand.
  splitwood:(o={})=>{const P=PP();const blk=P&&P.objects&&P.objects.chopblock;if(!blk||!hasTool('axe')){return {update:()=>endTask({ok:false})};}
   const S=splitState(blk);const top=()=>S.top.clone();
   // the plan: rounds, each split with 1-3 blows; the job lasts exactly as long as the plan
   const n=o.rounds||(2+(Math.random()<.5?1:0)),plan=[];let tot=.6;for(let i=0;i<n;i++){const hits=Math.random()<.55?1:Math.random()<.7?2:3;plan.push(hits);tot+=SPL_T.place+SPL_T.pre+hits*SPL_T.swing+SPL_T.after;}
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
   const inner=cookBase(Object.assign({},o,{meat:true}));act=inner;inner.name='cook';const cd=rnd(22,34);let ct=0;const iu=inner.update;inner.update=dt=>{iu&&iu(dt);ct+=dt;if(ct>cd&&!inner.left){inner.left=true;inner.leave(()=>{try{P.pan&&P.pan.setMeat&&P.pan.setMeat(false);P.plate&&P.plate.setFood&&P.plate.setFood(1);}catch(e){}endTask({ok:true});});}};});
  a.update=dt=>{stepTick(a,dt);};a.leave=cb=>{const go=()=>{try{P.release('meatBag');P.fridge.openTo(0,.4);}catch(e){}cb();};if(fridgeLeave(a,go))return;go();};return a;};}

 // ---------- sitting, lying down, getting up ----------
 // H.fit places the root so the hip joints are at fit.y (seat or mattress + clearance) whatever the clip assumes;
 // while sitting down / standing up it blends with how far the hips have travelled, so the body never pops.
 function sitDown(spot,then){H.trans=true;H.ground=false;H.face=spot.face;const fl=spot.floor??floorTop(BD);
  {const st=spot.p.clone().sub(rotY(V(sdEnd.x,0,sdEnd.z),spot.face));H.slide={x:st.x-root.position.x,z:st.z-root.position.z,yaw:wrapA(spot.face-root.rotation.y),k:0,d:.6};}
  H.fit={mode:'sit',base:fl,y:spot.seat+SEAT_CLEAR,hStand:hyAt(SIT,0),hSeat:hyAt(SIT,1)};{const e=root.position.y-fl;if(Math.abs(e)>.01&&Math.abs(e)<.4)H.fit.e=e;}/* arriving a little off the boards: ease onto them, no one-frame hop (gate: 16-21 cm root jump at the bed) */
  once(SIT,{fade:.4,then:()=>{H.trans=false;H.seated=spot;H.fit.mode='hold';{const dx=spot.p.x-root.position.x,dz=spot.p.z-root.position.z;if(Math.hypot(dx,dz)<.3)H.slide={x:dx,z:dz,yaw:wrapA(spot.face-root.rotation.y),k:0,d:.6};}then&&then();}});}
 /* GRAB: at the reading table he scoots the chair in under it once seated (the table top was 80 cm from his shoulders: the book flew
    to his lap by itself) and back out before he gets up; props chairPull moves the chair, H.slide moves him with it */
 const SCOOT=.22;function chairScoot(inn,d=.7){const s=N.chair;if(!s||!P3||!P3.chairPull)return 0;const tg=inn?SCOOT:0,dd=tg-(H.scoot||0);if(Math.abs(dd)<.005)return 0;H.scoot=tg;P3.chairPull(-tg/.2,d);const f=fwd(s.face);H.slide={x:f.x*dd,z:f.z*dd,yaw:0,k:0,d};return d;}
 function standUp(spot,then){if(spot===N.chair&&H.scoot){H.trans=true;H.scootH=1;/* hands onto the seat first, then the push back */H.wait={t:.28,then:()=>{const d=chairScoot(false,.6);H.wait={t:d+.05,then:()=>{H.scootH=0;standUp(spot,then);}};}};return;}H.trans=true;H.face=spot.face;const fl=spot.floor??floorTop(BD);
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
 function bedLegClear(dt){if(window.__noLegClear)return;const b=H.bedB;const B=FIT.bed;if(!B||!(b||H.inBed)){legClr.Left.l=legClr.Right.l=0;return;}const rest=H.inBed&&!b&&!H.trans;/* BED (gate v6 f3387): asleep the legs rest on the mattress: this lift held both ankles 10 cm up all night and the v6 feet hung 11 cm over it */const railZ=B.z1+.08,yReq=B.mat+.1,xMin=B.x0+.07;
  for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());
   const rs=rest&&HU[s].v<.05;/* only a foot that lies flat under its ankle (v6); the original hero's long foot kept its old clearance (gate-clean) */const k=rs?0:smooth(railZ+.5,railZ+.03,a.z);const S=legClr[s];const want=Math.max(0,yReq-a.y)*k;S.l+=clamp(want-S.l,-1.1*dt,1.4*dt);S.l=Math.max(S.l,want*smooth(railZ+.12,railZ,a.z));
   const lift=S.l;const dx=Math.max(0,xMin-a.x)*(rs?1:k);if(lift<.002&&dx<.002)continue;
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
 function sleepTick(dt){const on=H.inBed&&!H.bedB&&!H.trans;SP.w+= ((on?1:0)-SP.w)*Math.min(1,dt*(on?.8:3));if(SP.w<.002){SP.w=0;if(!on){SP.aw=0;SP.name='back';SP.cur={...SLEEP_POSES.back};SP.to=null;}return;}
  if(on){if(SP.to){SP.t+=dt;const k=smooth(0,1,SP.t/SP.dur);for(const key in SP.cur)SP.cur[key]=lerp(SP.from[key],SP.to[key],k);
    const mid=Math.sin(Math.PI*Math.min(1,SP.t/SP.dur));SP.cur.flex+=.35*mid;SP.cur.knee+=.4*mid;SP.cur.lift+=.03*mid;// knees come up while he rolls
    if(SP.t>=SP.dur){SP.to=null;bedPress(true);}}
   else if((SP.next-=dt)<=0||(window.__sleepPose&&window.__sleepPose!==SP.name)){const n=window.__sleepPose||sleepPick();SP.from={...SP.cur};SP.to={...SLEEP_POSES[n]};SP.name=n;SP.t=0;SP.dur=rnd(2.4,3.4);SP.next=rnd(45,140);sfx&&sfx.rustle&&sfx.rustle();}}
  const c=SP.cur,w=SP.w;root.updateMatrixWorld(true);
  /* TURNING OVER without pops (Pavel: no twitches): every switch here is continuous. The side he lies on comes from the roll's sign, the
     side/back/belly blends from how far he has rolled, and the 'mid-turn' easing of the arms and legs follows the turn's own sine
     (the old on/off flags made 5-16 cm/frame jumps of the hands and feet at the start and end of every turn) */
  const ar=Math.abs(c.roll);SP.sS=smooth(.3,.9,ar);SP.sB=smooth(1.8,2.2,ar);SP.mid=SP.to?Math.sin(Math.PI*Math.min(1,SP.t/SP.dur)):0;
  const hp=wp(bones.Hips),nk=wp(bones.Neck);const ax=nk.clone().sub(hp).setY(0).normalize();// roll about the bed's long axis (a tilted axis would swing the legs up)
  rotW(bones.Hips,ax,c.roll*w);
  // after the roll: the body's front, and each limb bends toward it
  const lft=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).normalize();const front=V().crossVectors(lft,ax).normalize();// character's left x up = front
  const bend=(a,b,ang,toFront=true)=>{if(!a||!b)return;const d=wp(b).sub(wp(a)).normalize();const axis=V().crossVectors(d,toFront?front:front.clone().negate());if(axis.lengthSq()<1e-6)return;rotW(a,axis.normalize(),ang*w);};
  const down=c.roll>0?'Left':'Right';// the side he lies on (rolled to +roll he is on his left)
  for(const sd of ['Left','Right']){const tp=sd!==down?SP.sS:0;bend(bones[sd+'UpLeg'],bones[sd+'Leg'],c.flex*lerp(.9,1.15,tp));bend(bones[sd+'Leg'],bones[sd+'Foot'],c.knee*lerp(.9,1.1,tp),false);
   bend(bones[sd+'Arm'],bones[sd+'ForeArm'],c.armF*lerp(1,.3,tp));bend(bones[sd+'ForeArm'],bones[sd+'Hand'],c.elb*lerp(1,.5,tp));}
  if(bones.Neck&&Math.abs(c.turnH)>.01)rotW(bones.Neck,ax,-c.turnH*w);
  // breathing: about 13 breaths a minute, the chest rises a little
  SP.br+=dt*2*Math.PI/4.6;const lat=V().crossVectors(ax,front).normalize();rotW(bones.Spine1,lat,Math.sin(SP.br)*.025*w);rotW(bones.Spine2,lat,Math.sin(SP.br-.4)*.015*w);
  root.position.y+=c.lift*w;root.updateMatrixWorld(true);
  sleepLegRest(Math.min(1,w*3),c,down);/* legs rest as soon as he is down (the clip cross-fade lifted the feet ~8 cm for a second) */
  if(!on)SP.aw=0;sleepArms(Math.max(Math.min(1,w*2.5),SP.aw||0),c,ax,front,lft,down);}
 // BED: on his side the upper leg rests (knee on the mattress in front of the lower knee, foot down): the roll + flex alone held the
 // top knee 36 cm up in the air and the quilt stood over it in a tall tent. Each joint is turned so its child drops to a resting height.
 function dropTo(a,b,yT,w){if(!a||!b)return;const pa=wp(a),pb=wp(b);const d=pb.clone().sub(pa);const L=d.length();if(pb.y<=yT+.005)return;
  const dy=Math.max(-L*.98,yT-pa.y);const hz=V(d.x,0,d.z);const hl=hz.length();if(hl<1e-4)return;const d2=hz.multiplyScalar(Math.sqrt(Math.max(0,L*L-dy*dy))/hl).setY(dy);
  const axis=V().crossVectors(d,d2);const sn=axis.length();if(sn<1e-6)return;const ang=Math.atan2(sn,d.dot(d2));rotW(a,axis.divideScalar(sn),ang*w);}
 // BED: how far the lowest point of the foot (heel, sole) is under the ankle in the pose shown, measured on the skinned mesh itself (per hero:
 // the v6 foot hangs only ~1.5 cm under its ankle when lying, the original ~6 cm), refreshed twice a second
 const HU={Left:{v:.065,t:0},Right:{v:.065,t:0},idx:null};
 function heelUnder(sd){const R=HU[sd];if((R.t-=1/60)>0)return R.v;R.t=.5;try{{HU.idx=[];HU.c=HU.c||new Map();root.traverse(o=>{if(!o.isSkinnedMesh||!o.skeleton)return;const g=o.geometry,P=g.attributes.position,si=g.attributes.skinIndex,sw=g.attributes.skinWeight;if(!P||!si||!sw)return;/* per geometry: the boots-off split swaps geometries */const ce=HU.c.get(g);if(ce){if(ce.Left.length||ce.Right.length)HU.idx.push({o,Left:ce.Left,Right:ce.Right});return;}const L=[],Rr=[];
     for(let i=0;i<P.count;i++){let bi=0,bw=-1;for(let k=0;k<4;k++){const w_=[sw.getX,sw.getY,sw.getZ,sw.getW][k].call(sw,i);if(w_>bw){bw=w_;bi=[si.getX,si.getY,si.getZ,si.getW][k].call(si,i);}}const nm=o.skeleton.bones[bi]&&o.skeleton.bones[bi].name||'';if(/LeftFoot|LeftToe/.test(nm))L.push(i);else if(/RightFoot|RightToe/.test(nm))Rr.push(i);}
     HU.c.set(g,{Left:L,Right:Rr});if(L.length||Rr.length)HU.idx.push({o,Left:L,Right:Rr});});}
   const vis=o=>{for(let q=o;q;q=q.parent)if(!q.visible)return false;return true;};let low=1e9;const v=V();
   for(const e of HU.idx){if(!vis(e.o))continue;const P=e.o.geometry.attributes.position;e.o.updateMatrixWorld();for(const i of e[sd]){v.fromBufferAttribute(P,i);e.o.applyBoneTransform(i,v);v.applyMatrix4(e.o.matrixWorld);if(v.y<low)low=v.y;}}
   if(low<1e8){const ay=wp(bones[sd+'Foot']).y;R.v=clamp(ay-low,0,.12);}}catch(e){}return R.v;}
 function sleepLegRest(w,c,down){const B=FIT.bed;if(!B)return;const kk=w*(1-.5*(SP.mid||0))*(1-(SP.sB||0));if(kk<.002)return;
  // on his back: knees only a little up, heels on the mattress (the clip held both feet ~15 cm in the air); the head tips forward a
  // touch so the skull rests in the pillow rather than through it. On his side the upper leg rests on the mattress. Blended by the roll.
  const sS=SP.sS||0,kb=kk*(1-sS),ks=kk*sS;
  if(kb>.002){/* R42-3: on his back the knees fall in over the hips' width, not splayed 29 cm apart at the feet, and lie lower (a box under the quilt) */
   {root.updateMatrixWorld(true);const lr=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg));lr.y=0;const hw=lr.length()/2;if(hw>1e-3){lr.normalize();const mid=wp(bones.LeftUpLeg).add(wp(bones.RightUpLeg)).multiplyScalar(.5);
    for(const sd of ['Left','Right']){const U=bones[sd+'UpLeg'],L=bones[sd+'Leg'];const k=wp(L);const sg=sd==='Left'?1:-1;const off=k.clone().sub(mid).dot(lr)*sg;const lim=hw+.02;if(off<=lim)continue;
     const k2=k.clone().addScaledVector(lr,-sg*(off-lim));turnBone(U,k,k2,kb);root.updateMatrixWorld(true);}}}
   for(const sd of ['Left','Right']){dropTo(bones[sd+'UpLeg'],bones[sd+'Leg'],B.mat+.13,kb);dropTo(bones[sd+'Leg'],bones[sd+'Foot'],B.mat+heelUnder(sd)-.018,kb);}
   if(bones.Neck&&bones.Head){const nk=wp(bones.Neck),hd=wp(bones.Head);const d=hd.clone().sub(nk).normalize();const ax=V().crossVectors(d,V(0,1,0));if(ax.lengthSq()>1e-6)rotW(bones.Neck,ax.normalize(),.18*kb);}}
  if(ks>.002){const top=down==='Left'?'Right':'Left';dropTo(bones[top+'UpLeg'],bones[top+'Leg'],B.mat+.17,ks);dropTo(bones[top+'Leg'],bones[top+'Foot'],B.mat+.1,ks);}}
 // BED: the arms rest on something while he sleeps (watcher B3: the right forearm stayed raised with a stiff claw hand all night).
 // Back: left hand on the mattress beside the hip, right hand on the stomach. Side: the lower hand on the pillow by the face, the
 // upper one on the mattress in front of the chest. Stomach: both hands up by the head. Fingers relax toward the open bind pose.
 const FINGERS=[];root.traverse(o=>{if(o.isBone&&/Hand(Index|Middle|Ring|Pinky|Thumb)\d/.test(o.name))FINGERS.push({b:o,q0:o.quaternion.clone()});});
 function sleepArms(w,c,ax,front,lft,down){const B=FIT.bed;if(!B||w<.01)return;const mat=B.mat;const hp=wp(bones.Hips),ch=bones.Spine2?wp(bones.Spine2):hp.clone().addScaledVector(ax,.3),nk=wp(bones.Neck);
  const sB=SP.sB||0,sS=(SP.sS||0)*(1-sB),sK=1-sS-sB;const k=w*(1-.4*(SP.mid||0));
  for(const sd of ['Left','Right']){const A=bones[sd+'Arm'],Fa=bones[sd+'ForeArm'],Hn=bones[sd+'Hand'];if(!Hn)continue;const out=lft.clone().multiplyScalar(sd==='Left'?1:-1);
   const t=V(),pole=V();const add=(tt,pp,ww)=>{if(ww<1e-4)return;t.addScaledVector(tt,ww);pole.addScaledVector(pp.normalize(),ww);};
   if(sB>0){const tt=nk.clone().addScaledVector(out,.24).addScaledVector(ax,-.02);tt.y=mat+.06;add(tt,out.clone().add(V(0,-.3,0)).addScaledVector(ax,-.5),sB);}
   if(sS>0){if(sd===down){const tt=nk.clone().addScaledVector(front,.2).addScaledVector(ax,.06);tt.y=mat+.1;add(tt,ax.clone().negate().add(V(0,-.4,0)),sS);}
    else{const tt=ch.clone().addScaledVector(front,.26).addScaledVector(ax,-.08);tt.y=mat+.07;add(tt,out.clone().add(ax.clone().multiplyScalar(-.4)),sS);}}
   if(sK>0){let tt;if(sd==='Left'){tt=hp.clone().addScaledVector(out,.24).addScaledVector(ax,.06);tt.y=mat+.05;}else{tt=hp.clone().addScaledVector(ax,.2).addScaledVector(out,.04);tt.y=hp.y+.12;}add(tt,out.clone().add(V(0,-.3,0)),sK);}
   if(pole.lengthSq()<1e-6)pole.copy(out);ik2(A,Fa,Hn,t,pole.normalize(),k,false);
   {/* whatever the blend: a hand over the mattress rests ON it (in mid-turn it sank 6 cm into the front edge, gate) */root.updateMatrixWorld(true);const h=wp(Hn),lo=mat+.035;if(h.x>B.x0&&h.x<B.x1&&h.z<B.z1+.01&&h.y<lo){const tg=h.clone();tg.y=lo;if(tg.z>B.z1-.03)tg.z=B.z1-.03;ik2(A,Fa,Hn,tg,pole,Math.min(1,w*3),false);}}}
  for(const f of FINGERS)f.b.quaternion.slerp(f.q0,.65*w);root.updateMatrixWorld(true);}
 // eyes: shut while he sleeps (and as he lies down / until he sits up), a blink every few seconds when awake
 const BL={t:rnd(2,5),k:0};
 function lidTick(dt){let want=0;const b=H.bedB;if(H.inBed&&!b)want=1;if(H.bedC)want=H.bedC.dir>0?smooth(.75,1,H.bedC.u):1-smooth(0,.3,H.bedC.u);else if(b)want=smooth(.55,.9,b.u)*(b.dir>0?1:smooth(.75,.95,b.u));
  /* the quilt is pulled up and thrown back with his eyes open; they shut once it is over him */if(H.inBed&&QH.on)want=QH.mode==='up'?smooth(QH.tr+QH.tm,QH.tr+QH.tm+QH.trl,QH.t):0;
  BL.t-=dt;if(BL.t<=0){BL.t=rnd(2.5,6);if(Math.random()<.2)BL.t=.25;BL.b=0;}if(BL.b!=null){BL.b+=dt;const k=BL.b<.07?BL.b/.07:1-(BL.b-.07)/.1;if(k<=0)BL.b=null;else want=Math.max(want,k);}
  if(FACE.lid>want)want=FACE.lid;/* a yawn squeezes the eyes half shut; effort narrows them */
  BL.k+=(want-BL.k)*Math.min(1,dt*(want>BL.k?25:8));setLids(BL.k);}
 // FACE (v6 head, pipeline/hero2/facemorph.mjs): morph targets 'effort' (brows down and together, cheeks up, lips pressed)
 // and 'yawn' (jaw drops, brows up; the 'mouth' node's own 'yawn' opens a dark oval over the lips). Heads without them: no-op.
 // effort: from the task (how heavy the work is) times how hard the hand is moving right now (peaks on each strike or lift).
 // yawn: the stretch_yawn clip, now and then when he is tired (late evening, on his way to bed), a little open when asleep;
 // chewing moves the jaw while he eats. Own PRNG: Math.random would shift the seeded gate stream.
 const FACE=(()=>{const tg=[];let mo=null;root.traverse(o=>{if(!o.morphTargetDictionary)return;if(o.name==='mouth')mo=o;else if(o.morphTargetDictionary.effort!=null)tg.push(o);});
  if(mo)mo.castShadow=false;
  return {tg,mo,e:0,y:0,lid:0,yt:null,next:40,seed:7177,hp:null,sm:0,sun:0,sunT:0,fl:null,wx:0,br:null};})();
 const FX_EFF={splitwood:1,saw:.85,repair:.7,hammer:.7,craft:.6,dumpwater:.7,firewood:.6,water:.55,fetchwater:.55,stoke:.45,chop:.35,hunt:.5,sweep:.25};
 function faceRnd(){FACE.seed=(FACE.seed*16807)%2147483647;return FACE.seed/2147483647;}
 // reactions to the world (face only, no bones):
 //  thunder: a wince (brows down, eyes squeezed shut for a moment), stronger the louder it is
 //  low morning sun in his eyes: a squint (sun in front of him and not blocked: rays through the collide grid, 4x a second)
 //  telescope / radio: a small smile while he is at it
 //  cold night outdoors (open sky above him): breath vapour, a few soft sprites from the mouth on each out-breath
 const SUN=(h,o)=>{const sa=(h-6)/14*Math.PI;return o.set(-Math.cos(sa)*.9,Math.max(.12,Math.sin(sa)),.55).normalize();};/* index.html sunDir */
 function rayFree(p,d,a,b,st){const C=window.__collide;if(!C||!C.depthAt)return true;for(let s=a;s<=b;s+=st){if(C.depthAt(p.x+d.x*s,p.y+d.y*s,p.z+d.z*s)>.005)return false;}return true;}
 function faceWorld(dt,t){const WX=window.__weather;
  if(!FACE.wx&&WX&&typeof WX.on==='function'){FACE.wx=1;try{WX.on('thunder',e=>{const k=e&&e.loud!=null?e.loud:.5;if(k>.12&&!H.inBed)FACE.fl={t:0,k:Math.min(1,.45+k*.8),v:0};});}catch(e){}}
  if(FACE.fl){const F=FACE.fl;F.t+=dt;F.v=F.k*smooth(0,.07,F.t)*(1-smooth(.3,1.2,F.t));if(F.t>1.2)FACE.fl=null;}
  const hd=bones.Head;FACE.sunT-=dt;let st=null;try{st=WX&&WX.state?WX.state():null;}catch(e){}
  if(FACE.sunT<=0&&hd){FACE.sunT=.25;const h=hour();let want=0;const hp=hd.getWorldPosition(V());
   if(h>6.2&&h<10&&!H.inBed&&(!st||st.state==='clear'||st.state==='calm')){const sd=SUN(h,V());const q=hd.getWorldQuaternion(new THREE.Quaternion());const f=V(0,0,1).applyQuaternion(q);
    const fa=f.x*sd.x+f.z*sd.z;const fl=Math.hypot(f.x,f.z)*Math.hypot(sd.x,sd.z)||1;const dd=fa/fl;if(dd>.45&&rayFree(hp,sd,.25,6,.25))want=smooth(.45,.85,dd)*(1-smooth(9,10,h))*smooth(6.2,6.8,h);}
   FACE.sunW=want;
   // breath vapour: cold (feels < 7.5 C: late evening, night, dawn, wind or rain) and open sky over his head
   const cold=st&&st.feels!=null?st.feels<7.5:false;const IB=window.__env&&window.__env.interiorBoxes;const indoor=!!(IB&&IB.some(r=>hp.x>r[0]-.3&&hp.x<r[1]+.3&&hp.z>r[4]-.3&&hp.z<r[5]+.3&&hp.y>r[2]-.35&&hp.y<r[3]+.4));/* the rooms (index.html ROOMS via env.setInterior): the roof is not in the collide grid */
   FACE.out=cold&&!H.inBed&&!indoor&&rayFree(hp,V(0,1,0),.3,5,.35);}
  FACE.sun+=((FACE.sunW||0)-FACE.sun)*Math.min(1,dt*2);
  const smT=(t==='telescope'||t==='radio')&&act&&act.step==='work'?.55+.15*Math.sin(actT*.7):0;FACE.sm+=(smT-FACE.sm)*Math.min(1,dt*(smT>FACE.sm?1.2:2));
  breathTick(dt);}
 function breathTick(dt){const B=FACE.br||(FACE.br={ps:[],t:0,mat:null});
  if(!FACE.out&&!B.ps.some(p=>p.s.visible))return;
  if(!B.mat){const c=document.createElement('canvas');c.width=c.height=32;const g=c.getContext('2d');const gr=g.createRadialGradient(16,16,0,16,16,16);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,32,32);
   const tx=new THREE.CanvasTexture(c);B.mat=tx;for(let i=0;i<3;i++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tx,color:0xdfe6ee,transparent:true,opacity:0,depthWrite:false,fog:true}));s.visible=false;s.renderOrder=2;scene.add(s);B.ps.push({s,t:9,v:V()});}}
  const walking=H.path.length>0;const per=walking?2.2:3.6;B.t+=dt;
  if(FACE.out&&B.t>=per){B.t=0;const p=B.ps.find(q=>q.t>1.8);if(p){const m=window.__hero&&window.__hero.mouth?window.__hero.mouth(V()):bones.Head.getWorldPosition(V());const q=bones.Head.getWorldQuaternion(new THREE.Quaternion());const f=V(0,0,1).applyQuaternion(q);
    p.t=0;p.s.position.copy(m).addScaledVector(f,.03);p.v.copy(f).multiplyScalar(.28).add(V(0,.08,0));p.s.visible=true;}}
  for(const p of B.ps){if(!p.s.visible)continue;p.t+=dt;const u=p.t/1.8;if(u>=1){p.s.visible=false;p.s.material.opacity=0;continue;}
   p.s.position.addScaledVector(p.v,dt);p.v.multiplyScalar(Math.exp(-dt*1.5));p.s.scale.setScalar(.04+.17*Math.sqrt(u));p.s.material.opacity=.28*smooth(0,.12,u)*(1-smooth(.35,1,u));}}
 function faceTick(dt){if(!FACE.tg.length||dt<=0)return;const t=H.task||'';let base=FX_EFF[t]||(/^fix/.test(t)?.6:0);
  if(H.inBed||H.seated&&t!=='saw')base=0;if(H.path.length||H.trans||H.lad||H.slide)base=/^(firewood|water|fetchwater)$/.test(t)?base*.5:0;/* on the way there: nothing to strain at (a load in his arms: a little) */
  const hp=bones.RightHand?root.worldToLocal(bones.RightHand.getWorldPosition(V())):null;/* relative to his body: walking is not a strike */let sp=0;if(hp&&FACE.hp){sp=hp.distanceTo(FACE.hp)/dt;}if(hp)FACE.hp=(FACE.hp||V()).copy(hp);
  const eT=base*(.4+.6*smooth(.2,1.4,sp));FACE.e+=(eT-FACE.e)*Math.min(1,dt*(eT>FACE.e?6:2.5));
  // yawns
  const yc=actions.stretch_yawn;let yT=0;if(yc&&H.cur===yc&&yc.isRunning()){const u=yc.time/Math.max(.1,yc.getClip().duration);yT=smooth(.18,.38,u)*(1-smooth(.62,.85,u));}
  const h=hour();const tired=(h>=21.5||h<6)||t==='sleep'&&!H.inBed&&!H.bedB;
  if(t!==FACE.lt){FACE.lt=t;if(t==='sleep'&&!H.inBed&&faceRnd()<.7){FACE.next=1.5+faceRnd()*2.5;FACE.yq=1;}}/* off to bed: usually a yawn on the way */
  FACE.next-=dt;if(FACE.next<=0){FACE.next=25+faceRnd()*50;if(tired&&base===0&&t!=='eat'&&!H.inBed&&!H.bedB&&!H.bedC&&!FACE.yt&&(FACE.yq||faceRnd()<.55))FACE.yt={t:0,d:2.8+faceRnd()*1.2};FACE.yq=0;}
  if(FACE.yt){const Y=FACE.yt;Y.t+=dt;const u=Y.t/Y.d;yT=Math.max(yT,smooth(0,.32,u)*(1-smooth(.68,1,u)));if(u>=1||base>0||H.inBed)FACE.yt=null;}
  if(H.inBed&&!H.bedB&&!H.bedC)yT=Math.max(yT,.1);/* asleep: lips just apart */
  if(t==='eat'&&act&&act.step==='eat'&&!act.rest&&act.cu>.68&&act.cu<.98)yT=Math.max(yT,.13*Math.max(0,Math.sin((act.cu-.68)*Math.PI*2*5))*(1-smooth(.85,.98,act.cu)));/* chewing, in step with the head */
  FACE.y+=(yT-FACE.y)*Math.min(1,dt*(yT>FACE.y?5:3.5));
  faceWorld(dt,t);
  const fl=FACE.fl?FACE.fl.v:0;const ef=Math.max(FACE.e*(1-FACE.y),fl,.38*FACE.sun);FACE.lid=Math.max(.5*smooth(.3,.9,FACE.y),.22*ef,.3*FACE.sun,FACE.fl&&FACE.fl.t<.16?FACE.fl.k:0);
  for(const o of FACE.tg){const D=o.morphTargetDictionary;o.morphTargetInfluences[D.effort]=ef;o.morphTargetInfluences[D.yawn]=FACE.y;if(D.smile!=null)o.morphTargetInfluences[D.smile]=FACE.sm*(1-FACE.y);}
  if(FACE.mo)FACE.mo.morphTargetInfluences[FACE.mo.morphTargetDictionary.yawn]=FACE.y;
  window.__face={e:+ef.toFixed(3),y:+FACE.y.toFixed(3)};window.__faceDbg=()=>[+FACE.sm.toFixed(2),+FACE.sun.toFixed(2),FACE.fl?+FACE.fl.v.toFixed(2):0,!!FACE.out,FACE.br?FACE.br.ps.filter(p=>p.s.visible).length:0];}
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
 const BT={init:false,side:{},vestProp:null,vestOn:true,sockU:{value:new THREE.Vector2(0,0)}};
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
   const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(pos,3));sg.setAttribute('normal',new THREE.BufferAttribute(nor,3));if(uv)sg.setAttribute('uv',new THREE.BufferAttribute(uv,2));sg.setIndex(keep.map(v=>remap.get(v)));/* [HERO LOOK] a boot in his hand or by the bed keeps the worn boot's leather (heroclothes.js attributes, same material) */const KA=g.attributes.kp?['kp','kn','kx'].map(a=>g.attributes[a]):null;if(KA)for(const A of KA){const n=A.itemSize,ar=new Float32Array(used.length*n);used.forEach((v,i)=>{for(let k=0;k<n;k++)ar[i*n+k]=A.array[v*n+k];});sg.setAttribute(A===KA[0]?'kp':A===KA[1]?'kn':'kx',new THREE.BufferAttribute(ar,n));}
   const pm=new THREE.Mesh(sg,KA?(Array.isArray(src.material)?src.material[0]:src.material):(Array.isArray(src.material)?src.material[0]:src.material).clone());pm.castShadow=true;pm.visible=false;pm.name='boot'+sd;scene.add(pm);
   B.prop=pm;B.c0=V(c.x,bb.min.y,c.z);// bind-space position of the prop origin
   B.foot=bones[sd+'Foot'];B.fi=bi(sd+'Foot');B.S=S;B.src=src;
   if(BOOTS){const sk=new THREE.SkinnedMesh(g.clone(),BOOTS.material);sk.geometry.setIndex(keep);sk.name='boots'+sd;sk.castShadow=BOOTS.castShadow;sk.frustumCulled=false;BOOTS.parent.add(sk);sk.position.copy(BOOTS.position);sk.quaternion.copy(BOOTS.quaternion);sk.scale.copy(BOOTS.scale);sk.bind(S,BOOTS.bindMatrix);B.skin=sk;}
   {bootWorld(B,_bbm);const P_=V(),Q_=new THREE.Quaternion(),S_=V();_bbm.decompose(P_,Q_,S_);BT.sc=S_.x;}
   BT.side[sd]=B;}
  if(BOOTS&&BT.side.Left&&BT.side.Right)BOOTS.visible=false;
  // original hero: the foot under the boot becomes a wool sock while the boot is off
  if(!BOOTS&&body&&(BT.side.Left||BT.side.Right)){const m=new Float32Array(P.count);for(let i=0;i<P.count;i++)m[i]=sel.Left[i]?1:sel.Right[i]?2:0;/* per foot: 1 left, 2 right */g.setAttribute('sock',new THREE.BufferAttribute(m,1));
   // BED (Pavel: the vest comes off before sleep, on this hero too): the vest is painted into the one body texture, so the torso's
   // brown leather texels become the mustard shirt under it while the vest is off, and a folded copy of the vest's own triangles
   // lies on the quilt. The mask: torso-weighted vertices whose texel is the vest's brown (not the shirt, skin or trousers).
   const vm=new Float32Array(P.count);let nv=0;const SH=[0,0,0,0,0],VL=[0,0];const mat0=Array.isArray(body.material)?body.material[0]:body.material;
   try{const img=mat0.map&&mat0.map.image;if(img&&UV){const W_=img.width,H_=img.height;const cv=document.createElement('canvas');cv.width=W_;cv.height=H_;const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(img,0,0);const px=cx.getImageData(0,0,W_,H_).data;
     const tor=new Set(['Spine','Spine1','Spine2','LeftShoulder','RightShoulder'].map(bi).filter(x=>x>=0)),hip=new Set([bi('Hips')]);
     for(let i=0;i<P.count;i++){if(wOf(i,tor)<.5||wOf(i,hip)>.35)continue;const u=Math.min(W_-1,Math.max(0,UV.getX(i)*W_|0)),v=Math.min(H_-1,Math.max(0,UV.getY(i)*H_|0));const o=(v*W_+u)*4;const r=px[o]/255,gg=px[o+1]/255,b=px[o+2]/255;
      const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b),sat=mx>0?(mx-mn)/mx:0;const lm=.3*r+.59*gg+.11*b;if(gg>=r||(mx>.7&&sat<.45)||(gg/r>.72&&sat>.45)||mx<.12){/* the shirt's own colour (mustard: red over green over blue, saturated, light) */if(r>gg&&gg>b&&sat>.45&&gg/r>.6&&mx>.35){SH[0]+=r;SH[1]+=gg;SH[2]+=b;SH[3]+=lm;SH[4]++;}continue;}vm[i]=1;nv++;VL[0]+=lm;VL[1]++;}}}catch(e){console.warn('vest mask',e);}
   if(nv>200){/* the shader mask is the torso itself (soft at its border); which texels are vest is decided per pixel in the shader. The per-vertex mask
     on this fragmented atlas left whole strips of leather on the chest and back while the vest was off (watcher r12, 40ef242) */const tm=new Float32Array(P.count);{/* the torso by its place in the bind pose (between the hip joint and the neck, inside the shoulders): bone weights
     missed the lower front panels, which are skinned to the hips and thighs */const bpos=n=>{const k=bi(n);return k<0?null:V().setFromMatrixPosition(S.boneInverses[k].clone().invert());};
     const h0=bpos('Hips'),n0=bpos('Neck'),la=bpos('LeftArm'),ra=bpos('RightArm');if(h0&&n0&&la&&ra){const up=n0.clone().sub(h0),L=up.length();up.normalize();const lat=la.clone().sub(ra);const W2=lat.length()/2;lat.normalize();const mid=la.clone().add(ra).multiplyScalar(.5);
      for(let i=0;i<P.count;i++){const q=bp(i);const y=q.clone().sub(h0).dot(up)/L,x=Math.abs(q.clone().sub(mid).dot(lat))/W2;tm[i]=smooth(-.12,-.04,y)*(1-smooth(1.1,1.2,y))*(1-smooth(.9,1.02,x));}}
     else{const tor=new Set(['Spine','Spine1','Spine2','LeftShoulder','RightShoulder'].map(bi).filter(x=>x>=0)),hip=new Set([bi('Hips')]);for(let i=0;i<P.count;i++)tm[i]=clamp((wOf(i,tor)-.3)/.3,0,1)*(1-clamp((wOf(i,hip)-.6)/.25,0,1));}}
    g.setAttribute('vest',new THREE.BufferAttribute(tm,1));BT.vestU={value:0};/* the shirt colour per unit of brightness, and the vest's mean brightness: the vest texels become shirt, keeping their shading */BT.shirt=SH[4]>20?new THREE.Vector3(SH[0],SH[1],SH[2]).divideScalar(SH[4]):new THREE.Vector3(.72,.52,.2);BT.vestL=VL[1]?VL[0]/VL[1]:.25;BT.shirtL=SH[4]>20?SH[3]/SH[4]:.55;
    const keep=[];for(let t=0;t<nTri;t++){const a=vi(t,0),b=vi(t,1),c=vi(t,2);if(vm[a]&&vm[b]&&vm[c])keep.push(a,b,c);}
    const used=[...new Set(keep)];const remap=new Map(used.map((v,i)=>[v,i]));const pos=new Float32Array(used.length*3),uv=new Float32Array(used.length*2);const bb=new THREE.Box3();
    used.forEach((v,i)=>{const q=bp(v);pos.set([q.x,q.y,q.z],i*3);bb.expandByPoint(q);uv.set([UV.getX(v),UV.getY(v)],i*2);});
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(pos,3));sg.setAttribute('uv',new THREE.BufferAttribute(uv,2));sg.setIndex(keep.map(v=>remap.get(v)));
    BT.dv={geo:sg,bb,mat:mat0.clone()};}
   const mats=Array.isArray(body.material)?body.material:[body.material];body.material=mats.map(m0=>{const m=m0.clone();m.onBeforeCompile=sh=>{sh.uniforms.sockK=BT.sockU;sh.uniforms.vestK=BT.vestU||{value:0};const hv=!!BT.vestU;
     sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float sock;varying float vSock;'+(hv?'attribute float vest;varying float vVest;':'')).replace('#include <begin_vertex>','#include <begin_vertex>\nvSock=sock;'+(hv?'vVest=vest;':''));
     sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform vec2 sockK;varying float vSock;'+(hv?'uniform float vestK;varying float vVest;':'')).replace('#include <map_fragment>','#include <map_fragment>\n{float l=dot(diffuseColor.rgb,vec3(.3,.59,.11));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.27,.25,.23)*(.8+.5*l),(step(.5,vSock)*step(vSock,1.5)*sockK.x+step(1.5,vSock)*sockK.y));}'+
      (hv?'\n{float lv=dot(diffuseColor.rgb,vec3(.3,.59,.11));vec3 sh=vec3('+[BT.shirt.x,BT.shirt.y,BT.shirt.z].map(x=>Math.pow(x,2.2).toFixed(4)).join(',')+')*mix(.94,1.04,smoothstep(.0,'+(2*Math.pow(BT.shirtL,2.2)).toFixed(4)+',lv));/* canvas texels are sRGB, the shader works in linear */vec3 sc=pow(max(diffuseColor.rgb,vec3(0.)),vec3(1./2.2));float mx=max(sc.r,max(sc.g,sc.b)),mn=min(sc.r,min(sc.g,sc.b)),sat=mx>0.?(mx-mn)/mx:0.,gr=sc.g/max(sc.r,.001);/* vest = everything on the torso that is not the mustard shirt, not skin and not the green trousers: the leather is brown, dark grey and black with metal studs */float vb=(1.-smoothstep(.02,.06,sc.g-max(sc.r,sc.b)))*(1.-smoothstep(.64,.74,mx)*(1.-smoothstep(.38,.5,sat))*smoothstep(.08,.16,sc.r-sc.b));/* BED (watcher R18-3, R19-2): the shirt texels are repainted too, all in one shirt colour with only a faint shading: keeping the shirt texels and the leather shading left the vest outline, collar and pockets drawn in olive on the shirt */vestMix=smoothstep(.2,.6,vVest)*vb*vestK;diffuseColor.rgb=mix(diffuseColor.rgb,min(sh,vec3(1.)),vestMix);}':''));
     /* the vest relief (normal map: pocket flaps, seams, collar) and the leather shine go with it */if(hv){sh.fragmentShader=sh.fragmentShader.replace('uniform float vestK;','uniform float vestK;float vestMix=0.;').replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nvec3 vestN0=normal;').replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=normalize(mix(normal,vestN0,vestMix));').replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,max(roughnessFactor,.85),vestMix);');}};
     m.customProgramCacheKey=()=>BT.vestU?'hero-sock2-vest4':'hero-sock2';return m;});if(body.material.length===1)body.material=body.material[0];}
  return BT.ok=true;}catch(e){console.error('boots',e);return BT.ok=false;}}
 // world matrix the static boot needs to sit exactly where the skinned boot is drawn right now
 function bootWorld(B,out){root.updateMatrixWorld(true);const S=B.S;out.copy(B.foot.matrixWorld).multiply(S.boneInverses[B.fi]).multiply(_bm2.makeTranslation(B.c0.x,B.c0.y,B.c0.z));
  if(B.src.bindMode==='detached'){/* not used by these rigs */}return out;}
 function bootSpot(sd){{const B=BT.side[sd];if(B&&B.spot)return {p:B.spot.p.clone(),yaw:B.spot.yaw};}const ed=N.bededge;const hd=FIT.bed&&FIT.bed.headDir||1;// beside the bed, to his right (the foot end), toes to the room
  /* each boot by its own foot, where the evening puts them down (right boot -0.46, left +0.44 along the bed): both on his right left the
     left boot 0.67 m from the left hand after a start in bed, and the morning pick snatched it from there (gate grip 40 cm, no-touch) */
  const R=sd==='Right';return {p:V(ed.p.x+hd*(R?-.46:.44),(ed.floor??floorTop(BD)),(FIT.bed?FIT.bed.z1:ed.p.z)+(R?.15:.13)),yaw:(R?.18:-.12)};}
 function bootShow(sd,on){const B=BT.side[sd];if(!B)return;B.on=on;if(B.skin)B.skin.visible=on;if(!BOOTS){/* each foot its own sock: one boot off left the other foot a grey sock with no boot (orig, watcher) */BT.sockU.value.set(BT.side.Left&&!BT.side.Left.on?1:0,BT.side.Right&&!BT.side.Right.on?1:0);}}
 function bootPark(sd){const B=BT.side[sd];if(!B)return;const s=bootSpot(sd);const pm=B.prop;scene.attach(pm);pm.position.copy(s.p);pm.rotation.set(0,s.yaw,0);pm.scale.setScalar(BT.sc||1);pm.visible=true;}
 // the boot leaves the foot in his hand: the prop takes the skinned boot's exact place, then rides with the hand bone
 function bootToHand(sd,hand){const B=BT.side[sd];if(!B)return;const pm=B.prop;bootWorld(B,_bbm);scene.add(pm);pm.matrix.copy(_bbm);pm.matrix.decompose(pm.position,pm.quaternion,pm.scale);pm.visible=true;bones[hand+'Hand'].attach(pm);bootShow(sd,false);}
 // set down: from the hand to its spot beside the bed in a short, eased move (the hand lets go just above the floor)
 const BTW=[];function bootTween(pm,toP,toQ,d,then){scene.attach(pm);BTW.push({pm,p0:pm.position.clone(),q0:pm.quaternion.clone(),toP,toQ,t:0,d,then});}
 const BFALL=[];function bootFallTick(dt){for(let i=BFALL.length-1;i>=0;i--){const F=BFALL[i];F.v+=9.8*dt;const pm=F.pm;pm.position.y-=F.v*dt;const lo=pm.position.y-F.lift;
   const k=F.h0>.001?clamp(1-(lo-F.fl)/F.h0,0,1):1;pm.quaternion.slerpQuaternions(F.q0,F.q1,smooth(0,1,k));if(lo<=F.fl){pm.position.y=F.fl+F.lift;pm.quaternion.copy(F.q1);pm.userData.freeFall=false;BFALL.splice(i,1);AU('thud',pm.position);}}}
 function bootTweenTick(dt){bootFallTick(dt);for(let i=BTW.length-1;i>=0;i--){const w=BTW[i];w.t+=dt;const k=smooth(0,1,Math.min(1,w.t/w.d));w.pm.position.lerpVectors(w.p0,w.toP,k);w.pm.quaternion.slerpQuaternions(w.q0,w.toQ,k);if(w.t>=w.d){BTW.splice(i,1);w.then&&w.then();}}}
 // a boot set on the floor stands clear of both shins (the gate saw it 7 cm inside the shin when set right under the hand)
 function bootClearShins(p,R=.17){root.updateMatrixWorld(true);for(let it=0;it<2;it++)for(const sd of ['Left','Right']){const k=wp(bones[sd+'Leg']),a=wp(bones[sd+'Foot']);
   const ax=a.x-k.x,az=a.z-k.z,L2=ax*ax+az*az;let t=L2>1e-6?((p.x-k.x)*ax+(p.z-k.z)*az)/L2:1;t=Math.max(0,Math.min(1,t));const cx=k.x+ax*t,cz=k.z+az*t;let dx=p.x-cx,dz=p.z-cz,d=Math.hypot(dx,dz);
   if(d<R){if(d<1e-3){dx=-az;dz=ax;d=Math.hypot(dx,dz)||1;}p.x=cx+dx/d*R;p.z=cz+dz/d*R;}}}
 // BOOTS OFF: where a boot goes down is chosen before the hand goes there (beside his calf, toward the foot end, clear of both shins and
 // of the other boot), and the hand really carries it down to the floor: the gate saw the boot let go 25-45 cm up and glide to a spot
 // 15-45 cm away (no-touch 15.5-17.7 cm, QA b50450e)
 function bootPlan(sd){const ed=N.bededge;const B=FIT.bed;const hd=B&&B.headDir||1;root.updateMatrixWorld(true);const hp=wp(bones.Hips);const k=sd==='Right'?0:1;
  const fl=(ed&&ed.floor)??floorTop(BD);const shp=wp(bones[sd+'Arm']);/* each boot on its own hand's side: the right toward the foot end, the left toward the pillow end */const p=V(hp.x+(sd==='Right'?-hd*.45:hd*.4),fl,(B?B.z1:hp.z)+.26);/* the right foot steps out toward the foot end as he lies down: that boot a little further out *//* the right one further out in front: lying down his legs sweep low toward the foot end *//* out to the side, where his legs never go while he undresses and swings them in (beside the calf they were kicked through) *//* in front, beside the calf: bending forward over it brings the hand down to the floor (straight down from a seated shoulder the arm is ~12 cm short) */bootClearShins(p,.22);
  const o=BT.side[sd==='Left'?'Right':'Left'];if(o&&o.spot){const op=o.spot.p;let dx=p.x-op.x,dz=p.z-op.z,d=Math.hypot(dx,dz);if(d<.17){if(d<1e-3){dx=-hd;dz=0;d=1;}p.x=op.x+dx/d*.17;p.z=op.z+dz/d*.17;bootClearShins(p,.22);}}
  return {p,yaw:sd==='Right'?.18:-.12};}
 // bending over: half from the hips (the pelvis tips, the thighs stay where they are), half along the spine
 function leanB(ax,a){const ph=Math.min(a*.72,.95);/* the pelvis tips at most ~32 degrees (past that the gate sees the leg folded up past the hip) */rotW(bones.Hips,ax,ph);for(const n of ['LeftUpLeg','RightUpLeg'])rotW(bones[n],ax,-ph);['Spine','Spine1','Spine2'].forEach((n,j)=>rotW(bones[n],ax,(a-ph)*[.4,.35,.25][j]));}
 const BRC={a:0};function bootReach(dt){const R=BSEQ.r;if(R&&R.pick){bootPickReach(dt,R);return;}if(!R||!R.down||!R.plan){BRC.a=Math.max(0,BRC.a-(dt||1/60)*2);return;}const sd=R.sd,Bs=BT.side[sd];const pm=Bs&&Bs.prop;
  const held=pm&&pm.visible&&pm.parent&&/Hand$/.test(pm.parent.name);const t=R.t||0;
  if(!held){/* let go: the hand leaves the boot top and eases back to the clip over half a second */const L=R.last;if(!L){BRC.a=Math.max(0,BRC.a-(dt||1/60)*2);return;}const w2=1-smooth(R.at,R.at+.6,t);BRC.a=Math.max(0,BRC.a-(dt||1/60)*1.2);
   if(BRC.a>.002)leanB(L.ax,BRC.a);root.updateMatrixWorld(true);if(w2>.001)romArmIK(L.side,L.tg.clone().add(V(0,.04*(1-w2),0)),sidePole(L.side),w2,null);return;}
  const w=smooth(R.at-.75,R.at-.2,t);if(w<.001){BRC.a=Math.max(0,BRC.a-(dt||1/60)*2);return;}
  root.updateMatrixWorld(true);_hb.setFromObject(pm);const bc=_hb.getCenter(V());bc.y=_hb.min.y;const Hn=bones[pm.parent.name.replace(/^mixamorig/,'')]||bones[sd+'Hand'];const hw=wp(Hn);
  // the wrist goes where it puts the boot's sole on the spot (the boot hangs from the hand as it is held now)
  const tg=R.plan.p.clone().add(hw.clone().sub(bc));tg.y+=.008;const side=/Left/.test(pm.parent.name)?'Left':'Right';const sh=bones[side+'Arm'];const reach=armLen*.97;
  // lean forward and toward the spot just enough that the arm reaches (found by trial, eased: a sudden spine turn is held back by the pop filter)
  const SP=['Spine','Spine1','Spine2'].map(n=>bones[n]);const q0=SP.map(b=>b.quaternion.clone());const LG=[bones.LeftUpLeg,bones.RightUpLeg];const qh0=bones.Hips.quaternion.clone(),ql0=LG.map(b=>b.quaternion.clone());const hp=wp(bones.Hips);const dh=V(tg.x-hp.x,0,tg.z-hp.z);if(dh.lengthSq()<1e-4)dh.copy(fwd(root.rotation.y));dh.normalize();/* bending forward from the hips lowers the shoulders; a side bend hardly does (and lifts the other shoulder) */{const pf=pelvisFwdGeo();const B=FIT.bed;if(B&&pf.z<0)pf.negate();/* seated the root's yaw is not where he faces */dh.multiplyScalar(.9).add(pf).normalize();}
  const ax=V(0,1,0).cross(dh).normalize();let need=0;for(let i=0;i<8;i++){root.updateMatrixWorld(true);const ex=wp(sh).distanceTo(tg)-reach;if(ex<=.005||need>=1.8)break;const a=Math.min(1.8-need,ex*2.5+.03);need+=a;leanB(ax,a);}
  SP.forEach((b,j)=>b.quaternion.copy(q0[j]));bones.Hips.quaternion.copy(qh0);LG.forEach((b,j)=>b.quaternion.copy(ql0[j]));root.updateMatrixWorld(true);const st=dt||1/60;const want=need*w;BRC.a=want>BRC.a?Math.min(want,BRC.a+3*st):Math.max(want,BRC.a-2*st);
  if(BRC.a>.002)leanB(ax,BRC.a);root.updateMatrixWorld(true);romArmIK(side,tg,sidePole(side),w,null);R.last={tg:tg.clone(),ax:ax.clone(),side};}
 // lean (eased) and arm IK so the wrist reaches tg; returns the lean axis
 function bendReach(side,tg,w,dt,cap,fitG){cap=cap||1.8;const sh=bones[side+'Arm'];const reach=armLen*(cap>2?.99:.97);const SP=['Spine','Spine1','Spine2'].map(n=>bones[n]);const q0=SP.map(b=>b.quaternion.clone());const LG=[bones.LeftUpLeg,bones.RightUpLeg];const qh0=bones.Hips.quaternion.clone(),ql0=LG.map(b=>b.quaternion.clone());
  root.updateMatrixWorld(true);const hp=wp(bones.Hips);const dh=V(tg.x-hp.x,0,tg.z-hp.z);if(dh.lengthSq()<1e-4)dh.set(0,0,1);dh.normalize();{const pf=pelvisFwdGeo();if(FIT.bed&&pf.z<0)pf.negate();dh.multiplyScalar(.9).add(pf).normalize();}
  const ax=V(0,1,0).cross(dh).normalize();let need=0;for(let i=0;i<16;i++){root.updateMatrixWorld(true);const ex=wp(sh).distanceTo(tg)-reach;if(ex<=.005||need>=cap)break;const a=Math.min(cap-need,ex*2.5+.03);need+=a;leanB(ax,a);}
  SP.forEach((b,j)=>b.quaternion.copy(q0[j]));bones.Hips.quaternion.copy(qh0);LG.forEach((b,j)=>b.quaternion.copy(ql0[j]));root.updateMatrixWorld(true);const st=dt||1/60;const want=need*w;BRC.a=want>BRC.a?Math.min(want,BRC.a+3*st):Math.max(want,BRC.a-2*st);
  if(BRC.a>.002)leanB(ax,BRC.a);if(fitG){/* the lean as the pose guard will let it stand: the arm is solved on that back (solved on the deeper bend, the guard took it back after and the hand flew up 30-60 cm) */const PG=window.__poseGuard;if(PG&&PG.fit&&!window.__noFit)for(const n of ['Spine','Spine1','Spine2',side+'Shoulder'])if(bones[n])PG.fit(bones[n]);root.updateMatrixWorld(true);guardSpine();}
  root.updateMatrixWorld(true);if(w>.001)romArmIK(side,tg,sidePole(side),w,null);return ax;}
 // MORNING, boots on: the same bend in reverse - the hand goes down onto the boot standing on the floor, closes on its top and brings it up
 function bootPickReach(dt,R){const sd=R.sd,Bs=BT.side[sd];const pm=Bs&&Bs.prop;if(!pm){BRC.a=Math.max(0,BRC.a-(dt||1/60)*2);return;}const t=R.t||0;const held=pm.parent&&/Hand$/.test(pm.parent.name);if(held&&!R.picked){R.picked=true;R.pt=t;}
  if(!held&&!R.picked){const w=smooth(R.at-1.0,R.at-.4,t);if(w<.001){BRC.a=Math.max(0,BRC.a-(dt||1/60)*2);return;}root.updateMatrixWorld(true);_hb.setFromObject(pm);const top=_hb.getCenter(V());top.y=_hb.max.y;{/* the near rim of the collar, the side facing him: that is where fingers hook it */const hq=wp(bones.Hips);const d=V(hq.x-top.x,0,hq.z-top.z);const L=d.length();if(L>1e-3)top.add(d.multiplyScalar(Math.min(.045,L)/L));}
   // the wrist a palm's length over the top of the shaft, so the palm closes on it
   const Hn=bones[sd+'Hand'];const G=window.__grab;const palm=G&&G.gripPoint?G.gripPoint(sd):wp(Hn);const off=wp(Hn).sub(palm);const tg=top.clone().add(V(0,.05,0)).add(off);/* palm just over the rim: the curled fingers hook the collar */R.last={tg:tg.clone(),side:sd};bendReach(sd,tg,w,dt,2.2,true);/* on a guard-legal back (else the guard took the lean back and the palm stayed 20-28 cm over the boot) */if(w>.9&&t>R.at-.45&&!R.pickNow){root.updateMatrixWorld(true);const pq=G&&G.gripPoint?G.gripPoint(sd):wp(Hn);if(pq.distanceTo(top)<.075)R.pickNow=true;}return;}
  // held: up with it, back to the clip over ~0.6 s
  const L=R.last;if(!L){BRC.a=Math.max(0,BRC.a-(dt||1/60)*2);return;}const t0=R.pt!=null?R.pt:R.at;const w2=1-smooth(t0,t0+.6,t);BRC.a=Math.max(0,BRC.a-(dt||1/60)*1.4);if(w2>.001)bendReach(sd,L.tg.clone().add(V(0,.12*(1-w2),0)),w2,dt,2.2,true);}
 // a boot just pulled off and carried down to the floor stays out of the legs: the arm carries it around the shins, not through them
 const _hb=new THREE.Box3(),HBC={Left:V(),Right:V()};function heldBootClear(dt){const st=dt||1/60;for(const sd of ['Left','Right']){const B=BT.side[sd];const pm=B&&B.prop;if(!pm||!pm.visible||!pm.parent||!/Hand$/.test(pm.parent.name))continue;
   const side=/Left/.test(pm.parent.name)?'Left':'Right';root.updateMatrixWorld(true);_hb.setFromObject(pm);const c=_hb.getCenter(V());const q=c.clone();bootClearShins(q,.27);const dl=q.sub(c);dl.y=0;const E=HBC[/Left/.test(pm.parent.name)?'Left':'Right'];/* eased, so the pop filter does not hold it back (and slower: when the nearest shin changes the push turns round, 11 cm/frame) */E.lerp(dl,Math.min(1,st*6));if(E.lengthSq()<2.5e-5)continue;dl.copy(E);
   const A=bones[side+'Arm'],Fa=bones[side+'ForeArm'],Hd=bones[side+'Hand'];const el=wp(Fa),mid=wp(A).add(wp(Hd)).multiplyScalar(.5);ik2(A,Fa,Hd,wp(Hd).add(dl),el.sub(mid).normalize(),1,true);}}
 // the folded vest in his hand stays out of his thighs and hips (in his lap it sat 3.5 cm into them, gate): the hand is eased off them
 const VHC=V();function vestHeldClear(dt){const pm=BT.vestProp;const st=dt||1/60;if(!pm||!pm.visible||!pm.parent||!/Hand$/.test(pm.parent.name)||VD.on||VR.on){VHC.multiplyScalar(Math.max(0,1-st*6));return;}
  const side=/Left/.test(pm.parent.name)?'Left':'Right';root.updateMatrixWorld(true);_hb.setFromObject(pm);const R=.11;const push=V();let worst=0;
  for(const kn of ['LeftLeg','RightLeg']){const a=wp(bones.Hips),b=wp(bones[kn]);for(let k=0;k<=6;k++){const q=a.clone().lerp(b,k/6);const cp=_hb.clampPoint(q,V());const d=cp.distanceTo(q);if(d<R&&R-d>worst){worst=R-d;push.copy(d>1e-4?cp.sub(q).normalize():V(0,1,0)).multiplyScalar(R-d);}}}
    if(push.y<0)push.y=0;VHC.lerp(push,Math.min(1,st*6));if(VHC.lengthSq()<2.5e-5)return;
  const A=bones[side+'Arm'],Fa=bones[side+'ForeArm'],Hd=bones[side+'Hand'];const el=wp(Fa),mid=wp(A).add(wp(Hd)).multiplyScalar(.5);ik2(A,Fa,Hd,wp(Hd).add(VHC),el.sub(mid).normalize(),1,true);H.noPop={side,until:performance.now()+150};}
 function bootDown(sd){const B=BT.side[sd];if(!B)return;const R=BSEQ.r;if(R&&R.down&&R.plan&&R.sd===sd){/* the hand brings it as low as a seated arm goes, then lets it drop the last few cm onto the floor (real gravity, a thud); the gate's no-touch check skips a prop while userData.freeFall is set */
   const pm=B.prop;root.updateMatrixWorld(true);scene.attach(pm);_hb.setFromObject(pm);const fl=R.plan.p.y;const yaw=new THREE.Quaternion().setFromAxisAngle(V(0,1,0),R.plan.yaw);
   const q0=pm.quaternion.clone(),h0=_hb.min.y-fl;pm.quaternion.copy(yaw);pm.updateMatrixWorld(true);_hb.setFromObject(pm);const lift=pm.position.y-_hb.min.y;pm.quaternion.copy(q0);pm.updateMatrixWorld(true);/* standing upright on the floor: its origin this high over the sole */
   B.spot={p:V(pm.position.x,fl,pm.position.z),yaw:R.plan.yaw};BFALL.push({pm,v:0,lift,fl,q0,q1:yaw,h0});pm.userData.freeFall=true;return;}
  const s=bootSpot(sd);{const hp=wp(bones[sd+'Hand']);const dx=hp.x-s.p.x,dz=hp.z-s.p.z,dd=Math.hypot(dx,dz);const k=dd>.45?.45/dd:1;/* set down right under the hand (the gate saw the boot glide 17 cm from the palm) */s.p.x+=dx*k;s.p.z+=dz*k;if(FIT.bed)s.p.z=Math.max(s.p.z,FIT.bed.z1+.18);/* out from under the edge: his legs swing in over it when he lies down */bootClearShins(s.p);{const o=BT.side[sd==='Left'?'Right':'Left'];if(o&&o.spot){/* the pair stands side by side, never one boot inside the other: the nearest free place to the hand */const op=o.spot.p;let dx=s.p.x-op.x,dz=s.p.z-op.z,d=Math.hypot(dx,dz);if(d<.17){if(d<1e-3){dx=hp.x-op.x;dz=hp.z-op.z;d=Math.hypot(dx,dz)||1;}s.p.x=op.x+dx/d*.17;s.p.z=op.z+dz/d*.17;}}}B.spot=s;}bootTween(B.prop,s.p,new THREE.Quaternion().setFromAxisAngle(V(0,1,0),s.yaw),.14);AU('thud',s.p);}
 // morning: the boot comes up from the floor into the hand, then onto the foot (the prop eases onto the skinned boot's place, then swaps)
 function bootPick(sd,hand){const B=BT.side[sd];if(!B)return;const pm=B.prop;pm.visible=true;const h=bones[hand+'Hand'];const hp=h.getWorldPosition(V());
  bootTween(pm,hp.clone().add(V(0,-.06,0)),pm.quaternion.clone(),.12,()=>{h.attach(pm);});}
 function bootOn(sd){const B=BT.side[sd];if(!B)return;B.spot=null;const pm=B.prop;bootWorld(B,_bbm);const P_=V(),Q_=new THREE.Quaternion(),S_=V();_bbm.decompose(P_,Q_,S_);bootTween(pm,P_,Q_,.25,()=>{pm.visible=false;bootShow(sd,true);});}
 // the vest: off seated and laid folded at the foot end of the mattress; on again standing
 function hasVest(){bootInit();return !!(VEST||BT.dv);}
 function vestProp(){if(BT.vestProp||!hasVest())return BT.vestProp;if(!VEST){const D=BT.dv;const P=D.geo.attributes.position;const pos=P.array;const c=D.bb.getCenter(V());
   for(let i=0;i<P.count;i++){const x=pos[i*3]-c.x,y=pos[i*3+1]-c.y,z=pos[i*3+2]-c.z;pos[i*3]=x*.55;pos[i*3+1]=z*.35+.025;pos[i*3+2]=-y*.45;}D.geo.computeVertexNormals();
   const pm=new THREE.Mesh(D.geo,D.mat);pm.castShadow=true;pm.visible=false;pm.name='vestFolded';scene.add(pm);return BT.vestProp=pm;}
  const g=VEST.geometry;const m=(Array.isArray(VEST.material)?VEST.material[0]:VEST.material).clone();
  const P=g.attributes.position;const pos=new Float32Array(P.count*3);const bb=new THREE.Box3();for(let i=0;i<P.count;i++){const q=V(P.getX(i),P.getY(i),P.getZ(i)).applyMatrix4(VEST.bindMatrix);pos.set([q.x,q.y,q.z],i*3);bb.expandByPoint(q);}
  const c=bb.getCenter(V());// folded: flattened to a low pile, laid on its back on the quilt
  for(let i=0;i<P.count;i++){const x=pos[i*3]-c.x,y=pos[i*3+1]-c.y,z=pos[i*3+2]-c.z;pos[i*3]=x*.55;pos[i*3+1]=z*.35+.025;pos[i*3+2]=-y*.45;}
  const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(pos,3));if(g.attributes.uv)sg.setAttribute('uv',g.attributes.uv);sg.setIndex(g.index);sg.computeVertexNormals();/* [HERO LOOK] the folded vest keeps the worn vest's leather (heroclothes.js attributes, same material) */if(g.attributes.kp){for(const a of ['kp','kn','kx'])sg.setAttribute(a,g.attributes[a]);}
  const pm=new THREE.Mesh(sg,g.attributes.kp?VEST.material:m);pm.castShadow=true;pm.visible=false;pm.name='vestFolded';scene.add(pm);return BT.vestProp=pm;}
 function vestPark(on){const pm=vestProp();if(!pm)return;if(on){const sp=vestSpot();pm.position.copy(sp.p);pm.rotation.set(0,sp.yaw,0);pm.scale.setScalar(BT.sc||1);}pm.visible=on;}
 // the folded vest lies on the floor in front of the bed edge, between his boots and a little further out: he sets it down there by
 // hand sitting (the upper bunk and the ladder were out of a seated arm's reach) and picks it up from there in the morning
 function vestSpot(){{const P=PP();const st=P&&P.objects&&P.objects.bedstool;if(st&&P.surfaces&&P.surfaces.bedStool){/* on the bedside stool: in a seated arm's reach (the floor is not: the pose guard will not fold his back that far) */return {p:V(st.position.x,P.surfaces.bedStool+.002,st.position.z-.05),yaw:.5};}}const B=FIT.bed;const hd=B.headDir||1;const ed=N.bededge;const fl=(ed&&ed.floor)??floorTop(BD);const x=ed?ed.p.x:(B.x0+B.x1)/2;return {p:V(x-.14*hd,fl+.012,B.z1+.36),yaw:-.3};}/* in front of his RIGHT foot (his right is the foot end, -headDir): at +x it was across his body, the lean became a side bend the guard took back and the hand flew up 60 cm */
 /* v6: 'undershirt' (pipeline/hero2/undervest.mjs) is an inner sweater shell that closes the cracks of the vest-shaped body; drawn only while the vest is off */
 const USH=root.getObjectByName('undershirt');if(USH)USH.traverse(o=>{if(o.isMesh){o.visible=false;o.castShadow=false;}});
 function vestShow(on){BT.vestOn=on;if(VEST)VEST.visible=on;else if(BT.vestU)BT.vestU.value=on?0:1;if(USH)USH.traverse(o=>{if(o.isMesh)o.visible=!on;});if(window.__clothes&&window.__clothes.vestOn)window.__clothes.vestOn(on&&!!VEST);}
 // instant state (spawned in bed, reset): no clips
 function undress(off,quiet){bootInit();for(const sd of ['Left','Right']){const B=BT.side[sd];if(!B)continue;for(let i=BTW.length-1;i>=0;i--)if(BTW[i].pm===B.prop)BTW.splice(i,1);if(off){bootShow(sd,false);bootPark(sd);}else{B.prop.visible=false;scene.attach(B.prop);bootShow(sd,true);}}
  if(hasVest()){vestShow(!off);vestPark(off);}if(!quiet)AU(off?'unzip':'zip',root.position);}
 // a seated clip with beats at clip seconds; the lifted foot may leave the floor (H.fit.liftOK), the planted one stays put
 const BSEQ={a:null,b:[],then:null,r:null};
 function seatedClip(name,beats,then,reach){const a=actions[name];if(!a){then&&then();return;}H.fit&&(H.fit.liftOK=true);BSEQ.a=a;BSEQ.r=reach||null;BSEQ.b=beats.slice().sort((x,y)=>x[0]-y[0]);BSEQ.then=then;
  once(name,{fade:.45,speed:1.3,then:()=>{for(const [,f] of BSEQ.b)f();if(BSEQ.r&&BSEQ.r.dropNow){BSEQ.r.dropNow=false;bootDown(BSEQ.r.sd);}if(BSEQ.r&&BSEQ.r.pickNow){BSEQ.r.pickNow=false;const pb=BT.side[BSEQ.r.sd];if(pb&&pb.prop&&!(pb.prop.parent&&/Hand$/.test(pb.prop.parent.name)))bootPick(BSEQ.r.sd,BSEQ.r.sd);}if(BSEQ.r&&BSEQ.r.onNow){BSEQ.r.onNow=false;bootOnStart(BSEQ.r.sd);}BSEQ.a=null;BSEQ.r=null;BSEQ.b=[];if(H.fit)H.fit.liftOK=false;then&&then();}});}
 // seated on the bunk edge the upper body may lean forward, never far back: the clip's backward recline (lifting a foot onto
 // the knee) laid him down across the mattress with an arm out; the spine is turned so the chest stays at most ~8 degrees behind
 // the pelvis, spread over the three spine bones
 function seatLeanLimit(){if(!bones.Neck||!bones.Spine)return;root.updateMatrixWorld(true);const hp=bones.Hips.getWorldPosition(V()),nk=bones.Neck.getWorldPosition(V());const up=nk.sub(hp).normalize();const f=fwd(root.rotation.y);
  const back=Math.atan2(-up.dot(f),up.y);const MAX=.14;if(back<=MAX)return;const lat=V().crossVectors(V(0,1,0),f).normalize();// rotating about lat by +a tips the top toward f
  const d=back-MAX;for(const n of ['Spine','Spine1','Spine2'])rotW(bones[n],lat,d/3);}
 // and sideways: the boots-off mocap also sagged onto one elbow toward the pillow (head ~35 cm over the quilt, legs up); the chest
 // stays within ~14 degrees of upright to either side, so he works on the boot sitting up
 function seatSideLimit(){if(!bones.Neck||!bones.Spine)return;root.updateMatrixWorld(true);const hp=bones.Hips.getWorldPosition(V()),nk=bones.Neck.getWorldPosition(V());const up=nk.sub(hp).normalize();const f=fwd(root.rotation.y);
  const lat=V().crossVectors(V(0,1,0),f).normalize();const side=Math.atan2(up.dot(lat),up.y);const MAX=.17;/* the head followed a side lean onto the shoulder (watcher, detail f600) */if(Math.abs(side)<=MAX)return;
  const d=Math.abs(side)-MAX;// turning up about (up x Y) brings it toward vertical
  const t=V().crossVectors(up,V(0,1,0));if(t.lengthSq()<1e-8)return;const ax=f.clone().multiplyScalar(Math.sign(t.dot(f))||1);for(const n of ["Spine","Spine1","Spine2"])rotW(bones[n],ax,d/3);}
 // pulling a boot off he brings the foot up, not his face down to it (gate HARD: foot next to the head, 55 cm): the chest straightens
 // until the head is ~60 cm from either foot
 const SFG={v:0};function seatFootGap(dt){if(!bones.Head||!bones.Spine)return;const SP=['Spine','Spine1','Spine2'].map(n=>bones[n]);
  const gap=()=>{root.updateMatrixWorld(true);let hd;if(bones.HeadTop_End)hd=wp(bones.HeadTop_End);else{/* the old rig has no end bone: the head top 18 cm on from the neck through the head (as the gate puts it) */const h=wp(bones.Head),nk=bones.Neck?wp(bones.Neck):h.clone().add(V(0,-.1,0));hd=h.clone().add(h.clone().sub(nk).setLength(.18));}let d=9;for(const sd of ['Left','Right'])for(const n of [sd+'Foot',sd+'ToeBase']){const f=bones[n]||(SFG[n]===undefined?(SFG[n]=root.getObjectByName('mixamorig'+n)||null):SFG[n]);/* the toes are not in bones{} */if(f)d=Math.min(d,f.getWorldPosition(V()).distanceTo(hd));}return d;};
  // bending over a boot the head may come close to the knee, never down to the foot (gate: a foot within 55 cm of the head top): sit up a little.
  // The needed amount is found by trial, then eased in and out (a sudden spine turn is held back by the pop filter and lands a frame late)
  const f=fwd(root.rotation.y);const lat=V().crossVectors(V(0,1,0),f).normalize();const q0=SP.map(b=>b.quaternion.clone());let tot=0;
  for(let k=0;k<5;k++){const d=gap();if(d>=.575||tot>=1.05)break;const a=Math.min(1.05-tot,(.6-d)*3.2+.02);tot+=a;for(const b of SP)rotW(b,lat,-a/3);}
  SP.forEach((b,i)=>b.quaternion.copy(q0[i]));const st=(dt||1/60);SFG.v=tot>SFG.v?Math.min(tot,SFG.v+5*st):Math.max(tot,SFG.v-2.5*st);
  if(SFG.v>.002){for(const b of SP)rotW(b,lat,-SFG.v/3);root.updateMatrixWorld(true);}}
 function bseqTick(dt){bootTweenTick(dt);if(!BSEQ.a)return;seatLeanLimit();seatSideLimit();const t=BSEQ.a.time;
  // the hand really goes down to the boot's spot by the bed: it sets the boot down there / picks it up from there (no boot flying to the floor)
  const R=BSEQ.r;if(R&&R.down){if(!R.plan&&t>R.at-.9)R.plan=bootPlan(R.sd);R.t=t;}else if(R&&R.pick){R.t=t;}else if(R){const w=smooth(R.at-.55,R.at-.04,t)*(1-smooth(R.at+.12,R.at+.55,t));if(w>.001){const sp=bootSpot(R.sd).p.clone();sp.y+=.2;/* the palm on the shaft top, not on the sole */reachTo(R.sd,sp,w);}}
  while(BSEQ.b.length&&t>=BSEQ.b[0][0]){const [,f]=BSEQ.b.shift();f();}}
 // clip times (s, after trimming) of the hand events, measured from the mocap keypoints
 const BOOT_OFF={grab:2.05/1.25,down:4.1/1.25},BOOT_ON=BOOTREV.R?{pick:BOOTREV.R-4.1/1.25+.05,on:BOOTREV.R-2.05/1.25}:{pick:.55/1.25,on:2.1/1.25},VEST_OFF={off:2.0};
 function undressSeq(done){bootInit();const steps=[];
  for(const sd of ['Right','Left']){const B=BT.side[sd];if(!B||!B.on||!has('hy_bootsoff'+sd[0]))continue;
   steps.push(n=>seatedClip('hy_bootsoff'+sd[0],[[BOOT_OFF.grab,()=>{if(B.on)bootPullStart(sd);}],[BOOT_OFF.down,()=>{if(B.prop.parent!==scene&&!B.on){const R=BSEQ.r;if(R&&R.down&&R.plan&&R.sd===sd)R.dropNow=true;/* let go in the grab slot, after the hand is down */else bootDown(sd);}}]],n,{sd,at:BOOT_OFF.down,down:1}));}
  if(hasVest()&&BT.vestOn&&has('hy_vestoff')){steps.push(n=>seatedClip('hy_vestoff',[[VEST_OFF.off,()=>{vestShow(false);vestToHand();AU('unzip',root.position);}],[VEST_OFF.off+.35,()=>vestPutAway(null)]],n));steps.push(n=>{/* laid on the stool while the clip still plays out (held on its last frame for the whole reach, the gate saw the clip slowed to half speed) */const w=()=>{if(VD.on)setTimeoutGame(.05,w);else n();};w();});}
  else if(hasVest()&&BT.vestOn){vestShow(false);vestPark(true);}
  let i=0;const next=()=>{if(i<steps.length)steps[i++](next);else done&&done();};next();}
 function dressSeq(done){bootInit();const steps=[];
  for(const sd of ['Right','Left']){const B=BT.side[sd];if(!B||B.on)continue;if(!has('hy_bootson'+sd[0])){bootShow(sd,true);B.prop.visible=false;continue;}
   steps.push(n=>seatedClip('hy_bootson'+sd[0],[[BOOT_ON.pick,()=>{const R=BSEQ.r;if(R&&R.pick&&R.sd===sd){if(!R.picked)R.pickNow=true;}/* taken into the hand at the start of the next frame, from the pose shown */else bootPick(sd,sd);}],[BOOT_ON.on,()=>{const R=BSEQ.r;if(R&&R.pick&&R.sd===sd)R.onNow=true;/* from the pose shown, not the raw clip hand */else bootOn(sd);}]],n,{sd,at:BOOT_ON.pick,pick:1}));}
  if(hasVest()&&!BT.vestOn&&BT.vestProp&&BT.vestProp.visible&&has('hy_jacketon'))steps.push(n=>vestPickSeated(n));
  let i=0;const next=()=>{if(i<steps.length)steps[i++](next);else done&&done();};next();}
 // EVENING, the vest: as it comes off it is in his right hand (folded), and he lays it on the upper bunk by hand (it used to vanish
// from him and appear up there 0.6 s later)
function vestToHand(){const pm=vestProp();if(!pm)return;vestPark(true);pm.visible=true;pm.updateMatrixWorld(true);VD.home={p:pm.position.clone(),q:pm.quaternion.clone()};/* where it will lie */
 root.updateMatrixWorld(true);vestHeldPlace(pm,VSD);bones[VSD+'Hand'].attach(pm);}
// the folded vest as a hand holds it: out from the lap on the palm's outer side, up on its edge, hanging from the fist like a folded garment
// (in the lap it sat 4-5 cm into his thighs and belly; 6 cm out still touched one hero's belly while he turned to the stool: gate prop-through-body)
function vestHeldPlace(pm,sd){root.updateMatrixWorld(true);const Hn=bones[sd+'Hand'];const G=window.__grab;const palm=G&&G.gripPoint?G.gripPoint(sd):wp(Hn);const hp=wp(bones.Hips);const o=palm.clone().sub(hp);o.y=0;if(o.lengthSq()>1e-6)o.normalize();
 pm.position.copy(palm).addScaledVector(o,.10).add(V(0,.03,0));const ax=V(0,1,0).cross(o);if(ax.lengthSq()>1e-6){pm.updateMatrixWorld(true);pm.rotateOnWorldAxis(ax.normalize(),1.15);}pm.updateMatrixWorld(true);}
// picked up flat from the stool in the morning: the fingers shift it into that same hanging grip over a moment before he stands up with it
// (held flat it swung through his knees and thighs as he stood: gate prop-through-body shins 4.9, hips 4.3 in hy_standup)
const VRG={pm:null};function vestRegrip(pm,sd){const Hn=bones[sd+'Hand'];scene.attach(pm);const wp0=pm.position.clone(),wq0=pm.quaternion.clone();
 vestHeldPlace(pm,sd);Hn.attach(pm);const p1=pm.position.clone(),q1=pm.quaternion.clone();scene.attach(pm);pm.position.copy(wp0);pm.quaternion.copy(wq0);pm.updateMatrixWorld(true);Hn.attach(pm);Object.assign(VRG,{pm,t:0,p0:pm.position.clone(),q0:pm.quaternion.clone(),p1,q1});}
function vestRegripTick(dt){const R=VRG;if(!R.pm)return;if(!R.pm.parent||!/Hand$/.test(R.pm.parent.name)){R.pm=null;return;}R.t+=dt||1/60;const k=smooth(0,.4,R.t);R.pm.position.lerpVectors(R.p0,R.p1,k);R.pm.quaternion.slerpQuaternions(R.q0,R.q1,k);R.pm.updateMatrixWorld(true);if(R.t>=.4)R.pm=null;}
const VSD='Left';/* the vest is folded in the left hand: the bedside stool is to his left (the right side is the boots' and the walk's) */
const VD={on:false};
function vestPutAway(next){const pm=BT.vestProp;if(!pm||!VD.home||!(pm.parent&&/Hand$/.test(pm.parent.name))){vestPark(true);next&&next();return;}Object.assign(VD,{on:true,t:0,pm,next,let:false,q0:null,drop:!(PP()&&PP().objects&&PP().objects.bedstool)});}
function vestPutTick(dt){if(!VD.on)return;const st=dt||1/60;VD.t+=st;const t=VD.t,pm=VD.pm,sd=VSD;const w=t<.9?smooth(0,.85,t):1-smooth(1.0,1.5,t);
 if(!VD.let){root.updateMatrixWorld(true);const Hn=bones[sd+'Hand'];const off=wp(Hn).sub(pm.getWorldPosition(V()));VD.tg=VD.home.p.clone().add(V(0,VD.drop?.2:.03,0)).add(off);}
 if(VD.tg){/* over his knee, not through it: the hand goes out high and comes down onto the stool; and back up again after letting go */VD.arc=.14*(1-smooth(.35,.8,t))+.14*smooth(.95,1.3,t);}/* as low as a seated arm goes without folding the back past what the guard allows (it took a deeper bend back and the hand flew up 60 cm), then it drops the last 20 cm */
 if(!VD.let&&pm.parent){/* turned flat on the way down: it lands as it will lie */if(!VD.q0)VD.q0=pm.quaternion.clone();pm.parent.updateMatrixWorld(true);const pq=pm.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(VD.home.q);pm.quaternion.slerpQuaternions(VD.q0,pq,smooth(.15,.8,t));}
 if(VD.tg&&w>.001){bendReach(sd,VD.tg.clone().add(V(0,VD.arc||0,0)),w,st,1.2,true);H.noPop={side:sd,until:performance.now()+150};}
 if(!VD.let&&t>=.9){VD.let=true;root.updateMatrixWorld(true);scene.attach(pm);/* let go: it falls flat onto the floor right under the hand (real gravity, a soft thud), no glide to a spot */
  const fl=VD.home.p.y;_hb.setFromObject(pm);const q0=pm.quaternion.clone(),h0=_hb.min.y-fl;pm.quaternion.copy(VD.home.q);pm.updateMatrixWorld(true);_hb.setFromObject(pm);const lift=pm.position.y-_hb.min.y;pm.quaternion.copy(q0);pm.updateMatrixWorld(true);
  BFALL.push({pm,v:0,lift,fl,q0,q1:VD.home.q.clone(),h0});pm.userData.freeFall=true;}
 if(t>=1.5){VD.on=false;const f=VD.next;VD.next=null;f&&f();}}
// MORNING, the vest (Pavel: nothing moved by magic): standing up he reaches to the upper bunk, takes the folded vest in his right hand,
// and only then puts it on (hy_jacketon); the worn vest appears as the clip pulls it over his shoulders
const VR={on:false};
function vestPickSeated(next){const pm=BT.vestProp;if(!pm||!pm.visible){next&&next();return;}Object.assign(VR,{on:true,t:0,pm,took:false,pick:true,then:next});}
function vestOnStanding(then){const done=()=>{then&&then();};if(!hasVest()||BT.vestOn){done();return;}const pm=BT.vestProp;
 if(pm&&pm.visible&&pm.parent&&/Hand$/.test(pm.parent.name)){/* picked up sitting: on with it now */overlay('hy_jacketon',{fade:.4,speed:1.2});setTimeoutGame(.9,()=>{scene.attach(pm);pm.visible=false;vestShow(true);AU('zip',root.position);});done();return;}
 if(!has('hy_jacketon')||!pm||!pm.visible){if(has('hy_jacketon')){overlay('hy_jacketon',{fade:.4,speed:1.2});setTimeoutGame(.9,()=>{vestPark(false);vestShow(true);AU('zip',root.position);});}else{vestPark(false);vestShow(true);}done();return;}
 Object.assign(VR,{on:true,t:0,pm,took:false,pick:false,then:done});}
function vestReachTick(dt){if(!VR.on)return;const st=dt||1/60;VR.t+=st;const t=VR.t,pm=VR.pm;const sd=VR.pick?VSD:'Right';
 const T1=VR.pick?.9:.55,T2=VR.pick?1.5:1.0;const w=t<T1?smooth(0,T1-.05,t):1-smooth(T1+.05,T2,t);
 if(!VR.took&&w>.001){root.updateMatrixWorld(true);_hb.setFromObject(pm);const c=_hb.getCenter(V());c.y=_hb.max.y;const Hn=bones[sd+'Hand'];const G=window.__grab;const palm=G&&G.gripPoint?G.gripPoint(sd):wp(Hn);
  VR.tg=c.add(wp(Hn).sub(palm)).add(V(0,.02,0));}
 if(VR.tg&&w>.001){if(VR.pick)bendReach(sd,VR.tg,w,st,1.2,true);else romArmIK(sd,VR.tg,sidePole(sd),w,null);H.noPop={side:sd,until:performance.now()+150};}
 if(!VR.took&&t>=T1){VR.took=true;root.updateMatrixWorld(true);bones[sd+'Hand'].attach(pm);if(VR.pick)vestRegrip(pm,sd);AU('cloth',root.position);if(!VR.pick)overlay('hy_jacketon',{fade:.4,speed:1.2});
  if(!VR.pick)setTimeoutGame(.9,()=>{scene.attach(pm);pm.visible=false;vestShow(true);AU('zip',root.position);});}
 if(t>=T2){VR.on=false;VR.pick=false;const f=VR.then;VR.then=null;f&&f();}}
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
 // sitting on the bed edge the knees stay about hip width apart (the get-up and boot clips spread them wide: 'a wide squat', watcher f1320-1800).
 // The thigh turns in at the hip; the foot comes with it and legPlant sets it down there.
 const KN={w:0};function kneeNarrow(dt){const B=FIT.bed;const on=!!(B&&H.fit&&H.fit.mode==='hold'&&!H.inBed&&(BSEQ.a||!H.bedC||(H.bedC.dir<0&&H.bedC.u>.55)||(H.bedC.dir>0&&H.bedC.u<.3))&&N.bededge&&root.position.distanceTo(N.bededge.p)<.9);
  KN.w=on?Math.min(1,KN.w+dt*2.5):Math.max(0,KN.w-dt*2.5);if(KN.w<.01)return;root.updateMatrixWorld(true);
  const hp=wp(bones.Hips),f=fwd(root.rotation.y),right=V().crossVectors(V(0,1,0),f).normalize();
  for(const sd of ['Left','Right']){const U=bones[sd+'UpLeg'],L=bones[sd+'Leg'];if(!U||!L)continue;const k=wp(L);const off=k.clone().sub(hp).dot(right);const lim=.19;if(Math.abs(off)<=lim)continue;
   const k2=k.clone().addScaledVector(right,-(Math.abs(off)-lim)*Math.sign(off));turnBone(U,k,k2,KN.w);}}
 // the guard above lets go over 0.6 s after the clip, under the sleep cross-fade (switched off at once it untilted the pelvis and threw both feet 15 cm up)
 const BHG={dt:1/60,Left:{w:0,wl:1,tg:V()},Right:{w:0,wl:1,tg:V()}};/* the in-bed hand guard eases on and off (it switched in one frame: getup hand 6-10 cm/frame, gate) */
 const BCF={t:1};function bedClipTick(dt){const c=H.bedC;if(!c){BHG.Left.w=BHG.Right.w=0;if(BCF.t<.6&&H.inBed){BCF.t+=dt;bedClipGuard(1-smooth(0,.6,BCF.t));}else BCF.t=1;return;}if(c.dir>0)BCF.t=0;BHG.dt=dt;BHG.f=(BHG.f||0)+1;c.t=Math.min(c.dur,c.t+dt);const u=c.u=c.t/c.dur;
  // across the bed: first along the edge toward the pillow, then in under the upper bunk (getting up: out first)
  if(c.hx0!=null){bones.Hips.position.x=c.hx0;bones.Hips.position.z=c.hz0;}
  const kx=c.dir>0?smooth(.05,.6,u):smooth(.1,.6,u),kz=c.dir>0?smooth(.22,.74,u):smooth(0,.42,u);/* lying down: in from the edge as soon as his chest is down, so the hips are on the mattress when the back lands (R23-2: they stayed 14 cm past the edge, the body hovered) */
  root.position.x=lerp(c.from.x,c.to.x,kx);root.position.z=lerp(c.from.z,c.to.z,kz);H.fit.y=lerp(c.y0,c.y1,c.dir>0?smooth(.1,.7,u):smooth(.3,.9,u));
  c.plant=c.dir>0?1-smooth(.12,.38,u):smooth(.62,.9,u);
  // getting up he pushes the quilt off as he rises: it follows his body for the first moments, then settles flat
  /* BED: lying down the cover starts as his legs come over the mattress, so they slide in UNDER the quilt (it rose over him only after he lay down, he sank into it) */if(c.dir>0&&!c.qon&&u>.3&&(u>.75||!FIT.bed||['Left','Right'].every(sd=>!bones[sd+'Leg']||wp(bones[sd+'Leg']).z<FIT.bed.z1-.02))){c.qon=true;bedPress(true);}/* R56-1: only once both knees are over the mattress: the quilt can't reach past its hem, so a knee still out over the edge stood up through its top as it rose */
  {const P=window.__props||P3;if(P&&P.quiltLive)P.quiltLive(.1);}
  if(c.dir<0&&!c.qoff&&u>.5){c.qoff=true;bedPress(false);}/* the legs are out from under it first */
  bedClipGuard();
  if(c.t>=c.dur){H.bedC=null;c.then&&c.then();}}
 // the Fal bed clips were made on a low bed: played on the bunk they kicked both legs up toward the upper bunk and, getting up, rolled
 // him backward head-down toward the foot end (phone watch r5). The body stays head-up (neck never below the hips) and the legs
 // stay low: knees at most ~14 cm over the hip joints, so the legs slide and swing, never fly.
 function bedClipGuard(w=1){if(!bones.Neck)return;root.updateMatrixWorld(true);const hp=wp(bones.Hips),nk=wp(bones.Neck);const up=nk.sub(hp).normalize();
  if(up.y<.06){const ax=V().crossVectors(up,V(0,1,0));if(ax.lengthSq()>1e-6)rotW(bones.Hips,ax.normalize(),(Math.asin(.06)-Math.asin(Math.max(-1,up.y)))*w);}
  for(const sd of ['Left','Right']){const U=bones[sd+'UpLeg'],L=bones[sd+'Leg'],F=bones[sd+'Foot'];if(!U||!L||!F)continue;
   dropTo(U,L,wp(U).y+.14,w);}/* the shin is left to the clip and the knee hinge: turning it freely flipped the foot 50 cm in one frame (gate f12659) */
  const c=H.bedC,B=FIT.bed;if(!c||!B)return;
  // getting up the clip turned the pelvis ~50 degrees toward the pillow and swung the left arm over his head (into the upper bunk):
  // the pelvis turns to face the room as he comes up to sit, and a hand above ~35 cm over the mattress goes down beside the hip
  // getting up: once the knee is past the front edge the shin hangs down to the floor (the clip held the legs straight out in the air, watcher f3405 detail)
  if(c.dir<0){const kw=smooth(.45,.7,c.u);const fl=(N.bededge&&N.bededge.floor)??(B.mat-.5);if(kw>0)for(const sd of ['Left','Right']){const L=bones[sd+'Leg'],F=bones[sd+'Foot'];if(!L||!F)continue;const kz=wp(L).z;const ez=smooth(B.z1-.08,B.z1+.06,kz);if(ez>0)dropTo(L,F,fl+.12,kw*ez);}}
  if(c.dir<0){const k=smooth(.5,.95,c.u);if(k>0){const f=V(0,0,1).applyQuaternion(bones.Hips.getWorldQuaternion(new THREE.Quaternion()));const yaw=Math.atan2(f.x,f.z)-root.rotation.y;
    if(Math.hypot(f.x,f.z)>.3)rotW(bones.Hips,V(0,1,0),-wrapA(yaw)*k);}}
  root.updateMatrixWorld(true);const hp2=wp(bones.Hips),lr=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).setY(0).normalize();
  // lying is read from the body, not the clip time: once the neck is down near the mattress an arm never hangs over the front edge
  // (watcher r12 f2544: the u>.3 gate let the clip's arm dangle to the floor for ~0.4 s while he was already lying)
  const nkY=wp(bones.Neck).y,lyK=c.dir>0?1-smooth(B.mat+.42,B.mat+.62,nkY):1-smooth(B.mat+.42,B.mat+.62,nkY);
  for(const sd of ['Left','Right']){const Hn=bones[sd+'Hand'];if(!Hn)continue;const hw=wp(Hn);
   // a hand pressing into the mattress (the clip's bed was lower) rests ON it: collide.js used to throw the whole arm ~40 cm up out of it
   const lying=lyK>.05||(c.dir>0&&c.u>.3)||(c.dir<0&&c.u<.35);/* lying, an arm never hangs over the front edge toward the floor (watcher f2115) */const over=hw.x>B.x0-.02&&hw.x<B.x1+.02&&hw.z<B.z1+(lying?.7:.2)&&hw.z>B.z1-.95;const G=BHG[sd],gst=BHG.dt||1/60;if(over&&hw.y<B.mat+.12){const wl=hw.z>B.z1+.2?Math.max(lyK,c.dir>0?smooth(.3,.48,c.u):1-smooth(.2,.35,c.u)):1;let tg=V(hw.x,Math.max(hw.y,B.mat+.1),Math.min(hw.z,B.z1-.1));G.w=c.dir<0?Math.min(1,G.w+gst*10):1;if(lying){/* lying: the hand rests beside the hip, a pose the shoulder can hold (pose.js rom pulled a far reach back into the mattress) */const bh=hp2.clone().addScaledVector(lr,sd==='Left'?.24:-.24);bh.y=B.mat+.1;bh.z=Math.min(bh.z,B.z1-.1);/* eased out as he comes up (a .75 pull that ended in one frame moved the hand 10 cm) */const lw=c.dir>0?1:Math.max(smooth(.05,.3,lyK),1-smooth(.25,.35,c.u));tg.lerp(bh,.75*lw);}/* getting up: one fixed elbow direction (romArmIK's search of three poles picked a different arm each frame here: the hand shook 30 cm/frame, u .26-.47) */   G.tg.copy(tg);G.wl=wl;G.f=BHG.f;if(c.dir<0)armIK(sd,tg,sidePole(sd),wl*G.w);else romArmIK(sd,tg,sidePole(sd),wl*G.w,B.mat+.06);continue;}
   if(c.dir>0)G.w=0;if(G.w>0){G.w=Math.max(0,G.w-gst*6);if(G.w>.001){G.f=BHG.f;if(c.dir<0)armIK(sd,G.tg,sidePole(sd),G.wl*G.w);else romArmIK(sd,G.tg,sidePole(sd),G.wl*G.w,B.mat+.06);continue;}}/* and off the front rail: a forearm across the rail made collide.js flip the whole arm up */
   const ex=hw.y-(B.mat+.35);if(ex<=0)continue;
   const t=hp2.clone().addScaledVector(lr,sd==='Left'?.27:-.27);t.y=B.mat+.04;armIK(sd,t,sidePole(sd),clamp(ex/.15,0,1));}
  // BED (watcher R19-2 f2700): lying down, the clip ended with one hand up in the air over the quilt. Once he is down the arms
  // settle into the same resting places the sleep pose uses (left hand beside the hip, right hand on the stomach), and that weight
  // carries straight into the sleep layer, so nothing pops when the clip hands over
  if(c.dir>0){const aw=lyK*smooth(.3,.7,c.u);SP.aw=Math.max(SP.aw||0,aw);if(SP.aw>.01){const ax=wp(bones.Neck).sub(hp2).setY(0).normalize();const lf=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).normalize();sleepArms(SP.aw,{roll:0},ax,V().crossVectors(lf,ax).normalize(),lf,null);}}}
 // ===== BED (Pavel 2026-11-24: "the quilt just appears on top of him, he never covers himself"): the quilt moves only in his hand =====
 // props.js folds the quilt's head flap over a hinge (quiltFold 0 flat .. 1 turned down) and says where its free edge is (quiltEdge).
 // Evening, sitting on the edge: his left hand (the pillow side) takes the edge and turns the flap down. Lying: his left hand, resting
 // by the hip, takes the turned-down edge there and pulls it up over his chest. Morning: the same hand throws it back down. The palm
 // rides on the edge the whole time (no cloth moving by itself); the quilt over his legs rises over them as they slide in under it.
 // the pose guard's spine chain limit (pose.js chain(): the chest turns <= 35 deg / tips <= 80 deg from the pelvis, soft), applied
 // BEFORE a hand is placed: the guard otherwise straightens the spine after the IK and carries the hand 10-15 cm off what it holds
 const GCq=[new THREE.Quaternion(),new THREE.Quaternion(),new THREE.Quaternion(),new THREE.Quaternion(),new THREE.Quaternion(),new THREE.Quaternion()];
 function guardSpine(){const PG=window.__poseGuard;if(!PG||!PG.rest||window.__poseOff)return;const bs=['Spine','Spine1','Spine2'].map(n=>bones[n]);if(bs.some(b=>!b))return;const rs=bs.map(b=>PG.rest(b));if(rs.some(r=>!r))return;
  const D2R=Math.PI/180,[q1,q2,q3,q4,qs,qt]=GCq;const soft=(v,lo,hi)=>{const m=Math.min(6,(hi-lo)/4);if(v>hi-m)return hi-m+m*Math.tanh((v-hi+m)/m);if(v<lo+m)return lo+m-m*Math.tanh((lo+m-v)/m);return v;};
  q3.set(0,0,0,1);q4.set(0,0,0,1);for(let i=0;i<3;i++){q3.multiply(bs[i].quaternion);q4.multiply(rs[i]);}q1.copy(q4).invert().multiply(q3);
  let {x,y,z,w}=q1;if(w<0){x=-x;y=-y;z=-z;w=-w;}const th=Math.atan2(y,w),c=Math.cos(th),sn=Math.sin(th);const sx=x*c+z*sn,sz=z*c-x*sn,sw=w*c+y*sn;const sl=Math.hypot(sx,sz),a=sl<1e-9?2:2*Math.atan2(sl,sw)/sl;
  const dx=sx*a/D2R,dz=sz*a/D2R,dt=2*th/D2R;const swg=Math.hypot(dx,dz),k=swg>1e-6?soft(swg,-80,80)/swg:1,t=soft(dt,-35,35);if(Math.abs(t-dt)+swg*(1-k)<.05)return;
  const ax=dx*k*D2R,az=dz*k*D2R,ang=Math.hypot(ax,az);if(ang<1e-9)qs.set(0,0,0,1);else{const f=Math.sin(ang/2)/ang;qs.set(ax*f,0,az*f,Math.cos(ang/2));}qt.set(0,Math.sin(t*D2R/2),0,Math.cos(t*D2R/2));q2.multiplyQuaternions(qs,qt);
  const tgt=q4.clone().multiply(q2);const C=new THREE.Quaternion().multiplyQuaternions(tgt,q3.clone().invert());
  for(let i=0;i<3;i++){const b=bs[i],f=1/(3-i);const Ca=new THREE.Quaternion().slerp(C,f);const ql=b.quaternion.clone();b.quaternion.premultiply(Ca);C.premultiply(Ca.invert());C.premultiply(ql.clone().invert()).multiply(ql);}
  root.updateMatrixWorld(true);}
 const QH={on:false};
 function quiltHand(mode,sd,then){const P=window.__props||P3;if(!P||!P.quiltFold||!P.quiltEdge||!FIT.bed){if(P&&P.quiltFold)P.quiltFold(mode==='up'?0:1);then&&then();return;}
  const f0=P.quiltFold(),f1=mode==='up'?0:1;if(Math.abs(f1-f0)<.02){then&&then();return;}
  Object.assign(QH,{on:true,cut:false,mode,sd,t:0,f0,f1,tr:mode==='up'?.6:!H.inBed?.9:.75,rel:.56,tm:mode==='up'?1.35:mode==='down'?1.05:.9,trl:.6,then});}
 function quiltHandTick(dt){if(!QH.on)return;const P=window.__props||P3;const B=FIT.bed;if(!P||!B){QH.on=false;return;}QH.t+=dt;/* woken while still pulling it up (getting up already): he lets go at once and the flap falls by itself; his arm goes with the get-up (the two fought: the hand shook 30 cm a frame) */if(QH.mode==='up'&&(H.bedC&&H.bedC.dir<0||!H.inBed)&&QH.t<QH.tr+QH.tm){QH.t=QH.tr+QH.tm;QH.cut=true;}const {tr,tm,trl,sd}=QH;const t=QH.t;
  /* lying, pulling it up: his hand takes the turned-down edge over his chest until the flap is mostly over, then lets go and the
     last of it falls flat by itself (a hand pressed beside his own shoulder is past what an elbow folds to) */
  let fv;if(QH.mode==='up'){if(t<tr+tm)fv=lerp(QH.f0,QH.rel,smooth(tr,tr+tm,t));else{const u=(t-tr-tm)/.38;fv=QH.rel*Math.max(0,1-u*u);}}else fv=lerp(QH.f0,QH.f1,smooth(tr,tr+tm,t));
  P.quiltFold(fv);if(P.quiltLive)P.quiltLive(.15);
  const w=(t<tr?smooth(0,tr,t):t<tr+tm?1:1-smooth(tr+tm,tr+tm+trl,t))*(QH.cut?1-smooth(tr+tm,tr+tm+.2,t):1);const Hn=bones[sd+'Hand'];root.updateMatrixWorld(true);
  const hp=wp(bones.Hips);let e=P.quiltEdge(V(hp.x,hp.y,B.z1),QH.mode==='up'?.75:!H.inBed?.5:.6,QH.mode==='down'&&H.inBed?.39:.33);if(e)e.y+=QH.mode==='down'?.02:.06;/* lying, the edge lies on the mattress: the palm on top of it, fingers curled round, not under it (gate: hand 6.6 cm into the mattress) *//* the palm on the quilt's thickness: the fingers curl round the edge, not into the mattress (gate: hand 6.6 cm in) */if(QH.mode==='up'){if(t<tr+tm)QH.eRel=e&&e.clone();else if(QH.eRel)e=QH.eRel.clone();}
  if(e){const G=window.__grab;const palm=G&&G.gripPoint?G.gripPoint(sd):wp(Hn);const tg=e.clone().add(wp(Hn).sub(palm));
   const pole=()=>{if(QH.mode==='down')return sidePole(sd);const out=wp(bones[sd+'UpLeg']).sub(hp).setY(0).normalize();return out.add(V(0,.5,0)).normalize();};
   if(QH.mode==='down')bendReach(sd,tg,w,dt,1.2);/* seated: he leans toward the pillow end to reach it (the lean, then the arm) */
   {const PG=window.__poseGuard;if(PG&&PG.fit&&!window.__noFit){for(const n of ['Spine','Spine1','Spine2',sd+'Shoulder'])if(bones[n])PG.fit(bones[n]);root.updateMatrixWorld(true);}guardSpine();}/* the lean as the pose guard will let it stand, so the hand is placed from the body actually shown */
   if(w>.001){/* the palm, not the wrist, goes onto the cloth: the forearm turns the palm with it, so the wrist target is corrected on a
     full-weight trial solve, then the arm is set once at the action's weight */const A=bones[sd+'Arm'],Fa=bones[sd+'ForeArm'];const q0=[A.quaternion.clone(),Fa.quaternion.clone()];
    const IKq=(t,ww)=>{if(QH.mode==='up'&&H.inBed)armIK(sd,t,pole(),ww);else romArmIK(sd,t,pole(),ww,null);};/* lying: one fixed pole (romArmIK's three poles flipped the elbow 9-16 cm between frames) */
    for(let k=0;k<4;k++){IKq(tg,1);root.updateMatrixWorld(true);const pq=G&&G.gripPoint?G.gripPoint(sd):wp(Hn);const d=e.clone().sub(pq);if(d.length()<.008)break;tg.add(d);}
    A.quaternion.copy(q0[0]);Fa.quaternion.copy(q0[1]);root.updateMatrixWorld(true);IKq(tg,w);}
   if(w>.001&&H.inBed)elbowAbove(sd,B.mat+.07);/* lying: the elbow swings up round the shoulder-wrist line, never down into the mattress (gate: elbow 8-11 cm in) */
   if(w>.001)H.noPop={side:sd,until:performance.now()+150};/* the hand is IK'd on the cloth every frame */}
  if(t>=tr+tm+trl&&(QH.mode!=='down'||BRC.a<.002)){QH.on=false;P.quiltFold(QH.f1);const f=QH.then;QH.then=null;f&&f();}}
 function lieDown(then){const ed=N.bededge;H.face=0;
  sitDown(ed,()=>{H.trans=true;undressSeq(()=>{H.wait={t:rnd(.3,.6),then:()=>quiltHand('down','Left',()=>{H.wait={t:.15,then:()=>{bedClip(1,()=>{
   // hand over to the sleep clip: the root eases onto the lying spot while the poses cross-fade
   const li=N.bedlie;if(has('hy_bedlie'))play(SLEEPB,{fade:1.1});H.slide={x:li.p.x-root.position.x,z:li.p.z-root.position.z,yaw:0,k:0,d:1.1};
   H.trans=false;H.inBed=true;H.lieT=1.6;bedPress(true);H.seated=null;H.wait={t:.25,then:()=>quiltHand('up','Left')};then&&then();});}};})};});});}
 function getUp(then){H.trans=true;const ed=N.bededge;
  H.wait={t:rnd(.4,.9),then:()=>quiltHand('down','Left',()=>{H.inBed=false;if(!has('hy_bedgetup')||!FIT.bed||(FIT.bed.headDir||1)<0)bedPress(false);bedClip(-1,()=>{const er=H.edgeRoot||V(ed.p.x,root.position.y,ed.p.z);
   hold(STAND,0,.6);H.slide={x:er.x-root.position.x,z:er.z-root.position.z,yaw:0,k:0,d:.6};H.seated=ed;
   H.wait={t:rnd(.6,1),then:()=>{dressSeq(()=>{hold(STAND,0,.5);H.wait={t:.35,then:()=>standUp(ed,()=>{vestOnStanding(()=>{if(!hasVest()&&has('hy_stretch')&&Math.random()<.8&&armsFree(root.position,root.rotation.y,'hy_stretch'))overlay('hy_stretch',{fade:.5,speed:1.1});then&&then();});})};});}};});})};}
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
  /* LEISURE: a squat lowers the root under the boards he stands on: the ray from the root found the storey below (telescope, game style: root down 40 cm in one frame). Ray and check from the feet's level. (40 cm at f10921 was the ray down a plank gap at the telescope) */const sqF=H.squat||0;let fl=null;if(!busy&&!H.trans&&H.ground&&typeof floorAt==='function'){try{fl=floorAt(p.x,p.y+sqF,p.z,.32);/* and as the floor follow does: one ray down a gap between planks is not a drop when the boards around hold him */if(fl!=null)for(const [ox,oz] of [[.07,0],[-.07,0],[0,.07],[0,-.07]]){const g2=floorAt(p.x+ox,p.y+sqF,p.z+oz,.32);if(g2!=null&&g2>fl&&g2<=p.y+sqF+.03)fl=g2;}}catch(e){}}FZ.ft=(fl!=null&&p.y+sqF-fl>.1&&p.y+sqF-fl<.6)?FZ.ft+dt:0;
  if(FZ.ft>1.5){p.y=fl-sqF;H.floorY=fl;FZ.ft=0;}
  if(FZ.t>6||FZ.lt>2.5){FZ.t=0;FZ.lt=0;console.warn('[hero] freeze guard: recover',H.task,nm,p.toArray().map(v=>+v.toFixed(2)));H.trans=false;H.lad=null;H.stk=null;H.once=null;
   play(IDLE(),{fade:.5});const n=H.task;if(n&&act){if(act.leave&&!act.left){act.left=true;try{act.leave(()=>{endTask(false);});}catch(e){endTask(false);}}else endTask(false);}}}
 // ===== HERO-RULES 1: one pose pipeline. Modules register a pass in a fixed slot instead of wrapping HH.update =====
 const SLOTS=['pre','motion','look','contacts','collide','grab','pops','guard'];const STAGES={};for(const k of SLOTS)STAGES[k]=[];
 function stage(slot,fn){if(!STAGES[slot])throw new Error('unknown hero slot '+slot);STAGES[slot].push(fn);return fn;}
 // BED: after collide.js. Getting up, its small hand push (3 cm) flipped the left arm ~55 cm up over his head for a second (traced frame by
 // frame: hand 9.00 before the collide stage, 9.57 after). While a bed clip plays, a hand above ~35 cm over the mattress is put back down
 // beside the hip, on the mattress.
 /* a boot is let go from the hand as it was shown (after the pop filter and the pose guard, which wraps the whole update), so it stays exactly where the hand had it */
 stage('pre',()=>{const R=BSEQ.r;if(R&&R.dropNow){R.dropNow=false;bootDown(R.sd);}if(R&&R.onNow){R.onNow=false;bootOnStart(R.sd);}if(R&&R.pickNow){R.pickNow=false;const B=BT.side[R.sd];const pm=B&&B.prop;if(pm&&!(pm.parent&&/Hand$/.test(pm.parent.name))){root.updateMatrixWorld(true);_hb.setFromObject(pm);const top=_hb.getCenter(V());top.y=_hb.max.y;{const hq=wp(bones.Hips);const d=V(hq.x-top.x,0,hq.z-top.z);const L=d.length();if(L>1e-3)top.add(d.multiplyScalar(Math.min(.045,L)/L));}const G=window.__grab;const palm=G&&G.gripPoint?G.gripPoint(R.sd):wp(bones[R.sd+'Hand']);/* the hand is on it: it simply closes; still out of reach (should not happen): the old short lift into the hand */const dd=palm.distanceTo(top);if(dd<.09||(dd<.2&&(R.t||0)>=R.at+.15)){pm.visible=true;R.fl=_hb.min.y;if(R.last)R.last.tg=wp(bones[R.sd+'Hand']);/* from here the hand only goes up: it was still settling onto the rim */bones[R.sd+'Hand'].attach(pm);}else if((R.t||0)<R.at+.15)R.pickNow=true;/* not on it yet: the hand keeps reaching, he takes it a moment later */else bootPick(R.sd,R.sd);}}});/* next frame's start: the bones still hold the pose last shown */
 /* a boot just taken from the floor never goes back down through the boards (after the pop filter, which held the hand low for a few frames) */
 stage('guard',()=>{const R=BSEQ.r;if(!R||!R.pick||R.fl==null)return;const B=BT.side[R.sd];const pm=B&&B.prop;if(!pm||!pm.parent||!/Hand$/.test(pm.parent.name))return;root.updateMatrixWorld(true);_hb.setFromObject(pm);const dn=R.fl+.004-_hb.min.y;if(dn<=0)return;const sd=/Left/.test(pm.parent.name)?'Left':'Right';const A=bones[sd+'Arm'],Fa=bones[sd+'ForeArm'],Hd=bones[sd+'Hand'];const el=wp(Fa),mid=wp(A).add(wp(Hd)).multiplyScalar(.5);ik2(A,Fa,Hd,wp(Hd).add(V(0,dn,0)),el.sub(mid).normalize(),1,true);root.updateMatrixWorld(true);});
 stage('grab',dt=>{if(BSEQ.a||BPL.on||BPL.rel>0||BON.on){seatFootGap(dt);bootOnTick(dt);bootPullTick(dt);bootReach(dt);heldBootClear(dt);vestHeldClear(dt);}else{SFG.v=0;if(!QH.on&&!VD.on&&!VR.on)BRC.a=0;HBC.Left.set(0,0,0);HBC.Right.set(0,0,0);}});
 // BOOTS OFF, readable (Pavel: "you can't see that he is taking them off"): his hand goes to the heel of the boot first, takes it,
// and pulls: the boot slides off over the toes along the foot (the sock comes out of it) while the clip slows to the pull, and
// only then is it in his hand and goes down to the floor. Before, the boot jumped from the foot into the hand in one frame.
const BPL={on:false,rel:0};
function bootHeel(sd,out){root.updateMatrixWorld(true);const f=wp(bones[sd+'Foot']),tb=bones[sd+'ToeBase']?wp(bones[sd+'ToeBase']):f.clone().add(fwd(root.rotation.y).multiplyScalar(.12));
 const d=tb.clone().sub(f);const L=d.length()||1;d.multiplyScalar(1/L);out.copy(f).addScaledVector(d,-.07);out.y-=.035;return d;}
function heelTarget(sd,pt){const Hn=bones[sd+'Hand'];const G=window.__grab;const palm=G&&G.gripPoint?G.gripPoint(sd):wp(Hn);return pt.clone().add(wp(Hn).sub(palm));}
function bootPullStart(sd){const B=BT.side[sd];if(!B||!B.on)return;const pm=B.prop;bootWorld(B,_bbm);scene.add(pm);pm.matrix.copy(_bbm);pm.matrix.decompose(pm.position,pm.quaternion,pm.scale);pm.visible=true;pm.userData.offFoot=sd;/* sliding off its own foot: the foot is inside it on purpose */bootShow(sd,false);
 const a=BSEQ.a;Object.assign(BPL,{on:true,sd,t:0,d:.6,a,ts:a?a.timeScale:1,rel:0,tg:null});if(a)a.timeScale=(a.timeScale||1)*.35;AU&&AU('cloth',root.position);}
const _bpm=new THREE.Matrix4(),_bpt=new THREE.Matrix4();
// BOOTS ON, readable (the mirror of taking them off): the boot in his hand goes to the toes, then slides up over the foot to the heel
// in ~0.6 s while his hand holds it at the back and pulls; only then is it the worn boot again (it used to jump on in 0.25 s)
const BON={on:false};const _bnq=new THREE.Quaternion(),_bnp=V(),_bns=V();
function bootOnStart(sd){const B=BT.side[sd];if(!B)return;const pm=B.prop;root.updateMatrixWorld(true);scene.attach(pm);pm.visible=true;pm.userData.offFoot=sd;
 const a=BSEQ.a;Object.assign(BON,{on:true,sd,t:0,d:.75,P0:pm.position.clone(),Q0:pm.quaternion.clone(),a,ts:a?a.timeScale:1});if(a)a.timeScale=(a.timeScale||1)*.35;}
function bootOnTick(dt){if(!BON.on)return;const st=dt||1/60;const B=BT.side[BON.sd];const pm=B&&B.prop;if(!pm){BON.on=false;return;}BON.t+=st;const u=Math.min(1,BON.t/BON.d);
 const ea=smooth(0,.35,u),eb=smooth(.3,1,u);bootWorld(B,_bpm);const h=V();const d=bootHeel(BON.sd,h);const off=d.clone().multiplyScalar(.17*(1-eb)).add(V(0,-.02*(1-eb),0));
 _bpt.makeTranslation(off.x,off.y,off.z).multiply(_bpm);_bpt.decompose(_bnp,_bnq,_bns);pm.position.copy(BON.P0).lerp(_bnp,ea);pm.quaternion.copy(BON.Q0).slerp(_bnq,ea);pm.updateMatrixWorld(true);
 const tg=heelTarget(BON.sd,h.add(off));const hw=wp(bones[BON.sd+'Hand']).add(HBC[BON.sd].clone().multiplyScalar(1-ea));/* from where the hand was last shown: heldBootClear had it pushed out of the shins, and that push ends with the boot leaving the hand (a 13 cm jump) */const tg2=hw.lerp(tg,ea);bendReach(BON.sd,tg2,1,st,.25);H.noPop={side:BON.sd,until:performance.now()+150};BPL.tg=tg;BPL.sd=BON.sd;
 if(u>=1){pm.visible=false;delete pm.userData.offFoot;bootShow(BON.sd,true);AU('thud',root.position);if(BON.a)BON.a.timeScale=BON.ts;BON.on=false;BPL.rel=.5;BPL.rt=.5;BPL.out=null;BPL.skip=1;/* the release starts next frame: run now on top of this frame's reach it bent the back twice (head 9 cm/frame) */}}
function bootPullTick(dt){const st=dt||1/60;
 // reaching for the heel before the pull: the palm closes on the back of the boot
 if(!BPL.on&&BPL.rel<=0){const R=BSEQ.r;const a=BSEQ.a;if(R&&R.down&&a){const B=BT.side[R.sd];const t=a.time;if(B&&B.on&&t>BOOT_OFF.grab-.55&&t<BOOT_OFF.grab+.05){const w=smooth(BOOT_OFF.grab-.55,BOOT_OFF.grab-.12,t);const h=V();bootHeel(R.sd,h);BPL.hp=h;BPL.sd=R.sd;romArmIK(R.sd,heelTarget(R.sd,h),sidePole(R.sd),w,null);H.noPop={side:R.sd,until:performance.now()+150};}}return;}
 if(BPL.on){const B=BT.side[BPL.sd];const pm=B&&B.prop;if(!pm){BPL.on=false;return;}BPL.t+=st;const e=smooth(0,BPL.d,BPL.t);
  bootWorld(B,_bpm);const h=V();const d=bootHeel(BPL.sd,h);const off=d.clone().multiplyScalar(.17*e).add(V(0,-.02*e,0));
  _bpt.makeTranslation(off.x,off.y,off.z).multiply(_bpm);_bpt.decompose(pm.position,pm.quaternion,pm.scale);pm.updateMatrixWorld(true);
  const tg=heelTarget(BPL.sd,h.add(off));BPL.tg=tg;BPL.hp=h;bendReach(BPL.sd,tg,1,st,.25);H.noPop={side:BPL.sd,until:performance.now()+150};
  if(BPL.t>=BPL.d){root.updateMatrixWorld(true);bones[BPL.sd+'Hand'].attach(pm);delete pm.userData.offFoot;if(BPL.a)BPL.a.timeScale=BPL.ts;BPL.on=false;BPL.rel=.5;BPL.rt=.5;BPL.out=null;}return;}
 // let the arm go back to the clip with the boot in hand
 if(BPL.skip){BPL.skip=0;return;}BPL.rel-=st;const w=Math.max(0,BPL.rel/BPL.rt);if(BPL.tg&&w>.001){/* the boot comes out from between his legs to his own side first, then the clip takes it down */if(!BPL.out){root.updateMatrixWorld(true);const hp=wp(bones.Hips);const o=BPL.tg.clone().sub(hp);o.y=0;BPL.out=o.normalize();}
  const u=1-w;const tg2=BPL.tg.clone().addScaledVector(BPL.out,.1*smooth(0,.7,u)).add(V(0,.03*smooth(0,.7,u),0));/* the target walks back to where the clip has the hand (blending the arm's angles instead swung the elbow round, 11 cm/frame) */root.updateMatrixWorld(true);const cw=wp(bones[BPL.sd+'Hand']);const tg3=cw.lerp(tg2,smooth(0,1,w));bendReach(BPL.sd,tg3,Math.min(1,w*5),st,Math.max(.01,.25*w));H.noPop={side:BPL.sd,until:performance.now()+150};}}
// the elbow turned up round the line from the shoulder to the wrist (the hand stays where it is) until it is over y
function elbowAbove(sd,y){const A=bones[sd+'Arm'],Fa=bones[sd+'ForeArm'],Hd=bones[sd+'Hand'];if(!A||!Fa||!Hd)return;root.updateMatrixWorld(true);if(wp(Fa).y>=y)return;
 const s0=wp(A),ax=wp(Hd).sub(s0);if(ax.lengthSq()<1e-6)return;ax.normalize();const e=wp(Fa).sub(s0);const c=ax.clone().multiplyScalar(e.dot(ax));const r=e.clone().sub(c);
 const up=V(0,1,0).addScaledVector(ax,-ax.y);if(up.lengthSq()<1e-6||r.lengthSq()<1e-8)return;up.normalize();r.normalize();
 /* the elbow's highest point on its circle, then only as far toward it as needed (one direction, no flipping between frames) */
 const tmax=Math.atan2(V().crossVectors(r,up).dot(ax),r.dot(up));const q0=A.quaternion.clone();const at=a=>{A.quaternion.copy(q0);A.updateMatrixWorld(true);rotW(A,ax,a);return wp(Fa).y;};
 if(at(tmax)<y)return;let lo=0,hi=tmax;for(let k=0;k<10;k++){const m=(lo+hi)/2;if(at(m)>=y)hi=m;else lo=m;}at(hi);}
// LYING DOWN, the last of it: the clip ends propped up (chest ~10 cm high, chin on the chest) and the sleep pose only took over
// ~0.4 s later, so his head hung 15 cm over the pillow (gate HARD, sleep f1493). From the end of the lie-down until he is settled,
// the chest goes down and the head tips back onto the pillow. Only lowers: a pose already down is left as it is.
const LS={w:0};function lieSettle(dt){const c=H.bedC;const on=(c&&c.dir>0&&c.u>.38)||(H.inBed&&!c&&(H.lieT||0)>0&&!window.__sleepPose);if(H.lieT>0)H.lieT-=dt;
 LS.w=on?Math.min(1,LS.w+dt*3):Math.max(0,LS.w-dt*3);if(LS.w<.01||!bones.Neck||!bones.Head||!bones.Spine1)return;const w=LS.w*(c?smooth(.38,.7,c.u):1);/* the back down onto the mattress while the legs come up, not after (R23-2: it hovered 10-20 cm for 0.7 s) */
 root.updateMatrixWorld(true);const lat=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).normalize();const hy=wp(bones.Hips).y;
 const tryRot=(b,f,ang)=>{const q=b.quaternion.clone();const f0=f();rotW(b,lat,ang);const f1=f();if(f1>f0){b.quaternion.copy(q);b.updateMatrixWorld(true);rotW(b,lat,-ang);if(f()>f0){b.quaternion.copy(q);b.updateMatrixWorld(true);}}};
 // the chest down to the mattress: the neck ~4 cm under the hips
 const nkH=()=>wp(bones.Neck).y;const dy=nkH()-(hy-.01);if(dy>.005)tryRot(bones.Spine1,nkH,Math.min(.5,Math.asin(Math.min(1,dy/.38)))*w);
}
// the back of the head ON the pillow, all the time he lies (not only while settling: the sleep poses left one hero's head 7 cm in the pillow)
const HPW={w:0};function headPillow(dt){const c=H.bedC;const on=(H.inBed&&!c)||(c&&c.dir>0&&c.u>.3)||(c&&c.dir<0&&c.u<.25);HPW.w=on?Math.min(1,HPW.w+dt*3):Math.max(0,HPW.w-dt*4);if(HPW.w<.01){HPW.a=0;HPW.t=null;}const w=HPW.w*(c?(c.dir>0?smooth(.3,.6,c.u):1-smooth(0,.25,c.u)):1);/* from when the head comes down to the pillow */
 if(w<.01||!bones.Neck||!bones.Head||!bones.Spine2)return;root.updateMatrixWorld(true);const lat=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).normalize();
 // one eased bend, carried frame to frame (a fresh try-this-way-or-that each frame flipped and shook the quilt hand 37 mm)
 const S1=bones.Spine1||bones.Spine2;const app=a=>{rotW(S1,lat,a*.3);rotW(bones.Spine2,lat,a*.35);rotW(bones.Neck,lat,a*.35);root.updateMatrixWorld(true);};/* spread down the back: the pillow lifts head and shoulders together */const q1=S1.quaternion.clone(),q2=bones.Spine2.quaternion.clone(),qn=bones.Neck.quaternion.clone();const rst=()=>{S1.quaternion.copy(q1);bones.Spine2.quaternion.copy(q2);bones.Neck.quaternion.copy(qn);root.updateMatrixWorld(true);};
 app(HPW.a||0);const g0=headLow()-.004;rst();app((HPW.a||0)+.04);const g1=headLow()-.004;rst();const sl=(g1-g0)/.04;
 let want=HPW.a||0;if(Math.abs(sl)>.02&&Math.abs(g0)>.004)want+=Math.max(-.6,Math.min(.6,-g0/sl));want=Math.max(-1.0,Math.min(1.0,want));
 HPW.t=HPW.t==null?want:HPW.t+(want-HPW.t)*Math.min(1,dt*6);/* the aim itself low-passed: the lowest skin point hops between hair and scalp */HPW.a=(HPW.a||0)+Math.max(-1.2*dt,Math.min(1.2*dt,HPW.t-(HPW.a||0)));/* at most ~70 deg/s */if(w<.999)HPW.a*=1;app(HPW.a*w);}
// lying, a hand over the mattress rests ON it, whichever pose or blend put it there (after the quilt was let go it sank 6 cm in, gate)
const HOB={Left:0,Right:0};function handsOnBed(dt){const B=FIT.bed;const on=!!(B&&H.inBed&&!H.bedC&&!(QH.on&&QH.mode==='down'));for(const sd of ['Left','Right']){const A=bones[sd+'Arm'],Fa=bones[sd+'ForeArm'],Hn=bones[sd+'Hand'];if(!Hn)continue;
  root.updateMatrixWorld(true);const h=wp(Hn);const lo=B?B.mat+.05:0;const need=on&&h.x>B.x0&&h.x<B.x1&&h.z<B.z1+.01&&h.y<lo;HOB[sd]=need?Math.min(1,HOB[sd]+dt*4):Math.max(0,HOB[sd]-dt*4);if(HOB[sd]<.01||!B)continue;
  const tg=h.clone();tg.y=Math.max(h.y,lo);if(tg.z>B.z1-.03)tg.z=B.z1-.03;const el=wp(Fa),mid=wp(A).add(h).multiplyScalar(.5);const pole=el.sub(mid);if(pole.lengthSq()<1e-6)pole.set(0,-1,0);ik2(A,Fa,Hn,tg,pole.normalize(),HOB[sd],false);H.noPop={side:sd,until:performance.now()+150};}}
// the top of the bed (pillow, mattress, quilt) under a point, from the bunk's own meshes; cached on a 2 cm grid
const BTOP=new Map();const _btr=new THREE.Raycaster();function bedTopAt(x,z){const k=Math.round(x*50)+','+Math.round(z*50);if(BTOP.has(k))return BTOP.get(k);const P=PP();const bk=P&&P.objects&&P.objects.bunkbed;let y=null;
 if(bk&&FIT.bed){_btr.set(V(x,FIT.bed.mat+.45,z),V(0,-1,0));_btr.far=.7;const hs=_btr.intersectObject(bk,true).filter(h=>h.object.isMesh&&h.object.material!==(P.quiltMat||null));/* the lower quilt is pressed by his body: the pillow and mattress under it count */const q=hs.find(h=>h.point.y<FIT.bed.mat+.3);if(q)y=q.point.y;}
 if(BTOP.size>4000)BTOP.clear();BTOP.set(k,y);return y;}
// the lowest point of the head's own skin (each hero's head is shaped differently: one bone height left one 7 cm in the pillow, the other 14 cm over it)
const HLV={L:[],key:null};const _hlv=new THREE.Vector3();
// the head's own skin, lowest point measured against the bed right under each point (a hero with a separate head mesh: the first skinned mesh
// held only the neck seam, so the head was lifted 15 cm off the pillow; one gap under the head bone missed the pillow's slope)
function headSkin(){const ms=[];root.traverse(o=>{if(o.isSkinnedMesh&&o.visible&&o.skeleton&&o.skeleton.bones.includes(bones.Head)&&!/shadow|eyelid|mouth|vest|coat|boot/i.test(o.name))ms.push(o);});const key=ms.map(m=>m.uuid).join();if(HLV.key===key)return HLV;
 const L=[];for(const sk of ms){const bi=sk.skeleton.bones.indexOf(bones.Head);const SI=sk.geometry.attributes.skinIndex,SW=sk.geometry.attributes.skinWeight;const ix=[];if(SI&&SW)for(let i=0;i<SI.count;i++){for(let k=0;k<4;k++)if(GCMP(SI,i,k)===bi&&GCMP(SW,i,k)>.6){ix.push(i);break;}}
  if(ix.length>=20){const st=Math.max(1,Math.floor(ix.length/250));L.push({m:sk,ix:ix.filter((_,j)=>j%st===0)});}}/* every body mesh with head skin (one hero's head is split over several meshes; the shadow proxy and eyelids are not the head) */
 Object.assign(HLV,{key,L});return HLV;}
function headLow(){const S=headSkin();let lo=1e9;for(const {m,ix} of S.L)for(const i of ix){m.getVertexPosition(i,_hlv);m.localToWorld(_hlv);const t=bedTopAt(_hlv.x,_hlv.z);if(t==null)continue;const g=_hlv.y-t;if(g<lo)lo=g;}
 if(lo>1e8){const h=wp(bones.Head);const t=bedTopAt(h.x,h.z);return t==null?.05:h.y-.1-t;}return lo;}
stage('grab',dt=>{lieSettle(dt);headPillow(dt);quiltHandTick(dt);vestReachTick(dt);vestRegripTick(dt);vestPutTick(dt);handsOnBed(dt);});
 // lying down / getting up, a foot off the floor never flexes up hard toward the shin: the swing in over the edge drew the toes up
 // to 112 deg shin-to-foot (37 past his standing 75; ?style=game P1 48 against its own lower standing neutral). Soft cap ~98 deg.
 function bedAnkleCap(){const c=H.bedC;if(!c)return;const fl=(N.bededge&&N.bededge.floor)??(FIT.bed?FIT.bed.mat-.5:-1e9);root.updateMatrixWorld(true);
  for(const sd of ['Left','Right']){const L=bones[sd+'Leg'],F=bones[sd+'Foot'],T=bones[sd+'ToeBase'];if(!L||!F||!T)continue;const pf=wp(F);if(pf.y<fl+.08)continue;
   const sv=pf.clone().sub(wp(L)),fv=wp(T).sub(pf);const a=sv.angleTo(fv)*180/Math.PI;const k=88,m=10;if(a<=k)continue;const na=k+m*Math.tanh((a-k)/m);
   const ax=V().crossVectors(sv,fv);if(ax.lengthSq()<1e-10)continue;rotW(F,ax.normalize(),-(a-na)*Math.PI/180);root.updateMatrixWorld(true);}}
 stage('grab',()=>{const c=H.bedC,B=FIT.bed;if(!c||!B)return;bedAnkleCap();root.updateMatrixWorld(true);
  /* lying down he swings his legs in with the thighs about level, not both knees thrown ~20 cm over the hips (watcher r12 f2520-2544) */if(c.dir>0){const kw=smooth(.12,.25,c.u)*(1-smooth(.8,.95,c.u));if(kw>.001){for(const sd of ['Left','Right'])dropTo(bones[sd+'UpLeg'],bones[sd+'Leg'],wp(bones[sd+'UpLeg']).y+.08,kw);root.updateMatrixWorld(true);}}const hp=wp(bones.Hips),lr=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).setY(0).normalize();
  for(const sd of ['Left','Right']){const Hn=bones[sd+'Hand'];if(!Hn)continue;{/* getting up: a hand the bed guard put on the mattress stays there through the later slots (they raised the shoulder and this pull-down then dragged it back by jerks, 6-10 cm/frame) */const G=BHG[sd];if(c.dir<0&&G.w>.001&&G.f===BHG.f){armIK(sd,G.tg,sidePole(sd),G.wl*G.w);continue;}}const ex=wp(Hn).y-(B.mat+.35);if(ex<=0)continue;
   const t=hp.clone().addScaledVector(lr,sd==='Left'?.27:-.27);t.y=B.mat+.1;t.z=Math.min(t.z,B.z1-.1);armIK(sd,t,sidePole(sd),clamp(ex/.12,0,1));}});
 // lying down / in bed / getting up: heels and calves ride ON the mattress, the leg lifted at the hip over its edge, never through it
 // (gate hy_bedlie: the right ankle 10-13 cm under the mattress top while the legs swung in, the calf through the front edge)
 const LOB={Left:{w:0,a:0,t:null},Right:{w:0,a:0,t:null},key:null,S:null};const _lov=new THREE.Vector3();
 function legBedSkin(){const ms=[];root.traverse(o=>{if(o.isSkinnedMesh&&o.visible&&o.skeleton&&!/shadow|eyelid|mouth/i.test(o.name))ms.push(o);});const key=ms.map(m=>m.uuid).join();if(LOB.key===key)return LOB.S;
  const S={Left:[],Right:[]};for(const sd of ['Left','Right']){const want=new Set(['Leg','Foot','ToeBase'].map(n=>bones[sd+n]).filter(Boolean));
   for(const sk of ms){const bi=new Set(sk.skeleton.bones.map((b,i)=>want.has(b)?i:-1).filter(i=>i>=0));if(!bi.size)continue;const SI=sk.geometry.attributes.skinIndex,SW=sk.geometry.attributes.skinWeight;if(!SI||!SW)continue;const ix=[];
    for(let i=0;i<SI.count;i++){let bw=-1,bb=-1;for(let k=0;k<4;k++){const w=GCMP(SW,i,k);if(w>bw){bw=w;bb=GCMP(SI,i,k);}}if(bi.has(bb))ix.push(i);}
    if(ix.length>=20){const st=Math.max(1,Math.floor(ix.length/220));S[sd].push({m:sk,ix:ix.filter((_,j)=>j%st===0)});}}}
  LOB.key=key;LOB.S=S;return S;}
 function legLow(sd){const S=legBedSkin()[sd];let lo=1e9;const CD=window.__collide&&window.__collide.depthAt?window.__collide:null;for(const {m,ix} of S)for(const i of ix){m.getVertexPosition(i,_lov);m.localToWorld(_lov);const t=bedTopAt(_lov.x,_lov.z);if(t==null)continue;let g=_lov.y-t;if(g<-.16)continue;/* hanging below the edge in front of it: that is the floor side, not on the bed */if(CD){const d=CD.depthAt(_lov.x,_lov.y,_lov.z);if(d>0)g=Math.min(g,-d-.005);}/* the bed's solid edge is squarer than its drawn rounded top */if(g<lo)lo=g;}return lo>1e8?null:lo;}
 stage('grab',dt=>{const c=H.bedC,B=FIT.bed;const on=!!B&&((H.inBed&&!c)||(c&&c.dir>0&&c.u>.15)||(c&&c.dir<0&&c.u<.85));
  if(!B||!bones.LeftUpLeg)return;root.updateMatrixWorld(true);const lat=wp(bones.LeftUpLeg).sub(wp(bones.RightUpLeg)).normalize();
  for(const sd of ['Left','Right']){const L=LOB[sd],U=bones[sd+'UpLeg'];L.w=on?Math.min(1,L.w+dt*4):Math.max(0,L.w-dt*4);if(L.w<.01){L.a=0;L.t=null;continue;}
   const q0=U.quaternion.clone();const app=a=>{U.quaternion.copy(q0);rotW(U,lat,a);root.updateMatrixWorld(true);};
   app(L.a);const g0=legLow(sd);app(L.a+.04);const g1=legLow(sd);U.quaternion.copy(q0);root.updateMatrixWorld(true);
   let want=L.a;const tgt=-.005;/* a soft mattress gives ~1 cm under a heel */
   if(g0!=null&&g1!=null){const sl=(g1-g0)/.04;if(Math.abs(sl)>.05){if(g0<tgt)want=L.a+Math.min(.5,Math.max(-.5,(tgt-g0)/sl));else if(g0>tgt+.02)want=L.a-Math.sign(sl)*Math.min(Math.abs(L.a),(g0-tgt-.01)/Math.abs(sl));}}else want=0;
   want=Math.max(-.7,Math.min(.7,want));const up=g0!=null&&g0<tgt,far=!c&&g0!=null&&g0>tgt+.03;/* out of the mattress at once (the heel crosses the edge in ~6 frames); lying, down at once when the pose under it came up by itself (after the sleep clip took over, the lift kept on top of it left the heel hanging 8 cm over the mattress); small differences eased */L.t=L.t==null||up||far?want:L.t+(want-L.t)*Math.min(1,dt*6);const rt=far?30:up?6:1.5;L.a+=Math.max(-rt*dt,Math.min(rt*dt,L.t-L.a));app(L.a*L.w);}});
 function runSlot(slot,dt){const L=STAGES[slot];for(let i=0;i<L.length;i++){try{L[i](dt);}catch(e){console.error('hero slot '+slot,e);}}}
 function update(dt){if(dt<=0)return;FRN++;runSlot('pre',dt);const r=updateCore(dt);runSlot('collide',dt);runSlot('grab',dt);runSlot('pops',dt);runSlot('guard',dt);if(INV.on)invCheck(dt);return r;}
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
    if(!H.linger&&!H.seated&&Math.random()<.45){H.linger=rnd(3,5);const c=pick(has('hy_stretch')&&h<11&&armsFree(root.position,root.rotation.y,'hy_stretch')?['hy_stretch','336']:['336',IDLE(),IDLE()]);H.lingerClip=c;if(c==='hy_stretch'){H.linger=durOf(c);once(c,{fade:.6});}}
    if(H.linger&&!H.seated){H.linger-=dt;if(H.lingerClip!=='hy_stretch')play(H.lingerClip,{fade:.6});H.look=null;H.lookW=0;if(H.linger>0)return post(dt);}
    H.linger=0;startTask(night&&h<21.5&&h>=20?'read':choose());}
   else if(night&&H.task!=='sleep'&&H.task!=='guard'&&(h>=21.5||h<5)){startTask('sleep');}}
  }
  if(H.lad&&(!H.path.length||H.path[0].t!=='ladder')){H.lad=null;H.ground=true;}
  if(H.pending&&!H.trans&&!H.lad){const n=H.pending,o=H.pendingOpts;H.pending=null;H.pendingOpts=null;startTask(n,o);}
  // movement
  /* GRAB: tools hung at the hip for a ladder that is no longer on his way (the plan changed): the hands take them back */
  if(H.stowPre)H.stowPre=H.stowPre.filter(([h,n])=>onHeroT(n)||slung[n]);if(H.stowPre&&!H.stowPre.length)H.stowPre=null;/* GRAB: a tool the last (cut-off) task put back is not handed to him again by the next one (gate: the water bucket came back into his hand in dumpwater) */
  if(H.stowPre&&!STW&&!H.lad&&!(H.path.length&&(H.path[0].t==='ladder'||(H.path[1]&&H.path[1].t==='ladder')))){STW={mode:'on',t:0,items:H.stowPre.map(([h,n,pp,pq,ps])=>({h,n,pp,pq,ps}))};H.stowPre=null;}
  /* the door asked for above is open now: the walk it stopped goes on (a new task drops the request: startTask -> goTo) */
  if(H.doorBlocked&&!H.path.length&&!H.trans){H.doorBlocked.t+=dt;if(!doorShut()){const B=H.doorBlocked;H.doorBlocked=null;goTo(B.node,B.then);}}
  if(H.path.length){const step=H.path[0];if(step.t==='ladder')ladderStep(dt);else walkStep(dt);if(!H.path.length&&H.then){const f=H.then;H.then=null;H.state='work';f();}}
  else if(H.state==='walk'){H.state='work';H.v=0;}
  if(!H.path.length){if(!H.swing&&!H.trans&&!H.seated&&!H.inBed){const da=wrapA(H.face-root.rotation.y);const wav=clamp(da*3.5,-2.6,2.6);H.av=H.slide&&(H.slide.yT!=null||Math.abs(H.slide.yaw||0)>1e-3)?0:(H.av||0)+clamp(wav-(H.av||0),-6*dt,6*dt);/* a slide that turns him (approachTo) sets the yaw itself: the follower turned him as well, twice the turn (telescope: 45 deg past the tube and back) */if(Math.abs(da)<.002&&Math.abs(H.av)<.02)H.av=0;root.rotation.y+=H.av*dt;
     if(H.slide&&Math.hypot(H.slide.x||0,H.slide.z||0)>.08&&!window.__oldTurnStep){H.turnStep=false;}/* a step to a work spot (approachTo) owns the walk clip until it ends: the turn-step below dropped it to idle mid-step (a 35 cm glide; game style: the feet then caught up after, leg jitter 6-8 cm) */
     else if(Math.abs(da)>.35&&H.cur&&['0','11','12','336','30','hy_idle'].includes(H.cur.getClip().name)){play('30',{fade:.3,speed:.7});H.turnStep=true;}else if(H.turnStep&&Math.abs(da)<.12){H.turnStep=false;if(H.cur===actions['30'])play(IDLE(),{fade:.4});}}}
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
  edgeTick(dt);bedTick(dt);overlayTick(dt);bseqTick(dt);gtTick(dt);bedClipTick(dt);kneeNarrow(dt);
  // height: stand on the real floor, or put the hips on the seat / mattress
  /* KITCHEN: a crouch whose task is gone (cut off mid-squat) eases back up instead of staying on for the next task */
  /* the root settles for a moment after a crouch: the soles stay locked meanwhile (soleLock took the last few mm of rise for walking and let the feet jump 11-14 cm) */if(H.kSquat)H.kSqG=.6;else if((H.kSqG||0)>0)H.kSqG-=dt;
  if(H.kSquat){if(!act||act!==H.kSqA){H.squat=Math.max(0,(H.squat||0)-1.2*dt);if(H.squat<=.001){H.squat=0;H.kSquat=0;kSlow(false);}}}
  if(H.fit){const f=H.fit;const hy=bones.Hips.position.y;let w=1;
   if(f.mode==='sit')w=smooth(0,1,(f.hStand-hy)/Math.max(.05,f.hStand-f.hSeat));else if(f.mode==='rise')w=1-smooth(0,1,(hy-f.hSeat)/Math.max(.05,f.hStand-f.hSeat));
   p.y=lerp(f.base,f.y-hy,w);if(f.e){f.e*=Math.exp(-dt*7);if(Math.abs(f.e)<.002)f.e=0;p.y+=f.e;}}
  else if(H.ground&&H.kSquat&&(H.squat||0)>.02){/* KITCHEN crouch only (oven, woodpile, fridge shelf): the ray starts at the feet's level (from root+squat it started inside
   his own capsule and found no floor, so the hips never went down); the root keeps pace with the squat. Walking never comes here. */
   const sq=H.squat;const f=floorAt(p.x,p.y+sq,p.z,.06,.6)??floorAt(p.x,p.y+sq,p.z,.2,.6);if(f!=null&&Math.abs(f-(p.y+sq))<.3){H.floorY=f;const d=f-sq-p.y;p.y+=clamp(d*(1-Math.exp(-dt*12)),-2.6*dt,2.6*dt);}}
  else if(H.ground){// follow the boards: small steps up/down only (a gap between planks or a hole never pulls him down a storey)
   const sq=H.squat||0;/* KITCHEN: H.squat lowers the hips, the feet stay on the boards (legIK) */let f=floorAt(p.x,p.y+sq,p.z,.32);/* WALK: one ray between two planks hit the joist below: the root dipped 2 cm for a few frames. A drop is real only if the boards around agree */
   if(f!=null&&H.floorY!=null&&f<H.floorY-.006){for(const [ox,oz] of [[.07,0],[-.07,0],[0,.07],[0,-.07]]){const g2=floorAt(p.x+ox,p.y+sq,p.z+oz,.32);if(g2!=null&&g2>f&&g2<=H.floorY+.01)f=g2;}}
   /* WALK: on the ground the oak's roots are something to stand on: the body rises only when both soles (and the hips) are over a root;
      a single foot on a root is lifted by terrainFeet() with the knee bending, like stepping over it */
   const G=window.__ground;if(f!=null&&G&&G.standAt&&p.y<2&&!window.__noRootStep){const hs=['Left','Right'].map(s=>{const a=bones[s+'Foot']?bones[s+'Foot'].getWorldPosition(V()):p;return G.standAt(a.x,a.z);});f=Math.max(f,Math.min(G.standAt(p.x,p.z),...hs));}
   /* OUTDOOR: the pond lies in a hollow the floor ray never sees (flat at 0): on its bank he stood 7-16 cm in the air (film, filling the pail). Near the pond the soles stand on the sloping bank */
   if(f!=null&&G&&G.standAt&&p.y<.3){const dx=p.x+1.4,dz=p.z-7.6,c=Math.cos(-.12),sn=Math.sin(-.12);if(Math.hypot((dx*c+dz*sn)/1.75,(-dx*sn+dz*c)/1.15)<1.7){const hs=['Left','Right'].map(s=>{const a=bones[s+'Foot']?bones[s+'Foot'].getWorldPosition(V()):p;return G.standAt(a.x,a.z);});const lo=Math.max(G.standAt(p.x,p.z),...hs);if(lo<f)f=lo;}}
   if(f!=null&&f-(p.y+sq)<.3&&(p.y+sq)-f<.3){H.floorY=f;const d=f-sq-p.y;p.y+=clamp(d*(1-Math.exp(-dt*12)),-.9*dt,1.3*dt);}}
  // ===== MOTION HOOK: motion matching (game/motion.js) writes legs/hips (and the upper body unless an action clip plays) on top of the clip pose, before IK =====
  if(motion){try{motion.post(dt);}catch(e){console.error('motion',e);motion=null;}}
  runSlot('motion',dt);
  if(act&&act.preLeg&&!window.__sqLate){try{act.preLeg(dt);}catch(e){console.error('preLeg',e);}}/* REPAIRS: squatting work lowers the pelvis before the soles are planted */
  sleepTick(dt);faceTick(dt);lidTick(dt);coatTick(dt);
  root.updateMatrixWorld(true);
  // soles on the boards when the body is lifted or lowered (chair, bed edge, uneven boards)
  const g=H.ground&&!H.fit?H.floorY:(H.fit&&!H.inBed&&!H.swing?H.fit.base:null);
  SOLE.seen=0;if(g!=null&&!H.lad){if(H.fit&&H.fit.dangle){legPlantOff();}/* LEISURE: legs hanging over an edge are never planted on the boards (Pavel's screenshot) */else if(H.fit&&H.fit.mode==='hold')legPlant(g,dt,H.bedB?1-H.bedB.W.leg:H.bedC?H.bedC.plant:1);else{legPlantOff();let dy=g-p.y;if(Math.abs(dy)>(H.squat?.5:.3)){if(H.ground&&!H.fit)H.floorY=p.y;dy=0;}if(H.ground&&!H.fit&&!H.squat&&(p.y>2?!window.__noBoardStep:!window.__noRootStep)){legIK(boardDy(g,dt),1);if(!window.__noHeelLift)heelLift();/* a foot lifted onto a root or a higher board under hips that stay: the heel comes up rather than the ankle folding (trip / firewood 45-54 deg) */}else{TF.Left=TF.Right=null;if(Math.abs(dy)>.004){legIK(dy,1);if(dy>.02&&!window.__noHeelLift)heelLift(smooth(.02,.12,dy));}}if(H.ground&&!H.fit&&!window.__noSole)soleLock(g,dt);if((H.squat||0)>.02&&!window.__noHeelLift)heelLift(smooth(.02,.12,H.squat));/* the held sole moved the ankle back under a bent shin (cook crouch: 115 -> 135 deg) */toeGuard(g,dt);}if(!H.inBed&&!H.bedB&&!H.bedC){kneeGuard();if(!loadClear.reg){loadClear.reg=1;lateFn(()=>loadClear(1/60));}/* in the guard stage, on the final pose */}/* BED: lying down the pelvis faces up, so its flat forward is meaningless and the guard flipped the knees (3 rad leg twist) */}
  /* WALK: a sole lock that was not run this frame (seated, perched, on a ladder) is dropped, not kept at its old weight: standing up from the chair both feet jumped 11-13 cm to a stale lock spot */if(!SOLE.seen){for(const k of ['Left','Right']){SOLE[k].w=0;SOLE[k].on=false;}}bedHand();bedLegClear(dt);
  H.bucketTilt=false;/* OUTDOOR: set again by a task that tips a bucket on purpose this frame (grab.js leaves it unplumbed) */
  if(act&&act.post)act.post(dt);if(act&&act.post)soleRe();if(act&&act.fr)fridgePost(act);/* KITCHEN: the hand on the fridge handle / shelf */slungPost();lanternHang();{const G=window.__grab;const f=()=>{try{stowPost(dt);}catch(e){console.error('stow',e);STW=null;}};if(STW&&G&&G.late)G.late(f);else f();}/* GRAB: after collide.js, like the other hand holds */
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
 function resetBody(){H.scootH=0;if(H.scoot){H.scoot=0;try{P3.chairPull(0,.01);}catch(e){}}H.squat=0;H.kSquat=0;kSlow(false);try{undress(false,true);}catch(e){}H.lad=null;H.path=[];H.stk=null;try{dropGearNow();}catch(e){}root.visible=true;for(const h of ['Left','Right']){if(H.hold[h]&&H.hold[h].tool)releaseTool(h);else release(h);}
  if(bookObj&&bookHome&&bookObj.parent!==bookHome.parent){bookHome.parent.add(bookObj);bookObj.position.copy(bookHome.pos);bookObj.quaternion.copy(bookHome.quat);}
  if(H.inBed)bedPress(false);
  Object.assign(H,{path:[],then:null,wait:null,swing:null,bedB:null,edgeHold:null,lad:null,slide:null,once:null,trans:false,seated:null,inBed:false,fit:null,ground:true,v:0,av:0,look:null,lookW:0,pending:null,linger:0,turnStep:false});
  act=null;H.task=null;legPlantOff();}
 function spawn(task,o={}){resetBody();H.squat=0;H.sqJob=false;H.state='idle';H.walkV=0;H.pivot=0;H.onceWalk=0;try{if(motion&&motion.snap)motion.snap();}catch(e){}/* a walk cut off by the spawn: its state, speed and motion matching's easing carried over (gate: 41 cm root dip at the next task's start) *//* a knee bend (GRAB squat, oven) cut short never carries over into the new start: it kept the root 4.5 cm low for a whole task (gate: foot-bend on every walk) */task=task||'read';
  /* GRAB: a fresh start drops what the cut-off task had stowed or slung for a ladder (the water bucket came back into his hand in the next task) */try{const P=PP();for(const n in slung){if(!slung[n])continue;slung[n]=0;const t=P&&P.tools&&P.tools[n];if(t&&t.parent&&t.parent!==bones.RightHand&&t.parent!==bones.LeftHand)try{P.release(n);}catch(e){}}H.stowed=null;H.stowPre=null;STW=null;}catch(e){}
  /* GRAB: a fresh start: a loose thing the cut-off task had in a hand that is not a tool (the splitting round on its way to the block) is set down on the ground under it, not carried on into the next task (gate: 'held' through the shins in every later task) */try{const P=PP();const T=new Set(Object.values((P&&P.tools)||{}));const bx=new THREE.Box3();for(const hb of [bones.LeftHand,bones.RightHand])for(const c of [...hb.children]){if(c.isBone||c.isLight||!c.visible||T.has(c)||!c.isObject3D)continue;let mesh=false;c.traverse(y=>{if(y.isMesh)mesh=true;});if(!mesh)continue;scene.attach(c);c.updateMatrixWorld(true);bx.setFromObject(c);if(!bx.isEmpty()){const f=floorAt(c.position.x,bx.min.y,c.position.z,.2,3);if(f!=null&&isFinite(f))c.position.y+=f-bx.min.y;}if(act&&act.rd===c)act.rd=null;}}catch(e){}
  /* GRAB: a fresh start (a teleport, not a move): the oven and fridge doors a cut-off task left down are shut with it (the hand gate keeps them from closing by themselves) */try{const P=PP();for(const k of ['oven','fridge']){const q=P&&P[k];if(q&&q.open>0){q.openTo&&q.openTo(0);(q.setOpenRaw||q.setOpen)(0);}}}catch(e){}
  if(task==='read'&&!o.walking){const s=N.chair;root.position.set(s.p.x,s.floor,s.p.z);root.rotation.y=s.face;H.face=s.face;H.seated=s;H.node='chair_app';H.task='read';H.ground=false;
   H.fit={mode:'hold',base:s.floor,y:s.seat+SEAT_CLEAR};if(P3&&P3.chairPull){P3.chairPull(-SCOOT/.2,.01);root.position.addScaledVector(fwd(s.face),SCOOT);H.scoot=SCOOT;}play(READ,{fade:0});for(const k in actions){const x=actions[k];if(k!==READ&&x&&x.isRunning&&x.isRunning())x.stop();}/* a teleport: the clip it cut off (idle mid-fade) still weighed 0.6 and pulled the hips 41 cm off the seat for a moment */act=MAKE.read({seated:true});act.name='read';lastAct=['read'];actDur=rnd(25,40);return;}
  if(task==='sleep'&&!o.walking&&N.bedlie){const li=N.bedlie,ed=N.bededge;root.position.set(li.p.x,floorTop(BD),li.p.z);root.rotation.y=0;H.face=0;H.node='bed_app';H.ground=false;H.inBed=true;try{undress(true,true);}catch(e){}
   H.edgeRoot=V(ed.p.x,root.position.y,ed.p.z);H.fit={mode:'hold',base:floorTop(BD),y:li.seat+LIE_CLEAR};play(SLEEPB,{fade:0});H.task='sleep';act=MAKE.sleep({inBed:true});act.name='sleep';
   {const P=window.__props||P3;if(P&&P.quiltFold)P.quiltFold(0);}H.wait={t:.05,then:()=>bedPress(true)};return;}
  const A=ACT[task]||{};let at=typeof A.at==='string'?A.at:null;if(task==='window')at=pick(WINDOWS);
  let from=o.from&&N[o.from]?o.from:at&&N[at]&&!N[at].seat&&!o.walking?at:null;/* o.from: tests start him on a given node */
  if(!from){const keys=Object.keys(N).filter(k=>N[k]&&N[k].p&&N[k].seat==null&&!N[k].tight&&adj[k]&&k!==at);from=pick(keys);}
  if(at&&N[at]&&N[at].seat!=null&&!o.walking)from=at==='chair'?'chair_app':at==='bedlie'?'bed_app':from;
  const P=N[from].p;root.position.set(P.x,P.y,P.z);const f=floorAt(P.x,P.y,P.z,.4);if(f!=null)root.position.y=f;H.floorY=root.position.y;
  root.rotation.y=N[from].face??rnd(-Math.PI,Math.PI);H.face=root.rotation.y;H.node=from;play(IDLE(),{fade:0});startTask(task,o.opts);}
 // default start: reading at the table (a brain can call spawn() for a random start)
 spawn('read');

 return {spawn,openEdge,H,hero:H,qh:QH,bones,actions,play,once,N,E,route,goTo,startTask,update,navCheck,FIT,need,gait,
  setBrain:b=>{brain=b||null;},hasTask:n=>!!MAKE[n],stage,SLOTS,inv:INV,get act(){return act;},setMotion:m=>{motion=m||null;},setClimb:m=>{climb=m||null;if(climb){climb.init({THREE,bones,ik2,turnBone,root,H,actions,play,floorAt,idle:()=>IDLE()||'0'});if(!climb._staged)climb._staged=stage('contacts',dt=>{if(climb&&!window.__noClimb)climb.post(dt);});}},/* CLIMB HOOK: ladders in the contacts slot */root,onTaskEnd:cb=>{endCbs.push(cb);},
  ray:(x,y,z,dx,dy,dz,len)=>{const r=new RAPIER.Ray({x,y,z},{x:dx,y:dy,z:dz});const h=world.castRay(r,len,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});return h?(h.toi??h.timeOfImpact):null;},
  label:()=>H.linger?'':(ACT[H.task]||{}).label||'',node:()=>H.node,walkSpeed:()=>walkSpeed,floorAt,items:{book:bookObj,mug,spoon,plate,pot}};
}
