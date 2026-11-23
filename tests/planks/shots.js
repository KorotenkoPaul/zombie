// close-ups of the floors/walls for the plank pass. usage: node shots.js outdir [hour]
const {open}=require('../../critic/harness/lib');const O=process.argv[2];const H=+(process.argv[3]||21.5);
const HY=1.0;const KT=5.0+HY,BD=7.4+HY,WS=3.6+HY,DK=9.0+HY,LG=2.3;
const shots=[['kitchen_floor',[-2.4,KT+.3,2.6,2.6],[0,.55]],['kitchen',[-2.6,KT+.8,5.0,1.9],[0,.18]],['bedroom_wall',[-2.1,BD+.9,3.6,1.6],[0,.08]],['workshop',[2.9,WS+.6,3.6,2.4],[.3,.4]],['landing',[-.5,LG+.3,4.0,2.2],[0,.5]],['deck',[2.6,DK+.3,3.5,1.6],[-.3,.5]]];
(async()=>{const {b,p,errs}=await open({dpr:1});await p.evaluate(h=>{__th.setHour(h);if(window.__lights)for(const s of __lights.list())__lights.set(s.name,true);},H);
for(const [n,c,v] of shots){if(process.env.ONLY&&!process.env.ONLY.split(',').includes(n))continue;await p.evaluate(([c,v])=>{__th.cam(...c);__th.view(v[0],v[1],1);},[c,v]);await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log('shot',n);}
console.log(errs.join('\n'));await b.close();})();
