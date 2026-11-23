// Perf profile: counts WebGL draw calls, triangles, texture uploads and JS time per frame, with no changes to the game.
// node tests/perf_profile.js [url] [outPng]
const {chromium}=require('playwright');
const url=process.argv[2]||'http://localhost:8126/index.html';const out=process.argv[3]||'/tmp/perf.png';
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const {devices}=require('playwright');const p=await b.newPage(process.env.DESK?{viewport:{width:390,height:844},deviceScaleFactor:1}:{...devices['iPhone 13']});p.on('pageerror',e=>console.log('PE',e.message));
await p.addInitScript(()=>{const S=window.__glstat={calls:0,tris:0,inst:0,tex:0,texBytes:0,bufBytes:0,frames:[],progs:0};
 const wrap=(P)=>{if(!P)return;const de=P.drawElements,da=P.drawArrays,dei=P.drawElementsInstanced,dai=P.drawArraysInstanced,ti=P.texImage2D,ts=P.texStorage2D,bd=P.bufferData,cp=P.createProgram,ct=P.compressedTexImage2D;
  P.drawElements=function(m,c,t,o){S.calls++;S.tris+=m===4?c/3:0;return de.apply(this,arguments);};
  P.drawArrays=function(m,f,c){S.calls++;S.tris+=m===4?c/3:0;return da.apply(this,arguments);};
  if(dei)P.drawElementsInstanced=function(m,c,t,o,n){S.calls++;S.inst++;S.tris+=m===4?c/3*n:0;return dei.apply(this,arguments);};
  if(dai)P.drawArraysInstanced=function(m,f,c,n){S.calls++;S.inst++;S.tris+=m===4?c/3*n:0;return dai.apply(this,arguments);};
  P.texImage2D=function(){S.tex++;const a=arguments;let w=0,h=0;if(a.length>=9){w=a[3];h=a[4];}else{const s=a[5];w=s&&(s.width||s.videoWidth)||0;h=s&&(s.height||s.videoHeight)||0;}S.texBytes+=w*h*4;return ti.apply(this,a);};
  if(ts)P.texStorage2D=function(t,l,f,w,h){S.texBytes+=w*h*4*1.33;return ts.apply(this,arguments);};
  P.bufferData=function(t,d){if(d&&d.byteLength)S.bufBytes+=d.byteLength;return bd.apply(this,arguments);};
  P.createProgram=function(){S.progs++;return cp.apply(this,arguments);};};
 wrap(window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype);wrap(window.WebGLRenderingContext&&WebGLRenderingContext.prototype);
 const raf=window.requestAnimationFrame.bind(window);let c0=0,t0=0;
 window.requestAnimationFrame=function(cb){return raf(function(ts){const a=performance.now();c0=S.calls;t0=S.tris;cb(ts);const js=performance.now()-a;if(S.calls>c0)S.frames.push({calls:S.calls-c0,tris:S.tris-t0,js});if(S.frames.length>400)S.frames.shift();});};});
const t0=Date.now();await p.goto(url);
await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:180000});const loadS=(Date.now()-t0)/1000;
const res={loadS};
for(const [name,h] of [['night',22],['day',13]]){await p.evaluate(h=>window.__th.setHour(h),h);await p.waitForTimeout(8000);await p.evaluate(()=>window.__glstat.frames.length=0);await p.waitForTimeout(6000);
 res[name]=await p.evaluate(()=>{const F=window.__glstat.frames.slice(-40);const avg=k=>+(F.reduce((s,f)=>s+f[k],0)/F.length).toFixed(1);const mx=k=>+Math.max(...F.map(f=>f[k])).toFixed(1);return {n:F.length,calls:avg('calls'),tris:Math.round(avg('tris')),jsAvg:avg('js'),jsMax:mx('js')};});
 await p.screenshot({timeout:180000,path:out.replace('.png','-'+name+'.png')});}
res.gl=await p.evaluate(()=>{const S=window.__glstat;return {texUploads:S.tex,texMB:+(S.texBytes/1048576).toFixed(1),bufMB:+(S.bufBytes/1048576).toFixed(1),programs:S.progs};});
res.net=await p.evaluate(()=>{const E=performance.getEntriesByType('resource');const L=E.map(e=>[e.name.split('/').pop().slice(0,40),Math.round((e.transferSize||e.encodedBodySize)/1024)]).sort((a,b)=>b[1]-a[1]);return {totalKB:L.reduce((s,x)=>s+x[1],0),top:L.slice(0,14)};});
res.perf=await p.evaluate(()=>window.__perf?window.__perf.stats():null);
console.log(JSON.stringify(res,null,1));await b.close();})();
