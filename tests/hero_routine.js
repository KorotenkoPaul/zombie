const {chromium}=require('playwright');const O=__dirname+'/';
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push('PE '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,300))});
await p.goto('http://localhost:8126/index.html');await p.waitForFunction(()=>window.__th,null,{timeout:240000});
await p.evaluate(()=>{__th.setHour(11);window.__TS=2;__th.task('look');});
let last='',sh=0;for(let i=0;i<140;i++){await p.waitForTimeout(400);const st=await p.evaluate(()=>{const h=window.__dbg.hero;return [h.task,h.path.length?h.path[0].node:'-',h.lad?h.lad.phase:'',h.rm?'rm':'',h.state,h.cur?h.cur.getClip().name:'',+h.root.position.x.toFixed(2),+h.root.position.y.toFixed(2),+h.root.position.z.toFixed(2)];});
 const k=st.slice(0,6).join('|');if(k!==last){console.log(JSON.stringify(st));last=k;}
 if(st[2]==='finish'&&sh<3){await p.evaluate(()=>{__th.cam(1.3,8.8,4.4,3.0);__th.view(.6,.12,1);});await p.screenshot({path:O+'f'+sh+'.png'});sh++;}
 if(st[0]==='look'&&st[1]==='-'&&st[4]!=='trans'&&i>15)break;}
await p.evaluate(()=>{__th.cam(undefined);__th.setHour(22.5);__th.task('sleep');});
last='';for(let i=0;i<160;i++){await p.waitForTimeout(400);const st=await p.evaluate(()=>{const h=window.__dbg.hero;return [h.task,h.path.length?h.path[0].node:'-',h.lad?h.lad.phase:'',h.rm?'rm':'',h.state,h.cur?h.cur.getClip().name:'',+h.root.position.x.toFixed(2),+h.root.position.y.toFixed(2),+h.root.position.z.toFixed(2),!!h.inBed];});
 const k=st.slice(0,6).join('|');if(k!==last){console.log(JSON.stringify(st));last=k;} if(st[9]&&st[1]==='-'&&i>10){await p.waitForTimeout(3000);break;}}
await p.evaluate(()=>{__th.cam(-2.4,8.3,3.6,2.4);__th.view(.3,.2,1);});await p.waitForTimeout(1500);await p.screenshot({path:O+'f5.png'});
console.log(errs.join('\n'));await b.close();})();
