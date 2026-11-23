// work-top close-ups (counter, workbench, side bench). usage: node tops.js outdir [hour]
const {open}=require('../../critic/harness/lib');const O=process.argv[2];const H=+(process.argv[3]||21.5);
(async()=>{const {b,p,errs}=await open({dpr:2});await p.evaluate(h=>{__th.setHour(h);if(window.__camera&&__camera.dof)__camera.dof(false);},H);
const pos=await p.evaluate(()=>{const o=__props.objects;const f=g=>[g.position.x,g.userData.floorY+.9,g.position.z];return {counter:f(o.counter),workbench:f(o.workbench)};});console.log(JSON.stringify(pos));
const shots=[['counter',pos.counter,[-.2,0,0],.1,.75,1.3],['counter_far',pos.counter,[0,0,0],.25,.4,2.4],['bench',pos.workbench,[0,0,0],-.1,.8,1.6],['bench_close',pos.workbench,[.4,0,.1],.1,.9,.8]];
for(const [n,c,o,yaw,pitch,dist] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;const t=[c[0]+o[0],c[1],c[2]+o[2]];
 await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},[t,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
