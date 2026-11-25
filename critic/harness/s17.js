const {open}=require('/home/user/zombie/tests/anim/lib');const OUT=process.argv[2];
(async()=>{const {b,p}=await open({seed:13,vp:{width:390,height:844}});await p.evaluate(()=>__qa.start());await p.evaluate(()=>__qa.reseed(13));
 await p.evaluate(()=>__th.setHour(6.3));await p.evaluate(()=>__qa.step(60,1/60));
 await p.evaluate(()=>{__props.door.setOpen(0);__props.door.setBolt(1);});await p.evaluate(()=>__th.task('telescope'));
 for(let i=0;i<80;i++){await p.evaluate(()=>__qa.step(10,1/60));
  const s=await p.evaluate(()=>{const h=__dbg.hero,r=h.root.position;return [h.task,h.state,h.cur,r.x.toFixed(2),r.z.toFixed(2),__props.door.open.toFixed(2),__props.door.bolt.toFixed(2)].join(' ')});
  if(i>=25&&i<=75&&i%2==0)console.log(i,s);
  if(i==36||i==44){await p.evaluate(()=>__noRender(false));await p.evaluate(()=>__qa.step(2,1/60));await p.screenshot({path:OUT+'/w6_'+i+'.png'});await p.evaluate(()=>__noRender(true));}}
 await b.close();})();
