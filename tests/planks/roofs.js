// roof slates up close, camera placed along the slate's normal. usage: node roofs.js outdir
const {open}=require('../../critic/harness/lib');const O=process.argv[2];
(async()=>{const {b,p,errs}=await open({dpr:1});await p.evaluate(()=>{__th.setHour(21.5);if(window.__lights)for(const s of __lights.list())__lights.set(s.name,true);if(window.__camera&&__camera.dof)__camera.dof(false);});
const L=await p.evaluate(()=>{const T=__dbg.THREE;const M=__planks.meshes.shingles;const m=new T.Matrix4(),pp=new T.Vector3(),q=new T.Quaternion(),sc=new T.Vector3();
 return [.2,.55,.85].map(f=>{M.getMatrixAt(Math.floor(M.count*f),m);m.decompose(pp,q,sc);const n=new T.Vector3(0,1,0).applyQuaternion(q);return {c:pp.toArray(),n:n.toArray()};});});
let k=0;for(const {c,n} of L){for(const [tag,dist,dp] of [['a',1.6,0],['b',1.3,-.35]]){const yaw=Math.atan2(n[0],n[2]);const pitch=Math.max(.1,Math.asin(n[1])+dp);
 await p.evaluate(([c,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...c),yaw,pitch,dist,snap:true});},[c,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/roof'+k+tag+'.png'});console.log('shot',k,tag,JSON.stringify(c));}k++;}
console.log(errs.join('\n').slice(0,300));await b.close();})();
