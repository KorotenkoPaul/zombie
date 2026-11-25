// Does house wear read at the normal camera? Home view at noon: clean, then every wear candidate fully damaged
// (__wear.set(id,1) for all, rope frayed) and every wall/floor board marked worn (__planks.setFresh(id,-1)); then in a storm.
// Usage: node s15.js <outdir> [hour=12]
const {open,waitFrames}=require('./lib');const O=process.argv[2];const H=+(process.argv[3]||12);
(async()=>{const {b,p}=await open({});
 await p.evaluate(h=>{__th.setHour(h);__th.cam();window.__TS=0.0001;},H);await waitFrames(p,4);await p.screenshot({path:`${O}/home_clean.png`});
 const n=await p.evaluate(()=>{const W=window.__wear;const c=W.candidates();c.forEach(id=>W.set(id,1));W.rope(1);W.snap();let s=0;for(const x of __planks.list()){if(x.kind==='wall'||x.kind==='floor'||x.kind==='roof'){__planks.setFresh(x.id,-1);s++;}}return [c.length,s];});
 console.log('damaged',n);await waitFrames(p,4);await p.screenshot({path:`${O}/home_worn.png`});
 await p.evaluate(()=>{window.__TS=1;__weather.setRain(true,'storm');});await p.waitForTimeout(30000);await p.evaluate(()=>{window.__TS=0.0001;});await waitFrames(p,4);await p.screenshot({path:`${O}/home_storm.png`});
 await b.close();})();
