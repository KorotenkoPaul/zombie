// Pass-2 routine measurement. Rendering is switched off while sampling so the game runs at full frame rate
// (SwiftShader is ~0.5 fps otherwise); bones are updated with scene.updateMatrixWorld() each frame.
// Per frame: task/state/clip, root and hips world position, feet (ankle + toe) vs floor under them,
// hips vs seat/mattress under them, root yaw. Output: <out>/routine.json, then analyse with a4.js.
// Usage: node s4.js <outdir> [secondsPerTask]
const {open}=require('./lib');const fs=require('fs');const O=process.argv[2];const SEC=+(process.argv[3]||40);
(async()=>{const {b,p,errs}=await open({});
await p.evaluate(()=>{const {hero,heroBones,THREE}=window.__dbg;
 const R=window.__renderer;window.__realRender=R.render;
 window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:window.__realRender;};
 let scene=hero.root;while(scene.parent)scene=scene.parent;window.__scene=scene;
 const rc=new THREE.Raycaster();const TG=scene.children.filter(c=>!c.isLight&&!c.isSprite&&!c.isPoints&&!c.isLine&&!(c.isInstancedMesh&&c.count>1500)&&c!==hero.root);window.__tg=TG.length;const D=new THREE.Vector3(0,-1,0);
 const mine=o=>{while(o){if(o===hero.root)return true;o=o.parent;}return false;};
 const solid=h=>{const o=h.object;if(mine(o)||!o.visible||o.isSprite||o.isPoints||o.isLine)return false;const m=Array.isArray(o.material)?o.material[0]:o.material;
  if(m&&(m.transparent&&m.opacity<.6||m.depthWrite===false||m.blending===THREE.AdditiveBlending))return false;return true;};
 const down=(p,up)=>{rc.set(new THREE.Vector3(p.x,p.y+up,p.z),D);rc.far=up+1.2;const hs=rc.intersectObjects(TG,true).filter(solid);return hs.length?{y:hs[0].point.y,n:hs[0].object.name||hs[0].object.parent?.name||''}:null;};
 const N=Object.keys(heroBones);const B=re=>heroBones[N.find(n=>re.test(n))];
 const H=B(/^hips$/i)||B(/hips/i),LF=B(/leftfoot/i),RF=B(/rightfoot/i),LT=B(/lefttoe(base)?$/i)||B(/lefttoe/i),RT=B(/righttoe(base)?$/i)||B(/righttoe/i),LU=B(/leftupleg/i),RU=B(/rightupleg/i),LL=B(/leftleg$/i),RL=B(/rightleg$/i),SP=B(/spine2|spine1/i),HD=B(/^head$/i)||B(/head/i);
 window.__bonesUsed={H:H?.name,LF:LF?.name,RF:RF?.name,LT:LT?.name,RT:RT?.name,LU:LU?.name,LL:LL?.name};
 const wp=b=>{const v=new THREE.Vector3();b.getWorldPosition(v);return v;};
 window.__log=[];let last=performance.now();
 window.__sample=()=>{const t=performance.now();const dt=(t-last)/1000;last=t;scene.updateMatrixWorld();
  const hp=wp(H),r=hero.root.position;const rec={t,dt,task:hero.task,state:hero.state,clip:hero.cur?hero.cur.getClip().name:'',lad:hero.lad?hero.lad.phase:'',rm:!!(hero.rm||hero.trans),seat:!!hero.seated,bed:!!hero.inBed,
   hip:[hp.x,hp.y,hp.z],root:[r.x,r.y,r.z],ry:hero.root.rotation.y};
  const feet=[];for(const [f,to] of [[LF,LT],[RF,RT]]){const a=wp(f),b2=to?wp(to):a;const g=down(a,.7);const g2=down(b2,.7);feet.push([a.y,b2.y,g?g.y:null,g2?g2.y:null,g?g.n:'']);}rec.feet=feet;
  const s=down(hp,.05);rec.under=s?[s.y,s.n]:null; // first surface below the hips
  const thighs=[];for(const [u,l] of [[LU,LL],[RU,RL]]){const m=wp(u).add(wp(l)).multiplyScalar(.5);const g=down(m,.05);thighs.push([m.y,g?g.y:null,g?g.n:'']);}rec.thigh=thighs;
  rec.head=HD?wp(HD).toArray():null;window.__log.push(rec);};
 const loop=()=>{try{window.__sample();}catch(e){window.__sErr=String(e);}requestAnimationFrame(loop);};requestAnimationFrame(loop);
});
console.log(await p.evaluate(()=>window.__bonesUsed));
const S=await p.evaluate(()=>({bed:__props.surfaces.bed,chair:__props.surfaces.chairSeat,stool:__props.surfaces.stoolSeat,bench:__props.surfaces.benchTop}));
const seq=[['read',11],['cook',8],['wash',9],['tea',13],['craft',10],['look',16],['read',19.9],['sleep',22.5],['cook',7]];
await p.evaluate(()=>{window.__TS=1;__noRender(true);});
for(const [task,h] of seq){await p.evaluate(([t,h])=>{__th.setHour(h);__th.task(t);window.__log.push({mark:t,h});},[task,h]);
 const t0=Date.now();let settled=0;
 while(Date.now()-t0<SEC*1000){await p.waitForTimeout(1000);const s=await p.evaluate(()=>{const h=__dbg.hero;return {path:h.path.length,state:h.state,rm:!!(h.rm||h.trans),lad:!!h.lad}});
  if(s.path==0&&!s.rm&&!s.lad&&s.state==='work'){if(++settled>=6)break;}else settled=0;}
 console.log(task,h,'secs',(Date.now()-t0)/1000);}
// one screenshot per pose with rendering on: seated, bed
const log=await p.evaluate(()=>window.__log);fs.writeFileSync(O+'/routine.json',JSON.stringify({S,log}));
console.log('frames',log.length,await p.evaluate(()=>window.__sErr||''));console.log(errs.join('\n'));await b.close();})();
