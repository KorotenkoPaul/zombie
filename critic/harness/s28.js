// World common-sense sweep: fixed close-up cameras at a given hour. node s28.js <outDir> <hour> [vp=390x844]
const {open,waitFrames}=require('/home/user/zombie/critic/harness/lib');const OUT=process.argv[2],H=+process.argv[3];const [W,Hh]=(process.argv[4]||'390x844').split('x').map(Number);
const CAMS=[['home',null],['kitchen_braces',{x:-2.4,y:5.4,z:2.6},0.35,0.05,3.2],['workshop_braces',{x:2.6,y:4.7,z:2.6},-0.35,0.05,3.2],['bedroom_roof',{x:-2.2,y:11.2,z:1.6},0.25,0.55,4.5],
 ['workshop_roof',{x:2.6,y:8.6,z:1.6},-0.25,0.55,4.5],['door_stairs',{x:1.0,y:1.2,z:3.6},0.35,0.12,4.5],['path_edge',{x:0,y:0.6,z:9},0.1,0.12,9],['upper_limbs',{x:0,y:14,z:1},0.6,0.08,9],['deck_telescope',{x:2.8,y:9.6,z:1.8},-0.5,0.2,4]];
(async()=>{const {b,p}=await open({q:'?cam=free',vp:{width:W,height:Hh}});await p.evaluate(h=>__th.setHour(h),H);await waitFrames(p,6);
 for(const [tag,t,yaw,pitch,dist] of CAMS){try{if(t)await p.evaluate(([t,yaw,pitch,dist])=>__th.rig.set({target:t,yaw,pitch,dist,snap:true,home:false}),[t,yaw,pitch,dist]);
  await waitFrames(p,3);await p.screenshot({path:`${OUT}/${String(H).replace('.','_')}_${tag}.png`});console.log('shot',tag);}catch(e){console.log('fail',tag,e.message.slice(0,80));}}
 await b.close();})();
