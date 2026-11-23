// front "software render" of the head: ray grid along -z, texture colour at each hit -> face.png + face.json (hits)
import fs from 'fs';import * as T from 'three';import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const d=await io.read(process.argv[2]);
const p=d.getRoot().listMeshes()[0].listPrimitives()[0];const P=p.getAttribute('POSITION').getArray(),UV=p.getAttribute('TEXCOORD_0').getArray(),I=p.getIndices().getArray();
const img=p.getMaterial().getBaseColorTexture().getImage();const {data,info}=await sharp(Buffer.from(img)).raw().toBuffer({resolveWithObject:true});
const RES=.0008,X0=-.1,X1=.1,Y0=1.40,Y1=1.62;const W=Math.round((X1-X0)/RES),H=Math.round((Y1-Y0)/RES);
const tris=[];for(let t=0;t<I.length;t+=3){const a=I[t],b=I[t+1],c=I[t+2];if(P[a*3+1]>Y0-.02&&P[a*3+2]>0)tris.push(t);}
console.log('tris',tris.length,W,H);
const out=Buffer.alloc(W*H*3);const hits=new Float32Array(W*H*6).fill(NaN);
const va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3(),ray=new T.Ray(),tgt=new T.Vector3();
for(let j=0;j<H;j++)for(let i=0;i<W;i++){const x=X0+i*RES,y=Y1-j*RES;ray.set(new T.Vector3(x,y,1),new T.Vector3(0,0,-1));let best=-1e9,bu=0,bv=0;
 for(const t of tris){const a=I[t],b=I[t+1],c=I[t+2];va.fromArray(P,a*3);vb.fromArray(P,b*3);vc.fromArray(P,c*3);
  const minx=Math.min(va.x,vb.x,vc.x),maxx=Math.max(va.x,vb.x,vc.x),miny=Math.min(va.y,vb.y,vc.y),maxy=Math.max(va.y,vb.y,vc.y);if(x<minx||x>maxx||y<miny||y>maxy)continue;
  if(!ray.intersectTriangle(va,vb,vc,false,tgt))continue;if(tgt.z<=best)continue;best=tgt.z;
  const bc=T.Triangle.getBarycoord(tgt,va,vb,vc,new T.Vector3());bu=UV[a*2]*bc.x+UV[b*2]*bc.y+UV[c*2]*bc.z;bv=UV[a*2+1]*bc.x+UV[b*2+1]*bc.y+UV[c*2+1]*bc.z;}
 const o=(j*W+i);if(best>-1e9){const px=Math.min(info.width-1,Math.max(0,Math.round(bu*info.width))),py=Math.min(info.height-1,Math.max(0,Math.round(bv*info.height)));const k=(py*info.width+px)*info.channels;out[o*3]=data[k];out[o*3+1]=data[k+1];out[o*3+2]=data[k+2];hits.set([x,y,best,bu,bv,1],o*6);}}
await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toFile('../hero2/face.png');
fs.writeFileSync('../hero2/face.bin',Buffer.from(hits.buffer));fs.writeFileSync('../hero2/face.json',JSON.stringify({RES,X0,Y1,W,H,tex:[info.width,info.height]}));console.log('ok');
