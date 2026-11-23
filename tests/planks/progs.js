const {chromium,devices}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({...devices['iPhone 13']});p.on('pageerror',e=>console.log('PE',e.message.slice(0,200)));
await p.goto('http://localhost:'+(process.env.PORT||8126)+'/index.html');await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:300000});
await p.waitForTimeout(12000);
console.log(await p.evaluate(()=>{const R=__perf.renderer;const M=__planks.meshes;const out=[];for(const [n,m] of Object.entries(M)){const mat=m.material;out.push(n+': key='+(mat.customProgramCacheKey&&mat.customProgramCacheKey()).slice(0,60));}
 const ks0=R.info.programs.map(pr=>pr.cacheKey.split(',').slice(-2).join(',').slice(-90));const ks=R.info.programs.map(pr=>pr.cacheKey.split(',').slice(-3).join(',').slice(-80)).filter(k=>/wetBoards|plank|slate/.test(k));return out.join('\n')+'\n'+ks.join('\n')+'\nALL:'+ks0.filter(k=>k.length>12).join(' ## ');}));
await b.close();})();
