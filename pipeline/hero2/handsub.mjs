// Hands: ~400 points each, so every finger read as a row of flat blocks at the closest zoom (pass vs concept 6). The hand's triangles
// (all three corners mainly on a Hand bone) are split in four, then the new and old points inside the hand are smoothed (Taubin, no
// shrink) over welded positions; the wrist border stays. Runs before handmorph.mjs, so the fist/relax finger curls are built on the
// finer hand exactly as before (same bones, weights interpolated along each edge).
// usage: node handsub.mjs in.glb out.glb '{"it":6,"l":0.5,"m":-0.53}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C={ring:4,it:6,l:.5,m:-.53,...JSON.parse(cS||'{}')};const d=await io.read(iP);
const n=d.getRoot().listNodes().find(x=>x.getName()==='Mesh_0');const JN=n.getSkin().listJoints().map(j=>j.getName());const p=n.getMesh().listPrimitives()[0];
if(p.listTargets().length)throw new Error('handsub must run before any morph targets');
const A={};for(const s of p.listSemantics())A[s]=p.getAttribute(s);const nv=A.POSITION.getCount();const I=Array.from(p.getIndices().getArray());
const get=(s,i)=>{const a=A[s],k=a.getElementSize();return Array.from(a.getArray().slice(i*k,i*k+k));};
const isH=new Uint8Array(nv);for(let i=0;i<nv;i++){const j=get('JOINTS_0',i),w=get('WEIGHTS_0',i);let b=0;for(let k=1;k<4;k++)if(w[k]>w[b])b=k;isH[i]=/Hand/.test(JN[j[b]])?1:0;}
const V={};for(const s in A)V[s]=[];for(let i=0;i<nv;i++)for(const s in A)V[s].push(get(s,i));
const mid=new Map();const mk=(a,b)=>{const k=a<b?a+'_'+b:b+'_'+a;if(mid.has(k))return mid.get(k);const i=V.POSITION.length;
 for(const s in A){const x=V[s][a],y=V[s][b];if(s==='JOINTS_0')continue;if(s==='WEIGHTS_0'){const ws={};for(const [v,t] of [[a,x],[b,y]]){const jj=V.JOINTS_0[v];for(let k=0;k<4;k++)if(t[k]>0)ws[jj[k]]=(ws[jj[k]]||0)+t[k]/2;}
   const top=Object.entries(ws).sort((p,q)=>q[1]-p[1]).slice(0,4);const sm=top.reduce((u,e)=>u+e[1],0);const J=[0,0,0,0],W=[0,0,0,0];top.forEach((e,k)=>{J[k]=+e[0];W[k]=e[1]/sm;});V.JOINTS_0.push(J);V.WEIGHTS_0.push(W);continue;}
  const m=x.map((v,c)=>(v+y[c])/2);if(s==='NORMAL'){const l=Math.hypot(...m)||1;V[s].push(m.map(v=>v/l));}else V[s].push(m);}
 mid.set(k,i);return i;};
const out=[];let nt=0;for(let t=0;t<I.length;t+=3){const [a,b,c]=[I[t],I[t+1],I[t+2]];if(isH[a]&&isH[b]&&isH[c]){const ab=mk(a,b),bc=mk(b,c),ca=mk(c,a);out.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);nt++;}else out.push(a,b,c);}
const N=V.POSITION.length;const inH=new Uint8Array(N);for(let i=0;i<N;i++)inH[i]=i<nv?isH[i]:1;
// welded smoothing of the hand's points; any point on a triangle that is not all-hand (the wrist) stays put
const key=new Map(),wid=new Int32Array(N);for(let i=0;i<N;i++){const k=V.POSITION[i].map(v=>Math.round(v*1e5)).join();if(!key.has(k))key.set(k,key.size);wid[i]=key.get(k);}
const nw=key.size;const W=new Float64Array(nw*3);for(let i=0;i<N;i++)for(let c=0;c<3;c++)W[wid[i]*3+c]=V.POSITION[i][c];
const adj=Array.from({length:nw},()=>new Set());const fix=new Uint8Array(nw);const hw=new Uint8Array(nw);for(let i=0;i<N;i++)if(inH[i])hw[wid[i]]=1;
for(let t=0;t<out.length;t+=3){const tri=[out[t],out[t+1],out[t+2]];const all=tri.every(i=>inH[i]);for(let e=0;e<3;e++){const a=wid[tri[e]],b=wid[tri[(e+1)%3]];adj[a].add(b);adj[b].add(a);}if(!all)for(const i of tri)fix[wid[i]]=1;}
// smoothing fades in over C.ring rings from the fixed wrist points, so the wrist skin does not pull away from the sleeve
const rg=new Int32Array(nw).fill(1e6);let fr=[];for(let v=0;v<nw;v++)if(fix[v]){rg[v]=0;fr.push(v);}while(fr.length){const nf=[];for(const v of fr)for(const u of adj[v])if(rg[u]>rg[v]+1){rg[u]=rg[v]+1;nf.push(u);}fr=nf;}
const step=f=>{const Nw=new Float64Array(W);for(let v=0;v<nw;v++){if(!hw[v]||fix[v]||!adj[v].size)continue;const g=Math.min(1,rg[v]/C.ring);const s=[0,0,0];for(const u of adj[v])for(let c=0;c<3;c++)s[c]+=W[u*3+c];for(let c=0;c<3;c++)Nw[v*3+c]=W[v*3+c]+g*f*(s[c]/adj[v].size-W[v*3+c]);}W.set(Nw);};
for(let k=0;k<C.it;k++){step(C.l);step(C.m);}
for(let i=0;i<N;i++)if(inH[i])for(let c=0;c<3;c++)V.POSITION[i][c]=W[wid[i]*3+c];
// normals of the hand: area-weighted over welded points (smooth), the rest as before
const NA=new Float64Array(nw*3);for(let t=0;t<out.length;t+=3){const [a,b,c]=[out[t],out[t+1],out[t+2]];if(!(inH[a]&&inH[b]&&inH[c]))continue;const pa=V.POSITION[a],pb=V.POSITION[b],pc=V.POSITION[c];
 const u=[0,1,2].map(k=>pb[k]-pa[k]),v=[0,1,2].map(k=>pc[k]-pa[k]);const nx=u[1]*v[2]-u[2]*v[1],ny=u[2]*v[0]-u[0]*v[2],nz=u[0]*v[1]-u[1]*v[0];for(const i of [a,b,c]){NA[wid[i]*3]+=nx;NA[wid[i]*3+1]+=ny;NA[wid[i]*3+2]+=nz;}}
for(let i=0;i<N;i++){if(!inH[i]||fix[wid[i]])continue;const x=NA[wid[i]*3],y=NA[wid[i]*3+1],z=NA[wid[i]*3+2],l=Math.hypot(x,y,z);if(l>0)V.NORMAL[i]=[x/l,y/l,z/l];}
for(const s in A){const a=A[s];const k=a.getElementSize();const Ctor=a.getArray().constructor;const arr=new Ctor(N*k);for(let i=0;i<N;i++)for(let c=0;c<k;c++)arr[i*k+c]=V[s][i][c];a.setArray(arr);}
const Ictor=N>65535?Uint32Array:p.getIndices().getArray().constructor;p.getIndices().setArray(new (N>65535?Uint32Array:Ictor)(out));
console.log('hand tris',nt,'->',nt*4,'points',nv,'->',N);await io.write(oP,d);
