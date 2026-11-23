// cheap hero: drop the metal/roughness map (roughness is near-uniform: constant factor), drop skin joints no vertex uses
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {prune} from '@gltf-transform/functions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const d=await io.read(process.argv[2]);const R=+(process.argv[4]||.66);
for(const m of d.getRoot().listMaterials()){m.setMetallicRoughnessTexture(null).setRoughnessFactor(R).setMetallicFactor(0);}
for(const n of d.getRoot().listNodes()){const sk=n.getSkin(),me=n.getMesh();if(!sk||!me)continue;
 const used=new Set();for(const p of me.listPrimitives()){const J=p.getAttribute('JOINTS_0'),W=p.getAttribute('WEIGHTS_0');const j=[],w=[];
  for(let i=0;i<J.getCount();i++){J.getElement(i,j);W.getElement(i,w);for(let k=0;k<4;k++)if(w[k]>0)used.add(j[k]);}}
 const joints=sk.listJoints();const keep=[...used].sort((a,b)=>a-b);const map=new Map(keep.map((o,i)=>[o,i]));
 console.log(n.getName(),'joints',joints.length,'->',keep.length,'dropped:',joints.filter((_,i)=>!used.has(i)).map(j=>j.getName()).join(','));
 const ibm=sk.getInverseBindMatrices();const nI=new Float32Array(keep.length*16);keep.forEach((o,i)=>nI.set(ibm.getElement(o,new Array(16)),i*16));
 const ns=d.createSkin(sk.getName()).setInverseBindMatrices(d.createAccessor().setType('MAT4').setArray(nI).setBuffer(ibm.getBuffer()));keep.forEach(o=>ns.addJoint(joints[o]));if(sk.getSkeleton())ns.setSkeleton(sk.getSkeleton());
 for(const p of me.listPrimitives()){const J=p.getAttribute('JOINTS_0');const a=J.getArray().slice();const W=p.getAttribute('WEIGHTS_0');const j=[],w=[];
  for(let i=0;i<J.getCount();i++){W.getElement(i,w);for(let k=0;k<4;k++){const o=a[i*4+k];a[i*4+k]=map.has(o)?map.get(o):0;}}
  p.setAttribute('JOINTS_0',d.createAccessor().setType('VEC4').setArray(a).setBuffer(J.getBuffer()));}
 n.setSkin(ns);}
await d.transform(prune());await io.write(process.argv[3],d);
