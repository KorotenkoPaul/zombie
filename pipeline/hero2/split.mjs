// Split the hero mesh into body / vest / boots (separate skinned meshes, same skin + material) and add the layer underneath
// (sweater shell under the vest, wool socks inside the boots) to the body, so vest and boots can be taken off.
// usage: node split.mjs in.glb out.glb [debug.png]
import fs from 'fs';import * as T from 'three';import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,inP,outP]=process.argv;const d=await io.read(inP);const root=d.getRoot();
const mesh0=root.listMeshes()[0],p=mesh0.listPrimitives()[0];const node0=root.listNodes().find(n=>n.getMesh()===mesh0);const skin=node0.getSkin();
const P=p.getAttribute('POSITION').getArray(),N=p.getAttribute('NORMAL').getArray(),UV=p.getAttribute('TEXCOORD_0').getArray(),J=p.getAttribute('JOINTS_0').getArray(),W=p.getAttribute('WEIGHTS_0').getArray(),I=p.getIndices().getArray();
const nv=P.length/3,nt=I.length/3;const jn=skin.listJoints().map(j=>j.getName().replace('mixamorig:','').replace('mixamorig',''));
const ibm=skin.getInverseBindMatrices();const jpos=jn.map((_,i)=>new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(ibm.getElement(i,new Array(16))).invert()));
const J_=n=>jn.indexOf(n);
const img=p.getMaterial().getBaseColorTexture().getImage();const {data,info}=await sharp(Buffer.from(img)).raw().toBuffer({resolveWithObject:true});
const col=(u,v)=>{const x=Math.min(info.width-1,Math.max(0,Math.floor(u*info.width))),y=Math.min(info.height-1,Math.max(0,Math.floor(v*info.height)));const k=(y*info.width+x)*info.channels;return [data[k],data[k+1],data[k+2]];};
const hsv=([r,g,b])=>{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),dd=mx-mn;let h=0;if(dd){if(mx===r)h=((g-b)/dd)%6;else if(mx===g)h=(b-r)/dd+2;else h=(r-g)/dd+4;h*=60;if(h<0)h+=360;}return [h,mx?dd/mx:0,mx];};
const dom=i=>{let b=0,bw=-1;for(let k=0;k<4;k++)if(W[i*4+k]>bw){bw=W[i*4+k];b=J[i*4+k];}return jn[b];};
const TORSO=new Set(['Spine','Spine1','Spine2','Neck','LeftShoulder','RightShoulder','Hips']),FOOT=new Set(['LeftFoot','RightFoot','LeftToeBase','RightToeBase','LeftToe_End','RightToe_End']),SHIN=new Set(['LeftLeg','RightLeg']);
// per triangle: colour at centroid (avg of 4 samples) -> class
const cls=new Uint8Array(nt);// 0 body 1 vest 2 boots
const stat={};
for(let t=0;t<nt;t++){const a=I[t*3],b=I[t*3+1],c=I[t*3+2];let rgb=[0,0,0];for(const [wa,wb,wc] of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){const cc=col(UV[a*2]*wa+UV[b*2]*wb+UV[c*2]*wc,UV[a*2+1]*wa+UV[b*2+1]*wb+UV[c*2+1]*wc);rgb=rgb.map((x,i)=>x+cc[i]/4);}
 const [h,s,v]=hsv(rgb);const doms=[dom(a),dom(b),dom(c)];const tor=doms.filter(x=>TORSO.has(x)).length>=2,ft=doms.filter(x=>FOOT.has(x)).length>=2,sh=doms.filter(x=>SHIN.has(x)).length>=2;
 const leather=h<32&&s>.3&&v<.62,green=h>55&&h<170;
 const sweater=h>=30&&h<55&&s>.42&&v>.45,skin=h<30&&s<.5&&v>.62,arm=doms.filter(x=>/Arm$|UpLeg/.test(x)).length>=2;
 if((tor&&!sweater&&!skin&&!green)||(arm&&leather))cls[t]=1;else if((ft&&!green)||(sh&&leather&&!green))cls[t]=2;
 const key=(tor?'T':ft?'F':sh?'S':'o')+cls[t];stat[key]=(stat[key]||0)+1;}
// smooth labels over shared-vertex adjacency (majority, a few passes), boots/vest stay within their bone regions
const vt=Array.from({length:nv},()=>[]);for(let t=0;t<nt;t++)for(let k=0;k<3;k++)vt[I[t*3+k]].push(t);
// weld by position so neighbours across UV seams count
const key=i=>Math.round(P[i*3]*1e4)+','+Math.round(P[i*3+1]*1e4)+','+Math.round(P[i*3+2]*1e4);const grp={};const gv=new Int32Array(nv);let ng=0;for(let i=0;i<nv;i++){const k=key(i);if(!(k in grp))grp[k]=ng++;gv[i]=grp[k];}
const gt=Array.from({length:ng},()=>[]);for(let t=0;t<nt;t++)for(let k=0;k<3;k++)gt[gv[I[t*3+k]]].push(t);
for(let pass=0;pass<6;pass++){const nc=cls.slice();for(let t=0;t<nt;t++){const cnt=[0,0,0];for(let k=0;k<3;k++)for(const u of gt[gv[I[t*3+k]]])if(u!==t)cnt[cls[u]]++;const tot=cnt[0]+cnt[1]+cnt[2];let best=cls[t];for(let c=0;c<3;c++)if(cnt[c]>tot*.55)best=c;nc[t]=best;}cls.set(nc);}
const counts=[0,0,0];for(const c of cls)counts[c]++;console.log('stat',JSON.stringify(stat),'final body/vest/boots',counts);
// anchor UV on sweater (largest torso/arm mustard triangle) for the layers underneath
let anc=null,best=0;for(let t=0;t<nt;t++){if(cls[t])continue;const a=I[t*3];if(!/Arm|Spine/.test(dom(a)))continue;const c=col(UV[a*2],UV[a*2+1]);const [h,s,v]=hsv(c);if(!(h>30&&h<50&&s>.5&&v>.55))continue;
 const A=new T.Vector3().fromArray(P,I[t*3]*3),B=new T.Vector3().fromArray(P,I[t*3+1]*3),C=new T.Vector3().fromArray(P,I[t*3+2]*3);const ar=B.sub(A).cross(C.sub(A)).length();if(ar>best){best=ar;anc=[0,1,2].map(k=>I[t*3+k]);}}
