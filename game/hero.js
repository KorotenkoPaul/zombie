// The hero: body animation, navigation and daily life.
// Everything about the character lives here so other work on index.html does not collide with it.
//
// How the body is driven:
//  * Every clip has its hip travel removed; clips that really move the body (sit down, stand up, pull-up)
//    hand that travel to the character's root frame by frame ("root motion"). So blends between clips never jump.
//  * The root always stands on the real floor: a physics ray finds the top of the boards under the hero.
//  * Feet are kept on the floor with leg IK, the head looks at what the hero is busy with,
//    hands reach for real things with arm IK (book pages, tools, the oven door).
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
const RM={'57':{},'53':{},'435':{y:[.98,.87]},'184':{}};
const CLIMB=new Set(['437','438','444']);

export function createHero(ctx){
 const {scene,gltf,world,RAPIER,lv,sfx}=ctx;
 const root=gltf.scene;scene.add(root);
 root.traverse(o=>{if(o.isMesh||o.isSkinnedMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;if(o.material){o.material.roughness=Math.max(.55,o.material.roughness??.8);o.material.metalness=0;}}});
 const bones={};root.traverse(o=>{if(o.isBone)bones[o.name.replace('mixamorig','').replace(':','')]=o;});

 // ---------- clips ----------
 const rmCurve={};
 for(const c of gltf.animations){const name=c.name;
  for(const tr of c.tracks){if(!/Hips\.position$/.test(tr.name))continue;const v=tr.values,t=tr.times,n=t.length,dur=c.duration||t[n-1]||1;
   const cfg=RM[name];const orig=Float32Array.from(v);
   for(let i=0;i<n;i++){const j=i*3;v[j]=0;v[j+2]=0;
    if(cfg&&cfg.y)v[j+1]=lerp(cfg.y[0],cfg.y[1],smooth(0,1,t[i]/dur));
    else if(CLIMB.has(name))v[j+1]=orig[1];}
   if(cfg){const r=new Float32Array(n*3);for(let i=0;i<n;i++)for(let k=0;k<3;k++)r[i*3+k]=(orig[i*3+k]-v[i*3+k])-(orig[k]-v[k]);rmCurve[name]={t:Float32Array.from(t),r};}}}
 const mixer=new THREE.AnimationMixer(root);const actions={};
 for(const c of gltf.animations)actions[c.name]=mixer.clipAction(c);
 const rmAt=(name,time)=>{const C=rmCurve[name];const t=C.t,n=t.length;if(time<=t[0])return V(C.r[0],C.r[1],C.r[2]);if(time>=t[n-1]){const j=(n-1)*3;return V(C.r[j],C.r[j+1],C.r[j+2]);}
  let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(t[m]<=time)lo=m;else hi=m;}const k=(time-t[lo])/(t[hi]-t[lo]);const a=lo*3,b=hi*3;return V(lerp(C.r[a],C.r[b],k),lerp(C.r[a+1],C.r[b+1],k),lerp(C.r[a+2],C.r[b+2],k));};

 const H={root,mixer,actions,cur:null,face:0,yaw:0,state:'idle',task:null,path:[],v:0,node:'bread_app',hp:3,
  floorY:lv.BD,ground:true,footIK:1,look:null,lookW:0,hold:{},busy:null,yLock:null};

 function play(name,{loop=true,fade=.35,speed=1,at=0}={}){const a=actions[name];if(!a)return null;if(H.cur===a){a.timeScale=speed;return a;}
  a.reset();a.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);a.clampWhenFinished=!loop;a.timeScale=speed;a.time=at;a.enabled=true;a.setEffectiveWeight(1);
  if(H.cur)H.cur.crossFadeTo(a,fade,false);a.play();H.cur=a;return a;}
 // once-off clip; then() when it ends (or at a fraction of it)
 function once(name,{fade=.3,speed=1,at=0,until=1,then}={}){const a=play(name,{loop:false,fade,speed,at});if(!a){then&&then();return;}H.once={a,end:a.getClip().duration*until,then};}

 // ---------- measure the walk: how far one second of the clip carries the body (no foot sliding) ----------
 let walkSpeed=1.0;
 {const a=actions['30'];if(a){a.reset().play();const d=a.getClip().duration;const T=bones.LeftToeBase,Q=V();let prev=null,acc=0,cnt=0;
   for(let i=0;i<=120;i++){a.time=d*i/120;mixer.update(0);root.updateMatrixWorld(true);T.getWorldPosition(Q);
    if(prev&&Q.y<.07&&prev.y<.07){acc+=Math.abs(Q.z-prev.z)/(d/120);cnt++;}prev=Q.clone();}
   if(cnt>5)walkSpeed=clamp(acc/cnt,.5,1.8);a.stop();}}
 // ---------- floor under the hero: real board tops ----------
 const ray=new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
 function floorAt(x,y,z,up=.45,down=.9){ray.origin={x,y:y+up,z};const hit=world.castRayAndGetNormal(ray,up+down,true,undefined,undefined,undefined,undefined,c=>{const u=c.userData;return !(u&&(u.loose||u.zombie));});
  if(!hit||hit.normal.y<.6)return null;return y+up-(hit.toi??hit.timeOfImpact);}

 // ---------- layout: walk graph (keeps clear of furniture) ----------
 const {LC,WS,KT,BD,DK}=lv;
 const N={
  kh_b:{p:V(-1.22,LC,3.77)},land:{p:V(-.4,LC,2.85)},gate:{p:V(0,LC,3.35),face:0},wstep:{p:V(1.15,WS,3.15)},
  wmid:{p:V(2.4,WS,3.45)},bench:{p:V(2.75,WS,2.72),face:Math.PI},wwin:{p:V(3.0,WS,3.95),face:0},
  kh_t:{p:V(-1.22,KT,2.75)},kmid:{p:V(-2.5,KT,3.3)},stove:{p:V(-3.2,KT,2.12),face:Math.PI},sink:{p:V(-2.28,KT,2.1),face:Math.PI},kwin:{p:V(-3.0,KT,3.45),face:0},kl_b:{p:V(-4.0,KT,1.68)},
  bl_t:{p:V(-4.0,BD,2.35)},bmid:{p:V(-2.3,BD,3.05)},bwin:{p:V(-3.6,BD,3.6),face:0},bdoor:{p:V(-.1,BD,2.78)},
  ledge:{p:V(1.25,BD,3.5),face:0},ll_b:{p:V(1.35,BD,3.47)},ll_t:{p:V(1.35,DK,2.7)},deckm:{p:V(1.9,DK,2.5)},deck:{p:V(3.13,DK,2.82),face:0},
 };
 const E=[['kh_b','land'],['land','gate'],['land','wstep'],['wstep','wmid'],['wmid','bench'],['wmid','wwin'],['kh_b','kh_t','ladder'],['kh_t','kmid'],['kmid','stove'],['kmid','sink'],['kmid','kwin'],['kmid','kl_b'],
  ['kl_b','bl_t','ladder'],['bl_t','bmid'],['bmid','bwin'],['bmid','bdoor'],['bdoor','ledge'],['ledge','ll_b'],['ll_b','ll_t','ladder'],['ll_t','deckm'],['deckm','deck']];
 const LAD={'kh_b>kh_t':{lz:3.45,side:1},'kl_b>bl_t':{lz:2.0,side:-1},'ll_b>ll_t':{lz:3.15,side:1}};

 // ---------- fit to the real furniture ----------
 const rc=new THREE.Raycaster();
 const topOf=(o,x,z,y0)=>{rc.set(V(x,y0,z),V(0,-1,0));const h=rc.intersectObject(o,true)[0];return h?h.point.y:null;};
 const floorTop=y=>{const f=floorAt(-2.3,y,3.0);return f??y+.035;};
 const FIT={};
 {// chair: sit facing the table, hips over the middle of the seat
  const ch=ctx.chair,cb=new THREE.Box3().setFromObject(ch),cx=(cb.min.x+cb.max.x)/2,cz=(cb.min.z+cb.max.z)/2;
  const face=ctx.chairFace??Math.PI;const f=fwd(face);
  let seat=null;for(const k of [.06,0,.1])seat=seat??topOf(ch,cx+f.x*k,cz+f.z*k,BD+.75);seat=seat??BD+.46;
  const hip=V(cx+f.x*.05,seat,cz+f.z*.05);
  N.chair={p:hip.clone().setY(BD),face,seat,sit:true};
  // where to stand so that sitting down (clip 57) lands the hips on the seat
  const d57=rmCurve['57']?rmAt('57',99):V(0,0,-.35);N.chair_app={p:hip.clone().sub(rotY(V(d57.x,0,d57.z),face)).setY(BD),face};
  E.push(['bmid','chair_app']);
  // the table the hero reads at
  const tb=ctx.table;FIT.tableTop=tb?tb.top:BD+.76;FIT.table=tb;
  FIT.chair={cx,cz,seat};}
 {// bunk bed: lower mattress, lie along the bed with the head on the pillows
  const bk=ctx.bunk,bb=new THREE.Box3().setFromObject(bk),bx=(bb.min.x+bb.max.x)/2,bz=(bb.min.z+bb.max.z)/2;
  const along=(bb.max.x-bb.min.x)>(bb.max.z-bb.min.z)?'x':'z';
  let mat=null;for(const dx of [0,.3,-.3])mat=mat??topOf(bk,bx+dx,bz,BD+.95);mat=mat??BD+.5;
  const halfW=(along==='x'?(bb.max.z-bb.min.z):(bb.max.x-bb.min.x))/2;
  const headDir=ctx.bedHead??1;// +1: pillows at +x
  FIT.bed={bx,bz,mat,halfW,headDir,along,box:bb};
  // lying: clip 267 has the head toward local -z, the feet toward +z, body centre ~0.25 m toward the feet
  const lieYaw=headDir>0?-Math.PI/2:Math.PI/2;
  N.bedlie={p:V(bx+headDir*.18,mat-.06,bz+.02),face:lieYaw};
  // sitting on the front edge of the mattress, facing the room
  const edgeZ=bb.max.z-.27;N.bededge={p:V(bx-headDir*.1,mat,edgeZ),face:0};
  const d57=rmCurve['57']?rmAt('57',99):V(0,0,-.35);N.bed_app={p:V(N.bededge.p.x-d57.x,BD,edgeZ-d57.z),face:0};
  E.push(['bmid','bed_app']);}
 const adj={};for(const [a,b,t] of E){(adj[a]=adj[a]||[]).push({to:b,t});(adj[b]=adj[b]||[]).push({to:a,t});}
 function route(a,b){const prev={[a]:null},q=[a];while(q.length){const n=q.shift();if(n===b)break;for(const e of adj[n]||[])if(!(e.to in prev)){prev[e.to]={n,t:e.t};q.push(e.to);}}
  if(!(b in prev))return [];const out=[];let c=b;while(c&&c!==a){out.unshift({node:c,t:prev[c].t,from:prev[c].n});c=prev[c].n;}return out;}
 // furniture footprints: the hero never walks into them
 const OBST=ctx.OBST||[];
 function pushOut(p){const r=.2;for(const o of OBST){if(o.seat||Math.abs(o.y-p.y)>.6)continue;if(p.x>o.x0-r&&p.x<o.x1+r&&p.z>o.z0-r&&p.z<o.z1+r){const dl=p.x-(o.x0-r),dr=o.x1+r-p.x,db=p.z-(o.z0-r),df=o.z1+r-p.z;const m=Math.min(dl,dr,db,df);if(m===dl)p.x=o.x0-r;else if(m===dr)p.x=o.x1+r;else if(m===db)p.z=o.z0-r;else p.z=o.z1+r;}}}
 function navCheck(){const bad=[];for(const [a,b,t] of E){if(t==='ladder')continue;const A=N[a].p,Bp=N[b].p;for(let k=0;k<=20;k++){const q=A.clone().lerp(Bp,k/20);for(const o of OBST){if(o.seat||Math.abs(o.y-q.y)>.6)continue;if(q.x>o.x0-.18&&q.x<o.x1+.18&&q.z>o.z0-.18&&q.z<o.z1+.18){bad.push(a+'-'+b+':'+o.n);break;}}}}return [...new Set(bad)];}

 // ---------- things the hero holds ----------
 const wood=new THREE.MeshStandardMaterial({color:0x7A5233,roughness:.7}),steel=new THREE.MeshStandardMaterial({color:0x9AA3AD,metalness:.6,roughness:.35});
 const paper=new THREE.MeshStandardMaterial({color:0xF2E8D2,roughness:.95,side:THREE.DoubleSide}),cover=new THREE.MeshStandardMaterial({color:0x7A2E2A,roughness:.8});
 const mugM=new THREE.MeshStandardMaterial({color:0xE8DCC4,roughness:.5});
 const sh=m=>{m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return m;};
 // open book: two halves, a page that can turn over the spine
 const book=new THREE.Group();{const W=.15,Hh=.21;
  for(const s of [-1,1]){const c=new THREE.Mesh(new THREE.BoxGeometry(W+.008,.006,Hh+.01),cover);c.position.set(s*(W/2+.004),-.006,0);book.add(c);
   const st=new THREE.Mesh(new THREE.BoxGeometry(W,.014,Hh),paper);st.position.set(s*W/2,.004,0);st.rotation.z=-s*.05;book.add(st);}
  const pg=new THREE.Group();const leaf=new THREE.Mesh(new THREE.PlaneGeometry(W,Hh,6,1),paper);leaf.rotation.x=-Math.PI/2;leaf.position.x=W/2;pg.add(leaf);pg.position.y=.013;book.add(pg);book.userData.page=pg;
  const pos=leaf.geometry.attributes.position;book.userData.leafBase=Float32Array.from(pos.array);book.userData.leaf=leaf;
  sh(book);book.visible=false;scene.add(book);}
 function bendPage(k){// page turning: lift and curl the free edge
  const pg=book.userData.page,leaf=book.userData.leaf,b=book.userData.leafBase,pos=leaf.geometry.attributes.position;
  pg.rotation.z=Math.PI*smooth(0,1,k);const curl=Math.sin(k*Math.PI)*.35;
  for(let i=0;i<pos.count;i++){const x=b[i*3]+.075;pos.setZ(i,b[i*3+2]+Math.pow(x/.15,2)*curl*.06);}pos.needsUpdate=true;}
 const hammer=sh((()=>{const g=new THREE.Group();const h=new THREE.Mesh(new THREE.CylinderGeometry(.013,.016,.3,8),wood);h.position.y=.1;g.add(h);
  const hd=new THREE.Mesh(new THREE.BoxGeometry(.11,.035,.035),steel);hd.position.y=.25;g.add(hd);const cl=new THREE.Mesh(new THREE.CylinderGeometry(.012,.02,.05,8),steel);cl.rotation.z=Math.PI/2;cl.position.set(.07,.25,0);g.add(cl);return g;})());
 const mug=sh((()=>{const g=new THREE.Group();const b=new THREE.Mesh(new THREE.CylinderGeometry(.04,.036,.09,14),mugM);g.add(b);const h=new THREE.Mesh(new THREE.TorusGeometry(.025,.007,6,12),mugM);h.position.set(.045,0,0);g.add(h);
  const tea=new THREE.Mesh(new THREE.CircleGeometry(.035,14),new THREE.MeshStandardMaterial({color:0x6B3A1E,roughness:.2}));tea.rotation.x=-Math.PI/2;tea.position.y=.035;g.add(tea);return g;})());
 const spoon=sh((()=>{const g=new THREE.Group();const h=new THREE.Mesh(new THREE.CylinderGeometry(.007,.009,.32,6),wood);h.position.y=.12;g.add(h);const s=new THREE.Mesh(new THREE.SphereGeometry(.03,10,6,0,Math.PI*2,0,Math.PI/2),wood);s.scale.y=.4;s.rotation.x=Math.PI;s.position.y=-.04;g.add(s);return g;})());
 const plate=sh(new THREE.Mesh(new THREE.CylinderGeometry(.1,.08,.015,18),mugM));
 const plank=sh(new THREE.Mesh(new THREE.BoxGeometry(.6,.03,.14),new THREE.MeshStandardMaterial({color:0xC08A55,roughness:.8})));plank.visible=false;scene.add(plank);
 const hs=b=>1/Math.max(1e-4,bones[b].getWorldScale(V()).x);
 function grab(item,hand,pos,rot){const b=bones[hand+'Hand'];if(!b)return;b.add(item);item.position.set(...pos).multiplyScalar(1);item.rotation.set(...rot);item.scale.setScalar(hs(hand+'Hand'));item.visible=true;H.hold[hand]=item;}
 function release(hand,to){const it=H.hold[hand];if(!it)return;H.hold[hand]=null;if(to){to.attach(it);}else{it.parent&&it.parent.remove(it);}}
 // tools on the pegboard / things on the counter: where they rest when not in hand
 const rest={hammer:ctx.spots?.hammer||V(2.3,WS+1.05,1.32),mug:ctx.spots?.mug||V(-2.05,KT+.97,1.5)};
 function park(item,p,ry=0,rz=0){scene.attach(item);item.position.copy(p);item.rotation.set(0,ry,rz);item.scale.setScalar(1);item.visible=true;}
 park(hammer,rest.hammer,0,0);park(mug,rest.mug);spoon.visible=false;scene.add(spoon);plate.visible=false;scene.add(plate);

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
  const dir=fwd(root.rotation.y);p.x+=dir.x*H.v*dt;p.z+=dir.z*H.v*dt;pushOut(p);
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
   if(!L.start){root.rotation.y=F;const goal=V(L.x,L.yTop,cz).add(rotY(V(end.x,0,end.z),F));const k=1-Math.exp(-dt*5);p.x=lerp(p.x,goal.x,k);p.z=lerp(p.z,goal.z,k);H.ground=true;play('0',{fade:.3});
    if(Math.hypot(p.x-goal.x,p.z-goal.z)<.05){L.start=1;p.set(goal.x,L.yTop,goal.z);a.reset();a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.timeScale=-1;a.time=d;a.enabled=true;if(H.cur)H.cur.crossFadeTo(a,.3,false);a.play();H.cur=a;}}
   else if(a.time<=1e-3){L.phase='climb';L.start=0;}}}

 // ---------- daily life ----------
 // needs drift over the day; each activity answers one, so the day is varied and never a fixed loop
 const need={energy:.8,hunger:.3,fun:.5,tidy:.3};
 let lastAct=[],actT=0,actDur=8;
 const ACT={
  read:{at:'chair',label:'читает',dur:[16,30],need:'fun'},
  craft:{at:'bench',label:'мастерит',dur:[14,22],need:'fun'},
  cook:{at:'stove',label:'готовит',dur:[14,20],need:'hunger'},
  tea:{at:'sink',label:'пьёт чай',dur:[9,14],need:'hunger'},
  wash:{at:'sink',label:'моет посуду',dur:[8,12],need:'tidy'},
  look:{at:'deck',label:'смотрит вдаль',dur:[10,16],need:'fun'},
  window:{at:pick,label:'смотрит в окно',dur:[6,10],need:'fun'},
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

 // the activity currently running: a small state machine with its own update
 let act=null;
 function startTask(name){if(H.trans){H.pending=name;return;}
  if(act&&act.leave&&!act.left){const nm=name;act.left=true;H.trans=true;act.leave(()=>{H.trans=false;act=null;startTask(nm);});return;}
  act=null;H.task=name;actT=0;const A=ACT[name]||{};actDur=A.dur?rnd(A.dur[0],A.dur[1]):8;lastAct.unshift(name);lastAct.length=3;H.look=null;H.lookW=0;
  const mk=MAKE[name];if(!mk)return;act=mk();act.name=name;}
 const MAKE={
  read:()=>{const a={step:'go'};goTo('chair_app',()=>{a.step='sit';sitDown(N.chair,()=>{a.step='read';book.visible=true;a.flipT=rnd(4,7);a.pk=-1;});});
   a.update=dt=>{if(a.step!=='read')return;const f=fwd(N.chair.face);const hips=bones.Hips.getWorldPosition(V());
     // book held over the table edge, tilted toward the eyes
     const bp=V(hips.x+f.x*.36,Math.max(FIT.tableTop+.06,hips.y+.2),hips.z+f.z*.36);book.position.lerp(bp,.3);book.rotation.set(0,N.chair.face+Math.PI,0);book.rotateX(-.55);
     H.look=book.position.clone();H.lookW=1;
     a.flipT-=dt;if(a.flipT<0&&a.pk<0){a.pk=0;}if(a.pk>=0){a.pk+=dt/1.1;bendPage(Math.min(1,a.pk));if(a.pk>=1){a.pk=-1;a.flipT=rnd(5,9);bendPage(0);}}
     // hands: left holds the left cover, right holds the right cover or turns the page
     book.updateMatrixWorld(true);const R=V(1,0,0).applyQuaternion(book.quaternion),Fw=V(0,0,1).applyQuaternion(book.quaternion);
     const lh=book.position.clone().addScaledVector(R,-.14).addScaledVector(Fw,.02);let rh=book.position.clone().addScaledVector(R,.14).addScaledVector(Fw,.02);
     if(a.pk>=0){const k=smooth(0,1,a.pk);const ang=Math.PI*k;rh=book.position.clone().addScaledVector(R,Math.cos(ang)*.13).add(V(0,Math.sin(ang)*.1+.02,0)).addScaledVector(Fw,.03);}
     const out=V(-f.z,0,f.x);a.ik=[lh,rh,out];};
   a.post=()=>{if(a.ik){const [lh,rh,out]=a.ik;armIK('Left',lh,out.clone().multiplyScalar(-1).add(V(0,-1,0)),.9);armIK('Right',rh,out.clone().add(V(0,-1,0)),.9);}};
   a.leave=cb=>{book.visible=false;bendPage(0);a.ik=null;if(a.step==='go'){cb();return;}standUp(N.chair,cb);};return a;},
  craft:()=>{const a={step:'go'};goTo('bench',()=>{a.step='reach';a.t=0;});
   a.update=dt=>{a.t=(a.t||0)+dt;const bench=N.bench;
    if(a.step==='reach'){// turn to the pegboard and take the hammer
     H.face=Math.atan2(rest.hammer.x-root.position.x,rest.hammer.z-root.position.z);play('0',{fade:.4});H.look=rest.hammer.clone();H.lookW=1;
     a.ik=['Right',rest.hammer.clone().add(V(0,.08,0)),smooth(0,.8,a.t)-smooth(1.2,1.6,a.t)];if(a.t>1.0&&!H.hold.Right){grab(hammer,'Right',[0,.05,.02],[Math.PI/2,0,0]);}
     if(a.t>1.7){a.step='work';a.t=0;H.face=bench.face;plank.visible=true;plank.position.set(bench.p.x,(FIT.benchTop??bench.p.y+.9)+.015,bench.p.z-.55);plank.rotation.set(0,rnd(-.2,.2),0);}}
    else if(a.step==='work'){H.face=bench.face;play('128',{fade:.4});H.look=plank.position.clone();H.lookW=.8;a.ik=null;
     const ac=actions['128'];const ph=(ac.time/ac.getClip().duration);if(a.lastPh!==undefined&&a.lastPh<.62&&ph>=.62){sfx&&sfx.hammer&&sfx.hammer();}a.lastPh=ph;}};
   a.post=()=>{if(a.ik){const [s,t,w]=a.ik;const f=fwd(root.rotation.y);armIK(s,t,V(f.z,-1,-f.x),clamp(w,0,1));}};
   a.leave=cb=>{plank.visible=false;if(!H.hold.Right){cb();return;}a.step='putback';a.t=0;a.update=dt=>{a.t+=dt;H.face=Math.atan2(rest.hammer.x-root.position.x,rest.hammer.z-root.position.z);play('0',{fade:.4});H.look=rest.hammer.clone();H.lookW=1;
     a.ik=['Right',rest.hammer.clone().add(V(0,.08,0)),smooth(0,.7,a.t)-smooth(1.1,1.5,a.t)];if(a.t>.9&&H.hold.Right){release('Right');park(hammer,rest.hammer);}if(a.t>1.5){a.ik=null;cb();}};};return a;},
  cook:()=>{const a={step:'go'};goTo('stove',()=>{a.step='oven';a.t=0;});
   a.update=dt=>{a.t+=dt||0;if(a.step==='oven'){// bend and open the oven, check the food, close it
     H.face=N.stove.face;play('276',{fade:.4,loop:false});const door=ctx.ovenDoor?.();const k=smooth(.9,1.6,a.t)-smooth(2.6,3.3,a.t);if(door&&door.setOpen)door.setOpen(k);H.look=root.position.clone().add(fwd(H.face).multiplyScalar(.5)).add(V(0,.35,0));H.lookW=.6;
     if(a.t>4.2){a.step='stir';a.t=0;grab(spoon,'Right',[0,.02,.03],[Math.PI/2,0,0]);}}
    else if(a.step==='stir'){H.face=N.stove.face;play('0',{fade:.5});const pot=root.position.clone().add(fwd(H.face).multiplyScalar(.5)).add(V(0,.98-0,0));pot.y=(FIT.stoveTop??root.position.y+.95)+.1;
     const r=.05;const tgt=pot.clone().add(V(Math.cos(a.t*3.2)*r,.08,Math.sin(a.t*3.2)*r));H.look=pot;H.lookW=1;a.ik=['Right',tgt,1];}};
   a.post=()=>{if(a.ik){const [s,t,w]=a.ik;const f=fwd(root.rotation.y);armIK(s,t,V(f.z,-1,-f.x),w);}};
   a.leave=cb=>{a.ik=null;const door=ctx.ovenDoor?.();door&&door.setOpen&&door.setOpen(0);if(H.hold.Right){release('Right');spoon.visible=false;}cb();};return a;},
  tea:()=>{const a={step:'go'};goTo('sink',()=>{a.step='take';a.t=0;});
   a.update=dt=>{a.t+=dt;if(a.step==='take'){H.face=N.sink.face;play('0',{fade:.4});H.look=rest.mug.clone();H.lookW=1;a.ik=['Left',rest.mug.clone().add(V(0,.03,0)),smooth(0,.8,a.t)];if(a.t>.9){grab(mug,'Left',[-.02,.06,.05],[0,0,0]);a.step='drink';a.t=0;a.ik=null;}}
    else if(a.step==='drink'){// turn toward the window while sipping
     const w=N.kwin.p;if(a.t<.1)H.face=wrapA(N.sink.face+rnd(-1.2,-.6));play('342',{fade:.5});H.look=w.clone().add(V(0,1.5,2));H.lookW=.5;}};
   a.post=()=>{if(a.ik){const [s,t,w]=a.ik;const f=fwd(root.rotation.y);armIK(s,t,V(-f.z,-1,f.x),w);}};
   a.leave=cb=>{a.ik=null;if(!H.hold.Left){cb();return;}a.update=dt=>{a.t+=dt;H.face=N.sink.face;play('0',{fade:.4});a.ik=['Left',rest.mug.clone().add(V(0,.03,0)),smooth(0,.6,a.t2=(a.t2||0)+dt)];if(a.t2>.7&&H.hold.Left){release('Left');park(mug,rest.mug);a.ik=null;cb();}};};return a;},
  wash:()=>{const a={step:'go'};goTo('sink',()=>{a.step='wash';a.t=0;grab(plate,'Left',[0,.03,.08],[Math.PI/2,0,0]);});
   a.update=dt=>{if(a.step!=='wash')return;a.t+=dt;H.face=N.sink.face;play('0',{fade:.4});const s=root.position.clone().add(fwd(H.face).multiplyScalar(.42));s.y=(FIT.sinkTop??root.position.y+.9)-.02;
    H.look=s;H.lookW=1;const l=s.clone().add(V(-.05,0,0)),r=s.clone().add(V(.06+Math.sin(a.t*7)*.05,.02,Math.cos(a.t*7)*.04));a.ik=[l,r];};
   a.post=()=>{if(a.ik){const f=fwd(root.rotation.y);armIK('Left',a.ik[0],V(-f.z,-1,f.x),.9);armIK('Right',a.ik[1],V(f.z,-1,-f.x),.9);}};
   a.leave=cb=>{a.ik=null;if(H.hold.Left){release('Left');plate.visible=false;}cb();};return a;},
  look:()=>{const a={step:'go'};goTo('deck',()=>{a.step='look';a.t=0;});a.update=dt=>{if(a.step!=='look')return;a.t+=dt;H.face=N.deck.face;play('336',{fade:.6});
    const sweep=Math.sin(a.t*.25)*6;H.look=root.position.clone().add(V(sweep,1.2+Math.sin(a.t*.13)*.6,8));H.lookW=.8;};a.leave=cb=>cb();return a;},
  window:()=>{const a={step:'go'};const wn=pick(WINDOWS.filter(w=>Math.abs(N[w].p.y-root.position.y)<.8))||'bwin';goTo(wn,()=>{a.step='look';a.t=0;});
   a.update=dt=>{if(a.step!=='look')return;a.t+=dt;H.face=N[wn].face??0;play(a.t<3?'0':'336',{fade:.7});H.look=root.position.clone().add(V(Math.sin(a.t*.3)*3,1.6,6));H.lookW=.9;};a.leave=cb=>cb();return a;},
  sleep:()=>{const a={step:'go'};goTo('bed_app',()=>{a.step='in';lieDown(()=>{a.step='sleep';});});
   a.update=dt=>{};a.leave=cb=>{if(a.step==='go'){cb();return;}getUp(cb);};return a;},
  guard:()=>{const a={};const sp=ctx.guardSpot?ctx.guardSpot():'ledge';H.guardAt=sp;goTo(sp,()=>{H.state='work';play('231');H.face=N[sp]?.face??0;});a.leave=cb=>cb();return a;},
  repair:()=>{const a={};const b=ctx.brokenBoard&&ctx.brokenBoard();if(!b){H.task=null;return a;}goTo(ctx.WIN_NODE[b.group],()=>{a.go=1;a.t=0;grab(hammer,'Right',[0,.05,.02],[Math.PI/2,0,0]);});
   a.update=dt=>{if(!a.go)return;a.t+=dt;play('128');if(Math.floor(a.t*2.2)!==Math.floor((a.t-dt)*2.2))sfx&&sfx.hammer&&sfx.hammer();if(a.t>2.4){ctx.repairBoard(b);release('Right');park(hammer,rest.hammer);H.task=null;act=null;}};a.leave=cb=>{if(H.hold.Right){release('Right');park(hammer,rest.hammer);}cb();};return a;},
 };

 // ---------- sitting, lying down, getting up ----------
 function yGlide(from,to,t0,t1){H.yLock={from,to,t0,t1,t:0};}
 function sitDown(spot,then){H.trans=true;H.ground=false;H.face=spot.face;const hipY=spot.seat+.11;const sitRoot=hipY-.55;
  once('57',{fade:.35,then:()=>{play('33',{fade:.5});H.trans=false;H.seated=spot;then&&then();}});
  yGlide(root.position.y,sitRoot,2.0,3.5);}
 function standUp(spot,then){H.trans=true;H.ground=false;H.face=spot.face;const fy=floorTop(BD);
  once('53',{fade:.45,speed:1.25,then:()=>{H.seated=null;H.trans=false;H.ground=true;play('0',{fade:.5});H.node=spot===N.chair?'chair_app':'bed_app';then&&then();}});
  yGlide(root.position.y,fy,1.3,3.0);}
 function lieDown(then){H.trans=true;H.ground=false;const ed=N.bededge,li=N.bedlie;H.face=0;
  // sit on the edge of the mattress first
  once('57',{fade:.35,then:()=>{play('33',{fade:.4});H.seated=ed;H.swing={k:0,from:{p:root.position.clone(),yaw:root.rotation.y},to:{p:li.p.clone(),yaw:li.face},dur:1.8,clip:'267',then:()=>{H.trans=false;H.inBed=true;then&&then();}};}});
  yGlide(root.position.y,ed.p.y+.11-.55,2.0,3.5);}
 function getUp(then){H.trans=true;const ed=N.bededge;
  const finish=()=>{H.swing={k:0,from:{p:root.position.clone(),yaw:root.rotation.y},to:{p:V(ed.p.x,ed.p.y+.11-.55,ed.p.z),yaw:0},dur:1.6,clip:'33',then:()=>{H.inBed=false;standUp(ed,then);}};};
  once('271',{fade:.6,until:.9,then:finish});}
 function swingTick(dt){const s=H.swing;if(!s)return;if(s.k===0){play(s.clip,{fade:s.dur*.8});}s.k=Math.min(1,s.k+dt/s.dur);const k=smooth(0,1,s.k);
  root.position.lerpVectors(s.from.p,s.to.p,k);root.position.y=lerp(s.from.p.y,s.to.p.y,smooth(0,1,Math.min(1,s.k*1.4)));root.rotation.y=s.from.yaw+wrapA(s.to.yaw-s.from.yaw)*k;H.face=root.rotation.y;
  if(s.k>=1){H.swing=null;s.then&&s.then();}}

 // ---------- per frame ----------
 function update(dt){if(dt<=0)return;
  // brain
  const h=hour(),night=ctx.isNight(h);
  need.energy=clamp(need.energy-dt*(H.task==='sleep'&&H.inBed?-.02:.0015),0,1);need.hunger=clamp(need.hunger+dt*.002,0,1);need.fun=clamp(need.fun+dt*.003,0,1);need.tidy=clamp(need.tidy+dt*.0012,0,1);
  if(act&&act.name&&ACT[act.name]&&ACT[act.name].need&&H.state==='work'){need[ACT[act.name].need]=clamp(need[ACT[act.name].need]-dt*.03,0,1);}
  if(!H.trans&&!H.path.length){const mode=ctx.mode?ctx.mode():null;
   if(mode&&mode!==H.task&&(mode==='guard'||mode==='repair'))startTask(mode);
   else if(!H.task)startTask(choose());
   else if(H.task==='sleep'&&!night&&h>6.2)startTask(choose());
   else if(H.task!=='sleep'&&H.task!=='guard'&&H.task!=='repair'&&act&&act.step&&act.step!=='go'&&(actT+=dt)>actDur){
    // between activities: sometimes linger, stretch or glance around before moving on
    if(!H.linger&&Math.random()<.45){H.linger=rnd(2,4.5);H.lingerClip=pick(['336','12','11']);}
    if(H.linger&&!H.seated){H.linger-=dt;play(H.lingerClip,{fade:.6});H.look=null;H.lookW=0;if(H.linger>0)return post(dt);}
    H.linger=0;startTask(night&&h<21.5&&h>=20?'read':choose());}
   else if(H.task==='sleep'&&night===false&&h<6.2){}
   else if(night&&H.task!=='sleep'&&H.task!=='guard'&&(h>=21.5||h<5)){startTask('sleep');}}
  if(H.pending&&!H.trans){const n=H.pending;H.pending=null;startTask(n);}
  // movement
  if(H.path.length){const step=H.path[0];if(step.t==='ladder')ladderStep(dt);else walkStep(dt);if(!H.path.length&&H.then){const f=H.then;H.then=null;H.state='work';f();}}
  else if(H.state==='walk'){H.state='work';H.v=0;}
  if(!H.path.length){if(!H.swing&&!H.trans){const da=wrapA(H.face-root.rotation.y);const k=1-Math.exp(-dt*4);root.rotation.y+=da*k;
     if(Math.abs(da)>.35&&!H.seated&&!H.inBed&&H.cur&&['0','11','12','336','30'].includes(H.cur.getClip().name)){play('30',{fade:.3,speed:.45});H.turnStep=true;}else if(H.turnStep&&Math.abs(da)<.12){H.turnStep=false;play('0',{fade:.4});}}}
  if(act&&act.update)act.update(dt);
  swingTick(dt);
  return post(dt);}
 function post(dt){const p=root.position;
  // root motion of once-off clips
  const pre=[];for(const n in rmCurve){const a=actions[n];if(a.isRunning()||a.getEffectiveWeight()>0)pre.push([n,a,a.time]);}
  mixer.update(dt);
  for(const [n,a,t0] of pre){const t1=a.time;if(t1===t0)continue;const w=a.getEffectiveWeight();if(w<=0)continue;const d=rmAt(n,t1).sub(rmAt(n,t0));p.add(rotY(d,root.rotation.y).multiplyScalar(w));}
  if(H.once){const o=H.once;const a=o.a;if(a.time>=o.end-1e-3||!a.isRunning()){H.once=null;o.then&&o.then();}}
  // height: stand on the real floor, or glide into a seat
  if(H.yLock){const L=H.yLock;const a=H.cur;const t=a?a.time:0;const k=smooth(L.t0,L.t1,t);p.y=lerp(L.from,L.to,k);if(!H.once&&!H.trans)H.yLock=null;if(k>=1&&!H.once)H.yLock=null;}
  else if(H.ground){const f=floorAt(p.x,p.y,p.z);if(f!=null){H.floorY=f;p.y=lerp(p.y,f,1-Math.exp(-dt*14));}}
  root.updateMatrixWorld(true);
  // feet on the floor when the body is lifted or lowered (chair, bed edge, uneven boards)
  const g=H.ground?H.floorY:(H.seated||H.yLock?floorTop(BD):null);
  if(g!=null&&!H.inBed&&!H.swing&&!H.lad){const dy=g-p.y;if(Math.abs(dy)>.004)legIK(dy,1);}
  if(act&&act.post)act.post();
  lookAt(dt);}

 // ---------- start: reading at the table ----------
 {const s=N.chair;root.position.set(s.p.x,s.seat+.11-.55,s.p.z);root.rotation.y=s.face;H.face=s.face;H.seated=s;H.node='chair_app';H.task='read';
  play('33',{fade:0});const a={step:'read',flipT:3,pk:-1,name:'read'};const r=MAKE.read;const tmp=r();H.path=[];H.then=null;Object.assign(tmp,{step:'read',flipT:3,pk:-1});book.visible=true;act=tmp;act.name='read';lastAct=['read'];actDur=rnd(10,18);}

 return {H,hero:H,bones,actions,play,once,N,E,route,goTo,startTask,update,navCheck,FIT,need,
  label:()=>H.linger?'':(ACT[H.task]||{}).label||'',node:()=>H.node,walkSpeed:()=>walkSpeed,floorAt,items:{book,hammer,mug,spoon,plate}};
}
