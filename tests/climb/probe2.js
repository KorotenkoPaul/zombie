const {open}=require('../anim/lib.js');
(async()=>{const {b,p}=await open({seed:3});await p.evaluate(()=>__qa.start());
 const r=await p.evaluate(()=>{const HH=__dbg.HH;HH.setBrain({tick(){}});HH.spawn('nothing');__qa.step(60,1/60);const B=HH.bones,T=__dbg.THREE;const w=o=>o.getWorldPosition(new T.Vector3());const R=HH.root.position;
  const f=w(B.LeftFoot),t=w(B.LeftToeBase),h=w(B.Hips),hd=w(B.Head);return {root:R.toArray(),foot:f.y-R.y,toe:t.y-R.y,fwd:Math.hypot(t.x-f.x,t.z-f.z),hips:h.y-R.y,head:hd.y-R.y,clip:HH.H.cur&&HH.H.cur.getClip().name};});
 console.log(JSON.stringify(r));await b.close();})();
