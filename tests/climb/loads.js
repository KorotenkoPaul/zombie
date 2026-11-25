// Ladders with a load: every climb in the tasks that carry something (logs, buckets, the meat sack, the bow and quiver).
// node tests/climb/loads.js [--only 'fetchwater|dumpwater|firewood|hunt|trip'] [--shots DIR] [--every N] [--query ?style=game] [--secs 200]
// Per climb: tools still in a hand on the rungs, tools whose mesh goes into a rung (cm), hands off their rungs while held (cm).
// --first N: shots only in the first N frames on each ladder (the mount). --shots: one fixed far camera per ladder (as ladder.js --fixcam), a frame every N frames while he is on a ladder.
const {open}=require('../anim/lib.js');const {simulate}=require('../anim/simulate.js');const fs=require('fs');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
const ONLY=new RegExp('^('+arg('--only','fetchwater|dumpwater|firewood|hunt|trip')+')$'),SHOTS=arg('--shots',null),EVERY=+arg('--every',10),SECS=+arg('--secs',200);
(async()=>{const o=await open({seed:1,query:arg('--query','')});const p=o.p;
 if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});}
 await p.evaluate(()=>{window.__ld={rec:[],fr:0,shots:[]};
  const probe=()=>{const HH=__dbg.HH,H=HH.H,T=__dbg.THREE,B=HH.bones;const L=window.__ld;L.fr++;if(!H.lad){L.cur=null;return;}
   const wp=b=>b.getWorldPosition(new T.Vector3());const lads=window.__ladders||[];const r0=HH.root.position;
   let lad=null,bd=1e9;for(const l of lads){const d=Math.hypot(l.x-r0.x,l.z-r0.z);if(d<bd){bd=d;lad=l;}}
   const key=(lad?lad.x.toFixed(1)+','+lad.z.toFixed(1):'?');if(!L.cur||L.cur.key!==key||L.cur.task!==H.task){L.cur={key,task:H.task,rope:lad&&lad.rope,n:0,inHand:{},rungPen:{},onBody:{},fr0:L.fr};L.rec.push(L.cur);}
   const c=L.cur;c.n++;c.phase=H.lad.phase;
   const P=window.__props;const tools=P&&P.tools||{};const isHero=o=>{for(let q=o;q;q=q.parent)if(q===HH.root)return true;return false;};
   const rungs=lad?lad.rungs:[];
   for(const [n,t] of Object.entries(tools)){if(!t||!t.visible)continue;let near=false;const tp=wp(t);if(tp.distanceTo(wp(B.Hips))<1.2)near=true;if(!near)continue;
    const inH=t.parent===B.LeftHand||t.parent===B.RightHand;if(inH&&H.lad.phase==='climb')c.inHand[n]=(c.inHand[n]||0)+1;
    if(isHero(t)||t.parent===HH.root.parent&&tp.distanceTo(wp(B.Spine2))<.7)c.onBody[n]=(c.onBody[n]||0)+1;
    // mesh vertices against the rungs (cylinders along x)
    let dmax=0;t.updateMatrixWorld(true);t.traverse(m=>{if(!m.isMesh||!m.geometry||!m.visible)return;const pa=m.geometry.attributes.position;if(!pa)return;const st=Math.max(1,Math.floor(pa.count/160));const v=new T.Vector3();
     for(let i=0;i<pa.count;i+=st){v.fromBufferAttribute(pa,i).applyMatrix4(m.matrixWorld);for(let ri=0;ri<rungs.length;ri++){const R=rungs[ri];if(Math.abs(v.x-R.x)>R.half)continue;const d=Math.hypot(v.y-R.y,v.z-R.z);const pen=(R.r||.02)-d;if(pen>dmax){dmax=pen;if(pen>.005){const hp=wp(B.Hips);const CA2=window.__climb&&window.__climb.state.act;c.penAt=[n,c.n,ri,rungs.length,+(v.y-hp.y).toFixed(2),+(v.z-hp.z).toFixed(2),+(v.x-hp.x).toFixed(2),CA2&&CA2.mode,CA2&&CA2.C?+CA2.C.s.toFixed(2):null,t.parent&&t.parent.name,HH.root.position.toArray().map(x=>+x.toFixed(2)),+HH.root.rotation.y.toFixed(2),[+R.x.toFixed(2),+R.y.toFixed(2),+R.z.toFixed(2),R.half],(()=>{const ry=HH.root.rotation.y,dx=v.x-hp.x,dz=v.z-hp.z;return ['fwd',+(dx*Math.sin(ry)+dz*Math.cos(ry)).toFixed(2),'right',+(-dx*Math.cos(ry)+dz*Math.sin(ry)).toFixed(2)];})(),H.lad.phase];}}}}});
    if(dmax>.005){const k=n;c.rungPen[k]=Math.max(c.rungPen[k]||0,Math.round(dmax*1000)/10);}}
   // hands: wrist to the nearest rung of this ladder while on the rungs
   const CA=window.__climb&&window.__climb.state&&window.__climb.state.act;if(H.lad.phase==='climb'&&CA&&CA.mode==='climb'){for(const h of ['LeftHand','RightHand']){const lr=CA.limb[h[0]+'H'].r;if(!(lr>=0&&lr<CA.R.length))continue;/* on a rung, not flat on the floor above or at the hip */const q=wp(B[h]);let best=1e9;for(const R of rungs){const dx=Math.max(0,Math.abs(q.x-R.x)-R.half);best=Math.min(best,Math.hypot(dx,q.y-R.y,q.z-R.z));}const pv=L['pv'+h];L['pv'+h]=q.clone();if(pv&&pv.distanceTo(q)<.003&&best<.6){c['held'+h]=(c['held'+h]||0)+1;c['max'+h]=Math.max(c['max'+h]||0,Math.round(best*1000)/10);if(best>.06)c['off'+h]=(c['off'+h]||0)+1;if(best>.12&&(c.offs=c.offs||[]).length<40)c.offs.push([c.n,h[0],Math.round(best*100),lr,CA.steps,!!(CA.step&&CA.step.move.some(m=>m.k===h[0]+'H')),+(CA.limb[h[0]+'H'].w||0).toFixed(2),+(window.__climb.state.W||0).toFixed(2)]);}}}
   if(window.__ldShots&&L.fr%window.__ldShots===0&&(!window.__ldFirst||c.n<=window.__ldFirst))L.shots.push({fr:L.fr,key,task:H.task});};
  const st=__qa.step.bind(__qa);__qa.step=(k,dt,cb)=>{let i=0;return st(k,dt,f=>{const r=cb?cb(f):undefined;try{probe();}catch(e){window.__ldErr=String(e);}return r;});};},);
 if(SHOTS)await p.evaluate(([e,f])=>{window.__ldShots=e;window.__ldFirst=f;},[EVERY,+arg('--first',0)]);
 // shots are taken right after a run of frames: capture them per chunk (the camera code is ladder.js --fixcam's)
 let shotN=0;const take=async()=>{const sh=await p.evaluate(()=>{const s=window.__ld.shots.splice(0);return s;});if(!SHOTS||!sh.length)return;const last=sh[sh.length-1];
  await p.evaluate(()=>{const T=__dbg.THREE;const HH=__dbg.HH;const h=HH.bones.Hips.getWorldPosition(new T.Vector3());let best=null,bd=1e9;for(const l of window.__ladders||[]){const d=Math.hypot(l.x-h.x,l.z-h.z);if(d<bd){bd=d;best=l;}}
   const c=best?[best.x,(best.y0+best.y1)/2,best.z]:[h.x,h.y,h.z];const dist=Math.max(4.5,best?(best.y1-best.y0)*1.35+1.2:0),yaw=.7,pitch=.15;if(window.__camera&&window.__camera.dof)window.__camera.dof(false);
   const cam=__qaCamera;cam.position.set(c[0]+Math.sin(yaw)*Math.cos(pitch)*dist,c[1]+Math.sin(pitch)*dist,c[2]+Math.cos(yaw)*Math.cos(pitch)*dist);cam.lookAt(c[0],c[1],c[2]);cam.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);});
  const f=`${SHOTS}/${last.task}_${String(++shotN).padStart(4,'0')}.png`;await p.locator('canvas').first().screenshot({path:f});};
 await simulate(p,{gate:SECS,only:ONLY,log:console.log,drain:async()=>{},capture:SHOTS?{frames:new Set(Array.from({length:400000/EVERY},(_,i)=>(i+1)*EVERY)),fn:take}:null});
 const R=await p.evaluate(()=>({rec:window.__ld.rec,err:window.__ldErr||null}));
 for(const c of R.rec)console.log(JSON.stringify(c));if(R.err)console.log('probe error',R.err);
 await o.b.close();})();
