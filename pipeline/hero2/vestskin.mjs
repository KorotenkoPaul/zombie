// Arms up (stretch, telescope, ladder, axe) showed pale yellow sweater patches on the chest and flanks: under the vest the body's flank
// carried 0.7-0.85 of the Arm bone while the vest over it carried 0.25 Arm + 0.6 Shoulder (vestarm), so the flank swung up with the arm and
// out through the vest. Here every body (and undershirt) point that lies under the vest takes the vest's own skinning, blended in by how
// close the vest is over it (C.d0..C.d1) and how far it is from the vest's open edges (C.e0..C.e1, so the sleeve at the armhole and the
// sweater at the neck/hem still follow their own bones). Body, undershirt and vest then bend as one layer under the vest.
// usage: node vestskin.mjs in.glb out.glb '{"d0":0.015,"d1":0.03,"e0":0.006,"e1":0.03}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C={d0:.015,d1:.03,e0:.006,e1:.03,k:3,...JSON.parse(cS||'{}')};const d=await io.read(iP);
const ss=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
const node=nm=>d.getRoot().listNodes().find(x=>x.getName()===nm);
const rd=nm=>{const n=node(nm);const p=n.getMesh().listPrimitives()[0];return {p,JN:n.getSkin().listJoints().map(j=>j.getName()),P:p.getAttribute('POSITION').getArray(),N:p.getAttribute('NORMAL').getArray(),J:p.getAttribute('JOINTS_0'),W:p.getAttribute('WEIGHTS_0'),I:p.getIndices().getArray()};};
const V=rd('vest');const nv=V.P.length/3;
// vest open edges: edges with one triangle over welded positions
const key=new Map(),wid=new Int32Array(nv);for(let i=0;i<nv;i++){const k=[0,1,2].map(c=>Math.round(V.P[i*3+c]*1e5)).join();if(!key.has(k))key.set(k,key.size);wid[i]=key.get(k);}
const ec=new Map();for(let t=0;t<V.I.length;t+=3)for(let e=0;e<3;e++){const a=wid[V.I[t+e]],b=wid[V.I[t+(e+1)%3]];const k=a<b?a+'_'+b:b+'_'+a;ec.set(k,(ec.get(k)||0)+1);}
const bw=new Set();for(const [k,c] of ec)if(c===1)for(const v of k.split('_'))bw.add(+v);
const BP=[];for(let i=0;i<nv;i++)if(bw.has(wid[i]))BP.push(i);
// grid over vest points
const G=new Map(),cs=.03,gk=(x,y,z)=>Math.floor(x/cs)+','+Math.floor(y/cs)+','+Math.floor(z/cs);
for(let i=0;i<nv;i++){const k=gk(V.P[i*3],V.P[i*3+1],V.P[i*3+2]);if(!G.has(k))G.set(k,[]);G.get(k).push(i);}
const near=(x,y,z)=>{const r=[];const a=Math.floor(x/cs),b=Math.floor(y/cs),c=Math.floor(z/cs);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(let l=-1;l<=1;l++){const L=G.get((a+i)+','+(b+j)+','+(c+l));if(L)for(const v of L)r.push([Math.hypot(V.P[v*3]-x,V.P[v*3+1]-y,V.P[v*3+2]-z),v]);}return r.sort((p,q)=>p[0]-q[0]);};
const vw=v=>{const o={};const j=V.J.getElement(v,[]),w=V.W.getElement(v,[]);for(let k=0;k<4;k++)if(w[k]>0)o[V.JN[j[k]]]=(o[V.JN[j[k]]]||0)+w[k];return o;};
for(const nm of ['Mesh_0','undershirt']){if(!node(nm))continue;const B=rd(nm);const idx=new Map(B.JN.map((n,i)=>[n,i]));let ch=0,full=0;
 for(let i=0;i<B.P.length/3;i++){const x=B.P[i*3],y=B.P[i*3+1],z=B.P[i*3+2];const L=near(x,y,z);if(!L.length||L[0][0]>C.d1)continue;
  const v0=L[0][1];const out=(V.P[v0*3]-x)*B.N[i*3]+(V.P[v0*3+1]-y)*B.N[i*3+1]+(V.P[v0*3+2]-z)*B.N[i*3+2];if(out<-.004)continue;
  let e=1e9;for(const b of BP)e=Math.min(e,Math.hypot(V.P[b*3]-x,V.P[b*3+1]-y,V.P[b*3+2]-z));
  const f=(1-ss(C.d0,C.d1,L[0][0]))*ss(C.e0,C.e1,e);if(f<.01)continue;
  const tv={};let sw=0;for(const [dd,v] of L.slice(0,C.k)){const q=1/(dd+.002);sw+=q;for(const [n,w] of Object.entries(vw(v)))tv[n]=(tv[n]||0)+w*q;}
  const tw={};const j=B.J.getElement(i,[]),w=B.W.getElement(i,[]);for(let k=0;k<4;k++)if(w[k]>0)tw[B.JN[j[k]]]=(tw[B.JN[j[k]]]||0)+w[k]*(1-f);
  for(const [n,q] of Object.entries(tv))tw[n]=(tw[n]||0)+q/sw*f;
  const top=Object.entries(tw).filter(([n])=>idx.has(n)).sort((p,q)=>q[1]-p[1]).slice(0,4);const s=top.reduce((u,t)=>u+t[1],0);
  const J=[0,0,0,0],W=[0,0,0,0];top.forEach(([n,q],k)=>{J[k]=idx.get(n);W[k]=q/s;});B.J.setElement(i,J);B.W.setElement(i,W);ch++;if(f>.99)full++;}
 console.log('vestskin',nm,'points',ch,'full',full);}
await io.write(oP,d);
