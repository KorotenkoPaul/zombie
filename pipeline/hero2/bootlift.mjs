// Boots read against the wood floor: texture only. Mask = UV islands of the "boots" node; lift the leather value/saturation,
// darken the sole band (lowest SOLE of the boot) for a clear silhouette line.
// usage: node bootlift.mjs in.glb out.glb '{"v":0.12,"s":0.08,"sole":0.035,"soleK":0.35}'
import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=JSON.parse(cS);const d=await io.read(iP);
const bn=d.getRoot().listNodes().find(n=>n.getName()==='boots');const p=bn.getMesh().listPrimitives()[0];const tex=p.getMaterial().getBaseColorTexture();
const {data,info}=await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});const W=info.width,H=info.height;
const P=p.getAttribute('POSITION').getArray(),UV=p.getAttribute('TEXCOORD_0').getArray(),I=p.getIndices().getArray();
let y0=9;for(let i=1;i<P.length;i+=3)y0=Math.min(y0,P[i]);
const M=new Float32Array(W*H),S=new Float32Array(W*H);
for(let t=0;t<I.length;t+=3){const a=I[t],b=I[t+1],c=I[t+2];const y=Math.min(P[a*3+1],P[b*3+1],P[c*3+1]);const sole=y<y0+C.sole?1:0;
 const u=[a,b,c].map(i=>[UV[i*2]*W,UV[i*2+1]*H]);const x0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[0])))),x1=Math.min(W-1,Math.ceil(Math.max(...u.map(q=>q[0])))),yy0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[1])))),yy1=Math.min(H-1,Math.ceil(Math.max(...u.map(q=>q[1]))));
 const [A,B,Cc]=u;const den=(B[1]-Cc[1])*(A[0]-Cc[0])+(Cc[0]-B[0])*(A[1]-Cc[1]);if(Math.abs(den)<1e-9)continue;
 for(let yy=yy0;yy<=yy1;yy++)for(let xx=x0;xx<=x1;xx++){const px=xx+.5,py=yy+.5;const l1=((B[1]-Cc[1])*(px-Cc[0])+(Cc[0]-B[0])*(py-Cc[1]))/den,l2=((Cc[1]-A[1])*(px-Cc[0])+(A[0]-Cc[0])*(py-Cc[1]))/den;if(l1<-.05||l2<-.05||1-l1-l2<-.05)continue;const k=yy*W+xx;M[k]=1;if(sole)S[k]=1;}}
// boot triangles may share texels with the trousers: only touch leather-coloured texels
const out=Buffer.from(data);let n=0,ns=0;
for(let k=0;k<W*H;k++){if(!M[k])continue;const r=data[k*3]/255,g=data[k*3+1]/255,b=data[k*3+2]/255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(!(r>=g&&g>=b*0.8&&mx-mn>0.08))continue;
 let f=S[k]?1-C.soleK:1+C.v;n++;if(S[k])ns++;
 const sat=S[k]?1:1+C.s;const l=(r+g+b)/3;
 for(const [c,v] of [[0,r],[1,g],[2,b]]){let x=l+(v-l)*sat;x*=f;out[k*3+c]=Math.max(0,Math.min(255,Math.round(x*255)));}}
console.log('boot texels',n,'sole',ns);
const png=await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toBuffer();tex.setImage(new Uint8Array(png)).setMimeType('image/png');await io.write(oP,d);
