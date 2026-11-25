const {open}=require('/home/user/zombie/tests/anim/lib');const OUT=process.argv[2],Q=process.argv[3];
(async()=>{const {b,p}=await open({seed:13,vp:{width:390,height:844},query:Q});await p.evaluate(()=>__qa.start());await p.evaluate(()=>__qa.reseed(13));
 await p.evaluate(()=>__th.setHour(10));
 const want=['telescope','clear_roof','sweep','cook','eat','dishes','saw','fixlamp','firewood','fetchwater'];const got={};
 for(let i=0;i<600&&Object.keys(got).length<7;i++){await p.evaluate(()=>__qa.step(240,1/60));
  const h=await p.evaluate(()=>({t:__dbg.hero.task,st:__dbg.hero.state,r:__dbg.hero.root.position.toArray()}));
  const key=h.t+'_'+h.st;if(want.includes(h.t)&&!got[key]&&(h.st==='work'||h.st==='walk')){got[key]=1;
   await p.evaluate(r=>{__th.rig.set({target:{x:r[0],y:r[1]+.8,z:r[2]},yaw:.35,pitch:.12,dist:2.4,snap:true,home:false});__noRender(false);},h.r);
   await p.evaluate(()=>__qa.step(2,1/60));await p.screenshot({path:OUT+'/'+key+'.png'});await p.evaluate(()=>__noRender(true));console.log('shot',key,h.r.map(v=>v.toFixed(1)).join(','));}}
 await b.close();})();
