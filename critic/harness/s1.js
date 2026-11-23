const {open}=require('./lib');const O=process.argv[2];
(async()=>{const t0=Date.now();const {b,p,errs}=await open();console.log('loaded',(Date.now()-t0)/1000);
await p.waitForTimeout(3000);await p.screenshot({path:O+'/start.png'});
for(const [n,h] of [['dusk',19.4],['night',22],['day',12]]){await p.evaluate(h=>__th.setHour(h),h);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});}
console.log(errs.join('\n'));await b.close();})();
