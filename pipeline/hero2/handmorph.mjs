// Fingers for the v6 hero (no finger bones): per-finger curl at three knuckles baked as morph targets on Mesh_0:
//   fistLeft/fistRight (power grip round a ~3 cm handle), relaxLeft/relaxRight (the natural rest curl, more toward the little finger).
// Hand-bone space (mixamo): fingers along +y, palm toward the thumb side along x (ps), fingers side by side along z.
// FK per vertex: distal joint first, then middle, then knuckle (each rotation carries everything beyond it). Soft 3 mm hinge blends.
// usage: node handmorph.mjs in.glb out.glb ['{"fist":[1.3,1.5,.9],"relax":[.16,.26,.16],"thumbF":.55,"thumbR":.15}']
import * as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=Object.assign({fist:[1.3,1.5,.9],relax:[.16,.26,.16],thumbF:.55,thumbR:.15,kM:.6},cS?JSON.parse(cS):{});
const d=await io.read(iP);const root=d.getRoot();const n=d.getRoot().listNodes().find(x=>x.getName()==='Mesh_0');const sk=n.getSkin();const JN=sk.listJoints().map(j=>j.getName());const IBM=sk.getInverseBindMatrices();
const mesh=n.getMesh();const prims=mesh.listPrimitives();const p=prims[0];const P=p.getAttribute('POSITION').getArray(),J=p.getAttribute('JOINTS_0').getArray(),W=p.getAttribute('WEIGHTS_0').getArray();const nv=P.length/3;
const sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};const med=a=>{const b=a.slice().sort((x,y)=>x-y);return b[b.length>>1];};
const TG={};const info={};
for(const side of ['Left','Right']){const bi=JN.findIndex(x=>x.endsWith(side+'Hand')),be=JN.findIndex(x=>x.endsWith(side+'HandMiddle4'));const inv=new T.Matrix4().fromArray(IBM.getElement(bi,[]));const bind=inv.clone().invert();
 const vs=[];const v=new T.Vector3();for(let i=0;i<nv;i++){let w=0;for(let k=0;k<4;k++)if(J[i*4+k]===bi||J[i*4+k]===be)w+=W[i*4+k];if(w<.05)continue;v.set(P[i*3],P[i*3+1],P[i*3+2]).applyMatrix4(inv);vs.push({i,x:v.x,y:v.y,z:v.z,w});}
 const core=vs.filter(q=>q.w>.3);const ymax=Math.max(...core.map(q=>q.y));const tipC=med(core.filter(q=>q.y>ymax*.75).map(q=>q.x));const mid=core.filter(q=>q.y>ymax*.28&&q.y<ymax*.62);
 const ps=(tipC-Math.min(...mid.map(q=>q.x)))>(Math.max(...mid.map(q=>q.x))-tipC)?-1:1;const mx=tipC;
 const thumb=vs.filter(q=>(q.x-mx)*ps>.022&&q.y<ymax*.7);const tz=thumb.length?thumb.reduce((a,q)=>a+q.z,0)/thumb.length:0;const iz=Math.sign(tz)||1;
 let kM=ymax*C.kM;if(C.kM==='auto'||C.auto){const bins=new Array(30).fill(0);for(const q of core){const u=(q.y/ymax-.5)/.3;if(u>=0&&u<1)bins[Math.floor(u*30)]++;}const b=bins.indexOf(Math.max(...bins));kM=ymax*(.5+.3*(b+.5)/30);}const isThumb=q=>(q.x-mx)*ps>=.022&&q.y>.015&&q.y<kM+.004;const fing=vs.filter(q=>q.y>kM-.008&&!isThumb(q));
 const zs=fing.filter(q=>q.y>kM+.01).map(q=>q.z).sort((a,b)=>a-b);const qz=[1,2,3].map(k=>zs[Math.floor(zs.length*k/4)]);
 const fid=q=>{let f=0;for(const t of qz)if(q.z>t)f++;return iz>0?3-f:f;};/* 0 = index (thumb side) .. 3 = little */
 const F=[0,1,2,3].map(f=>{const m=fing.filter(q=>fid(q)===f);const top=Math.max(...m.map(q=>q.y));const L=top-kM;const hs=[kM,kM+.45*L,kM+.75*L];
  const hx=hs.map(h=>{const r=m.filter(q=>Math.abs(q.y-h)<.005);if(!r.length)return mx;const lo=Math.min(...r.map(q=>q.x)),hi=Math.max(...r.map(q=>q.x));const c=(lo+hi)/2;return c+ps*.25*(hi-lo);});return {hs,hx,L};});
 info[side]={ps,iz,kM,ymax,mx};
 for(const kind of ['fist','relax']){const D=new Float32Array(nv*3);const o=new T.Vector3();
  for(const q of vs){let x=q.x,y=q.y,z=q.z;const isT=isThumb(q);
   if(!isT&&q.y>kM-.008){const f=fid(q);const A=kind==='fist'?C.fist:C.relax.map(a=>a*(1+.35*f));
    for(let j=2;j>=0;j--){const h=F[f].hs[j],hx=F[f].hx[j];const t=sm(h-(C.hb||.003),h+(C.hb||.003),q.y);if(t<=0)continue;const th=-ps*A[j]*t;/* +th about z moves +y toward -x: tips toward the palm */
     const dx=x-hx,dy=y-h;x=hx+dx*Math.cos(th)-dy*Math.sin(th);y=h+dx*Math.sin(th)+dy*Math.cos(th);}}
   else if(isT){/* thumb: swings across toward the fingers (z toward the middle) and toward the palm */const a=(kind==='fist'?C.thumbF:C.thumbR)*sm(.015,.05,q.y);const bx=mx+ps*.02,by=.03;
    const dy=y-by,dz=z;const ca=Math.cos(a),sa=Math.sin(a);/* rotate about x through (by, z=0): tip moves toward z=0 */const s2=-iz;const ny=by+dy*ca-s2*dz*sa*0, nz=dz*ca+s2*dy*sa;y=ny;z=nz;x=x+ps*.006*a;}
   o.set(x-q.x,y-q.y,z-q.z).transformDirection?0:0;const dv=new T.Vector3(x,y,z).applyMatrix4(bind).sub(new T.Vector3(q.x,q.y,q.z).applyMatrix4(bind));const ww=Math.min(1,q.w*1.15);
   D[q.i*3]=dv.x*ww;D[q.i*3+1]=dv.y*ww;D[q.i*3+2]=dv.z*ww;}
  if(kind==='fist'){let sx=0,sy=0,n=0;for(const q of fing){if(q.y<kM+.01)continue;const dv=new T.Vector3(D[q.i*3],D[q.i*3+1],D[q.i*3+2]);const hp=new T.Vector3(q.x,q.y,q.z).applyMatrix4(bind).add(dv).applyMatrix4(inv);sx+=hp.x;sy+=hp.y;n++;}info[side].ring=[+(sx/n).toFixed(4),+(sy/n).toFixed(4)];console.log(side,'fist ring centroid (hand space x,y)',info[side].ring);}
  TG[kind+side]=D;}
 console.log(side,'ps',ps,'iz',iz,'kM',kM.toFixed(4),'fingers',F.map(f=>f.L.toFixed(3)).join(','));}
const buf=root.listBuffers()[0];const A=(a)=>d.createAccessor().setType('VEC3').setArray(a).setBuffer(buf);
const names=Object.keys(TG);const ex=mesh.getExtras()||{};const prev=ex.targetNames||[];
for(const [k,pr] of prims.entries()){const cnt=pr.getAttribute('POSITION').getCount();for(const nm of names)pr.addTarget(d.createPrimitiveTarget(nm).setAttribute('POSITION',A(k===0?TG[nm]:new Float32Array(cnt*3))));}
mesh.setWeights([...(mesh.getWeights()||[]),...names.map(()=>0)]).setExtras(Object.assign({},ex,{targetNames:[...prev,...names],handInfo:info}));
await io.write(oP,d);console.log('targets',[...prev,...names].join(','));
