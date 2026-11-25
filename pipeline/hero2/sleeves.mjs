// Chunkier knit sleeves like concept 6: push the Arm/ForeArm-weighted body surface out along the (position-welded) normal,
// tapered to 0 at the cuff and at the shoulder seam. Mesh only; skeleton and weights unchanged.
// usage: node sleeves.mjs in.glb out.glb '{"d":0.012}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=JSON.parse(cS);const d=await io.read(iP);
const n=d.getRoot().listNodes().find(x=>x.getName()==='Mesh_0');const JN=n.getSkin().listJoints().map(j=>j.getName().replace('mixamorig:',''));
const p=n.getMesh().listPrimitives()[0];const P=p.getAttribute('POSITION').getArray().slice(),N=p.getAttribute('NORMAL').getArray(),J=p.getAttribute('JOINTS_0').getArray(),W=p.getAttribute('WEIGHTS_0').getArray();
const nv=P.length/3;const wOf=(i,re)=>{let w=0;for(let k=0;k<4;k++)if(re.test(JN[J[i*4+k]]))w+=W[i*4+k];return w;};
const key=i=>[0,1,2].map(k=>Math.round(P[i*3+k]*4000)).join(',');const acc=new Map();
for(let i=0;i<nv;i++){const k=key(i);const a=acc.get(k)||[0,0,0];a[0]+=N[i*3];a[1]+=N[i*3+1];a[2]+=N[i*3+2];acc.set(k,a);}
let ch=0;const out=P.slice();
for(let i=0;i<nv;i++){const arm=wOf(i,/^(Left|Right)(Arm|ForeArm)$/),hand=wOf(i,/Hand/),sh=wOf(i,/Shoulder|Spine|Neck/);
 const f=Math.max(0,arm-hand*2-sh*1.5);if(f<=0.02)continue;const a=acc.get(key(i));const l=Math.hypot(...a)||1;const s=C.d*Math.min(1,f*1.3);
 for(let k=0;k<3;k++)out[i*3+k]=P[i*3+k]+a[k]/l*s;ch++;}
p.getAttribute('POSITION').setArray(out);console.log('sleeve verts',ch);await io.write(oP,d);
