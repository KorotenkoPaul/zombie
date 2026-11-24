// K4 probe: fast-forward like s8 to an hour, aim the rig at the hero like s8 (yaw .6, dist 2.6), then for several real frames
// read back the canvas right after each render (in-page brightness) and take page screenshots, to tell a really black game
// frame from a screenshot artefact.  Usage: node s9.js <outdir> [hour=23] [yaw=.6]
const {open,waitFrames}=require('./lib');const O=process.argv[2];const H=+(process.argv[3]||23),YAW=+(process.argv[4]||.6);
(async()=>{const {b,p}=await open({});await p.evaluate(([t,v])=>{window.__TASK=t;window.__TSV=v;},[process.env.TASK||'',process.env.TSV||'']);
 await p.evaluate(h=>{const R=window.__renderer;const real=R.render;const cv=R.domElement,t=document.createElement('canvas');t.width=40;t.height=80;const g=t.getContext('2d');window.__br=[];
  R.render=function(s,c){real.call(this,s,c);if(window.__probe&&R.getRenderTarget()===null){g.drawImage(cv,0,0,40,80);const d=g.getImageData(0,0,40,80).data;let m=0;for(let k=0;k<d.length;k+=4)m+=d[k]+d[k+1]+d[k+2];window.__br.push(+(m/(d.length/4)/3).toFixed(1));}};
  window.__noRender=on=>{window.__off=on;};const r2=R.render;R.render=function(s,c){if(window.__off){s&&s.updateMatrixWorld&&s.updateMatrixWorld();return;}r2.call(this,s,c);};
  __th.setHour(h-1);__th.cam();if(window.__TASK)__th.task(window.__TASK);},H);
 await p.evaluate(()=>{__noRender(true);window.__TS=20;});
 for(let i=0;i<400;i++){const hr=await p.evaluate(()=>__th.state().hour);const d=((H-hr)%24+24)%24;if(d<.05||d>23.9)break;await p.waitForTimeout(250);}
 await p.evaluate(()=>{window.__TS=1;});await p.waitForTimeout(600);
 const r=await p.evaluate(()=>__dbg.hero.root.position.toArray());
 await p.evaluate(([r,yaw])=>{__noRender(false);const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(r[0],r[1]+.9,r[2]),yaw,pitch:.12,dist:2.6,snap:true});window.__TS=+(window.__TSV||0.0001);window.__probe=1;},[r,YAW]);
 for(let k=0;k<8;k++){await waitFrames(p,3);await p.screenshot({path:`${O}/k4_${H}_${k}.png`});console.log('shot',k,JSON.stringify(await p.evaluate(()=>({br:__br.splice(0),rig:__th.rig.state,lost:__renderer.getContext().isContextLost()}))));}
 await b.close();})();
