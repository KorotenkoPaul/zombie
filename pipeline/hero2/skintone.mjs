// Match the body's skin (hands, neck stub) to the grafted head's face skin: mask the body texture by the UV islands of
// Hand/Neck-weighted triangles, then per-channel gain so the masked mean equals the head's cheek mean.
// usage: node skintone.mjs in.glb out.glb   (after graft: prim 0 = body, prims 1..n = head with material "head")
import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const d=await io.read(process.argv[2]);const root=d.getRoot();
const node=root.listNodes().find(n=>n.getName()==='Mesh_0');const prims=node.getMesh().listPrimitives();const body=prims[0];
const J=node.getSkin().listJoints().map(j=>j.getName().replace('mixamorig','').replace(':',''));
const dec=async t=>{const {data,info}=await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});return {data,w:info.width,h:info.height};};
function raster(P,UV,I,keep,W,H,cb){for(let t=0;t<I.length;t+=3){if(!keep(I[t],I[t+1],I[t+2]))continue;const u=[0,1,2].map(k=>[UV[I[t+k]*2]*W,UV[I[t+k]*2+1]*H]);
 const x0=Math.max(0,Math.floor(Math.min(...u.map(a=>a[0])))),x1=Math.min(W-1,Math.ceil(Math.max(...u.map(a=>a[0])))),y0=Math.max(0,Math.floor(Math.min(...u.map(a=>a[1])))),y1=Math.min(H-1,Math.ceil(Math.max(...u.map(a=>a[1]))));
 const [a,b,c]=u;const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-9)continue;
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=x+.5,py=y+.5;const l1=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/den,l2=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/den,l3=1-l1-l2;if(l1>=-.02&&l2>=-.02&&l3>=-.02)cb(x,y);}}}
// head cheek reference: head triangles in the cheek region (front, below the eyes, beside the nose)
const ref=[0,0,0,0];const ht=prims[1].getMaterial().getBaseColorTexture();const HT=await dec(ht);
for(const hp of prims.slice(1)){const P=hp.getAttribute('POSITION').getArray(),UV=hp.getAttribute('TEXCOORD_0').getArray(),I=hp.getIndices().getArray();
 const ck=i=>{const x=Math.abs(P[i*3]),y=P[i*3+1],z=P[i*3+2];return process.env.REF==="neck"?(y>.6&&y<.635&&z>-.01):(x>.03&&x<.06&&y>.69&&y<.725&&z>.05);};
 raster(P,UV,I,(a,b,c)=>ck(a)&&ck(b)&&ck(c),HT.w,HT.h,(x,y)=>{const k=(y*HT.w+x)*3;ref[0]+=HT.data[k];ref[1]+=HT.data[k+1];ref[2]+=HT.data[k+2];ref[3]++;});}
// body skin mask
const bt=body.getMaterial().getBaseColorTexture();const BT=await dec(bt);const mask=new Uint8Array(BT.w*BT.h);
{const P=body.getAttribute('POSITION').getArray(),UV=body.getAttribute('TEXCOORD_0').getArray(),I=body.getIndices().getArray(),Ja=body.getAttribute('JOINTS_0').getArray(),W=body.getAttribute('WEIGHTS_0').getArray();
 const sk=i=>{let w=0;for(let k=0;k<4;k++)if(/Hand|Neck|Head/.test(J[Ja[i*4+k]]))w+=W[i*4+k];return w>.5;};
 raster(P,UV,I,(a,b,c)=>sk(a)&&sk(b)&&sk(c),BT.w,BT.h,(x,y)=>{mask[y*BT.w+x]=1;});}
// only skin-coloured pixels inside the mask (skip sleeve cuffs / collar knit that share islands)
const isSkin=(r,g,b)=>r>g&&g>b&&r>90&&(r-b)>25&&(r-b)<140&&(g-b)<70;
const m=[0,0,0,0];for(let i=0;i<mask.length;i++){if(!mask[i])continue;const r=BT.data[i*3],g=BT.data[i*3+1],b=BT.data[i*3+2];if(!isSkin(r,g,b)){mask[i]=0;continue;}m[0]+=r;m[1]+=g;m[2]+=b;m[3]++;}
const R=[0,1,2].map(k=>ref[k]/ref[3]),M=[0,1,2].map(k=>m[k]/m[3]);const G=R.map((v,k)=>v/M[k]);
console.log('head cheek',R.map(v=>v|0),'px',ref[3],'| body skin',M.map(v=>v|0),'px',m[3],'| gain',G.map(v=>v.toFixed(3)));
// feather the mask a little so the change has no hard edge
const out=Buffer.from(BT.data);const F=+(process.env.F||1);
for(let i=0;i<mask.length;i++){if(!mask[i])continue;for(let k=0;k<3;k++)out[i*3+k]=Math.min(255,Math.round(BT.data[i*3+k]*(1+(G[k]-1)*F)));}
const png=await sharp(out,{raw:{width:BT.w,height:BT.h,channels:3}}).png().toBuffer();bt.setImage(new Uint8Array(png)).setMimeType('image/png');
await io.write(process.argv[3],d);
