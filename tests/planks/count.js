// board instance counts and triangles for the plank meshes + renderer stats. usage: node count.js
const {open}=require('../../critic/harness/lib');
(async()=>{const {b,p,errs}=await open({});await p.waitForTimeout(3000);
const r=await p.evaluate(()=>{const sc=__dbg.scene||(()=>{let s=__dbg.hero.root;while(s.parent)s=s.parent;return s;})();const out=[];sc.traverse(o=>{if(o.isInstancedMesh&&o.geometry.attributes.aRow){const g=o.geometry;const t=(g.index?g.index.count:g.attributes.position.count)/3;out.push({n:o.count,triPer:t,tris:o.count*t});}});
 const i=window.__renderer.info;return {out,calls:i.render.calls,tris:i.render.triangles,perf:window.__perf&&__perf.stats&&__perf.stats()};});
console.log(JSON.stringify(r));console.log(errs.join('\n'));await b.close();})();
