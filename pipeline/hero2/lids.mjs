// Add an "eyelids" skinned mesh (bound to Head) with morph targets blink / blinkL / blinkR.
// usage: node lids.mjs in.glb out.glb '{"L":[cx,cy,w,h],"R":[...],"skin":[x,y],"lash":[x,y]}'   (front-view coords in mesh space, metres)
import fs from 'fs';import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,inP,outP,cfgS]=process.argv;const C=JSON.parse(cfgS);
const d=await io.read(inP);const root=d.getRoot();const mesh0=root.listMeshes()[0];const PL=(process.env.PRIM||'0').split(',').map(Number);const p=mesh0.listPrimitives()[PL[0]];
let P=[],UV=[],I=[];for(const k of PL){const q=mesh0.listPrimitives()[k];const o=P.length/3;P.push(...q.getAttribute('POSITION').getArray());UV.push(...q.getAttribute('TEXCOORD_0').getArray());for(const i of q.getIndices().getArray())I.push(i+o);}
const tris=[];for(let t=0;t<I.length;t+=3){if(P[I[t]*3+1]>(C.ymin??1.35)&&P[I[t]*3+2]>0)tris.push(t);}
const va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3(),ray=new T.Ray(),tgt=new T.Vector3();
function cast(x,y){ray.set(new T.Vector3(x,y,1),new T.Vector3(0,0,-1));let best=null;
 for(const t of tris){const a=I[t],b=I[t+1],c=I[t+2];va.fromArray(P,a*3);vb.fromArray(P,b*3);vc.fromArray(P,c*3);
  if(!ray.intersectTriangle(va,vb,vc,false,tgt))continue;if(best&&tgt.z<=best.p.z)continue;
  const bc=T.Triangle.getBarycoord(tgt,va,vb,vc,new T.Vector3());const n=new T.Triangle(va,vb,vc).getNormal(new T.Vector3());if(n.z<0)n.negate();
  best={p:tgt.clone(),n,uv:[UV[a*2]*bc.x+UV[b*2]*bc.y+UV[c*2]*bc.z,UV[a*2+1]*bc.x+UV[b*2+1]*bc.y+UV[c*2+1]*bc.z]};}
 return best;}
const skinUV=cast(...C.skin).uv,lashUV=cast(...C.lash).uv;
const colUV=(x,y)=>{const ref=cast(C[x<0?'L':'R'][0],y+.003).uv;const h=cast(x,y+.003);return h&&Math.hypot(h.uv[0]-ref[0],h.uv[1]-ref[1])<.01?h.uv:ref;};
const COLS=11,ROWS=[0,.25,.5,.75,.9,1];const OFF=C.off||.0013;
const pos=[],nor=[],uv=[],idx=[],mT={blink:[],blinkL:[],blinkR:[]};
for(const side of ['L','R']){const [cx,cy,w,h]=C[side];const base=pos.length/3;
 for(let r=0;r<ROWS.length;r++)for(let c=0;c<COLS;c++){const u=-1+2*c/(COLS-1);const k=Math.pow(Math.max(0,1-u*u),C.pow??.55);
  const x=cx+u*w/2, yTop=cy+k*h*.62, yBot=cy-k*h*.45; const y=yTop+(yBot-yTop)*ROWS[r];
  const top=cast(x,yTop),tg=cast(x,y);const pt=top.p.clone().addScaledVector(top.n,OFF),pc=tg.p.clone().addScaledVector(tg.n,OFF*(1+.3*Math.sin(Math.PI*ROWS[r])*k));
  pos.push(pt.x,pt.y,pt.z);const nn=tg.n.clone().multiplyScalar(.7).add(new T.Vector3(0,.1,.45)).normalize();nor.push(nn.x,nn.y,nn.z);const U=r===ROWS.length-1?lashUV:(C.flat?[skinUV[0]+u*.004,skinUV[1]+ROWS[r]*.004]:colUV(x,yTop));uv.push(U[0],U[1]);
  const dlt=[pc.x-pt.x,pc.y-pt.y,pc.z-pt.z];mT.blink.push(...dlt);mT['blink'+side].push(...dlt);mT['blink'+(side==='L'?'R':'L')].push(0,0,0);}
 for(let r=0;r<ROWS.length-1;r++)for(let c=0;c<COLS-1;c++){const a=base+r*COLS+c,b=a+1,e=a+COLS,f=e+1;idx.push(a,e,b,b,e,f);}}
const nv=pos.length/3;const buf=root.listBuffers()[0];const A=(t,a)=>d.createAccessor().setType(t).setArray(a).setBuffer(buf);
const skin=root.listSkins()[0];const head=skin.listJoints().findIndex(j=>/Head$/.test(j.getName()));
const J=new Uint16Array(nv*4),W=new Float32Array(nv*4);for(let i=0;i<nv;i++){J[i*4]=head;W[i*4]=1;}
const prim=d.createPrimitive().setMaterial(p.getMaterial()).setIndices(A('SCALAR',new Uint16Array(idx)))
 .setAttribute('POSITION',A('VEC3',new Float32Array(pos))).setAttribute('NORMAL',A('VEC3',new Float32Array(nor))).setAttribute('TEXCOORD_0',A('VEC2',new Float32Array(uv)))
 .setAttribute('JOINTS_0',A('VEC4',J)).setAttribute('WEIGHTS_0',A('VEC4',W));
const names=Object.keys(mT);for(const k of names)prim.addTarget(d.createPrimitiveTarget(k).setAttribute('POSITION',A('VEC3',new Float32Array(mT[k]))));
const m=d.createMesh('eyelids').addPrimitive(prim).setWeights(names.map(()=>0)).setExtras({targetNames:names});
const n0=root.listNodes().find(n=>n.getMesh()===mesh0);
const n=d.createNode('eyelids').setMesh(m).setSkin(skin).setTranslation(n0.getTranslation()).setRotation(n0.getRotation()).setScale(n0.getScale());
const par=n0.getParentNode();if(par)par.addChild(n);else root.listScenes()[0].addChild(n);
await io.write(outP,d);console.log('eyelids',nv,'verts',idx.length/3,'tris; head joint',head);
