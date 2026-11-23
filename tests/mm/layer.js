// layering check: he starts stretching and walks off while still stretching. node tests/mm/layer.js out.json.gz [--off]
const fs=require('fs'),zlib=require('zlib');const {open}=require('../anim/lib.js');
(async()=>{const out=process.argv[2];const off=process.argv.includes('--off');const {b,p,errs}=await open({seed:2});await p.evaluate(()=>__qa.start());
 await p.evaluate(off=>{__qa.reseed(5);__th.setHour(10.5);window.__noMotion=off;__dbg.HH.setBrain({tick(){}});window.__LQ=['Hips','Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightUpLeg','RightLeg','RightFoot','RightToeBase'];},off);
 await p.evaluate(()=>__th.task('wash'));for(let i=0;i<40;i++){await p.evaluate(()=>__qa.step(30,1/60));const s=await p.evaluate(()=>__dbg.hero.path.length);if(!s&&i>4)break;}
 await p.evaluate(()=>{__qa.step(120,1/60);const HH=__dbg.HH;HH.startTask('micro',{clip:'hy_stretch'});});
 const fr=[];await p.evaluate(()=>{__qa.step(40,1/60);__dbg.HH.goTo('kl_m');});
 for(let i=0;i<200;i++){fr.push(await p.evaluate(()=>{__qa.step(1,1/60);const h=__dbg.hero,hb=__dbg.heroBones;const i=window.__motion.info();
  return {f:__qa.frame,root:h.root.position.toArray(),ry:h.root.rotation.y,fl:h.path.length?'P':'',clip:h.cur&&h.cur.getClip().name,mm:[i.on,i.layer,i.clip],lq:__LQ.map(n=>hb[n].quaternion.toArray()),hp:hb.Hips.position.toArray(),b:[]};}));}
 fs.writeFileSync(out,zlib.gzipSync(JSON.stringify({frames:fr})));console.log(fr.filter((f,i)=>i%20==0).map(f=>f.clip+' '+f.mm.join(',')+' '+f.fl).join('\n'),errs);await b.close();})();
