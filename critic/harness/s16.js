// s12's common-sense day log, but on the animation QA's fixed-step clock (tests/anim/lib.js: seeded random, __qa.step(n,1/60)),
// so arm and hand actions run at normal speed. Usage: node s16.js <out.json> [startHour=10] [hours=24] [seed=13]
const fs=require('fs');const {open}=require('../../tests/anim/lib');const OUT=process.argv[2];const H0=+(process.argv[3]||10),HN=+(process.argv[4]||24),SEED=+(process.argv[5]||13);
const src=fs.readFileSync(__dirname+'/s13.js','utf8');const SAMPLE=eval('('+src.split('const SAMPLE=')[1].split('\n(async')[0].trim().replace(/;$/,'')+')');
(async()=>{const {b,p,errs}=await open({seed:SEED,query:process.env.Q||""});await p.evaluate(()=>__qa.start());await p.evaluate(s=>__qa.reseed(s),SEED);
 await p.evaluate(h=>__th.setHour(h),H0);if(process.env.TASK){await p.evaluate(()=>__qa.step(120,1/60));await p.evaluate(t=>__th.task(t),process.env.TASK);}const log=[];let acc=0,last=-1;
 for(let i=0;i<4*HN*3&&acc<HN;i++){await p.evaluate(()=>__qa.step(900,1/60));const s=await p.evaluate(SAMPLE);
  if(last>=0){let d=s.hour-last;if(d<0)d+=24;acc+=d;}last=s.hour;log.push(s);
  if(i%8===0)console.log(s.hour,s.task,JSON.stringify(s.door),s.hatch,s.away.map(a=>a.k+(a.par?'@'+a.par:'')).join(','));}
 fs.writeFileSync(OUT,JSON.stringify(log));console.log('samples',log.length,errs.slice(0,3).join('\n'));await b.close();})();
