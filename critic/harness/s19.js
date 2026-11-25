const {open}=require('/home/user/zombie/tests/anim/lib');const OUT=process.argv[2];
(async()=>{const {b,p}=await open({seed:13,vp:{width:390,height:844},query:'?embers=1&cam=free'});await p.evaluate(()=>__qa.start());await p.evaluate(()=>__qa.reseed(13));
 await p.evaluate(()=>__th.setHour(20.5));let slept=-1;
 for(let i=0;i<400;i++){await p.evaluate(()=>__qa.step(300,1/60));const s=await p.evaluate(()=>({t:__dbg.hero.task,h:__th.state().hour}));
  if(s.t==='sleep'&&slept<0){slept=s.h;console.log('sleep at',s.h.toFixed(2));}
  if(slept>=0){const d=((s.h-slept)%24+24)%24;for(const [m,tag] of [[0.5,'a'],[3,'b'],[7.2,'c']]){if(d>=m&&!this['done'+tag]){this['done'+tag]=1;
   await p.evaluate(()=>{__th.rig.set({target:{x:-3.0,y:6.5,z:1.8},yaw:0.15,pitch:.1,dist:3.2,snap:true,home:false});__noRender(false);});await p.evaluate(()=>__qa.step(2,1/60));
   await p.screenshot({path:OUT+'/emb_'+tag+'.png'});await p.evaluate(()=>__noRender(true));console.log('shot',tag,s.h.toFixed(2),s.t);}}
   if(d>7.3)break;}}
 await b.close();})();
