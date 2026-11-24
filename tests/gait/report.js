// Walk quality numbers from a recorded scenario (tests/mm/scenario.js --out DIR), one line each, to compare builds.
// node tests/gait/report.js DIR [DIR2 ...]
//  knee      knee flexion while walking (median / p90) and on the stance leg (people: ~5-20 deg at mid-stance, ~60 deg peak swing)
//  backKnee  walking frames with a knee bent the wrong way (QA analyzer rule)
//  ankleH    lowest ankle height above the floor while walking (rig sole ~0.14 m at Hips scale 1: much higher = crouch, lower = boots in the boards)
//  plant     planted-ankle horizontal speed (m/s, lower = less foot sliding)
//  pivot     turning on the spot (root yaw > 0.5 rad/s, root < 0.15 m/s): frames and the slower foot's speed (turntable effect)
//  P1        QA analyzer P1 counts for jump / penetration / joint / unsupported
const fs=require('fs'),zlib=require('zlib'),path=require('path');const {analyze}=require('../anim/analyze.js');
const N=['Hips','Spine2','Neck','Head','HeadTop_End','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','LeftToe_End','RightUpLeg','RightLeg','RightFoot','RightToeBase','RightToe_End'];
const P=(f,n)=>{const i=N.indexOf(n)*3;return [f.b[i],f.b[i+1],f.b[i+2]];};const sub=(a,b)=>a.map((v,i)=>v-b[i]);const len=a=>Math.hypot(...a);
const ang=(a,b)=>Math.acos(Math.max(-1,Math.min(1,(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(len(a)*len(b)+1e-9))))*180/Math.PI;
const q=(a,p)=>{if(!a.length)return NaN;a=[...a].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor(a.length*p))];};
for(const dir of process.argv.slice(2)){
 const D=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,'frames.json.gz'))));const F=D.frames;
 const walk=F.filter(f=>f.fl.includes('P')&&!f.fl.includes('L'));const all=[],st=[],ah=[];
 for(const f of walk){const g=f.gnd?Math.min(f.gnd[0],f.gnd[2]??f.gnd[0]):f.root[1];let lo=1e9;
  for(const s of ['Left','Right']){const u=P(f,s+'UpLeg'),k=P(f,s+'Leg'),a=P(f,s+'Foot');const kn=ang(sub(k,u),sub(a,k));all.push(kn);
   const o=P(f,(s==='Left'?'Right':'Left')+'Foot');if(a[1]<o[1]-.02)st.push(kn);lo=Math.min(lo,a[1]-g);}ah.push(lo);}
 let pl=0,pn=0;for(const s of ['LeftFoot','RightFoot']){const gi=s==='LeftFoot'?0:2;const hh=[];for(const f of F){const g=f.gnd&&f.gnd[gi];if(g!=null)hh.push(P(f,s)[1]-g);}const h0=q(hh,.05)||0;
  for(let i=1;i<F.length;i++){const a=P(F[i-1],s),c=P(F[i],s);const g=F[i].gnd&&F[i].gnd[gi];if(g==null||c[1]-g>h0+.03)continue;const v=Math.hypot(c[0]-a[0],c[2]-a[2])*60;if(v>.5)continue;pl+=v;pn++;}}
 let pv=0,ps=0;for(let i=1;i<F.length;i++){const a=F[i],b=F[i-1];if(/[LSB]/.test(a.fl))continue;let dy=a.ry-b.ry;while(dy>Math.PI)dy-=2*Math.PI;while(dy<-Math.PI)dy+=2*Math.PI;
  if(Math.abs(dy)*60<.5||Math.hypot(a.root[0]-b.root[0],a.root[2]-b.root[2])*60>.15)continue;pv++;let best=1e9;
  for(const s of ['LeftFoot','RightFoot']){const k=N.indexOf(s)*3;best=Math.min(best,Math.hypot(a.b[k]-b.b[k],a.b[k+2]-b.b[k+2])*60);}ps+=best;}
 const R=analyze(D);const c={};for(const x of R.issues)if(x.P===1)c[x.type]=(c[x.type]||0)+1;
 const back=R.issues.filter(x=>x.P===1&&x.type==='joint'&&/wrong way/.test(x.unit||'')&&x.act==='walking').length;
 console.log(`${dir}: ${F.length} frames | knee walk ${q(all,.5).toFixed(0)}/${q(all,.9).toFixed(0)} stance ${q(st,.5).toFixed(0)} deg | backKnee ${back} | ankleH ${q(ah,.5).toFixed(3)} m | plant ${(pl/Math.max(1,pn)).toFixed(3)} m/s | pivot ${pv} fr @ ${(ps/Math.max(1,pv)).toFixed(3)} m/s | P1 jump ${c.jump||0} pen ${c.penetration||0} joint ${c.joint||0} unsup ${c.unsupported||0}`);}
