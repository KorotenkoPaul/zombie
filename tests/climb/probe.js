const {open}=require('../anim/lib.js');
(async()=>{const {b,p,errs}=await open({seed:3});await p.evaluate(()=>__qa.start());
 const r=await p.evaluate(()=>{const HH=__dbg.HH;const B=HH.bones;const V=(o)=>o.getWorldPosition(new __dbg.THREE.Vector3()).toArray().map(v=>+v.toFixed(3));
  const names=Object.keys(B);HH.root.updateMatrixWorld(true);
  return {names,ladders:window.__ladders.map(l=>({x:l.x,z:l.z,y0:l.y0,y1:l.y1,rope:l.rope,n:l.rungs.length,r0:l.rungs[0]})),root:HH.root.position.toArray(),N:Object.fromEntries(['kh_b','kh_t','kl_b','bl_t','ll_b','ll_t','g_foot','gate','land'].map(k=>[k,HH.N[k]&&HH.N[k].p.toArray()]))};});
 console.log(JSON.stringify(r,null,0));console.log(errs.slice(0,5));await b.close();})();
