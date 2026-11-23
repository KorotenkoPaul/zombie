// Motion-matching check on a fixed errand route, with or without motion matching.
// node tests/mm/scenario.js --out DIR [--off]   -> DIR/frames.json.gz, DIR/report.json (QA analyzer issues + locomotion metrics)
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {open}=require('../anim/lib.js');const install=require('../anim/sampler.js');const {analyze}=require('../anim/analyze.js');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const OUT=path.resolve(arg('out','/tmp/mm'));const OFF=process.argv.includes('--off');const NOCOL=process.argv.includes('--nocollide');
const ROUTE=(arg('route','cook,wash,craft,look,window,read')).split(',');
(async()=>{fs.mkdirSync(OUT,{recursive:true});const t0=Date.now();const {b,p,errs}=await open({seed:3});
 await p.evaluate(`(${install})({vertStep:40})`);await p.evaluate(()=>__qa.start());
 await p.evaluate(()=>{window.__LQ=['Hips','Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightUpLeg','RightLeg','RightFoot','RightToeBase'];});
 await p.evaluate(off=>{__qa.reseed(99);__th.setHour(10.5);window.__noMotion=off[0];if(off[1]&&window.__collide)window.__collide.enable(false);if(__dbg.HH&&__dbg.HH.setBrain)__dbg.HH.setBrain({tick(){}});},[OFF,NOCOL]);
 const step=async(n,tag)=>p.evaluate(([n,tag])=>__qa.step(n,1/60,f=>{__A.sample(f,1/60,__th.state().hour,tag);const m=window.__motion;const r=__A.out.frames[__A.out.frames.length-1];if(m){const i=m.info();r.mm=[i.on?1:0,i.layer?1:0,i.jumps,+i.cost.toFixed(2),i.lk,i.clip+':'+i.f];}const hb=__dbg.heroBones;r.lq=__LQ.map(n=>hb[n].quaternion.toArray().map(v=>+v.toFixed(4)));r.hp=hb.Hips.position.toArray().map(v=>+v.toFixed(4));r.ry=+__dbg.hero.root.rotation.y.toFixed(4);}),[n,tag]);
 for(const t of ROUTE){await p.evaluate(t=>__th.task(t),t);let n=0,settled=0;
  while(n<60*40){await step(30,t);n+=30;const s=await p.evaluate(()=>{const h=__dbg.hero;return {path:h.path.length,tr:!!h.trans||!!h.swing||!!h.lad,state:h.state}});
   if(s.path===0&&!s.tr&&s.state==='work'){if(++settled>=6)break;}else settled=0;}
  console.log(t,'frames',n);}
 const D=await p.evaluate(()=>({...__A.out,names:__A.collNames()}));const st=await p.evaluate(()=>window.__motion?{...window.__motion.stats}:null);await b.close();
 fs.writeFileSync(OUT+'/frames.json.gz',zlib.gzipSync(JSON.stringify(D)));
 const R=analyze(D);const F=D.frames;const B=n=>['Hips','Spine2','Neck','Head','HeadTop_End','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','LeftToe_End','RightUpLeg','RightLeg','RightFoot','RightToeBase','RightToe_End','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand'].indexOf(n);
 const pos=(f,n)=>{const i=B(n)*3;return [f.b[i],f.b[i+1],f.b[i+2]];};
 // hips speed / acceleration (smoothed over 5 frames) and "frozen" frames while a path is being walked
 const hs=[];for(let i=2;i<F.length-2;i++){const a=pos(F[i-2],'Hips'),c=pos(F[i+2],'Hips');hs[i]=Math.hypot(c[0]-a[0],c[2]-a[2])/(4/60);}
 let frozen=0,walkF=0,maxAcc=0;const acc=[];for(let i=4;i<F.length-4;i++){if(hs[i+2]==null||hs[i-2]==null)continue;const a=(hs[i+2]-hs[i-2])/(4/60);acc.push(Math.abs(a));if(F[i].fl.includes('P')&&!F[i].fl.includes('L')){walkF++;if(hs[i]<.08)frozen++;maxAcc=Math.max(maxAcc,Math.abs(a));}}
 acc.sort((a,b)=>a-b);
 // foot slide: horizontal ankle speed when the ankle is within 3 cm of its local minimum height and slow
 let slideSum=0,slideN=0,slideMax=0;for(const s of ['LeftFoot','RightFoot']){for(let i=1;i<F.length;i++){const a=pos(F[i-1],s),c=pos(F[i],s);const g=F[i].gnd&&F[i].gnd[s==='LeftFoot'?0:2];if(g==null)continue;if(c[1]-g>.11)continue;const v=Math.hypot(c[0]-a[0],c[2]-a[2])*60;if(v>.5)continue;slideSum+=v;slideN++;}}
 // the same robot-tempo analysis on what you see: the hips' ground track instead of the navigation root
 const Dv={...D,frames:F.map(f=>({...f,root:[f.b[0],f.root[1],f.b[2]]}))};const Rv=analyze(Dv);
 const robot=R0=>R0.issues.filter(q=>q.type==='robot').map(q=>({P:q.P,t:q.t,v:q.value,unit:q.unit,what:q.what}));
 const cnt={};for(const q of R.issues){const k='P'+q.P+' '+q.type;cnt[k]=(cnt[k]||0)+1;}
 const rep={off:OFF,robotRoot:robot(R),robotVisible:robot(Rv),frames:F.length,secs:+(F.length/60).toFixed(1),issues:cnt,tempo:R.tempo.walks,walkFrames:walkF,frozenWhileWalking:frozen,maxAccWalk:+maxAcc.toFixed(2),acc99:+(acc[Math.floor(acc.length*.99)]||0).toFixed(2),plantedAnkleSpeedAvg:+(slideSum/Math.max(1,slideN)).toFixed(3),
  mm:st&&{searches:st.searches,jumps:F.length?F[F.length-1].mm&&F[F.length-1].mm[2]:0},list:R.issues.filter(q=>/slide|jump|turn|crab|slow|snap/.test(q.type)).slice(0,40).map(q=>`P${q.P} ${q.type} t=${q.t} ${q.act} [${q.clip}] ${q.bone} ${q.value} ${q.unit}`),errs,wall:((Date.now()-t0)/1000).toFixed(0)};
 fs.writeFileSync(OUT+'/report.json',JSON.stringify(rep,null,1));console.log(JSON.stringify(rep,null,1));})().catch(e=>{console.error(e);process.exit(2);});
