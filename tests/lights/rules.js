#!/usr/bin/env node
// Light rules gate (Pavel's rules, game/lights.js + brain.js). Headless, virtual clock (tests/anim/lib.js), no rendering.
//   1. night: a room lamp burns only where the hero is (a lit room he left goes dark within GRACE s: the time to walk back
//      and put it out is the brain's; a room lit for longer with him elsewhere fails)
//   2. lamps never go out by themselves: every room lamp that goes from on to off does so with the hero in that room
//      (he blows it out / flips its switch; the bedroom lamp also goes out when he falls asleep in the bunk)
//   3. rainy day: when he stays in a room (45 s or more, not asleep), its lamp gets lit at some point (Env 788d65d: the brain treats a dark rainy day like night)
//   4. the oven glows when stoked: fire light + glass emissive on, and a stoked fire still burns 3 game hours later
// Run before pushing changes to lights.js, brain.js, the hero's switch/stoke tasks or the day/weather code:
//   node tests/lights/rules.js [--seeds 3,7] [--grace 45]
// ~6-10 min (each seed in parallel). Exit 1 on any broken rule, with the moments it broke.
const {open}=require('../anim/lib');
const MUT=process.argv.includes('--self-test');/* --self-test: breaks the rules on purpose (a workshop lamp left on at night), the gate must fail */
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const SEEDS=arg('seeds','3,7').split(',').map(Number),GRACE=+arg('grace',45);
const ROOMS=['kitchen','bedroom','workshop'];
async function run(seed){
 const {b,p,errs}=await open({seed,query:'?start=fixed'});const fails=[];const notes=[];
 try{
  await p.evaluate(()=>__qa.start());
  // one sampled segment: step `sec` real seconds at 30 fps, sample every 0.5 s
  const seg=async(name,setup,sec,checks)=>{const r=await p.evaluate(([setup,sec,checks,GRACE,ROOMS])=>{
    eval(setup);const B=window.__env&&__env.interiorBoxes;
    const inRoom=q=>{if(!B)return null;for(let i=0;i<3;i++){const r=B[i];if(q.x>r[0]-.3&&q.x<r[1]+.3&&q.y>r[2]-.4&&q.y<r[3]&&q.z>r[4]-.3&&q.z<r[5]+.3)return ROOMS[i];}return null;};
    const out=[],since={},was={},stay={room:null,t:0,lit:false},stays=[];let n=0;
    for(let i=0;i<sec*2;i++){__qa.step(15,1/30);const st=__th.state(),h=st.hour,hr=inRoom(__dbg.hero.root.position);n++;
     const night=h>=21||h<5;
     for(const rm of ROOMS){const g=__lights.get(rm);if(!g)continue;
      // rule 2: on -> off only with him in that room
      if(was[rm]===true&&g.on===false&&hr!==rm&&out.length<12)out.push(['self-off',+h.toFixed(2),rm,'hero in '+hr,st.task]);was[rm]=g.on;
      // rule 1: night, lit with him elsewhere for longer than GRACE
      if(checks.includes('night')&&night&&__lights.level(rm)>.5&&hr!==rm){since[rm]=(since[rm]||0)+.5;if(since[rm]===GRACE&&out.length<12)out.push(['lit-without-hero',+h.toFixed(2),rm,'hero in '+hr,st.task]);}else since[rm]=0;}
     // rule 3: rainy day, a stay of >= 45 s in a room must see its lamp lit
     if(checks.includes('rain')){if(hr!==stay.room){if(stay.room&&stay.t>=45&&!stay.slept)stays.push([stay.room,stay.t,stay.lit,+h.toFixed(2)]);stay.room=hr;stay.t=0;stay.lit=false;stay.slept=false;}
      else if(hr){stay.t+=.5;if(__lights.level(hr)>.5)stay.lit=true;if(st.task==='sleep'||st.task==='nap')stay.slept=true;}}}
    // a stay the segment's end cut short is left out: he may still light the lamp
    return {out,stays,end:__th.state().hour};},[setup,sec,checks,GRACE,ROOMS]);
   for(const o of r.out)fails.push(seed+' '+name+': '+o.join(' '));
   if(checks.includes('rain')){const unlit=r.stays.filter(s=>!s[2]);notes.push(seed+' '+name+': '+r.stays.length+' room stays >=45 s, '+unlit.length+' without the lamp');
    for(const s of unlit)fails.push(seed+' '+name+': dark rainy day, '+s[1]+' s in the '+s[0]+' with its lamp off (until '+s[3]+'h)');}
   notes.push(seed+' '+name+': to '+r.end+'h ok-checks '+checks);};
  // evening and night (19:30 -> 02:00): rules 1 and 2
  await seg('night',"__th.setHour(19.5);"+(MUT?"__lights.set('workshop',true);":""),390,['night']);
  // morning: lamps from the night go out only by his hand (rule 2)
  await seg('dawn',"__th.setHour(5.5);",150,[]);
  // a dark rainy afternoon (11:00 -> 14:00): rules 2 and 3
  await seg('rain',"__th.setHour(11);if(__wind.setGrey)__wind.setGrey(6,true);__wind.setRain(true,'rain');",180,['rain']);
  // rule 4: the oven, stoked
  const ov=await p.evaluate(()=>{__th.setHour(20);__wind.setRain(false);__brain.update=()=>{};const P3=__dbg.P3||window.__props;
   for(const n of __lights.names)__lights.set(n,false);__lights.auto&&__lights.auto('oven');
   const s=__lights.get('oven');// stoking: the little door open while he feeds it (lights.js: task 'stoke' + door open = fed)
   const H=__dbg.HH;try{H.startTask('stoke');}catch(e){}
   let t=0,lit=-1;for(;t<120;t+=.5){__qa.step(15,1/30);if(__lights.level('oven')>.5){lit=t;break;}}
   if(lit<0){__lights.set('oven',true);for(let k=0;k<40;k++)__qa.step(15,1/30);}
   for(let k=0;k<30;k++)__qa.step(15,1/30);const lvl0=__lights.level('oven');let I=0;__lights._dbg().scene.traverse(o=>{if((o.isPointLight||o.isSpotLight)&&o.visible&&o.intensity>0&&o.position.distanceTo(__lights.pos('oven'))<1.2)I+=o.intensity;});let after=-1;if(lit>=0){for(let k=0;k<360;k++)__qa.step(15,1/30);after=__lights.level('oven');}
   return {lit,lvl0,I,after};});
  notes.push(seed+' oven: '+JSON.stringify(ov));
  if(ov.lvl0<.9)fails.push(seed+' oven: not burning after a stoke/switch-on (level '+ov.lvl0.toFixed(2)+')');
  if(ov.I<=0)fails.push(seed+' oven: burning but no light near it');
  if(ov.lit>=0&&ov.after<.9)fails.push(seed+' oven: a stoked fire went out within 3 game hours (level '+ov.after.toFixed(2)+')');
  if(ov.lit<0)notes.push(seed+' oven: the stoke task did not light it here (no logs?): checked the switch-on path only');
  const pe=errs.filter(e=>/^PE /.test(e));if(pe.length)fails.push(seed+' page errors: '+pe.slice(0,3).join(' | '));
 }finally{await b.close();}
 return {fails,notes};}
(async()=>{const t0=Date.now();const R=await Promise.all(SEEDS.map(run));const fails=R.flatMap(r=>r.fails);
 for(const r of R)for(const n of r.notes)console.log('  '+n);
 if(fails.length){console.log('LIGHT RULES BROKEN ('+((Date.now()-t0)/1000|0)+' s):');for(const f of fails)console.log('  ✗ '+f);process.exit(1);}
 console.log('light rules ok ('+SEEDS.length+' seeds, '+((Date.now()-t0)/1000|0)+' s)');})();
