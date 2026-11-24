// Make eyes and brows read at small screen size: texture only. Masks are built in UV space from head triangles whose
// front-view position lies in the eye ellipses / brow bands (model space, pre-quant), feathered; then local contrast.
// usage: node facepop.mjs in.glb out.glb '{"eyes":[[x,y],[x,y]],"ew":.07,"eh":.047,"brow":[y,h,x0,x1],"lash":.5,"scl":.25,"brow_k":.35,"skin":.06}'
import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=JSON.parse(cS);const d=await io.read(iP);
const node=d.getRoot().listNodes().find(n=>n.getName()==='Mesh_0');const prims=node.getMesh().listPrimitives().filter(p=>p.getMaterial()&&p.getMaterial().getName()==='head');
const tex=prims[0].getMaterial().getBaseColorTexture();const {data,info}=await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});const W=info.width,H=info.height;
const eye=new Float32Array(W*H),brow=new Float32Array(W*H),face=new Float32Array(W*H);
const inEye=(x,y)=>{let m=0;for(const [cx,cy] of C.eyes){const u=(x-cx)/(C.ew/2),v=(y-cy)/(C.eh/2);m=Math.max(m,1-Math.hypot(u,v));}return Math.min(1,Math.max(0,m*3));};
const [by,bh,bx0,bx1]=C.brow;const inBrow=(x,y)=>{const ax=Math.abs(x);if(ax<bx0||ax>bx1)return 0;return Math.max(0,1-Math.abs(y-by)/(bh/2));};
const inFace=(x,y,z)=>z>0.04&&y>C.chin&&y<C.brow[0]+C.brow[1]?1:0;
for(const p of prims){const P=p.getAttribute('POSITION').getArray(),UV=p.getAttribute('TEXCOORD_0').getArray(),I=p.getIndices().getArray();
 for(let t=0;t<I.length;t+=3){const a=I[t],b=I[t+1],c=I[t+2];const x=(P[a*3]+P[b*3]+P[c*3])/3,y=(P[a*3+1]+P[b*3+1]+P[c*3+1])/3,z=(P[a*3+2]+P[b*3+2]+P[c*3+2])/3;if(z<0)continue;
  const me=inEye(x,y),mb=inBrow(x,y),mf=inFace(x,y,z);if(!me&&!mb&&!mf)continue;
  const u=[a,b,c].map(i=>[UV[i*2]*W,UV[i*2+1]*H]);const x0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[0])))),x1=Math.min(W-1,Math.ceil(Math.max(...u.map(q=>q[0])))),y0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[1])))),y1=Math.min(H-1,Math.ceil(Math.max(...u.map(q=>q[1]))));
  const [A,B,Cc]=u;const den=(B[1]-Cc[1])*(A[0]-Cc[0])+(Cc[0]-B[0])*(A[1]-Cc[1]);if(Math.abs(den)<1e-9)continue;
  for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){const px=xx+.5,py=yy+.5;const l1=((B[1]-Cc[1])*(px-Cc[0])+(Cc[0]-B[0])*(py-Cc[1]))/den,l2=((Cc[1]-A[1])*(px-Cc[0])+(A[0]-Cc[0])*(py-Cc[1]))/den;if(l1<-.05||l2<-.05||1-l1-l2<-.05)continue;const k=yy*W+xx;eye[k]=Math.max(eye[k],me);brow[k]=Math.max(brow[k],mb);face[k]=Math.max(face[k],mf);}}}
// blur masks a little
const blur=async m=>{const b=await sharp(Buffer.from(Uint8Array.from(m,v=>v*255)),{raw:{width:W,height:H,channels:1}}).blur(W/512*2).extractChannel(0).raw().toBuffer();return Float32Array.from(b,v=>v/255);};
console.log('max eye',Math.max(...eye.filter(v=>v>0).slice(0,100000)),'raw eye',eye.reduce((a,v)=>a+(v>0),0),'raw brow',brow.reduce((a,v)=>a+(v>0),0));const E=await blur(eye),B=await blur(brow),F=await blur(face);console.log('blurred max',Math.max(...E.filter(v=>v>0).slice(0,100000)),E.length,W*H);
// local mean (large blur) for contrast
const mean=await sharp(Buffer.from(data),{raw:{width:W,height:H,channels:3}}).blur(W/512*6).raw().toBuffer();
const out=Buffer.from(data);let ne=0,nb=0;
for(let k=0;k<W*H;k++){for(let c=0;c<3;c++){let v=data[k*3+c]/255;const m=mean[k*3+c]/255;
  const lum=(data[k*3]*.3+data[k*3+1]*.59+data[k*3+2]*.11)/255;
  if(E[k]>0){const dv=v-m;v=m+dv*(1+C.lash*E[k]);if(lum>.75)v=v+(1-v)*C.scl*E[k];}
  if(B[k]>0&&lum<.45){v=v*(1-C.brow_k*B[k]);}
  if(F[k]>0&&lum>.5)v=v+(1-v)*C.skin*F[k];
  if(C.hair&&E[k]<.05&&B[k]<.05&&lum<.4&&data[k*3]>data[k*3+2]){v=v*(1+C.hair*(c===0?1.25:c===1?1:.7));}
  out[k*3+c]=Math.max(0,Math.min(255,Math.round(v*255)));}if(E[k]>.5)ne++;if(B[k]>.5)nb++;}
console.log('eye px',ne,'brow px',nb);
await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toFile('facepop_tex.png');
const png=await sharp(out,{raw:{width:W,height:H,channels:3}}).jpeg({quality:95}).toBuffer();tex.setImage(new Uint8Array(png)).setMimeType('image/jpeg');await io.write(oP,d);
