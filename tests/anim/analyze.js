// Turns the per-frame log into a list of issues. Every threshold lives in LIMITS so the numbers are explicit.
const LIMITS={
 dt:1/60,
 // penetration of the skin into solid things, cm (soft = mattress/quilt/pillow, seat = chair/stool top)
 pen:{head:1,handL:1.5,handR:1.5,feet:1,shins:1.5,hips:1.5,arms:1.5,torso:1.5},
 penSoft:3,penSeat:2,penPillow:6, // lying: head/body sinking into pillow and mattress
 jumpCm:2.5,       // a joint moves this much more in one frame than its neighbours' trend (second difference)
 rootJumpCm:1.2,   // same for the root
 yawStepDeg:6,     // root turns more than this in one frame (>360 deg/s)
 hipsRotDeg:9,     // pelvis orientation changes more than this in one frame
 kneeMin:20,       // knee angle (180 = straight) below this is over-folded
 footHeadM:.55,    // a foot closer than this to the head (legs folded up next to the head)
 footUpM:.05,      // foot this far ABOVE the hip joint, along the pelvis axis => leg folded up
 slideCm:2.5,      // planted foot drifting more than this during one contact
 jitterMm:1.5,     // RMS of the high-frequency part of a joint path while seated / idle
 jitterHz:5,       // ... and it must oscillate (direction reversals) at least this often
 turnRateDeg:240,  // heading change of the walking direction per second
 crabDeg:40,       // body facing vs walking direction
 detour:1.35,      // walked length / straight distance for one walk
 // tempo: normal adult values (indoor walking 1.0-1.4 m/s, cadence 1.6-2.0 steps/s; sit down / stand up 1.0-1.8 s;
 // ladder 0.3-0.5 m/s vertical; turning on the spot 180-360 deg/s)
 walkMin:.85,stayMin:20,neckYaw:60,headTilt:70,headHips:70,ankleUp:30,ankleDown:55,toeBend:70,footRoll:30,touchCm:5,gripCm:3.5,propBodyCm:3,supportCm:3,accelMax:.9,decelMax:.9,pauseMax:.6,cadenceMin:1.5,sitMax:2.0,ladderMin:.25,clipScaleMin:.8,
};
const BI={};['Hips','Spine2','Neck','Head','HeadTop_End','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','LeftToe_End','RightUpLeg','RightLeg','RightFoot','RightToeBase','RightToe_End','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand'].forEach((n,i)=>BI[n]=i);
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],len=a=>Math.hypot(a[0],a[1],a[2]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const qrot=(q,v)=>{const [x,y,z,w]=q;const u=[x,y,z];const t=cross(u,v).map(c=>2*c);const c2=cross(u,t);return [v[0]+w*t[0]+c2[0],v[1]+w*t[1]+c2[1],v[2]+w*t[2]+c2[2]];};
const ang=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b)/(len(a)*len(b)+1e-9))))*180/Math.PI;
const wrap=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};
const SOFT=/quilt|mattress|pillow|blanket|bunk|bed|rug/i,SEAT=/chair|stool|bench/i;
function bone(f,n){const i=BI[n]*3;return [f.b[i],f.b[i+1],f.b[i+2]];}
function activity(f){if(f.fl.includes('L'))return 'ladder';if(f.fl.includes('W'))return 'bed swing';if(f.fl.includes('B'))return 'in bed';if(f.fl.includes('Fs'))return 'sitting down';if(f.fl.includes('Fr'))return 'standing up';if(f.fl.includes('S'))return 'seated:'+f.task;if(f.fl.includes('P'))return 'walking';return f.state+':'+f.task;}
function analyze(D,lim=LIMITS){const F=D.frames,names=D.names,GN=D.GN;const iss=[];const T=f=>f*lim.dt;
 const add=(type,i,o)=>iss.push({type,f:F[i].f,i,t:+T(F[i].f).toFixed(2),hour:F[i].hour,act:activity(F[i]),clip:F[i].clip,...o});
 const speed=i=>i>0?len(sub(F[i].root,F[i-1].root))/lim.dt:0;
 // ---- per-frame metrics ----
 const M=F.map((f,i)=>{const hip=bone(f,'Hips'),head=bone(f,'HeadTop_End');const up=qrot(f.hq,[0,1,0]),right=qrot(f.hq,[1,0,0]);const m={};
  for(const s of ['Left','Right']){const U=bone(f,s+'UpLeg'),K=bone(f,s+'Leg'),A=bone(f,s+'Foot'),Tt=bone(f,s+'ToeBase');const th=sub(K,U),sh=sub(A,K);
   const sl=dot(sh,sh)||1e-9,pp=v=>sub(v,sh.map(x=>x*dot(v,sh)/sl)),o=pp(sub(U,K)),t=pp(sub(Tt,A));// a real knee: the hip sits on the calf side of the shin, the toes on the shin side (both measured perpendicular to the shin). No bone axes, facing or mirroring involved; holds for deep folds
   m[s]={knee:180-ang(th,sh),bend:-dot(o,t)/((len(o)*len(t))+1e-9)*Math.min(1,len(t)/.03),footUp:dot(sub(A,U),up),footHead:Math.min(len(sub(A,head)),len(sub(Tt,head)))};}
  return m;});
 // calibrate the natural knee-bend direction from walking frames
 let sgn=0;F.forEach((f,i)=>{if(f.fl.includes('P'))for(const s of ['Left','Right'])if(M[i][s].knee<160)sgn+=Math.sign(M[i][s].bend);});const sgnWalk=Math.sign(sgn)||1;sgn=1;// geometric (hip vs toes around the shin), no calibration; sgnWalk only reported
 // ---- 1. penetration ----
 const pen=[];F.forEach((f,i)=>f.pen.forEach((p,g)=>{if(!p)return;const [cm,ci,pos]=p;const nm=names[ci]||'?';const G=GN[g];if(/ (\d{4,})x/.test(nm)&&+nm.match(/ (\d+)x/)[1]>1200)return;
  let tol=lim.pen[G];
  // on a ladder a palm wrapped round a rung/rail and the ball of the foot on a rung sink a little into it: that is grip, not penetration.
  // Allowed for hands/feet against thin bars (two sizes <= 8 cm: rungs, rails, ropes) or near a known rung, up to lim.gripCm; a shin or arm through it still counts
  if(f.fl.includes('L')&&/^(handL|handR|feet)$/.test(G)){const mm=nm.match(/ (\d+)x(\d+)x(\d+)cm/);const thin=mm&&[+mm[1],+mm[2],+mm[3]].filter(v=>v<=8).length>=2;
   const nearRung=pos&&(D.rungs||[]).some(r=>{const v=[pos[0]-r.c[0],pos[1]-r.c[1],pos[2]-r.c[2]];const t=Math.max(-r.h,Math.min(r.h,v[0]*r.d[0]+v[1]*r.d[1]+v[2]*r.d[2]));return Math.hypot(v[0]-r.d[0]*t,v[1]-r.d[1]*t,v[2]-r.d[2]*t)<.06;});
   if(thin||nearRung)tol=Math.max(tol,lim.gripCm);}if(SOFT.test(nm))tol=Math.max(tol,lim.penSoft);if(SOFT.test(nm)&&(f.fl.includes('B')||f.fl.includes('W'))&&pos&&pos[1]<f.root[1]+.6)tol=Math.max(tol,lim.penPillow);if(SEAT.test(nm)&&(G==='hips'||G==='shins'))tol=Math.max(tol,lim.penSeat);
  if(cm>tol)pen.push({i,G,nm,cm,pos,tol});}));
 // merge into events: same body part + same object, gaps < 0.3 s
 const ev={};for(const q of pen){const k=q.G+'|'+q.nm.replace(/#\d+/,'#');const e=ev[k]&&ev[k][ev[k].length-1];
  if(e&&q.i-e.i1<=18){e.i1=q.i;if(q.cm>e.cm){e.cm=q.cm;e.ip=q.i;e.pos=q.pos;e.nm=q.nm;}e.n++;}else (ev[k]=ev[k]||[]).push({i0:q.i,i1:q.i,ip:q.i,cm:q.cm,pos:q.pos,G:q.G,nm:q.nm,tol:q.tol,n:1});}
 for(const k in ev)for(const e of ev[k])add('penetration',e.ip,{bone:e.G,into:e.nm,value:+e.cm.toFixed(1),unit:'cm',limit:e.tol,dur:+((e.i1-e.i0+1)*lim.dt).toFixed(2),from:F[e.i0].f,to:F[e.i1].f,at:e.pos});
 // ---- 1b. moving things through the body (carried bucket, held tools, opened door, plates): the static colliders above do not see them
 {let ev=null;const flush=()=>{if(ev)add('prop-through-body',ev.ip,{bone:ev.g,into:ev.nm,value:ev.cm,unit:'cm inside',limit:lim.propBodyCm,P:ev.cm>=lim.propBodyCm?1:2,dur:+((ev.i1-ev.i0+1)*lim.dt).toFixed(2),from:F[ev.i0].f,to:F[ev.i1].f,what:ev.nm+' passes through the '+ev.g});ev=null;};
  F.forEach((f,i)=>{const d=f.dp;if(!d){if(ev&&i-ev.i1>18)flush();return;}const [nm,g,cm]=d;if(ev&&(ev.nm!==nm||ev.g!==g)&&i-ev.i1>18)flush();if(ev&&ev.nm===nm&&ev.g===g){ev.i1=i;if(cm>ev.cm){ev.cm=cm;ev.ip=i;}}else{flush();ev={nm,g,cm,i0:i,i1:i,ip:i};}});flush();}
 // ---- 2. jumps (second difference spikes) ----
 const J=['Hips','Head','HeadTop_End','LeftHand','RightHand','LeftFoot','RightFoot','LeftLeg','RightLeg'];
 for(let i=2;i<F.length;i++){if(F[i].tag!==F[i-1].tag)continue;
  for(const n of J){const a=bone(F[i],n),b=bone(F[i-1],n),c=bone(F[i-2],n);const d2=len([a[0]-2*b[0]+c[0],a[1]-2*b[1]+c[1],a[2]-2*b[2]+c[2]])*100;
   if(d2>lim.jumpCm)add('jump',i,{bone:n,value:+d2.toFixed(1),unit:'cm/frame²',limit:lim.jumpCm,step:+(len(sub(a,b))*100).toFixed(1)});}
  const r2=len([F[i].root[0]-2*F[i-1].root[0]+F[i-2].root[0],F[i].root[1]-2*F[i-1].root[1]+F[i-2].root[1],F[i].root[2]-2*F[i-1].root[2]+F[i-2].root[2]])*100;
  if(r2>lim.rootJumpCm)add('jump',i,{bone:'root',value:+r2.toFixed(1),unit:'cm/frame²',limit:lim.rootJumpCm});
  const dy=Math.abs(wrap(F[i].ry-F[i-1].ry))*180/Math.PI;if(dy>lim.yawStepDeg)add('snap-turn',i,{bone:'root',value:+dy.toFixed(1),unit:'deg/frame',limit:lim.yawStepDeg});
  const qa=F[i].hq,qb=F[i-1].hq;const dq=2*Math.acos(Math.min(1,Math.abs(qa[0]*qb[0]+qa[1]*qb[1]+qa[2]*qb[2]+qa[3]*qb[3])))*180/Math.PI;if(dq>lim.hipsRotDeg)add('jump',i,{bone:'Hips rotation',value:+dq.toFixed(1),unit:'deg/frame',limit:lim.hipsRotDeg});}
 // ---- 3. joints ----
 F.forEach((f,i)=>{for(const s of ['Left','Right']){const m=M[i][s];
  if(m.knee<lim.kneeMin)add('joint',i,{bone:s+'Leg',value:+m.knee.toFixed(0),unit:'deg knee',limit:lim.kneeMin,what:'knee folded too far'});
  // deep squats (interior < 60 deg) make the side test ill-conditioned: there only a flat fold counts (Pose: interior < 20 deg or ankle within 10 cm of the hip)
  {const U=bone(F[i],s+'UpLeg'),A=bone(F[i],s+'Foot');const ah=len(sub(A,U))*100;if(m.knee<20||ah<10)add('joint',i,{bone:s+'Leg',value:+(180-m.knee).toFixed(0),unit:'deg folded flat',limit:160,what:'leg folded flat (knee interior '+m.knee.toFixed(0)+' deg, ankle '+ah.toFixed(0)+' cm from the hip)'});}
  if(m.knee>=60&&m.knee<150&&Math.sign(m.bend)!==sgn&&Math.abs(m.bend)>.25)add('joint',i,{bone:s+'Leg',value:+(180-m.knee).toFixed(0),unit:'deg bent the wrong way',limit:0,what:'knee bends forward (broken leg)'});
  if(m.footHead<lim.footHeadM&&!f.fl.includes('B'))add('joint',i,{bone:s+'Foot',value:+(m.footHead*100).toFixed(0),unit:'cm from head',limit:lim.footHeadM*100,what:'foot next to the head'});
  if(m.footUp>lim.footUpM)add('joint',i,{bone:s+'Foot',value:+(m.footUp*100).toFixed(0),unit:'cm along body above hip',limit:lim.footUpM*100,what:'leg folded up past the hip'});}});
 // ---- 4. foot sliding while planted ----
 for(const [s,fi,ti,gi] of [['Left','LeftFoot','LeftToeBase',0],['Right','RightFoot','RightToeBase',2]]){let c=null;
  for(let i=1;i<F.length;i++){const f=F[i];const a=bone(f,fi),tt=bone(f,ti);const g=f.gnd[gi]??f.gnd[gi+1];const vz=Math.abs(a[1]-bone(F[i-1],fi)[1])/lim.dt;
   const planted=g!=null&&Math.min(a[1]-g,tt[1]-g)<.03&&vz<.12&&!f.fl.includes('L')&&!f.fl.includes('B')&&!f.fl.includes('W');
   if(planted){if(!c)c={i0:i,p0:tt,max:0,im:i};const d=Math.hypot(tt[0]-c.p0[0],tt[2]-c.p0[2]);if(d>c.max){c.max=d;c.im=i;}}
   else if(c){if(i-c.i0>=6&&c.max*100>lim.slideCm)add('foot-slide',c.im,{bone:s+'Foot',value:+(c.max*100).toFixed(1),unit:'cm drift while planted',limit:lim.slideCm,dur:+((i-c.i0)*lim.dt).toFixed(2),from:F[c.i0].f,to:F[i-1].f});c=null;}}}
 // ---- 5. jitter while seated / idle / working in place ----
 const W=30;const JB=['HeadTop_End','LeftHand','RightHand','LeftFoot','RightFoot','LeftLeg','RightLeg'];
 for(let i0=0;i0+W<F.length;i0+=W){const seg=F.slice(i0,i0+W);if(seg.some(f=>f.fl.includes('P')||f.fl.includes('L')||f.fl.includes('W')||f.tag!==seg[0].tag))continue;
  const still=seg.every((f,k)=>k===0||len(sub(f.root,seg[k-1].root))<.002);if(!still)continue;
  for(const n of JB){let ss=0,c=0;for(let k=3;k<W-3;k++){const p=bone(seg[k],n);let m=[0,0,0];for(let j=-3;j<=3;j++){const q=bone(seg[k+j],n);m[0]+=q[0]/7;m[1]+=q[1]/7;m[2]+=q[2]/7;}const r=len(sub(p,m));ss+=r*r;c++;}
   const rms=Math.sqrt(ss/c)*1000;
   // real jitter oscillates: count direction reversals of the per-frame step (steps > 0.25 mm) on the main axis
   let rev=0;for(const ax of [0,1,2]){let prev=0,r=0;for(let k=1;k<W;k++){const d=bone(seg[k],n)[ax]-bone(seg[k-1],n)[ax];if(Math.abs(d)<.00025)continue;const sg=Math.sign(d);if(prev&&sg!==prev)r++;prev=sg;}rev=Math.max(rev,r);}
   const hz=rev/2/(W*lim.dt);
   if(rms>lim.jitterMm&&hz>=lim.jitterHz)add('jitter',i0+W/2,{bone:n,value:+rms.toFixed(1),unit:'mm RMS (7-frame high-pass)',hz:+hz.toFixed(1),limit:lim.jitterMm,dur:W*lim.dt,from:seg[0].f,to:seg[W-1].f});}}
 // ---- 6. walks: sharp turns, crab-walking, detours ----
 const walks=[];let w=null;for(let i=1;i<F.length;i++){const mv=F[i].fl.includes('P')&&!F[i].fl.includes('L');if(mv&&!w)w={i0:i};if(!mv&&w){w.i1=i-1;walks.push(w);w=null;}}
 for(const wk of walks){const pts=F.slice(wk.i0,wk.i1+1).map(f=>f.root);if(pts.length<10)continue;let L=0;for(let k=1;k<pts.length;k++)L+=Math.hypot(pts[k][0]-pts[k-1][0],pts[k][2]-pts[k-1][2]);
  const Dd=Math.hypot(pts[pts.length-1][0]-pts[0][0],pts[pts.length-1][2]-pts[0][2]);const dy=Math.abs(pts[pts.length-1][1]-pts[0][1]);
  wk.L=L;wk.D=Dd;wk.from=F[wk.i0].node;wk.to=F[wk.i1].node;wk.task=F[wk.i1].task;wk.pts=pts.filter((_,k)=>k%3===0).map(p=>[+p[0].toFixed(3),+p[2].toFixed(3),+p[1].toFixed(2)]);
  if(Dd>.8&&dy<.5&&L/Dd>lim.detour)add('detour',wk.i0,{bone:'root',value:+(L/Dd).toFixed(2),unit:'walked/straight',limit:lim.detour,walked:+L.toFixed(2),straight:+Dd.toFixed(2),dur:+((wk.i1-wk.i0)*lim.dt).toFixed(2),from:F[wk.i0].f,to:F[wk.i1].f,task:wk.task});
  // initial direction vs straight line to the goal
  const k0=pts.findIndex(p=>Math.hypot(p[0]-pts[0][0],p[2]-pts[0][2])>.35);if(k0>0&&Dd>.8){const a1=Math.atan2(pts[k0][0]-pts[0][0],pts[k0][2]-pts[0][2]),a2=Math.atan2(pts[pts.length-1][0]-pts[0][0],pts[pts.length-1][2]-pts[0][2]);const da=Math.abs(wrap(a1-a2))*180/Math.PI;
   if(da>45&&dy<.5)add('detour',wk.i0+k0,{bone:'root',value:+da.toFixed(0),unit:'deg first steps off the straight line to the goal',limit:45,from:F[wk.i0].f,to:F[wk.i1].f,task:wk.task});}
  // heading rate and crab walking
  for(let k=wk.i0+6;k<=wk.i1-6;k++){const a=F[k-6].root,b=F[k].root,c=F[k+6].root;const v1=[b[0]-a[0],b[2]-a[2]],v2=[c[0]-b[0],c[2]-b[2]];if(Math.hypot(...v1)<.04||Math.hypot(...v2)<.04)continue;
   const h1=Math.atan2(v1[0],v1[1]),h2=Math.atan2(v2[0],v2[1]);const rate=Math.abs(wrap(h2-h1))*180/Math.PI/(6*lim.dt);
   if(rate>lim.turnRateDeg)add('sharp-turn',k,{bone:'root',value:+rate.toFixed(0),unit:'deg/s heading change while walking',limit:lim.turnRateDeg});
   const crab=Math.abs(wrap(F[k].ry-h2))*180/Math.PI;if(crab>lim.crabDeg)add('crab-walk',k,{bone:'root',value:+crab.toFixed(0),unit:'deg between facing and walking direction',limit:lim.crabDeg});}}
 // ---- 7. tempo (slow motion) ----
 const tempo={walks:[],sit:[],stand:[],swing:[],ladder:[],clipScale:{}};
 for(const wk of walks){const n=wk.i1-wk.i0;if(n<40)continue;let L=0;for(let k=wk.i0+1;k<=wk.i1;k++)L+=Math.hypot(F[k].root[0]-F[k-1].root[0],F[k].root[2]-F[k-1].root[2]);
  const v=L/(n*lim.dt);// cadence: count foot-height minima (contacts) of each foot
  let steps=0;for(const fi of [BI.LeftFoot,BI.RightFoot]){let prevDown=false;for(let k=wk.i0+2;k<=wk.i1;k++){const y=F[k].b[fi*3+1]-F[k].root[1],y1=F[k-1].b[fi*3+1]-F[k-1].root[1],y2=F[k-2].b[fi*3+1]-F[k-2].root[1];if(y1<y&&y1<=y2&&y1<.13){steps++;}}}
  const cad=steps/(n*lim.dt);tempo.walks.push({f:F[wk.i0].f,task:wk.task,speed:+v.toFixed(2),cadence:+cad.toFixed(2),dur:+(n*lim.dt).toFixed(1)});
  if(v<lim.walkMin)add('slow',wk.i0+(n>>1),{bone:'root',value:+v.toFixed(2),unit:'m/s walking speed',limit:lim.walkMin,what:'walk slower than a normal person ('+cad.toFixed(2)+' steps/s)'});}
 const spans=(flag,arr)=>{let s0=-1;for(let i=0;i<F.length;i++){const on=F[i].fl.includes(flag);if(on&&s0<0)s0=i;if(!on&&s0>=0){arr.push({f:F[s0].f,dur:+((i-s0)*lim.dt).toFixed(2),task:F[s0].task,clip:F[s0].clip});s0=-1;}}};
 spans('Fs',tempo.sit);spans('Fr',tempo.stand);spans('W',tempo.swing);
 for(const s of tempo.sit)if(s.dur>lim.sitMax)add('slow',F.findIndex(f=>f.f===s.f),{bone:'Hips',value:s.dur,unit:'s to sit down',limit:lim.sitMax,what:'sitting down too slow'});
 for(const s of tempo.stand)if(s.dur>lim.sitMax)add('slow',F.findIndex(f=>f.f===s.f),{bone:'Hips',value:s.dur,unit:'s to stand up',limit:lim.sitMax,what:'standing up too slow'});
 {let s0=-1;for(let i=0;i<F.length;i++){const on=F[i].fl.includes('L');if(on&&s0<0)s0=i;if(!on&&s0>=0){const dy=Math.abs(F[i-1].root[1]-F[s0].root[1]),dur=(i-s0)*lim.dt;if(dy>.5){const v=dy/dur;tempo.ladder.push({f:F[s0].f,dy:+dy.toFixed(2),dur:+dur.toFixed(2),v:+v.toFixed(2)});if(v<lim.ladderMin)add('slow',s0,{bone:'root',value:+v.toFixed(2),unit:'m/s on the ladder',limit:lim.ladderMin,what:'ladder too slow'});}s0=-1;}}}
 for(const f of F){if(!f.clip)continue;const c=tempo.clipScale[f.clip]||(tempo.clipScale[f.clip]={n:0,sum:0,min:9});c.n++;c.sum+=f.ts;c.min=Math.min(c.min,f.ts);}
 for(const k in tempo.clipScale){const c=tempo.clipScale[k];c.avg=+(c.sum/c.n).toFixed(2);c.sec=+(c.n*lim.dt).toFixed(1);delete c.sum;c.min=+c.min.toFixed(2);}
 for(const k in tempo.clipScale){const c=tempo.clipScale[k];if(c.sec>2&&c.avg<lim.clipScaleMin&&c.avg>0){const i=F.findIndex(f=>f.clip===k);add('slow',i,{bone:'clip '+k,value:c.avg,unit:'x playback speed (average)',limit:lim.clipScaleMin,what:'animation played slowed down for '+c.sec+' s in total'});}}
 // ---- 8. robot / slow-motion transitions: how long it takes to get going and to stop, and dead pauses between phases ----
 // (a person reaches walking pace in ~2 steps, 0.5-0.8 s, stops in ~0.5-0.7 s, and chains actions with < 0.4 s of standing)
 const spd=F.map((f,i)=>{const a=F[Math.max(0,i-3)].root,b=F[Math.min(F.length-1,i+3)].root;const n=Math.min(F.length-1,i+3)-Math.max(0,i-3);return n?Math.hypot(b[0]-a[0],b[2]-a[2])/(n*lim.dt):0;});
 tempo.trans=[];
 for(const wk of walks){const n=wk.i1-wk.i0;if(n<40)continue;const ss=spd.slice(wk.i0,wk.i1+1).slice().sort((a,b)=>a-b);const cruise=ss[Math.floor(ss.length*.75)];if(cruise<.15)continue;
  let k=wk.i0;while(k<wk.i1&&spd[k]<.8*cruise)k++;const acc=(k-wk.i0)*lim.dt;
  let e=wk.i1;while(e>wk.i0&&spd[e]<.8*cruise)e--;const dec=(wk.i1-e)*lim.dt;
  const prev=activity(F[Math.max(0,wk.i0-1)]),next=activity(F[Math.min(F.length-1,wk.i1+1)]);
  tempo.trans.push({f:F[wk.i0].f,task:wk.task,cruise:+cruise.toFixed(2),accel:+acc.toFixed(2),decel:+dec.toFixed(2),from:prev,to:next});
  if(acc>lim.accelMax)add('robot',wk.i0,{bone:'root',value:+acc.toFixed(2),unit:'s to reach walking pace',limit:lim.accelMax,what:'slow start of the walk ('+prev+' -> walk, cruise '+cruise.toFixed(2)+' m/s)',from:F[wk.i0].f,to:F[k].f});
  if(dec>lim.decelMax)add('robot',e,{bone:'root',value:+dec.toFixed(2),unit:'s braking before the stop',limit:lim.decelMax,what:'creeping to the stop (walk -> '+next+', cruise '+cruise.toFixed(2)+' m/s)',from:F[e].f,to:F[wk.i1].f});}
 // dead time at a junction: between one phase ending and the next starting, the root does not move and nothing is being done
 const phase=f=>f.fl.includes('L')?'ladder':f.fl.includes('P')?'walk':f.fl.includes('Fs')||f.fl.includes('Fr')||f.fl.includes('W')?'trans':f.state==='work'||f.fl.includes('S')||f.fl.includes('B')?'act':'idle';
 {let i=0;while(i<F.length){const ph=phase(F[i]);let j=i;while(j<F.length&&phase(F[j])===ph)j++;
   if(ph==='idle'&&i>0&&j<F.length){const before=phase(F[i-1]),after=phase(F[j]);const d=(j-i)*lim.dt;
    if(before!==after||before==='walk'||before==='ladder'){if(d>lim.pauseMax&&d<20)add('robot',i,{bone:'root',value:+d.toFixed(2),unit:'s standing still between phases',limit:lim.pauseMax,what:'pause '+before+' -> '+after+' ('+F[j].task+')',from:F[i].f,to:F[j-1].f});}}
   i=j;}}
 // ladder entry/exit: speed jump between walking and climbing
 {for(let i=1;i<F.length;i++){const a=F[i-1].fl.includes('L'),b=F[i].fl.includes('L');if(a===b)continue;
   const w=(i0,i1)=>{let s=0,c=0;for(let k=Math.max(1,i0);k<Math.min(F.length,i1);k++){const p=F[k].root,q=F[k-1].root;s+=Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])/lim.dt;c++;}return c?s/c:0;};
   const before=w(i-30,i),after=w(i,i+30);tempo.trans.push({f:F[i].f,ladder:b?'enter':'exit',before:+before.toFixed(2),after:+after.toFixed(2)});
   if(Math.max(before,after)>.05&&Math.max(before,after)/Math.max(.02,Math.min(before,after))>2.5)add('robot',i,{bone:'root',value:+(Math.max(before,after)/Math.max(.02,Math.min(before,after))).toFixed(1),unit:'x speed change at the ladder ('+before.toFixed(2)+' -> '+after.toFixed(2)+' m/s)',limit:2.5,what:'ladder '+(b?'entry':'exit')+': '+(after>before?'speeds up':'slows down')+' abruptly'});}}
 // ---- 9b. posture: torso lean (hips -> neck) forward/back and sideways, from positions only (no bone axes).
 // Walking or standing upright should not hunch or tilt; tasks that bend (sweep, chop, wash ...) get a looser forward limit.
 {const BEND=/sweep|chop|wash|dishes|fetchwater|dumpwater|water|saw|hammer|sharpen|fix_|stoke|firewood|cook|pot|store|craft|hatch|trip|eat|tea/;let ev=null;
  const flush=()=>{if(ev&&ev.i1-ev.i0>=12)add('posture',ev.ip,{bone:'Spine',value:ev.v,unit:'deg '+ev.k,limit:ev.lim,dur:+((ev.i1-ev.i0+1)*lim.dt).toFixed(2),from:F[ev.i0].f,to:F[ev.i1].f,what:ev.k+' lean while '+ev.a});ev=null;};
  F.forEach((f,i)=>{if(f.fl.includes('B')||f.fl.includes('S')||f.fl.includes('L')||f.fl.includes('W')||f.fl.includes('F')||f.fl.includes('T')){flush();return;}
   const hp=bone(f,'Hips'),nk=bone(f,'Neck'),lt=sub(bone(f,'LeftUpLeg'),bone(f,'RightUpLeg'));const v=sub(nk,hp);const L=len(v)||1;
   const ln=len(lt)||1,side=Math.asin(Math.max(-1,Math.min(1,dot(v,lt)/(L*ln))))*180/Math.PI;const fwd=Math.acos(Math.max(-1,Math.min(1,v[1]/L)))*180/Math.PI;
   const walk=f.fl.includes('P');const a=walk?'walking':f.task||f.state;const lf=walk?22:BEND.test(String(f.task))?70:30,ls=walk?12:18;
   let k=null,x=0,l=0;if(fwd>lf){k='forward/back';x=fwd;l=lf;}else if(Math.abs(side)>ls){k='sideways';x=Math.abs(side);l=ls;}
   if(!k){if(ev&&i-ev.i1>6)flush();return;}x=+x.toFixed(0);if(ev&&ev.k===k){ev.i1=i;if(x>ev.v){ev.v=x;ev.ip=i;}}else{flush();ev={k,v:x,lim:l,i0:i,i1:i,ip:i,a};}});flush();}
 // ---- 10. anatomy: owl head, ankles/toes, feet rolled over; hands/feet on real ladder rungs; objects moved without touching ----
 const n3=a=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];},angd=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(n3(a),n3(b)))))*180/Math.PI;
 const runs=(test,minN,cb)=>{let s0=-1,best=-1,bv=0;for(let i=0;i<=F.length;i++){const v=i<F.length?test(i):null;if(v!=null){if(s0<0){s0=i;bv=-1e9;}const a=Math.abs(v);if(a>bv){bv=a;best=i;}}else if(s0>=0){if(i-s0>=minN)cb(s0,i-1,best,bv);s0=-1;}}};
 tempo.anatomy={};
 if(F[0].q){const QI={Spine2:0,Neck:1,Head:2,LeftFoot:3,RightFoot:4,LeftToeBase:5,RightToeBase:6};const Q=(f,n)=>f.q.slice(QI[n]*4,QI[n]*4+4);const qi=q=>[-q[0],-q[1],-q[2],q[3]];
  const fw=f=>[Math.sin(f.ry),0,Math.cos(f.ry)],rt=f=>[Math.cos(f.ry),0,-Math.sin(f.ry)],up=()=>[0,1,0];
  const cal=F.filter((f,i)=>i%7===0&&f.fl==='P'&&!f.fl.includes('L'));// walking frames: body faces where he goes
  const loc=(get,wv)=>{let a=[0,0,0];for(const f of cal){const v=qrot(qi(get(f)),wv(f));a=[a[0]+v[0],a[1]+v[1],a[2]+v[2]];}return n3(a);};
  const aH=loc(f=>Q(f,'Head'),fw),aC=loc(f=>Q(f,'Spine2'),fw),uC=loc(f=>Q(f,'Spine2'),up),aP=loc(f=>f.hq,fw),uP=loc(f=>f.hq,up);
  const yaw=(qa,a,qb,b,ub)=>{const h=qrot(qa,a),c=qrot(qb,b),u=n3(qrot(qb,ub));const pr=v=>{const d=dot(v,u);return [v[0]-u[0]*d,v[1]-u[1]*d,v[2]-u[2]*d];};const hp=pr(h),cp=pr(c);const sg=dot(cross(cp,hp),u)>=0?1:-1;return sg*angd(hp,cp);};
  const neck=F.map(f=>yaw(Q(f,'Head'),aH,Q(f,'Spine2'),aC,uC)),body=F.map(f=>/[WBST]/.test(f.fl)||qrot(f.hq,uP)[1]<.85||qrot(Q(f,'Spine2'),uC)[1]<.7?0:yaw(Q(f,'Head'),aH,f.hq,aP,uP));
  const uH=loc(f=>Q(f,'Head'),up);const tilt=F.map(f=>angd(qrot(Q(f,'Head'),uH),qrot(Q(f,'Spine2'),uC)));
  runs(i=>tilt[i]>lim.headTilt?tilt[i]:null,2,(a,b,i,v)=>add('owl-head',i,{bone:'Head',value:+v.toFixed(0),unit:'° head tipped vs chest (nod/side bend)',limit:lim.headTilt,what:'head bent further than a neck can',from:F[a].f,to:F[b].f,dur:+((b-a+1)*lim.dt).toFixed(2)}));
  const pct=(a,p)=>{const b=a.map(Math.abs).sort((x,y)=>x-y);return +b[Math.floor((b.length-1)*p)].toFixed(1);};
  tempo.anatomy.neckYaw={p50:pct(neck,.5),p99:pct(neck,.99),max:pct(neck,1)};tempo.anatomy.headVsHips={p50:pct(body,.5),p99:pct(body,.99),max:pct(body,1)};
  runs(i=>tilt[i]<50&&Math.abs(neck[i])>lim.neckYaw?neck[i]:null,4,(a,b,i,v)=>add('owl-head',i,{bone:'Head',value:+v.toFixed(0),unit:'° head turned vs chest',limit:lim.neckYaw,what:'head twists further than a neck can',from:F[a].f,to:F[b].f,dur:+((b-a+1)*lim.dt).toFixed(2)}));
  runs(i=>tilt[i]<50&&Math.abs(body[i])>lim.headHips?body[i]:null,4,(a,b,i,v)=>add('owl-head',i,{bone:'Head',value:+v.toFixed(0),unit:'° head turned vs pelvis',limit:lim.headHips,what:'head turned round past the shoulder (owl)',from:F[a].f,to:F[b].f,dur:+((b-a+1)*lim.dt).toFixed(2)}));
  // feet: ankle angle (shin vs foot) against his own neutral, toe bend, roll of a planted foot
  for(const sd of ['Left','Right']){const ank=F.map(f=>angd(sub(bone(f,sd+'Foot'),bone(f,sd+'Leg')),sub(bone(f,sd+'ToeBase'),bone(f,sd+'Foot'))));
   const toe=F.map(f=>angd(sub(bone(f,sd+'ToeBase'),bone(f,sd+'Foot')),sub(bone(f,sd+'Toe_End'),bone(f,sd+'ToeBase'))));
   const c=F.map((f,i)=>i).filter(i=>F[i].fl==='P'||F[i].fl==='').map(i=>ank[i]).sort((x,y)=>x-y);const a0=c.length?c[c.length>>1]:90;
   const aS=loc(f=>Q(f,sd+'Foot'),rt);const gi=sd==='Left'?1:3,ti=BI[sd+'ToeBase'];
   const planted=i=>{const f=F[i];if(/[LWBS]/.test(f.fl)||i<1)return false;const t=bone(f,sd+'ToeBase'),g=f.gnd[gi];if(g==null||t[1]-g>.07)return false;return len(sub(t,bone(F[i-1],sd+'ToeBase')))/lim.dt<.15;};
   const roll=F.map((f,i)=>planted(i)?Math.asin(Math.max(-1,Math.min(1,qrot(Q(f,sd+'Foot'),aS)[1])))*180/Math.PI:null);
   tempo.anatomy[sd+'Ankle']={neutral:+a0.toFixed(1)};
   runs(i=>/[LWB]/.test(F[i].fl)?null:ank[i]-a0>lim.ankleUp?ank[i]-a0:null,3,(a,b,i)=>add('foot-bend',i,{bone:sd+'Foot',value:+(ank[i]-a0).toFixed(0),unit:'° foot bent up past neutral',limit:lim.ankleUp,what:'ankle bent up further than a person can',from:F[a].f,to:F[b].f}));
   runs(i=>/[LWB]/.test(F[i].fl)?null:a0-ank[i]>lim.ankleDown?a0-ank[i]:null,3,(a,b,i)=>add('foot-bend',i,{bone:sd+'Foot',value:+(a0-ank[i]).toFixed(0),unit:'° foot pointed down past neutral',limit:lim.ankleDown,what:'ankle pointed further than a person can',from:F[a].f,to:F[b].f}));
   runs(i=>toe[i]>lim.toeBend?toe[i]:null,3,(a,b,i)=>add('foot-bend',i,{bone:sd+'ToeBase',value:+toe[i].toFixed(0),unit:'° toes bent',limit:lim.toeBend,what:'toes folded',from:F[a].f,to:F[b].f}));
   runs(i=>roll[i]!=null&&Math.abs(roll[i])>lim.footRoll?roll[i]:null,3,(a,b,i,v)=>add('foot-bend',i,{bone:sd+'Foot',value:+v.toFixed(0),unit:'° planted foot rolled onto its edge',limit:lim.footRoll,what:'foot twisted over on the floor',from:F[a].f,to:F[b].f}));}
 }
 // ladders: palm and ball of the foot vs the nearest real rung, on frames where that limb holds still (gripping / standing)
 if(D.rungs&&D.rungs.length){const R=D.rungs;const dseg=(p,r)=>{const c=r.c,d=r.d;const v=sub(p,c);let t=dot(v,d);t=Math.max(-r.h,Math.min(r.h,t));return len(sub(v,[d[0]*t,d[1]*t,d[2]*t]));};
  const near=p=>{let m=9;for(const r of R){if(Math.abs(r.c[1]-p[1])>.6||Math.abs(r.c[0]-p[0])>1||Math.abs(r.c[2]-p[2])>1)continue;const d=dseg(p,r);if(d<m)m=d;}return m;};
  const palm=(f,sd)=>{const h=bone(f,sd+'Hand'),a=bone(f,sd+'ForeArm');const v=n3(sub(h,a));return [h[0]+v[0]*.07,h[1]+v[1]*.07,h[2]+v[2]*.07];};
  const LIMB=[['LeftHand',f=>palm(f,'Left'),.09],['RightHand',f=>palm(f,'Right'),.09],['LeftFoot',f=>bone(f,'LeftToeBase'),.09],['RightFoot',f=>bone(f,'RightToeBase'),.09]];
  tempo.ladderGrip=[];let s0=-1;
  for(let i=0;i<=F.length;i++){const on=i<F.length&&F[i].fl.includes('L')&&/^43[57]$/.test(String(F[i].clip));if(on&&s0<0)s0=i;if(!on&&s0>=0){const i1=i-1;if(i1-s0>30){
     const row={f:F[s0].f,dur:+((i1-s0)*lim.dt).toFixed(1)};
     for(const [nm,pt,tol] of LIMB){const ds=[];for(let k=s0+2;k<=i1;k++){const p=pt(F[k]),q=pt(F[k-2]);if(len(sub(p,q))/(2*lim.dt)<.12)ds.push(near(p));}
      ds.sort((x,y)=>x-y);const med=ds.length?ds[ds.length>>1]:null;row[nm]=med==null?'never still':+(med*100).toFixed(1);
      if(med!=null&&med<5&&med>tol)add('ladder-grip',s0+((i1-s0)>>1),{bone:nm,value:+(med*100).toFixed(1),unit:'cm from the nearest rung while holding still',limit:tol*100,what:nm.includes('Hand')?'hand grips air, not the rung':'foot stands on air, not on a rung',from:F[s0].f,to:F[i1].f,dur:row.dur,still:ds.length});
      if(ds.length<.1*(i1-s0))add('ladder-grip',s0,{bone:nm,value:ds.length,unit:'still frames on the whole climb',limit:Math.round(.1*(i1-s0)),what:nm+' never rests on a rung (slides with the canned clip)',from:F[s0].f,to:F[i1].f,dur:row.dur});}
     tempo.ladderGrip.push(row);}s0=-1;}}}
 // contactless: something moves near him (lid, door, bolt, oven door, bucket...) while neither palm is on it
 if(D.mov){const ambient=new Set(D.mov.map((m,id)=>m[1]>F.length*.1?id:-1));const ev={};
  F.forEach((f,i)=>{if(i<30)return;for(const [id,d] of f.mv||[]){if(f.hfree&&/^Group$|hatch/.test(D.mov[id][0]))continue;if(ambient.has(id))continue;let e=ev[id]&&ev[id][ev[id].length-1];if(!e||i-e.i1>12){e={i0:i,i1:i,d:[]};(ev[id]=ev[id]||[]).push(e);}e.i1=i;e.d.push(d);}});
  tempo.touch=[];for(const id in ev)for(const e of ev[id]){if(e.d.length<3)continue;const s2=e.d.slice().sort((a,b)=>a-b);const med=s2[s2.length>>1],mn=s2[0];const nm=D.mov[id][0];
   tempo.touch.push({obj:nm,at:D.mov[id][2],f:F[e.i0].f,task:F[e.i0].task,frames:e.d.length,medCm:med,minCm:mn});
   if(mn>150||/^PlaneGeometry/.test(nm))continue;// never within 1.5 m of a palm: something the game moves by itself (shutters, curtains), not his interaction
   if(med>lim.touchCm)add('no-touch',e.i0,{bone:'hands',into:nm,value:med,unit:'cm from the nearer palm while it moves (median)',limit:lim.touchCm,what:'moves without being touched ('+F[e.i0].task+')',minCm:mn,from:F[e.i0].f,to:F[e.i1].f,dur:+((e.i1-e.i0+1)*lim.dt).toFixed(2)});}}
 // support: lying, every part rests on the mattress / floor; sitting, the pelvis on the seat (and feet down unless he dangles them)
 {const gi=n=>GN.indexOf(n);const need=f=>f.fl.includes('B')?['head','hips','torso','shins','feet']:f.task==='ledge'?['hips']:['hips','feet'];
  for(const G of ['head','hips','torso','shins','feet']){const g=gi(G);if(g<0)continue;
   runs(i=>{const f=F[i];if(!f.sup||i<30||F[i].f<30||/[WT]/.test(f.fl)||!need(f).includes(G))return null;return f.sup[g]>=lim.supportCm?f.sup[g]:null;},30,(a,b,i,v)=>add('unsupported',i,{bone:G,value:v,unit:'cm gap under it ('+(F[i].fl.includes('B')?'lying':'sitting')+')',limit:lim.supportCm,what:G+' hangs in the air instead of resting on the bed/seat/floor',from:F[a].f,to:F[b].f,dur:+((b-a+1)*lim.dt).toFixed(2)}));}}
 // standing: at least one foot on the floor (rule 3.1): both toes > 4 cm above whatever is under them while not walking/climbing/seated
 // the ToeBase joint of a planted boot sits ~7 cm above the floor (boot sole + toe joint): calibrate that rest height per hero (10th percentile
 // of the lower toe over all standing frames) and measure the gap above it, so a normal stance is 0
 {const toeH=f=>{const g1=f.gnd[1],g3=f.gnd[3];if(g1==null||g3==null)return null;return Math.min(bone(f,'LeftToeBase')[1]-g1,bone(f,'RightToeBase')[1]-g3);};
  const hs=F.filter(f=>f.fl==='').map(toeH).filter(v=>v!=null).sort((a,b)=>a-b);const toe0=hs.length>100?Math.max(0,Math.min(.1,hs[hs.length*.1|0])):0;tempo.toeRest=+(toe0*100).toFixed(1);
  runs(i=>{const f=F[i];if(f.fl!==''||i<1)return null;const t=toeH(f);if(t==null)return null;const m=t-toe0;return m>.04?+(m*100).toFixed(1):null;},20,
   (a,b,i,v)=>add('unsupported',i,{bone:'feet',value:v,unit:'cm both feet above the floor (standing, above the planted-boot rest height)',limit:4,what:'stands on air',from:F[a].f,to:F[b].f,dur:+((b-a+1)*lim.dt).toFixed(2)}));}
 // held tools: the palm holding it should be on it (< 5 cm from the tool's mesh) the whole time it is held
 {const ev={};F.forEach((f,i)=>{for(const [nm,k,d] of f.grip||[]){const key=nm+'|'+k;let e=ev[key]&&ev[key][ev[key].length-1];if(!e||i-e.i1>3){e={i0:i,i1:i,d:[]};(ev[key]=ev[key]||[]).push(e);}e.i1=i;e.d.push(d);}});
  tempo.grip=[];for(const key in ev)for(const e of ev[key]){if(e.d.length<10)continue;const s2=e.d.slice().sort((a,b)=>a-b);const med=s2[s2.length>>1];const [nm,k]=key.split('|');
   tempo.grip.push({tool:nm,hand:k==='0'?'L':'R',f:F[e.i0].f,frames:e.d.length,medCm:med,maxCm:s2[s2.length-1]});
   if(med>lim.touchCm)add('grip',e.i0,{bone:(k==='0'?'Left':'Right')+'Hand',into:nm,value:med,unit:'cm from the palm to the held tool (median)',limit:lim.touchCm,what:'holds the tool without touching it ('+F[e.i0].task+')',from:F[e.i0].f,to:F[e.i1].f,dur:+((e.i1-e.i0+1)*lim.dt).toFixed(2)});}}
 // ---- 9. stays: how long he stays where he walked to; turning back right away; sleep turnover ----
 // a stay = from the end of one walk (or ladder) to the start of the next; chained chores (switch, hatch, bolt, micro) are short on purpose
 const CHAIN=/^(switch|hatch|bolt|micro|null|guard)$/;tempo.stays=[];
 {const moves=walks.filter(w=>w.i1-w.i0>=20);for(let k=0;k+1<moves.length;k++){const a=moves[k],b=moves[k+1];const d=(b.i0-a.i1)*lim.dt;const task=F[Math.min(F.length-1,a.i1+30)].task||'';
   const back=b.pts&&a.pts&&a.pts.length&&b.pts.length?Math.hypot(b.pts[b.pts.length-1][0]-a.pts[0][0],b.pts[b.pts.length-1][1]-a.pts[0][1])<.6&&Math.abs(b.pts[b.pts.length-1][2]-a.pts[0][2])<.5:false;
   tempo.stays.push({f:F[a.i1].f,task,stay:+d.toFixed(1),back,tag:F[a.i1].tag});if(F[a.i1].tag!==F[b.i0].tag)continue;// forced tour switches do not count
   if(back&&d<lim.stayMin)add('turn-back',a.i1,{bone:'root',value:+d.toFixed(1),unit:'s before walking back where he came from',limit:lim.stayMin,what:'arrives ('+task+') and turns back',from:F[a.i1].f,to:F[b.i0].f});
   else if(d<lim.stayMin&&!CHAIN.test(task))add('short-stay',a.i1,{bone:'root',value:+d.toFixed(1),unit:'s at the spot before leaving again',limit:lim.stayMin,what:'too short a stay ('+task+')',from:F[a.i1].f,to:F[b.i0].f});}
  const by={};for(const s2 of tempo.stays){(by[s2.task]=by[s2.task]||[]).push(s2.stay);}tempo.stayByTask={};for(const k in by){const a=by[k].sort((x,y)=>x-y);tempo.stayByTask[k]={n:a.length,min:a[0],median:a[a.length>>1]};}}
 // sleep: separate times in bed per night; leaving the bed in the night and coming back = turnover
 {const eps=[];let s0=-1;for(let i=0;i<F.length;i++){const on=F[i].fl.includes('B');if(on&&s0<0)s0=i;if(!on&&s0>=0){eps.push({f0:F[s0].f,f1:F[i-1].f,h0:F[s0].hour,h1:F[i-1].hour,dur:+((i-s0)*lim.dt).toFixed(1)});s0=-1;}}
  if(s0>=0)eps.push({f0:F[s0].f,f1:F[F.length-1].f,h0:F[s0].hour,h1:F[F.length-1].hour,dur:+((F.length-s0)*lim.dt).toFixed(1),open:true});tempo.sleep=eps;
  for(let k=1;k<eps.length;k++){const gap=(eps[k].f0-eps[k-1].f1)*lim.dt;const night=h=>h>=21||h<5.5;if(night(eps[k-1].h1)&&night(eps[k].h0)&&gap<120)add('sleep-turnover',F.findIndex(f=>f.f===eps[k-1].f1),{bone:'root',value:+gap.toFixed(1),unit:'s out of bed in the night before lying down again',limit:0,what:'gets up in the night and goes back to bed'});}}
 // ---- merge repeated flags of the same kind (same type+bone within 0.5 s) keeping the worst ----
 // the tour forces a task (the game may place him at once): ignore the 0.5 s around each forced switch
 {const cut=new Uint8Array(F.length);for(let i=1;i<F.length;i++)if(F[i].tag!==F[i-1].tag&&/^tour/.test(F[i].tag||''))for(let k=Math.max(0,i-5);k<Math.min(F.length,i+30);k++)cut[k]=1;
  for(let j=iss.length-1;j>=0;j--)if(cut[iss[j].i]&&iss[j].type!=='turn-back'&&iss[j].type!=='short-stay')iss.splice(j,1);}
 iss.sort((a,b)=>a.i-b.i);const merged=[];const last={};
 for(const q of iss){const k=q.type+'|'+q.bone+'|'+(q.into||'').replace(/#\d+.*/,'')+'|'+(q.what||'');const m=last[k];
  if(m&&q.i-m.i1<=30){m.i1=q.i;m.count++;if(q.value>m.value&&q.type!=='detour'){Object.assign(m,{...q,i1:q.i,count:m.count,first:m.first});}}else{const n={...q,i1:q.i,count:1,first:q.f};merged.push(n);last[k]=n;}}
 // priority
 for(const q of merged){const r=q.limit?q.value/q.limit:2;let P=3;
  if(q.type==='penetration')P=(q.value>=4||(q.bone==='head'&&q.value>=2))?1:q.value>=2?2:3;
  else if(q.type==='joint')P=/broken|next to the head|past the hip|folded flat/.test(q.what)?1:2;
  else if(q.type==='jump'||q.type==='snap-turn')P=r>=3?1:r>=1.6?2:3;
  else if(q.type==='jitter')P=r>=3?1:r>=1.6?2:3;
  else if(q.type==='foot-slide')P=q.value>=8?1:q.value>=4?2:3;
  else if(q.type==='detour')P=q.unit.startsWith('deg')?(q.value>80?1:2):(q.value>1.7?1:2);
  else if(q.type==='owl-head')P=q.value>=(q.limit+20)?1:2;
  else if(q.type==='foot-bend')P=Math.abs(q.value)>=q.limit+15?1:2;
  else if(q.type==='ladder-grip')P=q.unit.startsWith('cm')?(q.value>=q.limit*1.6?1:2):2;
  else if(q.type==='unsupported')P=q.value>=8?1:2;
  else if(q.type==='no-touch'||q.type==='grip')P=q.value>=15?1:2;
  else if(q.type==='turn-back')P=q.value<8?1:2;
  else if(q.type==='short-stay')P=q.value<8?2:3;
  else if(q.type==='sleep-turnover')P=2;
  else if(q.type==='posture')P=q.value>=q.limit+15?1:2;
  else if(q.type==='prop-through-body')P=q.value>=q.limit?1:2;
  else if(q.type==='robot')P=q.value>=q.limit*2?1:2;
  else if(q.type==='slow')P=(q.limit&&q.value<q.limit*.7)||q.value>q.limit*1.5?1:2;
  else if(q.type==='sharp-turn')P=r>=2?1:2;else if(q.type==='crab-walk')P=q.value>70?1:2;
  q.P=P;}
 merged.sort((a,b)=>a.P-b.P||b.value/(b.limit||1)-a.value/(a.limit||1));
 return {issues:merged,tempo,walks:walks.map(({i0,i1,pts,L,D,from,to,task})=>({f0:F[i0].f,f1:F[i1].f,from,to,task,L,D,pts})),kneeSign:sgnWalk,frames:F.length};
}
module.exports={analyze,LIMITS,activity};
