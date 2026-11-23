const {chromium}=require('playwright');const O=__dirname+'/';
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__th,null,{timeout:240000});
for(const g of ['Калитка','Забор мастерской','Забор кухни']){
 await p.evaluate(g=>{__th.setHour(21.5);__th.spawn(g);},g);await p.waitForTimeout(400);await p.evaluate(()=>{__th.warp(0);window.__TS=8;});
 await p.waitForTimeout(600);for(let i=0;i<15;i++){await p.waitForTimeout(1500);const st=await p.evaluate(()=>[__th.state(),__th.gs()]);if(st[0].path===0&&st[0].heroNode===st[1])break;}
 await p.evaluate(()=>{window.__TS=1;});await p.waitForTimeout(1200);
 const xy=await p.evaluate(()=>__th.zScreen(0));await p.mouse.click(xy[0],xy[1]);await p.waitForTimeout(450);await p.screenshot({path:O+'x_'+g.length+'.png'});await p.evaluate(()=>{window.__TS=3;});await p.waitForTimeout(4000);await p.evaluate(()=>{window.__TS=1;});
 console.log(g,JSON.stringify(xy),JSON.stringify(await p.evaluate(()=>[__th.state().heroNode,__th.state().zombies,__th.arrowsInfo()])));
 await p.evaluate(()=>__th.ragAll());await p.waitForTimeout(300);}
console.log(errs.join('\n'));await b.close();})();
