// A full in-game day of the hero, up close. Game time is fast-forwarded with rendering off (__TS),
// and every STEP game-hours the hero is photographed from two sides through the game camera,
// with a skinned-mesh depth check (how deep any body vertex is under the first surface 25 cm above it).
// Usage: node s8.js <outdir> [startHour=6] [hours=24] [step=1]
const {open,waitFrames}=require('./lib');const fs=require('fs');const O=process.argv[2];
const H0=+(process.argv[3]||6),HN=+(process.argv[4]||24),STEP=+(process.argv[5]||1);
const DEPTH=()=>{const {hero,THREE}=window.__dbg;let scene=hero.root;while(scene.parent)scene=scene.parent;scene.updateMatrixWorld(true);
 const TG=scene.children.filter(c=>!c.isLight&&!c.isSprite&&!c.isPoints&&!c.isLine&&!(c.isInstancedMesh&&c.count>1500)&&c!==hero.root);
 const rc=new THREE.Raycaster();const D=new THREE.Vector3(0,-1,0);const v=new THREE.Vector3();const res=[];
 hero.root.traverse(m=>{if(!m.isSkinnedMesh||!m.visible)return;const pos=m.geometry.attributes.position;const st=Math.max(1,Math.floor(pos.count/1500));
  for(let i=0;i<pos.count;i+=st){v.fromBufferAttribute(pos,i);m.applyBoneTransform(i,v);v.applyMatrix4(m.matrixWorld);
   rc.set(new THREE.Vector3(v.x,v.y+.25,v.z),D);rc.far=.25;const h=rc.intersectObjects(TG,true).find(h=>{const o=h.object;const mt=Array.isArray(o.material)?o.material[0]:o.material;return o.visible&&!(mt&&mt.transparent&&mt.opacity<.6);});
   if(h)res.push([h.point.y-v.y,h.object.name||h.object.parent?.name||'?']);}});
 res.sort((a,b)=>b[0]-a[0]);const by={};res.forEach(r=>{if(r[0]>.02)by[r[1]]=Math.max(by[r[1]]||0,+r[0].toFixed(3));});
 const h=hero;return {task:h.task,state:h.state,clip:h.cur&&h.cur.getClip().name,root:h.root.position.toArray().map(x=>+x.toFixed(2)),n2cm:res.filter(r=>r[0]>.02).length,deepest:by};};
(async()=>{const {b,p,errs}=await open({});const log=[];
 await p.evaluate(h=>{const R=window.__renderer;const real=R.render;window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:real;};__th.setHour(h);__th.cam();},H0);
 for(let k=0;k*STEP<HN;k++){const target=(H0+k*STEP)%24;
  // fast-forward to target hour with rendering off
  await p.evaluate(()=>{__noRender(true);window.__TS=20;});
  for(let i=0;i<240;i++){const hr=await p.evaluate(()=>__th.state().hour);const d=((target-hr)%24+24)%24;if(d<.05||d>23.9)break;await p.waitForTimeout(250);}
  await p.evaluate(()=>{window.__TS=1;});await p.waitForTimeout(600);
  const m=await p.evaluate(DEPTH);m.hour=target;log.push(m);console.log(JSON.stringify(m));
  const r=m.root;const lab=String(target).padStart(2,'0')+'_'+(m.task||'none')+'_'+(m.clip||'');
  for(const [s,yaw] of [['a',-.55],['b',.6]]){await p.evaluate(([r,yaw])=>{__noRender(false);const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(r[0],r[1]+.9,r[2]),yaw,pitch:.12,dist:2.6,snap:true});},[r,yaw]);
   await p.evaluate(()=>{window.__TS=0.0001;});await waitFrames(p,3);await p.screenshot({path:`${O}/day_${lab}_${s}.png`});await p.evaluate(()=>{window.__TS=1;});}
 }
 fs.writeFileSync(O+'/day.json',JSON.stringify(log,null,1));console.log(errs.filter(e=>!/Sprite/.test(e)).slice(0,5).join('\n'));await b.close();})();
