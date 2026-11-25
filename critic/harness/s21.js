// evidence frames: node ev.js <out> <task> <hour> [seed]
const {open}=require('/home/user/zombie/tests/anim/lib');const [OUT,TASK,H,SEED]=[process.argv[2],process.argv[3],+process.argv[4],+(process.argv[5]||13)];
(async()=>{const {b,p}=await open({seed:SEED,vp:{width:390,height:844},query:'?cam=free'});await p.evaluate(()=>__qa.start());await p.evaluate(s=>__qa.reseed(s),SEED);
 await p.evaluate(()=>{window.__audioTrace=[];});
 await p.evaluate(h=>__th.setHour(h),H);await p.evaluate(()=>__qa.step(60,1/60));await p.evaluate(t=>__th.task(t),TASK);
 let seen=false,n=0,prevLad=null,lastShot=-99,workShots=0,walkShots=0;const log=[];
 const shot=async(tag,yaw,dy,dist)=>{await p.evaluate(([yaw,dy,dist])=>{const r=__dbg.hero.root.position;__th.rig.set({target:{x:r.x,y:r.y+dy,z:r.z},yaw,pitch:.12,dist,snap:true,home:false});__noRender(false);},[yaw,dy,dist]);
  await p.evaluate(()=>__qa.step(1,1/60));await p.screenshot({path:`${OUT}/${TASK}_${String(n++).padStart(2,'0')}_${tag}.png`});await p.evaluate(()=>__noRender(true));};
 for(let i=0;i<900&&n<14;i++){await p.evaluate(()=>__qa.step(6,1/60));
  const s=await p.evaluate(()=>{const h=__dbg.hero;return {t:h.task,st:h.state,lad:!!h.lad,clip:h.cur&&h.cur.name||'',time:__qa.now()}});
  log.push([i,s.t,s.st,s.lad,s.clip].join(' '));
  if(s.t===TASK)seen=true;if((seen&&s.t!==TASK)||(!seen&&i>200))break;if(!seen)continue;
  if(prevLad!==null&&s.lad!==prevLad){await shot(s.lad?'lad_on':'lad_off',.9,.9,2.8);await p.evaluate(()=>__qa.step(12,1/60));await shot(s.lad?'lad_on2':'lad_off2',.9,.9,2.8);}
  else if(s.lad&&i-lastShot>40){lastShot=i;await shot('on_ladder_back',3.1,.9,2.4);}
  else if(s.st==='work'&&workShots<4&&i-lastShot>25){lastShot=i;workShots++;await shot('work',workShots%2?.4:1.9,.8,2.2);}
  else if(s.st==='walk'&&!s.lad&&walkShots<2&&i-lastShot>30){lastShot=i;walkShots++;await shot('walkfeet',1.57,.25,1.4);}
  prevLad=s.lad;}
 const tr=await p.evaluate(()=>window.__audioTrace||[]);require('fs').writeFileSync(`${OUT}/${TASK}_audio.json`,JSON.stringify(tr));require('fs').writeFileSync(`${OUT}/${TASK}_log.txt`,log.join('\n'));
 console.log(TASK,'shots',n,'audio',tr.length);await b.close();})();
