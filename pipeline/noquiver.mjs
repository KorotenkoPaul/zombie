import fs from 'fs';import { NodeIO } from '@gltf-transform/core';import { ALL_EXTENSIONS } from '@gltf-transform/extensions';import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready;await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(process.argv[2]);const prim=doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos=prim.getAttribute('POSITION'),nor=prim.getAttribute('NORMAL');
const A=[-0.204,0.786,-0.174],B=[0.099,0.224,-0.195];const R=+process.argv[4]||.095,ZB=+process.argv[5]||-.126,YT=.67;
const ab=A.map((v,i)=>B[i]-v),L2=ab.reduce((s,v)=>s+v*v,0);const e=[],n=[];let moved=0;
for(let i=0;i<pos.getCount();i++){pos.getElement(i,e);const t=Math.max(-.08,Math.min(1.08,((e[0]-A[0])*ab[0]+(e[1]-A[1])*ab[1]+(e[2]-A[2])*ab[2])/L2));
 const c=A.map((v,k)=>v+ab[k]*t);const d=Math.hypot(e[0]-c[0],e[1]-c[1],e[2]-c[2]);if(d>R||e[2]>=ZB)continue;
 e[2]=ZB+(e[2]-ZB)*.12;if(e[1]>YT&&e[0]<-.06)e[1]=YT+(e[1]-YT)*.15;pos.setElement(i,e);if(nor){nor.getElement(i,n);n[0]*=.3;n[1]*=.3;n[2]=-1;const l=Math.hypot(...n);nor.setElement(i,n.map(v=>v/l));}moved++;}
console.log('moved',moved);await io.write(process.argv[3],doc);
