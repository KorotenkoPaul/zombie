#!/usr/bin/env node
// Replays the same seeded day as run.js and renders the flagged moments:
//  * a storyboard strip per issue (6 frames around it, close-up, two angles) -> DIR/sheets/NN_type.jpg
//  * a close-up clip (every 2nd frame, ±0.7 s) for the worst issues -> DIR/clips/NN_type.mp4 / .gif
//  * a top-down map of every walk -> DIR/walks.png
// Usage: node tests/anim/shots.js --in DIR [--top 14] [--clips 4] [--seed N]
const fs=require('fs'),path=require('path'),zlib=require('zlib'),{execSync}=require('child_process');
const {open}=require('./lib');const {simulate}=require('./simulate');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const DIR=path.resolve(arg('in','/tmp/anim-qa'));const TOP=+arg('top',14),CLIPS=+arg('clips',4);
const R=JSON.parse(fs.readFileSync(DIR+'/issues.json'));const D=JSON.parse(zlib.gunzipSync(fs.readFileSync(DIR+'/frames.json.gz')));
const byF=new Map(D.frames.map(f=>[f.f,f]));
// pick distinct issues: worst first, at most 3 of the same type, skip ones within 1 s of an already chosen one
// worst first, at most 3 per type and 1 per type+body part+object, nothing within 1 s of an already chosen one
const pick=[];const kk=q=>q.type+'|'+q.bone+'|'+(q.into||'').replace(/#\d+.*/,'');for(const q of R.issues){if(pick.length>=TOP)break;if(q.type==='slow'&&!/m\/s|to sit/.test(q.unit))continue;if(pick.filter(x=>x.type===q.type).length>=3)continue;if(pick.some(x=>kk(x)===kk(q)))continue;if(pick.some(x=>Math.abs(x.f-q.f)<60))continue;pick.push(q);}
const OFF=[-30,-12,-4,0,4,12];
const BI={Hips:0,Head:3,HeadTop_End:4,LeftFoot:7,RightFoot:12,LeftHand:17,RightHand:20,LeftLeg:6,RightLeg:11};
function focus(q,f){if(q.at&&Math.abs(q.f-f.f)<3)return q.at;const k={head:'Head',handL:'LeftHand',handR:'RightHand',feet:'LeftFoot',shins:'LeftLeg',hips:'Hips',arms:'Hips',torso:'Hips'}[q.bone]||q.bone;const i=(BI[k]??BI[k.replace(/ .*/,'')]??0)*3;const h=[f.b[0],f.b[1],f.b[2]];
 const p=[f.b[i],f.b[i+1],f.b[i+2]];return [(p[0]+h[0])/2,(p[1]+h[1])/2,(p[2]+h[2])/2];}
(async()=>{fs.mkdirSync(DIR+'/raw',{recursive:true});fs.mkdirSync(DIR+'/sheets',{recursive:true});fs.mkdirSync(DIR+'/clips',{recursive:true});
 const want=new Map();// frame -> list of jobs
 const job=(f,j)=>{if(!want.has(f))want.set(f,[]);want.get(f).push(j);};
 pick.forEach((q,n)=>{const ff=q.type==='detour'||q.type==='crab-walk'||q.type==='sharp-turn'||q.type==='foot-slide'?OFF.map(o=>o*2):OFF;
  ff.forEach((o,k)=>job(q.f+o,{n,k,kind:'sheet'}));});
 pick.filter(q=>q.P===1).slice(0,CLIPS).forEach(q=>{const n=pick.indexOf(q);for(let o=-42;o<=42;o+=2)job(q.f+o,{n,k:o,kind:'clip'});});
 const {b,p,errs}=await open({seed:D.meta.seed,vp:{width:360,height:360}});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 let drift=0;const t0=Date.now();
 await simulate(p,{hours:D.meta.hours,tour:true,log:()=>{},capture:{frames:new Set(want.keys()),fn:async fr=>{
  const rec=byF.get(fr);const now=await p.evaluate(()=>__dbg.hero.root.position.toArray());if(rec)drift=Math.max(drift,Math.hypot(now[0]-rec.root[0],now[1]-rec.root[1],now[2]-rec.root[2]));
  for(const j of want.get(fr)){const q=pick[j.n];const f=rec||byF.get(q.f);const c=focus(q,f);
   const views=j.kind==='sheet'?[[-.55,.22,1.7],[.6,.3,1.9]]:[[-.45,.22,1.8]];let vi=0;
   for(const [yaw,pitch,dist] of views){const file=`${DIR}/raw/${j.kind}_${String(j.n).padStart(2,'0')}_${j.kind==='sheet'?j.k+'_'+vi:String(j.k+100).padStart(3,'0')}.png`;
    await p.evaluate(([c,yaw,pitch,dist])=>{const cam=__qaCamera;cam.position.set(c[0]+Math.sin(yaw)*Math.cos(pitch)*dist,c[1]+Math.sin(pitch)*dist,c[2]+Math.cos(yaw)*Math.cos(pitch)*dist);cam.lookAt(c[0],c[1],c[2]);cam.updateMatrixWorld();
     __noRender(false);__qaComposer.render();__noRender(true);},[c,yaw,pitch,dist]);
    await p.locator('canvas').first().screenshot({path:file});vi++;}}}}});
 await b.close();console.log('rendered',[...want.values()].flat().length,'jobs in',((Date.now()-t0)/1000).toFixed(0),'s; replay drift',(drift*100).toFixed(2),'cm');
 fs.writeFileSync(DIR+'/picked.json',JSON.stringify({pick,drift}));
 execSync(`python3 ${__dirname}/sheets.py ${DIR}`,{stdio:'inherit'});
 for(const q of pick.filter(q=>q.P===1).slice(0,CLIPS)){const n=String(pick.indexOf(q)).padStart(2,'0');const name=`${DIR}/clips/${n}_${q.type}`;
  try{execSync(`ffmpeg -y -loglevel error -framerate 15 -pattern_type glob -i '${DIR}/raw/clip_${n}_*.png' -vf "scale=360:360" -pix_fmt yuv420p ${name}.mp4`);
   execSync(`ffmpeg -y -loglevel error -framerate 15 -pattern_type glob -i '${DIR}/raw/clip_${n}_*.png' -vf "fps=15,scale=300:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" ${name}.gif`);}catch(e){console.log('ffmpeg',String(e).slice(0,200));}}
 if(errs.length)console.log(errs.slice(0,5).join('\n'));})();
