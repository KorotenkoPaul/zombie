// Ground & vegetation: forest floor, grass, moss, ferns, fallen leaves, twigs, stones, mushrooms, bushes.
// Owned by the "ground & vegetation" thread. index.html calls createGround() once, right after the oak is built.
// Everything is instanced (a handful of draw calls) and keeps clear of the oak's roots: the roots are read from the
// tree meshes at load time, so the plants follow whatever trunk/roots tree.js builds.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundH as groundH0 } from './env.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

function rng(seed){let s=seed>>>0;return ()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
function hash2(x,y){const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);}
function vnoise(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);
 const a=hash2(ix,iy),b=hash2(ix+1,iy),c=hash2(ix,iy+1),d=hash2(ix+1,iy+1);return a+(b-a)*ux+(c-a)*uy+(a-b-c+d)*ux*uy;}
function fbm2(x,y){return vnoise(x,y)*.55+vnoise(x*2.1+5.2,y*2.1+1.3)*.3+vnoise(x*4.3+9.1,y*4.3+3.7)*.15;}
const GLSL_NOISE=`
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,7.7);a*=.5;}return v;}`;

// wind sway shared by all plants: k = how far up the plant this vertex is (0 root .. 1 tip)
// [WIND] the motion comes from the global wind (game/wind.js): calm spells, breezes and gusts that roll through
// the clearing. SW is the sway of a 1-unit plant at a steady breeze; bigger instances sway more, like before.
const SWAY=`vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);
 vec2 wv=windSway(ip,1.7)*SW*k*k*1.6;
 transformed+=windLocal(vec3(wv.x,0.,wv.y))*length(instanceMatrix[0].xyz);`;
let WIND=null;// set by createGround (C.wind)
const windHook=s=>{(WIND||window.__wind).hook(s);};
function swayMat(mat,U,amp,kExpr){mat.onBeforeCompile=s=>{windHook(s);
 s.vertexShader=s.vertexShader
  .replace('#include <begin_vertex>',`#include <begin_vertex>\n{float k=${kExpr};const float SW=${amp.toFixed(3)};${SWAY}}`);};return mat;}

