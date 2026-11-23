const {chromium}=require('playwright');const O=__dirname+'/';
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__th,null,{timeout:240000});
await p.evaluate(()=>{__th.setHour(11);__th.cam(-.5,8.2,4,2.2);});await p.waitForTimeout(3000);await p.screenshot({path:O+'y0.png'});
await p.evaluate(()=>{__th.view(.7,.25,1);__th.cam(-.5,8.2,4,2.2);});await p.evaluate(()=>{});await p.waitForTimeout(1500);await p.screenshot({path:O+'y1.png'});
await p.evaluate(()=>{__th.setHour(23.2);__th.task('sleep');window.__TS=5;});
for(let i=0;i<10;i++){await p.waitForTimeout(2000);const st=await p.evaluate(()=>__th.state());if(st.path===0&&st.heroNode==='bed')break;}
await p.evaluate(()=>{window.__TS=1;__th.cam(-2.3,8.3,4,2.2);});await p.waitForTimeout(1500);await p.screenshot({path:O+'y2.png'});
await p.evaluate(()=>{__th.cam(-2.3,8.6,3.2,2.2);__th.view(-.4,.6,1);});await p.waitForTimeout(1200);await p.screenshot({path:O+'y3.png'});
console.log(errs.join('\n'));await b.close();})();
