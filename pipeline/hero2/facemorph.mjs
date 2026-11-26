// Face life for the v6 head (painted face, no face rig): morph targets on Mesh_0 (all primitives; the body's are zero, sparse):
//   effort: brows down and together, cheeks up (squint), mouth corners pulled out, lips pressed
//   smile:  mouth corners up and out, cheeks up
//   yawn:   jaw drops 13 mm (lower face only), upper lip up, brows up
// plus a 'mouth' node (skinned to Head, own dark material) whose 'yawn' target opens an oval over the stretched lips.
// Coordinates: mesh space of the v6 graft (mouth centre 0,.678; brows +-.058,.822; face front z>.05).
// usage: node facemorph.mjs in.glb out.glb ['{"jaw":0.013}']
import * as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {sparse} from '@gltf-transform/functions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=Object.assign({jaw:.013,my:.678,mw:.026,bx:.058,by:.822},cS?JSON.parse(cS):{});
const d=await io.read(iP);const root=d.getRoot();const n0=root.listNodes().find(n=>n.getName()==='Mesh_0');const mesh=n0.getMesh();const prims=mesh.listPrimitives();
const sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};const g=(x,y,cx,cy,r)=>Math.exp(-((x-cx)**2+(y-cy)**2)/(r*r));
function eff(x,y,z){const f=sm(.05,.08,z);if(f<=0)return [0,0,0];let dx=0,dy=0,dz=0;
 for(const s of [-1,1]){const b=g(x,y,s*C.bx,C.by,.035);dy-=.0035*b;dx-=s*.0025*b;const bi=g(x,y,s*.03,C.by-.004,.02);dy-=.002*bi;
  const ch=g(x,y,s*.06,.72,.028);dy+=.0025*ch;dz+=.001*ch;const mc=g(x,y,s*.04,C.my,.018);dx+=s*.0035*mc;dy-=.0012*mc;}
 dz-=.001*g(x,y,0,C.my,.02);return [dx*f,dy*f,dz*f];}
function smile(x,y,z){const f=sm(.05,.08,z);if(f<=0)return [0,0,0];let dx=0,dy=0,dz=0;
 for(const s of [-1,1]){const mc=g(x,y,s*.04,C.my,.02);dx+=s*.003*mc;dy+=.0045*mc;dz+=.001*mc;const ch=g(x,y,s*.055,.715,.03);dy+=.003*ch;dz+=.0015*ch;}
 dy+=.001*g(x,y,0,C.my-.008,.02);return [dx*f,dy*f,dz*f];}
function jawW(x,y,z){return sm(C.my+.006,C.my-.014,y)*(1-sm(.05,.11,Math.abs(x)))*sm(0,.06,z);}
function yawn(x,y,z){const f=sm(.05,.08,z);const w=jawW(x,y,z);let dy=-C.jaw*w,dz=-.003*w;dy+=.002*g(x,y,0,C.my+.012,.025)*f;
 for(const s of [-1,1])dy+=.004*g(x,y,s*C.bx,C.by,.035)*f;return [0,dy,dz];}
const buf=root.listBuffers()[0];const A=(t,a)=>d.createAccessor().setType(t).setArray(a).setBuffer(buf);
for(const [k,p] of prims.entries()){const P=p.getAttribute('POSITION').getArray();const nv=P.length/3;const E=new Float32Array(nv*3),Y=new Float32Array(nv*3),SM=new Float32Array(nv*3);let ne=0;
 if(p.getMaterial()?.getName()==='head')for(let i=0;i<nv;i++){const x=P[i*3],y=P[i*3+1],z=P[i*3+2];const e=eff(x,y,z),q=yawn(x,y,z);E.set(e,i*3);Y.set(q,i*3);SM.set(smile(x,y,z),i*3);if(Math.abs(e[1])+Math.abs(q[1])>1e-4)ne++;}
 p.addTarget(d.createPrimitiveTarget('effort').setAttribute('POSITION',A('VEC3',E)));p.addTarget(d.createPrimitiveTarget('yawn').setAttribute('POSITION',A('VEC3',Y)));p.addTarget(d.createPrimitiveTarget('smile').setAttribute('POSITION',A('VEC3',SM)));console.log('prim',k,'moved',ne);}
