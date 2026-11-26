// R63-2/R64: slits on the sweater in bed (vest off). The body under the vest is a set of panels with cracks and folded fringes between
// them, and the undershirt (undervest's shell, the same triangles pushed IN along split normals) cracked in the same places, so the
// slits showed straight through. Here the undershirt is rebuilt as one sheet over the body instead: its points are put back on the body
// (+N*C.shell), exact duplicates welded, crack rims (open-border points) closer than C.r to another border point merged, and the sheet
// pushed OUT along the welded, area-weighted normal by C.out, so with the vest off it covers the cracks and fringes.
// usage: node underweld.mjs in.glb out.glb '{"r":0.012,"out":0.004,"shell":0.009}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C={r:.012,out:.004,shell:.009,...JSON.parse(cS||'{}')};const d=await io.read(iP);
const n=d.getRoot().listNodes().find(x=>x.getName()==='undershirt');const p=n.getMesh().listPrimitives()[0];
const PA=p.getAttribute('POSITION'),NA=p.getAttribute('NORMAL'),JA=p.getAttribute('JOINTS_0'),WA=p.getAttribute('WEIGHTS_0');const P=PA.getArray().slice(),N=NA.getArray().slice(),I=Array.from(p.getIndices().getArray());const nv=P.length/3;
for(let i=0;i<nv*3;i++)P[i]+=N[i]*C.shell;
const par=new Int32Array(nv).map((_,i)=>i);const f=i=>{while(par[i]!==i){par[i]=par[par[i]];i=par[i];}return i;};const U=(a,b)=>{a=f(a);b=f(b);if(a!==b)par[b]=a;};
const key=new Map();for(let i=0;i<nv;i++){const k=[0,1,2].map(c=>Math.round(P[i*3+c]*1e5)).join();if(key.has(k))U(key.get(k),i);else key.set(k,i);}
const ec=new Map();for(let t=0;t<I.length;t+=3)for(let e=0;e<3;e++){const a=f(I[t+e]),b=f(I[t+(e+1)%3]);const k=a<b?a+'_'+b:b+'_'+a;ec.set(k,(ec.get(k)||0)+1);}
const bd=new Set();for(const [k,c] of ec)if(c===1)for(const v of k.split('_'))bd.add(+v);const B=[...bd];
const cs=C.r,G=new Map(),gk=(a,b,c)=>a+','+b+','+c;for(const i of B){const k=gk(Math.floor(P[i*3]/cs),Math.floor(P[i*3+1]/cs),Math.floor(P[i*3+2]/cs));(G.get(k)||G.set(k,[]).get(k)).push(i);}
// each rim point joins its nearest rim point that is not already its own neighbour across a triangle edge
const nb=new Map();for(const k of ec.keys()){const [a,b]=k.split('_').map(Number);(nb.get(a)||nb.set(a,new Set()).get(a)).add(b);(nb.get(b)||nb.set(b,new Set()).get(b)).add(a);}
let joins=0;const pairs=[];for(const i of B){const a=Math.floor(P[i*3]/cs),b=Math.floor(P[i*3+1]/cs),c=Math.floor(P[i*3+2]/cs);let best=-1,bd2=C.r;for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const L=G.get(gk(a+x,b+y,c+z));if(L)for(const j of L){if(j===i||nb.get(i)?.has(j))continue;const dd=Math.hypot(P[i*3]-P[j*3],P[i*3+1]-P[j*3+1],P[i*3+2]-P[j*3+2]);if(dd<bd2){bd2=dd;best=j;}}}if(best>=0)pairs.push([i,best]);}
for(const [i,j] of pairs){if(f(i)!==f(j)){U(i,j);joins++;}}
const S=new Map();for(let i=0;i<nv;i++){const r=f(i);(S.get(r)||S.set(r,[]).get(r)).push(i);}
const M=new Float64Array(nv*3);for(const [r,L] of S){const m=[0,0,0],w={};const reps=new Set(L);for(const i of L){for(let c=0;c<3;c++)m[c]+=P[i*3+c]/L.length;const j=JA.getElement(i,[]),ww=WA.getElement(i,[]);for(let k=0;k<4;k++)if(ww[k]>0)w[j[k]]=(w[j[k]]||0)+ww[k]/L.length;}
 const top=Object.entries(w).sort((a,b)=>b[1]-a[1]).slice(0,4);const s=top.reduce((u,t)=>u+t[1],0);const J=[0,0,0,0],W=[0,0,0,0];top.forEach(([j,v],k)=>{J[k]=+j;W[k]=v/s;});
 for(const i of L){for(let c=0;c<3;c++)M[i*3+c]=m[c];if(L.length>1){JA.setElement(i,J);WA.setElement(i,W);}}}
const out=[];let deg=0;for(let t=0;t<I.length;t+=3){const a=f(I[t]),b=f(I[t+1]),c=f(I[t+2]);if(a===b||b===c||a===c){deg++;continue;}out.push(I[t],I[t+1],I[t+2]);}
const AN=new Float64Array(nv*3);for(let t=0;t<out.length;t+=3){const [a,b,c]=[out[t],out[t+1],out[t+2]];const u=[0,1,2].map(k=>M[b*3+k]-M[a*3+k]),v=[0,1,2].map(k=>M[c*3+k]-M[a*3+k]);const nn=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const q of [a,b,c])for(let k=0;k<3;k++)AN[f(q)*3+k]+=nn[k];}
for(let i=0;i<nv;i++){const r=f(i);let nn=[AN[r*3],AN[r*3+1],AN[r*3+2]];let l=Math.hypot(...nn);if(!l){nn=[N[i*3],N[i*3+1],N[i*3+2]];l=1;}for(let k=0;k<3;k++){N[i*3+k]=nn[k]/l;P[i*3+k]=M[i*3+k]+N[i*3+k]*C.out;}}
PA.setArray(P);NA.setArray(N);p.getIndices().setArray(new Uint32Array(out));console.log('underweld rim points',B.length,'joins',joins,'degenerate tris dropped',deg,'left',out.length/3);await io.write(oP,d);
