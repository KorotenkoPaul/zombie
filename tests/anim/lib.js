// Animation QA harness: loads game/index.html in headless Chromium with
//  * files served straight from disk (no web server needed),
//  * a seeded Math.random (same seed => same day),
//  * a virtual clock: performance.now and requestAnimationFrame are driven by __qa.step(n, dt),
//    so the whole game advances at an exact fixed timestep,
//  * rendering switched off while simulating (SwiftShader draws this scene at <1 fps); __qa.shot() renders on demand.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const GAME=path.resolve(__dirname,'../../game');const ORIGIN='http://zombie.qa';
const INIT=seed=>{ // runs before any page script
 let s=seed>>>0;const rand=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
 // While loading, assets arrive in a different order each time, so one shared random stream would hand out different numbers
 // to the same code. Until start(), each call site (file:line:col) gets its own stream; from start() on, one seeded stream.
 const sites=new Map();let perSite=true;
 const siteRand=()=>{const st=new Error().stack.split('\n')[3]||'';let r=sites.get(st);if(!r){let h=2166136261>>>0;for(let i=0;i<st.length;i++){h^=st.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
   let z=(h^seed)>>>0;r=()=>{z=(z+0x6D2B79F5)>>>0;let t=z;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};sites.set(st,r);}return r();};
 Math.random=()=>perSite?siteRand():rand();
 // While the page loads, the game loop runs on real animation frames but the clock stands still (dt = 0), so the
 // load time cannot move the hero or the hour. From start() on, frames happen only inside __qa.step.
 const realRAF=window.requestAnimationFrame.bind(window);let vt=1000,manual=false,q=[];
 // once the game has built itself (__th is set) its loop is held: frames run only inside __qa.step, so the number of frames the
 // browser happened to show while loading cannot change the state
 window.requestAnimationFrame=cb=>{if(manual||window.__th&&window.__dbg&&window.__renderer){q.push(cb);return q.length;}return realRAF(cb);};
 performance.now=()=>vt;const D0=1.7e12;Date.now=()=>D0+vt;window.__fixedStart=true; // no wall clock, no random 'mid-activity' start
 window.__qa={reseed(n){s=n>>>0;perSite=false;},start(){return new Promise(res=>{realRAF(()=>{manual=true;realRAF(()=>realRAF(()=>res(q.length)));});});},now:()=>vt,frame:0,
  step(n,dt,each){for(let i=0;i<n;i++){vt+=dt*1000;const cb=q;q=[];for(const c of cb)c(vt);this.frame++;if(each)each(this.frame);}}};
};
async function open({seed=1,vp={width:640,height:640},log=false,query=''}={}){
 const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:vp,deviceScaleFactor:1});p.setDefaultTimeout(600000);
 const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));if(log)console.log('[page]',m.text().slice(0,200));});
 await p.addInitScript(INIT,seed);
 await p.route(ORIGIN+'/**',async r=>{const u=new URL(r.request().url());const f=path.join(GAME,decodeURIComponent(u.pathname));
  if(!f.startsWith(GAME)||!fs.existsSync(f))return r.fulfill({status:404,body:''});
  let body=fs.readFileSync(f);const ext=path.extname(f);
  if(ext==='.html'){let t=body.toString();
   // expose renderer, camera and composer for on-demand rendering
   t=t.replace(/(const renderer=new THREE\.WebGLRenderer\([^;]*\);)/,'$1window.__renderer=renderer;');
   t=t.replace(/(const composer=new EffectComposer\(renderer\);)/,'$1window.__qaComposer=composer;window.__qaCamera=camera;');body=t;}
  const ct={'.html':'text/html','.js':'application/javascript','.txt':'text/plain','.jpg':'image/jpeg','.png':'image/png','.json':'application/json'}[ext]||'application/octet-stream';
  r.fulfill({body,contentType:ct});});
 await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
 await p.goto(ORIGIN+'/index.html'+(query||''));try{await p.waitForLoadState('networkidle',{timeout:120000});}catch(e){}await p.waitForFunction(()=>window.__th&&window.__dbg&&window.__renderer,null,{timeout:600000});
 await p.evaluate(()=>{const R=window.__renderer;const real=R.render;window.__realRender=real;
  window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:real;};__noRender(true);});
 return {b,p,errs};
}
module.exports={open};