mesh.setWeights([0,0,0]).setExtras(Object.assign({},mesh.getExtras(),{targetNames:['effort','yawn','smile']}));
// mouth oval: cast on the head's front surface
const HP=prims.filter(p=>p.getMaterial()?.getName()==='head');const tris=[];for(const p of HP){const P=p.getAttribute('POSITION').getArray(),I=p.getIndices().getArray();for(let t=0;t<I.length;t+=3){const a=I[t],b=I[t+1],c=I[t+2];if(P[a*3+2]>.05&&Math.abs(P[a*3+1]-C.my)<.05)tris.push([P.slice(a*3,a*3+3),P.slice(b*3,b*3+3),P.slice(c*3,c*3+3)]);}}
const ray=new T.Ray(),tg=new T.Vector3(),va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3();
function cast(x,y){ray.set(new T.Vector3(x,y,1),new T.Vector3(0,0,-1));let best=null;for(const [a,b,c] of tris){va.fromArray(a);vb.fromArray(b);vc.fromArray(c);if(!ray.intersectTriangle(va,vb,vc,false,tg))continue;if(best&&tg.z<=best.p.z)continue;const n=new T.Triangle(va,vb,vc).getNormal(new T.Vector3());if(n.z<0)n.negate();best={p:tg.clone(),n};}return best;}
// a point of the yawned surface at height y: find the rest height y' with y'+dy(y')=y
function yawned(x,y){let yr=y;for(let it=0;it<12;it++){const h=cast(x,yr);if(!h)return null;const q=yawn(x,yr,h.p.z);yr=y-q[1];}const h=cast(x,yr);const q=yawn(x,yr,h.p.z);return {p:h.p.clone().add(new T.Vector3(...q)),n:h.n};}
const COLS=13,ROWS=6,pos=[],tgt=[],nor=[],idx=[];const top=.0022,bot=C.jaw*.92;
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){const u=-1+2*c/(COLS-1);const k=Math.sqrt(Math.max(0,1-u*u));const x=u*C.mw;const v=r/(ROWS-1);
 const y=C.my+top*k-(top+bot)*k*v;const Y=yawned(x,y);const B=cast(x,C.my);
 const pY=Y.p.clone().addScaledVector(Y.n,.0009),pB=B.p.clone().addScaledVector(B.n,-.003);pos.push(pB.x,pB.y,pB.z);tgt.push(pY.x-pB.x,pY.y-pB.y,pY.z-pB.z);nor.push(Y.n.x,Y.n.y,Y.n.z);}
for(let r=0;r<ROWS-1;r++)for(let c=0;c<COLS-1;c++){const a=r*COLS+c,b=a+1,e=a+COLS,f=e+1;idx.push(a,e,b,b,e,f);}
const nv=pos.length/3;const skin=n0.getSkin();const head=skin.listJoints().findIndex(j=>/Head$/.test(j.getName()));
const J=new Uint16Array(nv*4),W=new Float32Array(nv*4);for(let i=0;i<nv;i++){J[i*4]=head;W[i*4]=1;}
const mat=d.createMaterial('mouth').setBaseColorFactor([.16,.045,.04,1]).setRoughnessFactor(.8).setMetallicFactor(0);
const prim=d.createPrimitive().setMaterial(mat).setIndices(A('SCALAR',new Uint16Array(idx))).setAttribute('POSITION',A('VEC3',new Float32Array(pos))).setAttribute('NORMAL',A('VEC3',new Float32Array(nor)))
 .setAttribute('JOINTS_0',A('VEC4',J)).setAttribute('WEIGHTS_0',A('VEC4',W));prim.addTarget(d.createPrimitiveTarget('yawn').setAttribute('POSITION',A('VEC3',new Float32Array(tgt))));
const mm=d.createMesh('mouth').addPrimitive(prim).setWeights([0]).setExtras({targetNames:['yawn']});
const n=d.createNode('mouth').setMesh(mm).setSkin(skin).setTranslation(n0.getTranslation()).setRotation(n0.getRotation()).setScale(n0.getScale());
const par=n0.getParentNode();if(par)par.addChild(n);else root.listScenes()[0].addChild(n);
await d.transform(sparse({ratio:1/3}));await io.write(oP,d);console.log('mouth verts',nv,'head joint',head);
