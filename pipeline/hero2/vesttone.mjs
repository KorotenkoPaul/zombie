// Vest back reads near-black maroon vs concept 6's even tan leather: texture only. Rasterize the vest's UV triangles, split by
// bind-pose face normal (front nz>.3 / back nz<-.3), and pull back-facing leather texels toward the front's mean colour
// by a per-channel gain (K = strength). Side texels blend by normal. Leather-coloured texels only (seams/buttons untouched).
// usage: node vesttone.mjs in.glb out.glb '{"k":0.85}'
import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=JSON.parse(cS);const d=await io.read(iP);
const bn=d.getRoot().listNodes().find(n=>n.getName()==='vest');const p=bn.getMesh().listPrimitives()[0];const tex=p.getMaterial().getBaseColorTexture();
const {data,info}=await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});const W=info.width,H=info.height;
const P=p.getAttribute('POSITION').getArray(),UV=p.getAttribute('TEXCOORD_0').getArray(),I=p.getIndices().getArray();
const F=new Float32Array(W*H).fill(NaN);
for(let t=0;t<I.length;t+=3){const a=I[t],b=I[t+1],c=I[t+2];
 const e1=[0,1,2].map(k=>P[b*3+k]-P[a*3+k]),e2=[0,1,2].map(k=>P[c*3+k]-P[a*3+k]);const nx=e1[1]*e2[2]-e1[2]*e2[1],ny=e1[2]*e2[0]-e1[0]*e2[2],nz=e1[0]*e2[1]-e1[1]*e2[0];const nl=Math.hypot(nx,ny,nz)||1;const z=nz/nl;
 const u=[a,b,c].map(i=>[UV[i*2]*W,UV[i*2+1]*H]);const x0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[0])))),x1=Math.min(W-1,Math.ceil(Math.max(...u.map(q=>q[0])))),yy0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[1])))),yy1=Math.min(H-1,Math.ceil(Math.max(...u.map(q=>q[1]))));
 const [A,B,Cc]=u;const den=(B[1]-Cc[1])*(A[0]-Cc[0])+(Cc[0]-B[0])*(A[1]-Cc[1]);if(Math.abs(den)<1e-9)continue;
 for(let yy=yy0;yy<=yy1;yy++)for(let xx=x0;xx<=x1;xx++){const px=xx+.5,py=yy+.5;const l1=((B[1]-Cc[1])*(px-Cc[0])+(Cc[0]-B[0])*(py-Cc[1]))/den,l2=((Cc[1]-A[1])*(px-Cc[0])+(A[0]-Cc[0])*(py-Cc[1]))/den;if(l1<-.05||l2<-.05||1-l1-l2<-.05)continue;const k=yy*W+xx;F[k]=isNaN(F[k])?z:Math.min(F[k],z);}}
const leather=k=>{const r=data[k*3],g=data[k*3+1],b=data[k*3+2];return r>=g&&g>=b*0.7&&r-b>12;};
const sf=[0,0,0],sb=[0,0,0];let nf=0,nb=0;
for(let k=0;k<W*H;k++){if(isNaN(F[k])||!leather(k))continue;if(F[k]>.3){for(let c=0;c<3;c++)sf[c]+=data[k*3+c];nf++;}else if(F[k]<-.3){for(let c=0;c<3;c++)sb[c]+=data[k*3+c];nb++;}}
const mf=sf.map(x=>x/nf),mb=sb.map(x=>x/nb);const G=mf.map((x,c)=>x/mb[c]);console.log('front',mf.map(Math.round),'back',mb.map(Math.round),'gain',G.map(x=>x.toFixed(2)),nf,nb);
const out=Buffer.from(data);let n=0;
for(let k=0;k<W*H;k++){if(isNaN(F[k])||!leather(k))continue;const w=Math.min(1,Math.max(0,(-F[k]+0.1)/0.4))*C.k;if(w<=0)continue;n++;
 for(let c=0;c<3;c++)out[k*3+c]=Math.max(0,Math.min(255,Math.round(data[k*3+c]*(1+(G[c]-1)*w))));}
console.log('vest back texels',n);
const png=await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toBuffer();tex.setImage(new Uint8Array(png)).setMimeType('image/png');await io.write(oP,d);
