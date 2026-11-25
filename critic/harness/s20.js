const {open}=require('/home/user/zombie/critic/harness/lib');
(async()=>{const {b,p}=await open({});await p.waitForTimeout(3000);
const r=await p.evaluate(()=>{const T=__dbg.THREE,sc=(()=>{let o=__dbg.hero.root;while(o.parent)o=o.parent;return o})();const rc=new T.Raycaster();const objs=[];sc.traverse(o=>{if(o.isMesh&&o.visible&&!(o.isInstancedMesh&&o.count>1500))objs.push(o)});
 const out={};let n=0,low=0;for(let x=-1.2;x<=0.6;x+=0.02)for(let z=1.2;z<=2.6;z+=0.05){rc.set(new T.Vector3(x,9.2,z),new T.Vector3(0,-1,0));rc.far=2;const h=rc.intersectObjects(objs,false).filter(h=>h.point.y<9.0);n++;
  const y=h.length?h[0].point.y:null;const k=y==null?'none':y>=8.42?'board':y>=8.30?'sub'+y.toFixed(2):'below'+y.toFixed(1);out[k]=(out[k]||0)+1;if(k==='none'){const kx=x.toFixed(2);out['x'+kx]=(out['x'+kx]||0)+1;}if(y==null||y<8.42)low++;}
 return {n,low,out,hasScene:!!sc};});
console.log(JSON.stringify(r));await b.close();})();
