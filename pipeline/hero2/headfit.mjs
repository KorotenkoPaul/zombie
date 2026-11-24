// usage: node headfit.mjs in out '[sx,sy,sz]' '[px,py,pz]' ['[zf,sFront]']  (z >= zf, the face relief, keeps scale sFront so nose and chin keep their shape)
// scale the head (weight-blended) about a pivot at the skull base so it is no bigger than the previous hero's head
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,inP,outP,sS,pS]=process.argv;const s0j=JSON.parse(sS);const piv=JSON.parse(pS);const d=await io.read(inP);const FR=process.argv[6]?JSON.parse(process.argv[6]):null;
const nm=n=>n.getName().replace('mixamorig','').replace(':','');
for(const n of d.getRoot().listNodes()){const sk=n.getSkin(),me=n.getMesh();if(!sk||!me)continue;const J=sk.listJoints().map(nm);
 for(const p of me.listPrimitives()){const A=p.getAttribute('POSITION');const P=A.getArray().slice();const Ja=p.getAttribute('JOINTS_0').getArray(),W=p.getAttribute('WEIGHTS_0').getArray();
  for(let i=0;i<P.length/3;i++){let w=0;for(let k=0;k<4;k++)if(/^(Head|HeadTop_End|headfront)$/.test(J[Ja[i*4+k]]))w+=W[i*4+k];if(!w)continue;const SS=Array.isArray(s0j)?s0j:[s0j,s0j,s0j];for(let a=0;a<3;a++){const s=1+(SS[a]-1)*Math.min(1,w);let nz;
 if(a===2&&FR){const zf=FR[0],sr=1+(FR[1]-1)*Math.min(1,w);const z=P[i*3+2];const fzf=piv[2]+(zf-piv[2])*s;nz=z>=zf?fzf+(z-zf)*sr:piv[2]+(z-piv[2])*s;P[i*3+2]=nz;}
 else P[i*3+a]=piv[a]+(P[i*3+a]-piv[a])*s;}}
  A.setArray(P);}}
await io.write(outP,d);console.log('ok');
