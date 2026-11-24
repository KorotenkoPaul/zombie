const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const NM=__dirname+'/node_modules/';
async function open(opts={}){
 const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:opts.vp||{width:390,height:844},deviceScaleFactor:opts.dpr||1});
 p.setDefaultTimeout(300000);const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
 if(fs.existsSync(NM))await p.route('https://cdn.jsdelivr.net/npm/**',async r=>{const u=r.request().url().replace('https://cdn.jsdelivr.net/npm/','');const m=u.match(/^(@?[^@]+)@[^/]+\/(.*)$/);const f=NM+m[1]+'/'+m[2];
  if(!fs.existsSync(f)){console.log('MISSING',f);return r.abort();}
  r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.wasm')?'application/wasm':'application/javascript'});});
 // expose the renderer instance (its render() is an own property, not on the prototype)
 await p.route(/\/index\.html(\?.*)?$/,async r=>{const res=await r.fetch();let t=await res.text();t=t.replace(/(const renderer=new THREE\.WebGLRenderer\([^;]*\);)/,'$1window.__renderer=renderer;window.__rf=0;{const _r=renderer.render.bind(renderer);renderer.render=function(a,b){_r(a,b);window.__rf++;};}/*critic: count real frames*/');if(!process.env.GOVERNOR)t=t.replace('const PERF=createPerf({renderer,MOBILE});','const PERF=createPerf({renderer,MOBILE});PERF.addStep=()=>{};/*critic: quality governor off, SwiftShader is slow*/');r.fulfill({response:res,body:t});});
 await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
 await p.goto('http://localhost:'+(process.env.PORT||8126)+'/index.html'+(opts.q||process.env.Q||''));await p.waitForFunction(()=>window.__th,null,{timeout:300000});
 return {b,p,errs};
}
module.exports={open};
// Wait until n more frames have really been drawn (counts real renderer.render calls; a fixed pause is not enough in SwiftShader).
module.exports.waitFrames=async(p,n=2,timeout=+(process.env.WF_TIMEOUT||90000))=>{const f0=await p.evaluate(()=>window.__rf||0);try{await p.waitForFunction(t=>(window.__rf||0)>=t,f0+n,{polling:200,timeout});}catch(e){console.log('waitFrames: no new frames in',timeout,'ms (rf',f0,')');}};
