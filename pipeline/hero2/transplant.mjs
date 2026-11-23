// Re-skin a Meshy-rigged mesh (mixamo template) onto the EXISTING hero skeleton (same nodes, rest pose, IBMs, animations).
// usage: node transplant.mjs old.glb rig.glb out.glb
import fs from 'fs';import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const [,,oldP,rigP,outP]=process.argv;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const od=await io.read(oldP), rd=await io.read(rigP);
const nm=n=>n.getName().replace('mixamorig','').replace(':','');
function skinInfo(doc){const skin=doc.getRoot().listSkins()[0];const joints=skin.listJoints();const ibm=skin.getInverseBindMatrices();
 const bind={};joints.forEach((j,i)=>{const m=new T.Matrix4().fromArray(ibm.getElement(i,new Array(16)));bind[nm(j)]=m.invert();});
 const par={};joints.forEach(j=>{const p=j.listParents().find(p=>p.propertyType==='Node');par[nm(j)]=p&&joints.includes(p)?nm(p):null;});
 return {skin,joints:joints.map(nm),bind,par};}
const O=skinInfo(od),R=skinInfo(rd);
console.log('old joints',O.joints.join(','));console.log('rig joints',R.joints.join(','));
const prim=d=>d.getRoot().listMeshes()[0].listPrimitives()[0];
const op=prim(od),rp=prim(rd);
const arr=a=>a.getArray();
const P=arr(rp.getAttribute('POSITION')),N=arr(rp.getAttribute('NORMAL')),UV=arr(rp.getAttribute('TEXCOORD_0')),J=arr(rp.getAttribute('JOINTS_0')),Wt=arr(rp.getAttribute('WEIGHTS_0'));
const nv=P.length/3;
const pos=(S,n)=>new T.Vector3().setFromMatrixPosition(S.bind[n]);
// uniform scale + offset: match total height (feet->top) and put feet on the same floor, centred on hips x/z
const bboxY=(arrP)=>{let a=1e9,b=-1e9;for(let i=1;i<arrP.length;i+=3){a=Math.min(a,arrP[i]);b=Math.max(b,arrP[i]);}return [a,b];};
const [oy0,oy1]=bboxY(arr(op.getAttribute('POSITION'))),[ry0,ry1]=bboxY(P);
const s=(oy1-oy0)/(ry1-ry0);const oh=pos(O,'Hips'),rh=pos(R,'Hips');
const pre=v=>v.set((v.x-rh.x)*s+oh.x,(v.y-ry0)*s+oy0,(v.z-rh.z)*s+oh.z);
console.log('scale',s.toFixed(3),'old h',(oy1-oy0).toFixed(3),'hips old',oh.y.toFixed(3),'rig hips scaled',((rh.y-ry0)*s+oy0).toFixed(3));
const CH={Hips:'Spine',Spine:'Spine1',Spine1:'Spine2',Spine2:'Neck',Neck:'Head',Head:'HeadTop_End',LeftShoulder:'LeftArm',LeftArm:'LeftForeArm',LeftForeArm:'LeftHand',LeftHand:'LeftHandMiddle4',
 RightShoulder:'RightArm',RightArm:'RightForeArm',RightForeArm:'RightHand',RightHand:'RightHandMiddle4',LeftUpLeg:'LeftLeg',LeftLeg:'LeftFoot',LeftFoot:'LeftToeBase',LeftToeBase:'LeftToe_End',
 RightUpLeg:'RightLeg',RightLeg:'RightFoot',RightFoot:'RightToeBase',RightToeBase:'RightToe_End'};
const M={};
for(const j of O.joints){const k=CH[j]?j:O.par[j];const c=CH[k];
 const a0=pre(pos(R,k)),a1=pre(pos(R,c)),b0=pos(O,k),b1=pos(O,c);
 const dn=a1.clone().sub(a0),dO=b1.clone().sub(b0);const ln=dn.length(),lo=dO.length();dn.normalize();dO.normalize();
 const q=(k==='Hips')?new T.Quaternion():new T.Quaternion().setFromUnitVectors(dn,dO);
 const st=(k==='Hips')?1:lo/ln;
 // x -> b0 + q*( (x-a0) + (st-1)*dn*dot(x-a0,dn) )
 M[j]={a0,b0,q,st,dn};}
