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
 let walkSpeed=1.0;
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

 // ---------- floor under the hero: real board tops ----------
 const ray=new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
 function floorAt(x,y,z,up=.45,down=.9){ray.origin={x,y:y+up,z};const hit=world.castRayAndGetNormal(ray,up+down,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});
  if(!hit||hit.normal.y<.6)return null;return y+up-(hit.toi??hit.timeOfImpact);}

 // ---------- layout: walk graph (keeps clear of furniture) ----------
 const {LC,WS,KT,BD,DK}=lv;
 const N={
  kh_b:{p:V(-1.22,LC,3.77)},land:{p:V(-.4,LC,2.85)},gate:{p:V(0,LC,3.35),face:0},wstep:{p:V(1.15,WS,3.15)},
  wmid:{p:V(2.4,WS,3.45)},bench:{p:V(2.55,WS,2.62),face:Math.PI},wwin:{p:V(3.0,WS,3.95),face:0},
  kh_t:{p:V(-1.22,KT,2.75)},kmid:{p:V(-2.5,KT,3.3)},kl_m:{p:V(-3.75,KT,2.3)},stove:{p:V(-3.25,KT,2.42),face:Math.PI},sink:{p:V(-2.3,KT,2.15),face:Math.PI},kwin:{p:V(-3.0,KT,3.45),face:0},kl_b:{p:V(-4.0,KT,1.68)},
  bl_t:{p:V(-4.0,BD,2.35)},bl_m:{p:V(-3.25,BD,2.45)},bmid:{p:V(-2.3,BD,3.05)},bwin:{p:V(-3.6,BD,3.6),face:0},bdoor:{p:V(-.1,BD,2.78)},
  ledge:{p:V(1.25,BD,3.5),face:0},ll_b:{p:V(1.35,BD,3.47)},ll_t:{p:V(1.35,DK,2.7)},deckm:{p:V(1.9,DK,2.5)},deck:{p:V(3.13,DK,2.82),face:0},
 };
 const E=[['kh_b','land'],['land','gate'],['land','wstep'],['wstep','wmid'],['wmid','bench'],['wmid','wwin'],['kh_b','kh_t','ladder'],['kh_t','kmid'],['kmid','stove'],['kmid','sink'],['kmid','kwin'],['kmid','kl_m'],['kl_m','kl_b'],
  ['kl_b','bl_t','ladder'],['bl_t','bl_m'],['bl_m','bmid'],['bmid','bwin'],['bmid','bdoor'],['bdoor','ledge'],['ledge','ll_b'],['ll_b','ll_t','ladder'],['ll_t','deckm'],['deckm','deck']];
 // the rooms can be shifted sideways as a block (lv.XL: left rooms, lv.XR: right rooms); landings at LC stay
 {const XL=lv.XL||0,XR=lv.XR||0;if(XL||XR)for(const k in N){const n=N[k];if(n.p.y<LC+.3)continue;n.p.x+=n.p.x<0?XL:XR;}}
 const LAD={'kh_b>kh_t':{lz:3.45,side:1},'kl_b>bl_t':{lz:2.0,side:-1},'ll_b>ll_t':{lz:3.15,side:1}};

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
  N.chair_side={p:V(Math.min(hip.x-.55,(ctx.table?ctx.table.x0:hip.x)-.42),BD,hip.z-.2)};E.push(['bmid','chair_side'],['chair_side','chair_app']);
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
  N.bedlie={p:V(headDir>0?x1-1.0:x0+1.0,mat,bz),face:wrapA(lieYaw),seat:mat};
  // sitting on the very front edge of the mattress facing the room
  N.bededge={p:V(bx-headDir*.15,mat,z1+.02),face:0,seat:mat,floor:floorTop(BD,bx,z1+.45)};
  N.bed_app={p:V(N.bededge.p.x-sdEnd.x,BD,N.bededge.p.z-sdEnd.z),face:0,tight:true};
  E.push(['bmid','bed_app']);}
 const adj={};for(const [a,b,t] of E){(adj[a]=adj[a]||[]).push({to:b,t});(adj[b]=adj[b]||[]).push({to:a,t});}
 function route(a,b){const prev={[a]:null},q=[a];while(q.length){const n=q.shift();if(n===b)break;for(const e of adj[n]||[])if(!(e.to in prev)){prev[e.to]={n,t:e.t};q.push(e.to);}}
  if(!(b in prev))return [];const out=[];let c=b;while(c&&c!==a){out.unshift({node:c,t:prev[c].t,from:prev[c].n});c=prev[c].n;}return out;}
 // furniture footprints: the hero never walks into them
 const OBST=ctx.OBST||[];
 function pushOut(p){const r=.2;for(const o of OBST){if(o.seat||Math.abs(o.y-p.y)>.6)continue;if(p.x>o.x0-r&&p.x<o.x1+r&&p.z>o.z0-r&&p.z<o.z1+r){const dl=p.x-(o.x0-r),dr=o.x1+r-p.x,db=p.z-(o.z0-r),df=o.z1+r-p.z;const m=Math.min(dl,dr,db,df);if(m===dl)p.x=o.x0-r;else if(m===dr)p.x=o.x1+r;else if(m===db)p.z=o.z0-r;else p.z=o.z1+r;}}}
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
 function legIK(dy,w){for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V());const k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
   const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));ik2(U,L,F,a.clone().add(V(0,dy,0)),pole,w,true);}}
 // seated / perched: put each ankle at its standing height above the boards, then lift the toes out of the floor
 function legPlant(g){for(const s of ['Left','Right']){const U=bones[s+'UpLeg'],L=bones[s+'Leg'],F=bones[s+'Foot'];if(!F)continue;const a=F.getWorldPosition(V()),k=L.getWorldPosition(V()),hp=U.getWorldPosition(V());
   const pole=k.clone().sub(hp.clone().add(a).multiplyScalar(.5));ik2(U,L,F,V(a.x,g+(POSE.ankle??.1),a.z),pole,1,true);}toeGuard(g);}
 function toeGuard(g){for(const s of ['Left','Right']){const F=bones[s+'Foot'],T=bones[s+'ToeBase'];if(!F||!T)continue;const t=T.getWorldPosition(V());const need=g+.035-t.y;if(need<=.002)continue;turnBone(F,t,t.clone().add(V(0,need,0)),1);}}
 function armIK(side,target,pole,w){ik2(bones[side+'Arm'],bones[side+'ForeArm'],bones[side+'Hand'],target,pole,w,false);}
 // head and neck turn toward a point (smoothed, limited like a real neck)
 const lookS={yaw:0,pitch:0};
 function lookAt(dt){const Hd=bones.Head,Nk=bones.Neck;if(!Hd||!Nk)return;let ty=0,tp=0;const w=H.lookW;
  if(H.look&&w>.01){const hp=Hd.getWorldPosition(V());const d=H.look.clone().sub(hp);const yaw=root.rotation.y;const local=rotY(d,-yaw);ty=clamp(Math.atan2(local.x,local.z),-1.1,1.1)*w;tp=clamp(Math.atan2(-d.y,Math.hypot(d.x,d.z)),-.6,.7)*w;
   // remove what the animation already does with the head
   const hq=Hd.getWorldQuaternion(new THREE.Quaternion());const hf=V(0,0,1).applyQuaternion(hq);const hl=rotY(hf,-yaw);ty-=Math.atan2(hl.x,hl.z)*w;tp-=Math.atan2(-hl.y,Math.hypot(hl.x,hl.z))*w;}
  const k=1-Math.exp(-dt*4);lookS.yaw=lerp(lookS.yaw,clamp(ty,-1.2,1.2),k);lookS.pitch=lerp(lookS.pitch,clamp(tp,-.7,.7),k);
  if(Math.abs(lookS.yaw)+Math.abs(lookS.pitch)<1e-3)return;
  const yawQ=new THREE.Quaternion().setFromAxisAngle(YAX,0);
  for(const [b,share] of [[Nk,.4],[Hd,.6]]){const pw=b.parent.getWorldQuaternion(new THREE.Quaternion());const right=V(1,0,0).applyAxisAngle(YAX,root.rotation.y);
   const q=new THREE.Quaternion().setFromAxisAngle(YAX,lookS.yaw*share).multiply(new THREE.Quaternion().setFromAxisAngle(right,lookS.pitch*share));
   b.quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw));b.updateMatrixWorld(true);}}

 // ---------- walking: smooth curves, speed matched to the stride, turning steps ----------
 function walkStep(dt){const step=H.path[0];const target=N[step.node].p;const p=root.position;const nxt=H.path[1];const isLast=!nxt||nxt.t==='ladder';
  // aim a little past the corner so the path rounds it
  let aim=target.clone();const toT=Math.hypot(target.x-p.x,target.z-p.z);if(!isLast&&toT<.55){const n2=N[nxt.node].p;aim.lerp(n2,clamp((.55-toT)/.55,0,1)*.5);}
  const dx=aim.x-p.x,dz=aim.z-p.z;const want=Math.atan2(dx,dz);const da=wrapA(want-root.rotation.y);
  const vmax=H.walkV*(isLast?clamp(toT/.9,.25,1):1);const align=Math.max(0,Math.cos(da));
  H.v+=clamp(vmax*align*align-H.v,-2.4*dt,1.4*dt);
  // turn rate depends on speed: on the spot it takes small steps
  const rate=lerp(3.2,4.5,clamp(H.v/H.walkV,0,1));root.rotation.y+=clamp(da,-rate*dt,rate*dt);H.face=root.rotation.y;
  const dir=fwd(root.rotation.y);p.x+=dir.x*H.v*dt;p.z+=dir.z*H.v*dt;if(!(N[step.node].tight&&toT<.9)){const q=p.clone();pushOut(q);const m=1.6*dt;p.x+=clamp(q.x-p.x,-m,m);p.z+=clamp(q.z-p.z,-m,m);}
  const moving=H.v>.06||Math.abs(da)>.25;
  if(moving){play('30',{fade:.4});actions['30'].timeScale=clamp(Math.max(H.v,Math.abs(da)>.25?.35:0)/walkSpeed,.35,1.4);}else play(H.idleClip||'0',{fade:.5});
  H.state='walk';const rem=Math.hypot(target.x-p.x,target.z-p.z);
  if(rem<(isLast?.06:.32)){H.node=step.node;H.path.shift();if(isLast&&H.v<.35){H.v=0;}}}
 // ladders: walk to the foot, climb, pull up over the edge (root motion), or the same backwards
 function ladderStep(dt){const step=H.path[0];const key=step.from+'>'+step.node,rkey=step.node+'>'+step.from;const c=LAD[key]||LAD[rkey];const target=N[step.node].p;const p=root.position;
  if(!H.lad){const a=N[step.from].p;const up=target.y>a.y+.01;H.lad={up,phase:up?'mount':'over',x:target.x,yBot:Math.min(a.y,target.y),yTop:Math.max(a.y,target.y)};H.v=0;}
  const L=H.lad;const cz=c.lz+.32*c.side;const F=c.side>0?Math.PI:0;H.state='walk';H.ground=false;
  const done=()=>{H.lad=null;H.path.shift();H.node=step.node;H.ground=true;};
  if(L.phase==='mount'){const k=1-Math.exp(-dt*5);p.x=lerp(p.x,L.x,k);p.z=lerp(p.z,cz,k);root.rotation.y+=wrapA(F-root.rotation.y)*k;play('0',{fade:.3});H.ground=true;if(Math.hypot(p.x-L.x,p.z-cz)<.05&&Math.abs(wrapA(F-root.rotation.y))<.08){root.rotation.y=F;L.phase='climb';}}
  else if(L.phase==='climb'){root.rotation.y=F;p.x=L.x;p.z=cz;play('437',{speed:1.3,fade:.3});const v=.31*1.3*dt;const pull=rmCurve['435']?rmAt('435',99).y:1.4;
   if(L.up){p.y+=v;if(p.y>=L.yTop-pull){p.y=L.yTop-pull;L.phase='finish';once('435',{fade:.3,then:()=>{L.phase='stand';}});}}
   else{p.y-=v;if(p.y<=L.yBot){p.y=L.yBot;play('0',{fade:.35});done();}}}
  else if(L.phase==='stand'){H.ground=true;play('0',{fade:.4});done();}
  else if(L.phase==='over'){// down: step back over the edge (the pull-up played backwards)
   const a=actions['435'];const d=a.getClip().duration;const end=rmCurve['435']?rmAt('435',99):V(0,1.4,1.06);
   if(!L.start){root.rotation.y+=wrapA(F-root.rotation.y)*(1-Math.exp(-dt*5));const goal=V(L.x,L.yTop,cz).add(rotY(V(end.x,0,end.z),F));const k=1-Math.exp(-dt*5);p.x=lerp(p.x,goal.x,k);p.z=lerp(p.z,goal.z,k);H.ground=true;play('0',{fade:.3});
    if(Math.hypot(p.x-goal.x,p.z-goal.z)<.05&&Math.abs(wrapA(F-root.rotation.y))<.06){root.rotation.y=F;L.start=1;p.set(goal.x,L.yTop,goal.z);a.reset();a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.timeScale=-1;a.time=d;a.enabled=true;if(H.cur)H.cur.crossFadeTo(a,.3,false);a.play();H.cur=a;}}
   else if(a.time<=1e-3){L.phase='climb';L.start=0;}}}

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
 function goTo(node,then){if(node===H.node&&!H.path.length){then&&then();return;}H.path=route(H.node,node);if(!H.path.length){then&&then();return;}H.then=then;H.walkV=walkSpeed*rnd(.85,1.05);}
 const sidePole=(side,down=1)=>{const f=fwd(root.rotation.y);const right=V(-f.z,0,f.x);return right.multiplyScalar(side==='Right'?1:-1).add(V(0,-down,0)).add(f.clone().multiplyScalar(-.3));};
 function ikList(list){if(!list)return;for(const [s,t,w] of list)if(t&&w>.001)armIK(s,t,sidePole(s),clamp(w,0,1));}

 // a small pot on the stove while cooking
 const pot=sh((()=>{const g=new THREE.Group();const m=new THREE.MeshStandardMaterial({color:0x3A3A3C,metalness:.5,roughness:.45});const b=new THREE.Mesh(new THREE.CylinderGeometry(.1,.09,.12,20,1,true),m);b.position.y=.06;g.add(b);
  const bt=new THREE.Mesh(new THREE.CircleGeometry(.09,20),m);bt.rotation.x=-Math.PI/2;bt.position.y=.005;g.add(bt);const soup=new THREE.Mesh(new THREE.CircleGeometry(.095,20),new THREE.MeshStandardMaterial({color:0x9A5A2A,roughness:.3}));soup.rotation.x=-Math.PI/2;soup.position.y=.09;g.add(soup);
  const hd=new THREE.Mesh(new THREE.BoxGeometry(.12,.015,.025),m);hd.position.set(.15,.1,0);g.add(hd);return g;})());pot.visible=false;scene.add(pot);
 const potSpot=()=>{const st=N.stove;const f=fwd(st.face),r=V(-f.z,0,f.x);const top=floorTop(KT,st.p.x,st.p.z)+.9;return st.p.clone().addScaledVector(f,.62).addScaledVector(r,.17).setY(top);};

 // the activity currently running: a small state machine with its own update
 let act=null;
 function startTask(name){if(H.trans){H.pending=name;return;}
  if(act&&act.leave&&!act.left){const nm=name;act.left=true;H.trans=true;act.leave(()=>{H.trans=false;act=null;startTask(nm);});return;}
  act=null;H.task=name;actT=0;const A=ACT[name]||{};actDur=A.dur?rnd(A.dur[0],A.dur[1]):8;lastAct.unshift(name);lastAct.length=3;H.look=null;H.lookW=0;
  const mk=MAKE[name];if(!mk)return;act=mk();act.name=name;}
 const READ=has('hy_read')?'hy_read':'33',SITIDLE=has('hy_sitidle')?'hy_sitidle':'33';
 // the book in the hands: centred between the hands, a little forward, the pages facing the eyes
 const _bx=V(),_by=V(),_bz=V(),_bm=new THREE.Matrix4(),_bq=new THREE.Quaternion();
 function bookPose(){const L=bones.LeftHand.getWorldPosition(V()),R=bones.RightHand.getWorldPosition(V());const head=bones.Head.getWorldPosition(V());
  const f=fwd(root.rotation.y);const pos=L.clone().add(R).multiplyScalar(.5).addScaledVector(f,.06).add(V(0,.03,0));
  _by.copy(head).sub(pos).normalize();_bx.set(-f.z,0,f.x);_bx.addScaledVector(_by,-_bx.dot(_by)).normalize();_bz.crossVectors(_bx,_by);
  _bm.makeBasis(_bx,_by,_bz);_bq.setFromRotationMatrix(_bm);return {pos,quat:_bq.clone()};}
 const MAKE={
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
    ikList([['Left',gl,.85*k],['Right',tr,wr]]);};
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
  sleep:()=>{const a={step:'go'};goTo('bed_app',()=>{a.step='in';lieDown(()=>{a.step='sleep';play(has('hy_sleep')?'hy_sleep':'267',{fade:1.0});});});
   a.update=dt=>{};a.leave=cb=>{if(a.step==='go'){cb();return;}getUp(cb);};return a;},
  guard:()=>{const a={};const sp=ctx.guardSpot?ctx.guardSpot():'ledge';H.guardAt=sp;goTo(sp,()=>{H.state='work';play('231');H.face=N[sp]?.face??0;});a.leave=cb=>cb();return a;},
  repair:()=>{const a={};const b=ctx.brokenBoard&&ctx.brokenBoard();if(!b){H.task=null;return a;}goTo(ctx.WIN_NODE[b.group],()=>{a.go=1;a.t=0;grabTool('benchHammer','Right');});
   a.update=dt=>{if(!a.go)return;a.t+=dt;play(has('hy_hammer')?'hy_hammer':'128');if(Math.floor(a.t*2.2)!==Math.floor((a.t-dt)*2.2))sfx&&sfx.hammer&&sfx.hammer();if(a.t>2.4){ctx.repairBoard(b);releaseTool('Right');H.task=null;act=null;}};a.leave=cb=>{if(H.hold.Right)releaseTool('Right');cb();};return a;},
 };

 // ---------- sitting, lying down, getting up ----------
 // H.fit places the root so the hip joints are at fit.y (seat or mattress + clearance) whatever the clip assumes;
 // while sitting down / standing up it blends with how far the hips have travelled, so the body never pops.
 function sitDown(spot,then){H.trans=true;H.ground=false;H.face=spot.face;const fl=spot.floor??floorTop(BD);
  {const st=spot.p.clone().sub(rotY(V(sdEnd.x,0,sdEnd.z),spot.face));H.slide={x:st.x-root.position.x,z:st.z-root.position.z,yaw:wrapA(spot.face-root.rotation.y),k:0,d:.6};}
  H.fit={mode:'sit',base:fl,y:spot.seat+SEAT_CLEAR,hStand:hyAt(SIT,0),hSeat:hyAt(SIT,1)};
  once(SIT,{fade:.4,then:()=>{H.trans=false;H.seated=spot;H.fit.mode='hold';{const dx=spot.p.x-root.position.x,dz=spot.p.z-root.position.z;if(Math.hypot(dx,dz)<.3)H.slide={x:dx,z:dz,yaw:wrapA(spot.face-root.rotation.y),k:0,d:.6};}then&&then();}});}
 function standUp(spot,then){H.trans=true;H.face=spot.face;const fl=spot.floor??floorTop(BD);
  H.fit={mode:'rise',base:fl,y:spot.seat+SEAT_CLEAR,hStand:hyAt(STAND,1),hSeat:hyAt(STAND,0)};
  once(STAND,{fade:.5,then:()=>{H.fit=null;H.seated=null;H.trans=false;H.ground=true;H.floorY=fl;play(IDLE(),{fade:.6});H.node=spot===N.chair?'chair_app':'bed_app';then&&then();}});}
 function lieDown(then){const ed=N.bededge,li=N.bedlie;H.face=0;
  sitDown(ed,()=>{H.trans=true;hold(STAND,0,.7);
   H.wait={t:rnd(1.2,2.2),then:()=>{H.swing={k:0,dur:2.8,fade:2.2,clip:has('hy_sleep')?'hy_sleep':'267',from:{p:root.position.clone(),yaw:root.rotation.y,y:ed.seat+SEAT_CLEAR},to:{p:li.p.clone(),yaw:li.face,y:li.seat+LIE_CLEAR},
    then:()=>{H.trans=false;H.inBed=true;H.seated=null;then&&then();}};}};});}
 function getUp(then){H.trans=true;const ed=N.bededge,li=N.bedlie;
  H.wait={t:rnd(1,2),then:()=>{H.inBed=false;H.swing={k:0,dur:2.6,fade:2.0,hold:[STAND,0],from:{p:root.position.clone(),yaw:root.rotation.y,y:li.seat+LIE_CLEAR},to:{p:V(ed.p.x,root.position.y,ed.p.z),yaw:0,y:ed.seat+SEAT_CLEAR},
   then:()=>{H.seated=ed;H.wait={t:rnd(1,2.5),then:()=>standUp(ed,()=>{if(has('hy_stretch')&&Math.random()<.8){H.trans=true;once('hy_stretch',{fade:.6,then:()=>{H.trans=false;play(IDLE(),{fade:.7});then&&then();}});}else then&&then();})};}};}};}
 function swingTick(dt){const s=H.swing;if(!s)return;if(s.k===0){if(s.hold)hold(s.hold[0],s.hold[1],s.fade);else play(s.clip,{fade:s.fade});H.fit=H.fit||{mode:'hold',base:floorTop(BD),y:s.from.y};H.fit.mode='hold';}
  s.k=Math.min(1,s.k+dt/s.dur);const k=smooth(0,1,s.k);
  root.position.x=lerp(s.from.p.x,s.to.p.x,k);root.position.z=lerp(s.from.p.z,s.to.p.z,k);root.rotation.y=s.from.yaw+wrapA(s.to.yaw-s.from.yaw)*smooth(.1,.9,s.k);H.face=root.rotation.y;H.fit.y=lerp(s.from.y,s.to.y,k);
  if(s.k>=1){H.swing=null;s.then&&s.then();}}

 // ---------- per frame ----------
 function update(dt){if(dt<=0)return;
  // brain
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
  if(H.pending&&!H.trans){const n=H.pending;H.pending=null;startTask(n);}
  // movement
  if(H.path.length){const step=H.path[0];if(step.t==='ladder')ladderStep(dt);else walkStep(dt);if(!H.path.length&&H.then){const f=H.then;H.then=null;H.state='work';f();}}
  else if(H.state==='walk'){H.state='work';H.v=0;}
  if(!H.path.length){if(!H.swing&&!H.trans&&!H.seated&&!H.inBed){const da=wrapA(H.face-root.rotation.y);const k=1-Math.exp(-dt*4);root.rotation.y+=da*k;
     if(Math.abs(da)>.35&&H.cur&&['0','11','12','336','30','hy_idle'].includes(H.cur.getClip().name)){play('30',{fade:.3,speed:.45});H.turnStep=true;}else if(H.turnStep&&Math.abs(da)<.12){H.turnStep=false;if(H.cur===actions['30'])play(IDLE(),{fade:.4});}}}
  if(act&&act.update)act.update(dt);
  swingTick(dt);
  return post(dt);}
 function post(dt){const p=root.position;
  // root motion of once-off clips
  const pre=[];for(const n in rmCurve){const a=actions[n];if(a.isRunning()||a.getEffectiveWeight()>0)pre.push([n,a,a.time]);}
  mixer.update(dt);
  for(const [n,a,t0] of pre){const t1=a.time;if(t1===t0)continue;const w=a.getEffectiveWeight();if(w<=0)continue;const d=rmAt(n,t1).sub(rmAt(n,t0));p.add(rotY(V(d.x,0,d.z),root.rotation.y).multiplyScalar(w));if(RM[n].y)p.y+=d.y*w;}
  if(H.slide){const sl=H.slide;const k1=smooth(0,1,Math.min(1,sl.k+dt/sl.d)),k0=smooth(0,1,sl.k);sl.k=Math.min(1,sl.k+dt/sl.d);p.x+=sl.x*(k1-k0);p.z+=sl.z*(k1-k0);root.rotation.y+=sl.yaw*(k1-k0);if(sl.k>=1)H.slide=null;}
  if(H.once){const o=H.once;const a=o.a;if(a.time>=o.end-1e-3||!a.isRunning()){H.once=null;o.then&&o.then();}}
  // height: stand on the real floor, or put the hips on the seat / mattress
  if(H.fit){const f=H.fit;const hy=bones.Hips.position.y;let w=1;
   if(f.mode==='sit')w=smooth(0,1,(f.hStand-hy)/Math.max(.05,f.hStand-f.hSeat));else if(f.mode==='rise')w=1-smooth(0,1,(hy-f.hSeat)/Math.max(.05,f.hStand-f.hSeat));
   p.y=lerp(f.base,f.y-hy,w);}
  else if(H.ground){const f=floorAt(p.x,p.y,p.z,.2);if(f!=null&&f-p.y<.12){H.floorY=f;p.y=lerp(p.y,f,1-Math.exp(-dt*14));}}
  root.updateMatrixWorld(true);
  // soles on the boards when the body is lifted or lowered (chair, bed edge, uneven boards)
  const g=H.ground&&!H.fit?H.floorY:(H.fit&&!H.inBed&&!H.swing?H.fit.base:null);
  if(g!=null&&!H.lad){if(H.fit&&H.fit.mode==='hold')legPlant(g);else{const dy=g-p.y;if(Math.abs(dy)>.004)legIK(dy,1);toeGuard(g);}}
  if(act&&act.post)act.post(dt);
  lookAt(dt);}

 // ---------- start: reading at the table, already seated with the book in the hands ----------
 {const s=N.chair;root.position.set(s.p.x,s.floor,s.p.z);root.rotation.y=s.face;H.face=s.face;H.seated=s;H.node='chair_app';H.task='read';H.ground=false;
  H.fit={mode:'hold',base:s.floor,y:s.seat+SEAT_CLEAR};play(READ,{fade:0});act=MAKE.read({seated:true});act.name='read';lastAct=['read'];actDur=rnd(25,40);}

 return {H,hero:H,bones,actions,play,once,N,E,route,goTo,startTask,update,navCheck,FIT,need,
  label:()=>H.linger?'':(ACT[H.task]||{}).label||'',node:()=>H.node,walkSpeed:()=>walkSpeed,floorAt,items:{book:bookObj,mug,spoon,plate,pot}};
}
