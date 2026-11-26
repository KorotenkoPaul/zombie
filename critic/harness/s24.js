// 4-side work frames at 2 moments: node ev4.js <out> <task> <hour> [seed]
const {open}=require('/home/user/zombie/tests/anim/lib');const [OUT,TASK,H,SEED]=[process.argv[2],process.argv[3],+process.argv[4],+(process.argv[5]||13)];
(async()=>{const {b,p}=await open({seed:SEED,vp:{width:480,height:480},query:'?cam=free'});await p.evaluate(()=>__qa.start());await p.evaluate(s=>__qa.reseed(s),SEED);
 await p.evaluate(h=>__th.setHour(h),H);await p.evaluate(()=>__qa.step(60,1/60));await p.evaluate(t=>__th.task(t),TASK);
 let seen=false,wk=0,m=0;
 for(let i=0;i<3000&&m<2;i++){await p.evaluate(()=>__qa.step(3,1/60));
  const s=await p.evaluate(()=>({t:__dbg.hero.task,st:__dbg.hero.state}));if(s.t===TASK)seen=true;if((seen&&s.t!==TASK)||(!seen&&i>300))break;
  if(s.st==='work'){wk++;if(wk===120||wk===260){m++;
   for(const yaw of [0,1.57,3.14,-1.57]){await p.evaluate(([yaw])=>{const v=new __dbg.THREE.Vector3();__dbg.heroBones.Spine2.getWorldPosition(v);__th.rig.set({target:{x:v.x,y:v.y,z:v.z},yaw,pitch:.25,dist:2.6,snap:true,home:false});__noRender(false);},[yaw]);
    await p.evaluate(()=>__qa.step(1,1/60));await p.screenshot({path:`${OUT}/${TASK}_m${m}_y${yaw}.png`});await p.evaluate(()=>__noRender(true));}}}}
 console.log(TASK,'moments',m);await b.close();})();
