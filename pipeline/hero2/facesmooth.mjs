// smooth the face skin: Laplacian-smooth skin vertices of the head, recompute their normals, flatten the normal map and
// soften/lighten the base colour on skin texels (Meshy bakes bumps and blotches into both).
// usage: node facesmooth.mjs in.glb out.glb [iters] [lighten]
import * as T from 'three';import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,inP,outP,itS,lS]=process.argv;const ITER=+(itS||4),LIGHT=+(lS||0.06);
const d=await io.read(inP);const root=d.getRoot();const node=root.listNodes().find(n=>n.getName()==='Mesh_0');const p=node.getMesh().listPrimitives()[0];
const mat=p.getMaterial();const bt=mat.getBaseColorTexture(),nt=mat.getNormalTexture();
const B=await sharp(Buffer.from(bt.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject:true});const bw=B.info.width,bh=B.info.height,bd=B.data;
const hsv=(r,g,b)=>{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),dd=mx-mn;let h=0;if(dd){if(mx===r)h=((g-b)/dd)%6;else if(mx===g)h=(b-r)/dd+2;else h=(r-g)/dd+4;h*=60;if(h<0)h+=360;}return [h,mx?dd/mx:0,mx];};
const isSkinPx=(r,g,b)=>{const [h,s,v]=hsv(r,g,b);return (h<38||h>345)&&s>.12&&s<.62&&v>.5;};
const col=(u,v)=>{const x=Math.min(bw-1,Math.max(0,Math.round(u*bw))),y=Math.min(bh-1,Math.max(0,Math.round(v*bh)));const i=(y*bw+x)*4;return [bd[i],bd[i+1],bd[i+2]];};
const sk=node.getSkin();const J=sk.listJoints().map(j=>j.getName().replace('mixamorig','').replace(':',''));
const P=p.getAttribute('POSITION').getArray(),N=p.getAttribute('NORMAL').getArray(),UV=p.getAttribute('TEXCOORD_0').getArray(),Ja=p.getAttribute('JOINTS_0').getArray(),W=p.getAttribute('WEIGHTS_0').getArray(),I=p.getIndices().getArray();
const nv=P.length/3;const key=i=>Math.round(P[i*3]*2e4)+','+Math.round(P[i*3+1]*2e4)+','+Math.round(P[i*3+2]*2e4);const gm=new Map(),gv=new Int32Array(nv);let ng=0;for(let i=0;i<nv;i++){const k=key(i);if(!gm.has(k))gm.set(k,ng++);gv[i]=gm.get(k);}
const head=new Uint8Array(ng),skin=new Uint8Array(ng);
for(let i=0;i<nv;i++){let w=0;for(let k=0;k<4;k++)if(/^(Head|headfront)$/.test(J[Ja[i*4+k]]))w+=W[i*4+k];if(w>.6)head[gv[i]]=1;const c=col(UV[i*2],UV[i*2+1]);if(isSkinPx(...c))skin[gv[i]]++;}
// a welded vertex is "face skin" if head and all its uv copies are skin; neighbours
const nb=Array.from({length:ng},()=>new Set());for(let t=0;t<I.length;t+=3)for(let a=0;a<3;a++)for(let b=0;b<3;b++)if(a!==b)nb[gv[I[t+a]]].add(gv[I[t+b]]);
const cnt=new Uint8Array(ng);for(let i=0;i<nv;i++)cnt[gv[i]]++;
const face=new Uint8Array(ng);for(let g=0;g<ng;g++)face[g]=head[g]&&skin[g]===cnt[g]?1:0;
// only interior face verts move (all neighbours face too) so the borders with eyes, brows, hair stay put
const mov=new Uint8Array(ng);for(let g=0;g<ng;g++)if(face[g]){let ok=true;for(const u of nb[g])if(!face[u]){ok=false;break;}mov[g]=ok?1:0;}
const G=new Float32Array(ng*3);for(let i=0;i<nv;i++)for(let a=0;a<3;a++)G[gv[i]*3+a]=P[i*3+a];
for(let it=0;it<ITER;it++){const Gn=G.slice();for(let g=0;g<ng;g++){if(!mov[g])continue;const c=[0,0,0];for(const u of nb[g])for(let a=0;a<3;a++)c[a]+=G[u*3+a];const n=nb[g].size;for(let a=0;a<3;a++)Gn[g*3+a]=G[g*3+a]*.5+c[a]/n*.5;}G.set(Gn);}
// write positions back, recompute smooth normals on face verts
const P2=P.slice();for(let i=0;i<nv;i++)if(mov[gv[i]])for(let a=0;a<3;a++)P2[i*3+a]=G[gv[i]*3+a];
const GN=new Float32Array(ng*3);const va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3();
for(let t=0;t<I.length;t+=3){va.fromArray(P2,I[t]*3);vb.fromArray(P2,I[t+1]*3);vc.fromArray(P2,I[t+2]*3);const n=vb.sub(va).cross(vc.sub(va));for(let k=0;k<3;k++){const g=gv[I[t+k]];GN[g*3]+=n.x;GN[g*3+1]+=n.y;GN[g*3+2]+=n.z;}}
const N2=N.slice();let moved=0;for(let i=0;i<nv;i++){const g=gv[i];if(!face[g])continue;const v=new T.Vector3(GN[g*3],GN[g*3+1],GN[g*3+2]).normalize();N2[i*3]=v.x;N2[i*3+1]=v.y;N2[i*3+2]=v.z;moved++;}
p.getAttribute('POSITION').setArray(P2);p.getAttribute('NORMAL').setArray(N2);
// texture: face triangles' texels -> flatten normal map, soften base colour (blur) + lighten towards pink
const mask=Buffer.alloc(bw*bh);
const fill=(t)=>{const us=[0,1,2].map(k=>UV[I[t+k]*2]*bw),vs=[0,1,2].map(k=>UV[I[t+k]*2+1]*bh);const x0=Math.max(0,Math.floor(Math.min(...us))-1),x1=Math.min(bw-1,Math.ceil(Math.max(...us))+1),y0=Math.max(0,Math.floor(Math.min(...vs))-1),y1=Math.min(bh-1,Math.ceil(Math.max(...vs))+1);
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*bw+x;if(isSkinPx(bd[i*4],bd[i*4+1],bd[i*4+2]))mask[i]=255;}};
for(let t=0;t<I.length;t+=3)if(face[gv[I[t]]]&&face[gv[I[t+1]]]&&face[gv[I[t+2]]])fill(t);
const blur=await sharp(bd,{raw:{width:bw,height:bh,channels:4}}).blur(4).raw().toBuffer();
const mb=await sharp(mask,{raw:{width:bw,height:bh,channels:1}}).blur(2).raw().toBuffer();
const out=Buffer.from(bd);const tgt=[246,204,184];
for(let i=0;i<bw*bh;i++){const m=mb[i]/255;if(!m)continue;for(let a=0;a<3;a++){let v=bd[i*4+a]*(1-m*.7)+blur[i*4+a]*m*.7;v=v+(tgt[a]-v)*LIGHT*m*2.5;out[i*4+a]=Math.max(0,Math.min(255,v));}}
bt.setImage(await sharp(out,{raw:{width:bw,height:bh,channels:4}}).png().toBuffer()).setMimeType('image/png');
if(nt){const Nn=await sharp(Buffer.from(nt.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject:true});const nw=Nn.info.width,nh=Nn.info.height;const mk=await sharp(mb,{raw:{width:bw,height:bh,channels:1}}).resize(nw,nh).raw().toBuffer();
 const o=Buffer.from(Nn.data);for(let i=0;i<nw*nh;i++){const m=mk[i]/255;o[i*4]=o[i*4]*(1-m)+128*m;o[i*4+1]=o[i*4+1]*(1-m)+128*m;o[i*4+2]=o[i*4+2]*(1-m)+255*m;}
 nt.setImage(await sharp(o,{raw:{width:nw,height:nh,channels:4}}).png().toBuffer()).setMimeType('image/png');}
await io.write(outP,d);console.log('face verts',face.reduce((a,b)=>a+b,0),'moved',mov.reduce((a,b)=>a+b,0),'normals',moved);