// three's icosahedron has split vertices (flat facets); weld them so moss and stones shade smoothly
// double-sided foliage: keep the sky-bent normal on both faces (three flips it on the back face, which turned blades black)
const NOFLIP=s=>{s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;','normal *= mix(1.,faceDirection,.15);'));};
const smoothIco=d=>{const g=new THREE.IcosahedronGeometry(1,d);g.deleteAttribute('normal');g.deleteAttribute('uv');return mergeVertices(g);};

export function createGround(C){
 const {scene,MOBILE,leafT,groundT,U,obstacles=[]}=C;WIND=C.wind||null;
 const R=rng(777123);const rr=(a,b)=>a+R()*(b-a);
 let moundAt=()=>0,reliefAt=()=>0;const groundH=(x,z)=>groundH0(x,z)+moundAt(x,z)+reliefAt(x,z);
 const G={};

 // ================= roots map =================
 // A 0.25 m grid over the clearing. Every bark vertex near the ground marks its cell, then a distance field tells
 // each spot how far it is from the trunk/roots: plants stay out of the wood, grass and moss crowd along its edges,
 // and the ground gets a soft contact shadow under the roots.
 const GS=128,GE=16,CELL=GE*2/GS;const occ=new Uint8Array(GS*GS);const minY=new Float32Array(GS*GS).fill(99);const dist=new Float32Array(GS*GS).fill(99);
 {const v=new THREE.Vector3();
  for(const o of obstacles)o.traverse(m=>{if(!m.isMesh||m.isInstancedMesh||!m.geometry)return;const p=m.geometry.attributes.position;if(!p)return;m.updateWorldMatrix(true,false);
   for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);if(Math.abs(v.x)>=GE||Math.abs(v.z)>=GE)continue;
    if(v.y>groundH0(v.x,v.z)+.9)continue;const gx=Math.floor((v.x+GE)/CELL),gz=Math.floor((v.z+GE)/CELL);occ[gz*GS+gx]=1;minY[gz*GS+gx]=Math.min(minY[gz*GS+gx],v.y-groundH0(v.x,v.z));}});
  // vertices are sparse on big roots: close small gaps (one dilate + erode pass would eat thin roots, so only fill holes)
  const o2=occ.slice();for(let z=1;z<GS-1;z++)for(let x=1;x<GS-1;x++){if(occ[z*GS+x])continue;let n=0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)n+=occ[(z+dz)*GS+x+dx];if(n>=4)o2[z*GS+x]=1;}occ.set(o2);
  // chamfer distance transform (metres)
  for(let i=0;i<GS*GS;i++)if(occ[i])dist[i]=0;
  const d1=CELL,d2=CELL*1.4142;
  for(let z=0;z<GS;z++)for(let x=0;x<GS;x++){const i=z*GS+x;let d=dist[i];if(x>0)d=Math.min(d,dist[i-1]+d1);if(z>0){d=Math.min(d,dist[i-GS]+d1);if(x>0)d=Math.min(d,dist[i-GS-1]+d2);if(x<GS-1)d=Math.min(d,dist[i-GS+1]+d2);}dist[i]=d;}
  for(let z=GS-1;z>=0;z--)for(let x=GS-1;x>=0;x--){const i=z*GS+x;let d=dist[i];if(x<GS-1)d=Math.min(d,dist[i+1]+d1);if(z<GS-1){d=Math.min(d,dist[i+GS]+d1);if(x<GS-1)d=Math.min(d,dist[i+GS+1]+d2);if(x>0)d=Math.min(d,dist[i+GS-1]+d2);}dist[i]=d;}}
 // distance from (x,z) to the nearest root/trunk, in metres (99 = far away / outside the map)
 const rootD=(x,z)=>{if(Math.abs(x)>=GE-CELL||Math.abs(z)>=GE-CELL)return 99;const fx=(x+GE)/CELL-.5,fz=(z+GE)/CELL-.5;const ix=Math.max(0,Math.floor(fx)),iz=Math.max(0,Math.floor(fz));const tx=fx-ix,tz=fz-iz;
  const a=dist[iz*GS+ix],b=dist[iz*GS+ix+1],c=dist[(iz+1)*GS+ix],d=dist[(iz+1)*GS+ix+1];return (a*(1-tx)+b*tx)*(1-tz)+(c*(1-tx)+d*tx)*tz-CELL*.5;};
 G.rootD=rootD;
 // ---- soil mounds: wherever the underside of a root sits above the ground, the earth is heaped up to meet it and
 // slopes gently away (~20 cm per metre), so no root hangs in the air at any zoom. Only right at the wood (<1 m),
 // so the paths the hero walks stay flat.
 {const mh=new Float32Array(GS*GS);for(let i=0;i<GS*GS;i++)if(occ[i]&&minY[i]<99)mh[i]=Math.min(.3,Math.max(0,minY[i]+.04));
  const dec=CELL*.2,dec2=dec*1.4142;
  for(let z=1;z<GS-1;z++)for(let x=1;x<GS-1;x++){const i=z*GS+x;mh[i]=Math.max(mh[i],mh[i-1]-dec,mh[i-GS]-dec,mh[i-GS-1]-dec2,mh[i-GS+1]-dec2);}
  for(let z=GS-2;z>0;z--)for(let x=GS-2;x>0;x--){const i=z*GS+x;mh[i]=Math.max(mh[i],mh[i+1]-dec,mh[i+GS]-dec,mh[i+GS+1]-dec2,mh[i+GS-1]-dec2);}
  for(let i=0;i<GS*GS;i++)mh[i]*=smooth(1.1,.5,dist[i]);
  moundAt=(x,z)=>{if(Math.abs(x)>=GE-CELL||Math.abs(z)>=GE-CELL)return 0;const fx=(x+GE)/CELL-.5,fz=(z+GE)/CELL-.5;const ix=Math.max(0,Math.floor(fx)),iz=Math.max(0,Math.floor(fz));const tx=fx-ix,tz=fz-iz;
   return (mh[iz*GS+ix]*(1-tx)+mh[iz*GS+ix+1]*tx)*(1-tz)+(mh[(iz+1)*GS+ix]*(1-tx)+mh[(iz+1)*GS+ix+1]*tx)*tz;};}
 G.heightAt=groundH;
 // ---- the hero's trodden path: from the foot of the ground rope ladder (x 0, z 4) out into the clearing ----
 const PATH=[[0,4.3],[.5,5.6],[1.4,7.2],[1.2,9],[.2,10.8],[-.6,12.6],[-.4,14.5]];
 const pathMain=(x,z)=>{let best=99;for(let i=0;i<PATH.length-1;i++){const [ax,az]=PATH[i],[bx,bz]=PATH[i+1];const dx=bx-ax,dz=bz-az;const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t));}
  // the path widens where he steps off the ladder and frays out at its far end
  const w=.28+.25*smooth(1.5,0,Math.hypot(x,z-4.3))-.15*smooth(12,15,z)+(vnoise(x*1.7,z*1.7)-.5)*.18;return best-w;};
 // ---- the way out to the forest: branches off the path below the ladder, crosses the right side of the clearing and slips
 // through a gap in the undergrowth (the hero goes out for firewood and to hunt, and comes back the same way) ----
 const EXIT=[[1.4,7.2],[3.4,7.7],[6.1,7.4],[8.9,6.6],[11.6,5.8],[14.2,5.1],[17.4,4.6],[21.5,4.3]];
 const segD=(L,x,z)=>{let best=99;for(let i=0;i<L.length-1;i++){const [ax,az]=L[i],[bx,bz]=L[i+1];const dx=bx-ax,dz=bz-az;const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t));}return best;};
 // the side track is narrower and fainter than the main path (fewer trips), widening a little where it meets it
 const exitD=(x,z)=>segD(EXIT,x,z)-(.2+.06*smooth(3,0,Math.hypot(x-1.4,z-7.2))+(vnoise(x*1.9+4,z*1.9)-.5)*.16);
 const pathD=(x,z)=>Math.min(pathMain(x,z),exitD(x,z));
 // the gap in the bushes: keep a 3 m wide corridor clear from the clearing's edge out into the trees
 const exitClear=(x,z)=>segD([[11.6,5.8],[14.2,5.1],[17.4,4.6],[21.5,4.3],[30,4]],x,z)>1.6;
 G.pathD=pathD;G.pathMain=pathMain;
 // ---- gentle relief: low hummocks and shallow dips in the clearing (a forest floor is never a table). Baked on the 25 cm grid;
 // zero on the paths and at the ladder foot (walking heights stay as they were) and faded out before the coarse outer ground ----
 {const RH=new Float32Array(GS*GS);
  for(let gz=0;gz<GS;gz++)for(let gx=0;gx<GS;gx++){const x=(gx+.5)*CELL-GE,z=(gz+.5)*CELL-GE;
   const h=(fbm2(x*.32+17,z*.32+4)-.5)*.15+(fbm2(x*1.1+3,z*1.1+31)-.5)*.06+Math.pow(Math.max(0,fbm2(x*.7+9,z*.7)-.55),1.5)*.35;
   const keep=smooth(.05,.9,pathD(x,z))*smooth(.9,2.2,Math.hypot(x,z-4.3))*smooth(GE-1,GE-3.5,Math.max(Math.abs(x),Math.abs(z)));RH[gz*GS+gx]=h*keep;}
  reliefAt=(x,z)=>{if(Math.abs(x)>=GE-CELL||Math.abs(z)>=GE-CELL)return 0;const fx=(x+GE)/CELL-.5,fz=(z+GE)/CELL-.5;const ix=Math.max(0,Math.floor(fx)),iz=Math.max(0,Math.floor(fz));const tx=fx-ix,tz=fz-iz;
   return (RH[iz*GS+ix]*(1-tx)+RH[iz*GS+ix+1]*tx)*(1-tz)+(RH[(iz+1)*GS+ix]*(1-tx)+RH[(iz+1)*GS+ix+1]*tx)*tz;};}
 // ---- dew: grass, moss and stones get a wet moonlit sheen and tiny glints at dusk and night (follows env's evening factor) ----
 const glowU=C.shroomGlow||{value:0};const wetU={value:0};G.wet=wetU;
 // weather/time read from Environment's per-frame update (rain, morning, night) without touching env.js or index.html
 const ST={rainK:0,mornK:0,nightK:0,T:0,puddle:0};G.state=ST;
 {const E=window.__env;if(E&&E.update&&!E.__groundHook){const o=E.update;E.update=s=>{ST.rainK=s.rainK||0;ST.mornK=s.mornK||0;ST.nightK=s.nightK||0;ST.T=s.T||0;return o(s);};E.__groundHook=true;}}
 // the hero's feet: grass leans away from him when he walks through it
 const heroU={value:new THREE.Vector3(0,-99,0)};const critU={value:new THREE.Vector3(0,-99,0)};
 const wetFrag=(k)=>`{float wet=uWet*${k};roughnessFactor=mix(roughnessFactor,.32,wet);}`;
 const addWet=(s,k)=>{s.uniforms.uWet=wetU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uWet;').replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n'+wetFrag(k));};
 // contact-shadow texture for the ground shader: dark right at the wood, fading over ~1 m
 const aoTex=(()=>{const d=new Uint8Array(GS*GS*4);for(let i=0;i<GS*GS;i++){const k=1-smooth(0,1.1,dist[i]);d[i*4]=255*k;d[i*4+1]=255*(1-smooth(0,.45,Math.abs(dist[i]-.35)));const gx=i%GS,gz=(i/GS)|0;d[i*4+2]=255*smooth(.3,-.15,pathD((gx+.5)*CELL-GE,(gz+.5)*CELL-GE));d[i*4+3]=255;}
  const t=new THREE.DataTexture(d,GS,GS);t.magFilter=t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;})();

 // ================= forest floor =================
 // big mesh with heights from env.js groundH(); vertex colours give the large-scale moss / teal / earth patches,
 // the painted Fal forest floor (ground3.jpg) gives the detail at two scales, plus moss fuzz and root contact shadows.
 {const S=MOBILE?110:150;const g=new THREE.PlaneGeometry(260,260,S,S).rotateX(-Math.PI/2);const p=g.attributes.position;const col=new Float32Array(p.count*3);const c=new THREE.Color();
  const moss=new THREE.Color(0x5E8C55),teal=new THREE.Color(0x3F6B5C),earth=new THREE.Color(0x6E5A47),deep=new THREE.Color(0x36585A);
  const colAt=(x,z)=>{const r=Math.hypot(x,z);const n=fbm2(x*.08+11,z*.08+3),m=fbm2(x*.3,z*.3);
   c.copy(teal).lerp(moss,smooth(.35,.7,n));c.lerp(earth,smooth(5.,2.4,r+(m-.5)*2.5)*.6);c.lerp(deep,smooth(30,70,r)*.6);c.multiplyScalar(.82+m*.3);return c;};
  // the big mesh is coarse (1.7 m), so in the middle it sits 4 cm low and a fine 25 cm patch carries the real shape
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);const inner=Math.max(Math.abs(x),Math.abs(z))<15.6;p.setY(i,groundH0(x,z)-(inner?.1:0));colAt(x,z);
   col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
  const pg=new THREE.PlaneGeometry(32,32,MOBILE?96:128,MOBILE?96:128).rotateX(-Math.PI/2);{const pp=pg.attributes.position;const pc=new Float32Array(pp.count*3);
   for(let i=0;i<pp.count;i++){const x=pp.getX(i),z=pp.getZ(i);pp.setY(i,groundH(x,z));colAt(x,z);pc[i*3]=c.r;pc[i*3+1]=c.g;pc[i*3+2]=c.b;}
   pg.setAttribute('color',new THREE.BufferAttribute(pc,3));pg.computeVertexNormals();}
  const gt=groundT.clone();gt.needsUpdate=true;gt.repeat.set(1,1);gt.wrapS=gt.wrapT=THREE.RepeatWrapping;
  const mat=new THREE.MeshStandardMaterial({map:gt,vertexColors:true,roughness:1,metalness:0});
  mat.onBeforeCompile=s=>{s.uniforms.uAO={value:aoTex};s.uniforms.uGE={value:GE};
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvGW=(modelMatrix*vec4(position,1.)).xz;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;uniform sampler2D uAO;uniform float uGE;'+GLSL_NOISE)
    .replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.rgb=mix(diffuseColor.rgb,pathC,pathK);').replace('#include <map_fragment>',`
     // two texture scales blended by noise: no visible tiling. The far scale is softened so the painted clumps read as ground, not stickers.
     float pathK=0.;vec3 pathC=vec3(0.);
     vec4 g1=texture2D(map,vGW/4.6);vec4 g2=texture2D(map,vGW/12.7+.37);float bn=fbm(vGW*.09);vec3 gc=mix(g1.rgb,g2.rgb,smoothstep(.35,.65,bn));
     // close to the camera a finer third scale adds crisp detail (the far scales blur when you zoom in)
     vec3 g0=texture2D(map,vGW/1.5+.71).rgb;float nearK=1.-smoothstep(2.5,11.,length(vViewPosition));gc=mix(gc,g0,.6*nearK);
     vec3 gm=texture2D(map,vGW/.55+.13).rgb;gc=mix(gc,gc*(.55+3.4*dot(gm,vec3(.3,.55,.15))),.35*nearK);gc*=1.+(fbm(vGW*26.)-.5)*.3*nearK;
     float lum=dot(gc,vec3(.3,.55,.15));gc=mix(vec3(lum),gc,.82);
     // moss fuzz: fine light/dark mottling, brighter mossy cushions in patches
     float mf=fbm(vGW*2.3);float mp=smoothstep(.5,.72,fbm(vGW*.35+4.));gc*=.82+.36*mf;gc=mix(gc,gc*vec3(.95,1.18,.9)+vec3(.0,.025,.0),mp*.6);
     diffuseColor*=vec4(gc*1.85,1.);
     // roots: soft contact shadow, a ring of damp dark earth hugging the wood
     vec2 auv=(vGW+uGE)/(2.*uGE);if(auv.x>0.&&auv.x<1.&&auv.y>0.&&auv.y<1.){vec4 ao=texture2D(uAO,auv);diffuseColor.rgb*=1.-ao.r*.55;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.85,.78,.7),ao.g*.35);
      // trodden path: packed brown earth with a few pressed blades left at its frayed edges
      pathK=ao.b*smoothstep(.35,.75,ao.b+(fbm(vGW*2.3)-.5)*.8)*(.55+.25*fbm(vGW*.8));pathC=vec3(.17,.135,.1)*(.6+.7*fbm(vGW*7.))*(.65+.7*lum)*(1.-ao.r*.4);
      // grit and small pebbles pressed into the packed earth
      {vec2 pq=vGW*9.;vec2 pi=floor(pq),pf=fract(pq)-.5;float ph=fract(sin(dot(pi,vec2(41.3,289.1)))*43758.5);vec2 po=vec2(fract(ph*13.),fract(ph*71.))-.5;vec2 pe=(pf-po*.6)*vec2(1.,1.6+fract(ph*3.));float pb=smoothstep(.09,.05,length(pe)*(.8+.4*fract(ph*11.)))*step(.9,ph);pathC=mix(pathC,vec3(.22,.2,.17)*(.7+.5*fract(ph*7.)),pb*.6);pathC*=.85+.3*fbm(vGW*22.);}}`);};
  {const ob=mat.onBeforeCompile;mat.onBeforeCompile=s=>{ob(s);addWet(s,'.35');};}
  const ground=new THREE.Mesh(g,mat);ground.receiveShadow=true;scene.add(ground);G.ground=ground;
  const patch=new THREE.Mesh(pg,mat);patch.receiveShadow=true;scene.add(patch);G.groundPatch=patch;
  let lastT=performance.now();
  ground.onBeforeRender=(r,sc,cam)=>{const now=performance.now(),dt=Math.min(.1,(now-lastT)/1000);lastT=now;
   // wet: dusk and night dew, morning dew, rain; puddles fill in rain and dry slowly after it
   const want=Math.max(Math.min(1,glowU.value/1.8),ST.mornK*.9,ST.rainK);wetU.value+=(want-wetU.value)*Math.min(1,dt*1.5);
   ST.puddle=ST.rainK>.05?Math.min(1,ST.puddle+dt*ST.rainK/25):Math.max(0,ST.puddle-dt/90);if(G.updatePuddles)G.updatePuddles(cam);
   const h=window.__dbg&&window.__dbg.hero&&window.__dbg.hero.root;if(h){const p=h.position;heroU.value.set(p.x,p.y,p.z);}
   if(G.updateGrass)G.updateGrass(cam);if(G.updateFootprints)G.updateFootprints();if(G.updateLife)G.updateLife(dt,cam);};
  new THREE.TextureLoader().load(new URL('ground3.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;mat.map=t;mat.needsUpdate=true;});}

 // scatter helper: tries spots until `ok` accepts; returns [x,z] or null
 const pick=(gen,ok,tries=30)=>{for(let t=0;t<tries;t++){const s=gen();if(ok(s[0],s[1]))return s;}return null;};
 const ring=(r0,r1,zs=.9)=>()=>{const a=rr(0,Math.PI*2),r=Math.sqrt(rr(r0*r0,r1*r1));return [Math.cos(a)*r,Math.sin(a)*r*zs];};
 const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),Sc=V(),Col=new THREE.Color(),E=new THREE.Euler();
 // tilt an instance to the ground slope
 const slopeQ=(x,z,yaw)=>{const e=.3;const nx=groundH(x-e,z)-groundH(x+e,z),nz=groundH(x,z-e)-groundH(x,z+e);const n=V(nx,2*e,nz).normalize();
  const q=new THREE.Quaternion().setFromUnitVectors(V(0,1,0),n);return q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),yaw));};

 // ================= grass =================
 // Real blades, not cards: each tuft is a few curved, tapered blades (dark at the root, moonlit at the tip) with
 // normals bent towards the sky so it shades softly like the painted reference. Spiky tufts poke out of the low fog;
 // they gather along the roots and stones and thin out in the trodden earth by the trunk.
 function tuftGeo(nb,seg,seed,hMin,hMax,spread){const r=rng(seed);const P=[],N=[],Cc=[],UV=[],I=[];
  for(let b=0;b<nb;b++){const yaw=r()*6.283,lean=.15+r()*.5,h=hMin+r()*(hMax-hMin),w=.011+r()*.012,ox=(r()-.5)*spread,oz=(r()-.5)*spread,curl=(r()-.5)*.6;
   const dir=V(Math.cos(yaw),0,Math.sin(yaw)),side=V(-dir.z,0,dir.x);const base=P.length/3;const tint=.85+r()*.3;
   for(let s=0;s<=seg;s++){const t=s/seg;const bend=lean*t*t;const pc=V(ox+dir.x*bend*h+side.x*curl*t*t*h*.3,h*t*(1-.25*lean*t),oz+dir.z*bend*h+side.z*curl*t*t*h*.3);
    const ww=w*(1-t)*(1-t*.15)+.002;
    // normal: across the blade face, bent strongly to the sky
    const fn=dir.clone().multiplyScalar(-1).lerp(V(0,1,0),.75).normalize();
    // three vertices across: the middle one is pushed out along the face, so every blade has a folded midrib (a V in
    // cross-section) and never reads as a flat card, whatever the viewing angle
    for(const sd of [-1,0,1]){const cr=sd===0?ww*.9*(1-t*.6):0;P.push(pc.x+side.x*ww*sd+fn.x*cr,pc.y+fn.y*cr*.3,pc.z+side.z*ww*sd+fn.z*cr);N.push(fn.x+side.x*sd*.45,fn.y,fn.z+side.z*sd*.45);
     const k=Math.pow(t,.8),ed=sd===0?1.08:.92;Cc.push((.08+k*.3)*tint*ed,(.13+k*.42)*tint*ed,(.08+k*.22)*tint*ed);UV.push((sd+1)/2,t);}}
   for(let s=0;s<seg;s++){const a=base+s*3;I.push(a,a+1,a+3, a+1,a+4,a+3, a+1,a+2,a+4, a+2,a+5,a+4);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));g.normalizeNormals?.();
  g.setAttribute('color',new THREE.Float32BufferAttribute(Cc,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(UV,2));g.setIndex(I);return g;}
 const grassMat=swayMat(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.85,metalness:0}),U,.07,'uv.y');
 {// a little translucency: the lit tips glow a touch so tufts read against the dark ground
  const ob=grassMat.onBeforeCompile;grassMat.onBeforeCompile=s=>{ob(s);NOFLIP(s);addWet(s,'.9');s.uniforms.uHero=heroU;s.uniforms.uCrit=critU;
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform vec3 uHero;uniform vec3 uCrit;').replace('#include <project_vertex>',`{vec3 ipw=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);vec2 dv=ipw.xz-uHero.xz;float dd=length(dv);
     float f=smoothstep(.55,.1,dd)*step(abs(ipw.y-uHero.y),.6)*uv.y;vec2 pd=dd>.001?dv/dd:vec2(1.,0.);
     transformed+=windLocal(vec3(pd.x*.22,-.12,pd.y*.22)*f*length(instanceMatrix[1].xyz)*.6);
     // a hedgehog or mouse parts the grass too (smaller radius)
     vec2 cv=ipw.xz-uCrit.xz;float cd=length(cv);float cf=smoothstep(.28,.05,cd)*uv.y;vec2 cdn=cd>.001?cv/cd:vec2(1.,0.);transformed+=windLocal(vec3(cdn.x*.14,-.06,cdn.y*.14)*cf*length(instanceMatrix[1].xyz)*.6);}
    #include <project_vertex>`);
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vDew;').replace('#include <begin_vertex>','#include <begin_vertex>\nvDew=vec3(uv,instanceMatrix[3][0]*3.1+instanceMatrix[3][2]*7.7);');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vDew;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n{vec2 g=vec2(vDew.x*3.,vDew.y*48.)+vDew.z;vec2 q=floor(g),f=fract(g)-.5;f.y*=.35;float h=fract(sin(dot(q,vec2(12.9898,78.233)))*43758.5453);totalEmissiveRadiance+=vec3(.75,.85,1.)*step(.985,h)*smoothstep(.16,.03,length(f))*step(.15,vDew.y)*smoothstep(.3,.8,uWet)*.55;}');s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vColor.rgb*vColor.rgb*.06;');};}
 // variants: tall spiky (the photo's tufts), short dense, and a cheap far version
 const tuftA=tuftGeo(MOBILE?10:13,MOBILE?3:6,11,.2,.46,.1),tuftB=tuftGeo(MOBILE?8:15,MOBILE?2:4,23,.08,.2,.16),tuftF=tuftGeo(7,2,37,.22,.5,.14);
 // Grass is cut into 14 m chunks (24 m far out), one InstancedMesh per chunk and detail level, so the camera's frustum culls what is
 // off screen, and chunks far from the camera swap to a cheaper tuft (fewer blades and segments) or switch off.
 const CH=14,grassChunks=[];
 function scatterGrass(geo,lo,N,gen,size,name,far){const pts=[];let guard=0;
  while(pts.length<N&&guard++<N*40){// clumps: a seed spot, a few tufts around it
   const s=gen();const cnt=2+Math.floor(R()*6);
   for(let j=0;j<cnt&&pts.length<N;j++){const x=s[0]+rr(-.9,.9),z=s[1]+rr(-.9,.9);const d=rootD(x,z);if(d<.06)continue;const r=Math.hypot(x,z);
    // density: dense along root edges, sparse on bare trodden earth near the trunk, patchy elsewhere
    const pd=pathD(x,z);if(pd<-.05||(pd<.25&&R()<.7))continue;
    const dens=Math.max(smooth(1.4,.15,d)*.9,smooth(.38,.62,fbm2(x*.18+2,z*.18+9))*(.25+.75*smooth(3,6,r)));if(R()>dens)continue;
    const sz=rr(size[0],size[1])*(1+smooth(10,40,r)*.5);const m=new THREE.Matrix4().compose(V(x,groundH(x,z)-.02,z),slopeQ(x,z,rr(0,6.28)),V(sz*rr(.85,1.2),sz*rr(.8,1.25),sz*rr(.85,1.2)));
    const dry=smooth(.6,.85,fbm2(x*.4,z*.4+20));const c=new THREE.Color().setHSL(rr(.27,.38)-dry*.12,rr(.22,.38)-dry*.04,rr(.33,.47)+dry*.06);pts.push({x,z,m,c});}}
  const buckets=new Map();for(const p of pts){const cs=far?24:CH;const k=Math.floor(p.x/cs)+','+Math.floor(p.z/cs);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
  for(const list of buckets.values()){const mk=g=>{if(!g)return null;const im=new THREE.InstancedMesh(g,grassMat,list.length);list.forEach((p,i)=>{im.setMatrixAt(i,p.m);im.setColorAt(i,p.c);});
    im.computeBoundingSphere();im.receiveShadow=true;im.castShadow=false;im.name=name;im.visible=false;scene.add(im);return im;};
   let cx=0,cz=0;for(const p of list){cx+=p.x;cz+=p.z;}grassChunks.push({c:V(cx/list.length,0,cz/list.length),hi:mk(geo),lo:mk(lo),far,n:list.length});}}
 // detail levels: hi near the camera, lo further out, nothing past the fog
 const tuftAlo=tuftGeo(MOBILE?5:7,2,11,.2,.46,.1),tuftBlo=tuftGeo(MOBILE?4:8,MOBILE?1:2,23,.08,.2,.16);
 scatterGrass(tuftA,tuftAlo,MOBILE?380:900,ring(2.4,18),[.7,1.25],'grassTall');
 scatterGrass(tuftB,tuftBlo,MOBILE?300:800,ring(2.2,14),[.8,1.3],'grassShort');
 scatterGrass(tuftF,null,MOBILE?260:450,ring(16,48,.85),[1.3,2.1],'grassFar',true);
 G.grass=grassChunks;
 const LOD_HI=MOBILE?11:16,LOD_OFF=MOBILE?55:75;
 G.updateGrass=cam=>{for(const ch of grassChunks){const d=Math.hypot(cam.position.x-ch.c.x,cam.position.z-ch.c.z);
   if(ch.far){ch.hi.visible=d<LOD_OFF;continue;}const hi=d<LOD_HI;ch.hi.visible=hi||!ch.lo;if(ch.lo)ch.lo.visible=!hi&&d<LOD_OFF;}};

 // ================= moss cushions =================
 // soft lumpy pillows of moss where the roots meet the ground and on the sides of stones (the cosy, overgrown look)
 {const base=smoothIco(MOBILE?2:3);const p=base.attributes.position;const col=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){const v=V(p.getX(i),p.getY(i),p.getZ(i));const k=1+(vnoise(v.x*2.5+3,v.z*2.5+v.y*2)-.5)*.5;const y=v.y<0?v.y*.2:v.y*.55;p.setXYZ(i,v.x*k,y*k,v.z*k);
   const up=Math.max(0,v.y);const c=new THREE.Color(0x1C3026).lerp(new THREE.Color(0x3C6236),smooth(.1,.9,up));col.set([c.r,c.g,c.b],i*3);}
  base.computeVertexNormals();base.setAttribute('color',new THREE.BufferAttribute(col,3));
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
  mat.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMW=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;'+GLSL_NOISE).replace('#include <color_fragment>','#include <color_fragment>\n{float f=fbm(vMW.xz*14.+vMW.y*9.);float f2=fbm(vMW.xz*3.1);diffuseColor.rgb*=.6+.6*f;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.9,1.15,.8),f2*.6);}');};
  const N=MOBILE?28:55;const im=new THREE.InstancedMesh(base,mat,N);let n=0;
  for(let t=0;t<N*30&&n<N;t++){const s=pick(ring(2.2,13),(x,z)=>{const d=rootD(x,z);return d>.04&&d<.45;},6);if(!s)continue;const [x,z]=s;
   const sz=rr(.07,.18);E.set(0,rr(0,6.28),0);Q.setFromEuler(E);M.compose(V(x,groundH(x,z)-sz*.25,z),Q,Sc.set(sz*rr(.8,1.2),sz*rr(.9,1.3),sz*rr(.8,1.1)));im.setMatrixAt(n,M);G._stones=(G._stones||[]);G._stones.push([x,z,sz*.8]);
   Col.setHSL(rr(.28,.36),rr(.15,.28),rr(.42,.55));im.setColorAt(n,Col);n++;}
  im.count=n;im.receiveShadow=true;scene.add(im);G.moss=im;}

 // ================= stones =================
 {const base=smoothIco(MOBILE?3:4);const p=base.attributes.position;
  for(let i=0;i<p.count;i++){const v=V(p.getX(i),p.getY(i),p.getZ(i));const k=1+(vnoise(v.x*1.7+v.z,v.y*1.9+2)-.5)*.45+(vnoise(v.x*5,v.z*5+v.y*3)-.5)*.08;p.setXYZ(i,v.x*k*1.15,(v.y<0?v.y*.5:v.y*.92)*k,v.z*k);}
  base.computeVertexNormals();const nr=base.attributes.normal;const col=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){const up=nr.getY(i);const c=new THREE.Color(0x585550).lerp(new THREE.Color(0x46503A),smooth(.4,.8,up)*.6).multiplyScalar(.85+vnoise(p.getX(i)*4,p.getZ(i)*4)*.25);col.set([c.r,c.g,c.b],i*3);}
  base.setAttribute('color',new THREE.BufferAttribute(col,3));
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,envMapIntensity:.35});
  mat.onBeforeCompile=s=>{addWet(s,'.3');s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;varying vec3 vON;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMW=position;vON=normal;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;varying vec3 vON;'+GLSL_NOISE).replace('#include <color_fragment>','#include <color_fragment>\n{float b=fbm(vMW.xz*6.+vMW.y*4.);float g=fbm(vMW.xz*23.+vMW.y*19.);diffuseColor.rgb*=.62+.5*b;\n// pitted granite grain, dark cracks, pale lichen rosettes and a moss cap on the top only\ndiffuseColor.rgb*=.8+.35*g;diffuseColor.rgb*=mix(1.,.45,smoothstep(.36,.3,abs(fbm(vMW.xz*4.+vMW.y*7.+3.)-.5)+.28));\nfloat li=smoothstep(.66,.72,fbm(vMW.xz*9.+vMW.y*5.+11.))*step(-.2,vON.y);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.55,.58,.47),li*.55);\nfloat cap=smoothstep(.45,.85,vON.y+(fbm(vMW.xz*5.)-.5)*.6);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.16,.26,.12)*(.7+.6*g),cap*.75);}');};
  const N=MOBILE?40:75;const im=new THREE.InstancedMesh(base,mat,N);let n=0;
  for(let i=0;i<N*20&&n<N;i++){const near=n<N*.5;const s=pick(near?ring(2.6,9):ring(9,45),(x,z)=>rootD(x,z)>.15&&pathD(x,z)>.15,8);if(!s)continue;const [x,z]=s;const r=Math.hypot(x,z);
   const sz=rr(.06,.22)*(n%9===0?2.2:1)*(r>12?1.8:1);E.set(rr(-.2,.2),rr(0,6.28),rr(-.2,.2));Q.setFromEuler(E);M.compose(V(x,groundH(x,z)-sz*.3,z),Q,Sc.set(sz*rr(.95,1.35),sz*rr(.7,1.05),sz*rr(.85,1.2)));im.setMatrixAt(n,M);
   Col.setScalar(rr(.85,1.1));im.setColorAt(n,Col);n++;
   // grass and moss like to gather at a stone's foot
   G._stones=(G._stones||[]);G._stones.push([x,z,sz]);}
  im.count=n;im.castShadow=!MOBILE;im.receiveShadow=true;scene.add(im);G.stones=im;}

 // ================= fallen leaves =================
 // oak leaves from the big tree: lobed, slightly curled, faded ochre / rust / olive, scattered thicker under the crown
 {const tex=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=128;const x=cv.getContext('2d');
   x.translate(64,64);x.fillStyle='#fff';x.beginPath();
   // lobed oak outline along the midrib (y from -54 to 50)
   const L=[];for(let i=0;i<=40;i++){const t=i/40;const y=-54+t*104;const env=Math.sin(Math.PI*Math.pow(t,.8))*(1-t*.25);const lob=.72+.28*Math.abs(Math.sin(t*Math.PI*4.5));L.push([env*lob*30,y]);}
   x.moveTo(0,-56);for(const [a,b] of L)x.lineTo(a,b);for(let i=L.length-1;i>=0;i--)x.lineTo(-L[i][0]*.95,L[i][1]);x.closePath();x.fill();
   x.fillRect(-1.5,48,3,12);// stalk
   // veins darker (multiplied by the instance colour later)
   x.globalCompositeOperation='source-atop';x.strokeStyle='rgba(90,70,50,.55)';x.lineWidth=2.2;x.beginPath();x.moveTo(0,58);x.lineTo(0,-52);x.stroke();x.lineWidth=1.2;
   for(let i=1;i<8;i++){const y=-46+i*12;for(const sd of [-1,1]){x.beginPath();x.moveTo(0,y+6);x.quadraticCurveTo(sd*10,y+2,sd*22,y-4);x.stroke();}}
   const gr=x.createRadialGradient(0,0,6,0,0,62);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(1,'rgba(60,40,20,.35)');x.fillStyle=gr;x.fillRect(-64,-64,128,128);
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;})();
  const g=new THREE.PlaneGeometry(1,1,2,2).rotateX(-Math.PI/2);const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,x*x*.35+z*z*.12+.01);}g.computeVertexNormals();
  const nr=g.attributes.normal;for(let i=0;i<nr.count;i++){const n=V(nr.getX(i),nr.getY(i),nr.getZ(i)).lerp(V(0,1,0),.6).normalize();nr.setXYZ(i,n.x,n.y,n.z);}
  const mat=new THREE.MeshStandardMaterial({map:tex,alphaTest:.5,side:THREE.DoubleSide,roughness:.9});
  const N=MOBILE?260:520,ND=MOBILE?220:480;const im=new THREE.InstancedMesh(g,mat,N+ND);let n=0;
  const pal=[[.07,.7,.36],[.04,.65,.3],[.1,.65,.4],[.16,.45,.32],[.02,.55,.26],[.12,.4,.26]];
  for(let i=0;i<N*20&&n<N;i++){const s=pick(R()<.7?ring(2.3,11):ring(11,30),(x,z)=>rootD(x,z)>.05&&pathD(x,z)>-.1,5);if(!s)continue;const [x,z]=s;
   const sz=rr(.08,.14);const q=slopeQ(x,z,rr(0,6.28));q.multiply(new THREE.Quaternion().setFromEuler(E.set(rr(-.25,.25),0,rr(-.25,.25))));M.compose(V(x,groundH(x,z)+.012,z),q,Sc.set(sz,sz,sz*1.15));im.setMatrixAt(n,M);
   const c=pal[Math.floor(R()*pal.length)];Col.setHSL(c[0]+rr(-.02,.02),c[1],c[2]+rr(-.05,.05));im.setColorAt(n,Col);n++;}
  // autumn drifts: the wind piles leaves up against the roots and the foot of the trunk, layer on layer, in clumps
  const stack=new Map();let nd=0;
  for(let i=0;i<ND*30&&nd<ND;i++){const s=pick(ring(2.2,10),(x,z)=>{const d=rootD(x,z);return d>.02&&d<.5&&pathD(x,z)>0&&fbm2(x*.6+7,z*.6)>.42;},6);if(!s)continue;
   for(let j=0;j<4&&nd<ND;j++){const x=s[0]+rr(-.18,.18),z=s[1]+rr(-.18,.18);const d=rootD(x,z);if(d<.01)continue;
    const key=Math.round(x*8)+','+Math.round(z*8);const h=stack.get(key)||0;stack.set(key,h+1);
    const sz=rr(.08,.14);const q=slopeQ(x,z,rr(0,6.28));q.multiply(new THREE.Quaternion().setFromEuler(E.set(rr(-.45,.45),0,rr(-.45,.45))));
    // closer to the wood the pile is higher and the leaves tilt up against it
    M.compose(V(x,groundH(x,z)+.014+h*.012+smooth(.5,0,d)*.03,z),q,Sc.set(sz,sz,sz*1.15));im.setMatrixAt(n,M);
    const c=pal[Math.floor(R()*pal.length)];Col.setHSL(c[0]+rr(-.02,.03),c[1],c[2]+rr(-.08,.04));im.setColorAt(n,Col);n++;nd++;}}
  im.count=n;im.receiveShadow=true;scene.add(im);G.leaves=im;}

 // ================= twigs =================
 // thin dead sticks: tapered from butt to tip, with side shoots and a grey-brown bark streaked along the grain; half-pressed into the litter
 {const r=rng(5);
  const branch=(parts,pts,rad,tip=.25)=>{const cu=new THREE.CatmullRomCurve3(pts);const TS=MOBILE?6:9,RS=MOBILE?4:5;const g=new THREE.TubeGeometry(cu,TS,rad,RS,false);
   const p=g.attributes.position;const c=V();for(let i=0;i<=TS;i++){const u=i/TS;cu.getPointAt(u,c);const k=1-(1-tip)*u;for(let j=0;j<=RS;j++){const vi=i*(RS+1)+j;p.setXYZ(vi,c.x+(p.getX(vi)-c.x)*k,c.y+(p.getY(vi)-c.y)*k,c.z+(p.getZ(vi)-c.z)*k);}}
   g.deleteAttribute('normal');g.computeVertexNormals();const a=new Float32Array(p.count);for(let i=0;i<p.count;i++)a[i]=Math.floor(i/(RS+1))/TS;g.setAttribute('aU',new THREE.BufferAttribute(a,1));parts.push(g);};
  const shapes=[];
  {const P=[];branch(P,[V(-.42,.012,0),V(-.12,.02,.03),V(.18,.016,-.02),V(.44,.01,.04)],.011);branch(P,[V(-.02,.018,.015),V(.1,.024,.12),V(.2,.018,.22)],.006);branch(P,[V(.22,.015,-.01),V(.31,.02,-.11)],.0045);shapes.push(mergeGeometries(P));}
  {const P=[];branch(P,[V(-.3,.01,0),V(-.05,.015,-.03),V(.28,.012,.02)],.008);branch(P,[V(-.1,.014,-.02),V(-.02,.02,-.12),V(.04,.015,-.2)],.0045);shapes.push(mergeGeometries(P));}
  {const P=[];branch(P,[V(-.18,.008,0),V(0,.012,.02),V(.17,.008,-.01)],.006,.4);shapes.push(mergeGeometries(P));}
  const mat=new THREE.MeshStandardMaterial({color:0x6A5A4A,roughness:1});
  mat.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aU;varying vec3 vTw;').replace('#include <begin_vertex>','#include <begin_vertex>\nvTw=vec3(aU*5.,(position.y+position.z)*260.,instanceMatrix[3][0]*5.+instanceMatrix[3][2]*3.);');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vTw;'+GLSL_NOISE).replace('#include <color_fragment>','#include <color_fragment>\n{float st=fbm(vec2(vTw.y,vTw.x+vTw.z));diffuseColor.rgb*=.55+.6*st;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.4,.36),smoothstep(.6,.8,fbm(vec2(vTw.y*.4,vTw.z*2.)))*.5);}');};
  const N=MOBILE?40:85;const per=[[],[],[]];
  for(let i=0;i<N*20&&per[0].length+per[1].length+per[2].length<N;i++){const s=pick(i%3?ring(2.2,8):ring(2.4,16),(x,z)=>rootD(x,z)>.2&&pathD(x,z)>.1,5);if(!s)continue;const [x,z]=s;
   const k=r()<.35?0:(r()<.55?1:2);const sz=rr(.7,1.25);M.compose(V(x,groundH(x,z)-.006,z),slopeQ(x,z,rr(0,6.28)),Sc.set(sz,sz,sz*rr(.8,1.2)));per[k].push(M.clone());}
  G.twigs=per.map((list,k)=>{const im=new THREE.InstancedMesh(shapes[k],mat,list.length);list.forEach((m,i)=>{im.setMatrixAt(i,m);im.setColorAt(i,Col.setScalar(rr(.75,1.2)));});im.receiveShadow=true;scene.add(im);return im;});}

 // ================= stumps, a fallen log and the firewood pile by the way out =================
 // where he goes out for wood: an old chopping stump with split logs stacked beside it, a big moss-capped stump at the gap,
 // a fallen trunk half sunk in the litter. Bark from the oak's own texture, cut ends with growth rings and radial cracks.
 {const barkT=new THREE.TextureLoader().load(new URL('bark2.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;});barkT.wrapS=barkT.wrapT=THREE.RepeatWrapping;
  const endT=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=256;const x=cv.getContext('2d');const g=x.createRadialGradient(128,128,4,128,128,128);
   g.addColorStop(0,'#9A7A55');g.addColorStop(.85,'#B08C62');g.addColorStop(.93,'#6A5038');g.addColorStop(1,'#3A2A1E');x.fillStyle=g;x.fillRect(0,0,256,256);
   x.strokeStyle='rgba(70,48,30,.45)';for(let r=6;r<112;r+=4+Math.random()*5){x.lineWidth=.8+Math.random()*1.4;x.beginPath();for(let a=0;a<=64;a++){const t=a/64*6.283;const rr2=r*(1+.04*Math.sin(t*3+r));x.lineTo(128+Math.cos(t)*rr2,128+Math.sin(t)*rr2);}x.stroke();}
   x.strokeStyle='rgba(40,26,16,.7)';x.lineWidth=2;for(let k=0;k<5;k++){const a=Math.random()*6.283;x.beginPath();x.moveTo(128+Math.cos(a)*20,128+Math.sin(a)*20);x.lineTo(128+Math.cos(a+.05)*(70+Math.random()*40),128+Math.sin(a+.05)*(70+Math.random()*40));x.stroke();}
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;})();
  const barkM=new THREE.MeshStandardMaterial({map:barkT,color:0x8A7A6A,roughness:1,vertexColors:true});
  const endM=new THREE.MeshStandardMaterial({map:endT,roughness:.95});
  // log/stump: a slightly lumpy cylinder; the top of a lying log greens with moss (vertex colour)
  const wood=(r0,r1,h,seg,mossUp,seed)=>{const g=new THREE.CylinderGeometry(r0,r1,h,seg,MOBILE?3:5);const p=g.attributes.position,uv=g.attributes.uv,nr=g.attributes.normal;
   for(let i=0;i<p.count;i++){if(Math.abs(nr.getY(i))<.5){const a=Math.atan2(p.getZ(i),p.getX(i));const k=1+(vnoise(a*2.2+seed,p.getY(i)*3)-.5)*.14;p.setX(i,p.getX(i)*k);p.setZ(i,p.getZ(i)*k);uv.setXY(i,uv.getX(i)*Math.max(1,Math.round(r0*14)),uv.getY(i)*h*1.6);}}
   g.computeVertexNormals();const c=new Float32Array(p.count*3);g.setAttribute('color',new THREE.BufferAttribute(c,3));c.fill(1);g.userData.mossUp=mossUp;return g;};
  const tint=(mesh,mossK)=>{const g=mesh.geometry,p=g.attributes.position,c=g.attributes.color;mesh.updateMatrixWorld(true);const n=V(),w=V();const nm=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
   for(let i=0;i<p.count;i++){n.fromBufferAttribute(g.attributes.normal,i).applyMatrix3(nm).normalize();w.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
    const m=smooth(.2,.8,n.y+(fbm2(w.x*3,w.z*3+w.y*3)-.5)*.8)*mossK;const low=smooth(.35,0,w.y-groundH(w.x,w.z))*.35;c.setXYZ(i,(1-m*.55)*(1-low),(1-m*.25)*(1-low),(1-m*.6)*(1-low));}c.needsUpdate=true;};
  const grp=new THREE.Group();grp.name='woodpile';const add=(g,x,z,ry,tilt,sink,mossK)=>{const m=new THREE.Mesh(g,[barkM,endM,endM]);m.position.set(x,groundH(x,z)+sink,z);m.rotation.set(tilt[0],ry,tilt[1]);grp.add(m);tint(m,mossK);m.castShadow=!MOBILE;m.receiveShadow=true;return m;};
  const ok=(x,z)=>rootD(x,z)>.4;
  // chopping stump with an old axe cut, and the stacked firewood next to it
  const chop=[12.5,7.4],pile=[13.5,8.1],big=[15.4,6.7],big2=[16.6,2.9],log=[11.0,3.4];
  if(ok(...chop))add(wood(.26,.31,.5,MOBILE?12:16,0,1),chop[0],chop[1],.4,[0,0],.2,.4);
  if(ok(...pile)){const S=[],E2=[];const r=rng(77);// three courses of split logs, cut ends out toward the clearing
   [[5,0],[4,1],[3,2]].forEach(([n,row])=>{for(let i=0;i<n;i++){const rad=.075+r()*.02,len=.55+r()*.12,y=rad+row*.135,z=(i-(n-1)/2)*.16+(row%2)*.0,yaw=.06*(r()-.5);
     const sd=new THREE.CylinderGeometry(rad,rad,len,7,1,true).rotateZ(Math.PI/2).rotateY(yaw).translate(0,y,z);S.push(sd);
     for(const e of [-1,1]){const c=new THREE.CircleGeometry(rad,8).rotateY(e*Math.PI/2).translate(e*len/2,0,0).rotateY(yaw).translate(0,y,z);E2.push(c);}}});
   const sg=mergeGeometries(S);sg.setAttribute('color',new THREE.BufferAttribute(new Float32Array(sg.attributes.position.count*3).fill(1),3));const eg=mergeGeometries(E2);
   for(const [g,mt] of [[sg,barkM],[eg,endM]]){const m=new THREE.Mesh(g,mt);m.position.set(pile[0],groundH(...pile)+.005,pile[1]);m.rotation.y=-.35;m.castShadow=!MOBILE;m.receiveShadow=true;grp.add(m);}}
  if(ok(...big))add(wood(.42,.55,.62,MOBILE?14:20,1,2),big[0],big[1],1.1,[.04,-.03],.18,.9);
  if(ok(...big2))add(wood(.3,.4,.38,MOBILE?12:16,1,3),big2[0],big2[1],.2,[0,.05],.14,1);
  if(ok(...log))add(wood(.17,.21,2.6,MOBILE?10:14,1,4),log[0],log[1],.5,[0,Math.PI/2],.08,1);
  scene.add(grp);G.woodpile=grp;G._stones=(G._stones||[]);for(const [x,z,r] of [[...chop,.3],[...pile,.5],[...big,.55],[...big2,.4],[log[0],log[1],.5],[log[0]+.9,log[1]-.45,.3],[log[0]-.9,log[1]+.45,.3]])G._stones.push([x,z,r]);
  // nav for Character/Brain: the way out from the foot of the ground ladder, the gap where he leaves the clearing, a spot
  // out in the fog where he is hidden, and the work spots by the stump and the pile
  const P3=(x,z)=>V(x,groundH(x,z),z);const way=[[0,4.3],[.5,5.6],[1.4,7.2],...EXIT.slice(1,6)].map(([x,z])=>P3(x,z));
  const edge=P3(14.2,5.1),out=P3(21.5,4.3);
  G.exits={forest:{ladderFoot:way[0].clone(),path:way,edge,out,outPath:[edge,P3(17.4,4.6),out],faceOut:Math.atan2(out.x-edge.x,out.z-edge.z),faceIn:Math.atan2(edge.x-out.x,edge.z-out.z),
   chopStump:P3(...chop),chopStand:P3(chop[0]-.55,chop[1]-.35),woodPile:P3(...pile),woodStand:P3(pile[0]-.45,pile[1]-.6),
   nodes:{g_foot:way[0],g_path1:way[1],g_fork:way[2],g_exit1:way[4],g_exit2:way[6],g_edge:edge,g_out:out}}};}

 // ================= puddles =================
 // Rain fills the low, flat spots of the clearing (often on the trodden path) and they dry slowly afterwards.
 // Desktop: a real planar mirror at low resolution (lit windows, the moon, the oak), only rendered while there is water.
 // Phones: the same puddles as glossy dark water that catches the lamps and the moon as highlights.
 {const spots=[];for(let t=0;t<400&&spots.length<(MOBILE?5:7);t++){const onPath=spots.length<3;const [x,z]=onPath?(()=>{const i=1+Math.floor(R()*4),f=R();return [PATH[i][0]+(PATH[i+1][0]-PATH[i][0])*f+rr(-.2,.2),PATH[i][1]+(PATH[i+1][1]-PATH[i][1])*f];})():ring(3.5,11)();
   if(rootD(x,z)<1.2||Math.hypot(x,z)>12||spots.some(q=>Math.hypot(q[0]-x,q[1]-z)<2.2))continue;spots.push([x,z,rr(.55,1.15),rr(.6,1),rr(0,6.28)]);}
  const parts=[];spots.forEach(([x,z,r,e,a],i)=>{const g=new THREE.CircleGeometry(1,28);const p=g.attributes.position;const sd=new Float32Array(p.count).fill(i*7.3+1);
   g.setAttribute('aSeed',new THREE.BufferAttribute(sd,1));const lp=new Float32Array(p.count*2);for(let k=0;k<p.count;k++){lp[k*2]=p.getX(k);lp[k*2+1]=p.getY(k);}g.setAttribute('aLP',new THREE.BufferAttribute(lp,2));
   g.scale(r,r*e,1);g.rotateZ(a);g.translate(x,-z,0);parts.push(g);});
  if(spots.length){const geo=mergeGeometries(parts);G.puddleSpots=spots;
   const levelU={value:0},rainU={value:0},timeU={value:0};
   const MASK=`float pmask(vec2 lp,float sd,float lev){float r=length(lp);float n=vn(lp*2.3+sd)*.55+vn(lp*5.1+sd*1.7)*.3;float edge=1.-r+(n-.45)*.6;return smoothstep(.0,.12,edge-(1.-lev)*.85);}
    float ripple(vec2 wp,float t,float rain){float v=0.;for(int i=0;i<3;i++){vec2 c=floor(wp*3.+float(i)*.37);float h=h21(c+float(i)*11.);float ph=fract(t*.9+h);vec2 o=vec2(h21(c+3.1),h21(c+7.7));float d=length(fract(wp*3.+float(i)*.37)-o);v+=sin((d-ph*.5)*60.)*smoothstep(.5,0.,abs(d-ph*.5)*6.)*(1.-ph)*step(h,rain);}return v;}`;
   let mesh;
   if(!MOBILE){
    mesh=new Reflector(geo,{textureWidth:384,textureHeight:384,clipBias:.003,shader:{name:'Puddle',
     uniforms:{color:{value:new THREE.Color(0x6F7F86)},tDiffuse:{value:null},textureMatrix:{value:null},uLevel:levelU,uRain:rainU,uTime:timeU},
     vertexShader:`uniform mat4 textureMatrix;attribute float aSeed;attribute vec2 aLP;varying vec4 vUv;varying vec2 vLP;varying float vSd;varying vec3 vW;
      void main(){vLP=aLP;vSd=aSeed;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vUv=textureMatrix*vec4(position,1.);gl_Position=projectionMatrix*viewMatrix*w;}`,
     fragmentShader:`uniform vec3 color;uniform sampler2D tDiffuse;uniform float uLevel,uRain,uTime;varying vec4 vUv;varying vec2 vLP;varying float vSd;varying vec3 vW;`+GLSL_NOISE+MASK+`
      void main(){float m=pmask(vLP,vSd,uLevel);if(m<.01)discard;float rp=ripple(vW.xz,uTime,uRain);vec4 uv=vUv;uv.xy+=vec2(rp*.012,rp*.008)*uv.w;
       vec3 refl=texture2DProj(tDiffuse,uv).rgb;vec3 V=normalize(cameraPosition-vW);float fr=.25+.75*pow(1.-max(V.y,0.),4.);
       vec3 water=vec3(.03,.045,.05);vec3 c=mix(water,refl*color*1.35,fr);gl_FragColor=vec4(c,m*.92);
       #include <tonemapping_fragment>
       #include <colorspace_fragment>
      }`}});
    const u=mesh.material.uniforms;u.uLevel=levelU;u.uRain=rainU;u.uTime=timeU;// Reflector clones the uniforms: re-link the live ones
    mesh.material.transparent=true;mesh.material.depthWrite=false;
    // skip the extra render while the clearing is dry
    const orig=mesh.onBeforeRender;mesh.onBeforeRender=function(...a){if(levelU.value<.02)return;orig.apply(this,a);};
   }else{
    const mat=new THREE.MeshStandardMaterial({color:0x0A1012,roughness:.06,metalness:.2,transparent:true,depthWrite:false});
    mat.onBeforeCompile=sh=>{sh.uniforms.uLevel=levelU;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aSeed;attribute vec2 aLP;varying vec2 vLP;varying float vSd;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLP=aLP;vSd=aSeed;');
     sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uLevel;varying vec2 vLP;varying float vSd;'+GLSL_NOISE+MASK).replace('#include <alphamap_fragment>','#include <alphamap_fragment>\ndiffuseColor.a*=pmask(vLP,vSd,uLevel)*.9;');};
    mesh=new THREE.Mesh(geo,mat);}
   mesh.rotation.x=-Math.PI/2;mesh.position.y=.012;mesh.renderOrder=1;scene.add(mesh);G.puddles=mesh;
   G.updatePuddles=cam=>{levelU.value=ST.puddle;rainU.value=ST.rainK;timeU.value=ST.T;mesh.visible=ST.puddle>.02;};}}

 // ================= footprints in the mud =================
 // After rain the path turns to mud: the hero's boots leave prints (a ring of the last ~48 steps, left/right alternate),
 // plus a few older prints along the path. They show while the ground is muddy and fade as it dries.
 {const tex=(()=>{const cv=document.createElement('canvas');cv.width=64;cv.height=128;const x=cv.getContext('2d');x.fillStyle='#fff';
   x.beginPath();x.ellipse(32,40,19,30,0,0,Math.PI*2);x.fill();x.beginPath();x.ellipse(32,98,15,20,0,0,Math.PI*2);x.fill();
   // tread: darker bars (multiplied below)
   x.globalCompositeOperation='destination-out';x.fillStyle='rgba(0,0,0,.45)';for(let y=16;y<70;y+=9)x.fillRect(14,y,36,3.5);for(let y=86;y<114;y+=8)x.fillRect(18,y,28,3);
   const t=new THREE.CanvasTexture(cv);return t;})();
  const mudU={value:0};
  const mat=new THREE.MeshStandardMaterial({color:0x1E1610,alphaMap:tex,transparent:true,depthWrite:false,roughness:.25,polygonOffset:true,polygonOffsetFactor:-2});
  mat.onBeforeCompile=sh=>{sh.uniforms.uMud=mudU;sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uMud;').replace('#include <alphamap_fragment>','#include <alphamap_fragment>\ndiffuseColor.a*=uMud*.75;');};
  const g=new THREE.PlaneGeometry(.12,.28).rotateX(-Math.PI/2);const NF=48,NS=MOBILE?14:24;const im=new THREE.InstancedMesh(g,mat,NF+NS);im.frustumCulled=false;
  const hide=new THREE.Matrix4().makeScale(0,0,0);for(let i=0;i<NF+NS;i++)im.setMatrixAt(i,hide);
  const put=(i,x,z,yaw,side)=>{Q.setFromAxisAngle(V(0,1,0),yaw);const o=V(Math.cos(yaw)*.09*side,0,-Math.sin(yaw)*.09*side);M.compose(V(x+o.x,groundH(x,z)+.006,z+o.z),Q,Sc.set(1,1,1));im.setMatrixAt(i,M);};
  // older prints along the path (someone walked here yesterday)
  for(let i=0;i<NS;i++){const k=Math.min(PATH.length-2,Math.floor(i/NS*(PATH.length-1)));const f=(i/NS*(PATH.length-1))%1;const [ax,az]=PATH[k],[bx,bz]=PATH[k+1];
   put(NF+i,ax+(bx-ax)*f,az+(bz-az)*f,Math.atan2(bx-ax,bz-az)+rr(-.15,.15),i%2?1:-1);}
  im.instanceMatrix.needsUpdate=true;im.renderOrder=1;scene.add(im);G.footprints=im;
  let head=0,side=1,last=null;
  G.updateFootprints=()=>{const want=Math.min(1,ST.puddle*1.6+ST.rainK*.5);mudU.value+=(want-mudU.value)*.02;im.visible=mudU.value>.02;
   const h=window.__dbg&&window.__dbg.hero&&window.__dbg.hero.root;if(!h)return;const p=h.position;
   // on the ground, and only where it is muddy enough (on the path or near puddles)
   if(p.y>.25||mudU.value<.05){last=null;return;}if(pathD(p.x,p.z)>.4&&!(G.puddleSpots||[]).some(q=>Math.hypot(q[0]-p.x,q[1]-p.z)<q[2]+.6)){last=null;return;}
   if(!last){last=p.clone();return;}const d=Math.hypot(p.x-last.x,p.z-last.z);if(d<.36)return;
   const yaw=Math.atan2(p.x-last.x,p.z-last.z);put(head,p.x,p.z,yaw,side);side=-side;head=(head+1)%NF;im.instanceMatrix.needsUpdate=true;last.copy(p);};}

 // ================= acorns =================
 // fallen from the big oak: a glossy brown nut in a rough cap, lying on its side, gathered under the crown
 {const nut=new THREE.SphereGeometry(1,10,8).scale(.62,.62,1);const cap=new THREE.SphereGeometry(1,10,6,0,Math.PI*2,0,Math.PI*.55).scale(.72,.72,.55).rotateX(-Math.PI/2).translate(0,0,-.42);
  const stalk=new THREE.CylinderGeometry(.06,.08,.3,5).rotateX(Math.PI/2).translate(0,0,-1.05);
  const paint=(g,c)=>{const n=g.attributes.position.count;const a=new Float32Array(n*3);for(let i=0;i<n;i++)a.set(c,i*3);g.setAttribute('color',new THREE.BufferAttribute(a,3));g.deleteAttribute('uv');return g.toNonIndexed();};
  const g=mergeGeometries([paint(nut,[.55,.36,.2]),paint(cap,[.36,.3,.22]),paint(stalk,[.3,.24,.18])]);g.translate(0,.62,0);
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45});mat.onBeforeCompile=s=>addWet(s,'.6');
  const N=MOBILE?50:110;const im=new THREE.InstancedMesh(g,mat,N);let n=0;
  for(let i=0;i<N*20&&n<N;i++){const s=pick(ring(2.2,9),(x,z)=>rootD(x,z)>.04&&pathD(x,z)>0,5);if(!s)continue;const [x,z]=s;const sz=rr(.011,.016);
   E.set(rr(-.3,.3),rr(0,6.28),rr(-.15,.15));Q.setFromEuler(E);M.compose(V(x,groundH(x,z)-.004,z),Q,Sc.set(sz,sz,sz));im.setMatrixAt(n,M);Col.setScalar(rr(.75,1.15));im.setColorAt(n,Col);n++;}
  im.count=n;im.receiveShadow=true;scene.add(im);G.acorns=im;}

 // ================= ferns =================
 // arching fronds: a curved strip per frond, leaflets painted on a canvas (dark teal-green, lighter tips)
 {const fernTex=(()=>{const cv=document.createElement('canvas');cv.width=128;cv.height=256;const x=cv.getContext('2d');
   const gr=x.createLinearGradient(0,256,0,0);gr.addColorStop(0,'#24503F');gr.addColorStop(.5,'#4A845A');gr.addColorStop(1,'#8DB86A');x.fillStyle=gr;x.strokeStyle='#244A36';x.lineWidth=3;
   x.beginPath();x.moveTo(64,256);x.quadraticCurveTo(68,120,62,6);x.stroke();
   for(let i=0;i<17;i++){const t=i/17,y=250-t*236,cx=64+Math.sin(t*2.4)*4-t*3,L=(1-t*.85)*54*(t<.08?.6:1);
    for(const sd of [-1,1]){x.beginPath();x.moveTo(cx,y);
     // leaflet with a toothed edge
     const tip=[cx+sd*L,y-5-t*10];x.quadraticCurveTo(cx+sd*L*.55,y-11,tip[0],tip[1]);
     for(let k=6;k>=0;k--){const u=k/6;x.lineTo(cx+sd*L*u,y+3-u*(8+t*10)+((k%2)?2.5:0));}x.closePath();x.fill();}}
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;})();
  const mk=(nf,len,seed)=>{const r=rng(seed);const parts=[];for(let k=0;k<nf;k++){const L=len*(.75+r()*.4);const q=new THREE.PlaneGeometry(.34,L,1,6);const p=q.attributes.position;const nr=q.attributes.normal;
    const rise=1.25+r()*.45;for(let i=0;i<p.count;i++){const y=p.getY(i)+L/2;const t=y/L;
     // arch up and out, the tip droops; leaflets fold a little along the rachis
     p.setY(i,L*(rise*t-rise*.78*t*t)+.02);p.setZ(i,L*t*.72);p.setX(i,p.getX(i)*(1-t*.2));p.setY(i,p.getY(i)-Math.abs(p.getX(i))*.45);nr.setXYZ(i,0,1,-.35);
    }const uv=q.attributes.uv;const a=new Float32Array(p.count);for(let i=0;i<p.count;i++)a[i]=uv.getY(i);q.setAttribute('aK',new THREE.BufferAttribute(a,1));
    q.rotateY(k/nf*Math.PI*2+r()*.5);parts.push(q);}return mergeGeometries(parts);};
  const fm=new THREE.MeshStandardMaterial({map:fernTex,alphaTest:.5,side:THREE.DoubleSide,roughness:.9,emissive:0x0C1E18,emissiveMap:fernTex});
  fm.onBeforeCompile=s=>{windHook(s);NOFLIP(s);s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aK;')
   .replace('#include <begin_vertex>',`#include <begin_vertex>\n{float k=aK;const float SW=.05;${SWAY}}`);};
  const geos=[mk(7,.75,3),mk(9,.6,8)];
  geos.forEach((fg,vi)=>{const NF=MOBILE?24:44;const im=new THREE.InstancedMesh(fg,fm,NF);let n=0;
   for(let i=0;i<NF*30&&n<NF;i++){const s=pick(R()<.65?ring(3.,10):ring(10,26),(x,z)=>{const d=rootD(x,z);return d>.25&&d<(Math.hypot(x,z)>10?99:2.2)&&pathD(x,z)>.2;},6);if(!s)continue;const [x,z]=s;
    const sz=rr(.8,1.4)*(Math.hypot(x,z)>10?1.35:1);M.compose(V(x,groundH(x,z)-.02,z),slopeQ(x,z,rr(0,6.28)),Sc.set(sz,sz*rr(.85,1.1),sz));im.setMatrixAt(n,M);
    Col.setHSL(rr(.3,.38),rr(.3,.45),rr(.6,.75));im.setColorAt(n,Col);n++;}
   im.count=n;im.receiveShadow=true;scene.add(im);});
  G.ferns=true;}

 // ================= mushrooms =================
 // little clusters with warm caps that glow faintly at night (a cosy touch in the cold blue). Glow uniform: C.shroomGlow.
 {const cap=new THREE.SphereGeometry(1,14,7,0,Math.PI*2,0,Math.PI*.5).scale(1,.55,1).translate(0,.9,0);
  const gill=new THREE.CircleGeometry(.98,14).rotateX(Math.PI/2).translate(0,.9,0);
  const stem=new THREE.CylinderGeometry(.24,.34,.95,8,2).translate(0,.47,0);{const p=stem.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i);p.setX(i,p.getX(i)+Math.sin(y*2.5)*.05);}}
  const paint=(g,f)=>{const p=g.attributes.position;const c=new Float32Array(p.count*3);const a=new Float32Array(p.count);for(let i=0;i<p.count;i++){const r=f(p.getY(i));c.set(r[0],i*3);a[i]=r[1];}g.setAttribute('color',new THREE.BufferAttribute(c,3));g.setAttribute('aCap',new THREE.BufferAttribute(a,1));};
  paint(stem,y=>[[.86,.84,.76],0]);paint(gill,y=>[[.62,.5,.4],.15]);paint(cap,y=>{const k=smooth(.9,1.45,y);return [[.62+k*.28,.32+k*.1,.2+k*.04],smooth(.95,1.4,y)];});
  const mg=mergeGeometries([stem.toNonIndexed(),gill.toNonIndexed(),cap.toNonIndexed()]);
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65});G.shroomGlow=glowU;
  mat.onBeforeCompile=sh=>{sh.uniforms.uGlow=glowU;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aCap;varying float vCap;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCap=aCap;');
   sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uGlow;varying float vCap;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.5,.2)*vCap*uGlow;');};
  const NM=MOBILE?36:64;const im=new THREE.InstancedMesh(mg,mat,NM);let n=0;
  for(let t=0;t<NM*30&&n<NM;t++){// they grow at the foot of the roots
   const s=pick(ring(3,10),(x,z)=>{const d=rootD(x,z);return d>.08&&d<.6;},6);if(!s)continue;const [cx,cz]=s;const k=2+Math.floor(R()*4);
   for(let j=0;j<k&&n<NM;j++){const x=cx+rr(-.22,.22),z=cz+rr(-.22,.22);if(rootD(x,z)<.05)continue;const sz=rr(.03,.08)*(j===0?1.3:1);E.set(rr(-.25,.25),rr(0,6.28),rr(-.25,.25));Q.setFromEuler(E);
    M.compose(V(x,groundH(x,z)-.01,z),Q,Sc.set(sz,sz*rr(.9,1.5),sz));im.setMatrixAt(n,M);Col.setHSL(rr(.03,.08),rr(.5,.8),rr(.6,.78));im.setColorAt(n,Col);n++;}}
  im.count=n;im.castShadow=!MOBILE;im.receiveShadow=true;scene.add(im);G.shrooms=im;}

 // ================= bushes =================
 // rounded clumps of oak-leaf cards with normals pointing out from the clump centre, so each bush shades like a soft
 // ball (lit top, dark heart) instead of a pile of flat cards. Frame the clearing at the forest edge, as in the photo.
 {const mkBush=(seed,nc)=>{const r=rng(seed);const parts=[];
   for(let i=0;i<nc;i++){// cards on a squashed sphere, facing outwards with jitter
    const u=r()*2-1,th=r()*6.283,rad=Math.sqrt(1-u*u);const dir=V(rad*Math.cos(th),Math.abs(u)*.8+.05,rad*Math.sin(th)).normalize();const c=dir.clone().multiply(V(.85,.6,.85)).multiplyScalar(.55+r()*.4).add(V(0,.55,0));
    const q=new THREE.PlaneGeometry(1,1);const quat=new THREE.Quaternion().setFromUnitVectors(V(0,0,1),dir);quat.multiply(new THREE.Quaternion().setFromAxisAngle(V(0,0,1),r()*6.28));
    const s=.55+r()*.45;q.scale(s,s,s);q.applyQuaternion(quat);q.translate(c.x,c.y,c.z);
    const p=q.attributes.position,nr=q.attributes.normal;const col=new Float32Array(p.count*3);
    for(let k=0;k<p.count;k++){const n=V(p.getX(k),p.getY(k)-.45,p.getZ(k)).normalize();nr.setXYZ(k,n.x,n.y,n.z);const ao=.45+.55*smooth(-.2,.9,n.y*.6+c.length()*.6);col.set([ao,ao,ao],k*3);}
    q.setAttribute('color',new THREE.BufferAttribute(col,3));parts.push(q);}
   return mergeGeometries(parts);};
  const mat=swayMat(new THREE.MeshStandardMaterial({map:leafT,alphaTest:.5,side:THREE.DoubleSide,roughness:.85,vertexColors:true}),U,.025,'clamp(position.y,0.,1.5)');
  const NB=MOBILE?24:40;[mkBush(1,MOBILE?16:22),mkBush(2,MOBILE?12:16)].forEach((bg,vi)=>{const im=new THREE.InstancedMesh(bg,mat,NB);let n=0;
   const NS=MOBILE?3:5;// the first few frame the clearing on the left and right edges of the main view, like the photo
   for(let b=0;b<NB*40&&n<NB;b++){let x,z,r;
    if(n<NS){const sd=(n+vi)%2?1:-1;x=sd*rr(8.5,13);z=rr(-6,5);r=Math.hypot(x,z);}
    else{const a=rr(0,6.28);r=rr(10,42);x=Math.cos(a)*r;z=Math.sin(a)*r;
    // keep the view to the house open (camera looks from +z), crowd the sides and the back
    if((z>-3&&Math.abs(x)<15))continue;}
    if(rootD(x,z)<1||!exitClear(x,z))continue;
    const sz=rr(1.1,2.2)*(r>25?1.4:1);M.compose(V(x,groundH(x,z)-.15,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(.9,1.4),sz*rr(.7,1),sz*rr(.9,1.3)));im.setMatrixAt(n,M);
    Col.setHSL(rr(.3,.38),rr(.2,.35),rr(.48,.6));im.setColorAt(n,Col);n++;}
   im.count=n;im.receiveShadow=true;scene.add(im);});
  // ---- the far edge of the clearing: a dense wall of undergrowth and young trees in front of the painted forest ----
  // It gives depth: near plants, then this thicket, then the far trees and the fog. Kept out of the camera's view line.
  const edgeOK=(x,z)=>!(z>1&&Math.abs(x)<13)&&rootD(x,z)>1.5&&exitClear(x,z);
  {const bg=mkBush(5,MOBILE?14:20);const NE=MOBILE?50:90;const im=new THREE.InstancedMesh(bg,mat,NE);let n=0;
   for(let t=0;t<NE*40&&n<NE;t++){const a=rr(0,6.28),r=rr(15,24)+(vnoise(a*3,1)-.5)*3;const x=Math.cos(a)*r,z=Math.sin(a)*r*.95;if(!edgeOK(x,z))continue;
    const sz=rr(1.2,2.4);M.compose(V(x,groundH(x,z)-.25,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(1,1.6),sz*rr(.8,1.25),sz*rr(1,1.5)));im.setMatrixAt(n,M);
    Col.setHSL(rr(.3,.4),rr(.18,.32),rr(.38,.52));im.setColorAt(n,Col);n++;}
   im.count=n;im.computeBoundingSphere();im.receiveShadow=true;scene.add(im);G.thicket=im;}
  {// young trees: a slim, slightly crooked trunk with a few side twigs, and two or three leaf clumps up top
   const r=rng(9);const parts=[];let px=0,pz=0;const pts=[];for(let i=0;i<=6;i++){const y=i/6*4.2;px+=(r()-.5)*.18;pz+=(r()-.5)*.18;pts.push(V(px,y,pz));}
   const cu=new THREE.CatmullRomCurve3(pts);const tg=new THREE.TubeGeometry(cu,10,1,6,false);{const p=tg.attributes.position;const tmp=V();
    // taper: pull each ring towards the curve by height
    for(let i=0;i<p.count;i++){tmp.fromBufferAttribute(p,i);const t=Math.min(1,Math.max(0,tmp.y/4.2));const c=cu.getPoint(t);const k=(.11*(1-t)+.025)*(1+.6*smooth(.12,0,t));tmp.sub(c).multiplyScalar(k).add(c);p.setXYZ(i,tmp.x,tmp.y,tmp.z);}tg.computeVertexNormals();}
   parts.push(tg);for(let b=0;b<3;b++){const y0=1.8+b*.7,a=r()*6.28;const c0=cu.getPoint(y0/4.2);const c1=c0.clone().add(V(Math.cos(a)*.7,.45,Math.sin(a)*.7));parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(c0,c1),2,.025,4,false));}
   const trunkG=mergeGeometries(parts.map(g=>{g.deleteAttribute('uv');return g.index?g.toNonIndexed():g;}));
   const tmat=new THREE.MeshStandardMaterial({color:0x4B3B30,roughness:.95});
   const crownG=mergeGeometries([mkBush(7,MOBILE?10:14).translate(0,3.6,0),mkBush(8,MOBILE?8:10).scale(.8,.8,.8).translate(.6,3.0,.3),mkBush(11,MOBILE?7:9).scale(.7,.7,.7).translate(-.5,4.3,-.2)]);
   const NT=MOBILE?14:26;const ti=new THREE.InstancedMesh(trunkG,tmat,NT),ci=new THREE.InstancedMesh(crownG,mat,NT);let n=0;
   for(let t=0;t<NT*50&&n<NT;t++){const a=rr(0,6.28),rad=rr(16,26);const x=Math.cos(a)*rad,z=Math.sin(a)*rad;if(!edgeOK(x,z))continue;
    const sz=rr(.75,1.25);M.compose(V(x,groundH(x,z)-.1,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz,sz*rr(.9,1.2),sz));ti.setMatrixAt(n,M);ci.setMatrixAt(n,M);
    Col.setHSL(rr(.28,.38),rr(.2,.35),rr(.42,.56));ci.setColorAt(n,Col);n++;}
   for(const im of [ti,ci]){im.count=n;im.computeBoundingSphere();im.receiveShadow=true;scene.add(im);}G.youngTrees=ti;}
  // ---- where the clearing meets the painted far forest (a 96 m cylinder): a ring of big, fog-tinted undergrowth hides
  // the line where the ground plane meets the painting, so the forest floor runs into the trees with no seam
  {const bg=mkBush(13,MOBILE?10:14);const NR=MOBILE?40:70;const im=new THREE.InstancedMesh(bg,mat,NR);let n=0;
   for(let i=0;i<NR;i++){const a=i/NR*Math.PI*2+rr(-.03,.03),r=rr(86,93);const x=Math.cos(a)*r,z=Math.sin(a)*r;const sz=rr(5,8);
    M.compose(V(x,groundH(x,z)-1,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(1.4,2),sz*rr(.6,.9),sz*rr(1.4,2)));im.setMatrixAt(n,M);Col.setHSL(.42,.18,rr(.22,.3));im.setColorAt(n,Col);n++;}
   im.count=n;im.computeBoundingSphere();scene.add(im);G.seamRing=im;}}


 // ================= small life =================
 const eve=()=>Math.min(1,glowU.value/1.8);
 // ---- glow-worms: tiny green-gold lights right down in the grass at night (Environment's fireflies fly higher) ----
 {const NG=MOBILE?40:80;const g=new THREE.BufferGeometry();const p=new Float32Array(NG*3),a=new Float32Array(NG*2);let n=0;
  for(let t=0;t<NG*30&&n<NG;t++){const s=pick(ring(3,16),(x,z)=>rootD(x,z)>.1&&pathD(x,z)>.2,4);if(!s)continue;p.set([s[0],groundH(s[0],s[1])+rr(.04,.35),s[1]],n*3);a.set([rr(0,100),rr(.4,1.2)],n*2);n++;}
  g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('aF',new THREE.BufferAttribute(a,2));g.setDrawRange(0,n);
  const u={t:{value:0},on:{value:0},px:{value:Math.min(2,window.devicePixelRatio||1)}};
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:u,
   vertexShader:`attribute vec2 aF;uniform float t,on,px;varying float vB;void main(){float s=aF.x;vec3 q=position+vec3(sin(t*.22+s)*.1,sin(t*.31+s*1.7)*.035,cos(t*.19+s)*.1);
    vec4 mv=viewMatrix*vec4(q,1.);float bl=.25+.75*smoothstep(.1,1.,sin(t*aF.y*.6+s*3.)*.5+.5);vB=bl*on;gl_PointSize=clamp(40./-mv.z,1.5,7.)*px;gl_Position=projectionMatrix*mv;}`,
   fragmentShader:`varying float vB;void main(){float r=length(gl_PointCoord-.5);float k=smoothstep(.5,0.,r);gl_FragColor=vec4(vec3(.75,1.,.4)*(k*k+smoothstep(.15,0.,r)),k*vB);}`});
  const pts=new THREE.Points(g,m);pts.frustumCulled=false;pts.renderOrder=6;scene.add(pts);G.glowWorms=pts;
  G._gw=dt=>{u.t.value+=dt;u.on.value=smooth(.4,.9,eve())*(1-ST.rainK);pts.visible=u.on.value>.01;};}

 // ---- moths: a few pale moths fluttering round the lit windows at night ----
 {let wins=null;const NM=MOBILE?8:16;const g=new THREE.BufferGeometry();const p=new Float32Array(NM*3);g.setAttribute('position',new THREE.BufferAttribute(p,3));
  const u={on:{value:0},px:{value:Math.min(2,window.devicePixelRatio||1)},t:{value:0}};
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:u,
   vertexShader:`uniform float on,px,t;varying float vF;void main(){vec4 mv=viewMatrix*vec4(position,1.);vF=.75+.25*sin(t*7.+position.x*40.);gl_PointSize=clamp(28./-mv.z,1.5,6.)*px;gl_Position=projectionMatrix*mv;}`,
   fragmentShader:`uniform float on;varying float vF;void main(){vec2 d=gl_PointCoord-.5;d.x/=(.35+.65*vF);float k=smoothstep(.5,.2,length(d));gl_FragColor=vec4(vec3(.95,.9,.78),k*on*.9);}`});
  const pts=new THREE.Points(g,m);pts.frustumCulled=false;pts.renderOrder=6;scene.add(pts);G.moths=pts;const st=[];
  G._moths=(dt)=>{u.t.value+=dt;const on=smooth(.5,.9,eve())*(1-ST.rainK*.8);u.on.value=on;pts.visible=on>.01;if(!pts.visible)return;
   if(!wins){wins=[];scene.traverse(o=>{if(o.isMesh&&o.material&&o.material.userData&&o.material.userData.ownGlass){const w=new THREE.Vector3();o.getWorldPosition(w);const nrm=new THREE.Vector3(0,0,1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));wins.push({w,nrm});}});
    if(!wins.length)return;for(let i=0;i<NM;i++){const W=wins[i%wins.length];st.push({W,ph:rr(0,100),r:rr(.2,.45),sp:rr(.45,.9)});}}
   const T=u.t.value;st.forEach((o,i)=>{const a=T*o.sp+o.ph;const c=o.W.w.clone().addScaledVector(o.W.nrm,.28+.1*Math.sin(a*.7));
    // erratic loops in front of the glass, now and then a dart against it
    p[i*3]=c.x+Math.cos(a)*o.r+Math.sin(a*2.3)*.04;p[i*3+1]=c.y+Math.sin(a*1.3)*o.r*.6+Math.sin(a*2.9)*.025;p[i*3+2]=c.z+Math.sin(a*.9)*o.r*.5;});g.attributes.position.needsUpdate=true;};}

 // ---- a hedgehog or a mouse crosses the clearing now and then (code animation) ----
 {const mk=(kind)=>{const grp=new THREE.Group();
   if(kind==='hog'){const body=new THREE.Mesh(new THREE.SphereGeometry(1,14,10).scale(.11,.075,.15),new THREE.MeshStandardMaterial({color:0x7E6650,roughness:1}));body.position.y=.07;grp.add(body);
    // spines: little cones over the back, darker with pale tips
    const parts=[];for(let i=0;i<(MOBILE?110:180);i++){const u=R()*2-1,th=R()*Math.PI*2;const d=V(Math.sqrt(1-u*u)*Math.cos(th),Math.abs(u)*.9+.1,Math.sqrt(1-u*u)*Math.sin(th));if(d.z>.75)continue;
     const c=new THREE.ConeGeometry(.007,.05,3);c.translate(0,.025,0);c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0,1,0),d.clone().add(V(0,0,-.5)).normalize()));c.translate(d.x*.1,.07+d.y*.06,d.z*.13);parts.push(c);}
    const sp=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshStandardMaterial({color:0x5A4634,roughness:.85}));grp.add(sp);
    const head=new THREE.Mesh(new THREE.ConeGeometry(.045,.1,8).rotateX(Math.PI/2),new THREE.MeshStandardMaterial({color:0x8A7058,roughness:1}));head.position.set(0,.06,.17);grp.add(head);
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.012,6,4),new THREE.MeshStandardMaterial({color:0x111111,roughness:.3}));nose.position.set(0,.06,.225);grp.add(nose);
    grp.userData={speed:.28,step:7,bob:.006,head};}
   else{const mat=new THREE.MeshStandardMaterial({color:0x6E6862,roughness:1});const body=new THREE.Mesh(new THREE.SphereGeometry(1,12,8).scale(.035,.03,.06),mat);body.position.y=.032;grp.add(body);
    const head=new THREE.Mesh(new THREE.ConeGeometry(.022,.05,8).rotateX(Math.PI/2),mat);head.position.set(0,.035,.075);grp.add(head);
    for(const sx of [-1,1]){const ear=new THREE.Mesh(new THREE.CircleGeometry(.012,8),new THREE.MeshStandardMaterial({color:0xB48C84,side:THREE.DoubleSide}));ear.position.set(sx*.016,.058,.06);grp.add(ear);}
    const tail=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0,.03,-.055),V(.01,.02,-.1),V(-.02,.012,-.15),V(.01,.01,-.19)]),8,.0035,4),new THREE.MeshStandardMaterial({color:0xA88880}));grp.add(tail);
    grp.userData={speed:1.1,step:22,bob:.004,head,dash:true};}
   {// four short legs that patter under the body (hidden in the grass most of the time, but nothing should glide)
    const hog=kind==='hog';const lm=new THREE.MeshStandardMaterial({color:hog?0x4A3A2E:0x8A7C74,roughness:1});const lg=new THREE.CylinderGeometry(hog?.011:.005,hog?.009:.004,hog?.05:.03,5).translate(0,-(hog?.025:.015),0);
    grp.userData.legs=[];for(const [lx,lz] of [[-1,1],[1,1],[-1,-1],[1,-1]]){const L=new THREE.Mesh(lg,lm);L.position.set(lx*(hog?.06:.018),hog?.05:.03,lz*(hog?.08:.03));grp.add(L);grp.userData.legs.push(L);}}
   grp.traverse(o=>{if(o.isMesh){o.castShadow=!MOBILE;o.receiveShadow=true;}});grp.visible=false;scene.add(grp);return grp;};
  const critters={hog:mk('hog'),mouse:mk('mouse')};G.critters=critters;
  let cur=null,wait=rr(25,50),route=null,ti=0,pause=0,dist=0;
  // a route from the forest edge, around the trunk (never through the roots), into the forest on the other side
  const plan=()=>{const a0=rr(0,6.28),a1=a0+Math.PI*rr(.6,1.4)*(R()<.5?1:-1);const pts=[];const N=40;
   for(let i=0;i<=N;i++){const t=i/N;const a=a0+(a1-a0)*t;const r=lerp3(17,rr(6,9),17,t);pts.push(V(Math.cos(a)*r,0,Math.sin(a)*r));}
   for(const q of pts){let k=0;while(rootD(q.x,q.z)<.4&&k++<20){q.multiplyScalar(1.05);}
    // step round stones and moss cushions (their radius plus half a hedgehog) and round the puddles
    for(let it=0;it<3;it++)for(const [sx,sz,sr] of (G._stones||[])){const dx=q.x-sx,dz=q.z-sz,d=Math.hypot(dx,dz),need=sr*1.35+.14;if(d<need){const k2=(need-d)/Math.max(d,1e-3);q.x+=dx*k2;q.z+=dz*k2;}}
    for(const p of (G.puddleSpots||[])){const px=p.x??p[0],pz=p.z??p[1],pr=(p.r??p[2]??.6)+.15;const dx=q.x-px,dz=q.z-pz,d=Math.hypot(dx,dz);if(d<pr){const k2=(pr-d)/Math.max(d,1e-3);q.x+=dx*k2;q.z+=dz*k2;}}
    q.y=groundH(q.x,q.z);}return new THREE.CatmullRomCurve3(pts);};
  const lerp3=(a,b,c,t)=>t<.5?a+(b-a)*smooth(0,.5,t):b+(c-b)*smooth(.5,1,t);
  G._critters=(dt)=>{if(!cur){wait-=dt*(1+eve());if(wait>0)return;cur=critters[R()<.55?'hog':'mouse'];route=plan();dist=0;pause=0;cur.position.copy(route.getPointAt(0));cur.rotation.y=Math.atan2(...(()=>{const a=route.getPointAt(0),b=route.getPointAt(.01);return [b.x-a.x,b.z-a.z];})());cur.visible=true;return;}
   const u=cur.userData;const L=route.getLength();
   if(pause>0){pause-=dt;u.head.rotation.y=Math.sin(pause*6)*.4;}
   else{dist+=dt*u.speed*(u.dash?(.75+.35*Math.sin(dist*1.6)):1);if(R()<dt*(u.dash?.5:.25))pause=rr(.6,2.2);u.head.rotation.y*=.9;}
   const t=Math.min(1,dist/L);const pos=route.getPointAt(t),ahead=route.getPointAt(Math.min(1,t+.01));
   cur.position.copy(pos);cur.position.y=groundH(pos.x,pos.z)+(pause>0?0:Math.abs(Math.sin(dist*u.step))*u.bob);
   // turn smoothly toward the way ahead (no snapping on tight bends)
   {const want=Math.atan2(ahead.x-pos.x,ahead.z-pos.z);let d=want-cur.rotation.y;d=Math.atan2(Math.sin(d),Math.cos(d));cur.rotation.y+=d*Math.min(1,dt*6);}
   if(u.legs){const ph=dist*u.step*.5;u.legs.forEach((L,i)=>{L.rotation.x=pause>0?L.rotation.x*.85:Math.sin(ph+((i===0||i===3)?0:Math.PI))*.6;});}
   critU.value.set(pos.x,cur.position.y,pos.z);
   if(t>=1){cur.visible=false;cur=null;critU.value.set(0,-99,0);wait=rr(70,160);}};
  G.spawnCritter=k=>{wait=0;if(cur){cur.visible=false;cur=null;}if(k){cur=critters[k];route=plan();dist=0;pause=0;cur.visible=true;}};}
 // ---- night ground mist: a soft, slowly curling wisp of low fog round the hero's feet and the critters' feet ----
 // three thin horizontal layers (5, 12 and 22 cm up) of procedural fog; a few quads, no extra passes, so it costs nothing on a phone
 {const u={t:{value:0},on:{value:0},col:{value:new THREE.Color(.5,.6,.68)}};
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{t:u.t,on:u.on,col:u.col,k:{value:1}}]),
   vertexShader:`#include <fog_pars_vertex>\nvarying vec2 vUv;varying vec2 vW;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vW=w.xz;vec4 mvPosition=viewMatrix*w;gl_Position=projectionMatrix*mvPosition;\n#include <fog_vertex>\n}`,
   fragmentShader:`#include <fog_pars_fragment>\nuniform float t,on,k;uniform vec3 col;varying vec2 vUv;varying vec2 vW;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    void main(){vec2 c=vUv-.5;float r=length(c)*2.;float a=t*.12*k;mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a));vec2 q=R*c*3.+vW*.6;
     float f=n(q*2.+t*.05)*.6+n(q*4.3-t*.08)*.4;float al=smoothstep(1.,.05,r)*smoothstep(1.,.5,r+.2)*smoothstep(.3,.85,f)*on;
     gl_FragColor=vec4(col,al);\n#include <fog_fragment>\n}`});
  const mkM=(s)=>{const g=new THREE.Group();[[.05,1,.2],[.12,.8,.13],[.22,.55,.08]].forEach(([y,sc,a],i)=>{const mm=m.clone();mm.uniforms.t=u.t;mm.uniforms.on={value:0};mm.uniforms.col=u.col;mm.uniforms.k={value:i%2?-1:1};mm.userData.a=a;
    const q=new THREE.Mesh(new THREE.PlaneGeometry(s*sc,s*sc).rotateX(-Math.PI/2),mm);q.position.y=y;q.renderOrder=5;q.frustumCulled=false;g.add(q);});g.visible=false;scene.add(g);return g;};
  const hm=mkM(1.6),cm=mkM(.7);G.footMist={hero:hm,critter:cm,u};
  const setOn=(g,v)=>{g.visible=v>.01;g.children.forEach(q=>{q.material.uniforms.on.value=v*q.material.userData.a;});};
  let hv=0,cv=0;
  G._mist=(dt)=>{u.t.value+=dt;const night=Math.max(ST.nightK,smooth(.4,.9,eve()));
   const hp=heroU.value;const onGround=hp.y>-50&&hp.y<groundH(hp.x,hp.z)+.35;hv+=((onGround?night:0)-hv)*Math.min(1,dt*.8);
   hm.position.set(hp.x,groundH(hp.x,hp.z),hp.z);setOn(hm,hv);
   const cp=critU.value;cv+=((cp.y>-50?night:0)-cv)*Math.min(1,dt*1.5);if(cp.y>-50)cm.position.set(cp.x,cp.y,cp.z);setOn(cm,cv);};}
 G.updateLife=(dt)=>{G._gw(dt);G._moths(dt);G._critters(dt);G._mist(dt);};
 return G;
}
