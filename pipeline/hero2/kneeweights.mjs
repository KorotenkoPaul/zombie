// Knee: the thigh/shin weights changed over a narrow band, so deep in a crouch the knee folded into a flat sharp wedge (critic pass 22).
// Around each knee the UpLeg/Leg share is re-split by a smooth ramp along the leg (width r x leg length each side of the joint);
// the two bones' total and every other bone's weight stay as they were. With heroclothes.js turning that band about the joint, the
// bent knee stays round.
// usage: node kneeweights.mjs in.glb out.glb '{"r":0.2,"rad":0.16}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C={r:.2,rad:.16,...JSON.parse(cS||'{}')};const d=await io.read(iP);
const ss=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
const n=d.getRoot().listNodes().find(x=>x.getName()==='Mesh_0');const sk=n.getSkin();const JN=sk.listJoints().map(j=>j.getName().replace('mixamorig:',''));const IBM=sk.getInverseBindMatrices().getArray();
const pos=nm=>{const k=JN.indexOf(nm);const m=IBM.slice(k*16,k*16+16);// invert affine 4x4 (column-major): position = -R^T t for rigid; general: solve
 const a=[[m[0],m[4],m[8]],[m[1],m[5],m[9]],[m[2],m[6],m[10]]],t=[m[12],m[13],m[14]];const det=a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])-a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])+a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
 const inv=[[(a[1][1]*a[2][2]-a[1][2]*a[2][1])/det,(a[0][2]*a[2][1]-a[0][1]*a[2][2])/det,(a[0][1]*a[1][2]-a[0][2]*a[1][1])/det],[(a[1][2]*a[2][0]-a[1][0]*a[2][2])/det,(a[0][0]*a[2][2]-a[0][2]*a[2][0])/det,(a[0][2]*a[1][0]-a[0][0]*a[1][2])/det],[(a[1][0]*a[2][1]-a[1][1]*a[2][0])/det,(a[0][1]*a[2][0]-a[0][0]*a[2][1])/det,(a[0][0]*a[1][1]-a[0][1]*a[1][0])/det]];
 return [0,1,2].map(r=>-(inv[r][0]*t[0]+inv[r][1]*t[1]+inv[r][2]*t[2]));};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],len=a=>Math.sqrt(dot(a,a));
for(const p of n.getMesh().listPrimitives()){const P=p.getAttribute('POSITION').getArray(),J=p.getAttribute('JOINTS_0').getArray().slice(),W=p.getAttribute('WEIGHTS_0').getArray().slice();let ch=0;
 for(const sd of ['Left','Right']){const iu=JN.indexOf(sd+'UpLeg'),il=JN.indexOf(sd+'Leg');if(iu<0||il<0)continue;const H=pos(sd+'UpLeg'),K=pos(sd+'Leg'),A=pos(sd+'Foot');const L=len(sub(A,H));const dir=sub(A,H).map(v=>v/L);const R=C.r*L,RAD=C.rad*L;
  for(let i=0;i<P.length/3;i++){const q=[P[i*3],P[i*3+1],P[i*3+2]];const v=sub(q,K);const s=dot(v,dir);if(Math.abs(s)>R*1.2)continue;const radial=len(v.map((x,k)=>x-s*dir[k]));if(radial>RAD)continue;
   let ku=-1,kl=-1;for(let k=0;k<4;k++){if(J[i*4+k]===iu&&W[i*4+k]>0)ku=k;if(J[i*4+k]===il&&W[i*4+k]>0)kl=k;}const wu=ku<0?0:W[i*4+ku],wl=kl<0?0:W[i*4+kl];const m=wu+wl;if(m<.5)continue;
   const t=ss((s+R)/(2*R));/* 0 at the thigh end, 1 at the shin end */let nu=m*(1-t),nl=m*t;
   if(ku<0&&nu>1e-3){let mn=9,k0=-1;for(let k=0;k<4;k++)if(k!==kl&&W[i*4+k]<mn){mn=W[i*4+k];k0=k;}if(mn>1e-3){nu+=0;}/* free the smallest slot: its weight joins the pair */nl+=mn*t;nu+=mn*(1-t);J[i*4+k0]=iu;W[i*4+k0]=0;ku=k0;}
   if(kl<0&&nl>1e-3){let mn=9,k0=-1;for(let k=0;k<4;k++)if(k!==ku&&W[i*4+k]<mn){mn=W[i*4+k];k0=k;}nl+=mn*t;nu+=mn*(1-t);J[i*4+k0]=il;W[i*4+k0]=0;kl=k0;}
   if(ku>=0)W[i*4+ku]=nu;if(kl>=0)W[i*4+kl]=nl;const s4=W[i*4]+W[i*4+1]+W[i*4+2]+W[i*4+3];for(let k=0;k<4;k++)W[i*4+k]/=s4;ch++;}}
 p.getAttribute('JOINTS_0').setArray(J);p.getAttribute('WEIGHTS_0').setArray(W);if(ch)console.log('knee reweighted',ch);}
await io.write(oP,d);
