// Close-up renders of the hero's hands during a task: node tests/grab/look.js <task> <out.png> [--opts JSON] [--at s1,s2,...] [--hand Right] [--dist .7] [--eval JS] [--until step]
// Each shot: the given second after the task starts, two views (front-left, front-right) around the chosen hand. Makes one contact sheet.
const {open}=require('../anim/lib.js');const fs=require('fs');const path=require('path');const {execSync}=require('child_process');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
(async()=>{const task=process.argv[2],out=process.argv[3];const opts=JSON.parse(arg('--opts','{}'));const at=arg('--at','4,6,8').split(',').map(Number);const hand=arg('--hand','Right');const dist=+arg('--dist','.75');
 const tmp=fs.mkdtempSync('/tmp/claude-0/look-');const {b,p,errs}=await open({seed:1,vp:{width:420,height:420},query:arg('--query','')});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(()=>__qa.start());await p.evaluate(([e])=>{__qa.reseed(7);__th.setHour(11);eval(e);},[arg('--eval','')]);
 await p.evaluate(([t,o])=>{if(window.__brain&&__brain.command&&!Object.keys(o).length)__th.task(t);else __dbg.HH.startTask(t,o);},[task,opts]);
 const until=arg('--until',null);if(until)await p.evaluate(u=>{for(let i=0;i<6000;i++){__qa.step(1,1/60);const a=__dbg.HH.act;if(a&&a.step===u)break;}},until);
 let t=0,files=[];
 for(const s of at){const n=Math.round((s-t)*60);if(n>0)await p.evaluate(n=>__qa.step(n,1/60),n);t=s;
  for(const [vi,yaw] of [[0,-.7],[1,.7]]){const f=`${tmp}/s${String(s).padStart(5,'0')}_${vi}.png`;
   const info=await p.evaluate(([hand,yaw,dist])=>{const T=__dbg.THREE;const B=__dbg.heroBones;const c=B[hand+'Hand'].getWorldPosition(new T.Vector3());const H=__dbg.hero;const fy=H.root.rotation.y+yaw;
    const cam=__qaCamera;cam.position.set(c.x+Math.sin(fy)*Math.cos(.3)*dist,c.y+Math.sin(.3)*dist,c.z+Math.cos(fy)*Math.cos(.3)*dist);cam.lookAt(c);if(cam.near>.05){cam.near=.05;cam.updateProjectionMatrix();}if(window.__camera&&window.__camera.dof)window.__camera.dof(false);
    __qaCamera.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);const A=__dbg.HH.act;return (H.task||'')+' '+(A&&A.step||'')+' '+(H.cur?H.cur.getClip().name:'');},[hand,yaw,dist]);
   await p.locator('canvas').first().screenshot({path:f});
   execSync(`convert ${f} -gravity north -fill white -undercolor '#0008' -pointsize 14 -annotate +0+4 '${s}s ${info.replace(/'/g,'')}' ${f}`);files.push(f);}}
 execSync(`montage ${files.join(' ')} -tile 2x -geometry +2+2 ${out}`);console.log('wrote',out,errs.slice(0,3));await b.close();})();
