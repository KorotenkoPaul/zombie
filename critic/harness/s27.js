// Sound pass: real-time paced game (QA clock stepped at 60 fps of wall time), audio started by a click, the final mix tapped
// at the destination. node s27.js <outPrefix> <task|-> <hour> <seconds> [seed]. Writes <out>.f32 (mono float32 @ sampleRate), <out>.json (trace+states)
const {open}=require('/home/user/zombie/tests/anim/lib');const fs=require('fs');const [OUT,TASK,H,SEC,SEED]=[process.argv[2],process.argv[3],+process.argv[4],+process.argv[5],+(process.argv[6]||13)];
(async()=>{const {b,p}=await open({seed:SEED,query:''});
 await p.evaluate(()=>{const oc=AudioNode.prototype.connect;window.__tapBufs=[];AudioNode.prototype.connect=function(t,...r){const res=oc.call(this,t,...r);
   if(t&&t instanceof AudioDestinationNode&&!t.__tapped){t.__tapped=1;const ctx=t.context;const sp=ctx.createScriptProcessor(4096,2,1);window.__tapSR=ctx.sampleRate;window.__tapCtx=ctx;
    sp.onaudioprocess=e=>{if(!window.__tapOn)return;const a=e.inputBuffer.getChannelData(0),c=e.inputBuffer.getChannelData(1);const m=new Float32Array(a.length);for(let i=0;i<a.length;i++)m[i]=(a[i]+c[i])/2;window.__tapBufs.push([e.playbackTime,m]);};
    window.__tapNode=sp;oc.call(sp,t);}
   if(t&&t instanceof AudioDestinationNode&&window.__tapNode&&this!==window.__tapNode)oc.call(this,window.__tapNode);return res;};});
 await p.mouse.click(300,300);await p.waitForTimeout(8000);
 await p.evaluate(()=>__qa.start());await p.evaluate(s=>__qa.reseed(s),SEED);await p.evaluate(h=>__th.setHour(h),H);await p.evaluate(()=>__qa.step(60,1/60));
 if(TASK!=='-')await p.evaluate(t=>__th.task(t),TASK);
 await p.evaluate(()=>{window.__audioTrace=[];window.__st=[];window.__tapBufs=[];window.__tapOn=1;window.__t0=__tapCtx.currentTime;});
 await p.evaluate(sec=>new Promise(res=>{const t0=performance.timeOrigin;let n=0;const start=Date.now?0:0;const ctx=__tapCtx;const c0=ctx.currentTime;
   const tick=()=>{const want=Math.floor((ctx.currentTime-c0)*60);let k=0;while(n<want&&k<6){__qa.step(1,1/60);n++;k++;}
    if(n%15===0){const h=__dbg.hero;__st.push([+ctx.currentTime.toFixed(2),h.task,h.state,!!h.lad]);}
    if(ctx.currentTime-c0>sec){window.__tapOn=0;res();return;}setTimeout(tick,8);};tick();}),SEC);
 const d=await p.evaluate(()=>{const sr=__tapSR;const bufs=__tapBufs;return {sr,t0:bufs.length?bufs[0][0]:0,n:bufs.length,trace:__audioTrace,st:__st,data:Array.from(bufs.flatMap?[]:[])};});
 const chunks=await p.evaluate(()=>__tapBufs.map(b=>Array.from(b[1])));const all=new Float32Array(chunks.reduce((a,c)=>a+c.length,0));let o=0;for(const c of chunks){all.set(c,o);o+=c.length;}
 fs.writeFileSync(OUT+'.f32',Buffer.from(all.buffer));fs.writeFileSync(OUT+'.json',JSON.stringify({sr:d.sr,t0:d.t0,trace:d.trace,st:d.st}));
 console.log('samples',all.length,'sec',(all.length/d.sr).toFixed(1),'trace',d.trace.length,'states',d.st.length);await b.close();})();
