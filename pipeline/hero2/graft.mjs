// Graft a separate high-res head (unrigged Meshy glb, y-up, face +z) onto the hero body: remove the body's head and upper neck,
// fit the new head inside a target box, skin it to Head/Neck, add it to Mesh_0 as a second primitive with its own material.
// usage: node graft.mjs body.glb head.glb out.glb '{"s":0.205,"chinIn":-0.5,"chinOut":0.625,"zc":-0.024,"cut":0.56}'
import * as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {prune} from '@gltf-transform/functions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,bP,hP,oP,cS]=process.argv;const C=JSON.parse(cS);
const d=await io.read(bP),hd=await io.read(hP);const root=d.getRoot();
const node=root.listNodes().find(n=>n.getName()==='Mesh_0');const mesh=node.getMesh();const p=mesh.listPrimitives()[0];const skin=node.getSkin();
const J=skin.listJoints().map(j=>j.getName().replace('mixamorig','').replace(':',''));const ji=n=>J.indexOf(n);
// 1) cut the body's head + upper neck
{const P=p.getAttribute('POSITION').getArray(),Ja=p.getAttribute('JOINTS_0').getArray(),W=p.getAttribute('WEIGHTS_0').getArray(),I=p.getIndices().getArray();
 const hw=i=>{let w=0;for(let k=0;k<4;k++)if(/^(Head|HeadTop_End|headfront|Neck)$/.test(J[Ja[i*4+k]]))w+=W[i*4+k];return w;};
 const keep=[];let cut=0;for(let t=0;t<I.length;t+=3){let all=true;for(let k=0;k<3;k++){const i=I[t+k];if(!(hw(i)>.5&&P[i*3+1]>C.cut))all=false;}if(all){cut++;continue;}keep.push(I[t],I[t+1],I[t+2]);}
 const used=new Int32Array(P.length/3).fill(-1);let nu=0;for(const i of keep)if(used[i]<0)used[i]=nu++;
 for(const sem of p.listSemantics()){const a=p.getAttribute(sem),e=a.getElementSize(),src=a.getArray(),dst=new src.constructor(nu*e);for(let i=0;i<used.length;i++)if(used[i]>=0)for(let k=0;k<e;k++)dst[used[i]*e+k]=src[i*e+k];a.setArray(dst);}
 for(const t of p.listTargets())for(const sem of t.listSemantics()){const a=t.getAttribute(sem),e=a.getElementSize(),src=a.getArray(),dst=new src.constructor(nu*e);for(let i=0;i<used.length;i++)if(used[i]>=0)for(let k=0;k<e;k++)dst[used[i]*e+k]=src[i*e+k];a.setArray(dst);}
 p.getIndices().setArray(new Uint32Array(keep.map(i=>used[i])));console.log('body tris cut',cut,'verts',P.length/3,'->',nu);}
// 2) head geometry
const hp=hd.getRoot().listMeshes()[0].listPrimitives()[0];const HP=hp.getAttribute('POSITION').getArray(),HN=hp.getAttribute('NORMAL').getArray(),HUV=hp.getAttribute('TEXCOORD_0').getArray(),HI=hp.getIndices().getArray();
const nv=HP.length/3;const pos=new Float32Array(nv*3),nor=new Float32Array(nv*3),jo=new Uint16Array(nv*4),we=new Float32Array(nv*4);
let mnx=9,mxx=-9;for(let i=0;i<nv;i++){mnx=Math.min(mnx,HP[i*3]);mxx=Math.max(mxx,HP[i*3]);}const xc=(mnx+mxx)/2;
const yHead=C.chinOut+(C.blend??0.02),yNeck=C.chinOut-(C.blend2??0.05);
for(let i=0;i<nv;i++){const x=(HP[i*3]-xc)*C.s,y=(HP[i*3+1]-C.chinIn)*C.s+C.chinOut,z=HP[i*3+2]*C.s+C.zc;pos.set([x,y,z],i*3);nor.set([HN[i*3],HN[i*3+1],HN[i*3+2]],i*3);
 const t=Math.max(0,Math.min(1,(y-yNeck)/(yHead-yNeck)));const tt=t*t*(3-2*t);jo.set([ji('Head'),ji('Neck'),0,0],i*4);we.set([tt,1-tt,0,0],i*4);}
const acc=(a,type)=>d.createAccessor().setArray(a).setType(type).setBuffer(root.listBuffers()[0]);
// keep the bust's shoulders out (they would poke through the vest when the arms move)
const YC=C.ycut??-0.62;const HU=new Float32Array(HUV);
const hm=hp.getMaterial();const om=p.getMaterial();
const cp=t=>t?d.createTexture(t.getName()||'head').setImage(t.getImage()).setMimeType(t.getMimeType()):null;
const m=d.createMaterial('head').setBaseColorTexture(cp(hm.getBaseColorTexture())).setNormalTexture(cp(hm.getNormalTexture())).setMetallicFactor(0).setRoughnessFactor(om.getRoughnessFactor()).setBaseColorFactor([1,1,1,1]);
// two halves (x<0 / x>=0): each stays smaller than the body primitive, which the game finds as the largest skinned mesh
const parts=[[],[]];for(let t=0;t<HI.length;t+=3){const a=HI[t],b=HI[t+1],c=HI[t+2];if(Math.min(HP[a*3+1],HP[b*3+1],HP[c*3+1])<YC)continue;parts[(HP[a*3]+HP[b*3]+HP[c*3])/3<xc?0:1].push(a,b,c);}
let tv=0,tt=0;for(const tri of parts){const map=new Map();const ix=tri.map(i=>{if(!map.has(i))map.set(i,map.size);return map.get(i);});const n=map.size;
 const P2=new Float32Array(n*3),N2=new Float32Array(n*3),U2=new Float32Array(n*2),J2=new Uint16Array(n*4),W2=new Float32Array(n*4);
 for(const [o,k] of map){P2.set(pos.subarray(o*3,o*3+3),k*3);N2.set(nor.subarray(o*3,o*3+3),k*3);U2.set(HU.subarray(o*2,o*2+2),k*2);J2.set(jo.subarray(o*4,o*4+4),k*4);W2.set(we.subarray(o*4,o*4+4),k*4);}
 const np=d.createPrimitive().setAttribute('POSITION',acc(P2,'VEC3')).setAttribute('NORMAL',acc(N2,'VEC3')).setAttribute('TEXCOORD_0',acc(U2,'VEC2'))
  .setAttribute('JOINTS_0',acc(J2,'VEC4')).setAttribute('WEIGHTS_0',acc(W2,'VEC4')).setIndices(acc(new Uint32Array(ix),'SCALAR')).setMaterial(m);mesh.addPrimitive(np);tv+=n;tt+=ix.length/3;console.log('head part',n,'verts');}
await d.transform(prune());await io.write(oP,d);console.log('head verts',tv,'tris',tt);
