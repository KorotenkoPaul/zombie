// shrink head (and hands) toward their centres, blended by skin weight, for all skinned meshes using the same skin joints names
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,inP,outP,hs,ks]=process.argv;const d=await io.read(inP);
const nm=n=>n.getName().replace('mixamorig','').replace(':','');
const groups={Head:+hs,LeftHand:+ks,RightHand:+ks};
const items=[];for(const n of d.getRoot().listNodes()){const sk=n.getSkin(),me=n.getMesh();if(!sk||!me)continue;const J=sk.listJoints().map(nm);for(const p of me.listPrimitives())items.push({p,J,name:n.getName()});}
// centres from the body mesh: bbox of verts with weight>.9
const cen={};const body=items.find(i=>i.name==='Mesh_0');
for(const g in groups){const P=body.p.getAttribute('POSITION').getArray(),Ja=body.p.getAttribute('JOINTS_0').getArray(),W=body.p.getAttribute('WEIGHTS_0').getArray();const gi=body.J.indexOf(g);
 const mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(let v=0;v<P.length/3;v++){let w=0;for(let k=0;k<4;k++)if(Ja[v*4+k]===gi)w+=W[v*4+k];if(w>.9)for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],P[v*3+a]);mx[a]=Math.max(mx[a],P[v*3+a]);}}
 cen[g]=g==='Head'?[(mn[0]+mx[0])/2,mn[1]+(mx[1]-mn[1])*0.35,(mn[2]+mx[2])/2]:[(mn[0]+mx[0])/2,mx[1],(mn[2]+mx[2])/2];console.log(g,cen[g].map(x=>x.toFixed(3)),'size',mx.map((x,i)=>(x-mn[i]).toFixed(3)));}
for(const {p,J} of items){const A=p.getAttribute('POSITION');const P=A.getArray().slice();const Ja=p.getAttribute('JOINTS_0').getArray(),W=p.getAttribute('WEIGHTS_0').getArray();
 const desc={Head:['Head','HeadTop_End','headfront'],LeftHand:['LeftHand','LeftHandMiddle4'],RightHand:['RightHand','RightHandMiddle4']};
 for(let v=0;v<P.length/3;v++)for(const g in groups){let w=0;for(let k=0;k<4;k++)if(desc[g].includes(J[Ja[v*4+k]]))w+=W[v*4+k];if(!w)continue;const s=1+(groups[g]-1)*Math.min(1,w);const c=cen[g];for(let a=0;a<3;a++)P[v*3+a]=c[a]+(P[v*3+a]-c[a])*s;}
 A.setArray(P);}
await io.write(outP,d);console.log('ok');
