// A vest's armhole rides on the shoulder, not on the upper arm: vest vertices carried up to 0.7 of LeftArm/RightArm, so reaching
// forward dragged the strap and armhole edges into stretched spikes (critic pass 22, at the sink). The arm's share above a cap
// goes to the same side's Shoulder.
// usage: node vestarm.mjs in.glb out.glb '{"cap":0.25}'
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const C={cap:.25,...JSON.parse(cS||'{}')};const d=await io.read(iP);
const n=d.getRoot().listNodes().find(x=>x.getName()==='vest');const JN=n.getSkin().listJoints().map(j=>j.getName().replace('mixamorig:',''));const p=n.getMesh().listPrimitives()[0];
const J=p.getAttribute('JOINTS_0').getArray().slice(),W=p.getAttribute('WEIGHTS_0').getArray().slice();let ch=0;
for(let i=0;i<J.length/4;i++){for(const sd of ['Left','Right']){const a=JN.indexOf(sd+'Arm'),s=JN.indexOf(sd+'Shoulder');if(a<0||s<0)continue;
  let ka=-1;for(let k=0;k<4;k++)if(J[i*4+k]===a)ka=k;if(ka<0||W[i*4+ka]<=C.cap)continue;const ex=W[i*4+ka]-C.cap;W[i*4+ka]=C.cap;
  let ks=-1;for(let k=0;k<4;k++)if(J[i*4+k]===s&&W[i*4+k]>0)ks=k;if(ks<0){let mn=9;for(let k=0;k<4;k++)if(k!==ka&&W[i*4+k]<mn){mn=W[i*4+k];ks=k;}
   /* the slot's old bone hands its weight to the shoulder too */const old=W[i*4+ks];J[i*4+ks]=s;W[i*4+ks]=old;}W[i*4+ks]+=ex;ch++;}}
p.getAttribute('JOINTS_0').setArray(J);p.getAttribute('WEIGHTS_0').setArray(W);console.log('vest arm weight capped on',ch);await io.write(oP,d);
