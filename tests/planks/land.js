// landings and struts close-ups. usage: node land.js outdir [hour]
const {open}=require('../../critic/harness/lib');const O=process.argv[2];const H=+(process.argv[3]||19.6);
const shots=[['lc',[-.5,4.4,2.6],.15,.35,3.6],['lg',[1.5,2.3,1.6],-.25,.3,3.4],['ll',[-2.0,2.45,1.4],.3,.3,3.2],['under',[-1.0,3.0,2.0],.2,-.25,4.5]];
(async()=>{const {b,p,errs}=await open({dpr:2});await p.evaluate(h=>{__th.setHour(h);if(window.__camera&&__camera.dof)__camera.dof(false);},H);
for(const [n,t,yaw,pitch,dist] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},[t,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
