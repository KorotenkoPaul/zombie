const {open}=require('./lib');const O=process.argv[2];
const KT=5.0,BD=7.4,WS=3.6,DK=9.0,LG=1.6;
const shots=[['kitchen',[-2.6,KT+.8,6.5,1.9],[0,.15]],['bedroom',[-2.1,BD+.9,6.5,1.9],[0,.15]],['chair_read',[-.58,BD+.6,3.2,2.3],[.5,.2]],['chair_side',[-.58,BD+.6,3.2,2.3],[-.9,.15]],['workshop',[2.9,WS+.9,6.5,2.1],[0,.15]],['tools',[2.6,WS+1.1,3.0,1.6],[0,.05]],['deck',[2.6,DK+.6,7,1.2],[0,.2]],['trunk_base',[.8,LG+.4,8,2],[0,.12]],['roots_ground',[0,.6,16,2],[0,.25]],['side_left',[0,6,26,1],[1.3,.15]],['back',[0,6,26,1],[3.1,.15]],['side_right',[0,6,26,1],[-1.3,.15]]];
(async()=>{const {b,p,errs}=await open({});await p.evaluate(()=>__th.setHour(19.6));
for(const [n,c,v] of shots){await p.evaluate(([c,v])=>{__th.cam(...c);__th.view(v[0],v[1],1);},[c,v]);await p.waitForTimeout(2200);await p.screenshot({path:O+'/'+n+'.png'});}
console.log(errs.join('\n'));await b.close();})();