const au=(UV[anc[0]*2]+UV[anc[1]*2]+UV[anc[2]*2])/3,av=(UV[anc[0]*2+1]+UV[anc[1]*2+1]+UV[anc[2]*2+1])/3;console.log('sweater anchor uv',au.toFixed(3),av.toFixed(3),col(au,av));
// welded normals + which welded vertices touch the body (the under layer meets the body there: no inset)
const gn=new Float32Array(ng*3);for(let i=0;i<nv;i++){gn[gv[i]*3]+=N[i*3];gn[gv[i]*3+1]+=N[i*3+1];gn[gv[i]*3+2]+=N[i*3+2];}
const touch=new Uint8Array(ng*3);for(let t=0;t<nt;t++)for(let k=0;k<3;k++)touch[gv[I[t*3+k]]*3+cls[t]]=1;
const edgeW=i=>{const g=gv[i];return touch[g*3]?0:1;};
// build primitives
const seg=(n)=>{const ch={LeftLeg:'LeftFoot',RightLeg:'RightFoot',LeftFoot:'LeftToeBase',RightFoot:'RightToeBase',LeftToeBase:'LeftToe_End',RightToeBase:'RightToe_End'}[n];return ch?[jpos[J_(n)],jpos[J_(ch)]]:[jpos[J_(n)],jpos[J_(n)]];};
function build(tris,mode){const map=new Map(),pos=[],nor=[],uv=[],jj=[],ww=[],idx=[];const v=new T.Vector3(),n=new T.Vector3(),cp=new T.Vector3();
 for(const t of tris)for(let k=0;k<3;k++){const i=I[t*3+k];if(!map.has(i)){map.set(i,pos.length/3);v.fromArray(P,i*3);n.fromArray(N,i*3);let U=[UV[i*2],UV[i*2+1]];
   if(mode==='under'){const g=gv[i];const wn=new T.Vector3(gn[g*3],gn[g*3+1],gn[g*3+2]).normalize();v.addScaledVector(wn,-.011*1.25*edgeW(i));U=[au+(v.x)*.03,av+(v.y)*.01];}
   if(mode==='sock'){const dn=dom(i);const [a,b]=seg(dn);const ab=b.clone().sub(a),L=ab.lengthSq();const tt=L?Math.max(0,Math.min(1,v.clone().sub(a).dot(ab)/L)):0;cp.copy(a).addScaledVector(ab,tt);v.lerp(cp,.36*edgeW(i));U=[au+(v.x)*.03,av+(v.z)*.01];}
   pos.push(v.x,v.y,v.z);nor.push(n.x,n.y,n.z);uv.push(...U);for(let q=0;q<4;q++){jj.push(J[i*4+q]);ww.push(W[i*4+q]);}}
  idx.push(map.get(i));}
 if(mode==='under'||mode==='sock'){} return {pos,nor,uv,jj,ww,idx};}
const merge=(...ps)=>{const o={pos:[],nor:[],uv:[],jj:[],ww:[],idx:[]};for(const q of ps){const base=o.pos.length/3;for(const k of ['pos','nor','uv','jj','ww'])o[k].push(...q[k]);o.idx.push(...q.idx.map(x=>x+base));}return o;};
const T0=[],T1=[],T2=[];for(let t=0;t<nt;t++)[T0,T1,T2][cls[t]].push(t);
const bodyG=merge(build(T0,''),build(T1,'under'),build(T2,'sock'));const vestG=build(T1,''),bootG=build(T2,'');
const buf=root.listBuffers()[0];const A=(ty,a)=>d.createAccessor().setType(ty).setArray(a).setBuffer(buf);
const mk=(g)=>d.createPrimitive().setMaterial(p.getMaterial()).setIndices(A('SCALAR',new Uint32Array(g.idx))).setAttribute('POSITION',A('VEC3',new Float32Array(g.pos))).setAttribute('NORMAL',A('VEC3',new Float32Array(g.nor)))
 .setAttribute('TEXCOORD_0',A('VEC2',new Float32Array(g.uv))).setAttribute('JOINTS_0',A('VEC4',new Uint16Array(g.jj))).setAttribute('WEIGHTS_0',A('VEC4',new Float32Array(g.ww)));
mesh0.removePrimitive(p);mesh0.addPrimitive(mk(bodyG));
for(const [nm,g] of [['vest',vestG],['boots',bootG]]){const m=d.createMesh(nm).addPrimitive(mk(g));const n=d.createNode(nm).setMesh(m).setSkin(skin).setTranslation(node0.getTranslation()).setRotation(node0.getRotation()).setScale(node0.getScale());(node0.getParentNode()||root.listScenes()[0]).addChild(n);}
await io.write(outP,d);console.log('tris body',bodyG.idx.length/3,'vest',vestG.idx.length/3,'boots',bootG.idx.length/3);
