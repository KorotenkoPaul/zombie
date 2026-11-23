// Overdraw estimate per class (transparent / alphaTest / opaque) and per object, in full-screen layers, iPhone 13 viewport.
// node tests/perf_overdraw.js [hour]   (serve game/ on :8126)
const {chromium,devices}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({...devices['iPhone 13']});p.on('pageerror',e=>console.log('PE',e.message));
await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:180000});
await p.evaluate(h=>window.__th.setHour(h),+(process.argv[2]||21.5));await p.waitForTimeout(6000);
console.log(await p.evaluate(()=>{const R=window.__perf.renderer,T=window.__dbg.THREE;let s=window.__dbg.hero.root;while(s.parent)s=s.parent;
 const cam=(()=>{let c=null;s.traverse(o=>{});return null;})();
 // find the game camera: the one the composer's RenderPass uses
 let camera=null;const orig=R.render;R.render=function(sc,c){if(sc===s&&c&&c.isPerspectiveCamera&&!camera)camera=c;return orig.apply(this,arguments);};
 return new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>{R.render=orig;
  const W=195,H=422,rt=new T.WebGLRenderTarget(W,H,{type:T.FloatType});const buf=new Float32Array(W*H*4);
  const om=new T.MeshBasicMaterial({color:0xffffff,transparent:true,blending:T.AdditiveBlending,depthTest:false,depthWrite:false,side:T.DoubleSide,fog:false});om.color.setScalar(1/64);
  const mat=o=>(Array.isArray(o.material)?o.material[0]:o.material)||{};
  const cats={transparent:o=>mat(o).transparent,alphaTest:o=>mat(o).alphaTest>0&&!mat(o).transparent,opaque:o=>!mat(o).transparent&&!(mat(o).alphaTest>0)};
  const out={};const vis=[];s.traverse(o=>{if(o.isMesh||o.isPoints||o.isSprite||o.isLine)vis.push([o,o.visible]);});
  const bg=s.background,fog=s.fog;s.background=null;
  for(const [k,f] of Object.entries(cats)){for(const [o,v] of vis)o.visible=v&&f(o);s.overrideMaterial=om;R.setRenderTarget(rt);R.setClearColor(0,0);R.clear();const sm=R.shadowMap.enabled;R.shadowMap.enabled=false;R.render(s,camera);R.shadowMap.enabled=sm;R.readRenderTargetPixels(rt,0,0,W,H,buf);let sum=0,mx=0;for(let i=0;i<W*H;i++){const v=buf[i*4]*64;sum+=v;if(v>mx)mx=v;}out[k]={avgLayers:+(sum/(W*H)).toFixed(2),max:+mx.toFixed(0)};}
  // per-object transparent/alphaTest coverage
  const per=[];for(const [o,v] of vis){if(!v)continue;const m=mat(o);if(!(m.transparent||m.alphaTest>0))continue;for(const [q,vv] of vis)q.visible=false;o.visible=true;R.setRenderTarget(rt);R.clear();R.render(s,camera);R.readRenderTargetPixels(rt,0,0,W,H,buf);let sum=0;for(let i=0;i<W*H;i++)sum+=buf[i*4]*64;const L=sum/(W*H);if(L>.05)per.push([+(L).toFixed(2),(o.name||o.parent&&o.parent.name||'')+' '+o.type+' '+(m.type||'')+(m.transparent?' T':'')+(m.alphaTest>0?' A':'')+' ro'+o.renderOrder]);}
  for(const [o,v] of vis)o.visible=v;s.overrideMaterial=null;s.background=bg;R.setRenderTarget(null);
  per.sort((a,b)=>b[0]-a[0]);out.per=per.slice(0,20);res(JSON.stringify(out,null,0).replace(/\],\[/g,'],\n['));})));}));
await b.close();})();
