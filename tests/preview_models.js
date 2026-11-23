const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});const p=await b.newPage({viewport:{width:1024,height:1024}});p.on('pageerror',e=>console.log(e.message));
await p.goto('http://localhost:8125/pv.html?'+process.argv[2]);await p.waitForFunction(()=>window.done,null,{timeout:300000});await p.screenshot({path:process.argv[3]});await b.close();})();
