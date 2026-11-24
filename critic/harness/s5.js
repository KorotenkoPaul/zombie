// Pass-2 pose check with the real skinned mesh (not bones): how deep the body goes into the chair seat,
// the floor and the mattress, and where on the bed the hero lies. Plus close-up screenshots of each pose.
// Usage: node s5.js <outdir>
const {open,waitFrames}=require('./lib');const fs=require('fs');const O=process.argv[2];
const MEASURE=()=>{const {hero,THREE}=window.__dbg;let scene=hero.root;while(scene.parent)scene=scene.parent;scene.updateMatrixWorld(true);
 const meshes=[];hero.root.traverse(o=>{if(o.isSkinnedMesh&&o.visible)meshes.push(o);});
 const V=[];const v=new THREE.Vector3();for(const m of meshes){const pos=m.geometry.attributes.position;const st=Math.max(1,Math.floor(pos.count/4000));
  for(let i=0;i<pos.count;i+=st){v.fromBufferAttribute(pos,i);m.applyBoneTransform(i,v);v.applyMatrix4(m.matrixWorld);V.push([v.x,v.y,v.z]);}}
 const TG=scene.children.filter(c=>!c.isLight&&!c.isSprite&&!c.isPoints&&!c.isLine&&!(c.isInstancedMesh&&c.count>1500)&&c!==hero.root);
 const rc=new THREE.Raycaster();const D=new THREE.Vector3(0,-1,0);
 const surf=(x,z,y0)=>{rc.set(new THREE.Vector3(x,y0,z),D);rc.far=3;const h=rc.intersectObjects(TG,true).filter(h=>{const o=h.object;const m=Array.isArray(o.material)?o.material[0]:o.material;return o.visible&&!(m&&m.transparent&&m.opacity<.6);})[0];return h?{y:h.point.y,n:(h.object.name||h.object.parent?.name||'')}:null;};
 let minY=1e9;V.forEach(p=>{if(p[1]<minY)minY=p[1];});
 // per-vertex: surface right under (cast from 0.5 m above the hero's lowest point region); depth = surface - vertex
 const top=Math.max(...V.map(p=>p[1]))+.05;const pen=[];let below=0;
 const lowV=V.filter(p=>p[1]<minY+.6);for(const p of lowV){const s=surf(p[0],p[2],p[1]+.5);if(s&&s.y>p[1]+.005){below++;pen.push([s.y-p[1],s.n,p]);}}
 pen.sort((a,b)=>b[0]-a[0]);
 const names={};pen.forEach(q=>names[q[1]||'?']=(names[q[1]||'?']||0)+1);
 const root=hero.root.position;const bed=__props.surfaces.bed[0];
 let inBed=0,nBody=0;for(const p of V){if(p[1]>bed.top-.1&&p[1]<bed.top+.6){nBody++;if(p[0]>bed.x0&&p[0]<bed.x1&&p[2]>bed.z0&&p[2]<bed.z1)inBed++;}}
 const xs=V.map(p=>p[2]);return {verts:V.length,minY,floorUnderRoot:surf(root.x,root.z,root.y+.5),root:root.toArray(),penVerts:below,of:lowV.length,maxDepth:pen[0]?pen[0][0]:0,p90:pen.length?pen[Math.floor(pen.length*.1)][0]:0,into:names,
  bodyZ:[Math.min(...xs),Math.max(...xs)],bodyX:[Math.min(...V.map(p=>p[0])),Math.max(...V.map(p=>p[0]))],bed:{x:[bed.x0,bed.x1],z:[bed.z0,bed.z1],top:bed.top},bedFrac:nBody?inBed/nBody:0,task:hero.task,state:hero.state,clip:hero.cur&&hero.cur.getClip().name};};
const shot=async(p,name,rp,yaw,pitch,dist)=>{await p.evaluate(([rp,y,pi,d])=>{__noRender(false);__th.cam(rp[0],rp[1]+.6,d,rp[2]);__th.view(y,pi,1);},[rp,yaw,pitch,dist]);await waitFrames(p,3);await p.screenshot({path:O+'/'+name+'.png'});await p.evaluate(()=>{__th.cam();__noRender(true);});};
(async()=>{const res={};
 for(const run of (process.env.RUNS||'seated,sleep,cook,craft').split(',')){const {b,p,errs}=await open({});
  await p.evaluate(()=>{const R=window.__renderer;const real=R.render;window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:real;};__noRender(true);});
  await p.evaluate(r=>{__th.setHour(r==='sleep'?22.5:r==='seated'?11:10);if(r!=='seated')__th.task(r);else __th.task('read');},run);
  // wait until working
  for(let i=0;i<90;i++){await p.waitForTimeout(1000);const s=await p.evaluate(()=>{const h=__dbg.hero;return {path:h.path.length,state:h.state,rm:!!(h.rm||h.trans),lad:!!h.lad,bed:!!h.inBed,hold:h.bedHold}});if(s.path==0&&!s.rm&&!s.lad&&s.state==='work'&&i>3){await p.waitForTimeout(run==='sleep'?6000:2500);break;}}
  await p.evaluate(()=>{__noRender(true);});
  res[run]=await p.evaluate(MEASURE);console.log(run,JSON.stringify(res[run]));
  const rp=res[run].root;
  if(run==='seated'){await shot(p,'p2_chair_side',rp,-1.2,.12,2.2);await shot(p,'p2_chair_back',rp,2.6,.2,2.2);}
  if(run==='sleep'){await shot(p,'p2_bed_front',rp,0,.25,2.6);await shot(p,'p2_bed_top',rp,.3,.9,2.6);}
  if(run==='cook'){await shot(p,'p2_cook',rp,.3,.12,2.4);}
  if(run==='craft'){await shot(p,'p2_craft',rp,.3,.12,2.4);}
  if(errs.length)console.log(errs.filter(e=>!/Sprite/.test(e)).slice(0,5).join('\n'));await b.close();}
 fs.writeFileSync(O+'/poses.json',JSON.stringify(res,null,1));})();
