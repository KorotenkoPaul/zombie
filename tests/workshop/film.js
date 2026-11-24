// Whole-body film of a workshop task from 4 sides: node tests/workshop/film.js <task> <out.png> [--at 3,6,9] [--query ?hero=new] [--dist 2.2] [--focus Hand]
// Each row = one moment, 4 views (front, right, back, left) round the hero, plus numbers (torso lean, hand-to-target) in the label.
const {open}=require('../anim/lib.js');const fs=require('fs');const {execSync}=require('child_process');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
(async()=>{const task=process.argv[2],out=process.argv[3];const at=arg('--at','4,7,10').split(',').map(Number);const dist=+arg('--dist','1.7');const opts=JSON.parse(arg('--opts','{}'));
 const tmp=fs.mkdtempSync('/tmp/claude-0/wsfilm-');const {b,p,errs}=await open({seed:1,vp:{width:360,height:420},query:arg('--query','')});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(()=>__qa.start());await p.evaluate(process.env.PRE||'0');await p.evaluate(()=>{__qa.reseed(7);__th.setHour(11);__dbg.HH.setBrain({tick(){}});});
 await p.evaluate(([t,o,SP])=>{for(let k=0;k<4;k++){__dbg.HH.spawn(SP);__qa.step(30,1/60);const H=__dbg.hero;if(H.task===SP&&!H.inBed&&!H.seated)break;}__dbg.HH.startTask(t,o);},[task,opts,arg('--spawn','craft')]);
 const until=arg('--until','take,work').split(',');const fr=await p.evaluate(u=>{let i=0;for(;i<9000;i++){__qa.step(1,1/60);const a=__dbg.HH.act;if(a&&u.includes(a.step))break;}return i;},until);console.log('reached',until,'after',(fr/60).toFixed(1),'s');
 let t=0,files=[];const log=[];
 for(const s of at){const n=Math.round((s-t)*60);if(n>0)await p.evaluate(n=>__qa.step(n,1/60),n);t=s;
  for(const [vi,yaw,el] of (process.env.VIEWS?JSON.parse(process.env.VIEWS):[[0,0,.35],[1,Math.PI/2,.35],[2,Math.PI,.35],[3,-Math.PI*.7,.9]])){const f=`${tmp}/s${String(s).padStart(5,'0')}_${vi}.png`;
   const info=await p.evaluate(([yaw,dist,focus,el])=>{const T=__dbg.THREE;const B=__dbg.heroBones;const H=__dbg.hero;const r=H.root.position;
    const c=focus?B[focus].getWorldPosition(new T.Vector3()):r.clone().add(new T.Vector3(0,1.05,0));const fy=H.root.rotation.y+(Array.isArray(yaw)?0:yaw);
    const cam=__qaCamera;if(Array.isArray(yaw)){cam.position.set(...yaw[0]);c.set(...yaw[1]);}else cam.position.set(c.x+Math.sin(fy)*dist,c.y+el,c.z+Math.cos(fy)*dist);cam.lookAt(c);cam.near=.05;cam.updateProjectionMatrix();if(window.__camera&&window.__camera.dof)window.__camera.dof(false);
    // hide whatever stands between the camera and him (walls, roof, leaves), more than 0.7 m from him
    cam.updateMatrixWorld();const hid=[];const rc=new T.Raycaster();rc.camera=cam;const tgts=[c,r.clone().add(new T.Vector3(0,.3,0)),r.clone().add(new T.Vector3(0,1.4,0))];
    for(const tg of tgts)for(let k=0;k<4;k++){const d=tg.clone().sub(cam.position);const L=d.length();rc.set(cam.position,d.normalize());rc.far=L;const hits=rc.intersectObjects(__dbg.hero.root.parent.children,true);
     let any=false;for(const h of hits){let o=h.object;if(h.distance>L-.7)break;let isHero=false;for(let x=o;x;x=x.parent)if(x===H.root)isHero=true;if(isHero||!o.visible)continue;o.visible=false;hid.push(o);any=true;break;}if(!any)break;}
    __noRender(false);__qaComposer.render();__noRender(true);for(const o of hid)o.visible=true;
    const hip=B.Hips.getWorldPosition(new T.Vector3()),nk=(B.Neck||B.Spine2).getWorldPosition(new T.Vector3());const lean=Math.round(Math.acos(Math.min(1,(nk.y-hip.y)/nk.distanceTo(hip)))*57.3);
    const A=__dbg.HH.act;return `${H.task||''} ${A&&A.step||''} ${H.cur?H.cur.getClip().name:''} lean${lean}`;},[yaw,dist,arg('--focus',null),el]);
   await p.locator('canvas').first().screenshot({path:f});if(vi===0)log.push(s+'s '+info);
   execSync(`convert ${f} -gravity north -fill white -undercolor '#0008' -pointsize 13 -annotate +0+4 '${s}s v${vi} ${info.replace(/'/g,'')}' ${f}`);files.push(f);}}
 execSync(`montage ${files.join(' ')} -tile 4x -geometry +2+2 ${out}`);console.log('wrote',out);console.log(log.join('\n'));console.log(errs.slice(0,3));await b.close();})();
