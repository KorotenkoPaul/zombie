// How the hero arrives at and leaves each place (from a recorded run: tests/anim gate/run frames.json.gz or tests/mm scenario).
// node tests/gait/arrivals.js frames.json.gz [--task NAME]
// For every walk (frames flagged P, not on a ladder):
//  start: how long he turns on the spot before the root moves (s, deg), and how fast he gets to walking pace (s to 0.8 m/s)
//  end:   speed 0.5 s before the stop, the deceleration of the last 0.3 s (m/s²), then after the stop: degrees turned on the
//         spot and for how long, and the pause before the next clip starts (s). People: no turn-before-walk over ~0.3 s, a stop
//         over 1-2 steps (~1.5-2.5 m/s²), a turn after arrival only when the goal was beside him, no dead pause.
const fs=require('fs'),zlib=require('zlib');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const D=JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[2])));const F=D.frames;const only=arg('task',null);
const wrap=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};
const HIPS=process.argv.includes('--hips');const P=f=>HIPS?[f.b[0],0,f.b[2]]:f.root;// --hips: what you see (pelvis) instead of the navigation root
const sp=i=>{const a=F[Math.max(0,i-3)],b=F[Math.min(F.length-1,i+3)];const pa=P(a),pb=P(b);return Math.hypot(pb[0]-pa[0],pb[2]-pa[2])/((b.f-a.f)/60||1);};
const segs=[];let s=null;for(let i=0;i<F.length;i++){const w=F[i].fl.includes('P')&&!F[i].fl.includes('L');if(w&&s==null)s=i;if((!w||i===F.length-1)&&s!=null){segs.push([s,i]);s=null;}}
const rows=[];
for(const [a,b] of segs){if(b-a<20)continue;const task=F[a].task;if(only&&task!==only)continue;
 // start: frames from walk start until the root really moves (>0.15 m/s)
 let m=a;while(m<b&&sp(m)<.15)m++;const turn0=Math.abs(wrap(F[m].ry-F[a].ry))*57.3;const t0=(F[m].f-F[a].f)/60;
 let r=m;while(r<b&&sp(r)<.8)r++;const tPace=(F[r].f-F[m].f)/60;
 // end
 let e=b;while(e>a&&sp(e)<.05)e--;const i5=Math.max(a,e-30),i3=Math.max(a,e-18);const v5=sp(i5),v3=sp(i3);const dec=v3/((F[e].f-F[i3].f)/60||1);
 // after the stop: turning on the spot until yaw settles; pause until the clip changes from walk/idle to something else
 let k=b;let yawTot=0;while(k<F.length-1&&k<b+300){const dy=Math.abs(wrap(F[k+1].ry-F[k].ry));if(dy*60<.15&&k>b+6)break;yawTot+=dy;k++;}
 let c=b;while(c<F.length-1&&c<b+600&&/^(30|0|11|12|hy_idle|336)$/.test(F[c].clip))c++;
 rows.push({task,f:F[a].f,len:+((F[b].f-F[a].f)/60).toFixed(1),turnBefore:+turn0.toFixed(0),tTurnBefore:+t0.toFixed(2),tToPace:+tPace.toFixed(2),v05:+v5.toFixed(2),decel:+dec.toFixed(1),turnAfter:+(yawTot*57.3).toFixed(0),tTurnAfter:+((F[k].f-F[b].f)/60).toFixed(2),pause:+((F[c].f-F[b].f)/60).toFixed(2),next:F[c].clip});}
const pad=(x,n)=>String(x).padStart(n);
console.log('task       frame   walk s | turn-before deg/s | to-pace s | v@-0.5s decel | turn-after deg/s | pause s next');
for(const r of rows)console.log(`${r.task.padEnd(10)} ${pad(r.f,6)} ${pad(r.len,6)} | ${pad(r.turnBefore,5)} ${pad(r.tTurnBefore,5)} | ${pad(r.tToPace,5)} | ${pad(r.v05,5)} ${pad(r.decel,5)} | ${pad(r.turnAfter,5)} ${pad(r.tTurnAfter,5)} | ${pad(r.pause,5)} ${r.next}`);
const med=k=>{const a=rows.map(r=>r[k]).sort((x,y)=>x-y);return a.length?a[a.length>>1]:'-';};
console.log(`median: turn-before ${med('turnBefore')} deg in ${med('tTurnBefore')} s, to pace ${med('tToPace')} s, decel ${med('decel')} m/s², turn-after ${med('turnAfter')} deg in ${med('tTurnAfter')} s, pause ${med('pause')} s (${rows.length} walks)`);
