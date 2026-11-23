// ladder rungs and roof slates up close. usage: node ladders.js outdir [hour]
const {open}=require('../../critic/harness/lib');const O=process.argv[2];const H=+(process.argv[3]||21.5);
const KT=6,BD=8.4,DK=10,LC=4.4;
const shots=[['rope1',[0,2.6,4.0],.35,.15,1.3],['rope2',[1.35,BD+.9,3.2],.3,.15,1.3],['wood_l',[-3.98,KT+1.2,2.3],.35,.2,1.3],['wood_l2',[-1.22,LC+.9,3.45],.3,.2,1.3],['roof_c',[-1.9,11.2,2.3],.35,.55,2.6],['roof_e',[-4.4,10.4,2.6],-1.35,.25,2.6]];
(async()=>{const {b,p,errs}=await open({dpr:1});await p.evaluate(h=>{__th.setHour(h);if(window.__lights)for(const s of __lights.list())__lights.set(s.name,true);if(window.__camera&&__camera.dof)__camera.dof(false);},H);
for(const [n,t,yaw,pitch,dist] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;
 await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},[t,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
