#!/usr/bin/env node
// Compare two gate runs task by task and body part by body part (P1 problems the gate counts, worst value per key).
//   node tests/anim/cmp.js DIR_A DIR_B [--task REGEX] [--all]
// e.g. A = node tests/anim/gate.js --out /tmp/g-def ; B = node tests/anim/gate.js --style game --out /tmp/g-game (same master).
// Keys are hero|type|bone|into|task as in the gate baseline. Prints: per hero totals, per task counts A -> B, then every key that
// is new / gone / >25 % (and 2 units) worse or better. --all also lists unchanged keys.
const fs=require('fs'),path=require('path');
const [A,B]=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
if(!A||!B){console.error('usage: node tests/anim/cmp.js DIR_A DIR_B [--task REGEX] [--all]');process.exit(2);}
const load=d=>{const f=path.join(d,'worst.json');if(!fs.existsSync(f)){console.error(f+' missing: run the gate again with this tests code');process.exit(2);}return JSON.parse(fs.readFileSync(f));};
const a=load(A),b=load(B);const TR=arg('task',null)?new RegExp(arg('task')):null;
const keep=k=>!TR||TR.test(k.split('|')[4]);
const ka=Object.keys(a.worst).filter(keep),kb=Object.keys(b.worst).filter(keep);
console.log(`A = ${A} (${a.style})\nB = ${B} (${b.style})`);
const heroes=[...new Set([...a.heroes,...b.heroes])];
for(const h of heroes){const na=ka.filter(k=>k.startsWith(h+'|')).length,nb=kb.filter(k=>k.startsWith(h+'|')).length;
 const ha=a.hard.filter(x=>x.startsWith(h+' ')).length,hb=b.hard.filter(x=>x.startsWith(h+' ')).length;
 console.log(`${h}: P1 keys ${na} -> ${nb}, HARD ${ha} -> ${hb}`);}
for(const x of b.hard)if(!a.hard.includes(x))console.log('  HARD only in B: '+x);
// per task
const byT={};for(const [s,ks] of [['a',ka],['b',kb]])for(const k of ks){const t=k.split('|')[0]+' '+k.split('|')[4];(byT[t]=byT[t]||{a:0,b:0})[s]++;}
console.log('\nper task (A -> B, changed only):');
for(const t of Object.keys(byT).sort()){const v=byT[t];if(v.a!==v.b)console.log(`  ${t.padEnd(26)} ${v.a} -> ${v.b}`);}
// per key
const rows=[];for(const k of new Set([...ka,...kb])){const x=a.worst[k],y=b.worst[k];
 const kind=!x?'NEW':!y?'GONE':y.v>x.v*1.25&&y.v-x.v>2?'WORSE':x.v>y.v*1.25&&x.v-y.v>2?'BETTER':'same';
 if(kind==='same'&&!process.argv.includes('--all'))continue;rows.push([kind,k,x,y]);}
const ord={NEW:0,WORSE:1,BETTER:2,GONE:3,same:4};rows.sort((p,q)=>ord[p[0]]-ord[q[0]]||p[1].localeCompare(q[1]));
console.log(`\nper key: ${rows.filter(r=>r[0]==='NEW').length} new, ${rows.filter(r=>r[0]==='WORSE').length} worse, ${rows.filter(r=>r[0]==='BETTER').length} better, ${rows.filter(r=>r[0]==='GONE').length} gone in B`);
for(const [kind,k,x,y] of rows){const u=(y||x).unit||'';console.log(`  ${kind.padEnd(6)} ${k.replace(/\|/g,' / ')}: ${x?x.v+' (f'+x.f+')':'-'} -> ${y?y.v+' (f'+y.f+')':'-'} ${u}`);}
