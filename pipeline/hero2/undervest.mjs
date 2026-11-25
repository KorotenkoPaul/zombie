// The body under the vest still carries the vest's sculpt and a half-painted copy of it (white seam slits, brown edges): seen at
// bedtime when the vest comes off. Repaint those body texels as the mustard sweater: body triangles within D of the vest surface
// (bind pose) are rasterized in UV (dilated), and their texels become the sweater colour with the original's soft shading
// (luminance median-filtered so thin seams vanish) plus a faint vertical knit rib. Texture only.
// usage: node undervest.mjs in.glb out.glb '{"d":0.03}'
import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=Object.assign({d:.03,dil:2},cS?JSON.parse(cS):{});const d=await io.read(iP);
const R=d.getRoot();const body=R.listNodes().find(n=>n.getName()==='Mesh_0').getMesh().listPrimitives()[0];const vest=R.listNodes().find(n=>n.getName()==='vest').getMesh().listPrimitives()[0];
const tex=body.getMaterial().getBaseColorTexture();const {data,info}=await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});const W=info.width,H=info.height;
const VP=vest.getAttribute('POSITION').getArray();const cell=.02;const grid=new Map();const key=(x,y,z)=>Math.floor(x/cell)+','+Math.floor(y/cell)+','+Math.floor(z/cell);
for(let i=0;i<VP.length;i+=3){const k=key(VP[i],VP[i+1],VP[i+2]);(grid.get(k)||grid.set(k,[]).get(k)).push(i);}
const near=(x,y,z)=>{let b=1e9;const cx=Math.floor(x/cell),cy=Math.floor(y/cell),cz=Math.floor(z/cell),r=Math.ceil(C.d/cell);for(let a=-r;a<=r;a++)for(let bb=-r;bb<=r;bb++)for(let c=-r;c<=r;c++){const L=grid.get((cx+a)+','+(cy+bb)+','+(cz+c));if(!L)continue;for(const i of L){const dd=(VP[i]-x)**2+(VP[i+1]-y)**2+(VP[i+2]-z)**2;if(dd<b)b=dd;}}return Math.sqrt(b);};
const P=body.getAttribute('POSITION').getArray(),UV=body.getAttribute('TEXCOORD_0').getArray(),I=body.getIndices().getArray();const nv=P.length/3;
const inV=new Uint8Array(nv);let ni=0;for(let i=0;i<nv;i++){if(near(P[i*3],P[i*3+1],P[i*3+2])<C.d){inV[i]=1;ni++;}}
const M=new Uint8Array(W*H);
for(let t=0;t<I.length;t+=3){const a=I[t],b=I[t+1],c=I[t+2];if(!(inV[a]+inV[b]+inV[c]>=(C.any?1:3)))continue;const u=[a,b,c].map(i=>[UV[i*2]*W,UV[i*2+1]*H]);
 const x0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[0])))-C.dil),x1=Math.min(W-1,Math.ceil(Math.max(...u.map(q=>q[0])))+C.dil),y0=Math.max(0,Math.floor(Math.min(...u.map(q=>q[1])))-C.dil),y1=Math.min(H-1,Math.ceil(Math.max(...u.map(q=>q[1])))+C.dil);
 const [A,B,Cc]=u;const den=(B[1]-Cc[1])*(A[0]-Cc[0])+(Cc[0]-B[0])*(A[1]-Cc[1]);if(Math.abs(den)<1e-9)continue;const e=C.dil/Math.max(4,Math.sqrt(Math.abs(den)));
 for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){const px=xx+.5,py=yy+.5;const l1=((B[1]-Cc[1])*(px-Cc[0])+(Cc[0]-B[0])*(py-Cc[1]))/den,l2=((Cc[1]-A[1])*(px-Cc[0])+(A[0]-Cc[0])*(py-Cc[1]))/den;if(l1<-e||l2<-e||1-l1-l2<-e)continue;M[yy*W+xx]=1;}}
