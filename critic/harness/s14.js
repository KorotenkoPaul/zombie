// House wear and weather marks you can see: damage N parts through window.__wear.hit(), fray the gate rope,
// mark a few boards worn/water-stained (__planks.setFresh(id,-1)), shoot each damaged part up close (Q='?cam=free'),
// then the home view dry and in rain. Usage: Q='?cam=free' node s14.js <outdir> [hour=12] [n=8]
const {open,waitFrames}=require('./lib');const fs=require('fs');const O=process.argv[2];const H=+(process.argv[3]||12),N=+(process.argv[4]||8);
(async()=>{const {b,p}=await open({});
 const st=await p.evaluate(([h,n])=>{__th.setHour(h);window.__TS=0.0001;const W=window.__wear;if(!W)return {err:'no __wear'};const ids=[];
  for(const k of ['floor','wall','beam','shingle']){for(let i=0;i<Math.ceil(n/4);i++){const id=W.hit(k);if(id!=null)ids.push(id);}}
  for(const id of ids)W.set(id,1);W.rope(1);W.snap();
  const stain=__planks.list('wall').filter(x=>x.pos[2]>3).slice(0,12).map(x=>x.id);stain.forEach(id=>__planks.setFresh(id,-1));
  return {ids,state:W.state(),stain};},[H,N]);
 console.log(JSON.stringify(st).slice(0,1500));
 const parts=(st.state&&st.state.damaged)||[];let k=0;
 for(const d of parts.slice(0,8)){await p.evaluate(([c])=>{const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(...c),yaw:.35,pitch:.25,dist:1.6,snap:true,home:false});},[d.pos]);
  await waitFrames(p,3);await p.screenshot({path:`${O}/part_${k++}_${d.kind}.png`});}
 await p.evaluate(()=>{const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(0,1.9,4.3),yaw:.2,pitch:.15,dist:1.8,snap:true,home:false});});await waitFrames(p,3);await p.screenshot({path:`${O}/rope.png`});
 await p.evaluate(()=>{__th.cam();});await waitFrames(p,3);await p.screenshot({path:`${O}/home_dry.png`});
 await p.evaluate(()=>{window.__TS=1;__weather.setRain(true,'storm');});await p.waitForTimeout(20000);await p.evaluate(()=>{window.__TS=0.0001;});await waitFrames(p,3);await p.screenshot({path:`${O}/home_rain.png`});
 await p.evaluate(()=>{const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(-2,9.6,3.2),yaw:.3,pitch:.15,dist:3.5,snap:true,home:false});});await waitFrames(p,3);await p.screenshot({path:`${O}/rain_bedroom.png`});
 await b.close();})();
