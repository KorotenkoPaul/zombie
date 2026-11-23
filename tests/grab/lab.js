// Grip lab: each tool put into the hero's hand while he stands idle, photographed close from three sides.
// node tests/grab/lab.js out.png [tool,tool...] [--hand Right] [--query ?hero=old] [--eval JS]
const {open}=require('../anim/lib.js');const fs=require('fs');const {execSync}=require('child_process');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
(async()=>{const out=process.argv[2];const tools=(process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:'ladle,benchHammer,knife,plankSaw,axe,broom,pencil,lantern,waterBucket,wateringCan,bow').split(',');const hand=arg('--hand','Right');
 const tmp=fs.mkdtempSync('/tmp/claude-0/lab-');const {b,p,errs}=await open({seed:1,vp:{width:300,height:300},query:arg('--query','')});
 await p.addStyleTag({content:'body>*:not(#stage){display:none!important}'});
 await p.evaluate(()=>__qa.start());await p.evaluate(e=>{__qa.reseed(7);__th.setHour(12);__dbg.HH.setBrain({tick(){}});__dbg.HH.spawn('micro');eval(e);},arg('--eval',''));await p.evaluate(()=>__qa.step(30,1/60));
 const files=[];
 for(const t of tools){await p.evaluate(([t,hand])=>{const H=__dbg.hero;const P=__props;for(const k in P.tools)if(P.tools[k].parent===__dbg.heroBones[hand+'Hand'])P.release(k);
   H.hold[hand]=null;P.grab(t,__dbg.heroBones[hand+'Hand'],{offset:new __dbg.THREE.Vector3(0,.075,.025)});H.hold[hand]={tool:t};__qa.step(20,1/60);},[t,hand]);
  for(const [vi,yaw,pit] of [[0,-1.2,.2],[1,0,.1],[2,1.4,.5]]){const f=`${tmp}/${t}_${vi}.png`;
   await p.evaluate(([hand,yaw,pit])=>{const T=__dbg.THREE;const B=__dbg.heroBones;const c=B[hand+'Hand'].getWorldPosition(new T.Vector3());const fa=B[hand+'ForeArm'].getWorldPosition(new T.Vector3());c.lerp(c.clone().add(c.clone().sub(fa).setLength(.08)),1);
    const fy=__dbg.hero.root.rotation.y+yaw,d=.42;const cam=__qaCamera;cam.position.set(c.x+Math.sin(fy)*Math.cos(pit)*d,c.y+Math.sin(pit)*d,c.z+Math.cos(fy)*Math.cos(pit)*d);cam.lookAt(c);cam.near=.03;cam.updateProjectionMatrix();if(window.__camera&&window.__camera.dof)window.__camera.dof(false);
    __qaCamera.updateMatrixWorld();__noRender(false);__qaComposer.render();__noRender(true);},[hand,yaw,pit]);
   await p.locator('canvas').first().screenshot({path:f});execSync(`convert ${f} -gravity north -fill white -undercolor '#0008' -pointsize 13 -annotate +0+3 '${t} ${vi}' ${f}`);files.push(f);}}
 execSync(`montage ${files.join(' ')} -tile 3x -geometry +2+2 ${out}`);console.log('wrote',out,errs.slice(0,3));await b.close();})();
