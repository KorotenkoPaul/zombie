// in-place turning (deg) while root speed < .15 m/s, over all frames (walk and post-arrival), per task; plus big single spins
const D=JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync(process.argv[2])));const F=D.frames;
const w=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};const per={};let tot=0,run=0,big=[];
for(let i=1;i<F.length;i++){const a=F[i],b=F[i-1];if(/[LSB]/.test(a.fl)){run=0;continue;}const v=Math.hypot(a.root[0]-b.root[0],a.root[2]-b.root[2])*60;const dy=Math.abs(w(a.ry-b.ry));
 if(v<.15&&dy*60>.3){tot+=dy;per[a.task]=(per[a.task]||0)+dy;run+=dy;}else{if(run>2.6)big.push(a.task+'@'+a.f+':'+(run*57.3|0));run=0;}}
console.log('in-place turning total',(tot*57.3|0),'deg; spins>150:',big.join(' '));
console.log(Object.entries(per).sort((x,y)=>y[1]-x[1]).slice(0,12).map(([k,v])=>k+' '+(v*57.3|0)).join(', '));