const out=new Float32Array(P.length),outN=new Float32Array(N.length),Jn=new Uint16Array(J.length);
const oIdx=Object.fromEntries(O.joints.map((n,i)=>[n,i]));
const v=new T.Vector3(),t=new T.Vector3(),acc=new T.Vector3(),nn=new T.Vector3(),accN=new T.Vector3();
let miss=new Set();
for(let i=0;i<nv;i++){pre(v.fromArray(P,i*3));acc.set(0,0,0);accN.set(0,0,0);
 for(let k=0;k<4;k++){const w=Wt[i*4+k];let jn=R.joints[J[i*4+k]];while(!(jn in oIdx)){miss.add(jn);jn=R.par[jn];}Jn[i*4+k]=oIdx[jn];if(!w)continue;
  const m=M[jn];t.copy(v).sub(m.a0);t.addScaledVector(m.dn,(m.st-1)*t.dot(m.dn));t.applyQuaternion(m.q).add(m.b0);acc.addScaledVector(t,w);
  nn.fromArray(N,i*3).applyQuaternion(m.q);accN.addScaledVector(nn,w);}
 acc.toArray(out,i*3);accN.normalize().toArray(outN,i*3);}
if(miss.size)console.log('remapped missing joints to parents:',[...miss].join(','));
// smooth normals across UV seams/facets: weld by position, area-weighted face normals
{const key=i=>Math.round(out[i*3]*2e4)+','+Math.round(out[i*3+1]*2e4)+','+Math.round(out[i*3+2]*2e4);const grp={},gi=new Int32Array(nv);let ng=0;
 for(let i=0;i<nv;i++){const k=key(i);if(!(k in grp))grp[k]=ng++;gi[i]=grp[k];}
 const acc=new Float32Array(ng*3);const I=rp.getIndices().getArray();const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
 for(let t=0;t<I.length;t+=3){a.fromArray(out,I[t]*3);b.fromArray(out,I[t+1]*3);c.fromArray(out,I[t+2]*3);const n=b.clone().sub(a).cross(c.clone().sub(a));
  for(const v of [I[t],I[t+1],I[t+2]]){acc[gi[v]*3]+=n.x;acc[gi[v]*3+1]+=n.y;acc[gi[v]*3+2]+=n.z;}}
 for(let i=0;i<nv;i++){const g=gi[i];const n=new T.Vector3(acc[g*3],acc[g*3+1],acc[g*3+2]);if(n.lengthSq()>0){n.normalize();if(n.dot(new T.Vector3().fromArray(outN,i*3))<-.2)continue;n.toArray(outN,i*3);}}
 console.log('normals smoothed, groups',ng,'of',nv);}
// write into old doc
const buf=od.getRoot().listBuffers()[0];
const A=(type,a)=>od.createAccessor().setType(type).setArray(a).setBuffer(buf);
for(const s of op.listSemantics())op.setAttribute(s,null);
op.setAttribute('POSITION',A('VEC3',out)).setAttribute('NORMAL',A('VEC3',outN)).setAttribute('TEXCOORD_0',A('VEC2',new Float32Array(UV)))
  .setAttribute('JOINTS_0',A('VEC4',Jn)).setAttribute('WEIGHTS_0',A('VEC4',new Float32Array(Wt)));
op.setIndices(A('SCALAR',new Uint32Array(rp.getIndices().getArray())));
// material: new base colour texture, matte
const om=op.getMaterial(),rm=rp.getMaterial();const rt=rm.getBaseColorTexture();
const tex=od.createTexture('hero2_base').setImage(rt.getImage()).setMimeType(rt.getMimeType());
om.setBaseColorTexture(tex).setMetallicRoughnessTexture(null).setNormalTexture(null).setMetallicFactor(0).setRoughnessFactor(.9).setBaseColorFactor([1,1,1,1]);
for(const t of od.getRoot().listTextures())if(t!==tex&&!t.listParents().some(p=>p.propertyType==='Material'))t.dispose();
await io.write(outP,od);console.log('wrote',outP,fs.statSync(outP).size);
