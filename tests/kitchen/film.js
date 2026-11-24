// Kitchen actions filmed from 4 sides: node tests/kitchen/film.js <task> <out.jpg> [--opts JSON] [--at s1,s2,..] [--query ?hero=new] [--dist 2.2] [--focus Hips]
// Each row = one moment (seconds after the task starts), 4 columns = front, right, back, left of the hero. Label: task step clip.
const {open}=require('../anim/lib.js');const fs=require('fs');const {execSync}=require('child_process');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
(async()=>{const task=process.argv[2],out=process.argv[3];const opts=JSON.parse(arg('--opts','{}'));const at=arg('--at','4,8,12').split(',').map(Number);
 const dist=+arg('--dist','2.0');const focus=arg('--focus','Spine1');const hour=+arg('--hour','11');
 fs.mkdirSync('/tmp/claude-0',{recursive:true});const tmp=fs.mkdtempSync('/tmp/claude-0/kf-');
 const {b,p,errs}=await open({seed:+arg('--seed','1'),vp:{width:360,height:360},query:arg('--query','')});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(()=>__qa.start());await p.evaluate(([h,e])=>{__qa.reseed(7);__th.setHour(h);__dbg.HH.setBrain({tick(){}});if(e)eval(e);},[hour,arg('--eval','')]);
 await p.evaluate(([t,o])=>{__dbg.HH.startTask(t,o);},[task,opts]);
 // skip the walk there: run frames until the task leaves the 'go' step (or --until STEP), then t=0 is that moment
 const until=arg('--until','');const skipped=await p.evaluate(([u,TT,OPTS])=>{for(let i=0;i<60*120;i++){__qa.step(1,1/60);if(i%600===599&&__dbg.hero.task!==TT)__dbg.HH.startTask(TT,OPTS);const A=__dbg.HH.act;const st=A&&A.step;if(__dbg.hero.task!==TT)continue;if(u?(st===u||(A.fr&&A.fr.st===u)):(st&&st!=='go'))return i;}return -1;},[until,task,opts]);console.log('skipped',skipped,'frames');
 let t=0,files=[];const log=[];
 for(const s of at){const n=Math.round((s-t)*60);if(n>0)await p.evaluate(n=>__qa.step(n,1/60),n);t=s;
  for(let vi=0;vi<4;vi++){const yaw=vi*Math.PI/2;const f=`${tmp}/s${String(s).padStart(6,'0')}_${vi}.png`;
   const info=await p.evaluate(([yaw,dist,focus,EL])=>{const T=__dbg.THREE;const B=__dbg.heroBones;const c=(B[focus]||B.Hips).getWorldPosition(new T.Vector3());const H=__dbg.hero;const fy=H.root.rotation.y+yaw;
    const cam=__qaCamera;cam.position.set(c.x+Math.sin(fy)*Math.cos(EL)*dist,c.y+Math.sin(EL)*dist,c.z+Math.cos(fy)*Math.cos(EL)*dist);cam.lookAt(c);cam.near=Math.max(.05,dist-.9);cam.updateProjectionMatrix();
    if(window.__camera&&window.__camera.dof)window.__camera.dof(false);
    __qaCamera.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);const A=__dbg.HH.act;return (H.task||'')+' '+(A&&A.step||'')+(A&&A.fr?'/'+A.fr.st:'')+' '+(H.cur?H.cur.getClip().name:'');},[yaw,dist,focus,+arg('--el','.45')]);
   await p.locator('canvas').first().screenshot({path:f});if(vi===0)log.push(s+'s '+info);
   execSync(`convert ${f} -gravity north -fill white -undercolor '#0008' -pointsize 13 -annotate +0+3 '${s}s ${['front','right','back','left'][vi]} ${info.replace(/'/g,'')}' ${f}`);files.push(f);}}
 execSync(`montage ${files.join(' ')} -tile 4x -geometry +1+1 -quality 82 ${out}`);console.log('wrote',out);console.log(log.join('\n'));if(errs.length)console.log('errs',errs.slice(0,3));await b.close();})();
