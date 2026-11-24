// Film the hero's walk from 4 sides (front, left, back, right relative to his own heading) out of a recorded scenario
// (tests/mm/scenario.js frames.json.gz, which stores local bone quaternions). Only the hero model on a grid: fast, and the
// legs, feet and arms are easy to judge. The hero's previous foot positions are left as dots (sliding shows as smears).
// node tests/gait/film.js frames.json.gz OUTDIR --from F --to F [--k 2] [--glb hero.glb] [--three node_modules] [--size 300]
//  -> OUTDIR/film.mp4, OUTDIR/film.gif, OUTDIR/sheet.jpg (6 moments x 4 sides)
const fs=require('fs'),zlib=require('zlib'),path=require('path');const {chromium}=require('playwright');const {execSync}=require('child_process');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const [inp,out]=process.argv.slice(2);const D=JSON.parse(zlib.gunzipSync(fs.readFileSync(inp)));
const from=+arg('from',-1e12),to=+arg('to',1e12),K=+arg('k',2),S=+arg('size',300);
const NM=path.resolve(arg('three','node_modules'));const GLB=path.resolve(arg('glb','hero.glb'));
const LQ=['Hips','Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightUpLeg','RightLeg','RightFoot','RightToeBase'];
const HTML=`<!doctype html><html><body style="margin:0"><canvas id=c></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
const S=${S};const R=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true,preserveDrawingBuffer:true});R.setSize(S*4,Math.round(S*1.25));R.autoClear=false;
const sc=new THREE.Scene();sc.background=new THREE.Color(0xe8e4dc);sc.add(new THREE.HemisphereLight(0xffffff,0x886644,2.0));const dl=new THREE.DirectionalLight(0xffffff,1.6);dl.position.set(2,4,3);sc.add(dl);
const grid=new THREE.GridHelper(40,160,0x9a948a,0xc4beb4);sc.add(grid);
const g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/hero.glb');const m=g.scene;sc.add(m);const bn={};m.traverse(o=>{if(o.isBone)bn[o.name.replace('mixamorig','').replace(':','')]=o;if(o.isMesh)o.frustumCulled=false;});
const dots=[];const dg=new THREE.SphereGeometry(.012,6,4);const dmL=new THREE.MeshBasicMaterial({color:0x2255cc}),dmR=new THREE.MeshBasicMaterial({color:0xcc3322});
const cams=[0,Math.PI/2,Math.PI,-Math.PI/2].map(()=>new THREE.PerspectiveCamera(24,S/(S*1.25),.1,100));
window.show=(p)=>{for(const k in p.q)bn[k]&&bn[k].quaternion.fromArray(p.q[k]);bn.Hips.position.fromArray(p.hips);m.position.set(p.x,p.y,p.z);m.rotation.y=p.ry;m.updateMatrixWorld(true);
 grid.position.set(Math.round(p.x*4)/4,p.gy,Math.round(p.z*4)/4);
 for(const s of ['Left','Right']){const f=bn[s+'Foot'].getWorldPosition(new THREE.Vector3());const d=new THREE.Mesh(dg,s==='Left'?dmL:dmR);d.position.set(f.x,p.gy+.003,f.z);sc.add(d);dots.push(d);}
 while(dots.length>240)sc.remove(dots.shift());
 R.clear();cams.forEach((c,i)=>{const a=p.cy+[0,Math.PI/2,Math.PI,-Math.PI/2][i];const d=5.2;c.position.set(p.x+Math.sin(a)*d,p.gy+.95,p.z+Math.cos(a)*d);c.lookAt(p.x,p.gy+.72,p.z);
  R.setViewport(i*S,0,S,Math.round(S*1.25));R.setScissor(i*S,0,S,Math.round(S*1.25));R.setScissorTest(true);R.render(sc,c);});return true;};
window.ready=true;
</script></body></html>`;
(async()=>{fs.mkdirSync(out+'/raw',{recursive:true});for(const f of fs.readdirSync(out+'/raw'))fs.unlinkSync(out+'/raw/'+f);
 const fr=D.frames.filter(f=>f.f>=from&&f.f<=to&&f.lq);if(!fr.length)throw new Error('no frames with lq in range');
 const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const p=await b.newPage({viewport:{width:S*4,height:Math.round(S*1.25)},deviceScaleFactor:1});
 await p.route('http://v/**',r=>{const u=new URL(r.request().url()).pathname;if(u==='/')return r.fulfill({body:HTML,contentType:'text/html'});
  const f=u.startsWith('/three/')?path.join(NM,u):u==='/hero.glb'?GLB:null;if(!f||!fs.existsSync(f))return r.fulfill({status:404,body:''});
  r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':'application/octet-stream'});});
 await p.goto('http://v/');await p.waitForFunction(()=>window.ready,null,{timeout:120000});
 // camera yaw follows the hero's heading, smoothed (half-life 0.5 s) so the views do not whip around on turns
 let cy=fr[0].ry;let n=0;const gy0=[];
 for(let i=0;i<fr.length;i++){const f=fr[i];let d=f.ry-cy;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;cy+=d*(1-Math.pow(.5,(1/60)/.5));
  if(i%K)continue;const q={};LQ.forEach((nm,j)=>q[nm]=f.lq[j]);const gy=f.gnd&&f.gnd[0]!=null?Math.min(f.gnd[0],f.gnd[2]??f.gnd[0]):f.root[1];
  await p.evaluate(a=>show(a),{q,hips:f.hp,x:f.root[0],y:f.root[1],z:f.root[2],ry:f.ry,cy,gy});
  await p.locator('canvas').screenshot({path:`${out}/raw/${String(n++).padStart(5,'0')}.png`});}
 await b.close();
 const fps=Math.round(60/K);
 execSync(`ffmpeg -y -loglevel error -framerate ${fps} -i ${out}/raw/%05d.png -pix_fmt yuv420p -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" ${out}/film.mp4`);
 execSync(`ffmpeg -y -loglevel error -framerate ${fps} -i ${out}/raw/%05d.png -vf "fps=15,scale=${S*2}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" ${out}/film.gif`);
 const pick=[0,1,2,3,4,5].map(k=>Math.round((n-1)*k/5));
 execSync(`python3 -c "
from PIL import Image
fs=[Image.open('${out}/raw/%05d.png'%k) for k in ${JSON.stringify(pick)}]
w,h=fs[0].size;o=Image.new('RGB',(w,h*len(fs)))
for i,f in enumerate(fs):o.paste(f,(0,i*h))
o.save('${out}/sheet.jpg',quality=85)"`);
 console.log('filmed',n,'frames ->',out);})().catch(e=>{console.error(e);process.exit(2);});