// sweater reference colour: texels under the forearm-weighted vertices (the knit sleeves)
const sk=R.listNodes().find(n=>n.getName()==='Mesh_0').getSkin();const JN=sk.listJoints().map(j=>j.getName());const FA=new Set(JN.map((nm,i)=>/ForeArm$/.test(nm)?i:-1).filter(i=>i>=0));
const J=body.getAttribute('JOINTS_0').getArray(),WW=body.getAttribute('WEIGHTS_0').getArray();let s=[0,0,0],n=0;
for(let i=0;i<nv;i++){let w=0;for(let k=0;k<4;k++)if(FA.has(J[i*4+k]))w+=WW[i*4+k];if(w<.8)continue;const x=Math.min(W-1,UV[i*2]*W|0),y=Math.min(H-1,UV[i*2+1]*H|0);const k=y*W+x;const r=data[k*3],g=data[k*3+1],b=data[k*3+2];if(!(r>g&&g>b))continue;s[0]+=r;s[1]+=g;s[2]+=b;n++;}
const SW=s.map(x=>x/n);const sl=.3*SW[0]+.59*SW[1]+.11*SW[2];
// luminance, median 7x7 inside the mask (kills thin seams)
const L=new Float32Array(W*H);for(let k=0;k<W*H;k++)L[k]=.3*data[k*3]+.59*data[k*3+1]+.11*data[k*3+2];
const out=Buffer.from(data);let nm=0;const win=[];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=y*W+x;if(!M[k])continue;nm++;win.length=0;for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++){const xx=x+i,yy=y+j;if(xx<0||yy<0||xx>=W||yy>=H)continue;const q=yy*W+xx;if(M[q])win.push(L[q]);}
 win.sort((a,b)=>a-b);const lm=win[win.length>>1];const f=Math.min(1.12,Math.max(.8,.8+.4*(lm/sl-.6)))*(1+.04*Math.sin(x*.9));
 for(let c=0;c<3;c++)out[k*3+c]=Math.max(0,Math.min(255,Math.round(SW[c]*f)));}
console.log('body verts near vest',ni,'texels',nm,'sweater',SW.map(Math.round));
// the vest-shaped shell of the body has cracks along the panel edges (white slits against the sky): an inner shell of the same
// triangles, pushed in along the normals, in the repainted sweater texels, closes them from behind. Same skin.
if(C.shell){const N=body.getAttribute('NORMAL').getArray();const J0=body.getAttribute('JOINTS_0'),W0=body.getAttribute('WEIGHTS_0');const keep=[];
 for(let t=0;t<I.length;t+=3){const a=I[t],b=I[t+1],c=I[t+2];if(inV[a]&&inV[b]&&inV[c])keep.push(a,b,c);}
 const used=[...new Set(keep)];const rm=new Map(used.map((v,i)=>[v,i]));const pos=new Float32Array(used.length*3),nor=new Float32Array(used.length*3),uv=new Float32Array(used.length*2);
 const jj=new (J0.getArray().constructor)(used.length*4),ww=new Float32Array(used.length*4);const JA=J0.getArray(),WA=W0.getArray();
 used.forEach((v,i)=>{for(let k=0;k<3;k++){pos[i*3+k]=P[v*3+k]-N[v*3+k]*C.shell;nor[i*3+k]=N[v*3+k];}uv[i*2]=UV[v*2];uv[i*2+1]=UV[v*2+1];for(let k=0;k<4;k++){jj[i*4+k]=JA[v*4+k];ww[i*4+k]=WA[v*4+k];}});
 const buf=R.listBuffers()[0];const A=(t,a)=>d.createAccessor().setType(t).setArray(a).setBuffer(buf);
 const pr=d.createPrimitive().setMaterial(body.getMaterial()).setIndices(A('SCALAR',new Uint32Array(keep.map(v=>rm.get(v))))).setAttribute('POSITION',A('VEC3',pos)).setAttribute('NORMAL',A('VEC3',nor)).setAttribute('TEXCOORD_0',A('VEC2',uv)).setAttribute('JOINTS_0',A('VEC4',jj)).setAttribute('WEIGHTS_0',A('VEC4',ww));
 const n0=R.listNodes().find(n=>n.getName()==='Mesh_0');const nd=d.createNode('undershirt').setMesh(d.createMesh('undershirt').addPrimitive(pr)).setSkin(n0.getSkin()).setTranslation(n0.getTranslation()).setRotation(n0.getRotation()).setScale(n0.getScale());
 (n0.getParentNode()||R.listScenes()[0]).addChild(nd);console.log('undershirt',used.length,'verts',keep.length/3,'tris');}
const png=await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toBuffer();tex.setImage(new Uint8Array(png)).setMimeType('image/png');await io.write(oP,d);
