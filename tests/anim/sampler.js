// Page-side code (runs inside the game page). Builds a static collision model of the world and samples the hero each frame.
// Exposes window.__A = {build(), sample(), out}
module.exports=function install(cfg){
 const {hero,heroBones,THREE}=window.__dbg;let scene=hero.root;while(scene.parent)scene=scene.parent;scene.updateMatrixWorld(true);
 const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
 const mine=o=>{while(o){if(o===hero.root)return true;o=o.parent;}return false;};
 const label=o=>{const parts=[];let x=o;while(x&&x!==scene){if(x.name&&!/^(Mesh|Object|Group|Scene)?_?\d*$/.test(x.name))parts.push(x.name);x=x.parent;}return parts.reverse().join('/')||o.geometry.type;};
 const solidMat=o=>{const m=Array.isArray(o.material)?o.material[0]:o.material;if(!m)return false;if(m.transparent&&m.opacity<.6)return false;if(m.depthWrite===false||m.blending===THREE.AdditiveBlending)return false;return true;};
 const visible=o=>{while(o){if(!o.visible)return false;o=o.parent;}return true;};
 // ---------- colliders: oriented boxes, cylinders and spheres in world space ----------
 const VOX={n:0,cells:0},VCACHE=new Map();const C=[];const m4=new THREE.Matrix4(),mi=new THREE.Matrix4();
 function addShape(geo,mw,name,kind){if(!geo.boundingBox)geo.computeBoundingBox();const bb=geo.boundingBox;const t=geo.type,pr=geo.parameters||{};
  const e=mw.elements;const ax=[V(e[0],e[1],e[2]),V(e[4],e[5],e[6]),V(e[8],e[9],e[10])];const sc=ax.map(a=>a.length());if(sc.some(s=>s<1e-6))return;ax.forEach((a,i)=>a.multiplyScalar(1/sc[i]));
  const lc=bb.getCenter(V()),lh=bb.getSize(V()).multiplyScalar(.5);
  const h=[lh.x*sc[0],lh.y*sc[1],lh.z*sc[2]];if(Math.min(...h)<.003)return; // flat: no volume
  if(Math.max(...h)>6)return; // > 12 m: backdrop (forest ring, sky), never a solid he could touch (collide.js does the same)
  if(t==='CylinderGeometry'&&pr.openEnded)return; // an open tube is a shell, not a solid
  const c=lc.clone().applyMatrix4(mw);
  let shape='box',r=0;
  if(t==='CylinderGeometry'&&Math.abs(sc[0]-sc[2])<1e-3&&Math.abs((pr.radiusTop||0)-(pr.radiusBottom||0))<.02){shape='cyl';r=Math.max(pr.radiusTop,pr.radiusBottom)*sc[0];}
  else if(t==='SphereGeometry'&&Math.abs(sc[0]-sc[1])<1e-3&&Math.abs(sc[1]-sc[2])<1e-3&&(pr.phiLength??6.3)>6.2&&(pr.thetaLength??3.2)>3.1){shape='sph';r=pr.radius*sc[0];}
  const big=Math.hypot(...h)*2;if(/^(Box|Cylinder|Sphere|Buffer|Lathe|Torus|Extrude|Tube|Icosahedron)/.test(name)||/^#/.test(name))name=name+' '+h.map(v=>Math.round(v*200)).sort((a,b)=>b-a).join('x')+'cm';C.push({c,ax,h,shape,r,name,kind,big});}
 let skipped={};
 scene.traverse(o=>{if(!o.isMesh||mine(o)||!visible(o)||!solidMat(o)||o.isSkinnedMesh)return;const t=o.geometry.type;
  if(/Plane|Circle|Shape|Ring/.test(t)){skipped[t]=(skipped[t]||0)+1;return;}
  const name=label(o);
  if(o.isInstancedMesh){if(o.count>1500){skipped['inst>1500 '+name]=o.count;return;}
   // foliage and grass are soft: not colliders
   if(/grass|leaf|leaves|fern|moss|bush|flower|crown/i.test(name)||t==='IcosahedronGeometry'){skipped['foliage '+name]=(skipped['foliage '+name]||0)+o.count;return;}
   const boxy=o.geometry.attributes.position.count<=24;if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();const gs=o.geometry.boundingBox.getSize(V());
   for(let i=0;i<o.count;i++){o.getMatrixAt(i,mi);m4.multiplyMatrices(o.matrixWorld,mi);
    if(boxy||/Box|Cylinder|Sphere/.test(t)){addShape(o.geometry,m4,name+'#'+i,'inst');continue;}
    const sw=V().setFromMatrixScale(m4);if(Math.hypot(gs.x*sw.x,gs.y*sw.y,gs.z*sw.z)>(cfg.maxVoxDiag||3.2)){skipped['big inst '+name]=(skipped['big inst '+name]||0)+1;continue;}
    voxShape(o,name+'#'+i,m4.clone());}return;}
  if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();const s=o.geometry.boundingBox.getSize(V());const sw=V().setFromMatrixScale(o.matrixWorld);const diag=Math.hypot(s.x*sw.x,s.y*sw.y,s.z*sw.z);
  // only primitive-like meshes: boxes/cylinders/spheres, or other meshes small enough that their box is a fair hull
  if(/Box|Cylinder|Sphere/.test(t)){addShape(o.geometry,o.matrixWorld,name,'mesh');return;}
  if(diag>(cfg.maxVoxDiag||3.2)){if(diag<20&&splitBig(o,name))return;skipped['big '+name]=Math.round(diag*100)/100;return;}
  voxShape(o,name);});

 // Non-primitive meshes (merged furniture, GLB parts) are voxelised once: rays along +x through every (y,z) voxel row,
 // entering/leaving counted by the triangle normal (works for overlapping closed parts), then a chamfer distance
 // transform gives the depth (cm) of any inside voxel.


 // a big merged mesh (propsStatic: all the furniture in one 8.6 m mesh): split it into its connected parts (vertices welded
 // at 0.1 mm) and voxelise each part on its own
 function splitBig(o,name){const g=o.geometry,P=g.attributes.position;if(!P)return false;const I=g.index?g.index.array:null;const nt=I?I.length/3:P.count/3;if(nt>400000)return false;
  const wid=new Int32Array(P.count);const wm=new Map();for(let i=0;i<P.count;i++){const k=Math.round(P.getX(i)*1e4)+','+Math.round(P.getY(i)*1e4)+','+Math.round(P.getZ(i)*1e4);let w=wm.get(k);if(w===undefined){w=wm.size;wm.set(k,w);}wid[i]=w;}
  const par=new Int32Array(wm.size);for(let i=0;i<par.length;i++)par[i]=i;const fd=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  const vi=t=>I?[I[t*3],I[t*3+1],I[t*3+2]]:[t*3,t*3+1,t*3+2];
  for(let t=0;t<nt;t++){const [a,b,c]=vi(t);const ra=fd(wid[a]),rb=fd(wid[b]),rc=fd(wid[c]);par[rb]=ra;par[fd(rc)]=fd(ra);}
  const comp=new Map();for(let t=0;t<nt;t++){const r=fd(wid[vi(t)[0]]);let a=comp.get(r);if(!a)comp.set(r,a=[]);a.push(t);}
  let n=0;o.updateMatrixWorld();for(const tris of comp.values()){if(tris.length<4)continue;const arr=new Float32Array(tris.length*9);let q=0;
   for(const t of tris)for(const v of vi(t)){arr[q++]=P.getX(v);arr[q++]=P.getY(v);arr[q++]=P.getZ(v);}
   const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(arr,3));sg.computeBoundingBox();const sz=sg.boundingBox.getSize(V());const sw=V().setFromMatrixScale(o.matrixWorld);
   if(Math.hypot(sz.x*sw.x,sz.y*sw.y,sz.z*sw.z)>(cfg.maxVoxDiag||3.2)){skipped['big part '+name]=(skipped['big part '+name]||0)+1;continue;}
   voxShape({geometry:sg,updateMatrixWorld(){},matrixWorld:o.matrixWorld},name+'~'+(n++));}
  skipped['split '+name]=n;return n>0;}
 function voxShape(o,name,MW){o.updateMatrixWorld();const mw=MW||o.matrixWorld;const g=o.geometry;const P=g.attributes.position;const I=g.index?g.index.array:null;const nt=I?I.length/3:P.count/3;if(nt<4)return;
  if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox.clone();const sz=bb.getSize(V());const pad=.02;bb.min.subScalar(pad);bb.max.addScalar(pad);sz.addScalar(2*pad);
  const sc=V().setFromMatrixScale(mw);const cached=VCACHE.get(g.uuid);if(cached){pushVox(cached,mw,sc,bb,sz,name);return;}const sMin=Math.min(sc.x,sc.y,sc.z);
  let cs=Math.max((cfg.vox||.012)/sMin,Math.cbrt(sz.x*sz.y*sz.z/2.5e6));const nx=Math.ceil(sz.x/cs),ny=Math.ceil(sz.y/cs),nz=Math.ceil(sz.z/cs);
  const occ=new Uint8Array(nx*ny*nz);const idx=(i,j,k)=>(k*ny+j)*nx+i;
  // bin triangles over (j,k) rows
  const bins=new Map();const A=V(),B=V(),Cc=V(),T=[];
  for(let t=0;t<nt;t++){const ia=I?I[t*3]:t*3,ib=I?I[t*3+1]:t*3+1,ic=I?I[t*3+2]:t*3+2;A.fromBufferAttribute(P,ia);B.fromBufferAttribute(P,ib);Cc.fromBufferAttribute(P,ic);
   const nxv=(B.y-A.y)*(Cc.z-A.z)-(B.z-A.z)*(Cc.y-A.y);if(Math.abs(nxv)<1e-12)continue;T.push([A.x,A.y,A.z,B.x,B.y,B.z,Cc.x,Cc.y,Cc.z,Math.sign(nxv)]);const ti=T.length-1;
   const j0=Math.max(0,Math.ceil((Math.min(A.y,B.y,Cc.y)-bb.min.y)/cs-.5)),j1=Math.min(ny-1,Math.floor((Math.max(A.y,B.y,Cc.y)-bb.min.y)/cs-.5));
   const k0=Math.max(0,Math.ceil((Math.min(A.z,B.z,Cc.z)-bb.min.z)/cs-.5)),k1=Math.min(nz-1,Math.floor((Math.max(A.z,B.z,Cc.z)-bb.min.z)/cs-.5));
   for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++){const kk=k*ny+j;let a=bins.get(kk);if(!a)bins.set(kk,a=[]);a.push(ti);}}
  for(const [kk,list] of bins){const j=kk%ny,k=(kk-j)/ny;const y=bb.min.y+(j+.5)*cs,z=bb.min.z+(k+.5)*cs;const hits=[];
   for(const ti of list){const t=T[ti];// barycentric in (y,z)
    const d=(t[4]-t[1])*(t[8]-t[2])-(t[5]-t[2])*(t[7]-t[1]);if(Math.abs(d)<1e-14)continue;
    const u=((y-t[1])*(t[8]-t[2])-(z-t[2])*(t[7]-t[1]))/d,v=((t[4]-t[1])*(z-t[2])-(t[5]-t[2])*(y-t[1]))/d;if(u<0||v<0||u+v>1)continue;
    hits.push([t[0]+u*(t[3]-t[0])+v*(t[6]-t[0]),t[9]]);}
   if(hits.length<2)continue;hits.sort((a,b)=>a[0]-b[0]);let w=0;
   for(let h=0;h<hits.length-1;h++){w+=-hits[h][1];if(w>0){const i0=Math.max(0,Math.ceil((hits[h][0]-bb.min.x)/cs-.5)),i1=Math.min(nx-1,Math.floor((hits[h+1][0]-bb.min.x)/cs-.5));for(let i=i0;i<=i1;i++)occ[idx(i,j,k)]=1;}}}
  // chamfer distance (in voxels*10) inside
  const D=new Uint16Array(nx*ny*nz);let any=0;for(let q=0;q<D.length;q++){D[q]=occ[q]?60000:0;any+=occ[q];}if(!any)return;
  const W=[[1,0,0,10],[0,1,0,10],[0,0,1,10],[1,1,0,14],[1,-1,0,14],[1,0,1,14],[1,0,-1,14],[0,1,1,14],[0,1,-1,14],[1,1,1,17],[1,1,-1,17],[1,-1,1,17],[1,-1,-1,17]];
  for(const dir of [1,-1]){const ks=dir>0?[0,nz,1]:[nz-1,-1,-1],js=dir>0?[0,ny,1]:[ny-1,-1,-1],is=dir>0?[0,nx,1]:[nx-1,-1,-1];
   for(let k=ks[0];k!==ks[1];k+=ks[2])for(let j=js[0];j!==js[1];j+=js[2])for(let i=is[0];i!==is[1];i+=is[2]){const q=idx(i,j,k);if(!D[q])continue;let m=D[q];
    for(const [a,b,c,wt] of W){const ii=i-dir*c,jj=j-dir*b,kk2=k-dir*a;// neighbours already visited in this pass (z-major order)
     if(ii<0||jj<0||kk2<0||ii>=nx||jj>=ny||kk2>=nz){m=Math.min(m,wt);continue;}const v=D[idx(ii,jj,kk2)]+wt;if(v<m)m=v;}
    for(const [a,b,c,wt] of [[0,0,1,10],[0,1,0,10]]){}D[q]=m;}}
  const data={cs,nx,ny,nz,D};VCACHE.set(g.uuid,data);pushVox(data,mw,sc,bb,sz,name);VOX.cells+=D.length;}
 function pushVox(d,mw,sc,bb,sz,name){const inv=mw.clone().invert();const sMin=Math.min(sc.x,sc.y,sc.z);
  const c=bb.getCenter(V()).applyMatrix4(mw);const e=mw.elements;const ax=[V(e[0],e[1],e[2]).normalize(),V(e[4],e[5],e[6]).normalize(),V(e[8],e[9],e[10]).normalize()];
  C.push({c,ax,h:[sz.x*sc.x/2,sz.y*sc.y/2,sz.z*sc.z/2],shape:'vox',inv,bmin:bb.min.clone(),cs:d.cs,nx:d.nx,ny:d.ny,nz:d.nz,D:d.D,sMin,name,kind:'vox'});VOX.n++;}
 // ---------- spatial hash ----------
 const CS=.25,G=new Map();const key=(i,j,k)=>i+','+j+','+k;
 C.forEach((s,idx)=>{let mn=V(1e9,1e9,1e9),mx=V(-1e9,-1e9,-1e9);for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){const p=s.c.clone().addScaledVector(s.ax[0],sx*s.h[0]).addScaledVector(s.ax[1],sy*s.h[1]).addScaledVector(s.ax[2],sz*s.h[2]);mn.min(p);mx.max(p);}
  s.mn=mn;s.mx=mx;
  if((mx.x-mn.x)*(mx.y-mn.y)*(mx.z-mn.z)/(CS*CS*CS)>40000){s.global=true;return;}
  for(let i=Math.floor(mn.x/CS);i<=Math.floor(mx.x/CS);i++)for(let j=Math.floor(mn.y/CS);j<=Math.floor(mx.y/CS);j++)for(let k=Math.floor(mn.z/CS);k<=Math.floor(mx.z/CS);k++){const kk=key(i,j,k);let a=G.get(kk);if(!a)G.set(kk,a=[]);a.push(idx);}});
 C.push({c:V(),ax:[V(1,0,0),V(0,1,0),V(0,0,1)],h:[0,0,0],shape:'none',name:'trunk (bark)',kind:'trunk',global:false});const TRUNK=C.length-1;
 const GLOBAL=C.map((s,i)=>s.global?i:-1).filter(i=>i>=0);
 const tmp=V();
 // depth of point p inside shape s (>0 inside, <=0 outside)
 function depth(s,p){tmp.copy(p).sub(s.c);const x=tmp.dot(s.ax[0]),y=tmp.dot(s.ax[1]),z=tmp.dot(s.ax[2]);
  if(s.shape==='box')return Math.min(s.h[0]-Math.abs(x),s.h[1]-Math.abs(y),s.h[2]-Math.abs(z));
  if(s.shape==='cyl')return Math.min(s.r-Math.hypot(x,z),s.h[1]-Math.abs(y));
  if(s.shape==='vox'){vq.copy(p).applyMatrix4(s.inv);const i=Math.floor((vq.x-s.bmin.x)/s.cs),j=Math.floor((vq.y-s.bmin.y)/s.cs),k=Math.floor((vq.z-s.bmin.z)/s.cs);
   if(i<0||j<0||k<0||i>=s.nx||j>=s.ny||k>=s.nz)return -1;const d=s.D[(k*s.ny+j)*s.nx+i];return d?(d/10-.5)*s.cs*s.sMin:-1;}
  return s.r-Math.hypot(x,y,z);}
 const vq=V();
 function query(p,fn){const kk=key(Math.floor(p.x/CS),Math.floor(p.y/CS),Math.floor(p.z/CS));const a=G.get(kk);if(a)for(const i of a)fn(C[i],i);for(const i of GLOBAL)fn(C[i],i);}
 // surface under a point: highest top of a box/cyl below p (vertical ray)
 function floorUnder(p,up=.3,down=1.2){let best=null,bn='';const q=V();for(let d=-up;d<=down;d+=CS*.9){q.set(p.x,p.y-d,p.z);query(q,(s,i)=>{const top=topAt(s,p.x,p.z);if(top!=null&&top<=p.y+up&&top>=p.y-down&&(best==null||top>best)){best=top;bn=s.name;}});}return best==null?null:[best,bn];}
 function topAt(s,x,z){ // highest y of shape s at column x,z (shapes with one local axis ~vertical)
  if(s.shape==='vox')return null;let u=0;for(let a=1;a<3;a++)if(Math.abs(s.ax[a].y)>Math.abs(s.ax[u].y))u=a;if(Math.abs(s.ax[u].y)<.95)return null;
  const a1=(u+1)%3,a2=(u+2)%3;tmp.set(x-s.c.x,0,z-s.c.z);const l1=tmp.x*s.ax[a1].x+tmp.z*s.ax[a1].z,l2=tmp.x*s.ax[a2].x+tmp.z*s.ax[a2].z;
  if(s.shape==='sph'){if(Math.hypot(l1,l2)>s.r)return null;return s.c.y+Math.sqrt(Math.max(0,s.r*s.r-l1*l1-l2*l2));}
  if(s.shape==='cyl'&&u===1){if(Math.hypot(l1,l2)>s.r)return null;return s.c.y+s.h[1];}
  if(Math.abs(l1)>s.h[a1]||Math.abs(l2)>s.h[a2])return null;return s.c.y+s.h[u]*Math.abs(s.ax[u].y);}
 // trunk (bark): the game's own cross-section test; depth = shortest horizontal way out
 const inTrunk=window.__dbg.inTrunk;const TDIR=[...Array(12)].map((_,i)=>[Math.cos(i*Math.PI/6),Math.sin(i*Math.PI/6)]);
 function trunkDepth(p){if(!inTrunk||!inTrunk(p.x,p.y,p.z,0))return 0;let best=.3;for(const [dx,dz] of TDIR){for(let d=.005;d<best;d+=.005){if(!inTrunk(p.x+dx*d,p.y,p.z+dz*d,0)){best=d;break;}}}return best;}
 // ---------- body samples: skinned vertices grouped by their main bone ----------
 const sk=[];hero.root.traverse(o=>{if(o.isSkinnedMesh)sk.push(o);});const M=sk[0];const pos=M.geometry.attributes.position,si=M.geometry.attributes.skinIndex,sw2=M.geometry.attributes.skinWeight;
 const GROUP=n=>/Head|Neck|headfront/.test(n)?'head':/LeftHand|LeftForeArm/.test(n)?'handL':/RightHand|RightForeArm/.test(n)?'handR':/Foot|Toe/.test(n)?'feet':/Leg$/.test(n)?'shins':/UpLeg|Hips/.test(n)?'hips':/Arm|Shoulder/.test(n)?'arms':'torso';
 const GC=(a,i,k)=>[a.getX,a.getY,a.getZ,a.getW][k].call(a,i);
 const GN=['head','handL','handR','feet','shins','hips','arms','torso'];const VS=[];const step=cfg.vertStep||10;
 for(let i=0;i<pos.count;i+=step){let bi=0,bw=-1;for(let k=0;k<4;k++){const w=GC(sw2,i,k);if(w>bw){bw=w;bi=GC(si,i,k);}}VS.push([i,GN.indexOf(GROUP(M.skeleton.bones[bi].name))]);}
 const BN=['Hips','Spine2','Neck','Head','HeadTop_End','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','LeftToe_End','RightUpLeg','RightLeg','RightFoot','RightToeBase','RightToe_End','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand'];
 // the old hero's skeleton has no end bones: put them where they would be (head top 18 cm on from the neck, toe tip 7 cm on from the ankle)
 const EXT={HeadTop_End:['Neck','Head',.18],LeftToe_End:['LeftFoot','LeftToeBase',.07],RightToe_End:['RightFoot','RightToeBase',.07]};
 const BB=BN.map(n=>heroBones[n]||{getWorldPosition(v){const [a,b,l]=EXT[n];const pa=heroBones[a].getWorldPosition(new THREE.Vector3());heroBones[b].getWorldPosition(v);return v.add(v.clone().sub(pa).setLength(l));}});
 // ladder rungs: thin horizontal bars among the solid boxes (board ladders) + the lashed round rungs of the rope ladders (merged mesh)
 const RUNGS=[];
 for(const sh of C){if(sh.shape==='vox'||sh.shape==='none'||!sh.h)continue;const o=[0,1,2].sort((a,b)=>sh.h[b]-sh.h[a]);const L=sh.h[o[0]];
  if(L>.18&&L<.38&&sh.h[o[1]]<.045&&Math.abs(sh.ax[o[0]].y)<.3)RUNGS.push({c:[sh.c.x,sh.c.y,sh.c.z],d:[sh.ax[o[0]].x,sh.ax[o[0]].y,sh.ax[o[0]].z],h:L,k:'board'});}
 scene.traverse(o=>{if(!o.isMesh||!o.material||!o.material.color||o.material.color.getHex()!==0x7a5236)return;const P=o.geometry.attributes.position;if(!P)return;o.updateMatrixWorld();
  const cl=new Map();const w=V();for(let i=0;i<P.count;i++){w.fromBufferAttribute(P,i).applyMatrix4(o.matrixWorld);const k=Math.round(w.y/.06)+'|'+Math.round(w.x/1.2)+'|'+Math.round(w.z/1.2);
   let c=cl.get(k);if(!c){c={mn:w.clone(),mx:w.clone()};cl.set(k,c);}c.mn.min(w);c.mx.max(w);}
  for(const c of cl.values()){const sz=c.mx.clone().sub(c.mn);const L=Math.max(sz.x,sz.z);if(L>.45&&L<.8&&sz.y<.12){const cc=c.mn.clone().add(c.mx).multiplyScalar(.5);RUNGS.push({c:[cc.x,cc.y,cc.z],d:sz.x>sz.z?[1,0,0]:[0,0,1],h:L/2,k:'rope'});}}});
 // moving objects (door, hatch lid, bolt, oven door, fridge, buckets, dishes, gear): every object whose world matrix changes
 // names for the props the game registers (window.__props / __house): door, hatch, oven, fridge, bucket...
 const PN=new Map();for(const [src,O] of [['props',window.__props],['house',window.__house],['ground',window.__ground]]){if(!O)continue;for(const k of Object.keys(O)){const v=O[k];if(!v||typeof v!=='object')continue;
   if(v.isObject3D){if(!PN.has(v))PN.set(v,k);continue;}for(const kk of Object.keys(v)){const w=v[kk];if(w&&w.isObject3D&&!PN.has(w))PN.set(w,k+'.'+kk);}}}
 const propName=o=>{for(let x=o,d=0;x&&d<6;x=x.parent,d++)if(PN.has(x))return PN.get(x)+(d?'/'+d:'');return null;};
 const MOV=[];const heroRoot=hero.root;const isHero=o=>{for(let x=o;x;x=x.parent)if(x===heroRoot)return true;return false;};
 scene.traverse(o=>{if(o===scene||o.isLight||o.isCamera||isHero(o)||o.isInstancedMesh||o.isPoints||o.isSprite)return;if(o.isMesh&&o.geometry){if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();if(o.geometry.boundingSphere.radius>2.5)return;}
  if(!o.isMesh&&!o.isGroup&&o.type!=='Object3D')return;if(o.userData.fluid||o.userData.fx)return;/* running water (tap, pour, drip) follows the bucket or tap, nobody's hand moves it */const nm=propName(o)||[o.name,o.parent&&o.parent.name,o.parent&&o.parent.parent&&o.parent.parent.name].filter(Boolean).join('<')||(o.geometry?o.geometry.type:o.type);
  const wp=new THREE.Vector3();o.getWorldPosition(wp);let kids=0;o.traverse(()=>kids++);MOV.push({o,last:o.matrixWorld.elements.slice(),nm,id:MOV.length,n:0,at:[+wp.x.toFixed(2),+wp.y.toFixed(2),+wp.z.toFixed(2)],kids});});
 const BX=new THREE.Box3(),HP=[V(),V()],FA=V();const MI=new Map(MOV.map(m=>[m.o,m]));
 // the hatch lid swings or falls on its own after letGo (real gravity): mark those frames so the no-touch check skips them
 const HT=window.__house&&window.__house.hatch;let hatchFree=false;
 if(HT&&HT.letGo&&!HT.__qa){HT.__qa=1;const lg=HT.letGo.bind(HT),dr=HT.drive.bind(HT);HT.letGo=o=>{hatchFree=true;return lg(o);};HT.drive=a=>{hatchFree=false;return dr(a);};}
 const HAND=[heroBones.LeftHand,heroBones.RightHand];let lastDoor=null,hipLast=null;const hipNow=V();const DYN=new Set(),DV=V(),DL=V(),DS=V(),DI=new THREE.Matrix4();const BODYP=VS.map(()=>[V(),0]);
 const QB=['Spine2','Neck','Head','LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(n=>heroBones[n]);
 const out={frames:[],GN,BN,nColl:C.length,skipped,verts:VS.length,rungs:RUNGS,QN:['Spine2','Neck','Head','LeftFoot','RightFoot','LeftToeBase','RightToeBase']};
 const vp=V(),q=new THREE.Quaternion();
 function sample(f,dt,hour,tag){scene.updateMatrixWorld();const H=hero;
  const r={f,tag,hour:+hour.toFixed(3),task:H.task,state:H.state,clip:H.cur?H.cur.getClip().name:'',fl:(H.seated?'S':'')+(H.inBed?'B':'')+(H.swing?'W':'')+(H.lad?'L':'')+(H.trans?'T':'')+(H.path&&H.path.length?'P':'')+(H.fit?'F'+H.fit.mode[0]:''),
   node:H.node,ts:H.cur?+(H.cur.getEffectiveTimeScale()*(H.mixer?H.mixer.timeScale:1)).toFixed(3):0,root:H.root.position.toArray().map(v=>+v.toFixed(4)),ry:+H.root.rotation.y.toFixed(4),b:[]};
  for(const b of BB){b.getWorldPosition(vp);r.b.push(+vp.x.toFixed(4),+vp.y.toFixed(4),+vp.z.toFixed(4));}
  heroBones.Hips.getWorldQuaternion(q);r.hq=[q.x,q.y,q.z,q.w].map(v=>+v.toFixed(4));
  r.q=[];for(const b of QB){b.getWorldQuaternion(q);r.q.push(+q.x.toFixed(4),+q.y.toFixed(4),+q.z.toFixed(4),+q.w.toFixed(4));}
  // penetration: deepest vertex per group, and which shape
  const pen=GN.map(()=>[0,-1,null]);
  // lying / sitting: how far the lowest part of each body group is above whatever is under it (1 cm steps down to 40 cm)
  const supOn=!!(H.inBed||H.seated)&&!H.swing;const sup=GN.map(()=>40);const sp=V();
  // live boxes of moved seats (chair scooted under the table with him on it: the baked collider is still at its home spot)
  const SEATB=[];if(supOn)for(const o of DYN)if(o.userData.seat&&o.visible)o.traverse(m=>{if(!m.isMesh||!m.visible||!m.geometry)return;const g=m.geometry;if(!g.boundingBox)g.computeBoundingBox();SEATB.push([new THREE.Matrix4().copy(m.matrixWorld).invert(),g.boundingBox]);});
  const inSeat=p=>{for(const [mi,bb] of SEATB){DL.copy(p).applyMatrix4(mi);if(bb.containsPoint(DL))return true;}return false;};
  const solidAt=p=>{let r=false;query(p,(sh)=>{if(!r&&depth(sh,p)>.002)r=true;});return r||(SEATB.length>0&&inSeat(p));};
  let nb=0;for(const [vi,g] of VS){vp.fromBufferAttribute(pos,vi);M.applyBoneTransform(vi,vp);vp.applyMatrix4(M.matrixWorld);if(nb<BODYP.length)BODYP[nb][0].copy(vp),BODYP[nb][1]=g;nb++;
   if(supOn&&(vi/step)%2===0&&sup[g]>0){sp.copy(vp);let k=0;for(;k<sup[g]&&k<40;k++){if(solidAt(sp))break;sp.y-=.01;}if(k<sup[g])sup[g]=k;}
   query(vp,(s,ci)=>{const d=depth(s,vp);if(d>pen[g][0]){pen[g][0]=d;pen[g][1]=ci;pen[g][2]=[+vp.x.toFixed(3),+vp.y.toFixed(3),+vp.z.toFixed(3)];}});
   if((vi/step)%2===0){const d=trunkDepth(vp);if(d>pen[g][0]){pen[g][0]=d;pen[g][1]=TRUNK;pen[g][2]=[+vp.x.toFixed(3),+vp.y.toFixed(3),+vp.z.toFixed(3)];}}}
  if(supOn)r.sup=sup;
  r.pen=pen.map(([d,ci,p])=>ci<0?0:[+(d*100).toFixed(2),ci,p]);
  // ground under each toe/ankle
  r.gnd=[7,8,12,13].map(i=>{const p=V(r.b[i*3],r.b[i*3+1],r.b[i*3+2]);const u=floorUnder(p,.25,1.0);return u?+u[0].toFixed(4):null;});
  // which objects moved this frame (topmost moved one only), and how far the nearer palm is from it
  {const pr=[];heroBones.LeftHand.getWorldPosition(HP[0]);heroBones.LeftForeArm.getWorldPosition(FA);HP[0].add(HP[0].clone().sub(FA).setLength(.07));
   heroBones.RightHand.getWorldPosition(HP[1]);heroBones.RightForeArm.getWorldPosition(FA);HP[1].add(HP[1].clone().sub(FA).setLength(.07));const hp=H.root.position;
   const moved=new Set(),carried=new Set();heroBones.Hips.getWorldPosition(hipNow);const DD=new Map();for(const m of MOV){const e=m.o.matrixWorld.elements;let d=0,dOther=0;for(let k=0;k<16;k++){const x=Math.abs(e[k]-m.last[k]);if(x>d)d=x;if(k!==0&&k!==5&&k!==10&&k!==13&&x>dOther)dOther=x;}DD.set(m,[d,dOther]);}
   for(const m of MOV){const e=m.o.matrixWorld.elements;const [d,dOther]=DD.get(m);
    // a child that only rises/falls or scales on its own (water level in a bucket or sink while the tap runs) is not something he moves
    const pm=m.o.parent&&MI.get(m.o.parent);const levelOnly=dOther<2e-4&&pm&&DD.get(pm)[0]<=2e-4;
    if(d>2e-4&&levelOnly){for(let k=0;k<16;k++)m.last[k]=e[k];continue;}
    if(d>2e-4){moved.add(m.o);
     // carried on the body (slung bucket/bag on a rope at the hip, parked to the skeleton every frame): it moves with the hips, not by magic.
     // Same step as the hips (within 3 cm) and close to them -> carried, not counted by no-touch
     const pl=V(m.last[12],m.last[13],m.last[14]),pn=V(e[12],e[13],e[14]);if(hipLast&&pn.distanceTo(hipNow)<.9&&pn.clone().sub(pl).distanceTo(hipNow.clone().sub(hipLast))<.03)carried.add(m.o);
     for(let k=0;k<16;k++)m.last[k]=e[k];}}
   // the open door sways in the wind (props.js wind()): that is not the hero moving it. Count the door only when its open/bolt value changed
   const DR=window.__props&&window.__props.door;let doorStill=false;if(DR){const v=DR.open+DR.bolt*10;doorStill=v===lastDoor;lastDoor=v;}
   const inDoor=o=>{if(!DR||!DR.obj)return false;for(let x=o;x;x=x.parent)if(x===DR.obj)return true;return false;};
   // a child that rides on a moving parent (bottle on the fridge door shelf while the hand swings the door by its handle) belongs to the
   // topmost ancestor that moved at all since its last record, even below the per-frame threshold: measure the palm to that whole assembly
   {const up=new Set();for(const o of moved){let top=o;for(let x=o.parent;x;x=x.parent){const mx=MI.get(x);if(mx&&DD.get(mx)&&DD.get(mx)[0]>1e-6)top=x;}up.add(top);}moved.clear();for(const o of up)moved.add(o);}
   for(const o of moved){if(o.parent&&moved.has(o.parent))continue;if(doorStill&&inDoor(o))continue;if(carried.has(o))continue;{let ff=false;for(let x=o;x&&!ff;x=x.parent)if(x.userData&&x.userData.freeFall)ff=true;if(ff)continue;}/* dropped and falling under gravity (game sets userData.freeFall), like the hatch after letGo */const m=MI.get(o);m.n++;if(isHero(o))continue;o.getWorldPosition(vp);if(vp.distanceTo(hp)>2.5)continue;
    BX.setFromObject(o);if(BX.isEmpty())continue;const dh=Math.min(BX.distanceToPoint(HP[0]),BX.distanceToPoint(HP[1]));pr.push([m.id,+(dh*100).toFixed(1)]);}
   if(pr.length)r.mv=pr;hipLast=(hipLast||V()).copy(hipNow);if(hatchFree)r.hfree=1;
   // held tools: anything hung under a hand bone (not a bone); distance from that palm to the tool's mesh
   const gr=[];HAND.forEach((hb,k)=>{for(const ch of hb.children){if(ch.isBone||!ch.visible||ch.isLight)continue;BX.setFromObject(ch);if(BX.isEmpty()||BX.getSize(vp).length()>1.5)continue;gr.push([propName(ch)||ch.name||(ch.children[0]&&ch.children[0].name)||'tool',k,+(BX.distanceToPoint(HP[k])*100).toFixed(1)]);}});
   if(gr.length)r.grip=gr;
   // things that move (carried bucket, held tools, opened doors, plates): body vertices inside them. Static furniture is covered by the colliders above
   for(const o of moved)if(!isHero(o))DYN.add(o);HAND.forEach(hb=>{for(const ch of hb.children)if(!ch.isBone&&ch.visible&&!ch.isLight)DYN.add(ch);});
   const hp2=H.root.position;let best=null;
   for(const o of DYN){if(!o.visible||o.userData.fluid||o.userData.fx)continue;if(o.userData.seat&&(H.seated||H.trans||!moved.has(o)))continue;/* the chair he sits on (moved under the table with him on it) is the seat, not a penetration; standing still it is plain furniture for the colliders */o.getWorldPosition(vp);if(vp.distanceTo(hp2)>1.6)continue;const nm=propName(o)||o.name||'held';let off=false;for(let x=o;x&&!off;x=x.parent)if(x.userData&&x.userData.offFoot)off=true;/* boot sliding off its foot (game sets userData.offFoot): feet/shins inside it is how it comes off */
    o.traverse(m=>{if(!m.isMesh||!m.visible||!m.geometry||m.isSkinnedMesh||m.userData.fluid||m.userData.fx)return;const g=m.geometry;if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox;const sz=bb.getSize(DV);if(sz.length()<.03||sz.length()>2.5)return;
     DI.copy(m.matrixWorld).invert();const cx=(bb.min.x+bb.max.x)/2,cz=(bb.min.z+bb.max.z)/2,rr=Math.min(sz.x,sz.z)/2;const round=Math.abs(sz.x-sz.z)<.15*Math.max(sz.x,sz.z);
     const sc=DS.setFromMatrixScale(m.matrixWorld);const k=Math.min(sc.x,sc.y,sc.z);
     for(const [p,g2] of BODYP){if(g2===1||g2===2||(off&&(g2===3||g2===4)))continue;DL.copy(p).applyMatrix4(DI);if(DL.y<bb.min.y||DL.y>bb.max.y)continue;let d;
      if(round){const rd=Math.hypot(DL.x-cx,DL.z-cz);if(rd>=rr)continue;d=Math.min(rr-rd,DL.y-bb.min.y,bb.max.y-DL.y);}
      else{if(DL.x<bb.min.x||DL.x>bb.max.x||DL.z<bb.min.z||DL.z>bb.max.z)continue;d=Math.min(DL.x-bb.min.x,bb.max.x-DL.x,DL.y-bb.min.y,bb.max.y-DL.y,DL.z-bb.min.z,bb.max.z-DL.z);}
      d*=k;if(d>.01&&(!best||d>best[2]))best=[nm,g2,d];}});}
   if(best)r.dp=[best[0],GN[best[1]],+(best[2]*100).toFixed(1)];}
  out.frames.push(r);}

 window.__A={sample,out,movNames:()=>MOV.map(m=>[m.nm,m.n,m.at,m.kids]),C,depth,query,floorUnder,collNames:()=>C.map(s=>s.name)};
 return {n:C.length,vox:VOX,skipped,verts:VS.length,global:GLOBAL.length,cells:G.size};
};
