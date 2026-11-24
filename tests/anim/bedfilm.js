#!/usr/bin/env node
// Bed film (owner: the bed thread): the whole bed sequence from 4 sides, for both heroes.
//   node tests/anim/bedfilm.js --out DIR [--query '?hero=detail'] [--every 0.5] [--poses sideL,bellyR,back] [--size 320]
// Walks to bed at 21:40, sits on the edge, undresses, lies down, sleeps, is forced through the given sleep poses
// (window.__sleepPose), then wakes at 06:30 and gets up. A row of 4 views (front, head end, foot end, above) every
// --every seconds goes to DIR/sheet_NN.jpg (8 rows per sheet) plus a numbers log DIR/log.txt (mattress gap per bone).
const fs=require('fs'),path=require('path');const {execSync}=require('child_process');
const {open}=require('./lib');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const OUT=path.resolve(arg('out','/tmp/bedfilm'));const Q=arg('query','');const EVERY=+arg('every',.5);const SZ=+arg('size',320);
const POSES=arg('poses','sideL,bellyR,back').split(',').filter(Boolean);const ONLY=arg('only','');// 'in' | 'out' | ''
const SPAWN=process.argv.includes('--spawn');// start already in bed (skips the walk and the lie-down)
fs.mkdirSync(OUT+'/raw',{recursive:true});
(async()=>{const t0=Date.now();const {b,p,errs}=await open({seed:3,query:Q,vp:{width:SZ,height:SZ}});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(()=>__qa.start());
 if(SPAWN)await p.evaluate(()=>{__qa.reseed(777);__th.setHour(23);__dbg.HH.spawn('sleep');});else await p.evaluate(()=>{__qa.reseed(777);__th.setHour(21.6);if(window.__brain&&__brain.setNeeds)try{__brain.setNeeds({energy:.1});}catch(e){} __th.task('sleep');});
 const log=[];let shotN=0;let frame=0;
 const st=()=>p.evaluate(()=>{const H=__dbg.hero,B=__dbg.HH.FIT&&__dbg.HH.FIT.bed,bo=__dbg.heroBones;const g=n=>bo[n]?bo[n].getWorldPosition(new __dbg.THREE.Vector3()):null;
  const gap={};if(B)for(const n of ['Hips','Spine2','Head','LeftFoot','RightFoot','LeftLeg','RightLeg','LeftHand','RightHand']){const v=g(n);if(v)gap[n]=+((v.y-B.mat)*100).toFixed(1);}
  return {task:H.task,state:H.state,inBed:!!H.inBed,trans:!!H.trans,bedB:!!H.bedB,step:H.act&&H.act.step,hour:__th.state().hour,path:H.path.length,
   root:H.root.position.toArray().map(v=>+v.toFixed(2)),gap,bed:B?{x0:B.x0,x1:B.x1,z1:B.z1,bz:B.bz,mat:B.mat,hd:B.headDir}:null,pose:window.__sleepPoseName||null};});
 const shot=async(tag)=>{const s=await st();const B=s.bed;if(!B)return;const cx=(B.x0+B.x1)/2,cz=B.bz+.1,cy=B.mat+.2;
  const views=[[0,.15,2.1],[B.hd*.8,.22,1.8],[-B.hd*.8,.22,1.8],[0,.85,1.6]];const files=[];
  for(let v=0;v<views.length;v++){const [yaw,pitch,dist]=views[v];const file=`${OUT}/raw/s${String(shotN).padStart(4,'0')}_${v}.png`;
   // camera placed by hand inside the bedroom (the game rig keeps >= 10 m and would film the outside walls)
   await p.evaluate(([c,yaw,pitch,dist])=>{const cam=__qaCamera;cam.position.set(c[0]+Math.sin(yaw)*Math.cos(pitch)*dist,c[1]+Math.sin(pitch)*dist,c[2]+Math.cos(yaw)*Math.cos(pitch)*dist);cam.lookAt(c[0],c[1],c[2]);
    const f0=cam.fov,n0=cam.near;cam.fov=62;cam.near=.05;cam.updateProjectionMatrix();cam.updateMatrixWorld();if(window.__camera&&window.__camera.dof)window.__camera.dof(false);
    __noRender(false);__qaComposer.render();__noRender(true);cam.fov=f0;cam.near=n0;cam.updateProjectionMatrix();},[[cx,cy,cz],yaw,pitch,dist]);
   for(let tr=0;tr<3;tr++){await p.locator('canvas').first().screenshot({path:file});if(fs.statSync(file).size>12000)break;await p.evaluate(()=>{__noRender(false);__qaComposer.render();__noRender(true);});}
   files.push(file);}
  log.push({n:shotN,f:frame,tag,...s});fs.appendFileSync(OUT+'/log.txt',JSON.stringify({n:shotN,f:frame,tag,...s})+'\n');shotN++;};
 const step=async n=>{await p.evaluate(n=>__qa.step(n,1/60),n);frame+=n;};
 fs.writeFileSync(OUT+'/log.txt','');
 // 1) walk to the bed; film from 3 m away
 let n=0;for(;n<60*90;n+=15){await step(15);const s=await st();const B=s.bed;const d=B?Math.hypot(s.root[0]-(B.x0+B.x1)/2,s.root[2]-B.z1):9;
  if(ONLY!=='out'&&d<1.0&&s.task==='sleep'&&(n%Math.round(60*EVERY)<15))await shot('in');if(s.inBed&&!s.trans&&!s.bedB)break;}
 console.log('in bed after',(n/60).toFixed(1),'s');
 for(let k=0;k<4;k++){await step(120);if(ONLY!=='out')await shot('asleep');}
 // 2) turn over through the poses
 for(const ps of POSES){await p.evaluate(ps=>{window.__sleepPose=ps;window.__sleepPoseName=ps;},ps);
  for(let k=0;k<8;k++){await step(30);if(ONLY!=='out'||k==7)await shot('turn:'+ps);}await step(240);await shot('held:'+ps);}
 await p.evaluate(()=>{window.__sleepPose=null;});
 // 3) morning: get up
 await p.evaluate(()=>{__th.setHour(6.4);});
 for(n=0;n<60*25;n+=15){await step(15);const s=await st();if(ONLY!=='in'&&n%Math.round(60*EVERY)<15&&(s.inBed||s.trans||s.bedB||n<60*12))await shot('out');if(!s.inBed&&!s.trans&&!s.bedB&&n>60*10)break;}
 await b.close();
 // sheets: rows of 4 views
 const py=`import sys,glob,os\nfrom PIL import Image,ImageDraw\nD=sys.argv[1];import json\nL=[json.loads(l) for l in open(D+'/log.txt')]\nR=8;S=${SZ}\nfor si in range(0,len(L),R):\n rows=L[si:si+R];im=Image.new('RGB',(S*4,S*len(rows)),(0,0,0));d=ImageDraw.Draw(im)\n for r,e in enumerate(rows):\n  for v in range(4):\n   f='%s/raw/s%04d_%d.png'%(D,e['n'],v)\n   if os.path.exists(f):im.paste(Image.open(f).convert('RGB').resize((S,S)),(v*S,r*S))\n  g=e.get('gap',{});d.text((4,r*S+4),'%s f%d %s hips%s head%s feet%s/%s'%(e['tag'],e['f'],e.get('step'),g.get('Hips'),g.get('Head'),g.get('LeftFoot'),g.get('RightFoot')),fill=(255,255,0))\n im.save('%s/sheet_%02d.jpg'%(D,si//R),quality=82)\n`;
 fs.writeFileSync(OUT+'/sheets.py',py);execSync(`python3 ${OUT}/sheets.py ${OUT}`,{stdio:'inherit'});
 console.log('shots',shotN,'in',((Date.now()-t0)/1000|0),'s');if(errs.length)console.log(errs.slice(0,5).join('\n'));})().catch(e=>{console.error(e);process.exit(2);});
