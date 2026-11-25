const {open}=require('/home/user/zombie/tests/anim/lib');const Q=process.argv[2]||'';
(async()=>{const {b,p}=await open({seed:13,query:Q});await p.evaluate(()=>__qa.start());await p.evaluate(()=>__qa.reseed(13));
 await p.evaluate(()=>__th.setHour(11));await p.evaluate(()=>__qa.step(60,1/60));await p.evaluate(()=>__th.task('splitwood'));
 const rows=[];
 for(let i=0;i<2400&&rows.length<240;i++){await p.evaluate(()=>__qa.step(1,1/60));
  const r=await p.evaluate(()=>{const h=__dbg.hero;if(h.state!=='walk'||h.lad)return null;const hb=__dbg.heroBones,T=__dbg.THREE;const a=new T.Vector3(),t=new T.Vector3(),k=new T.Vector3();
   hb.LeftFoot.getWorldPosition(a);hb.LeftToeBase.getWorldPosition(t);hb.LeftLeg.getWorldPosition(k);const d=t.clone().sub(a);const pitch=Math.atan2(d.y,Math.hypot(d.x,d.z))*57.3;
   const shin=a.clone().sub(k);const ank=Math.acos(Math.max(-1,Math.min(1,shin.normalize().dot(d.clone().normalize()))))*57.3;
   return [+pitch.toFixed(1),+ank.toFixed(1),+(a.y-h.root.position.y).toFixed(3),+(t.y-h.root.position.y).toFixed(3)];});
  if(r)rows.push(r);}
 const col=j=>rows.map(r=>r[j]);const st=a=>[Math.min(...a),Math.max(...a)].map(v=>+v.toFixed(2));
 console.log(Q||'default','frames',rows.length,'foot pitch deg',st(col(0)),'ankle deg',st(col(1)),'heel h',st(col(2)),'toe h',st(col(3)));
 require('fs').writeFileSync('/tmp/claude-0/-home-user/ab6eaea2-21c9-5dda-9ed3-9c51556d8a64/scratchpad/pv/foot'+(Q?'_game':'')+'.json',JSON.stringify(rows));await b.close();})();
