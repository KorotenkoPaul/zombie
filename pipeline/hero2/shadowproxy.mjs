// Shadow-only proxy for the hero: Mesh_0's primitives (body + head) merged, welded by position, decimated, same skin.
// The game puts it on a layer only the shadow cameras see and turns castShadow off on Mesh_0 (vest/boots keep their own shadows,
// so taking them off still shows in the shadow).
// usage: node shadowproxy.mjs in.glb out.glb ratio
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {weld,simplify,normals,prune} from '@gltf-transform/functions';import {MeshoptSimplifier} from 'meshoptimizer';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,rS]=process.argv;const d=await io.read(iP);const root=d.getRoot();
const n0=root.listNodes().find(n=>n.getName()==='Mesh_0');const buf=root.listBuffers()[0];
const P=[],J=[],W=[],I=[];
for(const p of n0.getMesh().listPrimitives()){const o=P.length/3;P.push(...p.getAttribute('POSITION').getArray());J.push(...p.getAttribute('JOINTS_0').getArray());W.push(...p.getAttribute('WEIGHTS_0').getArray());for(const i of p.getIndices().getArray())I.push(i+o);}
const A=(t,a)=>d.createAccessor().setType(t).setArray(a).setBuffer(buf);
const prim=d.createPrimitive().setAttribute('POSITION',A('VEC3',new Float32Array(P))).setAttribute('JOINTS_0',A('VEC4',new Uint16Array(J))).setAttribute('WEIGHTS_0',A('VEC4',new Float32Array(W))).setIndices(A('SCALAR',new Uint32Array(I)))
 .setMaterial(d.createMaterial('heroShadow').setBaseColorFactor([0,0,0,1]).setMetallicFactor(0).setRoughnessFactor(1));
const mesh=d.createMesh('heroShadow').addPrimitive(prim);
const node=d.createNode('heroShadow').setMesh(mesh).setSkin(n0.getSkin()).setTranslation(n0.getTranslation()).setRotation(n0.getRotation()).setScale(n0.getScale());
const par=n0.getParentNode();if(par)par.addChild(node);else root.listScenes()[0].addChild(node);
await MeshoptSimplifier.ready;
// weld/simplify only this mesh: run on a temporary document view by filtering is not available, so do it on the whole doc but
// only this primitive changes (the others are untouched by weld when their attributes already are unique? no) -> do it by hand:
const tmp=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const {Document}=await import('@gltf-transform/core');const td=new Document();const tb=td.createBuffer();
const tp=td.createPrimitive().setAttribute('POSITION',td.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(tb)).setAttribute('JOINTS_0',td.createAccessor().setType('VEC4').setArray(new Uint16Array(J)).setBuffer(tb)).setAttribute('WEIGHTS_0',td.createAccessor().setType('VEC4').setArray(new Float32Array(W)).setBuffer(tb)).setIndices(td.createAccessor().setType('SCALAR').setArray(new Uint32Array(I)).setBuffer(tb));
td.createNode().setMesh(td.createMesh().addPrimitive(tp));td.getRoot().listScenes().length||td.createScene().addChild(td.getRoot().listNodes()[0]);
await td.transform(weld({tolerance:0.0015}),simplify({simplifier:MeshoptSimplifier,ratio:+rS,error:0.02}));
const q=td.getRoot().listMeshes()[0].listPrimitives()[0];
for(const s of ['POSITION','JOINTS_0','WEIGHTS_0'])prim.setAttribute(s,A(q.getAttribute(s).getType(),q.getAttribute(s).getArray().slice()));
{const Q=q.getAttribute('POSITION').getArray(),X=q.getIndices().getArray(),N=new Float32Array(Q.length);
 for(let t=0;t<X.length;t+=3){const [a,b,c]=[X[t],X[t+1],X[t+2]];const ux=Q[b*3]-Q[a*3],uy=Q[b*3+1]-Q[a*3+1],uz=Q[b*3+2]-Q[a*3+2],vx=Q[c*3]-Q[a*3],vy=Q[c*3+1]-Q[a*3+1],vz=Q[c*3+2]-Q[a*3+2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;for(const i of [a,b,c]){N[i*3]+=nx;N[i*3+1]+=ny;N[i*3+2]+=nz;}}
 for(let i=0;i<N.length;i+=3){const l=Math.hypot(N[i],N[i+1],N[i+2])||1;N[i]/=l;N[i+1]/=l;N[i+2]/=l;}prim.setAttribute('NORMAL',A('VEC3',N));}
prim.setIndices(A('SCALAR',q.getIndices().getArray().slice()));
console.log('heroShadow tris',q.getIndices().getCount()/3,'verts',q.getAttribute('POSITION').getCount(),'from',I.length/3);
await d.transform(prune());await io.write(oP,d);
