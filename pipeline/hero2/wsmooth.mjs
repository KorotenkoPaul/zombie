// The armpit tore into long slivers with holes when the arms went up: neighbouring points 1-3 cm apart differed by up to 0.7 in Arm weight
// (auto-rig noise plus the vest/edge blend of vestskin), so linear skinning folded the skin over itself. Here the skin weights of the
// shoulder/armpit zone (|x| C.x0..C.x1, y C.y0..C.y1, faded in over C.f) are Laplacian-smoothed over the welded surface, C.it rounds of
// C.l, for the body and the undershirt alike. usage: node wsmooth.mjs in.glb out.glb '{"it":12,"l":0.5}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C={it:12,l:.5,x0:.1,x1:.32,y0:.22,y1:.52,f:.03,...JSON.parse(cS||'{}')};const d=await io.read(iP);
const ss=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
const vn=d.getRoot().listNodes().find(x=>x.getName()==='vest');const VP=vn.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray();const VK=new Set();for(let i=0;i<VP.length/3;i++)VK.add([0,1,2].map(c=>Math.round(VP[i*3+c]*500)).join());
for(const nm of ['Mesh_0','undershirt','vest']){const n=d.getRoot().listNodes().find(x=>x.getName()===nm);if(!n)continue;if(nm==='vest'&&!C.vest)continue;if(C.only&&nm!==C.only)continue;
 const JN=n.getSkin().listJoints().map(j=>j.getName());const p=n.getMesh().listPrimitives()[0];const P=p.getAttribute('POSITION').getArray(),JA=p.getAttribute('JOINTS_0'),WA=p.getAttribute('WEIGHTS_0'),I=p.getIndices().getArray();const nv=P.length/3;
 const key=new Map(),wid=new Int32Array(nv);for(let i=0;i<nv;i++){const k=[0,1,2].map(c=>Math.round(P[i*3+c]*1e5)).join();if(!key.has(k))key.set(k,key.size);wid[i]=key.get(k);}
 const nw=key.size;const ec=new Map();for(let t=0;t<I.length;t+=3)for(let e=0;e<3;e++){const a=wid[I[t+e]],b=wid[I[t+(e+1)%3]];const k=a<b?a+'_'+b:b+'_'+a;ec.set(k,(ec.get(k)||0)+1);}
 const rim=new Set();if(nm==='Mesh_0')for(const [k,c] of ec)if(c===1)for(const v of k.split('_'))rim.add(+v); /* the rim of the hole under the vest (vestskin gave it the vest's weights) */
 const adj=Array.from({length:nw},()=>new Set());for(let t=0;t<I.length;t+=3)for(let e=0;e<3;e++){const a=wid[I[t+e]],b=wid[I[t+(e+1)%3]];if(a!==b){adj[a].add(b);adj[b].add(a);}}
 let fixed=0;const Wd=Array.from({length:nw},()=>null),g=new Float32Array(nw),rep=new Int32Array(nw).fill(-1);
 for(let i=0;i<nv;i++){const w=wid[i];if(rep[w]>=0)continue;rep[w]=i;const o={};const j=JA.getElement(i,[]),ww=WA.getElement(i,[]);for(let k=0;k<4;k++)if(ww[k]>0)o[j[k]]=(o[j[k]]||0)+ww[k];Wd[w]=o;
  const dom=+Object.entries(o).sort((a,b)=>b[1]-a[1])[0][0];if(/Head|Neck|Hand|headfront/.test(JN[dom]))continue;
  const x=Math.abs(P[i*3]),y=P[i*3+1];if(nm!=='vest'){const q=[0,1,2].map(c=>P[i*3+c]*500);let hit=false;for(const dx of [-.5,.5])for(const dy of [-.5,.5])for(const dz of [-.5,.5])if(VK.has([Math.round(q[0]+dx),Math.round(q[1]+dy),Math.round(q[2]+dz)].join()))hit=true;if(hit||(rim.has(w)&&x>.1&&y>.25)){fixed++;continue;}} // seam points stay exactly on the vest's weights
  g[w]=ss(C.x0,C.x0+C.f,x)*(1-ss(C.x1-C.f,C.x1,x))*ss(C.y0,C.y0+C.f,y)*(1-ss(C.y1-C.f,C.y1,y));}
 let cnt=0;for(let w=0;w<nw;w++)if(g[w]>0)cnt++;
 for(let it=0;it<C.it;it++){const N=Wd.map(o=>o);for(let w=0;w<nw;w++){if(!(g[w]>0)||!adj[w].size)continue;const avg={};for(const u of adj[w])for(const [j,v] of Object.entries(Wd[u]))avg[j]=(avg[j]||0)+v/adj[w].size;
   const o={};const f=C.l*g[w];for(const [j,v] of Object.entries(Wd[w]))o[j]=(o[j]||0)+v*(1-f);for(const [j,v] of Object.entries(avg))o[j]=(o[j]||0)+v*f;N[w]=o;}for(let w=0;w<nw;w++)Wd[w]=N[w];}
 for(let i=0;i<nv;i++){const w=wid[i];if(!(g[w]>0))continue;const top=Object.entries(Wd[w]).sort((a,b)=>b[1]-a[1]).slice(0,4);const s=top.reduce((u,t)=>u+t[1],0);const J=[0,0,0,0],W=[0,0,0,0];top.forEach(([j,v],k)=>{J[k]=+j;W[k]=v/s;});JA.setElement(i,J);WA.setElement(i,W);}
 console.log('wsmooth',nm,'points',cnt,'seam fixed',fixed);}
await io.write(oP,d);
