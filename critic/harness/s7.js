// Free-camera close-ups through the real camera rig (window.__th.rig.set), i.e. the same near-fade,
// collision and bounds the player gets. yaw is limited to home±0.75 for the player; views outside that are marked "ext".
// Usage: node s7.js <outdir> [hour]
const {open}=require('./lib');const O=process.argv[2];const HOUR=+(process.argv[3]||19.6);
const HY=1.0,KT=5.0+HY,BD=7.4+HY,WS=3.6+HY,DK=9.0+HY,LC=3.4+HY;
// [name, target [x,y,z], yaw, pitch, dist]
const S=[
 ['start',[0,7.4,2.4],.05,.13,30],
 ['yawL',[0,7.4,2.4],-.7,.15,26],['yawR',[0,7.4,2.4],.8,.15,26],['top',[0,7.4,2.4],.05,.6,26],['low',[0,4,2.4],.05,.02,22],
 ['bed_front',[-2.2,BD+.9,2],.05,.12,3.2],['bed_left',[-2.2,BD+.9,2],-.65,.15,3.2],['bed_right',[-2.2,BD+.9,2],.7,.15,3.2],
 ['kitchen_front',[-2.6,KT+.9,2],.05,.12,3.2],['kitchen_left',[-2.6,KT+.9,2],-.65,.2,3.0],['kitchen_right',[-2.6,KT+.9,2],.7,.15,3.0],
 ['work_front',[2.8,WS+1,2.2],.05,.12,3.2],['work_left',[2.8,WS+1,2.2],-.6,.15,3.0],['work_right',[2.8,WS+1,2.2],.75,.15,3.0],
 ['roof_bed',[-2,BD+3,1.5],.05,.55,4.5],['roof_work',[3,WS+2.6,1.8],.4,.5,4.5],
 ['deck',[2.6,DK+.7,1.5],.3,.25,3.5],['ladder_ground',[0,1.8,4],.3,.1,4.5],['ladder_top',[0,LC+.5,3.8],-.3,.2,3.5],['ladder_deck',[1.35,BD+.9,3.1],.5,.15,3.2],
 ['trunk_door',[.8,2.6,2.5],.1,.12,4],['roots',[-1,1,3],-.5,.12,6],['ground_low',[2,.6,5],.6,.04,5],
 ['leaves_close',[3,13,1],.4,.1,4],['crown_side',[-4,12,1],-.7,.15,7],
 ['pond',[-1.4,.3,7.6],.05,.25,6],['hatch_below',[-3.9,KT+1.6,2.4],.35,.05,2.2],['hatch_above',[-3.9,BD+.2,2.6],.3,.55,2.6],
 ['ext_back',[0,7.4,1],3.1,.15,22],['ext_side_left',[0,7.4,1],1.6,.15,22],
];
(async()=>{const {b,p,errs}=await open({});await p.evaluate(h=>{window.__H0=h;__th.setHour(h);__th.cam();},HOUR);await p.waitForTimeout(3000);
const ONLY=process.env.SHOTS?process.env.SHOTS.split(','):null;
for(const [n,t,y,pi,d] of S.filter(s=>!ONLY||ONLY.includes(s[0]))){await p.evaluate(([t,y,pi,d])=>{const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(...t),yaw:y,pitch:pi,dist:d,snap:true,home:false});__th.setHour(window.__H0);},[t,y,pi,d]);
 await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});const st=await p.evaluate(()=>__th.rig.state);console.log(n,JSON.stringify(st));}
console.log(errs.filter(e=>!/Sprite/.test(e)).join('\n'));await b.close();})();
