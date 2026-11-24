// Hero feet and walk up close (free camera, ?cam=free): force a task with a long walk, then while he walks
// shoot his legs from the side every ~half second of game time (game slowed while drawing), plus per-frame foot heights over the floor.
// Usage: Q='?cam=free' node s11.js <outdir> [task=fetchwater] [hour=10] [n=8]
const {open,waitFrames}=require('./lib');const fs=require('fs');const O=process.argv[2];const T=process.argv[3]||'fetchwater',H=+(process.argv[4]||10),N=+(process.argv[5]||8);
(async()=>{const {b,p}=await open({});
 await p.evaluate(h=>{const R=window.__renderer;const real=R.render;window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:real;};__noRender(true);__th.setHour(h);},H);
 await p.waitForTimeout(3000);await p.evaluate(t=>__th.task(t),T);
 for(let i=0;i<120;i++){await p.waitForTimeout(500);const s=await p.evaluate(()=>{const h=__dbg.hero;return h.state==='walk'&&h.path&&h.path.length>2&&!h.lad;});if(s)break;}
 const log=[];
 for(let k=0;k<N;k++){
  const r=await p.evaluate(()=>{const h=__dbg.hero;const f=[];h.root.traverse(o=>{if(o.isBone&&/foot$|Foot$|toe|Toe/.test(o.name)){const v=new __dbg.THREE.Vector3();o.getWorldPosition(v);f.push([o.name,+v.y.toFixed(3)]);}});return {root:h.root.position.toArray().map(x=>+x.toFixed(2)),ry:+h.root.rotation.y.toFixed(2),state:h.state,clip:h.cur&&h.cur.getClip().name,feet:f};});
  log.push(r);
  await p.evaluate(([r])=>{__noRender(false);window.__TS=0.0001;const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(r.root[0],r.root[1]+.45,r.root[2]),yaw:r.ry+Math.PI/2,pitch:.08,dist:1.8,snap:true,home:false});},[r]);
  await waitFrames(p,2);await p.screenshot({path:`${O}/walk_${k}.png`});
  await p.evaluate(()=>{__noRender(true);window.__TS=1;});await p.waitForTimeout(450);}
 fs.writeFileSync(O+'/walk.json',JSON.stringify(log,null,1));console.log(log.map(l=>l.state+' '+l.clip+' '+JSON.stringify(l.feet)).join('\n'));await b.close();})();
