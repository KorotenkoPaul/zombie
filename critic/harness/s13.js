// s13: like s12, but takes close free-camera shots (Q='?cam=free') the first time each oddity shows. Hero-in-the-world common sense over a game day (render off, fast-forward): every STEP game-hours log the task/clip,
// what each hand holds (props.tools via __grab.held), tools away from home and not held (and whether they rest on something),
// hatch / bedroom door / bolt / shutters states and weather. Usage: node s12.js <out.json> [startHour=6] [hours=24] [step=.25] [ts=20]
const {open,waitFrames}=require('./lib');const fs=require('fs');const OUT=process.argv[2];const H0=+(process.argv[3]||6),HN=+(process.argv[4]||24),ST=+(process.argv[5]||.25),TS=+(process.argv[6]||20);
const SAMPLE=()=>{const {hero,THREE}=window.__dbg;const P=window.__props,G=window.__grab,HS=window.__house||{};let scene=hero.root;while(scene.parent)scene=scene.parent;
 const TG=scene.children.filter(c=>!c.isLight&&!c.isSprite&&!c.isPoints&&!c.isLine&&!(c.isInstancedMesh&&c.count>1500)&&c!==hero.root);
 const onHero0=o=>{let p=o.parent;while(p){if(p===hero.root)return o.parent.name||'?';p=p.parent;}return null;};const rc=new THREE.Raycaster();const v=new THREE.Vector3(),hv=new THREE.Vector3();const held={},away=[];
 for(const [k,o] of Object.entries(P.tools||{})){if(!o||!o.isObject3D)continue;const s=G&&G.held?G.held(o):null;if(s){held[s]=(held[s]?held[s]+',':'')+k;continue;}
  const h=o.userData.home;if(!h)continue;o.getWorldPosition(v);hv.copy(h.pos);if(h.parent&&h.parent.matrixWorld)hv.applyMatrix4(h.parent.matrixWorld);const d=v.distanceTo(hv);
  if(d>.15&&o.visible){const box=new THREE.Box3().setFromObject(o);const c=box.getCenter(new THREE.Vector3());rc.set(new THREE.Vector3(c.x,box.min.y+.02,c.z),new THREE.Vector3(0,-1,0));rc.far=2;
   const hit=rc.intersectObjects(TG,true).find(x=>{let p=x.object;while(p){if(p===o)return false;p=p.parent;}return x.object.visible;});
   const onHero=(()=>{let p=o.parent;while(p){if(p===hero.root)return true;p=p.parent;}return false;})();
   const par=onHero0(o);away.push({par,k,d:+d.toFixed(2),at:v.toArray().map(x=>+x.toFixed(2)),gap:hit?+(box.min.y-hit.point.y).toFixed(3):null,on:hit?(hit.object.name||hit.object.parent?.name||'?'):null,onHero});}}
 const D=P.door,hc=HS.hatch,sh=HS.shutters;const w=window.__weather||{};
 return {hour:+__th.state().hour.toFixed(2),task:hero.task,state:hero.state,clip:hero.cur&&hero.cur.getClip().name,root:hero.root.position.toArray().map(x=>+x.toFixed(2)),held,away,
  hatch:hc&&hc.isOpen?hc.isOpen():null,door:D?{open:+(+D.open).toFixed(2),bolt:+(+D.bolt).toFixed(2)}:null,shut:sh&&sh.k?JSON.parse(JSON.stringify(sh.k)):null,rain:w.rain!=null?+(+w.rain).toFixed(2):null};};
(async()=>{const {b,p,errs}=await open({});const log=[];const shot={};
 await p.evaluate(h=>{const R=window.__renderer;const real=R.render;window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:real;};__noRender(true);__th.setHour(h);},H0);await p.waitForTimeout(2000);
 await p.evaluate(ts=>{window.__TS=ts;},TS);let last=-1,acc=0;
 const cond=s=>{const out=[];const a=k=>s.away.find(x=>x.k===k);
  if(a('benchHammer')&&a('benchHammer').onHero&&!/fix|repair|hammer|nail/.test(s.task||''))out.push('hammer_after_use');
  if(a('waterBucket')&&!/water|bucket|dump/.test(s.task||''))out.push('bucket_left_on_him');
  if(s.task==='sleep'&&s.door&&s.door.open>.5)out.push('sleep_door_open');return out;};
 for(let i=0;i<20000&&acc<HN;i++){const s=await p.evaluate(SAMPLE);if(last>=0){let d=s.hour-last;if(d<0)d+=24;acc+=d;}last=s.hour;log.push(s);
  for(const c of cond(s)){if(shot[c])continue;shot[c]=s.hour;console.log('HIT',c,JSON.stringify({h:s.hour,task:s.task,clip:s.clip,root:s.root,away:s.away,door:s.door,hatch:s.hatch}));
   const r=s.root;for(const [sd,yaw] of [['a',Math.PI*.75],['b',-.4]]){await p.evaluate(([r,yaw])=>{__noRender(false);window.__TS=0.0001;const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(r[0],r[1]+.9,r[2]),yaw,pitch:.15,dist:2.4,snap:true,home:false});},[r,yaw]);
    await waitFrames(p,3);await p.screenshot({path:OUT.replace(/\.json$/,'')+'_'+c+'_'+sd+'.png'});}
   await p.evaluate(ts=>{__noRender(true);window.__TS=ts;},TS);}
  if(Object.keys(shot).length>=3)break;
  await p.waitForTimeout(ST*60000/TS);}
 fs.writeFileSync(OUT,JSON.stringify(log));console.log('samples',log.length,JSON.stringify(shot));await b.close();})();
