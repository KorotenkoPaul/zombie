// node tests/kitchen/probe.js <task> [--opts JSON] [--secs 20] [--query ?hero=new] : prints the task's state every 0.5 s
const {open}=require('../anim/lib.js');const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
(async()=>{const task=process.argv[2];const {b,p,errs}=await open({seed:+arg('--seed','1'),vp:{width:200,height:200},query:arg('--query','')});
 await p.evaluate(()=>__qa.start());await p.evaluate(([h])=>{__qa.reseed(7);__th.setHour(h);__dbg.HH.setBrain({tick(){}});},[+arg('--hour','11')]);
 await p.evaluate(([t,o])=>{__dbg.HH.startTask(t,o);},[task,JSON.parse(arg('--opts','{}'))]);
 const rows=await p.evaluate(([TT,secs,EX,EV,OPTS])=>{const out=[];const T=__dbg.THREE;const B=__dbg.heroBones;const H=__dbg.hero;let on=false,t0=0;
  for(let i=0;i<60*(120+secs);i++){__qa.step(1,1/60);if(i%600===599&&__dbg.hero.task!==TT)__dbg.HH.startTask(TT,OPTS);const A=__dbg.HH.act;if(!on){if(H.task===TT&&A&&A.step&&A.step!=='go'){on=true;t0=i;}else continue;}
   if((i-t0)%EV)continue;const r=H.root;const P=window.__props;const v=n=>{const q=B[n].getWorldPosition(new T.Vector3());return q.toArray().map(x=>x.toFixed(2)).join(',');};
   let ex='';try{ex=eval(EX)}catch(e){ex='ERR '+e.message}
   out.push(((i-t0)/60).toFixed(1)+'s '+(H.task||'-')+' '+(A&&A.step)+(A&&A.fr?'/'+A.fr.st:'')+' clip='+(H.cur?H.cur.getClip().name:'')+' root='+r.position.toArray().map(x=>x.toFixed(2))+' yaw='+r.rotation.y.toFixed(2)+' hips='+v('Hips')+' head='+v('Head')+' R='+v('RightHand')+' L='+v('LeftHand')+' | '+ex);
   if(i-t0>secs*60)break;}if(!out.length)out.push('NEVER STARTED: wait='+JSON.stringify(H.wait&&{t:H.wait.t,f:String(H.wait.then).slice(0,80)})+' brain='+!!__dbg.HH.brain+' trans='+H.trans+' pending='+H.pending+' inBed='+H.inBed+' left='+(__dbg.HH.act&&__dbg.HH.act.left)+' swing='+!!H.swing+' clip='+(H.cur&&H.cur.getClip().name)+' task='+H.task+' step='+(__dbg.HH.act&&__dbg.HH.act.step)+' pos='+H.root.position.toArray().map(x=>x.toFixed(2)));return out;},[task,+arg('--secs','20'),(arg('--exf','')?require('fs').readFileSync(arg('--exf','')).toString():arg('--ex','""')),+arg('--every','30'),JSON.parse(arg('--opts','{}'))]);
 console.log(rows.join('\n'));if(errs.length)console.log(errs.slice(0,5));await b.close();})();
