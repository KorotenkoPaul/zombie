// Analyse routine.json from s4.js. Prints a per-task table and the worst frames.
// Feet: ankle height above the surface under it (rest value is measured while idle on a floor),
// sole penetration = rest - current (positive = sinks into the floor).
// Seat: hips height above the surface under the hips; thighs: thigh midpoint vs surface below.
// Bed: hips position inside the mattress rectangle (0 = edge, 0.5 = centre across the bed).
// Jerk: hips world speed spikes (>2.5 m/s in one frame), yaw jumps (>0.35 rad/frame), hip teleports (>0.12 m/frame).
const fs=require('fs');const {S,log}=JSON.parse(fs.readFileSync(process.argv[2]));
let seg='?';const rows=[];for(const r of log){if(r.mark){seg=r.mark+'@'+r.h;continue;}r.seg=seg;rows.push(r);}
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:NaN;};
// rest ankle/toe height: idle or walking-with-v~0 frames on a level floor
const ank=[],toe=[];for(const r of rows){if(r.state==='idle'&&!r.rm&&!r.lad&&r.feet)for(const f of r.feet){if(f[2]!=null)ank.push(f[0]-f[2]);if(f[3]!=null)toe.push(f[1]-f[3]);}}
const restA=med(ank),restT=med(toe);console.log('frames',rows.length,'rest ankle',restA?.toFixed(3),'rest toe',restT?.toFixed(3),'surfaces',JSON.stringify(S));
const out={};const worst=[];
let prev=null;
for(const r of rows){const k=r.seg+' '+r.state+(r.lad?'/lad':'')+(r.rm?'/rm':'');const o=out[k]=out[k]||{n:0,sinkMax:0,sinkFrames:0,floatMax:0,clips:new Set(),hipSeat:[],thighPen:0,bed:[],spikes:0,yaw:0,tele:0};o.n++;o.clips.add(r.clip);
 if(r.feet&&!r.lad){for(const f of r.feet){if(f[2]==null)continue;const sA=restA-(f[0]-f[2]);const sT=f[3]!=null?restT-(f[1]-f[3]):-9;const s=Math.max(sA,sT);if(s>o.sinkMax)o.sinkMax=s;if(s>.03){o.sinkFrames++;worst.push(['sink',s,r]);}
  const fl=-Math.min(sA,sT);if(r.state==='idle'||r.state==='work')if(fl>o.floatMax)o.floatMax=fl;}}
 if(r.seat||r.clip==='33'||r.clip==='57'||r.clip==='53'){if(r.under)o.hipSeat.push(r.hip[1]-r.under[0]);for(const t of r.thigh||[]){if(t[1]!=null&&t[0]-t[1]<.04){o.thighPen++;}}}
 if(r.bed){const B=S.bed&&S.bed[0];if(B){const ax=(r.hip[0]-B.x0)/(B.x1-B.x0),az=(r.hip[2]-B.z0)/(B.z1-B.z0);o.bed.push([ax,az,r.hip[1]-B.top]);}}
 if(prev&&prev.seg===r.seg){const gdt=Math.min(.05,r.dt);if(gdt>0.004){const d=Math.hypot(r.hip[0]-prev.hip[0],r.hip[1]-prev.hip[1],r.hip[2]-prev.hip[2]);const dr=Math.hypot(r.root[0]-prev.root[0],r.root[2]-prev.root[2]);
  let dy=Math.abs(r.ry-prev.ry);if(dy>Math.PI)dy=2*Math.PI-dy;
  if(d>.12){o.tele++;worst.push(['teleport',d,r,prev]);}else if(d/gdt>2.5){o.spikes++;worst.push(['speed',d/gdt,r,prev]);}
  if(dy>.35){o.yaw++;worst.push(['yawjump',dy,r,prev]);}}}
 prev=r;}
const f=x=>x==null||isNaN(x)?'-':x.toFixed(3);
console.log('\nsegment/state | frames | clips | feet sink max (m) / frames>3cm | idle float max | hips-above-seat median | thigh-in-seat frames | bed (across, along, h) median | speed spikes | teleports | yaw jumps');
for(const [k,o] of Object.entries(out)){const bd=o.bed.length?[med(o.bed.map(b=>b[0])),med(o.bed.map(b=>b[1])),med(o.bed.map(b=>b[2]))].map(f).join(','):'-';
 console.log([k,o.n,[...o.clips].join(','),f(o.sinkMax)+'/'+o.sinkFrames,f(o.floatMax),o.hipSeat.length?f(med(o.hipSeat)):'-',o.thighPen,bd,o.spikes,o.tele,o.yaw].join(' | '));}
console.log('\nworst events:');
const byType={};for(const w of worst){(byType[w[0]]=byType[w[0]]||[]).push(w);}
for(const [t,a] of Object.entries(byType)){a.sort((x,y)=>y[1]-x[1]);console.log(t,a.length);for(const w of a.slice(0,8)){const r=w[2],p=w[3];console.log('  ',f(w[1]),r.seg,r.state,'clip',p?p.clip+'->'+r.clip:r.clip,'lad',r.lad,'rm',r.rm,'hip',r.hip.map(f).join(','));}}
