// list non-instanced meshes inside the house volume with material/geometry hints
const {open}=require('../../critic/harness/lib');
(async()=>{const {b,p,errs}=await open({});await p.waitForTimeout(2000);
const r=await p.evaluate(()=>{const sc=(()=>{let s=__dbg.hero.root;while(s.parent)s=s.parent;return s;})();const out={};const v=new __dbg.THREE.Vector3();
 sc.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||!o.visible)return;o.getWorldPosition(v);if(v.x<-5.5||v.x>5.5||v.y<2||v.y>13||v.z<0||v.z>6)return;let h=o;let path=[];while(h&&h!==sc){path.push(h.name||h.type);h=h.parent;}
  const m=Array.isArray(o.material)?o.material[0]:o.material;const k=(m.name||m.type)+'|'+(m.map?'map':'nomap')+'|#'+(m.color?m.color.getHexString():'')+'|'+o.geometry.type;out[k]=out[k]||{n:0,tris:0,eg:[]};out[k].n++;out[k].tris+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;if(out[k].eg.length<2)out[k].eg.push(path.slice(0,4).join('<')+' @'+v.toArray().map(x=>x.toFixed(1)).join(','));});
 return Object.entries(out).sort((a,b)=>b[1].n-a[1].n);});
for(const [k,v] of r)console.log(v.n,k,Math.round(v.tris),JSON.stringify(v.eg));await b.close();})();
