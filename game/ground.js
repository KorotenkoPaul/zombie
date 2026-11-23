// Ground & vegetation: forest floor, grass, moss, ferns, fallen leaves, twigs, stones, mushrooms, bushes.
// Owned by the "ground & vegetation" thread. index.html calls createGround() once, right after the oak is built.
// Everything is instanced (a handful of draw calls) and keeps clear of the oak's roots: the roots are read from the
// tree meshes at load time, so the plants follow whatever trunk/roots tree.js builds.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundH } from './env.js';

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
const smoothIco=d=>{const g=new THREE.IcosahedronGeometry(1,d);g.deleteAttribute('normal');g.deleteAttribute('uv');return mergeVertices(g);};

export function createGround(C){
 const {scene,MOBILE,leafT,groundT,U,obstacles=[]}=C;WIND=C.wind||null;
 const R=rng(777123);const rr=(a,b)=>a+R()*(b-a);
 const G={};

 // ================= roots map =================
 // A 0.25 m grid over the clearing. Every bark vertex near the ground marks its cell, then a distance field tells
 // each spot how far it is from the trunk/roots: plants stay out of the wood, grass and moss crowd along its edges,
 // and the ground gets a soft contact shadow under the roots.
 const GS=128,GE=16,CELL=GE*2/GS;const occ=new Uint8Array(GS*GS);const dist=new Float32Array(GS*GS).fill(99);
 {const v=new THREE.Vector3();
  for(const o of obstacles)o.traverse(m=>{if(!m.isMesh||m.isInstancedMesh||!m.geometry)return;const p=m.geometry.attributes.position;if(!p)return;m.updateWorldMatrix(true,false);
   for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);if(Math.abs(v.x)>=GE||Math.abs(v.z)>=GE)continue;
    if(v.y>groundH(v.x,v.z)+.9)continue;const gx=Math.floor((v.x+GE)/CELL),gz=Math.floor((v.z+GE)/CELL);occ[gz*GS+gx]=1;}});
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
 // contact-shadow texture for the ground shader: dark right at the wood, fading over ~1 m
 const aoTex=(()=>{const d=new Uint8Array(GS*GS*4);for(let i=0;i<GS*GS;i++){const k=1-smooth(0,1.1,dist[i]);d[i*4]=255*k;d[i*4+1]=255*(1-smooth(0,.45,Math.abs(dist[i]-.35)));d[i*4+2]=0;d[i*4+3]=255;}
  const t=new THREE.DataTexture(d,GS,GS);t.magFilter=t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;})();

 // ================= forest floor =================
 // big mesh with heights from env.js groundH(); vertex colours give the large-scale moss / teal / earth patches,
 // the painted Fal forest floor (ground3.jpg) gives the detail at two scales, plus moss fuzz and root contact shadows.
 {const S=MOBILE?110:150;const g=new THREE.PlaneGeometry(260,260,S,S).rotateX(-Math.PI/2);const p=g.attributes.position;const col=new Float32Array(p.count*3);const c=new THREE.Color();
  const moss=new THREE.Color(0x5E8C55),teal=new THREE.Color(0x3F6B5C),earth=new THREE.Color(0x6E5A47),deep=new THREE.Color(0x36585A);
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,groundH(x,z));const r=Math.hypot(x,z);
   const n=fbm2(x*.08+11,z*.08+3),m=fbm2(x*.3,z*.3);
   c.copy(teal).lerp(moss,smooth(.35,.7,n));c.lerp(earth,smooth(5.,2.4,r+(m-.5)*2.5)*.6);c.lerp(deep,smooth(30,70,r)*.6);c.multiplyScalar(.82+m*.3);
   col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
  const gt=groundT.clone();gt.needsUpdate=true;gt.repeat.set(1,1);gt.wrapS=gt.wrapT=THREE.RepeatWrapping;
  const mat=new THREE.MeshStandardMaterial({map:gt,vertexColors:true,roughness:1,metalness:0});
  mat.onBeforeCompile=s=>{s.uniforms.uAO={value:aoTex};s.uniforms.uGE={value:GE};
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvGW=(modelMatrix*vec4(position,1.)).xz;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;uniform sampler2D uAO;uniform float uGE;'+GLSL_NOISE)
    .replace('#include <map_fragment>',`
     // two texture scales blended by noise: no visible tiling. The far scale is softened so the painted clumps read as ground, not stickers.
     vec4 g1=texture2D(map,vGW/4.6);vec4 g2=texture2D(map,vGW/12.7+.37);float bn=fbm(vGW*.09);vec3 gc=mix(g1.rgb,g2.rgb,smoothstep(.35,.65,bn));
     // close to the camera a finer third scale adds crisp detail (the far scales blur when you zoom in)
     vec3 g0=texture2D(map,vGW/1.5+.71).rgb;gc=mix(gc,g0,.4*(1.-smoothstep(3.,11.,length(vViewPosition))));
     float lum=dot(gc,vec3(.3,.55,.15));gc=mix(vec3(lum),gc,.82);
     // moss fuzz: fine light/dark mottling, brighter mossy cushions in patches
     float mf=fbm(vGW*2.3);float mp=smoothstep(.5,.72,fbm(vGW*.35+4.));gc*=.82+.36*mf;gc=mix(gc,gc*vec3(.95,1.18,.9)+vec3(.0,.025,.0),mp*.6);
     diffuseColor*=vec4(gc*1.85,1.);
     // roots: soft contact shadow, a ring of damp dark earth hugging the wood
     vec2 auv=(vGW+uGE)/(2.*uGE);if(auv.x>0.&&auv.x<1.&&auv.y>0.&&auv.y<1.){vec4 ao=texture2D(uAO,auv);diffuseColor.rgb*=1.-ao.r*.55;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.85,.78,.7),ao.g*.35);}`);};
  const ground=new THREE.Mesh(g,mat);ground.receiveShadow=true;scene.add(ground);G.ground=ground;
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
    for(const sd of [-1,1]){P.push(pc.x+side.x*ww*sd,pc.y,pc.z+side.z*ww*sd);N.push(fn.x+side.x*sd*.25,fn.y,fn.z+side.z*sd*.25);
     const k=Math.pow(t,.8);Cc.push((.08+k*.3)*tint,(.13+k*.42)*tint,(.08+k*.22)*tint);UV.push(sd<0?0:1,t);}}
   for(let s=0;s<seg;s++){const a=base+s*2;I.push(a,a+1,a+2,a+1,a+3,a+2);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));g.normalizeNormals?.();
  g.setAttribute('color',new THREE.Float32BufferAttribute(Cc,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(UV,2));g.setIndex(I);return g;}
 const grassMat=swayMat(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.85,metalness:0}),U,.07,'uv.y');
 {// a little translucency: the lit tips glow a touch so tufts read against the dark ground
  const ob=grassMat.onBeforeCompile;grassMat.onBeforeCompile=s=>{ob(s);s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vColor.rgb*vColor.rgb*.06;');};}
 // variants: tall spiky (the photo's tufts), short dense, and a cheap far version
 const tuftA=tuftGeo(MOBILE?9:13,MOBILE?3:6,11,.2,.46,.1),tuftB=tuftGeo(MOBILE?10:15,MOBILE?3:4,23,.08,.2,.16),tuftF=tuftGeo(7,2,37,.22,.5,.14);
 function scatterGrass(geo,N,gen,size,name){const im=new THREE.InstancedMesh(geo,grassMat,N);let n=0,guard=0;
  while(n<N&&guard++<N*40){// clumps: a seed spot, a few tufts around it
   const s=gen();const cnt=2+Math.floor(R()*6);
   for(let j=0;j<cnt&&n<N;j++){const x=s[0]+rr(-.9,.9),z=s[1]+rr(-.9,.9);const d=rootD(x,z);if(d<.06)continue;const r=Math.hypot(x,z);
    // density: dense along root edges, sparse on bare trodden earth near the trunk, patchy elsewhere
    const dens=Math.max(smooth(1.4,.15,d)*.9,smooth(.38,.62,fbm2(x*.18+2,z*.18+9))*(.25+.75*smooth(3,6,r)));if(R()>dens)continue;
    const sz=rr(size[0],size[1])*(1+smooth(10,40,r)*.5);M.compose(V(x,groundH(x,z)-.02,z),slopeQ(x,z,rr(0,6.28)),Sc.set(sz*rr(.85,1.2),sz*rr(.8,1.25),sz*rr(.85,1.2)));im.setMatrixAt(n,M);
    const dry=smooth(.6,.85,fbm2(x*.4,z*.4+20));Col.setHSL(rr(.27,.38)-dry*.12,rr(.22,.38)-dry*.04,rr(.33,.47)+dry*.06);im.setColorAt(n,Col);n++;}}
  im.count=n;im.receiveShadow=true;im.castShadow=false;im.name=name;scene.add(im);return im;}
 G.grass=[scatterGrass(tuftA,MOBILE?440:900,ring(2.4,18),[.7,1.25],'grassTall'),
  scatterGrass(tuftB,MOBILE?380:800,ring(2.2,14),[.8,1.3],'grassShort'),
  scatterGrass(tuftF,MOBILE?260:450,ring(16,48,.85),[1.3,2.1],'grassFar')];

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
   const sz=rr(.07,.18);E.set(0,rr(0,6.28),0);Q.setFromEuler(E);M.compose(V(x,groundH(x,z)-sz*.25,z),Q,Sc.set(sz*rr(.8,1.2),sz*rr(.9,1.3),sz*rr(.8,1.1)));im.setMatrixAt(n,M);
   Col.setHSL(rr(.28,.36),rr(.15,.28),rr(.42,.55));im.setColorAt(n,Col);n++;}
  im.count=n;im.receiveShadow=true;scene.add(im);G.moss=im;}

 // ================= stones =================
 {const base=smoothIco(MOBILE?3:4);const p=base.attributes.position;
  for(let i=0;i<p.count;i++){const v=V(p.getX(i),p.getY(i),p.getZ(i));const k=1+(vnoise(v.x*1.7+v.z,v.y*1.9+2)-.5)*.45+(vnoise(v.x*5,v.z*5+v.y*3)-.5)*.08;p.setXYZ(i,v.x*k*1.15,(v.y<0?v.y*.35:v.y*.62)*k,v.z*k);}
  base.computeVertexNormals();const nr=base.attributes.normal;const col=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){const up=nr.getY(i);const c=new THREE.Color(0x4A4F50).lerp(new THREE.Color(0x3A5434),smooth(.4,.8,up)*.9).multiplyScalar(.85+vnoise(p.getX(i)*4,p.getZ(i)*4)*.25);col.set([c.r,c.g,c.b],i*3);}
  base.setAttribute('color',new THREE.BufferAttribute(col,3));
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92});
  mat.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMW=position;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;'+GLSL_NOISE).replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=.78+.4*fbm(vMW.xz*6.+vMW.y*4.);');};
  const N=MOBILE?40:75;const im=new THREE.InstancedMesh(base,mat,N);let n=0;
  for(let i=0;i<N*20&&n<N;i++){const near=n<N*.5;const s=pick(near?ring(2.6,9):ring(9,45),(x,z)=>rootD(x,z)>.15,8);if(!s)continue;const [x,z]=s;const r=Math.hypot(x,z);
   const sz=rr(.06,.22)*(n%9===0?2.2:1)*(r>12?1.8:1);E.set(rr(-.2,.2),rr(0,6.28),rr(-.2,.2));Q.setFromEuler(E);M.compose(V(x,groundH(x,z)+sz*.05,z),Q,Sc.set(sz*rr(.9,1.5),sz,sz*rr(.9,1.4)));im.setMatrixAt(n,M);
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
  const N=MOBILE?260:520;const im=new THREE.InstancedMesh(g,mat,N);let n=0;
  const pal=[[.07,.7,.36],[.04,.65,.3],[.1,.65,.4],[.16,.45,.32],[.02,.55,.26],[.12,.4,.26]];
  for(let i=0;i<N*20&&n<N;i++){const s=pick(R()<.7?ring(2.3,11):ring(11,30),(x,z)=>rootD(x,z)>.05,5);if(!s)continue;const [x,z]=s;
   const sz=rr(.08,.14);const q=slopeQ(x,z,rr(0,6.28));q.multiply(new THREE.Quaternion().setFromEuler(E.set(rr(-.25,.25),0,rr(-.25,.25))));M.compose(V(x,groundH(x,z)+.012,z),q,Sc.set(sz,sz,sz*1.15));im.setMatrixAt(n,M);
   const c=pal[Math.floor(R()*pal.length)];Col.setHSL(c[0]+rr(-.02,.02),c[1],c[2]+rr(-.05,.05));im.setColorAt(n,Col);n++;}
  im.count=n;im.receiveShadow=true;scene.add(im);G.leaves=im;}

 // ================= twigs =================
 {const parts=[];const r=rng(5);
  const branch=(pts,rad)=>{const cu=new THREE.CatmullRomCurve3(pts);parts.push(new THREE.TubeGeometry(cu,8,rad,5,false));};
  branch([V(-.5,.02,0),V(-.15,.04,.04),V(.2,.03,-.02),V(.5,.02,.05)],.018);branch([V(-.05,.035,.02),V(.1,.05,.15),V(.22,.04,.26)],.009);branch([V(.25,.03,-.01),V(.36,.04,-.13)],.007);
  const g=mergeGeometries(parts);const mat=new THREE.MeshStandardMaterial({color:0x4A3A2C,roughness:.95});
  const N=MOBILE?24:50;const im=new THREE.InstancedMesh(g,mat,N);let n=0;
  for(let i=0;i<N*20&&n<N;i++){const s=pick(ring(2.4,16),(x,z)=>rootD(x,z)>.2,5);if(!s)continue;const [x,z]=s;const sz=rr(.6,1.4);
   M.compose(V(x,groundH(x,z)-.015,z),slopeQ(x,z,rr(0,6.28)),Sc.set(sz,sz,sz));im.setMatrixAt(n,M);Col.setScalar(rr(.7,1.2));im.setColorAt(n,Col);n++;}
  im.count=n;im.receiveShadow=true;scene.add(im);G.twigs=im;}

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
    const rise=.55+r()*.35;for(let i=0;i<p.count;i++){const y=p.getY(i)+L/2;const t=y/L;
     // arch up and out, the tip droops; leaflets fold a little along the rachis
     p.setY(i,L*(rise*t-rise*.95*t*t)+.02);p.setZ(i,L*t*.85);p.setX(i,p.getX(i)*(1-t*.2));p.setY(i,p.getY(i)-Math.abs(p.getX(i))*.25);nr.setXYZ(i,0,1,0);
    }const uv=q.attributes.uv;const a=new Float32Array(p.count);for(let i=0;i<p.count;i++)a[i]=uv.getY(i);q.setAttribute('aK',new THREE.BufferAttribute(a,1));
    q.rotateY(k/nf*Math.PI*2+r()*.5);parts.push(q);}return mergeGeometries(parts);};
  const fm=new THREE.MeshStandardMaterial({map:fernTex,alphaTest:.5,side:THREE.DoubleSide,roughness:.9,emissive:0x0C1E18,emissiveMap:fernTex});
  fm.onBeforeCompile=s=>{windHook(s);s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aK;')
   .replace('#include <begin_vertex>',`#include <begin_vertex>\n{float k=aK;const float SW=.05;${SWAY}}`);};
  const geos=[mk(7,.75,3),mk(9,.6,8)];
  geos.forEach((fg,vi)=>{const NF=MOBILE?24:44;const im=new THREE.InstancedMesh(fg,fm,NF);let n=0;
   for(let i=0;i<NF*30&&n<NF;i++){const s=pick(R()<.65?ring(3.,10):ring(10,26),(x,z)=>{const d=rootD(x,z);return d>.25&&d<(Math.hypot(x,z)>10?99:2.2);},6);if(!s)continue;const [x,z]=s;
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
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65});const glowU=C.shroomGlow||{value:0};G.shroomGlow=glowU;
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
   for(let b=0;b<NB*40&&n<NB;b++){const a=rr(0,6.28),r=rr(10,42);const x=Math.cos(a)*r,z=Math.sin(a)*r;
    // keep the view to the house open (camera looks from +z), crowd the sides and the back
    if((z>-3&&Math.abs(x)<15)||rootD(x,z)<1)continue;
    const sz=rr(1.1,2.2)*(r>25?1.4:1);M.compose(V(x,groundH(x,z)-.15,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(.9,1.4),sz*rr(.7,1),sz*rr(.9,1.3)));im.setMatrixAt(n,M);
    Col.setHSL(rr(.3,.38),rr(.2,.35),rr(.48,.6));im.setColorAt(n,Col);n++;}
   im.count=n;im.receiveShadow=true;scene.add(im);});}

 return G;
}
