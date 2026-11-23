// orbit-rig close-ups (no near-fade dither) of floors/walls/landings. usage: node shots2.js outdir [hour] [dpr]
const {open}=require('../../critic/harness/lib');const O=process.argv[2];const H=+(process.argv[3]||21.5);const DPR=+(process.argv[4]||1);
const KT=6,BD=8.4,WS=4.6,DK=10,LG=2.3,LC=4.4;
const shots=[['k_floor',[-2.4,KT,3.0],0.15,.62,2.6],['k_wall',[-2.6,KT+1.0,1.3],0.0,.12,2.8],['bed_wall',[-2.0,BD+1.0,1.2],-.2,.1,2.6],['w_floor',[2.6,WS,3.4],-.25,.45,3.4],['landing',[-.5,LC,2.6],0.1,.6,3.2],['deck',[2.6,DK,1.8],-.2,.55,3.2],['overview',[0,7.4,2.4],0,.15,14],['roof_b',[-1.9,11.2,2.3],.35,.55,4.2],['roof_w',[2.75,7.4,2.6],-.35,.6,4.0],['roof_day',[-1.9,11.2,2.3],-.5,.4,5.5],['ext_left',[-4.4,7.2,2.6],-1.35,.12,4.2],['ext_right',[4.6,5.6,2.8],1.3,.12,4.2]];
(async()=>{const {b,p,errs}=await open({dpr:DPR});await p.evaluate(h=>{__th.setHour(h);if(window.__lights)for(const s of __lights.list())__lights.set(s.name,true);if(window.__camera&&__camera.dof)__camera.dof(false);},H);
for(const [n,t,yaw,pitch,dist] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;
 await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},[t,yaw,pitch,dist]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
