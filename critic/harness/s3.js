// routine pass: per-frame sampling of hips/feet, jump detection, foot penetration via raycast
const {open}=require('./lib');const O=process.argv[2];const fs=require('fs');
(async()=>{const {b,p,errs}=await open({});
await p.evaluate(()=>{const {hero,heroBones,THREE}=window.__dbg;const rc=new THREE.Raycaster();const scene=(()=>{let o=hero.root;while(o.parent)o=o.parent;return o;})();
 const names=Object.keys(heroBones);window.__bn=names;
 const pick=k=>heroBones[names.find(n=>n.toLowerCase().includes(k))];
 const H=pick('hips'),LF=names.find(n=>/lefttoe|left_toe|lefttoebase/i.test(n))||names.find(n=>/leftfoot/i.test(n)),RF=names.find(n=>/righttoe|right_toe/i.test(n))||names.find(n=>/rightfoot/i.test(n));
 const LFb=heroBones[names.find(n=>/leftfoot/i.test(n))],RFb=heroBones[names.find(n=>/rightfoot/i.test(n))];
 window.__log=[];let prev=null;const v=new THREE.Vector3(),w=new THREE.Vector3();
 const hitY=(p)=>{rc.set(new THREE.Vector3(p.x,p.y+0.6,p.z),new THREE.Vector3(0,-1,0));rc.far=1.5;const hs=rc.intersectObjects(scene.children,true).filter(h=>{let o=h.object;while(o){if(o===hero.root)return false;o=o.parent;}return h.object.visible&&!h.object.isSprite&&!h.object.isPoints;});return hs.length?hs[0].point.y:null;};
 let fi=0;
 const tick=()=>{fi++;const t=performance.now();H.getWorldPosition(v);const hp=v.clone();
  const r=hero.root.position.clone();const rec={t,task:hero.task,state:hero.state,clip:hero.cur?hero.cur.getClip().name:'',lad:hero.lad?hero.lad.phase:'',hip:[hp.x,hp.y,hp.z],root:[r.x,r.y,r.z],ry:hero.root.rotation.y};
  if(fi%3==0){const f=[];for(const fb of [LFb,RFb]){fb.getWorldPosition(w);const y=hitY(w);f.push([w.y,y]);}rec.feet=f;}
  window.__log.push(rec);requestAnimationFrame(tick);};requestAnimationFrame(tick);
 return names;});
const seq=[['read',11],['cook',8],['wash',9],['tea',13],['craft',10],['look',16],['read',19],['sleep',22.5]];
let shotN=0;
for(const [task,h] of seq){await p.evaluate(([t,h])=>{__th.setHour(h);__th.task(t);},[task,h]);
 for(let i=0;i<120;i++){await p.waitForTimeout(500);const s=await p.evaluate(()=>{const h=__dbg.hero;return {task:h.task,path:h.path.length,state:h.state,rm:!!h.rm,lad:!!h.lad,bed:!!h.inBed}});
  if(i==20||i==50){}
  if(s.path==0&&!s.rm&&!s.lad&&s.state!=='trans'&&i>6){await p.waitForTimeout(2500);
   const rp=await p.evaluate(()=>__dbg.hero.root.position.toArray());
   for(const [k,yw] of [['a',.4],['b',-1.0]]){await p.evaluate(([rp,yw])=>{__th.cam(rp[0],rp[1]+.8,3.2,rp[2]);__th.view(yw,.18,1);},[rp,yw]);await p.waitForTimeout(1200);await p.screenshot({path:`${O}/task_${task}_${h}_${k}.png`});}
   await p.evaluate(()=>__th.cam());break;}}
 console.log(task,'done');}
const log=await p.evaluate(()=>window.__log);fs.writeFileSync(O+'/log.json',JSON.stringify(log));
console.log(errs.join('\n'));await b.close();})();
