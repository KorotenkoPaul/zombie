// The knit sleeves of the generated texture are painted with long dark wavy streaks (they read as wood grain, critic
// 2026-11-25). Sleeve texels (arm-weighted triangles, mustard colour) keep their colour and soft shading but lose the
// streaks: a masked Gaussian blur of the colour, and the normal map flattened there. The knit itself comes from hero
// clothes shader (game/heroclothes.js), which follows the limb and not the UVs.
// usage: node clothfix.mjs in.glb out.glb '{"sigma":5,"nflat":0.85}'
import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=Object.assign({sigma:5,nflat:.85,dil:2},cS?JSON.parse(cS):{});const d=await io.read(iP);
const R=d.getRoot();const n0=R.listNodes().find(n=>n.getName()==='Mesh_0');const body=n0.getMesh().listPrimitives()[0];const mat=body.getMaterial();
const tex=mat.getBaseColorTexture();const {data,info}=await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});const W=info.width,H=info.height;
const JN=n0.getSkin().listJoints().map(j=>j.getName());const ARM=new Set(JN.map((n,i)=>/(Arm|ForeArm)$/.test(n)?i:-1).filter(i=>i>=0));
const UV=body.getAttribute('TEXCOORD_0').getArray(),I=body.getIndices().getArray(),J=body.getAttribute('JOINTS_0').getArray(),WW=body.getAttribute('WEIGHTS_0').getArray();
const armW=i=>{let w=0;for(let k=0;k<4;k++)if(ARM.has(J[i*4+k]))w+=WW[i*4+k];return w;};
const M=new Uint8Array(W*H);
for(let t=0;t<I.length;t+=3){const v=[I[t],I[t+1],I[t+2]];if(v.some(i=>armW(i)<.6))continue;const u=v.map(i=>[UV[i*2]*W,UV[i*2+1]*H]);
 const x0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[0])))-C.dil),x1=Math.min(W-1,Math.ceil(Math.max(...u.map(q=>q[0])))+C.dil),y0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[1])))-C.dil),y1=Math.min(H-1,Math.ceil(Math.max(...u.map(q=>q[1])))+C.dil);
 const [A,B,Cc]=u;const den=(B[1]-Cc[1])*(A[0]-Cc[0])+(Cc[0]-B[0])*(A[1]-Cc[1]);if(Math.abs(den)<1e-9)continue;const e=C.dil/Math.max(4,Math.sqrt(Math.abs(den)));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=x+.5,py=y+.5;const l1=((B[1]-Cc[1])*(px-Cc[0])+(Cc[0]-B[0])*(py-Cc[1]))/den,l2=((Cc[1]-A[1])*(px-Cc[0])+(A[0]-Cc[0])*(py-Cc[1]))/den;if(l1<-e||l2<-e||1-l1-l2<-e)continue;M[y*W+x]=1;}}
// only the mustard knit (not the skin of the wrists that are arm-weighted too)
// all of the sleeve but the skin (pale, pinkish) and anything green: the dark streak lines themselves must go too
const knit=k=>{const r=data[k*3],g=data[k*3+1],b=data[k*3+2];const mx=Math.max(r,g,b),mn=Math.min(r,g,b);const sat=(mx-mn)/Math.max(mx,1);return !(g>r)&&!(sat<.42&&mx>120&&b/Math.max(r,1)>.45);};
let nm=0;for(let k=0;k<W*H;k++){if(M[k]&&!knit(k))M[k]=0;if(M[k])nm++;}
// masked separable gaussian
const rad=Math.ceil(C.sigma*2.5);const ker=[];for(let i=-rad;i<=rad;i++)ker.push(Math.exp(-i*i/(2*C.sigma*C.sigma)));
function blur(src,ch){const tmp=new Float32Array(W*H*(ch+1)),out=new Float32Array(W*H*(ch+1));
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=y*W+x;if(!M[k])continue;}
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=new Array(ch+1).fill(0);let any=false;for(let i=-rad;i<=rad;i++){const xx=x+i;if(xx<0||xx>=W)continue;const q=y*W+xx;if(!M[q])continue;any=true;const w=ker[i+rad];for(let c=0;c<ch;c++)s[c]+=src[q*ch+c]*w;s[ch]+=w;}if(any)for(let c=0;c<=ch;c++)tmp[(y*W+x)*(ch+1)+c]=s[c];}
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=y*W+x;if(!M[k])continue;let s=new Array(ch+1).fill(0);for(let i=-rad;i<=rad;i++){const yy=y+i;if(yy<0||yy>=H)continue;const q=yy*W+x;const w=ker[i+rad];for(let c=0;c<=ch;c++)s[c]+=tmp[q*(ch+1)+c]*w;}for(let c=0;c<=ch;c++)out[k*(ch+1)+c]=s[c];}
 return out;}
const bc=blur(data,3);const out=Buffer.from(data);
for(let k=0;k<W*H;k++){if(!M[k])continue;const w=bc[k*4+3];if(w<=0)continue;for(let c=0;c<3;c++)out[k*3+c]=Math.round(bc[k*4+c]/w);}
tex.setImage(new Uint8Array(await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toBuffer())).setMimeType('image/png');
const nt=mat.getNormalTexture();if(nt&&C.nflat>0){const {data:nd,info:ni}=await sharp(Buffer.from(nt.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(ni.width===W&&ni.height===H){const no=Buffer.from(nd);for(let k=0;k<W*H;k++){if(!M[k])continue;const f=C.nflat;no[k*3]=Math.round(nd[k*3]*(1-f)+128*f);no[k*3+1]=Math.round(nd[k*3+1]*(1-f)+128*f);no[k*3+2]=Math.round(nd[k*3+2]*(1-f)+255*f);}
  nt.setImage(new Uint8Array(await sharp(no,{raw:{width:W,height:H,channels:3}}).png().toBuffer())).setMimeType('image/png');}else console.log('normal map size differs',ni.width);}
console.log('sleeve knit texels',nm);
await io.write(oP,d);
