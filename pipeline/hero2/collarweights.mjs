// Back of the collar: right behind the neck, body vertices on 0.8 Shoulder sat next to vertices on 0.6 Head, so when he looked
// down or reached (the sink) those triangles stretched into long dark fans above the vest collar ("teeth", critic). Here the
// weights in that band are replaced by a Gaussian average of the body's own weights around each point (by position, so the body,
// vest and undershirt, which share positions in this space, get the same field and stay layered).
// usage: node collarweights.mjs in.glb out.glb '{"r":0.035,"y0":0.53,"y1":0.56,"z0":-0.05,"z1":-0.09,"x0":0.16,"x1":0.2}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;
const C={r:.035,y0:.53,y1:.56,z0:-.05,z1:-.09,x0:.16,x1:.2,...JSON.parse(cS||'{}')};const d=await io.read(iP);
const ss=(a,b,t)=>{t=(t-a)/(b-a);return t<=0?0:t>=1?1:t*t*(3-2*t);};
const mask=(x,y,z)=>ss(C.y0,C.y1,y)*ss(C.z0,C.z1,z)*(1-ss(C.x0,C.x1,Math.abs(x)));
const nd=nm=>d.getRoot().listNodes().find(x=>x.getName()===nm);
const body=nd('Mesh_0');const BJ=body.getSkin().listJoints().map(j=>j.getName());const bp=body.getMesh().listPrimitives()[0];
const BP=bp.getAttribute('POSITION').getArray(),BJo=bp.getAttribute('JOINTS_0').getArray(),BW=bp.getAttribute('WEIGHTS_0').getArray();
const src=[];for(let i=0;i<BP.length/3;i++){const y=BP[i*3+1],z=BP[i*3+2];if(y>C.y0-2*C.r&&z<C.z0+2*C.r)src.push(i);}
const r2=2*C.r*C.r;
const field=(x,y,z)=>{const acc={};let tw=0;for(const i of src){const dx=BP[i*3]-x,dy=BP[i*3+1]-y,dz=BP[i*3+2]-z;const q=dx*dx+dy*dy+dz*dz;if(q>9*C.r*C.r)continue;const g=Math.exp(-q/r2);tw+=g;for(let k=0;k<4;k++){const w=BW[i*4+k];if(w>0){const nm=BJ[BJo[i*4+k]];acc[nm]=(acc[nm]||0)+g*w;}}}if(!tw)return null;for(const k in acc)acc[k]/=tw;return acc;};
for(const nm of ['Mesh_0','vest','undershirt']){const n=nd(nm);if(!n)continue;const JN=n.getSkin().listJoints().map(j=>j.getName());const p=n.getMesh().listPrimitives()[0];
 const P=p.getAttribute('POSITION').getArray(),J=p.getAttribute('JOINTS_0').getArray().slice(),W=p.getAttribute('WEIGHTS_0').getArray().slice();let ch=0;
 for(let i=0;i<P.length/3;i++){const x=P[i*3],y=P[i*3+1],z=P[i*3+2];const m=mask(x,y,z);if(m<=0)continue;const f=field(x,y,z);if(!f)continue;
  const cur={};for(let k=0;k<4;k++)if(W[i*4+k]>0){const b=JN[J[i*4+k]];cur[b]=(cur[b]||0)+W[i*4+k];}
  const mix={};for(const b of new Set([...Object.keys(cur),...Object.keys(f)]))mix[b]=(1-m)*(cur[b]||0)+m*(f[b]||0);
  const top=Object.entries(mix).filter(([b])=>JN.includes(b)).sort((a,b)=>b[1]-a[1]).slice(0,4);const s=top.reduce((a,c)=>a+c[1],0);
  for(let k=0;k<4;k++){if(top[k]){J[i*4+k]=JN.indexOf(top[k][0]);W[i*4+k]=top[k][1]/s;}else{J[i*4+k]=0;W[i*4+k]=0;}}ch++;}
 p.getAttribute('JOINTS_0').setArray(J);p.getAttribute('WEIGHTS_0').setArray(W);console.log(nm,'collar reweighted',ch);}
await io.write(oP,d);
