// Hand-contact probe: run one task in the real game and measure, on every frame where a handle moves,
// how far the nearer palm is from it.   node tests/grab/probe.js <task> [secs] [--opts JSON] [--hour H] [--query ?hero=old]
const {open}=require('../anim/lib.js');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
(async()=>{const task=process.argv[2]||'hatch',secs=+(process.argv[3]||25);const opts=JSON.parse(arg('--opts','null')||'null');const hr=+arg('--hour','11');
 const {b,p,errs}=await open({seed:+arg('--seed','1'),query:arg('--query','')});
 await p.evaluate(()=>__qa.start());await p.evaluate(([h,fl])=>{__qa.reseed(7);__th.setHour(h);eval(fl);},[hr,arg('--eval','')]);
 await p.evaluate(()=>{const P=window.__props,Hs=window.__house,V=(...a)=>new __dbg.THREE.Vector3(...a);
  const HD={hatch:()=>Hs&&Hs.hatch&&Hs.hatch.grab.clone(),door:()=>P.door&&P.door.handle(V()),bolt:()=>P.door&&P.door.boltKnob(V()),fridge:()=>P.fridge&&P.fridge.handle(V()),oven:()=>P.oven&&P.oven.handle&&P.oven.handle()};
  const isHero=o=>{for(let x=o;x;x=x.parent)if(x===__dbg.hero.root)return true;return false;};
  const GS={};for(const k in P.tools){const o=P.tools[k];const sp=__grab.GRIP[k];const g=sp&&sp.g?V(...sp.g):(o.userData.grip?o.userData.grip.clone():V());GS['tool:'+k]=1;HD['tool:'+k]=()=>isHero(o)||!o.visible?null:o.localToWorld(g.clone());}
  if(P.oven&&P.oven.door)HD.ovenDoor=()=>P.oven.handle();
  const B=__dbg.heroBones,last={},rec={};window.__gp={rec,frames:[]};
  const palm=s=>{const h=B[s+'Hand'].getWorldPosition(V()),f=B[s+'ForeArm'].getWorldPosition(V());return h.clone().add(h.clone().sub(f).setLength(.06));};
  window.__gp.tick=(f)=>{const H=__dbg.hero;const pl=[palm('Left'),palm('Right')];
   for(const k in HD){let q;try{q=HD[k]();}catch(e){q=null;}if(!q)continue;const l=last[k];last[k]=q;if(!l)continue;const mv=q.distanceTo(l);if(mv<5e-4||mv>.5)continue;
    const d=GS[k]?Math.min(__grab.gripPoint('Left').distanceTo(q),__grab.gripPoint('Right').distanceTo(q)):Math.min(pl[0].distanceTo(q),pl[1].distanceTo(q));(rec[k]=rec[k]||[]).push([f,+(d*100).toFixed(1),H.task,(H.act||{}).step||'',+(mv*1000).toFixed(1)]);}};});
 if(opts)await p.evaluate(([t,o])=>__dbg.HH.startTask(t,o),[task,opts]);else await p.evaluate(t=>__th.task(t),task);
 const N=Math.round(secs*60);for(let i=0;i<N;i+=30)await p.evaluate(()=>{for(let k=0;k<30;k++){__qa.step(1,1/60);__gp.tick(__qa.frame);}});
 const rec=await p.evaluate(()=>__gp.rec);const st=await p.evaluate(()=>__th.state());
 for(const k in rec){const a=rec[k];const ds=a.map(r=>r[1]).sort((x,y)=>x-y);const q=x=>ds[Math.min(ds.length-1,Math.floor(ds.length*x))];
  console.log(`${k.padEnd(7)} moving ${String(a.length).padStart(4)} fr  palm cm: med ${q(.5)}  p90 ${q(.9)}  max ${ds[ds.length-1]}  min ${ds[0]}`);
  if(process.argv.includes('-v'))for(const r of a)console.log('   ',r.join(' '));}
 console.log('end state',JSON.stringify(st),'errors',errs.slice(0,3));await b.close();})();
