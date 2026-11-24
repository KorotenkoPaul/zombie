// Ladder climb test: every ladder up and down, frame by frame.
// node tests/climb/ladder.js [--off] [--shots DIR] [--only kh_b-kh_t]
// Per frame: wrist / ball-of-foot distance to the nearest real rung while that limb is still (holding / standing),
// root speed jumps, the time each ladder takes. --off = old canned clip (window.__noClimb).
const {open}=require('../anim/lib.js');const fs=require('fs');
const arg=k=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:null;};
const FINE=process.argv.includes("--fine");const OFF=process.argv.includes('--off'),SHOTS=arg('--shots'),ONLY=arg('--only');
const RUNS=[['kh_b','kh_t'],['kh_t','kh_b'],['kl_b','bl_t'],['bl_t','kl_b'],['ll_b','ll_t'],['ll_t','ll_b'],['g_foot','gate'],['gate','g_foot']].filter(r=>!ONLY||ONLY.split(',').includes(r.join('-')));if(ONLY)for(const q of ONLY.split(','))if(!RUNS.some(r=>r.join('-')===q))RUNS.push(q.split('-')); // any node pair (e.g. walk in from kmid: the real mount)
(async()=>{const {b,p,errs}=await open({seed:5,vp:{width:560,height:700},query:arg('--query')||''});await p.evaluate(()=>__qa.start());
 await p.evaluate(([off,co])=>{window.__noClimb=off;window.__noPops=window.__NP;window.__ladFlip=co===2;window.__wcam=1;if(co===true)window.__colOff={legs:true,arms:true};const HH=__dbg.HH;HH.setBrain({tick(){}});if(HH.inv){HH.inv.on=true;HH.inv.reset();}},[OFF,process.argv.includes("--flip")?2:process.argv.includes("--coloff")]);
 await p.evaluate(f=>{window.__fine=f;},FINE);await p.evaluate(v=>{window.__NP=v;},process.argv.includes('--nopops'));if(arg('--flags'))await p.evaluate(fl=>{for(const f of fl.split(','))window[f]=true;},arg('--flags'));
 await p.evaluate(h=>{window.__holdT=h;},arg("--hold"));
 if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});}
 if(process.argv.includes('--pen')){await p.evaluate(`(${require('../anim/sampler.js')})({})`);await p.evaluate(()=>{window.__pen=1;});}
 const res=[];
 for(const [a,z] of RUNS){
  await p.evaluate(([a,z])=>{const HH=__dbg.HH,H=HH.H;HH.spawn('nothing');const P=HH.N[a].p;HH.root.position.copy(P);const f=HH.floorAt(P.x,P.y+.3,P.z,.5);if(f!=null)HH.root.position.y=f;H.floorY=HH.root.position.y;H.node=a;
   const n=HH.N[z].p;HH.root.rotation.y=Math.atan2(n.x-P.x,n.z-P.z);H.face=HH.root.rotation.y;if(window.__holdT){try{window.__props.grab(window.__holdT,HH.bones.LeftHand,{offset:new __dbg.THREE.Vector3(0,.08,.03)});}catch(e){}}HH.goTo(z);window.__rec=[];},[a,z]);
  let done=false,fr=0,tail=0;const shots=[];
  while(!done&&fr<60*40){
   const r=await p.evaluate(()=>{__qa.step(window.__fine?1:2,1/60,window.__pen?(f=>__A.sample(f,1/60,0,'')):undefined);const HH=__dbg.HH,H=HH.H,B=HH.bones,T=__dbg.THREE;const w=o=>o.getWorldPosition(new T.Vector3()).toArray();
    const rec={lad:H.lad?H.lad.phase:null,root:HH.root.position.toArray(),LH:w(B.LeftHand),RH:w(B.RightHand),LT:w(B.LeftToeBase),RT:w(B.RightToeBase),LF:w(B.LeftFoot),RF:w(B.RightFoot),LS:w(B.LeftArm),LK:w(B.LeftLeg),RK:w(B.RightLeg),LU:w(B.LeftUpLeg),LFA:w(B.LeftForeArm),RFA:w(B.RightForeArm),RUNGS:window.__rungsOnce?null:(window.__rungsOnce=1,(window.__ladders||[]).flatMap(l=>l.rungs.map(r=>[r.x,r.y,r.z,r.half]))),DL:(window.__collide&&__collide.depthAt)?(()=>{const q=B.LeftHand.getWorldPosition(new T.Vector3());return __collide.depthAt(q.x,q.y,q.z);})():null,LR:(window.__climb&&__climb.state.act)?Object.fromEntries(Object.entries(__climb.state.act.limb).map(([k,v])=>[k,v.r])):null,HD:w(B.Head),HT:B.HeadTop_End?w(B.HeadTop_End):w(B.Head),HIP:w(B.Hips),LQ:B.LeftLeg.quaternion.toArray(),FW:["Hips","Spine2","Head"].map(n=>(HH.BFWD&&HH.BFWD[n])?HH.BFWD[n].clone().applyQuaternion(B[n].getWorldQuaternion(new T.Quaternion())).toArray().map(v=>+v.toFixed(2)):null),RQ:B.RightLeg.quaternion.toArray(),RU:w(B.RightUpLeg),HF:(()=>{const q=B.Hips.getWorldQuaternion(new T.Quaternion());const v=new T.Vector3(0,0,-1).applyQuaternion(q);return v.toArray();})(),RY:HH.root.rotation.y,RS:w(B.RightArm),HP:w(B.Hips),clip:H.cur&&H.cur.getClip().name,W:window.__climb?window.__climb.weight:0,T:window.__climb&&window.__climb.targets()?Object.fromEntries(Object.entries(window.__climb.targets()).map(([k,v])=>[k,v.toArray()])):null,md:window.__climb&&window.__climb.state.act?window.__climb.state.act.mode:null,PL:(()=>{const l=window.__popLog||[];window.__popLog=[];return l;})(),HQF:(()=>{const q=B.Head.getWorldQuaternion(new T.Quaternion());const f=new T.Vector3(0,0,1).applyQuaternion(q);const u=new T.Vector3(0,1,0).applyQuaternion(q);return [f.y,u.y];})(),TA:window.__climb&&window.__climb.state.act?JSON.stringify(window.__climb.state.act.tadj||null):null,TL:window.__climb&&window.__climb.state.tl?JSON.parse(JSON.stringify(window.__climb.state.tl)):null,PEN:window.__pen?(()=>{const F=__A.out.frames;const x=F[F.length-1];F.length=0;return x?x.pen:null;})():null,BK:window.__holdT&&window.__props.tools[window.__holdT]?window.__props.tools[window.__holdT].parent.name:null,GZ:window.__climb&&window.__climb.state.act?[window.__climb.state.act.gz||0,window.__climb.state.act.nd||0,window.__climb.state.act.y||0]:null};
    window.__rec.push(rec);return {path:H.path.length,lad:!!H.lad,n:window.__rec.length};});
   fr+=2;
   const EVERY=+(arg('--every')||14);
   const RG=arg('--range')?arg('--range').split(',').map(Number):[0,1e9];
   if(SHOTS&&(r.lad||tail>0)&&fr%EVERY===0&&fr>=RG[0]&&fr<=RG[1]&&shots.length<48){shots.push(fr);
    for(const [vi,yaw,pitch,dist] of (arg('--views')?JSON.parse(arg('--views')):[[0,.55,.1,1.7],[1,-.8,.05,1.6]])){const file=`${SHOTS}/${a}-${z}_${String(fr).padStart(5,'0')}_${vi}.png`;
     await p.evaluate(([yaw,pitch,dist])=>{const T=__dbg.THREE;const h=__dbg.HH.bones.Hips.getWorldPosition(new T.Vector3());const c=[h.x,h.y+.1,h.z];const R=window.__camera&&window.__camera.rig;
      if(window.__camera&&window.__camera.dof)window.__camera.dof(false);const yw=window.__wcam?yaw:yaw+__dbg.HH.root.rotation.y+Math.PI;const cam=__qaCamera;cam.position.set(c[0]+Math.sin(yw)*Math.cos(pitch)*dist,c[1]+Math.sin(pitch)*dist,c[2]+Math.cos(yw)*Math.cos(pitch)*dist);cam.lookAt(c[0],c[1],c[2]);cam.updateMatrixWorld();
      // hide whatever stands between the camera and him (walls, beams), keep the hero and the ladders
      const hid=[];const rc=new T.Raycaster();const isHero=o=>{for(let q=o;q;q=q.parent)if(q===__dbg.HH.root)return true;return false;};
      for(const tgt of ['Hips','Head','LeftHand','RightHand','LeftFoot','RightFoot']){const h2=__dbg.HH.bones[tgt].getWorldPosition(new T.Vector3());const dir=h2.clone().sub(cam.position);const L=dir.length();dir.normalize();
       for(let k=0;k<8;k++){rc.set(cam.position,dir);rc.far=L-.12;if(!window.__occ){let q=__dbg.HH.root;while(q.parent)q=q.parent;window.__occ=[];q.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh&&o.geometry&&!isHero(o))window.__occ.push(o);});}
        const hits=[];for(const o of window.__occ){if(!o.visible)continue;try{o.raycast(rc,hits);}catch(e){}}hits.sort((a,b)=>a.distance-b.distance);const hit=hits.find(x=>x.object.visible&&!isHero(x.object)&&!(x.object.material&&x.object.material.customProgramCacheKey&&x.object.material.customProgramCacheKey()==='ropesway')&&!x.object.isPoints&&!x.object.isSprite);if(!hit)break;
        const o=hit.object;if(o.isInstancedMesh&&hit.instanceId!=null){const m=new T.Matrix4();o.getMatrixAt(hit.instanceId,m);const sc=new T.Vector3(),q=new T.Quaternion(),pp=new T.Vector3();m.decompose(pp,q,sc);
          // board ladders (rungs and rails are instanced boards): keep thin ones near the ladder
          if(Math.min(sc.x,sc.y,sc.z)<.08&&Math.max(sc.x,sc.y,sc.z)<.6){hid.push([o,hit.instanceId,m.clone()]);m.compose(pp,q,new T.Vector3(0,0,0));o.setMatrixAt(hit.instanceId,m);o.instanceMatrix.needsUpdate=true;continue;}
          hid.push([o,hit.instanceId,m.clone()]);m.compose(pp,q,new T.Vector3(0,0,0));o.setMatrixAt(hit.instanceId,m);o.instanceMatrix.needsUpdate=true;}
        else{o.visible=false;hid.push([o]);}}}
      window.__hid=hid;
      __qaCamera.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);for(const [o,i,m] of window.__hid){if(i!=null){o.setMatrixAt(i,m);o.instanceMatrix.needsUpdate=true;}else o.visible=true;}},[yaw,pitch,dist]);
     for(let tr=0;tr<4;tr++){await p.locator('canvas').first().screenshot({path:file});if(fs.statSync(file).size>40000)break;await p.evaluate(()=>{__noRender(false);__qaComposer.render();__noRender(true);});await p.waitForTimeout(250);}}}
   if(!r.path&&!r.lad){tail=(typeof tail==='number'?tail:0)+1;if(tail>+(arg('--tail')||0))done=true;}}
  const rec=await p.evaluate(()=>window.__rec);
  // rungs of all ladders
  const R=await p.evaluate(()=>window.__ladders.flatMap(l=>l.rungs.map(r=>({...r,rope:l.rope}))));
  const dR=(q,isFoot)=>{let best=1e9;for(const r of R){const dx=Math.max(0,Math.abs(q[0]-r.x)-r.half);const dy=q[1]-r.y,dz=q[2]-r.z;const d=Math.hypot(dx,dy,dz);if(d<best)best=d;}return best;};
  const st={hand:[],foot:[]};let maxJump=0;
  for(let i=2;i<rec.length;i++){const r=rec[i],q=rec[i-1];if(!r.lad||r.lad==='mount')continue;
   for(const [k,isF] of [['LH',0],['RH',0],['LT',1],['RT',1]]){const v=Math.hypot(...r[k].map((x,j)=>x-q[k][j]))*30;if(v<.08){const d=dR(r[k],isF);if(d<.6)(isF?st.foot:st.hand).push(d);}}
   const acc=Math.hypot(...r.root.map((x,j)=>x-2*q.root[j]+rec[i-2].root[j]));if(acc>maxJump)maxJump=acc;}
  const med=a=>a.length?a.slice().sort((x,y)=>x-y)[a.length>>1]:null;const p90=a=>a.length?a.slice().sort((x,y)=>x-y)[Math.floor(a.length*.9)]:null;
  const ladFrames=rec.filter(r=>r.lad).length;
  const out={run:a+'>'+z,sec:+(ladFrames/30).toFixed(1),done,handStill:st.hand.length,handMedCm:+(med(st.hand)*100).toFixed(1),handP90:+(p90(st.hand)*100).toFixed(1),footStill:st.foot.length,footMedCm:+(med(st.foot)*100).toFixed(1),footP90:+(p90(st.foot)*100).toFixed(1),rootJerkCm:+(maxJump*100).toFixed(1)};
  console.log(JSON.stringify(out));res.push(out);
  {const D=SHOTS||'/tmp/claude-0/clrec';fs.mkdirSync(D,{recursive:true});fs.writeFileSync(D+'/'+a+'-'+z+'.json',JSON.stringify(rec));}
 }
console.log("INV",JSON.stringify(await p.evaluate(()=>__dbg.HH.inv?__dbg.HH.inv.report():null),null,1));
 console.log('errors',errs.slice(0,8));await b.close();})();
