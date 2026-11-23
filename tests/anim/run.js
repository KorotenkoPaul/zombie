#!/usr/bin/env node
// Animation QA: whole daily routine, fixed 1/60 s step, fixed seed; every frame measured; exit code 1 if any P1/P2 issue.
// Usage: node tests/anim/run.js [--out DIR] [--seed N] [--hours H] [--no-tour] [--max-p 2]
// Output: DIR/frames.json.gz (raw per-frame log), DIR/issues.json, DIR/summary.txt
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {open}=require('./lib');const {simulate}=require('./simulate');const {analyze}=require('./analyze');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const OUT=path.resolve(arg('out','/tmp/anim-qa'));const SEED=+arg('seed',1);const HOURS=+arg('hours',25);const MAXP=+arg('max-p',2);
(async()=>{fs.mkdirSync(OUT,{recursive:true});const t0=Date.now();
 const QUERY=arg('query','');const {b,p,errs}=await open({seed:SEED,query:QUERY});
 const sim=await simulate(p,{hours:HOURS,tour:!process.argv.includes('--no-tour')});
 const D=await p.evaluate(()=>({...__A.out,names:__A.collNames(),mov:__A.movNames()}));await b.close();
 const git=(()=>{try{return require('child_process').execSync('git -C '+path.resolve(__dirname,'../..')+' rev-parse --short HEAD').toString().trim();}catch(e){return '?';}})();
 D.meta={git,query:QUERY,seed:SEED,hours:HOURS,at:new Date().toISOString(),coll:sim.info};
 fs.writeFileSync(OUT+'/frames.json.gz',zlib.gzipSync(JSON.stringify(D)));
 const R=analyze(D);R.meta=D.meta;R.pageErrors=errs;fs.writeFileSync(OUT+'/issues.json',JSON.stringify(R,null,1));
 const cnt={};for(const q of R.issues){const k='P'+q.P+' '+q.type;cnt[k]=(cnt[k]||0)+1;}
 const lines=[`anim-qa ${git} seed ${SEED}: ${D.frames.length} frames (${(D.frames.length/60).toFixed(0)} s), ${((Date.now()-t0)/1000).toFixed(0)} s wall`,JSON.stringify(cnt)];
 for(const q of R.issues.filter(q=>q.P<=MAXP).slice(0,60))lines.push(`P${q.P} ${q.type.padEnd(11)} t=${String(q.t).padStart(7)}s f${q.f} ${q.act} [${q.clip}] ${q.bone} ${q.value} ${q.unit}${q.into?' into '+q.into:''}${q.what?' ('+q.what+')':''}${q.count>1?' x'+q.count:''}`);
 if(errs.length)lines.push('page errors: '+errs.slice(0,5).join(' | '));
 fs.writeFileSync(OUT+'/summary.txt',lines.join('\n')+'\n');console.log(lines.join('\n'));
 const bad=R.issues.filter(q=>q.P<=MAXP).length;process.exit(bad?1:0);})().catch(e=>{console.error(e);process.exit(2);});
