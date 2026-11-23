// interior walk on the iPhone viewport: ceilings, posts, door. usage: node walk.js outdir
const {open}=require('../../critic/harness/lib');const O=process.argv[2];
const KT=6,BD=8.4,WS=4.6;
const shots=[['k_ceiling',[-2.6,KT+1.9,2.6],0,-.5,2.6],['k_corner',[-4.2,KT+1.2,1.3],.7,.05,2.6],['b_door',[.2,BD+1.0,2.8],-1.1,.05,2.6],['w_ceiling',[2.7,WS+1.9,2.8],0,-.45,2.6],['b_room',[-1.9,BD+1.2,2.4],0,.05,3.4]];
(async()=>{const {b,p,errs}=await open({dpr:2});await p.evaluate(()=>{__th.setHour(21.5);for(const s of __lights.list())__lights.set(s.name,true);if(window.__camera&&__camera.dof)__camera.dof(false);});
for(const [n,t,yaw,pitch,dist] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},[t,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
