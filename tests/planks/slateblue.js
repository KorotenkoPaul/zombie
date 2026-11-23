// night roof colour probe: mean RGB of slate pixels at night, with the real material and with variations. node slateblue.js out
const {chromium,devices}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({...devices['iPhone 13']});p.on('pageerror',e=>console.log('PE',e.message.slice(0,200)));
await p.goto('http://localhost:'+(process.env.PORT||8126)+'/index.html');await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:300000});
await p.evaluate(()=>{__th.setHour(23);__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(-1.5,10.5,2.4),yaw:.3,pitch:.35,dist:7,snap:true});});await p.waitForTimeout(4000);
await p.screenshot({path:process.argv[2]+'_a.png',timeout:300000});
const info=await p.evaluate(()=>{let s=__dbg.hero.root;while(s.parent)s=s.parent;const L=[];s.traverse(o=>{if(o.isLight&&o.visible&&o.intensity>0&&(o.isDirectionalLight||o.isHemisphereLight||o.isAmbientLight))L.push([o.type,o.color.getHexString(),o.groundColor?o.groundColor.getHexString():'',+o.intensity.toFixed(3)]);});
 return {L,env:!!s.environment,envI:s.environmentIntensity,tone:__perf.renderer.toneMapping,exp:__perf.renderer.toneMappingExposure};});console.log(JSON.stringify(info));
await b.close();})();
