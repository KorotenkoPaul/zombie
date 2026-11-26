// Animation QA harness: loads game/index.html in headless Chromium with
//  * files served straight from disk (no web server needed),
//  * a seeded Math.random (same seed => same day),
//  * a virtual clock: performance.now and requestAnimationFrame are driven by __qa.step(n, dt),
//    so the whole game advances at an exact fixed timestep,
//  * rendering switched off while simulating (SwiftShader draws this scene at <1 fps); __qa.shot() renders on demand.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const GAME=path.resolve(__dirname,'../../game');const ORIGIN='http://zombie.qa';
// Random call sites, keyed so that a line added elsewhere in a file does not move them: every line of the game's own files that
// mentions 'random' gets the key <hash of its trimmed text>:<how many identical lines came before it in that file>. A call from any
// other line (an alias of Math.random) falls back to file|function|column, which also survives lines added above it.
function siteKeys(){const out={};const walk=d=>{for(const n of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,n.name);if(n.isDirectory()){walk(f);continue;}
  if(!/\.(m?js|html)$/.test(n.name))continue;const rel='/'+path.relative(GAME,f).split(path.sep).join('/');const seen=new Map(),m={};
  fs.readFileSync(f,'utf8').split('\n').forEach((ln,i)=>{if(!/random/i.test(ln))return;const t=ln.trim();const k=(seen.get(t)||0);seen.set(t,k+1);
   let h=2166136261>>>0;for(let j=0;j<t.length;j++){h^=t.charCodeAt(j);h=Math.imul(h,16777619)>>>0;}m[i+1]=h.toString(36)+':'+k;});
  if(Object.keys(m).length)out[rel]=m;}};walk(GAME);return out;}
