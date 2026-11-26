// The vest's open borders (armholes, collar, front flaps, hem) are saw-toothed: triangle spikes 1-2 cm long, with the sweater showing
// between them (and orange atlas texels on them) - "shards" on the shoulder straps (critic pass 22). Smooth each border loop (Taubin,
// no shrinking) so the edge runs as one clean line; the ring inside follows a little.
// usage: node vestedge.mjs in.glb out.glb '{"it":4,"l":0.5,"m":-0.53,"ring":0.5,"cap":0.02,"cy":9,"cz":-0.08}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C={it:4,l:.5,m:-.53,ring:.5,cap:.02,cy:9,cz:-.08,by:.5,bz:-.06,bx:.12,capb:.08,...JSON.parse(cS||'{}')};const d=await io.read(iP);
/* NODE=Mesh_0: the same for the body's own border at the neck (with ymin), where the sweater's collar met the neck in saw teeth */const n=d.getRoot().listNodes().find(x=>x.getName()===(process.env.NODE||'vest'));const p=n.getMesh().listPrimitives()[0];const PA=p.getAttribute('POSITION');const P=PA.getArray().slice();const I=p.getIndices().getArray();
const cnt=P.length/3;const wid=new Int32Array(cnt);const key=new Map();for(let i=0;i<cnt;i++){const k=Math.round(P[i*3]*1e5)+','+Math.round(P[i*3+1]*1e5)+','+Math.round(P[i*3+2]*1e5);if(!key.has(k))key.set(k,key.size);wid[i]=key.get(k);}
const nw=key.size;const W=new Float64Array(nw*3);for(let i=0;i<cnt;i++)for(let c=0;c<3;c++)W[wid[i]*3+c]=P[i*3+c];
const ec=new Map();const adj=Array.from({length:nw},()=>new Set());
for(let t=0;t<I.length;t+=3)for(let e=0;e<3;e++){const a=wid[I[t+e]],b=wid[I[t+(e+1)%3]];if(a===b)continue;const k=a<b?a+','+b:b+','+a;ec.set(k,(ec.get(k)||0)+1);adj[a].add(b);adj[b].add(a);}
const bn=Array.from({length:nw},()=>[]);for(const [k,c] of ec)if(c===1){const [a,b]=k.split(',').map(Number);bn[a].push(b);bn[b].push(a);}
// the back of the collar stays as modelled (cy/cz): pulled straight there the border sank under the body (dark teeth above the collar)
const isB=bn.map((l,v)=>l.length===2&&!(C.cy!==undefined&&W[v*3+1]>C.cy&&W[v*3+2]<C.cz)&&!(C.ymin!==undefined&&W[v*3+1]<C.ymin));let nb=0;isB.forEach(x=>nb+=x);
const step=f=>{const N=new Float64Array(W);for(let v=0;v<nw;v++){if(!isB[v])continue;const [a,b]=bn[v];for(let c=0;c<3;c++)N[v*3+c]=W[v*3+c]+f*((W[a*3+c]+W[b*3+c])/2-W[v*3+c]);}W.set(N);};
const W0=new Float64Array(W);for(let k=0;k<C.it;k++){step(C.l);step(C.m);}
// the first ring inside moves with its border neighbours (no thin slivers left behind)
let maxd=0;const D=new Float64Array(nw*3);for(let v=0;v<nw;v++)if(isB[v]){for(let c=0;c<3;c++)D[v*3+c]=W[v*3+c]-W0[v*3+c];const L=Math.hypot(D[v*3],D[v*3+1],D[v*3+2]);/* a real corner (lapel point) moves farther than a tooth: keep it */const cp=W0[v*3+1]>C.by&&W0[v*3+2]<C.bz&&Math.abs(W0[v*3])<C.bx?C.capb:C.cap;/* the back of the collar has no lapel points, only saw teeth up to 6 cm: those may move as far as they need */const f=L>cp?cp/L:1;for(let c=0;c<3;c++){D[v*3+c]*=f;W[v*3+c]=W0[v*3+c]+D[v*3+c];}maxd=Math.max(maxd,L*f);}
for(let v=0;v<nw;v++){if(isB[v])continue;let s=[0,0,0],k=0;for(const u of adj[v])if(isB[u]){for(let c=0;c<3;c++)s[c]+=D[u*3+c];k++;}if(k)for(let c=0;c<3;c++)W[v*3+c]+=s[c]/k*C.ring;}
for(let i=0;i<cnt;i++)for(let c=0;c<3;c++)P[i*3+c]=W[wid[i]*3+c];PA.setArray(P);
console.log('vest border verts',nb,'of',nw,'max move',maxd.toFixed(4));await io.write(oP,d);
