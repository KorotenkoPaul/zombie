// find diagonal beams (braces) that pass through walkable boards. usage: node braces.js
const {open}=require('../../critic/harness/lib');
(async()=>{const {b,p,errs}=await open({});await p.waitForTimeout(1500);
const r=await p.evaluate(()=>{const T=__dbg.THREE;const {boards,beams}=__planks.meshes;const M=new T.Matrix4(),P=new T.Vector3(),Q=new T.Quaternion(),S=new T.Vector3();const rc=new T.Raycaster();const out=[];
 for(let i=0;i<beams.count;i++){beams.getMatrixAt(i,M);M.decompose(P,Q,S);const ax=new T.Vector3(1,0,0).applyQuaternion(Q);if(P.y>6.4&&S.y<.15||Math.abs(ax.y)<.2||Math.abs(ax.y)>.97||S.x<.8)continue;
  let hits=0;for(let k=2;k<=18;k++){const t=k/20-.5;const q=P.clone().addScaledVector(ax,t*S.x);rc.set(q.clone().add(new T.Vector3(0,.12,0)),new T.Vector3(0,-1,0));rc.far=.24;if(rc.intersectObject(boards,false).length)hits++;}
  if(hits)out.push({i,c:P.toArray().map(v=>+v.toFixed(2)),len:+S.x.toFixed(2),hits});}
 return out;});
console.log(JSON.stringify(r));console.log(errs.join('|')||'no errs');await b.close();})();