const INIT=([seed,KEYS])=>{ // runs before any page script
 let s=seed>>>0;const rand=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
 // While loading, assets arrive in a different order each time, so one shared random stream would hand out different numbers
 // to the same code. Each call site gets its own stream (keyed below), during load and at run time; reseed() restarts them all.
 const sites=new Map();let perSite=true,base=seed>>>0;
 const keyOf=fr=>{const m=/^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/.exec(fr);if(!m)return fr;let u=m[2];try{u=new URL(u).pathname;}catch(e){}
   const k=KEYS[u]&&KEYS[u][m[3]];return k?u+'#'+k:u+'|'+(m[1]||'')+'|'+m[4];};
 const siteRand=()=>{const S_=new Error().stack.split('\n');const st=keyOf(S_[3]||'')+'<'+keyOf(S_[4]||'');/* the caller's caller too: a shared helper (rnd/pick in index.html, also used by sounds that only play once audio has decoded, in real time) gave all its users one stream */let r=sites.get(st);if(!r){let h=2166136261>>>0;for(let i=0;i<st.length;i++){h^=st.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
   let z=(h^base)>>>0;r=()=>{z=(z+0x6D2B79F5)>>>0;let t=z;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};sites.set(st,r);}return r();};
 Math.random=()=>perSite?siteRand():rand();
 // While the page loads, the game loop runs on real animation frames but the clock stands still (dt = 0), so the
 // load time cannot move the hero or the hour. From start() on, frames happen only inside __qa.step.
 const realRAF=window.requestAnimationFrame.bind(window);let vt=1000,manual=false,q=[];
 // once the game has built itself (__th is set) its loop is held: frames run only inside __qa.step, so the number of frames the
 // browser happened to show while loading cannot change the state
 window.requestAnimationFrame=cb=>{if(manual||window.__th&&window.__dbg&&window.__renderer){q.push(cb);return q.length;}return realRAF(cb);};
 performance.now=()=>vt;const D0=1.7e12;Date.now=()=>D0+vt;window.__fixedStart=true; // no wall clock, no random 'mid-activity' start
 // timers: from start() on, setTimeout/setInterval run on the virtual clock inside __qa.step (due ones before that frame's rAF
 // callbacks, in due order). Real timers fired whenever the page got a breather between steps, so a 100 ms poll (hero.js a.leave)
 // released the next action after a different number of frames under CPU load: the gate was bistable when two ran at once.
 const rST=window.setTimeout.bind(window),rCT=window.clearTimeout.bind(window),rSI=window.setInterval.bind(window),rCI=window.clearInterval.bind(window);
 let TQ=[],tseq=0;const TB=1e7;
 const vAdd=(f,ms,a,every)=>{const id=TB+(++tseq);TQ.push({id,at:vt+Math.max(0,+ms||0),f,a,every});return id;};
 const vClr=id=>{if(id>TB){TQ=TQ.filter(t=>t.id!==id);return true;}return false;};
 // timers set while loading run on real time until start(), then move to the virtual clock with the delay they were given
 // (degWarm's 150 ms setInterval in index.html kept compiling on real time during the run: the gate split by CPU load)
 const RT=new Map(),R2V=new Map();
 const realT=(f,ms,a,every)=>{if(typeof f!=='function')return every?rSI(f,ms,...a):rST(f,ms,...a);let id;const g=every?(...x)=>f(...x):(...x)=>{RT.delete(id);f(...x);};id=every?rSI(g,ms,...a):rST(g,ms,...a);RT.set(id,{f,ms,a,every});return id;};
 const migrate=()=>{for(const [id,t] of RT){if(t.every)rCI(id);else rCT(id);R2V.set(id,vAdd(t.f,t.ms,t.a,t.every?Math.max(1,+t.ms||0):0));}RT.clear();};
 window.setTimeout=(f,ms,...a)=>manual&&typeof f==='function'?vAdd(f,ms,a,0):realT(f,ms,a,0);
 window.setInterval=(f,ms,...a)=>manual&&typeof f==='function'?vAdd(f,ms,a,Math.max(1,+ms||0)):realT(f,ms,a,1);
 window.clearTimeout=id=>{if(R2V.has(id)){vClr(R2V.get(id));R2V.delete(id);return;}RT.delete(id);if(!vClr(id))rCT(id);};window.clearInterval=id=>{if(R2V.has(id)){vClr(R2V.get(id));R2V.delete(id);return;}RT.delete(id);if(!vClr(id))rCI(id);};
 const runTimers=()=>{for(let guard=0;guard<10000;guard++){let bi=-1;for(let i=0;i<TQ.length;i++){const t=TQ[i];if(t.at<=vt&&(bi<0||t.at<TQ[bi].at||(t.at===TQ[bi].at&&t.id<TQ[bi].id)))bi=i;}
   if(bi<0)return;const t=TQ[bi];if(t.every){t.at+=t.every;}else TQ.splice(bi,1);try{t.f(...t.a);}catch(e){console.error('qa timer',e&&e.message);}}};
 // GPU fences (rain.js reads its height map back asynchronously and polls a fence each frame): when the GPU finished
 // depended on CPU load, so the map arrived on a different frame. In the test every fence is done when first asked.
 try{if(window.WebGL2RenderingContext)WebGL2RenderingContext.prototype.clientWaitSync=function(){this.finish();return this.ALREADY_SIGNALED;};}catch(e){}
 window.__qa={reseed(n){s=n>>>0;base=n>>>0;sites.clear();}/* every call site keeps its own stream at run time too (keyed by its line text, reset per reseed): one more random call somewhere (a new mesh's uuid, a rain splash) no longer shifts the brain's dice */,start(){return new Promise(res=>{realRAF(()=>{manual=true;migrate();realRAF(()=>realRAF(()=>res(q.length)));});});},now:()=>vt,frame:0,
  align(G){vt=Math.ceil(vt/G)*G;return vt;},/* gate: every task starts on the same virtual time, so things that run on time (lantern sway, camera, sprites) start each task in the same phase */step(n,dt,each){for(let i=0;i<n;i++){vt+=dt*1000;runTimers();const cb=q;q=[];for(const c of cb)c(vt);this.frame++;if(each)each(this.frame);}}};
};
async function open({seed=1,vp={width:640,height:640},log=false,query=''}={}){
 const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'].concat(process.env.QA_JSFLAGS?['--js-flags='+process.env.QA_JSFLAGS]:[])});
 const p=await b.newPage({viewport:vp,deviceScaleFactor:1});p.setDefaultTimeout(600000);
 const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));if(log)console.log('[page]',m.text().slice(0,200));});
 await p.addInitScript(INIT,[seed,siteKeys()]);
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
 // the shader warm-up shows every hidden object until compileAsync ends (or 15 s): start only after it hid them again (index.html sets __warmDone)
 try{await p.waitForFunction(()=>window.__warmDone===true,null,{timeout:400000,polling:500});}catch(e){console.warn('anim: no __warmDone after 400 s, hidden objects may be visible');}
 await p.evaluate(()=>{const R=window.__renderer;const real=R.render;window.__realRender=real;
  window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:real;};__noRender(true);});
 return {b,p,errs};
}
module.exports={open};
