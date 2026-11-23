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
 if(EYEM)EYEM.castShadow=false;/* perf: no shadow pass for the lids, and drawn only while they are (partly) closed */
 function setLids(k){if(EYEI!=null){EYEM.morphTargetInfluences[EYEI]=k;EYEM.visible=k>.01;return;}if(!LIDS)return;for(const p of LIDS){p.visible=k>.02;p.scale.set(1,Math.max(.02,k),1);}}

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
  kh_b:{p:V(-1.22,LC,3.77)},land:{p:V(-.4,LC,2.85)},gate:{p:V(0,LC,3.35),face:0},wstep:{p:V(1.15,WS,3.15)},
  wmid:{p:V(2.4,WS,3.45)},bench:{p:V(2.55,WS,2.62),face:Math.PI},wwin:{p:V(3.0,WS,3.95),face:0},
  kh_t:{p:V(-1.22,KT,2.75)},kmid:{p:V(-2.5,KT,3.3)},kl_m:{p:V(-3.4,KT,2.65)},stove:{p:V(-3.25,KT,2.42),face:Math.PI},sink:{p:V(-2.3,KT,2.15),face:Math.PI},kwin:{p:V(-3.0,KT,3.45),face:0},kl_b:{p:V(-3.98,KT,2.62)},
  bl_t:{p:V(-3.98,BD,1.95)},bl_m:{p:V(-3.45,BD,2.6)},bmid:{p:V(-2.3,BD,3.05)},bwin:{p:V(-3.6,BD,3.6),face:0},bdoor:{p:V(-.1,BD,2.78)},
  ledge:{p:V(1.25,BD,3.5),face:0},ll_b:{p:V(1.35,BD,3.47)},ll_t:{p:V(1.35,DK,2.7)},deckm:{p:V(1.9,DK,2.5)},deck:{p:V(3.13,DK,2.62),face:0},
 };
 const E=[['kh_b','land'],['land','gate'],['land','wstep'],['wstep','wmid'],['wmid','bench'],['wmid','wwin'],['kh_b','kh_t','ladder'],['kh_t','kmid'],['kmid','stove'],['kmid','sink'],['kmid','kwin'],['kmid','kl_m'],['kl_m','kl_b'],
  ['kl_b','bl_t','ladder'],['bl_t','bl_m'],['bl_m','bmid'],['bmid','bwin'],['bmid','bdoor'],['bdoor','ledge'],['ledge','ll_b'],['ll_b','ll_t','ladder'],['ll_t','deckm'],['deckm','deck']];
 // the rooms can be shifted sideways as a block (lv.XL: left rooms, lv.XR: right rooms); landings at LC stay
 {const XL=lv.XL||0,XR=lv.XR||0;if(XL||XR)for(const k in N){const n=N[k];if(n.p.y<LC+.3)continue;n.p.x+=n.p.x<0?XL:XR;}}
 const LAD={'kh_b>kh_t':{lz:3.45,side:1},'kl_b>bl_t':{lz:2.3,side:1},'ll_b>ll_t':{lz:3.15,side:1,rope:true}};
 // the ground (ground.js __ground.exits.forest): rope ladder from the gate down to the clearing, the path out to the forest edge,
 // a hidden spot out in the fog, and the work spots by the chopping stump and the firewood pile
 {const X=window.__ground&&window.__ground.exits&&window.__ground.exits.forest;if(X&&X.nodes){const ids=['g_foot','g_path1','g_fork','g_exit1','g_exit2','g_edge','g_out'];
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
 function grabTool(name,hand){if(!P3||!P3.grab)return false;{const h=H.hold[hand];if(h&&!(h.tool===name)){if(h.tool)releaseTool(hand);else release(hand);}}/* GRAB: one thing per hand (a spoon left from cooking never stays in the fist with the ladle) */const o=P3.grab(name,bones[hand+'Hand'],{offset:V(0,.075,.025),rot:hand==='Right'?GRIP_R:GRIP_L});if(o){H.hold[hand]={tool:name};return true;}return false;}
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
 function legIK(dy,w){for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
   const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));ik2(U,L,F,a.clone().add(V(0,dy,0)),pole,w,true);}}
 // seated / perched: put each ankle at its standing height above the boards, then lift the toes out of the floor
 // targets and knee direction are low-passed so clip noise and IK flips never reach the feet
 const plantS={};
 // where the pelvis faces (flat): knees point that way, whatever the root yaw or a twisted clip says
 /* which local axis of a bone points the way he faces: measured on the playing clips, -Z for pelvis and head (dot with the walk direction +1.00);
    never guess the sign from the root yaw, a pelvis mid-pivot would flip */
 const BFWD={Hips:V(0,0,-1),Head:V(0,0,-1),Spine2:V(0,0,-1)};
 function hipsFwd(){const q=bones.Hips.getWorldQuaternion(new THREE.Quaternion());const f=BFWD.Hips.clone().applyQuaternion(q);f.y=0;const r=fwd(root.rotation.y);if(f.lengthSq()<1e-3)return r;return f.normalize();}
 function legPlant(g,dt,pw=1){const M=window.__plantMode??2;if(M===0||pw<.01)return;for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V()),k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
   const tgt=V(a.x,g+(POSE.ankle??.1),a.z);let pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));if(pole.lengthSq()<1e-6)pole=fwd(root.rotation.y);pole.normalize().multiplyScalar(.35).add(hipsFwd());pole.normalize();
   if(M===1){ik2(U,L,F,tgt,pole,1,true);continue;}
   let S=plantS[s];if(!S||(pw>=.999&&S.t.distanceTo(tgt)>.3)||!S.on){S=plantS[s]={t:tgt.clone(),p:pole.clone(),on:true};}
   const kk=1-Math.exp(-(dt||1/60)*3);S.t.lerp(tgt,kk);S.p.lerp(pole,kk).normalize();ik2(U,L,F,S.t,S.p,pw,true);}toeGuard(g,dt,pw);}
 // a knee may never bend forward (a clip glitch or an IK pole flip): re-solve that leg with the knee pointing where the pelvis faces
 function kneeGuard(){const hf=hipsFwd();for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;
   const hp=U.getWorldPosition(V()),k=L.getWorldPosition(V()),a=F.getWorldPosition(V());const mid=hp.clone().add(a).multiplyScalar(.5);const off=k.clone().sub(mid);
   // the knee's forward is where that leg's toes point (the pelvis can be turned far from the root mid-turn; a flipped pelvis forward bent good knees backwards)
   const T=bones[s+'ToeBase'];const tf=T?T.getWorldPosition(V()).sub(a):null;if(tf){tf.y=0;}const kf=tf&&tf.lengthSq()>1e-4?tf.normalize():hf;
   const leg=a.clone().sub(hp);if(leg.lengthSq()<1e-4)continue;const ld=leg.clone().normalize();const pf=kf.clone().sub(ld.clone().multiplyScalar(kf.dot(ld)));if(pf.lengthSq()<1e-4)continue;pf.normalize();
   const o=off.clone().sub(ld.clone().multiplyScalar(off.dot(ld)));if(o.length()<.02||o.dot(pf)>-.3*o.length())continue;
   ik2(U,L,F,a,pf.clone().add(o.normalize().multiplyScalar(.15)),1,true);}}
 function legPlantOff(){for(const k in plantS)plantS[k].on=false;}
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
 function lookAt(dt){const Hd=bones.Head,Nk=bones.Neck,Ch=bones.Spine2;if(!Hd||!Nk)return;if(window.__noLookClamp&&!H.look)return;
  const hf=hipsFwd();const hy=Math.atan2(hf.x,hf.z);
  const hq=Hd.getWorldQuaternion(new THREE.Quaternion());const fw=BFWD.Head.clone().applyQuaternion(hq);const hl=rotY(fw,-hy);const ah=Math.atan2(hl.x,hl.z),ap=Math.atan2(-hl.y,Math.hypot(hl.x,hl.z));
  let ty=0,tp=0;const w=H.look?H.lookW:0;
  if(H.look&&w>.01){const hp=Hd.getWorldPosition(V());const d=H.look.clone().sub(hp);const local=rotY(d,-hy);
   const want=clamp(Math.atan2(local.x,local.z),-LOOKMAX,LOOKMAX),wp=clamp(Math.atan2(-d.y,Math.hypot(d.x,d.z)),-.6,.7);ty=(want-ah)*w;tp=(wp-ap)*w;}
  // whatever the result, the final head yaw stays inside the human range
  const fin=ah+ty;if(fin>HEADMAX)ty-=fin-HEADMAX;else if(fin<-HEADMAX)ty+=-HEADMAX-fin;
  const k=1-Math.exp(-dt*4);lookS.yaw=lerp(lookS.yaw,clamp(ty,-1.6,1.6),k);lookS.pitch=lerp(lookS.pitch,clamp(tp,-.7,.7),k);
  if(Math.abs(lookS.yaw)+Math.abs(lookS.pitch)<1e-3){headRoll();return;}
  const _hq=new THREE.Quaternion();
  for(const [b,share] of [[Ch,.25],[Nk,.35],[Hd,.4]]){if(!b)continue;const pw=b.parent.getWorldQuaternion(new THREE.Quaternion());
   // nod about the axis across the face as it is now (after the yaw), so looking down never tips the head sideways
   Hd.getWorldQuaternion(_hq);const hf=BFWD.Head.clone().applyQuaternion(_hq).setY(0);if(hf.lengthSq()<1e-4)hf.copy(fwd(hy));hf.normalize().applyAxisAngle(YAX,lookS.yaw*share);const right=YAX.clone().cross(hf).normalize();
   const q=new THREE.Quaternion().setFromAxisAngle(YAX,lookS.yaw*share).multiply(new THREE.Quaternion().setFromAxisAngle(right,lookS.pitch*(b===Ch?0:share/.75)));
   b.quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw));b.updateMatrixWorld(true);}
  headRoll();}
 // the head never rolls more than a few degrees sideways (an ear toward the shoulder reads as a broken neck)
 const ROLLMAX=.09;function headRoll(){const Hd=bones.Head;if(!Hd)return;const q=Hd.getWorldQuaternion(new THREE.Quaternion());const f=BFWD.Head.clone().applyQuaternion(q);const u=V(0,1,0).applyQuaternion(q);
  const side=f.clone().cross(YAX);if(side.lengthSq()<1e-4)return;side.normalize();const roll=Math.asin(clamp(u.dot(side),-1,1));const ex=roll>ROLLMAX?roll-ROLLMAX:roll<-ROLLMAX?roll+ROLLMAX:0;if(Math.abs(ex)<1e-3)return;
  rotW(Hd,f.normalize(),-ex);}

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
  const vmax=H.walkV*(isLast?(motion?clamp(Math.sqrt(2*1.6*Math.max(0,toT-.03))/H.walkV,0,1):clamp(toT/.42,.35,1)):ladNext?clamp(Math.sqrt(.16+2*1.6*Math.max(0,toT-.32))/H.walkV,0,1):1);const align=smooth(-.55,.75,Math.cos(da));// a person steps out while still turning, not after
  H.v+=clamp(vmax*align-H.v,-3.2*dt,(H.v<.5?3.2:2.4)*dt);
  stuckCheck(dt);
  // turn rate depends on speed: on the spot it takes small steps
  const rate=lerp(4.2,3.8,clamp(H.v/H.walkV,0,1))*(gait.turn||1);
  // turning has inertia: angular speed ramps up and down, so there is never a snap in heading
  const wav=clamp(da*3,-rate,rate);H.av=(H.av||0)+clamp(wav-(H.av||0),-11*dt,11*dt);root.rotation.y+=H.av*dt;H.face=root.rotation.y;
  const px0=p.x,pz0=p.z;const dir=fwd(root.rotation.y);p.x+=dir.x*H.v*dt;p.z+=dir.z*H.v*dt;if(!(N[step.node].tight&&toT<.9)){const q=p.clone();pushOut(q);const m=.6*dt;p.x+=clamp(q.x-p.x,-m,m);p.z+=clamp(q.z-p.z,-m,m);}
  // MOTION HOOK: when a push around furniture slides him sideways, the body turns with the way he is really going (no crab-walk): facing stays within 30 deg of travel
  if(motion&&dt>0){const mx=p.x-px0,mz=p.z-pz0,ms=Math.hypot(mx,mz)/dt;if(ms>.25){const ca=wrapA(Math.atan2(mx,mz)-root.rotation.y),ex=Math.abs(ca)-.52;if(ex>0){const k=1-Math.exp(-dt*10);const r=Math.sign(ca)*Math.min(ex*k,2.6*dt,Math.max(0,4.4-Math.abs(H.av||0))*dt);root.rotation.y+=r;H.face=root.rotation.y;}}}
  const moving=H.v>.06||Math.abs(da)>.25;
  // MOTION HOOK: with motion matching a one-off action clip (stretching, a gesture) keeps playing on the upper body while he walks off
  if(motion&&H.once){}else if(moving){play('30',{fade:.4});actions['30'].timeScale=clamp(Math.max(H.v,Math.abs(da)>.25?.45:0)/walkSpeed,.5,1.75);}else play(H.idleClip||'0',{fade:.5});
  H.state='walk';const rem=Math.hypot(target.x-p.x,target.z-p.z);
  if(rem<(isLast?.09:.32)){H.node=step.node;H.path.shift();if(isLast&&H.v<.5){H.v=0;}}}
 // ladders: walk to the foot, climb, pull up over the edge (root motion), or the same backwards
 // turn on the spot with inertia (angular speed ramps up and down, no snap)
 function turnTo(F,dt){const da=wrapA(F-root.rotation.y);const wav=clamp(da*3.5,-2.6,2.6);H.av=(H.av||0)+clamp(wav-(H.av||0),-7*dt,7*dt);if(Math.abs(da)<.004&&Math.abs(H.av)<.05)H.av=0;root.rotation.y+=H.av*dt;}
 // walk up to the ladder at a normal pace (no creeping), turning to face it on the way; true when in place
 function ladApproach(goal,F,dt){const p=root.position;const dx=goal.x-p.x,dz=goal.z-p.z,d=Math.hypot(dx,dz);turnTo(d>.35&&climb&&!window.__noClimb?Math.atan2(dx,dz):F,dt);/* ladder thread: walk facing the way, turn at the spot (no walking backwards) */const da=Math.abs(wrapA(F-root.rotation.y));
  if(d>.02){const vt=Math.min(Math.max(H.v||0,.35),H.walkV||1)*clamp(d/.25,.4,1);const v=Math.min(vt,(H.v||0)+2.6*dt);H.v=v;const m=Math.min(d,v*dt);p.x+=dx/d*m;p.z+=dz/d*m;play('30',{fade:.25});actions['30'].timeScale=clamp(v/walkSpeed,.6,1.6);}
  else{H.v=0;if(da>.15){play('30',{fade:.25});actions['30'].timeScale=.7;}}
  if(d<.04&&da<.15){p.x=goal.x;p.z=goal.z;return true;}return false;}
 function ladderStep(dt){const step=H.path[0];const key=step.from+'>'+step.node,rkey=step.node+'>'+step.from;const c=LAD[key]||LAD[rkey];const target=N[step.node].p;const p=root.position;
  // a closed hatch on the way: going up, he pushes the lid open with his hand as he climbs (GRAB HOOK, hatchBelow); going down it still just opens
  const shut=!H.lad&&edgeShut(step.from,step.node);
  if(!H.lad){const a=N[step.from].p;const up=target.y>a.y+.01;H.lad={up,phase:up?'mount':'over',x:target.x,yBot:Math.min(a.y,target.y),yTop:Math.max(a.y,target.y)};
   if(shut){const hc=window.__house.hatch;if(up&&hc.lid&&hc.drive)H.lad.hb={st:'wait',w:0,ang:0};else{try{hc.open();window.__audio&&window.__audio.play('hatch_open');}catch(e){}}}}
  const L=H.lad;const cz=c.lz+(.32+(c.rope?.05:0))*c.side;const F=c.side>0?Math.PI:0;H.state='walk';H.ground=false;
  const done=()=>{H.lad=null;H.path.shift();H.node=step.node;H.ground=true;H.v=L.up?.45:0;H.av=0;H.stk=null;const f=floorAt(root.position.x,root.position.y,root.position.z,.2);H.floorY=(f!=null&&Math.abs(f-target.y)<.25)?f:target.y;H.fit=null;};
  // watchdog (QA P0: froze on the rope ladder for minutes): a ladder never takes longer than a slow climb; past that, land on the target
  L.age=(L.age||0)+dt;if(L.age>14+(L.yTop-L.yBot)/.3){p.copy(target);const f0=floorAt(p.x,p.y+.3,p.z,.4);if(f0!=null)p.y=f0;play(IDLE()||'0',{fade:.3});done();return;}
  if(L.phase==='mount'){H.ground=true;if(ladApproach(V(L.x,p.y,cz),F,dt)){L.phase='climb';}}
  // ===== CLIMB HOOK (climb.js, ladder thread): hands and feet on the real rungs =====
  else if(L.phase==='climb'&&climb&&!window.__noClimb&&(L.cl||(L.cl=climb.begin({up:L.up,x:L.x,lz:c.lz,side:c.side,cz,yBot:L.yBot,yTop:L.yTop,}))?1:(L.cl=-1,0))&&L.cl!==-1){
   turnTo(F,dt);if(L.hb)hatchBelow(L.hb,dt);const r=climb.tick(dt);
   if(r==='off'){done();H.v=.12;/* walks off from the slow last step of climbing over (no 0 -> walk jump) */}
   else if(r==='bottom'){play(IDLE()||'0',{fade:.35});done();}}
  else if(L.phase==='over'&&climb&&!window.__noClimb&&!L.start&&L.cl!==-1){// down: walk to the edge, turn the back to the hole, climb down over it (climb.js)
   const P=L.P||(L.P=climb.topStand({x:L.x,lz:c.lz,cz,yTop:L.yTop}));if(!P){L.cl=-1;}
   else{H.ground=true;if(ladApproach(V(P.x,p.y,P.z),F,dt)){if(climb.begin({up:false,fromTop:true,x:L.x,lz:c.lz,side:c.side,cz,yBot:L.yBot,yTop:L.yTop})){L.phase='climb';L.cl=true;}else L.cl=-1;}}}
  // ===== /CLIMB HOOK =====
  else if(L.phase==='climb'){turnTo(F,dt);p.x=L.x;p.z=cz;play('437',{speed:1.3,fade:.3});if(L.hb)hatchBelow(L.hb,dt);const v=.31*1.3*dt;const pull=rmCurve['435']?rmAt('435',99).y:1.4;
   if(L.up){p.y+=v;if(p.y>=L.yTop-pull){p.y=L.yTop-pull;L.phase='finish';once('435',{fade:.3,until:.86,then:()=>{L.phase='stand';}});/* the last ~0.45 s of the pull-up is standing still: step off instead */}}
   else{p.y-=v;if(p.y<=L.yBot){p.y=L.yBot;play('0',{fade:.35});done();}}}
  else if(L.phase==='stand'){H.ground=true;play('0',{fade:.4});done();}
  else if(L.phase==='over'){// down: step back over the edge (the pull-up played backwards)
   const a=actions['435'];const d=a.getClip().duration;const end=rmCurve['435']?rmAt('435',99):V(0,1.4,1.06);
   if(!L.start){const goal=V(L.x,L.yTop,cz).add(rotY(V(end.x,0,end.z),F));H.ground=true;
    if(ladApproach(V(goal.x,p.y,goal.z),F,dt)){L.start=1;if(Math.abs(p.y-L.yTop)<.3)L.yTop=p.y;p.set(goal.x,L.yTop,goal.z);a.reset();a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.timeScale=-1;a.time=d;a.enabled=true;if(H.cur)H.cur.crossFadeTo(a,.3,false);a.play();H.cur=a;}}
   else{root.rotation.y=F;H.face=F;H.av=0;H.slide=null;/* yaw locked while stepping back over the edge (collide: swung 82 deg through the roof) */L.ot=(L.ot||0)+dt;if(H.cur!==a&&a.time>1e-3){a.time=Math.max(0,a.time-dt);}if(a.time<=1e-3||L.ot>d+.6){L.phase='climb';L.start=0;L.ot=0;}}}}

 // GRAB HOOK: the shut floor hatch pushed open from the ladder below: the right palm goes up onto the lid's underside (between the
 // battens, near the free edge), and as he climbs on the lid turns up with the hand (palm stays on it, the lid never moves by itself);
 // once it stands steep he gives it a last shove and it swings over onto its rest. The left hand keeps climbing.
 const HB_PT=V(0,-.03,-.6),HB_REACH=.43;
 function hbPoint(hc,ang,out){const lid=hc.lid;const k=lid.rotation.x;lid.rotation.x=ang;lid.updateMatrixWorld(true);lid.localToWorld(out.copy(HB_PT));lid.rotation.x=k;lid.updateMatrixWorld(true);return out;}
 function hatchBelow(B,dt){const hc=window.__house&&window.__house.hatch;if(!hc||!hc.lid){B.st='done';return;}B.t=(B.t||0)+dt;
  const sh=bones.RightArm.getWorldPosition(V());const c0=hbPoint(hc,hc.angle,V());const d0=sh.distanceTo(c0);
  if(B.st==='wait'){if(d0<HB_REACH+.3){B.st='reach';B.t=0;}return;}
  if(B.st==='reach'){B.w=Math.min(1,B.w+dt/.3);if(d0<=HB_REACH&&B.w>.9){B.st='push';B.t=0;try{window.__audio.play('hatch_open',c0);}catch(e){}}return;}
  if(B.st==='push'){// the steepest lid angle the palm can still reach from where the shoulder is now
   let lo=hc.angle,hi=1.45;if(sh.distanceTo(hbPoint(hc,hi,V()))<=HB_REACH)lo=hi;else for(let i=0;i<12;i++){const m=(lo+hi)/2;if(sh.distanceTo(hbPoint(hc,m,V()))<=HB_REACH)lo=m;else hi=m;}
   const ang=Math.min(lo,hc.angle+2.2*dt);hc.drive(ang);B.ang=ang;if(ang>=1.32){hc.letGo(true);B.st='done';B.t=0;}return;}
  if(B.st==='done'){B.w=Math.max(0,B.w-dt/.3);}}
 function hatchBelowPost(){const B=H.lad&&H.lad.hb;const G=window.__grab;const hc=window.__house&&window.__house.hatch;if(!B||!hc){return;}
  if(B.w>.01){const t=hbPoint(hc,hc.angle,V());reachTo('Right',t,B.w);}
  if(G){if(B.st==='push')G.hold('Right',hc.lid,()=>hbPoint(hc,hc.angle,V()));else G.free(hc.lid);}}
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
 // a hand on a real point: the chest leans toward it when the arm alone can't reach (up to ~25 deg), then two-bone IK puts the palm there
 // bend forward at the hips (the pelvis tips, the feet stay where they stand): for reaching low and far
 function hipHinge(ang){if(ang<.005)return;const fe={};for(const sd of ['Left','Right'])fe[sd]=bones[sd+'Foot'].getWorldPosition(V());
  const f=fwd(root.rotation.y);const ax=V(0,1,0).cross(f).normalize();rotW(bones.Hips,ax,ang);
  const hf=hipsFwd();for(const sd of ['Left','Right']){const U=bones[sd+'UpLeg'],L=bones[sd+'Leg'],Ft=bones[sd+'Foot'];ik2(U,L,Ft,fe[sd],f.clone().add(V(0,.2,0)),1,true);}}
 function reachTo(side,t,w){const sh=bones[side+'Arm'];if(!sh||!t)return;let tot=0;
  for(let it=0;it<3;it++){const hp=bones.Hips.getWorldPosition(V());const s0=sh.getWorldPosition(V());const ex=s0.distanceTo(t)-(armLen*.92+PALM);if(ex<=.01)break;
   const d=V(t.x-hp.x,0,t.z-hp.z);if(d.lengthSq()<1e-4)break;d.normalize();const ax=V(0,1,0).cross(d).normalize();const ang=Math.min(.6-tot,ex*3)*w;if(ang<=.005)break;tot+=ang;
   rotW(bones.Spine,ax,ang*.45);rotW(bones.Spine1,ax,ang*.35);rotW(bones.Spine2,ax,ang*.2);}
  const s1=sh.getWorldPosition(V());const tw=t.clone().sub(s1);const tl=tw.length();const wt=tl>PALM*1.5?s1.clone().addScaledVector(tw,(tl-PALM)/tl):t;/* the palm, not the wrist, on the point */
  armIK(side,wt,sidePole(side),clamp(w,0,1));}
 const PALM=.06;
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
  act=null;H.task=name;actT=0;const A=ACT[name]||{};actDur=A.dur?rnd(A.dur[0],A.dur[1]):8;lastAct.unshift(name);lastAct.length=3;H.look=null;H.lookW=0;
  const mk=MAKE[name];if(!mk)return;act=mk(opts||{});act.name=name;}
 // ===== BRAIN HOOK state: setBrain / gait / onTaskEnd =====
 let brain=null;let motion=null;let climb=null;/* CLIMB HOOK: game/climb.js, see setClimb *//* MOTION HOOK: game/motion.js, see setMotion */const gait={speed:1,turn:1};const endCbs=[];
 function endTask(res){const n=H.task;act=null;H.task=null;H.look=null;H.lookW=0;for(const cb of endCbs){try{cb(n,res);}catch(e){console.error(e);}}}
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
  // open or close the floor hatch BY HAND: stand beside the opening, take the ring, and the lid moves only with the hand.
  // closing: push the standing lid past upright, let go, it drops shut; opening: crouch, take the ring, lift as he stands, flick it open
  hatch:(o={})=>{const a={step:'go',t:0,w:0};const hc=window.__house&&window.__house.hatch;if(!hc){a.update=()=>endTask();return a;}
   const want=o.open!=null?!!o.open:!hc.isOpen();if(want===hc.isOpen()&&!hc.drive){a.update=()=>endTask();return a;}
   if(!hc.drive||!hc.ringAt){/* old house without a hand-driven lid */a.update=dt=>{a.t+=dt;if(a.t>.5){try{want?hc.open():hc.close();}catch(e){}endTask();}};return a;}
   if(want===hc.isOpen()){a.update=()=>endTask();return a;}
   const [x0,x1,,,z0,z1]=hc.box;const r0=hc.ringAt(0,V()),rO=hc.ringAt(hc.OPEN,V());
   const FOOT=x1+.17;/* both feet stay on boards: the near foot is ~12 cm off his centre */const S=want?V(FOOT,lv.BD,r0.z+.12):V(FOOT,lv.BD,rO.z+.12);// beside the opening, on the free side
   const L=hc.ladder||{top:'bl_t',bottom:'kl_b'};const start=N.bl_m?'bl_m':L.top;
   goTo(start,()=>{a.step='app';const p0=root.position;const u=V(S.x-p0.x,0,S.z-p0.z);const ul=u.length()||1;approachTo(a,S.clone().addScaledVector(u,.5/ul),.5,()=>{const p=root.position;const g=hc.grab;H.face=Math.atan2(g.x-p.x,g.z-p.z);a.step=want?'bend':'reach';a.t=0;
     if(want&&has('hy_picklog'))once('hy_picklog',{fade:.35,speed:.75});else if(want&&has('hy_take'))once('hy_take',{fade:.35,speed:.8});/* GRAB: opening, he squats down to the ring (the pick-up clip), takes it and lifts the lid as he rises */});});
   const ringW=()=>hc.grab.clone();
   a.update=dt=>{if(a.step==='approach'){a.t+=dt;if(a.t>=a.adur)a.next();return;}if(a.step==='go'||a.step==='app')return;a.t+=dt;H.look=ringW();H.lookW=1;
    const p=root.position,g=hc.grab;H.face=Math.atan2(g.x-p.x,0)||-Math.PI/2;root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*6);
    {/* he shuffles along the edge with the ring, right shoulder level with it */const tz=clamp(g.z+.12,z0+.05,z1+.45);const m=.5*dt;p.z+=clamp(tz-p.z,-m,m);if(p.x<FOOT)p.x+=Math.min(FOOT-p.x,m);}
    if(a.step==='reach'){a.w=Math.min(1,a.w+dt/.5);if(a.t>.55){a.step='push';a.t=0;AU('hatch_open',g);}}
    else if(a.step==='push'){const G=window.__grab,gd=G?G.dist('Right'):0;/* GRAB HOOK: the lid moves only while the palm is on the ring; once it tips past where the hand can follow, he lets go and it drops */const ang=gd!=null&&gd>.035&&a.t<1.5?hc.angle:Math.max(1.12,hc.angle-dt*1.1);if(gd==null||gd<=.035||a.t>=1.5)hc.drive(ang);if(ang<=1.12||(hc.angle<1.4&&gd!=null&&gd>.03)){hc.letGo(false);a.step='after';a.t=0;}}
    else if(a.step==='bend'){// GRAB HOOK: squat, palm onto the ring, and the lid rises only as far as the hand can carry it (never ahead of it)
     const pk=has('hy_picklog');const d=pk?durOf('hy_picklog')/.75:(has('hy_take')?durOf('hy_take')/.8:1.2);const k=a.t/d;a.w=Math.max(a.w,smooth(.2,.5,k));
     const G=window.__grab,pm=G&&G.palm('Right'),gd=pm?pm.distanceTo(g):0;if(!a.held&&a.w>.9&&(gd<.04||k>1.3)){a.held=true;AU('hatch_open',g);}
     if(a.held){const sh=bones.RightArm.getWorldPosition(V()),R=armLen*.92+PALM,tmp=V();let lo=hc.angle,hi=Math.min(1.8,hc.angle+2.6*dt);
      if(sh.distanceTo(hc.ringAt(hi,tmp))<=R)lo=hi;else for(let i=0;i<10;i++){const m=(lo+hi)/2;if(sh.distanceTo(hc.ringAt(m,tmp))<=R)lo=m;else hi=m;}
      if(lo>hc.angle+1e-4)a.st=0;else a.st=(a.st||0)+dt;hc.drive(lo);
      // up past steep, or he has stood up and the lid stops rising: a last shove and it swings over onto its rest
      if(lo>=1.62||(k>=.95&&a.st>.12)){hc.letGo(true);a.step='after';a.t=0;play(IDLE(),{fade:.4});}}
     else if(k>2){hc.letGo(true);a.step='after';a.t=0;play(IDLE(),{fade:.4});}}
    else if(a.step==='after'){a.w=Math.max(0,a.w-dt/.35);if(a.t>.9){play(IDLE(),{fade:.4});endTask({ok:true,open:want});}}};
   a.post=()=>{if(a.w>.01)reachTo('Right',ringW(),a.w);const G=window.__grab;if(G){if(a.w>.3&&(a.step==='push'||(a.step==='bend'&&(a.held||a.w>.5))||a.step==='reach'))G.hold('Right',hc.lid,ringW);else G.free(hc.lid);}};// GRAB HOOK: the hand on the ring is a grip (collide.js leaves it there)
   a.leave=cb=>{try{window.__grab&&window.__grab.free(hc.lid);}catch(e){}try{if(hc.drive&&a.step!=='after'&&a.step!=='go'&&a.step!=='app')hc.letGo(hc.angle>1);}catch(e){}cb();};
   return a;},
  // a short gesture in place (stretch, look around, scratch the head, inspect); ends by itself
  micro:(o={})=>{const a={step:'do',t:0};const c=o.clip&&has(o.clip)?o.clip:IDLE();const one=['hy_stretch','hy_inspect','hy_take','hy_drink'].includes(c);
   const dur=o.dur||(one?durOf(c):3);if(H.seated){a.update=()=>endTask();return a;}
   if(one)once(c,{fade:.5});else play(c,{fade:.5});
   a.update=dt=>{a.t+=dt;if(o.look){H.look=o.look.clone?o.look.clone():V(o.look.x,o.look.y,o.look.z);H.lookW=.8;}if(a.t>=dur){play(IDLE(),{fade:.6});endTask();}};return a;},
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
      plank.visible=true;plank.position.copy(root.position).addScaledVector(f,.5).setY(bt+.015);plank.rotation.set(0,N.bench.face+rnd(-.2,.2),0);play(IDLE(),{fade:.7});/* GRAB: the swing is all hand IK (hammerPost) */}}
    else if(a.step==='work'){H.face=N.bench.face;a.nail=a.nail||plank.position.clone().addScaledVector(V(-fwd(N.bench.face).z,0,fwd(N.bench.face).x),-.06).add(V(0,.02,0));H.look=a.nail.clone();H.lookW=.9;a.ik=null;}};
   a.post=dt=>{ikList(a.ik);if(a.step==='work'&&a.nail)hammerPost(a,dt,a.nail);};
   a.leave=cb=>{plank.visible=false;if(!H.hold.Right){cb();return;}a.step='putback';a.t=0;play(IDLE(),{fade:.5});a.update=dt=>{a.t+=dt;const hp=hammerHome();H.look=hp;H.lookW=1;
     a.ik=[['Right',hp.clone().add(V(0,.06,0)),smooth(0,.8,a.t)-smooth(1.0,1.6,a.t)]];if(a.t>.85&&H.hold.Right){releaseTool('Right');}if(a.t>1.6){a.ik=null;cb();}};};return a;},
  cook:()=>{const a={step:'go',t:0};goTo('stove',()=>{a.step='oven';a.t=0;pot.visible=true;pot.position.copy(potSpot());pot.rotation.y=rnd(0,6);
    once('hy_oven',{fade:.5,then:()=>{a.step='stir';a.t=0;grab(spoon,'Right',[0,.06,.02],[0,0,-Math.PI/2]);play('hy_stir',{fade:.7});}});});
   const oven=()=>P3&&P3.oven?P3.oven:(ctx.ovenDoor&&ctx.ovenDoor());
   a.update=dt=>{a.t+=dt;H.face=N.stove.face;const ov=oven();
    if(a.step==='oven'){const k=a.t/durOf('hy_oven');const open=smooth(.24,.36,k)-smooth(.6,.72,k);ov&&ov.setOpen&&ov.setOpen(open);
     H.look=root.position.clone().addScaledVector(fwd(H.face),.6).add(V(0,.35,0));H.lookW=.7;
     a.ik=ov&&ov.handle?[['Right',ov.handle(),smooth(.16,.25,k)-smooth(.7,.8,k)]]:null;}
    else if(a.step==='stir'){const pp=pot.position.clone().add(V(0,.1,0));H.look=pp;H.lookW=1;
     a.ik=[['Right',pp.clone().add(V(Math.cos(a.t*3)*.045,.12,Math.sin(a.t*3)*.045)),.75]];}};
   a.post=()=>ikList(a.ik);
   a.leave=cb=>{a.ik=null;const ov=oven();ov&&ov.setOpen&&ov.setOpen(0);if(H.hold.Right){release('Right');spoon.visible=false;}pot.visible=false;cb();};return a;},
  tea:()=>{const a={step:'go',t:0};const hand=POSE.drinkHand||'Right';goTo('sink',()=>{a.step='take';a.t=0;play(IDLE(),{fade:.4});});
   a.update=dt=>{a.t+=dt;if(a.step==='take'){H.face=N.sink.face;H.look=rest.mug.clone();H.lookW=1;a.ik=[[hand,rest.mug.clone().add(V(0,.05,0)),smooth(.1,.8,a.t)-smooth(.9,1.4,a.t)]];
     if(a.t>.85&&!H.hold[hand]){grab(mug,hand,[0,.07,.035],[0,0,hand==='Right'?-Math.PI/2:Math.PI/2]);}if(a.t>1.4){a.step='drink';a.t=0;a.ik=null;a.turn=rnd(-1.1,-.5);}}
    else if(a.step==='drink'){// turn toward the window, sip slowly, rest between sips
     H.face=wrapA(N.sink.face+a.turn);H.look=N.kwin.p.clone().add(V(0,1.5,2));H.lookW=.5;
     if(!a.sip||a.t>a.sip){a.sip=a.t+durOf('hy_drink')+rnd(2,5);once('hy_drink',{fade:.7,then:()=>play(IDLE(),{fade:.8})});}}};
   a.post=()=>ikList(a.ik);
   a.leave=cb=>{if(!H.hold[hand]){cb();return;}a.t=0;a.update=dt=>{a.t+=dt;H.face=N.sink.face;play(IDLE(),{fade:.5});a.ik=[[hand,rest.mug.clone().add(V(0,.05,0)),smooth(0,.7,a.t)-smooth(.9,1.4,a.t)]];
     if(a.t>.75&&H.hold[hand]){release(hand);park(mug,rest.mug);}if(a.t>1.4){a.ik=null;cb();}};};return a;},
  wash:()=>{const a={step:'go'};goTo('sink',()=>{a.step='wash';a.t=0;grab(plate,'Left',[0,.05,.06],[Math.PI/2,0,0]);play('hy_wash',{fade:.7});});
   a.update=dt=>{if(a.step!=='wash')return;a.t+=dt;H.face=N.sink.face;const s=root.position.clone().add(fwd(H.face).multiplyScalar(.45));s.y=kTop-.05;H.look=s;H.lookW=1;};
   a.leave=cb=>{if(H.hold.Left){release('Left');plate.visible=false;}cb();};return a;},
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
 function approachTo(a,sp,stand,then){const p=root.position;const dx=sp.x-p.x,dz=sp.z-p.z,d=Math.hypot(dx,dz)||1e-3;H.face=Math.atan2(dx,dz);
  const move=Math.max(0,Math.min(1.2,d-stand));const q=p.clone().add(V(dx/d*move,0,dz/d*move));pushOut(q);headroom(q,dx/d,dz/d);const dur=Math.max(.3,move/.8,Math.abs(wrapA(H.face-root.rotation.y))/2.4);/* never faster than ~140 deg/s */
  const mv=Math.hypot(q.x-p.x,q.z-p.z);H.slide={x:q.x-p.x,z:q.z-p.z,yaw:wrapA(H.face-root.rotation.y),k:0,d:dur};if(mv>.35){/* a real step over there: face the way he goes, turn to the work at the end (no gliding sideways) */const yT=Math.atan2(q.x-p.x,q.z-p.z);H.slide.y0=root.rotation.y;H.slide.yT=root.rotation.y+wrapA(yT-root.rotation.y);H.slide.yF=H.slide.yT+wrapA(H.face-yT);H.slide.d=Math.max(dur,mv/.8+(Math.abs(wrapA(yT-root.rotation.y))+Math.abs(wrapA(H.face-yT)))/3);}if(move>.08)play('30',{fade:.3,speed:1});
  a.step='approach';a.t=0;a.next=()=>{play(IDLE(),{fade:.4});then();};a.adur=H.slide.d;}
 function job(o){const a={step:'go',t:0,T:0,held:[]};const sp0=typeof o.pt==='function'?o.pt():o.pt;
  if(!sp0&&!o.node){a.update=()=>endTask(false);return a;}
  const sp=()=>(typeof o.pt==='function'?o.pt():o.pt)||(o.node&&N[o.node]?N[o.node].p.clone().addScaledVector(fwd(N[o.node].face??0),.5).add(V(0,1,0)):root.position.clone().add(V(0,1,0)));
  const dur=o.dur?rnd(o.dur[0],o.dur[1]):(o.clip&&!o.loop&&has(o.clip)?durOf(o.clip)*(o.reps||1):8);
  const tools=(o.tools||[]).filter(([n])=>hasTool(n));
  const begin=()=>{a.step=tools.length?'take':'work';a.t=0;o.start&&o.start(a);if(!tools.length)work();};
  const work=()=>{a.step='work';a.t=0;if(o.clip&&has(o.clip)){if(o.loop)play(o.clip,{fade:.5,speed:o.speed||1});else once(o.clip,{fade:.45,speed:o.speed||1,then:()=>{if(a.step==='work'&&a.T<dur-1)play(o.idle&&has(o.idle)?o.idle:IDLE(),{fade:.5});}});}else play(IDLE(),{fade:.5});};
  const seatOf=()=>typeof o.seat==='function'?o.seat():o.seat;
  if(o.anchor==='sit'&&seatOf()){const st=seatOf();const goSit=()=>{a.step='sit';sitDown(st,()=>{a.seated=st;begin();});};
   const nn=o.seatNode||st.node||nearNode(st.p.clone().setY(st.floor??st.p.y).add(V(0,.1,0)));if(nn)goTo(nn,goSit);else goSit();}
  else go0();
  function go0(){go();}
  function go(){const s=sp();if(o.node){goTo(o.node,()=>{if(o.slide===false){H.face=N[o.node].face??H.face;begin();}else approachTo(a,s,o.stand??.45,begin);});}
   else{const nn=nearNode(s);if(nn)goTo(nn,()=>approachTo(a,s,o.stand??.45,begin));else approachTo(a,s,o.stand??.45,begin);}}
  a.update=dt=>{a.t+=dt;const s=sp();
   if(a.step==='approach'){H.look=s;H.lookW=.6;if(a.t>=a.adur){a.next();}return;}
   if(a.step==='take'){// reach each tool's home and close the hand on it
    // GRAB HOOK: the palm goes onto the tool where it hangs; the tool leaves its hook only when the palm is on it, then the hand comes back
    const [n,hand]=tools[a.held.length]||[];if(!n){work();return;}const h=gripHome(n)||s;H.look=h;H.lookW=1;const pd=palmTo(hand,h);
    if(!a.gotIt){a.rw=Math.min(1,(a.rw||0)+dt/.4);a.reach=[hand,h,a.rw];if((a.rw>=1&&pd<.03)||a.t>1.6){a.gotIt=true;a.tg=a.t;grabTool(n,hand);AU('cloth');}}
    else{a.rw=Math.max(0,a.rw-dt/.4);a.reach=a.rw>0?[hand,h,a.rw]:null;if(a.rw<=0){a.held.push(n);a.gotIt=false;a.t=0;a.reach=null;a.rw=0;if(a.held.length>=tools.length)work();}}return;}
   if(a.step==='work'){a.T+=dt;H.look=o.look?o.look(a):s;H.lookW=o.lookW??.85;o.tick&&o.tick(a,dt);
    if(o.beats){a.bi=a.bi||0;while(a.bi<o.beats.length&&a.T>=o.beats[a.bi].at){try{o.beats[a.bi].do(a);}catch(e){console.error('beat',e);}a.bi++;}}
    if(o.anchor==='squat'){const d=o.squat??.35;H.squat=d*smooth(0,.8,a.T)*(1-smooth(dur-.9,dur,a.T));}
    // small variations so a long job is never a frozen loop: pause and look round, scratch, stretch, sigh
    if(o.vary!==false&&dur>14){a.vt=(a.vt??rnd(9,16))-dt;if(a.vt<=0&&!a.pause){a.vt=rnd(10,18);const r=Math.random();
      if(r<.45){a.pause=rnd(2.5,4.5);a.pl=root.position.clone().add(V(rnd(-3,3),rnd(1.2,1.8),rnd(-3,3)));play(IDLE(),{fade:.6});}
      else if(r<.65&&has('hy_scratch'))overlay('hy_scratch',{fade:.4,speed:1.2});else if(r<.8&&has('hy_stretch'))overlay('hy_stretch',{fade:.5,speed:1.15,weight:.7});else AU('sigh',root.position);}
     if(a.pause){a.pause-=dt;H.look=a.pl;H.lookW=.7;if(a.pause<=0){a.pause=0;if(o.clip&&o.loop&&has(o.clip))play(o.clip,{fade:.6,speed:o.speed||1});else if(o.clip&&has(o.clip))once(o.clip,{fade:.45,speed:o.speed||1});}}}
    if(!o.loop&&o.clip&&o.reps&&!H.once&&!a.pause&&a.T<dur-1)once(o.clip,{fade:.4,speed:o.speed||1});
    if(a.T>=dur){a.step='put';a.t=0;o.end&&o.end(a);play(IDLE(),{fade:.5});}return;}
   if(a.step==='put'){const n=a.held[a.held.length-1];if(!n){finish();return;}const hand=(tools.find(t=>t[0]===n)||[])[1]||'Right';const h=toolHome(n)||s;H.look=h;H.lookW=1;
    // GRAB HOOK: carried to the hook in the hand, let go only once the palm is there (a short settle, no flying home), then the hand leaves
    const h2=gripHome(n)||h;const pd=palmTo(hand,h2);a.hp=h2;if(!a.rel){a.rw=Math.min(1,(a.rw||0)+dt/.4);a.reach=[hand,h2,a.rw];if((a.rw>=1&&pd<.03)||a.t>1.6){a.rel=true;a.trel=a.t;relTool(hand,n,.14);}}
    else if(a.t-a.trel>.16){a.rw=Math.max(0,a.rw-dt/.4);a.reach=a.rw>0?[hand,h2,a.rw]:null;if(a.rw<=0){a.held.pop();a.rel=false;a.t=0;a.reach=null;a.rw=0;}}}};
  const finish=()=>{a.ik=null;H.squat=0;if(a.seated&&!a.rising){a.rising=true;standUp(a.seated,()=>{a.seated=null;finish();});return;}if(a.rising&&a.seated)return;
   if(a.leaveCb){const c=a.leaveCb;a.leaveCb=null;c();return;}endTask(o.result?o.result(a):undefined);};
  a.post=dt=>{if(a.stirHold&&a.step!=='work'){a.stirHold=0;try{window.__grab.free('Left');window.__grab.free('Right');}catch(e){}}if(a.step==='work'&&o.post)o.post(a,dt);
   // declared contacts (HERO-RULES 2): a hand on a real point for a window of the work, blended in and out
   if(a.step==='work'&&o.contacts)for(const c of o.contacts){const t0=c.from??0,t1=c.to??dur,bl=c.blend??.4;const w=(c.w??1)*smooth(t0,t0+bl,a.T)*(1-smooth(t1-bl,t1,a.T));if(w<.01)continue;const at=typeof c.at==='function'?c.at(a):c.at;if(at)reachGrip(c.hand||'Right',at,w);}ikList(a.ik);if(a.reach&&a.reach[2]>.01)reachGrip(a.reach[0],a.reach[1],a.reach[2]);};
  // GRAB HOOK: called away in the middle of a job, he first hangs the tools back by hand (no tool flies home by itself)
  a.leave=cb=>{if(a.step==='take'&&a.gotIt){const [n]=tools[a.held.length]||[];if(n)a.held.push(n);a.gotIt=false;}
   if(a.held.length&&!window.__noGripFix&&(a.step==='work'||a.step==='take')){o.end&&o.end(a);a.step='put';a.t=0;a.rw=0;a.rel=false;a.reach=null;a.ik=null;a.leaveCb=cb;play(IDLE(),{fade:.4});return;}
   for(const n of a.held){const t=tools.find(x=>x[0]===n);relTool(t?t[1]:'Right',n);}a.held=[];if(a.step==='work'||a.step==='take')o.end&&o.end(a);a.ik=null;H.squat=0;if(a.seated){const st=a.seated;a.seated=null;standUp(st,cb);return;}cb();};
  return a;}
 // GRAB HOOK: how far the palm is from a point (m)
 function palmTo(side,t){const G=window.__grab;const p=G&&G.gripPoint?G.gripPoint(side):bones[side+'Hand'].getWorldPosition(V());return p&&t?p.distanceTo(t):9;}
 const gripHome=n=>{const G=window.__grab;return G&&G.toolGripHome?G.toolGripHome(n):toolHome(n);};
 function reachGrip(side,t,w){const G=window.__grab;if(!G||!G.gripPoint){reachTo(side,t,w);return;}reachTo(side,G.palmTarget(side,t),w);
  /* the fist's grip point, not the wrist, onto the point: a few corrections of the wrist target */if(w>.98)for(let i=0;i<3;i++){const e=t.clone().sub(G.gripPoint(side));if(e.length()<.004)break;armIK(side,bones[side+'Hand'].getWorldPosition(V()).add(e),sidePole(side),1);}}
 // GRAB HOOK: aim a held tool: turn the hand round the fist so the tool's working end points at tip (the grip stays put)
 function aimTool(side,name,tip,w){const G=window.__grab;const P=PP();const o=P&&P.tools&&P.tools[name];const sp=G&&G.GRIP&&G.GRIP[name];if(!o||!sp||o.parent!==bones[side+'Hand'])return;
  for(let i=0;i<2;i++){const gw=o.localToWorld(V(...sp.g));const ew=o.localToWorld(V(...sp.g).add(V(...sp.a)));const cur=ew.sub(gw).normalize(),want=tip.clone().sub(gw).normalize();
   const q=new THREE.Quaternion().setFromUnitVectors(cur,want);if(w<1)q.slerp(new THREE.Quaternion(),1-w);const hb=bones[side+'Hand'];const hq=hb.getWorldQuaternion(new THREE.Quaternion());const pq=hb.parent.getWorldQuaternion(new THREE.Quaternion());
   hb.quaternion.copy(pq.invert().multiply(q.multiply(hq)));hb.updateMatrixWorld(true);
   for(let k=0;k<3;k++){const e=gw.clone().sub(G.gripPoint(side));if(e.length()<.003)break;armIK(side,hb.getWorldPosition(V()).add(e),sidePole(side),1);}}}/* the fist back on its spot: wrist moves only, no new lean */
 // GRAB HOOK: put a held tool exactly: its grip point at gp, its working end toward tip. The hand's world rotation is solved first
 // (tool axis on the line gp->tip, knuckles along the forearm), then the wrist goes where that puts the fist on gp, then the arm IK.
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
 // hammering for real: the hammer swings up round the elbow and comes down so its face lands square on the nail (the hit, its
 // sound and the nail sinking all happen on that frame), the other hand steadies the work beside the nail
 const HFACE=[.102,.146,0];
 function hammerPost(a,dt,nail,nrm){a.nail=a.nail||nail;const P=PP();const hm=P&&P.tools&&P.tools.benchHammer;if(!hm||hm.parent!==bones.RightHand||!nail)return;
  if(bones.RightArm.getWorldPosition(V()).distanceTo(nail)>armLen+.38){a.hmFar=true;return;}a.hmFar=false;/* out of reach from this pose (a kneeling or roof clip): the clip swings, the timer sounds */
  const S=a.hm||(a.hm={ph:Math.random()*.3,w:0,n:0,T:rnd(.72,.9)});S.w=Math.min(1,S.w+dt/.5);S.ph+=dt;if(S.ph>S.T){S.ph-=S.T;S.T=rnd(.72,.9);S.hit=0;S.n++;if(S.n%6===5)S.ph-=rnd(.6,1.1);/* now and then a breath / a look between blows */}
  H.noPop={side:'Right',age:0};/* a hammer blow is meant to be sharp: keep the anti-pop pass off this arm */
  const u=S.ph/S.T;const TH=.9;let th=u<0?0:u<.5?TH*smooth(0,.5,u):u<.6?TH:u<.7?TH*(1-Math.pow((u-.6)/.1,2)):0;
  const sh=bones.RightArm.getWorldPosition(V());const up=nrm?nrm.clone().normalize():V(0,1,0);/* surface normal: up for a bench, board or rail, out of the wall for a wall */
  const d=nail.clone().sub(sh);d.addScaledVector(up,-d.dot(up));if(d.lengthSq()<1e-4)d.set(0,1,0);d.normalize();const k=d.clone().cross(up).normalize();
  const W0=d.clone(),B0=up.clone().negate();const R=new THREE.Quaternion().setFromAxisAngle(k,th);const W=W0.clone().applyQuaternion(R),Bw=B0.clone().applyQuaternion(R);
  // strike pose: face on the nail; the swing pivots about a point a forearm behind the grip
  const sc=hm.getWorldScale(V()).x;const Qt=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(W0,B0,W0.clone().cross(B0)).multiply(new THREE.Matrix4().makeBasis(V(0,1,0),V(1,0,0),V(0,1,0).cross(V(1,0,0))).transpose()));
  const Fw=V(...HFACE).multiplyScalar(sc).applyQuaternion(Qt);const O=nail.clone().sub(Fw);const G0=O.clone().add(V(0,-.085,0).multiplyScalar(sc).applyQuaternion(Qt));
  const piv=G0.clone().addScaledVector(d,-.22).add(V(0,-.04,0));const G=piv.clone().add(G0.clone().sub(piv).applyQuaternion(R));
  // the other hand steadies the work a hand's width left of the nail, on the near side (first: it may lean the body)
  {const ls=bones.LeftArm.getWorldPosition(V());let lp=nail.clone().addScaledVector(k,-.12).addScaledVector(d,-.08).addScaledVector(up,.01);const r=armLen*.9+PALM;if(ls.distanceTo(lp)>r){/* no leaning over for it: the hand settles on the plank where it reaches */const q=lp.clone().sub(ls);const h=Math.sqrt(Math.max(0,r*r-q.y*q.y));const hz=V(q.x,0,q.z);if(hz.length()>h)hz.setLength(h);lp=ls.clone().add(hz).setY(lp.y);}reachGrip('Left',lp,S.w*.9);}
  const tip=G.clone().add(W);if(sh.distanceTo(G)>armLen*.95+.12)reachTo('Right',G,S.w);holdToolAt('Right','benchHammer',G,tip,S.w,Bw);
  {const G2=window.__grab,w=S.w;if(G2&&G2.late)G2.late(()=>holdToolAt('Right','benchHammer',G,tip,w,Bw));}
  if(u>=.7&&!S.hit&&S.w>.9){S.hit=1;try{window.__audio&&window.__audio.contact?window.__audio.contact({tool:'hammer',kind:'hit',pos:nail.toArray(),strength:rnd(.7,1)}):(sfx&&sfx.hammer&&sfx.hammer());}catch(e){}}
}
 // stirring: the ladle's bowl goes round in the soup, the fist above the rim, the other hand steadies the pot by its handle
 function stirPost(a,dt){const P=PP();const pot=P&&P.tools&&P.tools.pot,la=P&&P.tools&&P.tools.ladle;if(!pot||!la||la.parent!==bones.RightHand)return;
  a.sw=Math.min(1,(a.sw||0)+dt/.6);a.sa=(a.sa||0)+dt*4.6;pot.updateMatrixWorld(true);const c=pot.localToWorld(V(0,.07,0));const sh=bones.RightArm.getWorldPosition(V());
  const toMe=V(sh.x-c.x,0,sh.z-c.z).normalize();const B=c.clone().add(V(Math.cos(a.sa)*.045,0,Math.sin(a.sa)*.045));// the bowl in the soup
  // the handle leans toward him; pick the lean (and a little to his right) that keeps the fist a comfortable ~0.42 m from the shoulder
  const L=.29;const rt=V(-toMe.z,0,toMe.x);let Gp=null,bd=9;for(const el of [1.35,1.2,1.05,.9,.75])for(const sd of [0,.35,-.2]){const dir=toMe.clone().multiplyScalar(Math.cos(el)).addScaledVector(rt,sd*Math.cos(el)).add(V(0,Math.sin(el),0)).normalize();
   const g=B.clone().addScaledVector(dir,L);const e=Math.abs(g.distanceTo(sh)-.42)+(sd?.02:0);if(e<bd){bd=e;Gp=g;}}
  a.gs=a.gs?a.gs.lerp(Gp,1-Math.exp(-dt*10)):Gp.clone();Gp=a.gs;
  const G=window.__grab;if(G){G.hold('Right',pot.parent||pot,null);G.hold('Left',pot.parent||pot,null);a.stirHold=1;}/* the stove and pot are what his hands work at: collide.js leaves them there */
  {const sh2=bones.RightArm.getWorldPosition(V());if(sh2.distanceTo(Gp)>armLen*.95+.1)reachTo('Right',Gp,a.sw);}/* lean in only if the pot is far */holdToolAt('Right','ladle',Gp,B,a.sw);a.dbg=[Gp,B];{const G2=window.__grab,sw=a.sw;if(G2&&G2.late)G2.late(()=>holdToolAt('Right','ladle',Gp,B,sw));}
  // left hand on the pot handle nearer his left
  const hs=[pot.localToWorld(V(-.1,.09,0)),pot.localToWorld(V(.1,.09,0))];const ls=bones.LeftArm.getWorldPosition(V());const lh=hs[0].distanceTo(ls)<hs[1].distanceTo(ls)?hs[0]:hs[1];
  if(lh.distanceTo(ls)<armLen+PALM+.12)reachGrip('Left',lh,a.sw*.95);
  // a scrape each half turn (Sound): the bowl along the pot side
  const half=Math.floor(a.sa/Math.PI);if(half!==a.sh){a.sh=half;try{window.__audio&&window.__audio.contact&&window.__audio.contact({tool:'spoon',kind:'scrape',pos:B.toArray(),strength:.45,dur:Math.PI/4.6});}catch(e){}}}
 function relTool(hand,n,bl=.35){const P=window.__props||P3;try{if(P&&P.release)P.release(n,{blend:bl});}catch(e){}if(H.hold[hand]&&H.hold[hand].tool===n)H.hold[hand]=null;}
 const telePt=()=>{const P=window.__props||P3;const t=P&&P.placed&&P.placed.telescope;if(t&&t.position)return t.position.clone().add(V(0,1.35,0));return V(3.5,DK+1.35,1.3);};
 // the edge of the platform in front of a node: step forward until the boards end
 function edgeFrom(node){const n=N[node];if(!n)return null;const f=fwd(n.face??0);const p=n.p.clone();let last=null;
  for(let d=.1;d<2.5;d+=.05){const q=p.clone().addScaledVector(f,d);const y=floorAt(q.x,p.y+.2,q.z,.3,.6);if(y==null||Math.abs(y-p.y)>.15){return last?{p:last,f,y:p.y}:null;}last=q;}return null;}
 // POSE: an open edge to sit on with the legs hanging: walk out from each node in 10-degree steps until the boards end
 // (small gaps between planks are crossed), then demand: nothing solid (railing, post, beam, roof) in front of the shins
 // or under the dangling feet, nothing behind the back at hip height, and the same along 30 cm either side (room for the thighs)
 function openEdge(nodes){const C=window.__collide;if(!C||!C.depthAt)return null;let best=null;
  const solid=(x,y,z)=>C.depthAt(x,y,z)>.005;
  for(const k of nodes){const n=N[k];if(!n)continue;for(let a=0;a<36;a++){const yaw=a*Math.PI/18;const f=fwd(yaw);let last=null,miss=0;
    for(let d=.1;d<3.5;d+=.03){const x=n.p.x+f.x*d,z=n.p.z+f.z*d;const y=floorAt(x,n.p.y+.2,z,.3,.6);if(y==null||Math.abs(y-n.p.y)>.15){if(++miss>=6)break;continue;}miss=0;last=V(x,n.p.y,z);}
    if(!last)continue;let bad=0;const r=V(-f.z,0,f.x);
    // not next to a ladder that comes up over this edge
    for(const kk in LAD){const [lo,hi]=kk.split('>');const top=N[lo]&&N[hi]?(N[lo].p.y>N[hi].p.y?N[lo]:N[hi]):null;if(!top||Math.abs(top.p.y-n.p.y)>.3)continue;const L=LAD[kk];if(Math.hypot(last.x-top.p.x,last.z-L.lz)<1.0)bad++;}
    for(const sd of [-.3,-.15,0,.15,.3]){const b=last.clone().addScaledVector(r,sd);
     for(const o of [.06,.2,.35,.5])for(const h of [-.75,-.5,-.3,-.1,.15,.4])if(solid(b.x+f.x*o,n.p.y+h,b.z+f.z*o))bad++;
     for(const o of [.15,.35])if(floorAt(b.x+f.x*o,n.p.y-.05,b.z+f.z*o,.02,1.1)!=null)bad++;// a roof or landing right under the feet
     for(const o of [-.35,-.15])for(const h of [.15,.4,.7])if(solid(b.x+f.x*o,n.p.y+h,b.z+f.z*o))bad++;
     if(sd===0&&floorAt(b.x-f.x*.1,n.p.y+.2,b.z-f.z*.1,.3,.3)==null&&floorAt(b.x-f.x*.2,n.p.y+.2,b.z-f.z*.2,.3,.3)==null)bad++;}
    if(bad>0)continue;const d0=Math.hypot(last.x-n.p.x,last.z-n.p.z);const sc=d0+(k==='deck'?0:.4);if(!best||sc<best.sc)best={node:k,p:last,f,y:floorAt(last.x,n.p.y+.2,last.z-0,.3,.6)??n.p.y,sc};}}
  return best;}
 Object.assign(MAKE,{
  // kitchen
  chop:(o)=>job({pt:()=>PT('board'),stand:.42,clip:'hy_chop',loop:true,dur:[22,40],tools:[['knife','Right']],tick:(a,dt)=>{a.ct=(a.ct||0)+dt;if(a.ct>.45){a.ct=0;AU('chop',PT('board'));}}}),
  pot:(o)=>job({pt:()=>PT('pot')||PT('pan'),stand:.45,/* GRAB: the stirring arm is all hand IK (stirPost), the body stands calm instead of the clip's big sway */loop:true,dur:[25,45],tools:[['ladle','Right']],vary:false,post:(a,dt)=>stirPost(a,dt)}),
  stoke:(o)=>{// a log from the woodpile into the oven: crouch, pick it up, carry it over, open the little door, in, shut
   const a={step:'go',t:0};const wp=PT('woodpile'),ovp=PT('oven');if(!wp||!ovp){a.update=()=>endTask(false);return a;}
   const P=window.__props||P3;const toOven=()=>{const nn=nearNode(ovp)||'stove';goTo(nn,()=>approachTo(a,ovp,.68,()=>{a.step='stoke';a.t=0;once('hy_stoke',{fade:.4,then:()=>{play(IDLE(),{fade:.5});endTask();}});}));};
   const nn=nearNode(wp)||'kmid';goTo(nn,()=>approachTo(a,wp,.5,()=>{a.step='pick';AU('grunt');once('hy_picklog',{fade:.4,then:()=>{try{P.grab('logArmful',bones.RightHand,{offset:V(0,.08,.06)});a.log=1;}catch(e){}
     try{P.woodpile&&P.woodpile.setCount&&P.woodpile.setCount(Math.max(0,(P.woodpile.count||1)-1));}catch(e){}a.step='carry';toOven();}});}));
   a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    if(a.step==='stoke'){const ov=P&&P.oven;const k=a.t/Math.max(.5,durOf('hy_stoke'));H.look=ovp;H.lookW=1;if(ov&&ov.setOpen)ov.setOpen(smooth(.12,.28,k)-smooth(.72,.86,k));
     if(k>.5&&a.log){a.log=0;try{P.release('logArmful');}catch(e){}AU('stoke',ovp);}}};
   a.leave=cb=>{if(a.log)try{P.release('logArmful');}catch(e){}try{P.oven&&P.oven.setOpen&&P.oven.setOpen(0);}catch(e){}cb();};return a;},
  dishes:(o)=>job({pt:()=>PT('sink'),stand:.42,clip:'hy_wash',loop:true,dur:[16,30],
   start:a=>{const P=window.__props||P3;try{P.water&&P.water.tap&&P.water.tap(true);}catch(e){}},
   tick:(a,dt)=>{a.wt=(a.wt||0)+dt;if(a.wt>3.2){a.wt=0;const P=window.__props||P3;try{if(P.dishes&&P.dishes.wash()===-1){a.T=Math.max(a.T,999);}}catch(e){}}},
   end:a=>{const P=window.__props||P3;try{P.water&&P.water.tap&&P.water.tap(false);if(P.dishes){for(let i=0;i<4;i++)P.dishes.putAway();}}catch(e){}}}),
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
  diary:(o)=>{// sit at the table, open the diary, write, pause to think, write on
   const a={step:'go',t:0,T:0};const dur=rnd(30,60);const P=window.__props||P3;
   goTo('chair_app',()=>{a.step='sit';sitDown(N.chair,()=>{a.step='take';a.t=0;play(SITIDLE,{fade:.8});});});
   a.update=dt=>{a.t+=dt;const dp=toolHome('diary');
    if(a.step==='take'){H.look=dp;H.lookW=1;a.ik=dp?[['Right',dp,smooth(0,.5,a.t)*(1-smooth(.7,1,a.t))]]:null;if(a.t>.55&&!a.got){a.got=1;grabTool('pencil','Right');}if(a.t>1.1){a.ik=null;a.step='write';a.t=0;play(has('hy_diary')?'hy_diary':SITIDLE,{fade:.8});}}
    else if(a.step==='write'){a.T+=dt;H.look=dp;H.lookW=.9;if(a.T>dur){a.step='put';a.t=0;play(SITIDLE,{fade:.7});}}
    else if(a.step==='put'){a.ik=dp?[['Right',dp,smooth(0,.5,a.t)*(1-smooth(.7,1,a.t))]]:null;if(a.t>.55&&a.got){a.got=0;relTool('Right','pencil');}if(a.t>1.1){a.ik=null;a.step='up';standUp(N.chair,()=>endTask());}}};
   a.post=()=>ikList(a.ik);
   a.leave=cb=>{if(a.got)relTool('Right','pencil');a.ik=null;if(a.step==='go'){cb();return;}standUp(N.chair,cb);};return a;},
  sweep:(o)=>job({pt:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),1).add(V(0,.1,0)),stand:.9,clip:'hy_sweep',loop:true,dur:[15,28],tools:[['broom','Right']],
   tick:(a,dt)=>{// shuffles slowly across the floor while sweeping, turning back at walls
    if(a.pause)return;const p=root.position;const f=fwd(root.rotation.y);const q=p.clone().addScaledVector(f,.25);pushOut(q);const y=floorAt(q.x,p.y+.2,q.z,.3,.5);
    if(y==null||Math.abs(y-p.y)>.1||q.distanceTo(p.clone().addScaledVector(f,.25))>.02){root.rotation.y+=Math.PI*.6*dt;H.face=root.rotation.y;}else{p.addScaledVector(f,.22*dt);}
    a.ct=(a.ct||0)+dt;if(a.ct>1.2){a.ct=0;AU('sweep',p);}},look:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),.8)}),
  water:(o)=>job({pt:()=>PT('plant'),stand:.45,clip:'hy_water',dur:[5,6],tools:[['wateringCan','Right']]}),
  listen:(o)=>{const wn=pick(WINDOWS.filter(w=>Math.abs(N[w].p.y-root.position.y)<1.5))||pick(WINDOWS);return job({node:wn,slide:false,clip:'hy_listen',dur:[12,22],reps:2,look:a=>root.position.clone().add(V(Math.sin(a.T*.35)*2.5,1.55,0)).addScaledVector(fwd(N[wn].face??0),5)});},
  bolt:(o)=>{const P=window.__props||P3;const D=P&&P.door;return job({pt:()=>D&&D.boltKnob?D.boltKnob(V()):null,stand:.42,clip:'hy_bolt',dur:[3.2,3.6],
   start:()=>{try{D.openTo&&D.openTo(0,.8);}catch(e){}},tick:a=>{if(a.T>1.6&&!a.done){a.done=1;try{D.boltTo&&D.boltTo(o&&o.lock===false?0:1,.3);}catch(e){}AU('bolt',D.boltKnob(V()));}}});},
  radio:(o)=>{const P=window.__props||P3;const R=P&&P.radio;return job({pt:()=>PT('radio'),stand:.45,clip:'hy_radio',loop:true,dur:[30,60],
   start:()=>{try{R.setOn(1);}catch(e){}},tick:(a,dt)=>{try{if(a.T<6)R.setTune(.3+.4*smooth(0,6,a.T));}catch(e){}},end:()=>{try{if(!(o&&o.keepOn))R.setOn(0);}catch(e){}}});},
  telescope:(o)=>job({pt:telePt,stand:.5,clip:'hy_telescope',loop:true,dur:[40,90],start:()=>AU('sigh')}),
  look:(o)=>job({node:'deck',slide:false,clip:has('hy_listen')?null:null,dur:[40,80],look:a=>root.position.clone().add(V(Math.sin(a.T*.22)*6,1.2+Math.sin(a.T*.13)*.6,8))}),
  ledge:(o)=>{// sit on an OPEN edge (no railing, a free drop under it) with the legs hanging over it: the round landing by the gate
   // ladder (the deck has railings all round and its one gap is cramped under the bedroom eave and by the rope ladder)
   // POSE: Pavel 2026-11-23: he sat inside the railing with his legs splayed through the balusters. The spot is now searched
   // for: no railing / post / beam in front of the shins or under the dangling feet, and his legs are never planted on the boards.
   const e0=openEdge(['land','gate']);const node=e0?e0.node:'land';const a={step:'go',t:0,T:0};const dur=rnd(40,90);
   if(!e0){a.update=()=>endTask(false);return a;}
   goTo(node,()=>{const e=e0;a.e=e;const yaw=Math.atan2(e.f.x,e.f.z);
    const tgt=e.p.clone().addScaledVector(e.f,-.12);approachTo(a,V(tgt.x,0,tgt.z).addScaledVector(e.f,.5),.5,()=>{a.step='sit';a.t=0;H.face=yaw;a.hy0=bones.Hips.getWorldPosition(V()).y;
     H.fit={mode:'hold',base:e.y,y:a.hy0,dangle:true};H.ground=false;play('hy_dangle',{fade:1.2});AU('sigh');});});
   a.update=dt=>{a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return;}
    if(a.step==='sit'){const k=smooth(0,1.3,a.t);H.fit.y=lerp(a.hy0,a.e.y+SEAT_CLEAR,k);if(a.t>1.3){a.step='work';a.t=0;}return;}
    if(a.step==='work'){a.T+=dt;H.look=root.position.clone().add(V(Math.sin(a.T*.2)*5,.4+Math.sin(a.T*.11)*.5,0)).addScaledVector(a.e.f,6);H.lookW=.8;
     if(a.T>dur){a.step='up';a.t=0;play(IDLE(),{fade:1.2});}return;}
    if(a.step==='up'){const k=smooth(0,1.3,a.t);H.fit.y=lerp(a.e.y+SEAT_CLEAR,a.hy0,k);if(a.t>1.3){H.fit=null;H.ground=true;H.floorY=a.e.y;endTask();}}};
   a.leave=cb=>{if(a.step==='sit'||a.step==='work'){a.step='up';a.t=0;play(IDLE(),{fade:1});const f=a.update;a.update=dt=>{f(dt);};const wait=()=>{if(H.fit&&a.step==='up'&&a.t<1.3){setTimeout(wait,100);}else{H.fit=null;H.ground=true;cb();}};wait();}else cb();};
   return a;},
  firewood:(o)=>{const X=window.__ground&&window.__ground.exits&&window.__ground.exits.forest;if(!X||!N.g_wood)return job({pt:()=>PT('woodpile'),stand:.5,clip:'hy_picklog',dur:[2,3]});
   const a={step:'go'};goTo('g_wood',()=>{H.face=N.g_wood.face;a.step='pick';reps('hy_picklog',4+(Math.random()<.5?1:0),()=>{try{(window.__props||P3).grab('logArmful',bones.LeftHand,{offset:V(.1,.12,.1)});}catch(e){}try{window.__audio.carry(true);}catch(e){}
     H.carry='hy_carrylogs';const wp=PT('woodpile');const nn=wp?nearNode(wp):'kmid';goTo(nn||'kmid',()=>{a.step='drop';if(wp)H.face=Math.atan2(wp.x-root.position.x,wp.z-root.position.z);once('hy_droplogs',{fade:.4,then:()=>{
      try{(window.__props||P3).release('logArmful');window.__audio.carry(false);}catch(e){}H.carry=null;play(IDLE(),{fade:.4});endTask({ok:true,logs:3});}});});});});
   a.update=()=>{if(H.carry&&H.path.length&&has(H.carry)&&!H.ov)overlay(H.carry,{fade:.3,until:.98,weight:.9});};
   a.leave=cb=>{try{(window.__props||P3).release('logArmful');window.__audio.carry(false);}catch(e){}H.carry=null;cb();};return a;},
 });
 // close (or open) the window shutters one window after another: walk up, reach for the shutter, it swings at the touch
 // opts: {close:true|false, windows:['bwin','kwin','wwin']}; house hook: window.__house.shutters.close(name)/open(name) when it exists
 MAKE.shutters=(o={})=>{const a={step:'go',t:0};const close=o.close!==false;const list=(o.windows||WINDOWS).filter(w=>N[w]);
  const go=()=>{const w=list.shift();if(!w){play(IDLE(),{fade:.4});endTask({ok:true,close});return;}const n=N[w];const pt=n.p.clone().addScaledVector(fwd(n.face??0),.5).add(V(0,1.3,0));pt.hand=true;
   visit(a,pt,.4,has('hy_window')?'hy_window':'hy_take',[[.45,()=>{try{const S=window.__house&&window.__house.shutters;S&&(close?S.close(w):S.open(w));}catch(e){}AU(close?'shutter_close':'shutter_open',pt);}]],go);};
  go();a.update=dt=>{stepTick(a,dt);};return a;};
 // put the jacket on (opts.on true) or take it off and hang it on its peg in the workshop
 MAKE.jacket=(o={})=>{const a={step:'go',t:0};const on=o.on!=null?!!o.on:!GEAR.coat;
  const done=()=>{play(IDLE(),{fade:.4});endTask({ok:true,on:GEAR.coat});};
  if(on)gearOn(a,{jacket:true},done);else gearOff(a,done,{});a.update=dt=>{stepTick(a,dt);};return a;};
 // house repairs: walk to the worn part (Brain passes opts.pos), kneel / stand and work there with the right tools
 const REPAIR={fix_shingle:{clip:'hy_shingle',tools:[['benchHammer','Right']],stand:.55,floorNail:true,def:()=>N.deck&&N.deck.p.clone().add(V(0,.2,-.5))},
  fix_board:{clip:'hy_nailboard',tools:[['benchHammer','Right']],stand:.5,floorNail:true,def:()=>root.position.clone().addScaledVector(fwd(root.rotation.y),.8)},
  fix_wall:{clip:'hy_patchwall',tools:[['benchHammer','Right']],stand:.45,wall:true,def:()=>{const w=pick(WINDOWS);const n=N[w];const f=fwd(n.face??0);return n.p.clone().addScaledVector(f,.55).add(V(-f.z*.9,1.2,f.x*.9));}},
  fix_rope:{clip:'hy_ropeknot',node:'gate',stand:.45,def:()=>N.gate&&N.gate.p.clone().add(V(0,.3,.6))},
  fix_hinge:{clip:'hy_oilhinge',stand:.45,def:()=>{const P=window.__props||P3;return P&&P.door&&P.door.handle?P.door.handle(V()):null;}},
  fix_window:{clip:'hy_window',stand:.4,def:()=>{const w=pick(WINDOWS);return N[w].p.clone().addScaledVector(fwd(N[w].face??0),.5).add(V(0,1.3,0));}},
  fix_railing:{clip:'hy_railing',tools:[['benchHammer','Right']],stand:.45,def:()=>N.deck&&N.deck.p.clone().add(V(0,1,.6))},
  clear_roof:{clip:'hy_clearleaves',stand:.6,def:()=>N.deck&&N.deck.p.clone().add(V(-.6,0,-.3))},
  fix_chimney:{clip:'hy_chimney',stand:.45,def:()=>{const P=window.__props||P3;return P&&P.chimneyTop?P.chimneyTop.clone().setY(Math.min(P.chimneyTop.y,root.position.y+1.6)):null;}}};
 for(const [k,R] of Object.entries(REPAIR))MAKE[k]=(o={})=>{const pos=o.pos?V(...o.pos):(R.def?R.def():null);
  const hamr=/benchHammer/.test(JSON.stringify(R.tools||[]));
  return job({pt:()=>pos,node:pos?null:R.node,stand:R.stand,clip:R.clip,loop:true,dur:[18,35],tools:R.tools||[],post:hamr?(a,dt)=>hammerPost(a,dt,R.floorNail?(a.fn||(a.fn=(()=>{/* kneeling over the boards: the nail is on the floor just in front of his right knee */const ls=bones.LeftArm.getWorldPosition(V()),rs=bones.RightArm.getWorldPosition(V());const f=ls.clone().sub(rs).cross(V(0,1,0)).setY(0).normalize();/* the way his chest faces in the clip */const m=ls.add(rs).multiplyScalar(.5).setY(root.position.y+.02);return m.addScaledVector(f,.32).add(V(-f.z*.1,0,f.x*.1));})())):pos,R.wall?V(root.position.x-pos.x,0,root.position.z-pos.z).normalize():null):undefined,vary:hamr?false:undefined,
   tick:(a,dt)=>{if(hamr&&!a.hmFar)return;/* GRAB: hammer hits come from the swing itself */if(!/hammer|nail/i.test(JSON.stringify(R.tools||[])))return;a.ct=(a.ct||0)+dt;if(a.ct>1.3){a.ct=0;AU('nails',pos);}},result:()=>({ok:true,target:o.target})});};
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
 function onBack(n,off,rot){try{PP().grab(n,bones.Spine2,{offset:off,rot:new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot))});}catch(e){}}
 // a short station step: walk up to a world point, play a one-off clip, call cb at fraction `at` of the clip, then go on
 function visit(a,pt,stand,clip,hits,then){if(!pt){then();return;}const nn=nearNode(pt);const run=()=>approachTo(a,pt,stand,()=>{a.step='clip';a.t=0;a.hits=hits.slice();a.clipDur=has(clip)?durOf(clip):1.2;a.pt=pt;
   const high=clip==='hy_take'&&pt.y-root.position.y>.72;/* hy_take picks from low (deep squat): for a shelf or a counter he stands and reaches instead */
   if(high){a.clipDur=1.3;play(IDLE(),{fade:.3});H.reach={pt:pt.clone(),t:0,d:1.3,side:'Right'};H.wait={t:1.3,then:()=>{H.reach=null;a.step='next';for(const h of a.hits)h[1]();a.hits=[];then();}};}
   else if(has(clip))once(clip,{fade:.35,then:()=>{a.step='next';for(const h of a.hits)h[1]();a.hits=[];play(IDLE(),{fade:.4});then();}});else{for(const h of hits)h[1]();then();}});
  if(nn)goTo(nn,run);else run();}
 // GRAB HOOK: the fridge by hand. He stands on the latch side clear of the door's swing, takes the handle, the door opens only as
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
  if(R.st==='move'){if(R.t>=R.md){play(IDLE(),{fade:.35});R.st=R.nx;R.t=0;}return;}
  if(R.st==='reachO'||R.st==='reachC'){R.w=Math.min(1,R.w+dt/.35);R.tgt='h';if((R.w>=1&&grip().distanceTo(hk)<.03)||R.t>1.2){R.st=R.st==='reachO'?'open':'close';R.t=0;}}
  else if(R.st==='open'){keep();F.setOpen(Math.min(.6,F.open+1.0*dt));if(F.open>=.6){F.openTo(.92);/* a last pull and it swings wide */R.w=Math.max(.0,R.w);R.st='letgo';R.t=0;}}
  else if(R.st==='letgo'){R.w=Math.max(0,R.w-dt/.25);if(R.w<=0){const fr=R.ins.clone().sub(fridgeAt(F,0,tmp).clone().setY(R.ins.y)).setY(0);const front=R.ins.clone().addScaledVector(R.nrm,.4);slideTo(front,R.ins,'in');}}
  else if(R.st==='in'){R.tgt='i';R.w=Math.min(1,R.w+dt/.35);if(R.t>.3&&!R.did&&(grip().distanceTo(R.ins)<.1||R.t>1.3)){R.did=1;R.tdid=R.t;try{if(R.mode==='in'){PP().release('meatBag');window.__audio.carry(false);H.carry=null;}else PP().grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}}
   if(R.did&&R.t>R.tdid+.25){R.w=Math.max(0,R.w-dt/.2);if(R.w<=0){const ho=F.handle(V());slideTo(ho.clone().addScaledVector(R.nrm,.28).addScaledVector(V(ho.x-R.ins.x,0,ho.z-R.ins.z).normalize(),.1),ho,'reachC');}}}
  else if(R.st==='close'){keep();F.setOpen(Math.max(0,F.open-1.0*dt));if(F.open<=.3){F.openTo(0);/* a push and it swings shut */R.st='after';R.t=0;}}
  else if(R.st==='after'){R.w=Math.max(0,R.w-dt/.3);if(R.w<=0){a.fr=null;a.step='next';R.then();}}}
 function fridgePost(a){const R=a.fr;if(!R||R.w<=.01)return;const F=PP().fridge;const G=window.__grab;
  const t=R.tgt==='i'?R.ins:F.handle(V());reachGrip('Right',t,R.w);if(G){if(R.st==='open'||R.st==='close'||((R.st==='reachO'||R.st==='reachC')&&R.w>.6))G.hold('Right',F.obj,()=>F.handle(V()));else G.free(F.obj);}}
 function stepTick(a,dt){a.t+=dt;if(a.step==='approach'){if(a.t>=a.adur)a.next();return true;}if(a.step==='fridge'){if(a.fr)fridgeTick(a,dt);return true;}
  if(a.step==='clip'){H.look=a.pt;H.lookW=.9;const k=a.t/Math.max(.3,a.clipDur);while(a.hits.length&&k>=a.hits[0][0]){a.hits.shift()[1]();}return true;}return false;}
 // the same one-off clip n times in a row (gathering logs, scooping), each with a small shift of the gaze
 function reps(clip,n,then){if(n<=0||!has(clip)){then();return;}once(clip,{fade:.35,then:()=>{H.face+=rnd(-.25,.25);reps(clip,n-1,then);}});}
 // filling the bucket at the pond by hand: squat at the waterline, both hands on the rim, dip it under, hold, lift it heavy, stand up
 // timeline in seconds; H.squat lowers the hips with the feet kept on the ground (knees bend), reachTo puts both palms on the bucket rim
 // filling the bucket at the pond: the hy_pondfill clip (Fal) squats him at the waterline with both hands on the rim;
 // code puts him where his hands come over the water, lets the bucket hang from the palms, pushes it a little deeper and makes the splash
 function fillTick(a,dt){const C='hy_pondfill';const F=a.F;const f=fwd(root.rotation.y);
  if(!a.started){a.started=true;a.T=0;if(has(C))once(C,{fade:.4});a.dur=has(C)?durOf(C):6;H.face=Math.atan2(F.x-root.position.x,F.z-root.position.z);
   const bk=PP()&&PP().tools&&PP().tools.waterBucket;if(bk){a.bk=bk;scene.attach(bk);}}
  a.T+=dt;const k=a.T/a.dur;const p=root.position;
  {/* step so that the hands (0.33 m ahead in the squat) come over the dip point */const tx=F.x-f.x*.33,tz=F.z-f.z*.33;const m=.5*dt;p.x+=clamp(tx-p.x,-m,m);p.z+=clamp(tz-p.z,-m,m);}
  root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*5);
  H.look=F.clone();H.lookW=.8*smooth(.05,.2,k)*(1-smooth(.75,.9,k));
  a.push=.1*smooth(.2,.3,k)*(1-smooth(.62,.72,k));a.w=smooth(.1,.2,k)*(1-smooth(.85,.95,k));
  const wl=window.__ground.pond.level;if(a.bk){const by=a.bk.position.y;if(!a.s1&&by<wl-.04){a.s1=1;splash(F,1);AU('bucket_fill',F);}if(a.s1&&!a.s2&&by>wl+.02&&k>.6){a.s2=1;splash(F,.6);AU('slosh',F);}}
  if(a.s1&&!a.s2&&(a.rp=(a.rp||0)+dt)>.5){a.rp=0;splash(F,.25,true);}
  if(k>=.98){a.step='hold';a.w=0;H.carry='hy_carrysack';if(a.bk){try{PP().grab('waterBucket',bones.RightHand,{offset:V(0,.06,.02)});}catch(e){}a.bk=null;}a.home();}}
 // washing the face at the water first (hy_washface, Fal): the bucket stands beside him, two scoops with a splash each
 function washTick(a,dt){const C='hy_washface';const F=a.F;const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
  if(!a.wstarted){a.wstarted=true;a.WT=0;if(has(C))once(C,{fade:.4});a.wdur=has(C)?durOf(C):5;H.face=Math.atan2(F.x-root.position.x,F.z-root.position.z);
   const bk=PP()&&PP().tools&&PP().tools.waterBucket;if(bk){a.bk=bk;scene.attach(bk);const g=root.position.clone().addScaledVector(r,.34).addScaledVector(f,.05);g.y=groundUnder(g,root.position.y);a.bkSet=g;a.bkFrom=bk.position.clone();}}
  a.WT+=dt;const k=a.WT/a.wdur;const p=root.position;
  {const tx=F.x-f.x*.5,tz=F.z-f.z*.5;const m=.5*dt;p.x+=clamp(tx-p.x,-m,m);p.z+=clamp(tz-p.z,-m,m);}root.rotation.y+=wrapA(H.face-root.rotation.y)*Math.min(1,dt*5);
  if(a.bk&&a.bkSet){a.bk.position.lerpVectors(a.bkFrom,a.bkSet,smooth(0,.12,k));a.bk.rotation.set(0,root.rotation.y,0);a.bk.updateMatrixWorld(true);}
  if(k>.1&&!a.w1){a.w1=1;splash(F,.35);AU('bucket_fill',F);}if(k>.5&&!a.w2){a.w2=1;splash(F,.35);}if(k>.3&&!a.f1){a.f1=1;AU('slosh',root.position);}
  H.look=k<.15?F.clone():null;H.lookW=k<.15?.8:0;
  if(k>=.97){a.step='fill';a.started=false;a.bkFrom=null;}}
 // the ground right under him (terrain outdoors, else the floor found by the ray), for squatting at the bank
 function groundUnder(p,prev){const G=window.__ground;let y=null;if(G&&G.heightAt&&p.y<lv.LC-1)y=G.heightAt(p.x,p.z);if(y==null){const f=floorAt(p.x,(prev??p.y)+.1,p.z,.4);y=f;}return y??prev??p.y;}
 // a splash: a ring spreading on the water and a few drops thrown up (temporary, removes itself)
 const SPL=[];const splMat=new THREE.MeshBasicMaterial({color:0xcfe3ea,transparent:true,opacity:.5,depthWrite:false});const dropMat=new THREE.PointsMaterial({color:0xdbe9ef,size:.025,transparent:true,opacity:.8,depthWrite:false});
 function splash(p,k=1,ringOnly){try{const pd=window.__ground&&window.__ground.pond;if(pd&&pd.splash)pd.splash(p.x,p.z,k);}catch(e){}const ring=new THREE.Mesh(new THREE.RingGeometry(.85,1,28),splMat.clone());ring.rotation.x=-Math.PI/2;ring.position.copy(p).add(V(0,.006,0));ring.scale.setScalar(.04);scene.add(ring);
  let pts=null,vel=null;if(!ringOnly){const n=14;const g=new THREE.BufferGeometry();const arr=new Float32Array(n*3);vel=[];for(let i=0;i<n;i++){arr[i*3]=p.x;arr[i*3+1]=p.y+.02;arr[i*3+2]=p.z;const a=Math.random()*6.283,sp=rnd(.2,.6)*k;vel.push([Math.cos(a)*sp,rnd(.6,1.3)*k,Math.sin(a)*sp]);}g.setAttribute('position',new THREE.BufferAttribute(arr,3));pts=new THREE.Points(g,dropMat.clone());scene.add(pts);}
  SPL.push({ring,pts,vel,t:0,k,y0:p.y});}
 function splashTick(dt){for(let i=SPL.length-1;i>=0;i--){const s=SPL[i];s.t+=dt;const u=s.t/1.4;s.ring.scale.setScalar(.04+u*.45*(.6+s.k*.4));s.ring.material.opacity=.5*(1-u);
   if(s.pts){const A=s.pts.geometry.attributes.position;for(let j=0;j<s.vel.length;j++){const v=s.vel[j];if(A.getY(j)<s.y0){continue;}v[1]-=9.8*dt;A.setXYZ(j,A.getX(j)+v[0]*dt,A.getY(j)+v[1]*dt,A.getZ(j)+v[2]*dt);}A.needsUpdate=true;s.pts.material.opacity=.8*(1-u);}
   if(u>=1){scene.remove(s.ring);s.ring.geometry.dispose();s.ring.material.dispose();if(s.pts){scene.remove(s.pts);s.pts.geometry.dispose();s.pts.material.dispose();}SPL.splice(i,1);}}}
 const peg=n=>{const p=PT(n);if(!p)return null;const q=p.clone();q.hand=true;/* hand height: stand on the floor below it, not on a floor level with it */return q;};
 function gearOn(a,o,then){const seq=[];
  if(o.jacket&&!GEAR.coat&&COAT)seq.push(next=>visit(a,peg('jacketPeg'),.45,'hy_jacketon',[[.14,()=>{try{PP().setHere&&PP().setHere('jacket',false);}catch(e){}COAT.on=true;GEAR.coat=true;}],[.55,()=>AU('zip')]]/* no rigid jacket in the hand: it leaves the peg at the touch and settles on the body (skinned coat fades in) */,next));
  if(o.bow&&!GEAR.bow)seq.push(next=>visit(a,peg('bowPeg'),.45,'hy_bowtake',[[.35,()=>{try{PP().grab('bow',bones.LeftHand,{offset:V(0,.08,.03)});}catch(e){}}],[.7,()=>{onBack('quiver',V(.06,.12,-.16),[0,0,-.5]);onBack('bow',V(-.02,.06,-.15),[0,0,.55]);/* GRAB: slung across the back, hands free for the ladder */GEAR.bow=true;}]],next));
  if(o.lantern&&!GEAR.lantern&&hasTool('lantern'))seq.push(next=>visit(a,toolHome('lantern'),.45,'hy_take',[[.45,()=>{try{PP().grab('lantern',bones.RightHand,{offset:V(0,.06,.03)});window.__lights&&window.__lights.attachHand&&window.__lights.attachHand(bones.RightHand);window.__lights.set('hand',true);}catch(e){}GEAR.lantern=true;}]],next));
  const run=i=>{if(i>=seq.length){then();return;}seq[i](()=>run(i+1));};run(0);}
 function gearOff(a,then,keep={}){const seq=[];
  if(GEAR.lantern)seq.push(next=>visit(a,toolHome('lantern'),.45,'hy_take',[[.45,()=>{try{window.__lights.set('hand',false);window.__lights.detachHand();PP().release('lantern',{blend:.3});}catch(e){}GEAR.lantern=false;}]],next));
  if(GEAR.bow)seq.push(next=>visit(a,peg('bowPeg'),.45,'hy_bowhang',[[.2,()=>{try{PP().grab('bow',bones.LeftHand,{offset:V(0,.08,.03)});}catch(e){}}],[.4,()=>{try{PP().release('quiver',{blend:.4});}catch(e){}}],[.7,()=>{try{PP().release('bow',{blend:.14});}catch(e){}GEAR.bow=false;}]],next));
  if(GEAR.coat&&!keep.jacket)seq.push(next=>visit(a,peg('jacketPeg'),.45,'hy_jacketoff',[[.25,()=>AU('unzip')],[.55,()=>{COAT.on=false;}],[.7,()=>{try{PP().setHere&&PP().setHere('jacket',true);}catch(e){}GEAR.coat=false;}]],next));
  const run=i=>{if(i>=seq.length){then();return;}seq[i](()=>run(i+1));};run(0);}
 function dropGearNow(){if(GEAR.coat&&COAT){COAT.on=false;try{PP().setHere&&PP().setHere('jacket',true);}catch(e){}GEAR.coat=false;}
  for(const n of ['bow','quiver','lantern','meatBag','logArmful','waterBucket','drainBucket','plate'])try{PP().release(n);}catch(e){}
  if(GEAR.lantern)try{window.__lights.set('hand',false);window.__lights.detachHand();}catch(e){}GEAR.bow=GEAR.lantern=false;try{window.__audio.carry(false);}catch(e){}H.carry=null;}
 const carryOv=()=>{if(H.carry&&H.path.length&&has(H.carry)&&!H.ov)overlay(H.carry,{fade:.3,until:.98,weight:.85});};
 Object.assign(MAKE,{
  // out to the forest for meat or wood; gear from the workshop, out of sight for a while, back with the haul, gear off again
  trip:(o={})=>{const a={step:'go',t:0};const kind=o.kind||'hunt';const away=o.away||rnd(40,90);let res={ok:true};
   if(!N.g_out){a.update=()=>endTask({ok:false});return a;}
   const OUT=N.g_exit1?'g_exit1':'g_out';/* out of the camera's view already there: no walk to g_out and back */
   const home=()=>{a.step='home';root.visible=true;H.node=OUT;
    const haul=kind==='hunt'?(res.ok?'meatBag':null):'logArmful';if(haul){if(haul==='meatBag'){onBack('meatBag',V(.1,.18,-.14),[0,0,0]);/* GRAB: the sack over his back, not dangling from a loose hand */}else{try{PP().grab(haul,bones.LeftHand,{offset:V(.1,.12,.1)});}catch(e){}H.carry='hy_carrylogs';}try{window.__audio.carry(true);}catch(e){}a.haul=haul;}
    const unload=next=>{if(!a.haul){next();return;}const P=PP();
     if(a.haul==='meatBag'){try{P.grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}fridgeVisit(a,'in',next);}
     else visit(a,PT('woodpile'),.5,'hy_droplogs',[[.6,()=>{try{P.release('logArmful');window.__audio.carry(false);}catch(e){}H.carry=null;}]],next);};
    unload(()=>gearOff(a,()=>{play(IDLE(),{fade:.4});endTask(res);},{jacket:!!o.keepJacket}));};
   gearOn(a,{jacket:o.jacket,bow:o.bow??kind==='hunt',lantern:o.lantern},()=>{a.step='out';goTo(OUT,()=>{a.step='away';a.t=0;root.visible=false;
     if(kind==='hunt'&&Math.random()<.3)res={ok:false};else res=kind==='hunt'?{ok:true,meat:2}:{ok:true,logs:rnd(0,1)<.5?2:3};});});
   a.update=dt=>{if(stepTick(a,dt))return;carryOv();if(a.step==='away'){if(a.t>away){const back=N.g_fork||N.g_path1||N.g_foot;const p=root.position;H.face=back?Math.atan2(back.p.x-p.x,back.p.z-p.z):(N[OUT].face??H.face)+Math.PI;root.rotation.y=H.face;home();}}};
   a.leave=cb=>{root.visible=true;dropGearNow();cb();};return a;},
  store:(o={})=>{const a={step:'go',t:0};const P=PP();try{P.grab('meatBag',bones.RightHand,{offset:V(0,.1,.02)});}catch(e){}H.carry='hy_carrysack';
   fridgeVisit(a,'in',()=>endTask({ok:true}));
   a.update=dt=>{if(!stepTick(a,dt))carryOv();};a.leave=cb=>{try{P.release('meatBag');P.fridge.openTo(0,.4);}catch(e){}H.carry=null;cb();};return a;},
  eat:(o={})=>{// serve from the pan, eat at the kitchen barrel on the stool (or at the bedroom table), the plate to the sink after
   const a={step:'go',t:0,T:0};const P=PP();const dur=rnd(10,15);
   const KT_=P&&P.surfaces&&P.surfaces.kitchenTable;const sp=KT_&&PT('eatSeat');let seat=N.chair,seatNode='chair_app',tablePt=()=>PT('table');
   if(sp){const face=KT_.face??-Math.PI/2;seat={p:sp.clone().setY(lv.KT),face,seat:sp.y,sit:true,floor:floorTop(lv.KT,sp.x,sp.z)};seatNode=nearNode(sp.clone().setY(lv.KT+.1))||'kmid';seat.node=seatNode;tablePt=()=>PT('eatTable');}
   visit(a,toolHome('plate')||PT('pan'),.45,'hy_take',[[.45,()=>{try{P.grab('plate',bones.LeftHand,{offset:V(0,.05,.08)});a.pl=1;}catch(e){}}]],()=>{a.step='serve';if(has('hy_stir'))play('hy_stir',{fade:.5});H.look=PT('pan')||null;H.lookW=.8;/* serves himself from the pan before sitting down */H.wait={t:rnd(3.5,5),then:()=>{a.step='go2';play(IDLE(),{fade:.4});goTo(seatNode,()=>{
     a.step='sit';sitDown(seat,()=>{
     const tp=tablePt()||root.position.clone().addScaledVector(fwd(root.rotation.y),.4).setY(FIT.tableTop);try{const pl=P.tools.plate;scene.attach(pl);pl.position.copy(tp).add(V(0,.01,0));pl.quaternion.identity();}catch(e){}
     a.step='eat';a.t=0;play(has('hy_eat')?'hy_eat':SITIDLE,{fade:.8});});});}};});
   a.update=dt=>{if(stepTick(a,dt))return;if(a.step==='eat'){a.T+=dt;H.look=tablePt();H.lookW=.9;try{P.plate&&P.plate.setFood&&P.plate.setFood(1-a.T/dur);}catch(e){}
     if(a.T>dur){a.step='up';standUp(seat,()=>{try{P.grab('plate',bones.LeftHand,{offset:V(0,.05,.08)});}catch(e){}
       visit(a,PT('sink'),.42,'hy_take',[[.45,()=>{try{P.release('plate');a.pl=0;P.dishes&&P.dishes.setDirty(P.dishes.state().dirty+1);}catch(e){}}]],()=>endTask({ok:true}));});}}};
   a.leave=cb=>{try{P.release('plate');}catch(e){}if(a.step==='eat'){standUp(seat,cb);}else cb();};return a;},
  // water: the tap bucket from the pond, the drain bucket emptied outside
  fetchwater:(o={})=>{const a={step:'go',t:0};const P=PP();const pond=window.__ground&&window.__ground.pond&&window.__ground.pond.fill;
   visit(a,PT('waterShelf'),.45,'hy_take',[[.45,()=>{try{P.grab('waterBucket',bones.RightHand,{offset:V(0,.06,.02)});}catch(e){}H.carry='hy_carrysack';}]],()=>{a.step='out';
    const spot=pond?pond.clone?pond.clone():V(pond.x,pond.y,pond.z):(N.g_exit1?N.g_exit1.p.clone().add(V(.6,0,.6)):null);
    const fill=()=>{a.step=o.washFace?'wash':'fill';a.t=0;a.T=0;a.WT=0;a.spl=0;play(IDLE(),{fade:.4});a.F=(window.__ground.pond.fill||spot).clone();};
    const home=()=>{H.squat=0;a.w=0;try{window.__audio.carry(true);}catch(e){}play(IDLE(),{fade:.4});H.look=a.F?a.F.clone():null;H.lookW=.6;/* a breath at the water before carrying it home */
      H.wait={t:o.linger||rnd(1.2,2),then:()=>{a.step='back';visit(a,PT('waterShelf'),.45,'hy_take',[[.5,()=>{try{P.release('waterBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>endTask({ok:true}));}};};
    a.home=home;
    if(N.g_pond){goTo('g_pond',()=>{H.face=N.g_pond.face;a.step='turn';a.t=0;a.next=fill;a.adur=.6;a.step='approach';});return;}
    if(spot){const nn=nearNode(spot)||'g_exit1';goTo(nn,()=>approachTo(a,spot,.5,fill));}else fill();});
   a.update=dt=>{if(a.step==='wash'){washTick(a,dt);return;}if(a.step==='fill'){fillTick(a,dt);return;}if(!stepTick(a,dt)){carryOv();if(H.carry&&H.path.length){a.sl=(a.sl||0)+dt;if(a.sl>.55){a.sl=0;AU('slosh',root.position);}}}};
   a.post=()=>{if(a.step!=='fill'||(!a.w&&!a.bk))return;const f=fwd(root.rotation.y),r=V(-f.z,0,f.x);
    const R=bones.RightHand.getWorldPosition(V()),Lh=bones.LeftHand.getWorldPosition(V());const d=V(0,-(a.push||0),0);
    if(a.push>.005){reachTo('Right',R.clone().add(d),a.w*.9);reachTo('Left',Lh.clone().add(d),a.w*.9);}
    // the bucket hangs from the palms that hold its rim (never floating away from them)
    if(a.bk){const R2=bones.RightHand.getWorldPosition(V()),L2=bones.LeftHand.getWorldPosition(V());const mid=R2.clone().add(L2).multiplyScalar(.5).addScaledVector(f,.05);const anchor=R2.clone().lerp(mid,smooth(.2,.9,a.w));const want=anchor.add(V(0,-.31,0));
     if(a.bkSet&&a.w<.5){/* still standing beside him where he put it down for the wash */}else a.bk.position.copy(want);a.bk.rotation.set(0,root.rotation.y,0);a.bk.rotateX(.25*(a.push||0)/.1);a.bk.updateMatrixWorld(true);}};
   a.leave=cb=>{H.squat=0;try{P.release('waterBucket');window.__audio.carry(false);}catch(e){}H.carry=null;cb();};return a;},
  setbucket:(o={})=>{const a={step:'go',t:0};const P=PP();visit(a,PT('waterShelf'),.45,'hy_take',[[.5,()=>{try{P.release('waterBucket',{blend:.3});}catch(e){}H.carry=null;}]],()=>endTask({ok:true}));
   a.update=dt=>{stepTick(a,dt);};return a;},
  dumpwater:(o={})=>{const a={step:'go',t:0};const P=PP();
   visit(a,PT('drainBay'),.5,'hy_picklog',[[.55,()=>{try{P.grab('drainBucket',bones.RightHand,{offset:V(0,.06,.02)});window.__audio.carry(true);}catch(e){}H.carry='hy_carrysack';}]],()=>{a.step='out';
    goTo('gate',()=>{H.face=N.gate.face??0;a.step='pour';a.t=0;once('hy_water',{fade:.4,then:()=>{play(IDLE(),{fade:.4});try{P.water.pour('drainBucket',false);}catch(e){}
      a.step='back';visit(a,PT('drainBay'),.5,'hy_picklog',[[.5,()=>{try{P.release('drainBucket',{blend:.3});window.__audio.carry(false);}catch(e){}H.carry=null;}]],()=>endTask({ok:true}));}});});});
   a.update=dt=>{if(stepTick(a,dt))return;carryOv();if(a.step==='pour'){a.t+=dt;if(a.t>.8&&!a.p){a.p=1;try{P.water.pour('drainBucket',true);}catch(e){}AU('bucket_dump',root.position);}}};
   a.leave=cb=>{try{P.water.pour('drainBucket',false);P.release('drainBucket');window.__audio.carry(false);}catch(e){}H.carry=null;cb();};return a;},
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
 function bedLegClear(dt){if(window.__noLegClear)return;const b=H.bedB;if(H.inBed&&!b&&SP.w>.05&&!window.__oldSleep){legClr.Left.l=legClr.Right.l=0;return;}/* POSE: asleep the whole body is posed on the mattress (sleepPose) */const B=FIT.bed;if(!B||!(b||H.inBed)){legClr.Left.l=legClr.Right.l=0;return;}const railZ=B.z1+.08,yReq=B.mat+.1,xMin=B.x0+.07;
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
 function sleepTickOld(dt){const on=H.inBed&&!H.bedB&&!H.trans;SP.w+= ((on?1:0)-SP.w)*Math.min(1,dt*(on?.8:3));if(SP.w<.002){SP.w=0;if(!on){SP.name='back';SP.cur={...SLEEP_POSES.back};SP.to=null;}return;}
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
  root.position.y+=c.lift*w;root.updateMatrixWorld(true);}
 // ===== SLEEP POSE (poses thread, 2026-11-23) =====
 // Pavel: the top leg hung in the air, the body floated over the mattress, the head twitched. The mocap sleep clip with a roll layer
 // on top could not be kept on the mattress, so asleep the body is now posed outright in the bed's own frame: the pelvis set on the
 // measured mattress, the spine along the bed, the head lifted onto the pillow, legs and arms placed with IK on the mattress
 // (back: legs long, knees soft; side: both knees drawn up, the top knee resting on the lower leg; stomach: one knee out, head
 // turned on the pillow). Turning over blends from one pose to the next. Only breathing moves; the head rests still.
 const SLP={rest:null};const _sq=new THREE.Quaternion(),_sm=new THREE.Matrix4();
 function slpInit(){if(SLP.rest)return true;let sk=null;root.traverse(o=>{if(o.isSkinnedMesh&&!sk)sk=o;});if(!sk||!bones.Hips||!bones.Head)return false;const S=sk.skeleton;
  const sq=S.bones.map(b=>b.quaternion.clone()),spp=S.bones.map(b=>b.position.clone());const rq=root.quaternion.clone();root.quaternion.identity();S.pose();root.updateMatrixWorld(true);
  SLP.rest=POSEBONES.map(b=>b.quaternion.clone());SLP.hipsW=bones.Hips.getWorldQuaternion(new THREE.Quaternion());
  const w=n=>bones[n].getWorldPosition(V());SLP.headHips=w('Head').distanceTo(w('Hips'));SLP.l1=w('LeftUpLeg').distanceTo(w('LeftLeg'));SLP.l2=w('LeftLeg').distanceTo(w('LeftFoot'));
  SLP.toe=w('LeftFoot').distanceTo(w('LeftToeBase'));SLP.foot={};for(const sd of ['Left','Right']){const t=w(sd+'ToeBase').sub(w(sd+'Foot')).normalize();const u=V(0,1,0).addScaledVector(t,-t.y).normalize();SLP.foot[sd]={q:bones[sd+'Foot'].getWorldQuaternion(new THREE.Quaternion()),t,u};}SLP.hipW=w('LeftUpLeg').distanceTo(w('RightUpLeg'));
  S.bones.forEach((b,i)=>{b.quaternion.copy(sq[i]);b.position.copy(spp[i]);});root.quaternion.copy(rq);root.updateMatrixWorld(true);return true;}
 const SLEEP_SHAPE={back:{hip:.085,head:.2},sideL:{hip:.105,head:.215},sideR:{hip:.105,head:.215},bellyL:{hip:.09,head:.185},bellyR:{hip:.09,head:.185}};
 function sleepPose(name,out){const B=FIT.bed;const hd=B.headDir||1;const mat=B.mat;const bz=B.bz;const sh=SLEEP_SHAPE[name]||SLEEP_SHAPE.back;
  const Y=V(hd,0,0);const Z=name==='back'?V(0,1,0):name==='sideL'?V(0,0,hd):name==='sideR'?V(0,0,-hd):V(0,-1,0);const X=V().crossVectors(Y,Z);// X = body left
  for(let i=0;i<POSEBONES.length;i++)POSEBONES[i].quaternion.copy(SLP.rest[i]);
  _sm.makeBasis(X,Y,Z);_sq.setFromRotationMatrix(_sm).multiply(SLP.hipsW);const Hp=bones.Hips;Hp.parent.updateMatrixWorld(true);Hp.quaternion.copy(Hp.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(_sq));
  const headX=B.x1-.2*hd;const side=/side/.test(name);const hip=V(headX-hd*SLP.headHips*.96,mat+sh.hip,bz-(side?Z.z*.13:0));// on the side the back is toward one edge so knees and hands stay on the mattress
  Hp.position.copy(Hp.parent.worldToLocal(hip.clone()));root.updateMatrixWorld(true);
  // the head onto the pillow: the chest and neck bend so the head's centre sits at its height on the pillow
  const goal=V(headX,mat+sh.head,bz-(side?Z.z*.09:0));
  for(const [nm,f] of [['Spine1',.25],['Spine2',.35],['Neck',1]]){const b=bones[nm];if(!b)continue;const h=bones.Head.getWorldPosition(V());turnBone(b,h,h.clone().lerp(goal,f),1);}
  if(/belly/.test(name)&&bones.Head)rotW(bones.Head,Y,(name==='bellyL'?1:-1)*1.15);// face turned to one side on the pillow
  root.updateMatrixWorld(true);
  const L=SLP.l1+SLP.l2;const wp_=n=>bones[n].getWorldPosition(V());
  const down=X.y<-.5?'Left':X.y>.5?'Right':null;// which side is under him
  for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],Lg=bones[s+'Leg'],Ft=bones[s+'Foot'],To=bones[s+'ToeBase'];if(!Ft)continue;const hp=U.getWorldPosition(V());const out_=X.clone().multiplyScalar(s==='Left'?1:-1);
   let ank,pole,toe;
   if(name==='back'){ank=hp.clone().addScaledVector(Y,-L*.95).addScaledVector(out_,.05);ank.y=mat+.07;pole=V(0,1,0).addScaledVector(out_,.35);toe=V(0,.85,0).addScaledVector(Y,-.35).addScaledVector(out_,.3);}
   else if(side){const top=s!==down;ank=hp.clone().addScaledVector(Y,-L*(top?.52:.62)).addScaledVector(Z,L*(top?.5:.36));ank.y=mat+(top?.095:.07);pole=Z.clone().add(V(0,top?-.25:0,0));toe=Y.clone().multiplyScalar(-.8).addScaledVector(Z,.35).add(V(0,top?-.15:0,0));}
   else{const bent=(name==='bellyL')===(s==='Left');ank=hp.clone().addScaledVector(Y,-L*(bent?.62:.96)).addScaledVector(out_,bent?.3:.04);ank.y=mat+.075;pole=bent?out_.clone().add(V(0,-.2,0)):V(0,-1,0);toe=V(0,-.55,0).addScaledVector(Y,-.85);}
   ik2(U,Lg,Ft,ank,pole,1,false);
   // the foot set whole (toe direction AND which way the instep faces), relaxed: no inward twist, no folded ankle
   {const F0=SLP.foot[s];let t,u;if(name==='back'){t=Z.clone().multiplyScalar(.8).addScaledVector(Y,-.45).addScaledVector(out_,.3);u=Y.clone().multiplyScalar(.8).addScaledVector(Z,.45);}
    else if(side){t=Z.clone().multiplyScalar(.45).addScaledVector(Y,-.85);u=Z.clone().multiplyScalar(.85).addScaledVector(Y,.45);}else{t=Y.clone().multiplyScalar(-.9).addScaledVector(Z,.3);u=Z.clone().multiplyScalar(.9).addScaledVector(Y,.3);}
    t.normalize();u.addScaledVector(t,-u.dot(t)).normalize();const m0=new THREE.Matrix4().makeBasis(F0.t,F0.u,V().crossVectors(F0.t,F0.u)),m1=new THREE.Matrix4().makeBasis(t,u,V().crossVectors(t,u));
    const R=new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));const want=R.multiply(F0.q);Ft.quaternion.copy(Ft.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(want));Ft.updateMatrixWorld(true);}}
  for(const s of ['Left','Right']){const A=bones[s+'Arm'],Fa=bones[s+'ForeArm'],Hn=bones[s+'Hand'];if(!Hn)continue;const sd=X.clone().multiplyScalar(s==='Left'?1:-1);const head=wp_('Head'),hips=wp_('Hips'),chest=bones.Spine2?wp_('Spine2'):hips;
   let t,pole;
   if(name==='back'){if(s==='Left'){t=hips.clone().addScaledVector(Y,.1).addScaledVector(sd,.21);t.y=mat+.07;pole=sd.clone().add(V(0,-.4,0));}else{t=hips.clone().addScaledVector(Y,.24).addScaledVector(sd,.02);t.y=mat+.16;pole=sd.clone().add(V(0,-.6,0));}}
   else if(side){const under=s===down;if(under){t=head.clone().addScaledVector(Z,.16).addScaledVector(Y,-.1);t.y=mat+.12;pole=Y.clone().multiplyScalar(-1).add(V(0,-.6,0));}else{t=chest.clone().addScaledVector(Z,.24).addScaledVector(Y,-.12);t.y=mat+.07;pole=V(0,1,0).addScaledVector(Y,-.6);}}
   else{t=head.clone().addScaledVector(sd,.26).addScaledVector(Y,-.04);t.y=mat+.05;pole=Y.clone().multiplyScalar(-1).add(V(0,.4,0)).addScaledVector(sd,.4);}
   ik2(A,Fa,Hn,t,pole,1,false);}
  if(out){for(let i=0;i<POSEBONES.length;i++)(out.q[i]||(out.q[i]=new THREE.Quaternion())).copy(POSEBONES[i].quaternion);out.hp=(out.hp||V()).copy(Hp.position);}}
 const SPA={q:[],hp:null},SPB={q:[],hp:null},SPC={q:[],hp:null};
 function sleepTick(dt){if(window.__oldSleep||!FIT.bed||!slpInit())return sleepTickOld(dt);
  const on=H.inBed&&!H.bedB&&!H.trans;if(!on)SP.covered=false;SP.w+=((on?1:0)-SP.w)*Math.min(1,dt*(on?1.2:3));if(SP.w<.002){SP.w=0;if(!on){SP.name='back';SP.to=null;}return;}
  let k=1;if(on){if(SP.to){SP.t+=dt;k=smooth(0,1,SP.t/SP.dur);if(SP.t>=SP.dur){SP.from=null;SP.to=null;k=1;bedPress(true);}}
   else if((SP.next-=dt)<=0||(window.__sleepPose&&window.__sleepPose!==SP.name)){const n=window.__sleepPose||sleepPick();SP.from=SP.name;SP.to=n;SP.name=n;SP.t=0;SP.dur=rnd(2.2,3);SP.next=rnd(45,140);k=0;sfx&&sfx.rustle&&sfx.rustle();}}
  // the clip pose this frame (what is blended from while he settles in / gets up)
  for(let i=0;i<POSEBONES.length;i++)(SPC.q[i]||(SPC.q[i]=new THREE.Quaternion())).copy(POSEBONES[i].quaternion);SPC.hp=(SPC.hp||V()).copy(bones.Hips.position);
  sleepPose(SP.name,SPA);let Q=SPA;
  if(SP.from&&k<1){sleepPose(SP.from,SPB);for(let i=0;i<POSEBONES.length;i++)SPB.q[i].slerp(SPA.q[i],k);SPB.hp.lerp(SPA.hp,k);Q=SPB;}
  const w=smooth(0,1,SP.w);for(let i=0;i<POSEBONES.length;i++)POSEBONES[i].quaternion.copy(SPC.q[i]).slerp(Q.q[i],w);bones.Hips.position.copy(SPC.hp).lerp(Q.hp,w);
  root.updateMatrixWorld(true);
  // under the quilt once he is settled (props bedCover drapes it over his bones); again after a turn
  if(on&&SP.w>.85&&!SP.covered){SP.covered=true;bedPress(true);}
  // turning over: the hips lift a little mid-roll
  if(SP.from&&k<1){const lift=Math.sin(Math.PI*k)*.05;const hw=bones.Hips.getWorldPosition(V()).add(V(0,lift,0));bones.Hips.position.copy(bones.Hips.parent.worldToLocal(hw));}
  // breathing: about 13 breaths a minute, the chest rises a little (the head stays where it lies)
  SP.br+=dt*2*Math.PI/4.6;if(bones.Spine1){const ax=V(1,0,0).applyQuaternion(bones.Hips.getWorldQuaternion(new THREE.Quaternion()));rotW(bones.Spine1,ax,Math.sin(SP.br)*.018*w*(SP.to?0:1));if(bones.Neck)rotW(bones.Neck,ax,-Math.sin(SP.br)*.018*w*(SP.to?0:1));}
  root.updateMatrixWorld(true);}
 // eyes: shut while he sleeps (and as he lies down / until he sits up), a blink every few seconds when awake
 const BL={t:rnd(2,5),k:0};
 function lidTick(dt){let want=0;const b=H.bedB;if(H.inBed&&!b)want=1;else if(b)want=smooth(.55,.9,b.u)*(b.dir>0?1:smooth(.75,.95,b.u));
  BL.t-=dt;if(BL.t<=0){BL.t=rnd(2.5,6);if(Math.random()<.2)BL.t=.25;BL.b=0;}if(BL.b!=null){BL.b+=dt;const k=BL.b<.07?BL.b/.07:1-(BL.b-.07)/.1;if(k<=0)BL.b=null;else want=Math.max(want,k);}
  BL.k+=(want-BL.k)*Math.min(1,dt*(want>BL.k?25:8));setLids(BL.k);}
 // the quilt and mattress sink under him (props.js bedPress)
 function bedPress(on){const P=window.__props||P3;if(!P)return;const hp=on?bones.Hips.getWorldPosition(V()):null;// asleep he lies under the quilt (props bedCover: a body-shaped mound)
  try{if(P.bedCover)P.bedCover(hp);/* POSE: bedPress(null) right after it switched the cover off again (both share one state), so the quilt never rose over him */else if(P.bedPress)P.bedPress(hp);}catch(e){}}
 function lieDown(then){const ed=N.bededge;H.face=0;
  sitDown(ed,()=>{H.trans=true;hold(STAND,0,.7);H.edgeHold={w:0,to:1,d:.8};undress(true);
   H.wait={t:rnd(.6,1.2),then:()=>{H.edgeHold=null;bedBlend(1,()=>{H.trans=false;H.inBed=true;bedPress(true);H.seated=null;then&&then();});}};});}
 // the detailed hero has a separate vest and boots: off on the bed edge before lying down, on again when he sits up
 const VEST=root.getObjectByName('vest'),BOOTS=root.getObjectByName('boots');
 function undress(off,quiet){if(!VEST&&!BOOTS)return;if(BOOTS)BOOTS.visible=!off;if(VEST)VEST.visible=!off;if(!quiet)AU(off?'unzip':'zip',root.position);}
 function getUp(then){H.trans=true;const ed=N.bededge;
  H.wait={t:rnd(.4,.9),then:()=>{H.inBed=false;bedPress(false);bedBlend(-1,()=>{hold(STAND,0,0);H.seated=ed;H.edgeHold={w:1,to:1,d:.8};
   undress(false);H.wait={t:rnd(.9,1.6),then:()=>{if(H.edgeHold){H.edgeHold.to=0;H.edgeHold.d=.5;}standUp(ed,()=>{if(has('hy_stretch')&&Math.random()<.8)overlay('hy_stretch',{fade:.5,speed:1.1});then&&then();});}};});}};}
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
 // ===== HERO-RULES.md section 1: one pose pipeline. Modules register per slot; slots run in this order every frame =====
 const SLOTS=['clip','motion','support','look','contacts','collide','grab','guard'];const STAGES={};for(const k of SLOTS)STAGES[k]=[];
 function stage(slot,fn){if(!STAGES[slot])throw new Error('unknown slot '+slot);STAGES[slot].push(fn);return ()=>{const i=STAGES[slot].indexOf(fn);if(i>=0)STAGES[slot].splice(i,1);};}
 function runSlot(slot,dt){const L=STAGES[slot];for(let i=0;i<L.length;i++){try{L[i](dt,H);}catch(e){console.error('stage '+slot,e);L.splice(i--,1);}}}
 function update(dt){if(dt<=0)return;const r=updateCore(dt);if(!window.__heroFast){runSlot('collide',dt);runSlot('grab',dt);runSlot('guard',dt);if(INV.on)invCheck(dt);}return r;}
 // HERO-RULES 3, live: ?inv in the URL (or HH.inv.on=true) checks the final pose every frame and counts what breaks, per task.
 // HH.inv.report() lists them; the first of each kind per task is logged with the frame so a thread can jump to it.
 const INV={on:/[?&]inv\b/.test(location.search),n:0,hits:{},prev:null,report(){return Object.entries(this.hits).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=>k+' x'+v.n+' worst '+v.worst.toFixed(v.unit==='deg'?0:2)+v.unit+' first f'+v.f);},reset(){this.hits={};this.n=0;}};
 function invHit(kind,val,unit){const k=(H.task||H.state||'-')+(H.lad?' (ladder)':H.trans?' (transition)':H.state==='walk'?' (walking)':'')+' / '+kind;const h=INV.hits[k];if(!h){INV.hits[k]={n:1,worst:val,unit,f:INV.n};console.warn('[inv] f'+INV.n+' '+k+' '+val.toFixed(2)+unit);}else{h.n++;if(val>h.worst)h.worst=val;}}
 function invCheck(dt){INV.n++;const p=root.position;const f=fwd(root.rotation.y);const busy=H.lad||H.trans||H.seated||H.inBed||H.fit||!root.visible;
  // 1 feet on a support while standing
  if(!busy&&H.ground&&H.floorY!=null){const lf=bones.LeftFoot.getWorldPosition(V()),rf=bones.RightFoot.getWorldPosition(V());const lo=Math.min(lf.y,rf.y)-H.floorY;if(lo>.16)invHit('feet in the air',lo,'m');}
  // 5 knees never bend forward: the bend plane's normal (thigh x shin) points to his left for a real knee; to his right = broken
  {const lh=bones.LeftUpLeg.getWorldPosition(V()),rh=bones.RightUpLeg.getWorldPosition(V());const toR=rh.clone().sub(lh);
   for(const s of ['Left','Right']){const hp=s==='Left'?lh:rh,kn=bones[s+'Leg'].getWorldPosition(V()),an=bones[s+'Foot'].getWorldPosition(V());const th=kn.clone().sub(hp),sh=an.clone().sub(kn);const ang=th.angleTo(sh);
    if(ang>.35){const nrm=th.clone().cross(sh).normalize();if(nrm.dot(toR)/toR.length()>.5)invHit(s+' knee backwards',ang*57.3,'deg');}}}
  // 5 head within 70 deg of the pelvis, no roll past 10 deg
  {const hq=bones.Head.getWorldQuaternion(new THREE.Quaternion());const hf=BFWD.Head.clone().applyQuaternion(hq).setY(0);const pf=hipsFwd().setY(0);if(hf.lengthSq()>1e-4&&pf.lengthSq()>1e-4){const d=hf.angleTo(pf)*57.3;if(d>75)invHit('owl head',d,'deg');}
   const fw=BFWD.Head.clone().applyQuaternion(hq),up=V(0,1,0).applyQuaternion(hq),sd=fw.clone().cross(YAX);if(sd.lengthSq()>1e-4){const r=Math.abs(Math.asin(clamp(up.dot(sd.normalize()),-1,1)))*57.3;if(r>12&&!H.inBed)invHit('head roll',r,'deg');}}
  // 6 no snaps: root and hips per-frame jumps
  const hp=bones.Hips.getWorldPosition(V());if(INV.prev&&dt>0){const v=hp.distanceTo(INV.prev.h)/dt;if(v>4&&!H.lad)invHit('hips snap',v,'m/s');const yv=Math.abs(wrapA(root.rotation.y-INV.prev.y))/dt;if(yv>9)invHit('turn snap',yv*57.3,'deg/s');}
  INV.prev={h:hp,y:root.rotation.y};}
 function updateCore(dt){if(dt<=0)return;H._dt=dt;freezeGuard(dt);if(SPL.length)splashTick(dt);
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
  if(H.slide){const sl=H.slide;const k1=smooth(0,1,Math.min(1,sl.k+dt/sl.d)),k0=smooth(0,1,sl.k);sl.k=Math.min(1,sl.k+dt/sl.d);p.x+=sl.x*(k1-k0);p.z+=sl.z*(k1-k0);if(sl.yT!=null){const r=sl.k;root.rotation.y=r<.3?lerp(sl.y0,sl.yT,smooth(0,.3,r)):r<.7?sl.yT:lerp(sl.yT,sl.yF,smooth(.7,1,r));}else root.rotation.y+=sl.yaw*(k1-k0);if(sl.k>=1)H.slide=null;}
  if(H.once){const o=H.once;const a=o.a;if(a.time>=o.end-1e-3||!a.isRunning()){H.once=null;o.then&&o.then();}}
  edgeTick(dt);bedTick(dt);overlayTick(dt);
  // height: stand on the real floor, or put the hips on the seat / mattress
  if(H.fit){const f=H.fit;const hy=bones.Hips.position.y;let w=1;
   if(f.mode==='sit')w=smooth(0,1,(f.hStand-hy)/Math.max(.05,f.hStand-f.hSeat));else if(f.mode==='rise')w=1-smooth(0,1,(hy-f.hSeat)/Math.max(.05,f.hStand-f.hSeat));
   p.y=lerp(f.base,f.y-hy,w);}
  else if(H.ground){// follow the boards: small steps up/down only (a gap between planks or a hole never pulls him down a storey)
   const sq=H.squat||0;const f=floorAt(p.x,p.y+sq,p.z,.32);if(f!=null&&f-(p.y+sq)<.3&&(p.y+sq)-f<.3){H.floorY=f;const d=f-sq-p.y;p.y+=clamp(d*(1-Math.exp(-dt*12)),-.9*dt,1.3*dt);}}
  // ===== MOTION HOOK: motion matching (game/motion.js) writes legs/hips (and the upper body unless an action clip plays) on top of the clip pose, before IK =====
  if(motion&&!window.__heroFast){try{motion.post(dt);}catch(e){console.error('motion',e);motion=null;}}
  runSlot('motion',dt);runSlot('support',dt);
  sleepTick(dt);lidTick(dt);coatTick(dt);
  if(window.__heroFast)return;/* off-screen fast-forward (the random start): no IK polish, nobody sees these frames */
  root.updateMatrixWorld(true);
  // soles on the boards when the body is lifted or lowered (chair, bed edge, uneven boards)
  const g=H.ground&&!H.fit?H.floorY:(H.fit&&!H.inBed&&!H.swing?H.fit.base:null);
  if(g!=null&&!H.lad&&!(H.fit&&H.fit.dangle)){if(H.fit&&H.fit.mode==='hold')legPlant(g,dt,H.bedB?1-H.bedB.W.leg:1);else{legPlantOff();let dy=g-p.y;if(Math.abs(dy)>(H.squat?.5:.3)){if(H.ground&&!H.fit)H.floorY=p.y;dy=0;}if(Math.abs(dy)>.004)legIK(dy,1);toeGuard(g,dt);}if(!H.inBed&&!H.bedB)kneeGuard();}
  // POSE: sitting on an edge with the legs over it: a foot that rests on the boards (one knee up) stands on them, never in them;
  // a foot hanging over the drop is left alone
  if(H.fit&&H.fit.dangle&&!H.lad){const gb=H.fit.base;for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());
    const fl=floorAt(a.x,gb+.05,a.z,.1,.15);if(fl==null)continue;const need=fl+(POSE.ankle??.1)-a.y;const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
    if(need>.002)ik2(U,L,F,a.clone().add(V(0,need,0)),k.clone().sub(hp.clone().add(a).multiplyScalar(.5)),1,true);
    const T=bones[s+'ToeBase'];if(T){const t=T.getWorldPosition(V());const tf=floorAt(t.x,gb+.05,t.z,.1,.15);if(tf!=null&&t.y<tf+.035)turnBone(F,t,t.clone().add(V(0,tf+.035-t.y,0)),1);}}}
  bedHand();bedLegClear(dt);
  if(!H.inBed&&!H.bedB)lookAt(dt);duck(dt);runSlot('look',dt);
  if(H.reach){const R=H.reach;R.t+=dt;const k=R.t/R.d;const w=smooth(0,.4,k)*(1-smooth(.62,1,k));if(w>.01)reachTo(R.side,R.pt,w);H.look=R.pt;H.lookW=.9;}
  if(act&&act.post)act.post(dt);/* hands last: nothing after this moves the chest, so a hand on a handle stays on it */
  runSlot('contacts',dt);
  if(H.lad&&H.lad.hb)hatchBelowPost();/* GRAB HOOK */
  if(act&&act.fr)fridgePost(act);/* GRAB HOOK */
  try{window.__grab&&window.__grab.tick&&window.__grab.tick(dt,H);}catch(e){}/* GRAB HOOK: hands close round what they hold */}

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
 function resetBody(){H.reach=null;try{undress(false,true);}catch(e){}H.lad=null;H.path=[];H.stk=null;try{dropGearNow();}catch(e){}root.visible=true;for(const h of ['Left','Right']){if(H.hold[h]&&H.hold[h].tool)releaseTool(h);else release(h);}
  if(bookObj&&bookHome&&bookObj.parent!==bookHome.parent){bookHome.parent.add(bookObj);bookObj.position.copy(bookHome.pos);bookObj.quaternion.copy(bookHome.quat);}
  if(H.inBed)bedPress(false);
  Object.assign(H,{path:[],then:null,wait:null,swing:null,bedB:null,edgeHold:null,lad:null,slide:null,once:null,trans:false,seated:null,inBed:false,fit:null,ground:true,v:0,av:0,look:null,lookW:0,pending:null,linger:0,turnStep:false});
  act=null;H.task=null;legPlantOff();}
 function spawn(task,o={}){resetBody();task=task||'read';
  if(task==='read'&&!o.walking){const s=N.chair;root.position.set(s.p.x,s.floor,s.p.z);root.rotation.y=s.face;H.face=s.face;H.seated=s;H.node='chair_app';H.task='read';H.ground=false;
   H.fit={mode:'hold',base:s.floor,y:s.seat+SEAT_CLEAR};play(READ,{fade:0});act=MAKE.read({seated:true});act.name='read';lastAct=['read'];actDur=rnd(25,40);return;}
  if(task==='sleep'&&!o.walking&&N.bedlie){const li=N.bedlie,ed=N.bededge;root.position.set(li.p.x,floorTop(BD),li.p.z);root.rotation.y=0;H.face=0;H.node='bed_app';H.ground=false;H.inBed=true;
   H.edgeRoot=V(ed.p.x,root.position.y,ed.p.z);undress(true,true);H.fit={mode:'hold',base:floorTop(BD),y:li.seat+LIE_CLEAR};play(SLEEPB,{fade:0});H.task='sleep';act=MAKE.sleep({inBed:true});act.name='sleep';
   H.wait={t:.05,then:()=>bedPress(true)};return;}
  const A=ACT[task]||{};let at=typeof A.at==='string'?A.at:null;if(task==='window')at=pick(WINDOWS);
  let from=at&&N[at]&&!N[at].seat&&!o.walking?at:null;
  if(!from){const keys=Object.keys(N).filter(k=>N[k]&&N[k].p&&N[k].seat==null&&!N[k].tight&&adj[k]&&k!==at);from=pick(keys);}
  if(at&&N[at]&&N[at].seat!=null&&!o.walking)from=at==='chair'?'chair_app':at==='bedlie'?'bed_app':from;
  const P=N[from].p;root.position.set(P.x,P.y,P.z);const f=floorAt(P.x,P.y,P.z,.4);if(f!=null)root.position.y=f;H.floorY=root.position.y;
  root.rotation.y=N[from].face??rnd(-Math.PI,Math.PI);H.face=root.rotation.y;H.node=from;play(IDLE(),{fade:0});startTask(task,o.opts);}
 // default start: reading at the table (a brain can call spawn() for a random start)
 spawn('read');

 return {spawn,H,hero:H,bones,actions,play,once,N,E,route,goTo,startTask,update,navCheck,FIT,need,gait,openEdge,
  setBrain:b=>{brain=b||null;},hasTask:n=>!!MAKE[n],stage,SLOTS,inv:INV,get act(){return act;},get gear(){return GEAR;},BFWD,setMotion:m=>{motion=m||null;},setClimb:m=>{climb=m||null;if(climb){climb.init({THREE,bones,ik2,turnBone,root,H,actions,play,floorAt,idle:()=>IDLE()||'0'});if(!climb._staged)climb._staged=stage('contacts',dt=>{if(climb&&!window.__noClimb)climb.post(dt);});}},/* CLIMB HOOK: ladders in the contacts slot */root,onTaskEnd:cb=>{endCbs.push(cb);},
  ray:(x,y,z,dx,dy,dz,len)=>{const r=new RAPIER.Ray({x,y,z},{x:dx,y:dy,z:dz});const h=world.castRay(r,len,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});return h?(h.toi??h.timeOfImpact):null;},
  label:()=>H.linger?'':(ACT[H.task]||{}).label||'',node:()=>H.node,walkSpeed:()=>walkSpeed,floorAt,items:{book:bookObj,mug,spoon,plate,pot}};
}
