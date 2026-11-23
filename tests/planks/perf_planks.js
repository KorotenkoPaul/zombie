// Cost of the planks shaders on the iPhone 13 profile: screen coverage of boards/beams/slates and the render time of those
// meshes alone with their real shader vs a plain MeshStandardMaterial (SwiftShader CPU time ~ fragment work). node perf_planks.js [label]
const {chromium,devices}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({...devices['iPhone 13']});p.on('pageerror',e=>console.log('PE',e.message.slice(0,200)));
await p.goto('http://localhost:'+(process.env.PORT||8126)+'/index.html');await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:300000});
await p.evaluate(()=>{__th.setHour(21.5);if(window.__camera&&__camera.dof)__camera.dof(false);});await p.waitForTimeout(4000);
const views=[['default',null],['overview',[[0,7.4,2.4],0,.15,14]],['kitchen',[[-2.4,6.6,2.6],0.1,.35,3.2]],['roof',[[-1.9,11.2,2.3],.35,.55,4.2]]];
for(const [n,v] of views){if(v)await p.evaluate(([t,yaw,pitch,dist])=>{__th.cam();__th.rig.set({target:new __dbg.THREE.Vector3(...t),yaw,pitch,dist,snap:true});},v);await p.waitForTimeout(3000);
 console.log(n,await p.evaluate(()=>{const R=__perf.renderer,T=__dbg.THREE;let s=__dbg.hero.root;while(s.parent)s=s.parent;let camera=null;const orig=R.render;R.render=function(sc,c){if(sc===s&&c&&c.isPerspectiveCamera&&!camera)camera=c;return orig.apply(this,arguments);};
  return new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>{R.render=orig;const M=__planks.meshes;const mine=[M.boards,M.beams,M.shingles];
   const W=390,H=844;const rt=new T.WebGLRenderTarget(W,H);const px=new Uint8Array(4);const buf=new Uint8Array(W*H*4);
   const vis=[];s.traverse(o=>{if(o.isMesh||o.isPoints||o.isSprite||o.isLine)vis.push([o,o.visible]);});const bg=s.background;s.background=null;const sm=R.shadowMap.enabled;R.shadowMap.enabled=false;
   const only=set=>{for(const [o,v] of vis)o.visible=v&&set.includes(o);};
   // coverage (depth-tested against everything: draw all black, then mine white)
   const blk=new T.MeshBasicMaterial({color:0}),wht=new T.MeshBasicMaterial({color:0xffffff});
   R.setRenderTarget(rt);R.setClearColor(0,0);R.clear();for(const [o,v] of vis)o.visible=v;s.overrideMaterial=blk;R.render(s,camera);s.overrideMaterial=null;
   const cov={};for(const m of mine){only([m]);const om=m.material;m.material=wht;R.autoClear=false;R.render(s,camera);R.autoClear=true;m.material=om;R.readRenderTargetPixels(rt,0,0,W,H,buf);let c=0;for(let i=0;i<W*H;i++)if(buf[i*4]>128)c++;cov[m.name||(m===M.boards?'boards':m===M.beams?'beams':'slates')]=+(c/(W*H)).toFixed(3);R.clear();for(const [o,v] of vis)o.visible=v;s.overrideMaterial=blk;R.render(s,camera);s.overrideMaterial=null;}
   const time=()=>{const t0=performance.now();for(let k=0;k<3;k++){R.clear();R.render(s,camera);R.readRenderTargetPixels(rt,0,0,1,1,px);}return (performance.now()-t0)/3;};
   only(mine);time();const real=time();const plain=mine.map(m=>{const om=m.material;m.material=new T.MeshStandardMaterial({color:0x886644,roughness:.8,map:null});return [m,om];});time();const pl=time();for(const [m,om] of plain)m.material=om;
   for(const [o,v] of vis)o.visible=v;R.setRenderTarget(null);s.background=bg;R.shadowMap.enabled=sm;
   const cast=mine.map(m=>[m.castShadow,m.count,m.count*(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3,m.layers.mask]);
   let lights=[];s.traverse(o=>{if(o.isLight&&o.castShadow&&o.visible)lights.push(o.type+(o.intensity>0?'':'(off)'));});
   res(JSON.stringify({cov,msReal:+real.toFixed(1),msPlain:+pl.toFixed(1),cast,lights}));})));}));}
await b.close();})();
