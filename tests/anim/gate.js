#!/usr/bin/env node
// Fast animation gate (~3-5 min): both heroes in parallel, every task the body knows, ~15 s each (walk there, start it,
// the transitions and ladders on the way), every frame sampled with the same checks as run.js.
// Fails (exit 1) only on REGRESSIONS against tests/anim/gate-baseline.json: a P1 problem of a kind / body part / task that
// the baseline does not have, or one that got more than 25 % (and 2 units) worse. Fixes never fail it.
//   node tests/anim/gate.js                 # check (run this before pushing anything that touches the hero)
//   node tests/anim/gate.js --update-baseline   # after a real improvement: record the new, better state
//   --heroes old,new  --cap 15  --out DIR
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {open}=require('./lib');const {simulate}=require('./simulate');const {analyze}=require('./analyze');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const HEROES=arg('heroes','old,new').split(',');const CAP=+arg('cap',15);const OUT=path.resolve(arg('out','/tmp/anim-gate'));
const BASE=path.join(__dirname,'gate-baseline.json');const UPDATE=process.argv.includes('--update-baseline');
const GATE=new Set(['joint','owl-head','foot-bend','unsupported','penetration','grip','no-touch','jump','snap-turn','ladder-grip']);
const Q={old:'',new:'?hero=new'};
const FROM=arg('from',null);// re-check recorded frames (DIR/<hero>/frames.json.gz) with the current analyze.js, no browser
async function one(h){let D,errs=[];if(FROM){D=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FROM,h,'frames.json.gz'))));}else{const o=await open({seed:1,query:Q[h]??''});errs=o.errs;
 await simulate(o.p,{gate:CAP,log:()=>{}});D=await o.p.evaluate(()=>({...__A.out,names:__A.collNames(),mov:__A.movNames()}));await o.b.close();}
 const R=analyze(D);fs.mkdirSync(OUT+'/'+h,{recursive:true});fs.writeFileSync(OUT+'/'+h+'/frames.json.gz',zlib.gzipSync(JSON.stringify({...D,meta:{seed:1,query:Q[h]??'',gate:CAP}})));
 fs.writeFileSync(OUT+'/'+h+'/issues.json',JSON.stringify(R));const byF=new Map(D.frames.map(f=>[f.f,f]));
 const worst={};for(const q of R.issues){if(q.P!==1||!GATE.has(q.type))continue;if(q.type==='jump'&&q.value<10)continue;
  const task=(byF.get(q.f)||{}).task||'-';const k=[h,q.type,q.bone,String(q.into||'').replace(/#\d+.*|~\d+/,''),task].join('|');
  if(!worst[k]||q.value>worst[k].v)worst[k]={v:q.value,f:q.f,unit:q.unit,what:q.what||''};}
// HARD limits on the paths Pavel watches (bed, eating, fridge, stirring, ladders): these fail even if the baseline has them
 const hard=[];for(const q of R.issues){const f=byF.get(q.f)||{};const key=/^(sleep|eat|cook|store|pot)$/.test(f.task)||f.fl&&f.fl.includes('L');if(!key)continue;
  const bad=(q.type==='joint'&&q.value>=30)||(q.type==='unsupported'&&q.value>=10)||(q.type==='penetration'&&q.value>=8&&!/95x20|230x20/.test(q.into||''))||(q.type==='jump'&&q.bone==='root'&&q.value>=20)||(q.type==='owl-head'&&q.value>=120);
  if(bad)hard.push(h+' '+q.type+' '+q.bone+' '+q.value+' '+(q.unit||'')+' '+(q.into?'into '+q.into+' ':'')+'f'+q.f+(q.to?'-'+q.to:'')+' '+f.task+'/'+q.clip);}
 return {h,frames:D.frames.length,worst,errs,hard};}
(async()=>{const t0=Date.now();const res=await Promise.all(HEROES.map(one));const cur={};for(const r of res)Object.assign(cur,r.worst);
 const frames=res.map(r=>r.h+' '+r.frames).join(', ');
 if(UPDATE||!fs.existsSync(BASE)){const keep={};for(const k in cur)keep[k]=cur[k].v;fs.writeFileSync(BASE,JSON.stringify(keep,null,0).replace(/,"/g,',\n"'));
  console.log('gate baseline written:',Object.keys(keep).length,'known P1 problems ('+frames+' frames, '+((Date.now()-t0)/1000|0)+' s)');process.exit(0);}
 const base=JSON.parse(fs.readFileSync(BASE));const bad=[];
 for(const k in cur){const v=cur[k].v,b0=base[k];if(b0===undefined)bad.push(['NEW',k,v,cur[k]]);else if(v>b0*1.25&&v-b0>2)bad.push(['WORSE',k,v,cur[k],b0]);}
 // the detailed hero is not fully deterministic yet (replays can part after ~1000 frames): a regression must show up again
 // in a second run to count
 if(bad.length&&!FROM){const hs=[...new Set(bad.map(x=>x[1].split('|')[0]))];console.log('re-running',hs.join(','),'to confirm',bad.length,'possible regressions...');
  const again={};for(const r of await Promise.all(hs.map(one)))Object.assign(again,r.worst);
  for(let i=bad.length-1;i>=0;i--){const k=bad[i][1];const b0=base[k];const v2=again[k]&&again[k].v;const still=v2!==undefined&&(b0===undefined||(v2>b0*1.25&&v2-b0>2));if(!still)bad.splice(i,1);}}
 const hard=res.flatMap(r=>r.hard);
 const fixed=Object.keys(base).filter(k=>!(k in cur)&&HEROES.includes(k.split('|')[0]));
 console.log(`anim gate: ${frames} frames, ${((Date.now()-t0)/1000|0)} s; ${bad.length} regressions, ${fixed.length} baseline problems gone`);
 for(const [kind,k,v,c,b0] of bad.slice(0,40))console.log(` ${kind.padEnd(5)} ${k.replace(/\|/g,' / ')}: ${v} ${c.unit}${b0!==undefined?' (was '+b0+')':''} at f${c.f} ${c.what}`);
 if(fixed.length)console.log(' gone (run --update-baseline to lock them in): '+fixed.slice(0,12).map(k=>k.replace(/\|/g,'/')).join(', ')+(fixed.length>12?' ...':''));
 if(hard.length){console.log(` HARD (bed / eating / fridge / stirring / ladders, fail even when known): ${hard.length}`);for(const x of hard.slice(0,25))console.log('  '+x);}
 console.log(' details: '+OUT+'/<hero>/issues.json; replay frames with node tests/anim/shots.js --in '+OUT+'/<hero>');
 process.exit(bad.length||hard.length?1:0);})().catch(e=>{console.error(e);process.exit(2);});
