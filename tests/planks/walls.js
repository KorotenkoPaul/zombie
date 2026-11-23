// room walls and floors from ~3 m. usage: node walls.js outdir [hour]
const {open}=require('../../critic/harness/lib');const O=process.argv[2];const H=+(process.argv[3]||21.5);
(async()=>{const {b,p,errs}=await open({dpr:1});await p.evaluate(h=>{__th.setHour(h);if(window.__camera&&__camera.dof)__camera.dof(false);},H);
const f=await p.evaluate(()=>{const o=__props.objects;return {KT:o.counter.userData.floorY,BD:o.bunkbed.userData.floorY,WS:o.workbench.userData.floorY};});console.log(JSON.stringify(f));
const shots=[['k_back',[-2.6,f.KT+1.1,1.0],.15,.12,3.0],['k_side',[-4.3,f.KT+1.1,2.3],-1.2,.12,3.0],['b_floor',[-2.0,f.BD,2.6],.2,.75,2.6],['w_back',[2.7,f.WS+1.1,1.2],-.1,.12,3.0],['ext',[-2.6,f.KT+1.2,2.3],-1.9,.1,4.5]];
for(const [n,t,yaw,pitch,dist] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;
 await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},[t,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
