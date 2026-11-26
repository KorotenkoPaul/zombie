#!/usr/bin/env node
// Carry-over check: does anything from the previous task survive the gate's per-task reset?
// Runs the same task for N and N+1 frames in two pages, applies the gate's reset (reseed, hour, brain prime, HH.qaReset if any,
// spawn('read')), then compares the hero right after the reset and after 1, 30 and 300 more frames. With a complete reset all
// differences are 0 and a one-frame shift in one task can no longer re-roll every later task of the gate.
//   node tests/anim/carry.js [--task listen] [--hour 21] [--n 1500] [--query '?hero=new']
const {open}=require('./lib');const install=require('./sampler.js');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const T=arg('task','listen'),HR=+arg('hour',21),N=+arg('n',1500),Q=arg('query','');
async function one(n){const {b,p}=await open({seed:1,query:Q});await p.evaluate(`(${install})({})`);await p.evaluate(()=>__qa.start());
 await p.evaluate(([t,h])=>{__qa.reseed(7);__th.setHour(h);__dbg.HH.spawn('read');const B=window.__brain;if(B&&B.command)B.command(t);else __th.task(t);},[T,HR]);
 await p.evaluate(n=>__qa.step(n,1/60),n);
 const r=await p.evaluate(()=>{__qa.reseed(99);__th.setHour(20);const B=window.__brain;if(B&&B.prime)B.prime(20);if(__dbg.HH.qaReset)__dbg.HH.qaReset();__dbg.HH.spawn('read');
  const H=__dbg.hero;const snap=()=>{const o={};const seen=new Set();
   const walk=(x,pre,d)=>{if(d>3||x==null)return;if(typeof x==='number'){o[pre]=+x.toFixed(6);return;}if(typeof x==='boolean'||typeof x==='string'){o[pre]=x;return;}
    if(typeof x!=='object'||seen.has(x))return;seen.add(x);if(x.isObject3D)return;if(Array.isArray(x)&&x.length>50)return;
    for(const k of Object.keys(x)){if(k==='parent'||k==='children'||k==='_accuIndex')continue;walk(x[k],pre+'.'+k,d+1);}};
   walk(H,'H',0);H.root.updateMatrixWorld(true);const v=new __dbg.THREE.Vector3();for(const [k,bn] of Object.entries(__dbg.heroBones)){bn.getWorldPosition(v);o['bone '+k]=v.toArray();}return o;};
  const out={};out[0]=snap();for(const k of [1,29,270]){__qa.step(k,1/60);out[__qa._c=(__qa._c||0)+k]=snap();}return out;});
 await b.close();return r;}
(async()=>{const [A,B]=await Promise.all([one(N),one(N+1)]);
 for(const k of Object.keys(A)){const a=A[k],b=B[k];let mx=0,mb='';const fields=[];
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(key.startsWith('bone ')){const d=Math.max(...a[key].map((x,i)=>Math.abs(x-b[key][i])));if(d>mx){mx=d;mb=key.slice(5);}}
   else if(JSON.stringify(a[key])!==JSON.stringify(b[key]))fields.push(key+': '+JSON.stringify(a[key])+' | '+JSON.stringify(b[key]));}
  console.log('frame +'+k+': bones differ up to '+(mx*100).toFixed(2)+' cm ('+(mb||'-')+'), '+fields.length+' hero fields differ'+(fields.length?'\n   '+fields.slice(0,20).join('\n   '):''));}
 })();
