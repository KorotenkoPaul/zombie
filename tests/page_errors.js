const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:390,height:844}});p.on('pageerror',e=>console.log('PE',e.message));p.on('console',m=>{if(m.type()==='error')console.log('CE',m.text().slice(0,200))});
await p.goto('http://localhost:8126/index.html');await p.waitForTimeout(60000);console.log(await p.evaluate(()=>[!!window.__th,document.getElementById('loadTx').textContent]));await b.close();})();
