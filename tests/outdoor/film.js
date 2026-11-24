// Outdoor actions film: node tests/outdoor/film.js <task> <out.jpg> [--opts JSON] [--until step] [--at s1,s2,...] [--views 4] [--dist 2.6] [--query ?hero=new] [--eval JS]
// After the task starts (and, with --until, once act.step reaches that step) it renders the whole body from N sides at each time.
const {open}=require('../anim/lib.js');const fs=require('fs');const {execSync}=require('child_process');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
(async()=>{const task=process.argv[2],out=process.argv[3];const opts=JSON.parse(arg('--opts','{}'));const at=arg('--at','1,2,3').split(',').map(Number);
 const nv=+arg('--views','4'),dist=+arg('--dist','3.2'),hour=+arg('--hour','11');
 const tmp=fs.mkdtempSync('/tmp/claude-0/film-');const {b,p,errs}=await open({seed:1,vp:{width:360,height:420},query:arg('--query','')});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(()=>__qa.start());await p.evaluate(([e,h])=>{__qa.reseed(7);__th.setHour(h);__dbg.HH.setBrain({tick(){}});eval(e);},[arg('--eval',''),hour]);
 await p.evaluate(([t,o,fr])=>{if(fr)__dbg.HH.spawn(t,{from:fr,opts:o});else __dbg.HH.startTask(t,o);},[task,opts,arg('--from','')]);
 const until=arg('--until',null);if(until){let r=-1;for(let k=0;k<480&&r<0;k++){r=await p.evaluate(([u,T0,k])=>{for(let i=0;i<30;i++){__qa.step(1,1/60);const a=__dbg.HH.act;if(a&&a.step===u&&__dbg.HH.H.task===T0)return (k*30+i)/60;}return -1;},[until,task,k]);}console.log('until',until,'at',r);}
 let t=0,files=[];
 for(const s of at){const n=Math.round((s-t)*60);if(n>0)await p.evaluate(n=>__qa.step(n,1/60),n);t=s;
  for(let vi=0;vi<nv;vi++){const yaw=-.6+vi*2*Math.PI/nv;const f=`${tmp}/s${String(s).padStart(6,'0')}_${vi}.png`;
   const info=await p.evaluate(([yaw,dist])=>{const T=__dbg.THREE;const H=__dbg.hero;const B=__dbg.heroBones;const c=B.Hips.getWorldPosition(new T.Vector3());c.y-=.15;const fy=H.root.rotation.y+yaw;
    const cam=__qaCamera;cam.position.set(c.x+Math.sin(fy)*dist,c.y+.8,c.z+Math.cos(fy)*dist);cam.lookAt(c);if(cam.near>.05){cam.near=.05;cam.updateProjectionMatrix();}if(window.__camera&&window.__camera.dof)window.__camera.dof(false);
    cam.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);const A=__dbg.HH.act;return (H.task||'')+' '+(A&&A.step||'')+' '+(H.cur?H.cur.getClip().name:'');},[yaw,dist]);
   await p.locator('canvas').first().screenshot({path:f});
   execSync(`convert ${f} -gravity north -fill white -undercolor '#0008' -pointsize 13 -annotate +0+4 '${s}s ${info.replace(/'/g,'')}' ${f}`);files.push(f);}}
 execSync(`montage ${files.join(' ')} -tile ${nv}x -geometry +2+2 -quality 82 ${out}`);console.log('wrote',out,errs.slice(0,3));await b.close();})();
