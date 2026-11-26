// H12: tools carried on the back (parent Spine2). node s26.js <out> <task> <hour> [seed]: logs back-carried items, shoots 4 sides when one appears and mid-climb
const {open}=require('/home/user/zombie/tests/anim/lib');const [OUT,TASK,H,SEED]=[process.argv[2],process.argv[3],+process.argv[4],+(process.argv[5]||13)];
(async()=>{const {b,p}=await open({seed:SEED,vp:{width:420,height:520},query:'?cam=free'});await p.evaluate(()=>__qa.start());await p.evaluate(s=>__qa.reseed(s),SEED);
 await p.evaluate(h=>__th.setHour(h),H);await p.evaluate(()=>__qa.step(60,1/60));await p.evaluate(t=>__th.task(t),TASK);
 let seen=false,shots=0,last=-999;const log=[];
 for(let i=0;i<2500&&shots<12;i++){await p.evaluate(()=>__qa.step(4,1/60));
  const s=await p.evaluate(()=>{const h=__dbg.hero,sp=__dbg.heroBones.Spine2;const T=(window.__props&&__props.tools)||{};const HB=__dbg.heroBones;const bn=new Set(Object.values(HB));const back=Object.keys(T).filter(n=>T[n]&&T[n].parent&&bn.has(T[n].parent)&&!/Hand/.test(T[n].parent.name)).map(n=>n+'@'+T[n].parent.name.replace('mixamorig',''));return {t:h.task,st:h.state,lad:!!h.lad,back};});
  if(s.t===TASK)seen=true;if((seen&&s.t!==TASK)||(!seen&&i>300))break;if(!seen)continue;
  if(s.back.length)log.push([i,s.st,s.lad,s.back.join(',')].join(' '));
  if(s.back.length&&i-last>(s.lad?40:120)){last=i;
   for(const yaw of [0,1.57,3.14,-1.57]){await p.evaluate(([yaw])=>{const v=new __dbg.THREE.Vector3();__dbg.heroBones.Spine2.getWorldPosition(v);__th.rig.set({target:{x:v.x,y:v.y,z:v.z},yaw,pitch:.15,dist:1.6,snap:true,home:false});__noRender(false);},[yaw]);
    await p.evaluate(()=>__qa.step(1,1/60));await p.screenshot({path:`${OUT}/${TASK}_${String(shots).padStart(2,'0')}_${s.lad?'lad':'walk'}_${s.back[0].replace('@','-')}_y${yaw}.png`});await p.evaluate(()=>__noRender(true));}
   shots++;}}
 require('fs').writeFileSync(`${OUT}/${TASK}_back.txt`,log.join('\n'));console.log(TASK,'backFrames',log.length,'sets',shots,[...new Set(log.map(l=>l.split(' ')[3]))]);await b.close();})();
