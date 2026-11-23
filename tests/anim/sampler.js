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
 const VOX={n:0,cells:0};const C=[];const m4=new THREE.Matrix4(),mi=new THREE.Matrix4();
 function addShape(geo,mw,name,kind){if(!geo.boundingBox)geo.computeBoundingBox();const bb=geo.boundingBox;const t=geo.type,pr=geo.parameters||{};
  const e=mw.elements;const ax=[V(e[0],e[1],e[2]),V(e[4],e[5],e[6]),V(e[8],e[9],e[10])];const sc=ax.map(a=>a.length());if(sc.some(s=>s<1e-6))return;ax.forEach((a,i)=>a.multiplyScalar(1/sc[i]));
  const lc=bb.getCenter(V()),lh=bb.getSize(V()).multiplyScalar(.5);
  const h=[lh.x*sc[0],lh.y*sc[1],lh.z*sc[2]];if(Math.min(...h)<.003)return; // flat: no volume
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
   for(let i=0;i<o.count;i++){o.getMatrixAt(i,mi);m4.multiplyMatrices(o.matrixWorld,mi);addShape(o.geometry,m4,name+'#'+i,'inst');}return;}
  if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();const s=o.geometry.boundingBox.getSize(V());const sw=V().setFromMatrixScale(o.matrixWorld);const diag=Math.hypot(s.x*sw.x,s.y*sw.y,s.z*sw.z);
  // only primitive-like meshes: boxes/cylinders/spheres, or other meshes small enough that their box is a fair hull
  if(/Box|Cylinder|Sphere/.test(t)){addShape(o.geometry,o.matrixWorld,name,'mesh');return;}
  if(diag>(cfg.maxVoxDiag||3.2)){skipped['big '+name]=Math.round(diag*100)/100;return;}
  voxShape(o,name);});

 // Non-primitive meshes (merged furniture, GLB parts) are voxelised once: rays along +x through every (y,z) voxel row,
 // entering/leaving counted by the triangle normal (works for overlapping closed parts), then a chamfer distance
 // transform gives the depth (cm) of any inside voxel.

 function voxShape(o,name){const g=o.geometry;const P=g.attributes.position;const I=g.index?g.index.array:null;const nt=I?I.length/3:P.count/3;if(nt<4)return;
  if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox.clone();const sz=bb.getSize(V());const pad=.02;bb.min.subScalar(pad);bb.max.addScalar(pad);sz.addScalar(2*pad);
  const sc=V().setFromMatrixScale(o.matrixWorld);const sMin=Math.min(sc.x,sc.y,sc.z);
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
  o.updateMatrixWorld();const inv=o.matrixWorld.clone().invert();
  const c=bb.getCenter(V()).applyMatrix4(o.matrixWorld);const e=o.matrixWorld.elements;const ax=[V(e[0],e[1],e[2]).normalize(),V(e[4],e[5],e[6]).normalize(),V(e[8],e[9],e[10]).normalize()];
  C.push({c,ax,h:[sz.x*sc.x/2,sz.y*sc.y/2,sz.z*sc.z/2],shape:'vox',inv,bmin:bb.min.clone(),cs,nx,ny,nz,D,sMin,name,kind:'vox'});VOX.n++;VOX.cells+=D.length;}
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
 const BB=BN.map(n=>heroBones[n]);
 const out={frames:[],GN,BN,nColl:C.length,skipped,verts:VS.length};
 const vp=V(),q=new THREE.Quaternion();
 function sample(f,dt,hour,tag){scene.updateMatrixWorld();const H=hero;
  const r={f,tag,hour:+hour.toFixed(3),task:H.task,state:H.state,clip:H.cur?H.cur.getClip().name:'',fl:(H.seated?'S':'')+(H.inBed?'B':'')+(H.swing?'W':'')+(H.lad?'L':'')+(H.trans?'T':'')+(H.path&&H.path.length?'P':'')+(H.fit?'F'+H.fit.mode[0]:''),
   node:H.node,ts:H.cur?+(H.cur.getEffectiveTimeScale()*(H.mixer?H.mixer.timeScale:1)).toFixed(3):0,root:H.root.position.toArray().map(v=>+v.toFixed(4)),ry:+H.root.rotation.y.toFixed(4),b:[]};
  for(const b of BB){b.getWorldPosition(vp);r.b.push(+vp.x.toFixed(4),+vp.y.toFixed(4),+vp.z.toFixed(4));}
  heroBones.Hips.getWorldQuaternion(q);r.hq=[q.x,q.y,q.z,q.w].map(v=>+v.toFixed(4));
  // penetration: deepest vertex per group, and which shape
  const pen=GN.map(()=>[0,-1,null]);
  for(const [vi,g] of VS){vp.fromBufferAttribute(pos,vi);M.applyBoneTransform(vi,vp);vp.applyMatrix4(M.matrixWorld);
   query(vp,(s,ci)=>{const d=depth(s,vp);if(d>pen[g][0]){pen[g][0]=d;pen[g][1]=ci;pen[g][2]=[+vp.x.toFixed(3),+vp.y.toFixed(3),+vp.z.toFixed(3)];}});
   if((vi/step)%2===0){const d=trunkDepth(vp);if(d>pen[g][0]){pen[g][0]=d;pen[g][1]=TRUNK;pen[g][2]=[+vp.x.toFixed(3),+vp.y.toFixed(3),+vp.z.toFixed(3)];}}}
  r.pen=pen.map(([d,ci,p])=>ci<0?0:[+(d*100).toFixed(2),ci,p]);
  // ground under each toe/ankle
  r.gnd=[7,8,12,13].map(i=>{const p=V(r.b[i*3],r.b[i*3+1],r.b[i*3+2]);const u=floorUnder(p,.25,1.0);return u?+u[0].toFixed(4):null;});
  out.frames.push(r);}
 window.__A={sample,out,C,depth,query,floorUnder,collNames:()=>C.map(s=>s.name)};
 return {n:C.length,vox:VOX,skipped,verts:VS.length,global:GLOBAL.length,cells:G.size};
};
