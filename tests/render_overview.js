const {chromium}=require('playwright');const O=__dirname+'/';
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__th,null,{timeout:240000});
await p.waitForTimeout(2500);await p.screenshot({path:O+'w0.png'});
await p.evaluate(()=>{__th.setHour(12);});await p.waitForTimeout(1500);await p.screenshot({path:O+'w1.png'});
await p.evaluate(()=>{__th.setHour(19.4);__th.cam(-2.4,6.0,6,2.4);});await p.waitForTimeout(1500);await p.screenshot({path:O+'w2.png'});
console.log(errs.join('\n'));await b.close();})();
