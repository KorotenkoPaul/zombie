// trunk door close-ups. usage: node door.js outdir [hour]
const {open}=require('../../critic/harness/lib');const O=process.argv[2];const H=+(process.argv[3]||21.5);
const shots=[['door',[1.0,2.95,1.5],.42,.12,3.2],['door_side',[1.0,2.8,1.5],1.1,.2,3.0],['door_far',[1.0,3.0,1.5],.3,.2,6.5]];
(async()=>{const {b,p,errs}=await open({dpr:2});await p.evaluate(h=>{__th.setHour(h);if(window.__camera&&__camera.dof)__camera.dof(false);},H);
for(const [n,t,yaw,pitch,dist] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},[t,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
