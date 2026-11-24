// Force one task (default ledge at 21:00) the way the brain thread suggests, watch __dbg.hero.task for a minute
// (rendering off), log console [brain] lines and __brain.trace, then shoot two sides with the s8 depth check.
// Usage: node s10.js <outdir> [task=ledge] [hour=21]
const {open,waitFrames}=require('./lib');const O=process.argv[2];const T=process.argv[3]||'ledge',H=+(process.argv[4]||21);
(async()=>{const {b,p}=await open({});const logs=[];p.on('console',m=>{const t=m.text();if(/\[brain\]|ledge/i.test(t))logs.push(t.slice(0,200));});
 await p.evaluate(h=>{const R=window.__renderer;const real=R.render;window.__noRender=on=>{R.render=on?function(s){s&&s.updateMatrixWorld&&s.updateMatrixWorld();}:real;};__noRender(true);__th.setHour(h);},H);
 await p.waitForTimeout(3000);await p.evaluate(([t,f])=>{window.__FAR=f;__th.task(t);},[T,+(process.env.FAR||0)]);const seen=[];
 for(let i=0;i<150;i++){await p.waitForTimeout(1000);const s=await p.evaluate(()=>{const h=__dbg.hero;return h.task+'/'+h.state+'/'+(h.cur&&h.cur.getClip().name)+(window.__FAR&&Math.hypot(h.root.position.x,h.root.position.z)>window.__FAR?'/FAR':'');});if(/\/FAR$/.test(s)){seen.push(i+'s '+s);break;}if(seen[seen.length-1]!==s)seen.push(i+'s '+s);if(new RegExp('^'+T+'/work/').test(s)&&!/\/(30|437|hy_idle)$/.test(s)){await p.waitForTimeout(4000);break;}}
 console.log('seen',JSON.stringify(seen));console.log('logs',JSON.stringify(logs));
 console.log('trace',JSON.stringify(await p.evaluate(()=>{const t=window.__brain&&__brain.trace;return t?(Array.isArray(t)?t.slice(-15):String(t).slice(-600)):null;})));
 const r=await p.evaluate(()=>__dbg.hero.root.position.toArray());console.log('root',JSON.stringify(r));
 for(const [s,yaw] of [['a',-.55],['b',.6]]){await p.evaluate(([r,yaw])=>{__noRender(false);const V=__dbg.THREE.Vector3;__th.rig.set({target:new V(r[0],r[1]+.9,r[2]),yaw,pitch:.12,dist:2.6,snap:true});},[r,yaw]);await waitFrames(p,3);await p.screenshot({path:`${O}/${T}_${s}.png`});}
 await b.close();})();
