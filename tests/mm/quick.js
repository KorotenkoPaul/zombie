// quick check of motion matching in the real game: node tests/mm/quick.js [task] [seconds]
const {open}=require('../anim/lib.js');
(async()=>{const task=process.argv[2]||'cook',secs=+process.argv[3]||20;const {b,p,errs}=await open({seed:1});
 await p.evaluate(()=>__qa.start());await p.evaluate(()=>{__qa.reseed(7);__th.setHour(11);});
 const has=await p.evaluate(()=>!!window.__motion&&{frames:__motion.frames});console.log('motion',has);
 await p.evaluate(t=>__th.task(t),task);
 for(let s=0;s<secs*4;s++){const r=await p.evaluate(()=>{__qa.step(15,1/60);const h=__dbg.hero,m=window.__motion;const i=m?m.info():{};const st=m?m.stats:{};
   return {path:h.path.length,v:+(h.v||0).toFixed(2),task:h.task,cur:h.cur&&h.cur.getClip().name,on:i.on,clip:i.clip,t:i.t&&+i.t.toFixed(1),cost:i.cost&&+i.cost.toFixed(2),layer:i.layer,jumps:i.jumps,pr:i.pruned&&+i.pruned.toFixed(2),ms:st.searches?+(st.ms/st.searches).toFixed(3):0,max:st.maxMs&&+st.maxMs.toFixed(2)};});
  if(s%2===0)console.log((s/4).toFixed(1),JSON.stringify(r));}
 console.log('errors',errs.slice(0,5));await b.close();})();
