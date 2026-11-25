#!/usr/bin/env node
// Fast animation gate (~3-5 min): both heroes in parallel, every task the body knows, ~15 s each (walk there, start it,
// the transitions and ladders on the way), every frame sampled with the same checks as run.js.
// Fails (exit 1) only on REGRESSIONS against tests/anim/gate-baseline.json: a P1 problem of a kind / body part / task that
// the baseline does not have, or one that got more than 25 % (and 2 units) worse. Fixes never fail it.
//   node tests/anim/gate.js                 # check (run this before pushing anything that touches the hero)
//   node tests/anim/gate.js --update-baseline   # after a real improvement: record the new, better state
//   --heroes old,new,orig  --cap 15  --out DIR
//   --style game              # every hero with ?style=game (the game walk + look); own baseline tests/anim/gate-baseline-game.json
//   node tests/anim/cmp.js DIR_A DIR_B   # per task / body part diff of two gate runs (e.g. default vs --style game on the same master)
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {open}=require('./lib');const {simulate}=require('./simulate');const {analyze}=require('./analyze');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const HEROES=arg('heroes','old,new,orig').split(',');const CAP=+arg('cap',15);const OUT=path.resolve(arg('out','/tmp/anim-gate'));
const STYLE=arg('style',null);const BASE=path.join(__dirname,STYLE?'gate-baseline-'+STYLE+'.json':'gate-baseline.json');const UPDATE=process.argv.includes('--update-baseline');
const GATE=new Set(['joint','owl-head','foot-bend','unsupported','penetration','grip','no-touch','jump','snap-turn','ladder-grip','prop-through-body']);
const Q0={old:'',new:'?hero=new',orig:'?hero=orig'};// old = default hero (v6 since 8e898b1), orig = the previous one
const Q={};for(const h in Q0)Q[h]=STYLE?(Q0[h]?Q0[h]+'&':'?')+'style='+encodeURIComponent(STYLE):Q0[h];
const FROM=arg('from',null);// re-check recorded frames (DIR/<hero>/frames.json.gz) with the current analyze.js, no browser
async function one(h){let D,errs=[];if(FROM){D=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FROM,h,'frames.json.gz'))));}else{const o=await open({seed:1,query:Q[h]??''});errs=o.errs;
 const got=[];await simulate(o.p,{gate:CAP,log:()=>{},only:arg('only',null)?new RegExp('^('+arg('only')+')$'):null,drain:async fr=>{for(const f of fr)got.push(f);}});
  // the rest in chunks: one evaluate with ~90k frames can kill the page ("Execution context was destroyed")
  D=await o.p.evaluate(()=>{const {frames,...rest}=__A.out;return {...rest,names:__A.collNames(),mov:__A.movNames(),nF:frames.length};});
  const nF=D.nF;delete D.nF;for(let a=0;a<nF;a+=4000){const part=await o.p.evaluate(([a,b])=>__A.out.frames.slice(a,b),[a,a+4000]);for(const f of part)got.push(f);}D.frames=got;await o.b.close();}
 const R=analyze(D);fs.mkdirSync(OUT+'/'+h,{recursive:true});fs.writeFileSync(OUT+'/'+h+'/frames.json.gz',zlib.gzipSync(JSON.stringify({...D,meta:{seed:1,query:Q[h]??'',gate:CAP}})));
 fs.writeFileSync(OUT+'/'+h+'/issues.json',JSON.stringify(R));const byF=new Map(D.frames.map(f=>[f.f,f]));
 const worst={};for(const q of R.issues){if(q.P!==1||!GATE.has(q.type))continue;if(q.type==='jump'&&q.value<10)continue;
  const fr=byF.get(q.f)||{};const task=String(fr.tag||'').replace(/^tour:/,'')||fr.task||'-';const k=[h,q.type,q.bone,String(q.into||'').replace(/#\d+.*|~\d+/,''),task].join('|');
  if(!worst[k]||q.value>worst[k].v)worst[k]={v:q.value,f:q.f,unit:q.unit,what:q.what||''};}
// HARD limits on the paths Pavel watches (bed, eating, fridge, stirring, ladders): these fail even if the baseline has them
 const hard=[];for(const q of R.issues){const f=byF.get(q.f)||{};const key=/^(sleep|eat|cook|store|pot)$/.test(f.task)||f.fl&&f.fl.includes('L');if(!key)continue;
  const bad=(q.type==='joint'&&q.value>=30)||(q.type==='unsupported'&&q.value>=10)||(q.type==='penetration'&&q.value>=8&&!/95x20|230x20/.test(q.into||''))||(q.type==='jump'&&q.bone==='root'&&q.value>=20)||(q.type==='owl-head'&&q.value>=120);
  if(bad)hard.push(h+' '+q.type+' '+q.bone+' '+q.value+' '+(q.unit||'')+' '+(q.into?'into '+q.into+' ':'')+'f'+q.f+(q.to?'-'+q.to:'')+' '+f.task+'/'+q.clip);}
 return {h,frames:D.frames.length,worst,errs,hard};}
(async()=>{const t0=Date.now();const res=await Promise.all(HEROES.map(one));const cur={};for(const r of res)Object.assign(cur,r.worst);
 fs.writeFileSync(OUT+'/worst.json',JSON.stringify({style:STYLE||'default',heroes:HEROES,hard:res.flatMap(r=>r.hard),worst:cur}));// for cmp.js
 const frames=res.map(r=>r.h+' '+r.frames).join(', ');
 if(UPDATE||!fs.existsSync(BASE)){const keep={};for(const k in cur)keep[k]=cur[k].v;fs.writeFileSync(BASE,JSON.stringify(keep,null,0).replace(/,"/g,',\n"'));
  console.log('gate baseline written:',Object.keys(keep).length,'known P1 problems ('+frames+' frames, '+((Date.now()-t0)/1000|0)+' s)');process.exit(0);}
 const base=JSON.parse(fs.readFileSync(BASE));const bad=[];
 for(const k in cur){const v=cur[k].v,b0=base[k];if(b0===undefined)bad.push(['NEW',k,v,cur[k]]);else if(v>b0*1.25&&v-b0>2)bad.push(['WORSE',k,v,cur[k],b0]);}
 const hard=res.flatMap(r=>r.hard);
 const fixed=Object.keys(base).filter(k=>!(k in cur)&&HEROES.includes(k.split('|')[0]));
 console.log(`anim gate: ${frames} frames, ${((Date.now()-t0)/1000|0)} s; ${bad.length} regressions, ${fixed.length} baseline problems gone`);
 for(const [kind,k,v,c,b0] of bad.slice(0,40))console.log(` ${kind.padEnd(5)} ${k.replace(/\|/g,' / ')}: ${v} ${c.unit}${b0!==undefined?' (was '+b0+')':''} at f${c.f} ${c.what}`);
 if(fixed.length)console.log(' gone (run --update-baseline to lock them in): '+fixed.slice(0,12).map(k=>k.replace(/\|/g,'/')).join(', ')+(fixed.length>12?' ...':''));
 if(hard.length){console.log(` HARD (bed / eating / fridge / stirring / ladders, fail even when known): ${hard.length}`);for(const x of hard.slice(0,25))console.log('  '+x);}
 console.log(' details: '+OUT+'/<hero>/issues.json; replay frames with node tests/anim/shots.js --in '+OUT+'/<hero>');
 process.exit(bad.length||hard.length?1:0);})().catch(e=>{console.error(e);process.exit(2);});
