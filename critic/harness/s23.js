// A1: repair sounds vs hand motion, QA clock. node a1.js <task> <hour> <seed>
const {open}=require('/home/user/zombie/tests/anim/lib');const [TASK,H,SEED]=[process.argv[2],+process.argv[3],+(process.argv[4]||13)];
(async()=>{const {b,p}=await open({seed:SEED,query:''});
 await p.mouse.click(300,300);await p.waitForTimeout(8000);
 console.log('ac',await p.evaluate(()=>JSON.stringify({a:typeof window.__audio,k:window.__audio&&Object.keys(window.__audio).slice(0,30)})));
 await p.evaluate(()=>__qa.start());await p.evaluate(s=>__qa.reseed(s),SEED);
 await p.evaluate(()=>{window.__audioTrace=[];});
 await p.evaluate(h=>__th.setHour(h),H);await p.evaluate(()=>__qa.step(60,1/60));await p.evaluate(t=>__th.task(t),TASK);
 let seen=false;const rows=[];let prevY=null,nTr=0;
 for(let i=0;i<9000;i++){
  const r=await p.evaluate(()=>{__qa.step(1,1/60);const h=__dbg.hero,hb=__dbg.heroBones,T=__dbg.THREE,v=new T.Vector3();(hb.RightHand||hb.mixamorigRightHand).getWorldPosition(v);
   const tr=window.__audioTrace||[];return {t:h.task,st:h.state,clip:h.cur&&h.cur.name||'',y:v.y,x:v.x,z:v.z,n:tr.length,last:tr.slice(-3).map(e=>e[1])};});
  if(r.t===TASK)seen=true;if((seen&&r.t!==TASK)||(!seen&&i>600))break;if(!seen)continue;
  const vy=prevY===null?0:(r.y-prevY)*60;prevY=r.y;
  const snd=r.n>nTr?r.last.slice(-(r.n-nTr)):[];nTr=r.n;
  rows.push([i,r.st,r.clip,+r.y.toFixed(3),+vy.toFixed(2),snd.join('+')]);}
 require('fs').writeFileSync(`a1_${TASK}_${SEED}.json`,JSON.stringify(rows));
 const s=rows.filter(r=>r[5]);console.log(TASK,'frames',rows.length,'sounds',s.length);
 const byState={};for(const r of s){byState[r[1]]=(byState[r[1]]||0)+1;}console.log('by state',JSON.stringify(byState));
 for(const r of s.slice(0,40)){const i=rows.indexOf(r);const pre=rows.slice(Math.max(0,i-6),i).map(q=>q[4]).join(',');console.log(r.join(' '),'| vy before:',pre);}
 await b.close();})();
