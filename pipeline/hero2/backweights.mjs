// Upper back: near the spine the shoulders' weights pull the vest and the body apart sideways when the arms go forward
// (a slit opens below the collar). Hand that weight to Spine2 near the midline, the same on the body and the vest.
// usage: node backweights.mjs in.glb out.glb '{"x":0.08,"y0":0.4,"y1":0.62}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C=JSON.parse(cS);const d=await io.read(iP);
const ss=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
for(const nm of ['Mesh_0','vest']){const n=d.getRoot().listNodes().find(x=>x.getName()===nm);const JN=n.getSkin().listJoints().map(j=>j.getName().replace('mixamorig:',''));const s2=JN.indexOf('Spine2');
 const p=n.getMesh().listPrimitives()[0];const P=p.getAttribute('POSITION').getArray(),J=p.getAttribute('JOINTS_0').getArray().slice(),W=p.getAttribute('WEIGHTS_0').getArray().slice();let ch=0;
 for(let i=0;i<P.length/3;i++){const x=Math.abs(P[i*3]),y=P[i*3+1],z=P[i*3+2];if(z>-0.02||y<C.y0||y>C.y1||x>C.x)continue;
  const keep=ss(x/C.x)*ss((C.y1-y)/0.04)+(1-ss((C.y1-y)/0.04))*0; // 0 at the midline -> shoulders lose their weight there
  const f=(1-ss(x/C.x))*ss((y-C.y0)/0.05);let moved=0;
  for(let k=0;k<4;k++){if(/Shoulder/.test(JN[J[i*4+k]])){const m=W[i*4+k]*f;W[i*4+k]-=m;moved+=m;}}
  if(moved<=1e-4)continue;let slot=-1;for(let k=0;k<4;k++)if(J[i*4+k]===s2&&W[i*4+k]>0)slot=k;if(slot<0){let mn=9;for(let k=0;k<4;k++)if(W[i*4+k]<mn){mn=W[i*4+k];slot=k;}if(W[i*4+slot]>0){moved+=W[i*4+slot];}J[i*4+slot]=s2;W[i*4+slot]=0;}
  W[i*4+slot]+=moved;const s=W[i*4]+W[i*4+1]+W[i*4+2]+W[i*4+3];for(let k=0;k<4;k++)W[i*4+k]/=s;ch++;}
 p.getAttribute('JOINTS_0').setArray(J);p.getAttribute('WEIGHTS_0').setArray(W);console.log(nm,'reweighted',ch);}
await io.write(oP,d);
