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
let GLSL_NOISE='';const NZU={value:null};
function initNoise(MOBILE){GLSL_NOISE=`
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
`+(MOBILE?
// phones: fbm is one fetch from a baked, tiling 4-octave noise (16 hash lookups per call -> 1 texture read; the ground
// shader calls it ~8 times on every pixel of the floor, which was the biggest fragment cost of the scene)
`uniform sampler2D uNz;float fbm(vec2 p){return texture2D(uNz,mat2(.8,.6,-.6,.8)*p*.0625).r;}`:
`float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,7.7);a*=.5;}return v;}`);
// the baked noise: periodic value noise (period 16 units) with 4 octaves, same range as the GLSL fbm (0..~.94)
if(MOBILE){const S=512,P=16,d=new Uint8Array(S*S);const hh=(x,y,o)=>hash2(x+o*17.3,y+o*31.1);
 const vp=(x,y,per,o)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);const w=v=>((v%per)+per)%per;
  const a=hh(w(ix),w(iy),o),b=hh(w(ix+1),w(iy),o),c=hh(w(ix),w(iy+1),o),e=hh(w(ix+1),w(iy+1),o);return a+(b-a)*ux+(c-a)*uy+(a-b-c+e)*ux*uy;};
 for(let j=0;j<S;j++)for(let i=0;i<S;i++){let v=0,a=.5,f=1;for(let o=0;o<4;o++){v+=a*vp(i/S*P*f,j/S*P*f,P*f,o);a*=.5;f*=2;}d[j*S+i]=Math.round(v*255);}
 const t=new THREE.DataTexture(d,S,S,THREE.RedFormat,THREE.UnsignedByteType);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;NZU.value=t;}}

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

export function createGround(C){const __before=new Set(C.scene.children);
 const {scene,MOBILE,leafT,groundT,U,obstacles=[]}=C;initNoise(MOBILE);WIND=C.wind||null;
 const R=rng(777123);const rr=(a,b)=>a+R()*(b-a);
 let moundAt=()=>0,reliefAt=()=>0;const groundH=(x,z)=>groundH0(x,z)+moundAt(x,z)+reliefAt(x,z);
 const G={};

 // ================= roots map =================
 // A 0.25 m grid over the clearing. Every bark vertex near the ground marks its cell, then a distance field tells
 // each spot how far it is from the trunk/roots: plants stay out of the wood, grass and moss crowd along its edges,
 // and the ground gets a soft contact shadow under the roots.
 const GS=128,GE=16,CELL=GE*2/GS;const occ=new Uint8Array(GS*GS);const minY=new Float32Array(GS*GS).fill(99);const dist=new Float32Array(GS*GS).fill(99);const topY=new Float32Array(GS*GS).fill(-99);
 {const v=new THREE.Vector3();
  for(const o of obstacles)o.traverse(m=>{if(!m.isMesh||m.isInstancedMesh||!m.geometry)return;const p=m.geometry.attributes.position;if(!p)return;m.updateWorldMatrix(true,false);
   for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);if(Math.abs(v.x)>=GE||Math.abs(v.z)>=GE)continue;
    if(v.y>groundH0(v.x,v.z)+.9)continue;const gx=Math.floor((v.x+GE)/CELL),gz=Math.floor((v.z+GE)/CELL);occ[gz*GS+gx]=1;minY[gz*GS+gx]=Math.min(minY[gz*GS+gx],v.y-groundH0(v.x,v.z));topY[gz*GS+gx]=Math.max(topY[gz*GS+gx],v.y-groundH0(v.x,v.z));}});
  // vertices are sparse on big roots: close small gaps (one dilate + erode pass would eat thin roots, so only fill holes)
  const o2=occ.slice();for(let z=1;z<GS-1;z++)for(let x=1;x<GS-1;x++){if(occ[z*GS+x])continue;let n=0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)n+=occ[(z+dz)*GS+x+dx];if(n>=4)o2[z*GS+x]=1;}occ.set(o2);
  // chamfer distance transform (metres)
  for(let i=0;i<GS*GS;i++)if(occ[i])dist[i]=0;
  const d1=CELL,d2=CELL*1.4142;
  for(let z=0;z<GS;z++)for(let x=0;x<GS;x++){const i=z*GS+x;let d=dist[i];if(x>0)d=Math.min(d,dist[i-1]+d1);if(z>0){d=Math.min(d,dist[i-GS]+d1);if(x>0)d=Math.min(d,dist[i-GS-1]+d2);if(x<GS-1)d=Math.min(d,dist[i-GS+1]+d2);}dist[i]=d;}
  for(let z=GS-1;z>=0;z--)for(let x=GS-1;x>=0;x--){const i=z*GS+x;let d=dist[i];if(x<GS-1)d=Math.min(d,dist[i+1]+d1);if(z<GS-1){d=Math.min(d,dist[i+GS]+d1);if(x<GS-1)d=Math.min(d,dist[i+GS+1]+d2);if(x>0)d=Math.min(d,dist[i+GS-1]+d2);}dist[i]=d;}}
 // WALK (exact): the bark's top SURFACE, rasterised from the root/trunk triangles on a 10 cm grid (the vertex-max map
 // above is ~25 cm coarse and misses between vertices: feet floated up to 37 cm or sank up to 58 cm on the big roots)
 const TS=320,TC=GE*2/TS,topS=new Float32Array(TS*TS).fill(-99);
 {const w=new THREE.Vector3();
  for(const o of obstacles)o.traverse(m=>{if(!m.isMesh||m.isInstancedMesh||!m.geometry)return;const p=m.geometry.attributes.position;if(!p)return;m.updateWorldMatrix(true,false);
   const P=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){w.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);P[i*3]=w.x;P[i*3+1]=w.y;P[i*3+2]=w.z;}
   const idx=m.geometry.index?m.geometry.index.array:null;const nt=(idx?idx.length:p.count)/3;
   for(let t=0;t<nt;t++){const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
    const ax=P[i0*3],ay=P[i0*3+1],az=P[i0*3+2],bx=P[i1*3],by=P[i1*3+1],bz=P[i1*3+2],cx=P[i2*3],cy=P[i2*3+1],cz=P[i2*3+2];
    const x0=Math.min(ax,bx,cx),x1=Math.max(ax,bx,cx),z0=Math.min(az,bz,cz),z1=Math.max(az,bz,cz);if(x1<=-GE||x0>=GE||z1<=-GE||z0>=GE)continue;
    if(Math.min(ay,by,cy)>groundH0((ax+bx+cx)/3,(az+bz+cz)/3)+1.1)continue;
    const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-7)continue;
    const gx0=Math.max(0,Math.ceil((x0+GE)/TC-.5)),gx1=Math.min(TS-1,Math.floor((x1+GE)/TC-.5)),gz0=Math.max(0,Math.ceil((z0+GE)/TC-.5)),gz1=Math.min(TS-1,Math.floor((z1+GE)/TC-.5));
    for(let gz=gz0;gz<=gz1;gz++){const zc=(gz+.5)*TC-GE;for(let gx=gx0;gx<=gx1;gx++){const xc=(gx+.5)*TC-GE;
     const l1=((bz-cz)*(xc-cx)+(cx-bx)*(zc-cz))/den,l2=((cz-az)*(xc-cx)+(ax-cx)*(zc-cz))/den,l3=1-l1-l2;if(l1<-1e-4||l2<-1e-4||l3<-1e-4)continue;
     const y=l1*ay+l2*by+l3*cy;const g0=groundH0(xc,zc);if(y>g0+1.1)continue;const k=gz*TS+gx;if(y>topS[k])topS[k]=y;}}}});}
 // top of the wood under (x,z) in world y, or null where there is none (nearest-cell inside a root, bilinear where all 4 are wood)
 G.barkTop=(x,z)=>{const fx=(x+GE)/TC-.5,fz=(z+GE)/TC-.5;const ix=Math.floor(fx),iz=Math.floor(fz);if(ix<0||iz<0||ix>=TS-1||iz>=TS-1)return null;
  const a=topS[iz*TS+ix],b=topS[iz*TS+ix+1],c=topS[(iz+1)*TS+ix],d=topS[(iz+1)*TS+ix+1];const tx=fx-ix,tz=fz-iz;
  if(a>-90&&b>-90&&c>-90&&d>-90)return (a*(1-tx)+b*tx)*(1-tz)+(c*(1-tx)+d*tx)*tz;const n=topS[Math.round(fz)*TS+Math.round(fx)];return n>-90?n:null;};
 // distance from (x,z) to the nearest root/trunk, in metres (99 = far away / outside the map)
 const rootD=(x,z)=>{if(Math.abs(x)>=GE-CELL||Math.abs(z)>=GE-CELL)return 99;const fx=(x+GE)/CELL-.5,fz=(z+GE)/CELL-.5;const ix=Math.max(0,Math.floor(fx)),iz=Math.max(0,Math.floor(fz));const tx=fx-ix,tz=fz-iz;
  const a=dist[iz*GS+ix],b=dist[iz*GS+ix+1],c=dist[(iz+1)*GS+ix],d=dist[(iz+1)*GS+ix+1];return (a*(1-tx)+b*tx)*(1-tz)+(c*(1-tx)+d*tx)*tz-CELL*.5;};
 G.rootD=rootD;
 // WALK: the height of the wood under a foot (root tops), so the hero steps onto a root instead of wading through it.
 // topY is the highest bark vertex per 0.25 m cell (below +0.9 m); cells the hole filling added take their neighbours' top.
 {const tv=new Float32Array(GS*GS);for(let i=0;i<GS*GS;i++)tv[i]=occ[i]?Math.max(0,topY[i]):0;
  for(let z=1;z<GS-1;z++)for(let x=1;x<GS-1;x++){const i=z*GS+x;if(!occ[i]||topY[i]>-99)continue;let m=0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)m=Math.max(m,topY[i+dz*GS+dx]);tv[i]=m;}
  G.rootTop=(x,z)=>{if(Math.abs(x)>=GE-CELL||Math.abs(z)>=GE-CELL)return 0;const fx=(x+GE)/CELL-.5,fz=(z+GE)/CELL-.5;const ix=Math.max(0,Math.floor(fx)),iz=Math.max(0,Math.floor(fz));const tx=fx-ix,tz=fz-iz;
   return (tv[iz*GS+ix]*(1-tx)+tv[iz*GS+ix+1]*tx)*(1-tz)+(tv[(iz+1)*GS+ix]*(1-tx)+tv[(iz+1)*GS+ix+1]*tx)*tz;};}
 // what the RENDERED floor is at (x,z): the near patch is a coarse grid on phones (64 cm cells), so small things placed
 // at the exact groundH float over the hollows and sink into the bumps; this follows the patch triangles instead
 const PS=MOBILE?48:128,PC=32/PS;
 // reads the real vertex heights of the near patch (32 m) and, outside it, of the big coarse floor (260 m), and
 // interpolates them over the same triangles the GPU draws
 const gridH=(mesh,size,S,x,z)=>{const p=mesh.geometry.attributes.position.array;const C=size/S,h=size/2;const fx=(x+h)/C,fz=(z+h)/C;const ix=Math.floor(fx),iz=Math.floor(fz);
  if(ix<0||iz<0||ix>=S||iz>=S)return null;const tx=fx-ix,tz=fz-iz,W=S+1,oy=mesh.position.y;const Y=(i,j)=>p[((j)*W+(i))*3+1]+oy;
  const ha=Y(ix,iz),hb=Y(ix,iz+1),hc=Y(ix+1,iz+1),hd=Y(ix+1,iz);return tx+tz<=1?ha+(hd-ha)*tx+(hb-ha)*tz:hc+(hb-hc)*(1-tx)+(hd-hc)*(1-tz);};
 const meshH=(x,z)=>{let h=null;if(G.groundPatch)h=gridH(G.groundPatch,32,PS,x,z);if(h==null&&G.ground)h=gridH(G.ground,260,MOBILE?40:150,x,z);
  if(h!=null)return h;const fx=(x+16)/PC,fz=(z+16)/PC;const ix=Math.floor(fx),iz=Math.floor(fz);if(ix<0||iz<0||ix>=PS||iz>=PS)return groundH(x,z);
  const tx=fx-ix,tz=fz-iz,X=-16+ix*PC,Z=-16+iz*PC;const ha=groundH(X,Z),hb=groundH(X,Z+PC),hc=groundH(X+PC,Z+PC),hd=groundH(X+PC,Z);
  return tx+tz<=1?ha+(hd-ha)*tx+(hb-ha)*tz:hc+(hb-hc)*(1-tx)+(hd-hc)*(1-tz);};G.meshH=meshH;
 G.standAt=(x,z)=>{let g=meshH(x,z);const t=G.barkTop(x,z);if(t!=null)g=Math.max(g,t);for(const q of G._stepTops||[])if(Math.hypot(x-q[0],z-q[1])<q[2])g=Math.max(g,q[3]);return g;};/* + the flat stepping stones at the pond: a boot stands on their top, not sunk to the mud under them *//* the RENDERED floor (phone patch cells are ~67 cm: the exact groundH floated or sank feet by up to 6 cm) */// WALK: what a sole stands on: the ground or the top of a root
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
  const w=.28+.25*smooth(1.5,0,Math.hypot(x,z-4.3))-.22*smooth(9.8,13,z)+(vnoise(x*1.7,z*1.7)-.5)*.18;return best-w;};
 // ---- the way out to the forest: branches off the path below the ladder, crosses the right side of the clearing and slips
 // through a gap in the undergrowth (the hero goes out for firewood and to hunt, and comes back the same way) ----
 const EXIT=[[1.4,7.2],[3.4,7.7],[6.1,7.4],[8.9,6.6],[11.6,5.8],[14.2,5.1],[17.4,4.6],[21.5,4.3]];
 const segD=(L,x,z)=>{let best=99;for(let i=0;i<L.length-1;i++){const [ax,az]=L[i],[bx,bz]=L[i+1];const dx=bx-ax,dz=bz-az;const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t));}return best;};
 // the side track is narrower and fainter than the main path (fewer trips), widening a little where it meets it
 const exitD=(x,z)=>segD(EXIT,x,z)-(.2+.06*smooth(3,0,Math.hypot(x-1.4,z-7.2))+(vnoise(x*1.9+4,z*1.9)-.5)*.16);
 // ---- the pond: a small still forest pool a short walk left of the oak (water for the sink), with a muddy bank and its own track ----
 // in front of the oak, left of the ladder path, so it shows from the default camera view (moved from (-8.4,9.2) on Pavel's ask)
 const POND={x:-1.4,z:7.6,rx:1.75,rz:1.15,a:-.12};// 1.4 m nearer than before: from the home view it sat under the bottom edge of the screen
 const pondD=(x,z)=>{const dx=x-POND.x,dz=z-POND.z,c=Math.cos(POND.a),sn=Math.sin(POND.a);const u=(dx*c+dz*sn)/POND.rx,v=(-dx*sn+dz*c)/POND.rz;const r=Math.hypot(u,v);
  const an=Math.atan2(v,u);const wob=1+(vnoise(Math.cos(an)*1.4+5,Math.sin(an)*1.4+2)-.5)*.32;return (r-wob)*(POND.rx+POND.rz)*.5;};
 const PTRACK=[[1.4,7.2],[.9,7.6],[.5,7.7]];
 const ptrackD=(x,z)=>segD(PTRACK,x,z)-(.19+(vnoise(x*2.1+8,z*2.1)-.5)*.14);
 // ---- the way to the chopping block (Props, -3.95, 4.05): recorded from his splitwood walk; a faint narrow track round the
 // roots and a trampled patch where he stands to split (he goes there most days)
 const CHOP=[[0,4.9],[-.45,4.85],[-1.4,5.0],[-2.7,4.85],[-3.9,4.6],[-4.6,4.42]];
 const chopD=(x,z)=>Math.min(segD(CHOP,x,z)-(.15+(vnoise(x*2.3+3,z*2.3)-.5)*.12),Math.hypot(x+4.62,z-4.4)-(.45+(vnoise(x*3.1,z*3.1+6)-.5)*.2));
 // ---- off the way out to the outdoor chopping stump (12.5,7.4) and the firewood stack (13.5,8.1): he goes there for every armful,
 // so a short trodden spur leaves the exit track and forks to where he stands to split and to take logs
 const WOODT=[[11.3,5.9],[11.85,6.6],[11.95,7.05]],WOODT2=[[11.85,6.6],[12.55,7.05],[13.05,7.5]];
 const woodD=(x,z)=>Math.min(segD(WOODT,x,z),segD(WOODT2,x,z))-(.17+(vnoise(x*2.2+9,z*2.2)-.5)*.12);
 const trackD=(x,z)=>Math.min(pathMain(x,z),exitD(x,z),ptrackD(x,z),chopD(x,z),woodD(x,z));
 // everything that keeps off the paths keeps off the water and its bare muddy rim too (and the ground shader paints that rim as wet earth)
 const pathD=(x,z)=>Math.min(trackD(x,z),pondD(x,z)-.3);
 G.pondD=pondD;G.trackD=trackD;
 // the gap in the bushes: keep a 3 m wide corridor clear from the clearing's edge out into the trees
 const exitClear=(x,z)=>segD([[11.6,5.8],[14.2,5.1],[17.4,4.6],[21.5,4.3],[30,4]],x,z)>1.6;
 G.pathD=pathD;G.pathMain=pathMain;
 // ---- gentle relief: low hummocks and shallow dips in the clearing (a forest floor is never a table). Baked on the 25 cm grid;
 // zero on the paths and at the ladder foot (walking heights stay as they were) and faded out before the coarse outer ground ----
 {const RH=new Float32Array(GS*GS);
  for(let gz=0;gz<GS;gz++)for(let gx=0;gx<GS;gx++){const x=(gx+.5)*CELL-GE,z=(gz+.5)*CELL-GE;
   const h=(fbm2(x*.32+17,z*.32+4)-.5)*.15+(fbm2(x*1.1+3,z*1.1+31)-.5)*.06+Math.pow(Math.max(0,fbm2(x*.7+9,z*.7)-.55),1.5)*.35;
   const keep=smooth(.05,.9,pathD(x,z))*smooth(.9,2.2,Math.hypot(x,z-4.3))*smooth(GE-1,GE-3.5,Math.max(Math.abs(x),Math.abs(z)));const pd=pondD(x,z);RH[gz*GS+gx]=h*keep-(pd<.6?(.07+.45*smooth(0,-1.5,pd))*smooth(.6,0,pd):0);}
  reliefAt=(x,z)=>{if(Math.abs(x)>=GE-CELL||Math.abs(z)>=GE-CELL)return 0;const fx=(x+GE)/CELL-.5,fz=(z+GE)/CELL-.5;const ix=Math.max(0,Math.floor(fx)),iz=Math.max(0,Math.floor(fz));const tx=fx-ix,tz=fz-iz;
   return (RH[iz*GS+ix]*(1-tx)+RH[iz*GS+ix+1]*tx)*(1-tz)+(RH[(iz+1)*GS+ix]*(1-tx)+RH[(iz+1)*GS+ix+1]*tx)*tz;};}
 // ---- dew: grass, moss and stones get a wet moonlit sheen and tiny glints at dusk and night (follows env's evening factor) ----
 const glowU=C.shroomGlow||{value:0};const wetU={value:0};G.wet=wetU;
 // weather/time read from Environment's per-frame update (rain, morning, night) without touching env.js or index.html
 const ST={rainK:0,mornK:0,nightK:0,T:0,puddle:0};G.state=ST;
 {const E=window.__env;if(E&&E.update&&!E.__groundHook){const o=E.update;E.update=s=>{ST.rainK=s.rainK||0;ST.mornK=s.mornK||0;ST.nightK=s.nightK||0;ST.T=s.T||0;return o(s);};E.__groundHook=true;}}
 // the hero's feet: grass leans away from him when he walks through it
 const heroU={value:new THREE.Vector3(0,-99,0)};const flushU={value:0};/* rain-flush mushrooms' growth 0..1 */
 // his last few footfalls on the ground (x, ground y, z, strength): grass and ferns under a boot are pressed flat and spring back over ~7 s
 const NSTEP=6,stepsU={value:Array.from({length:NSTEP},()=>new THREE.Vector4(0,-99,0,0))};G.steps=stepsU.value;const stepT=new Float32Array(NSTEP).fill(-99);let stepHead=0,stepSide=1,stepLast=null,stepClock=0;
 const STEP_GLSL=`uniform vec4 uSteps[${NSTEP}];float stepPress(vec2 p,float r){float k=0.;for(int i=0;i<${NSTEP};i++){vec4 st=uSteps[i];k=max(k,smoothstep(r,r*.25,length(p-st.xz))*st.w);}return k;}vec3 stepNear(vec2 p,float r){vec3 b=vec3(1.,0.,0.);for(int i=0;i<${NSTEP};i++){vec4 st=uSteps[i];vec2 d=p-st.xz;float l=length(d);float k=smoothstep(r,r*.25,l)*st.w;if(k>b.z)b=vec3(l>.001?d/l:vec2(1.,0.),k);}return b;}`;
 const tickSteps=(dt,p)=>{if(G.stepsHold)return;/* test hook: freeze the footfalls as set */stepClock+=dt;for(let i=0;i<NSTEP;i++){const age=stepClock-stepT[i];const v=stepsU.value[i];v.w=age<0||age>7?0:(age<.15?age/.15:1-Math.pow((age-.15)/6.85,.6));}
  if(!p||p.y>groundH(p.x,p.z)+.25){stepLast=null;return;}if(!stepLast){stepLast=p.clone();return;}const d=Math.hypot(p.x-stepLast.x,p.z-stepLast.z);if(d<.33)return;
  const yaw=Math.atan2(p.x-stepLast.x,p.z-stepLast.z);const ox=Math.cos(yaw)*.09*stepSide,oz=-Math.sin(yaw)*.09*stepSide;stepSide=-stepSide;
  stepsU.value[stepHead].set(p.x+ox,p.y,p.z+oz,0);stepT[stepHead]=stepClock;stepHead=(stepHead+1)%NSTEP;stepLast.copy(p);};
 // the hero's hand lantern (lights.js) as one uniform: xyz = flame, w = how bright. The real point light lights the floor already, but
 // thin up-bent grass blades and fern fronds mostly catch the cold night sky and stayed icy right beside it; this adds the lantern's
 // warm bounce to them (and a touch to the moss) so the moving pool of light reads as one warm patch of ground
 const lanU={value:new THREE.Vector4(0,-99,0,0)};G.lan=lanU;
 const addLan=(s,k)=>{s.uniforms.uLan=lanU;
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLanW;').replace('#include <project_vertex>','#include <project_vertex>\n{vec4 lw=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nlw=instanceMatrix*lw;\n#endif\nvLanW=(modelMatrix*lw).xyz;}');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform vec4 uLan;varying vec3 vLanW;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n{float ld=length(vLanW-uLan.xyz);totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.,.6,.28)*uLan.w*'+k+'*smoothstep(3.,.2,ld)/(1.+ld*ld*1.4);}');};
 const lanTick=()=>{const L=window.__lights&&__lights.get?__lights.get('hand'):null;/* lights.js: the carried lantern, its world position and level */if(!L||!L.on||!L.pos){lanU.value.w=0;return;}lanU.value.set(L.pos.x,L.pos.y,L.pos.z,Math.min(1,L.level||0));};const critU={value:new THREE.Vector3(0,-99,0)};
 // events for Sound: __ground.on('critter', e => ...) with e = {kind, act, pos:[x,y,z], id, dur?}
 const LST={};G.on=(type,fn)=>{(LST[type]=LST[type]||[]).push(fn);return ()=>{LST[type]=LST[type].filter(f=>f!==fn);};};
 const emit=(kind,act,x,y,z,id,extra)=>{const L=LST.critter;if(!L||!L.length)return;const e=Object.assign({kind,act,pos:[x,y,z],id},extra||{});for(const f of L){try{f(e);}catch(err){console.error(err);}}};

 const wetFrag=(k)=>`{float wet=uWet*${k};roughnessFactor=mix(roughnessFactor,.32,wet);diffuseColor.rgb*=1.-.22*wet;/* soaked: darker as well as glossier */}`;
 const addWet=(s,k)=>{s.uniforms.uWet=wetU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uWet;').replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n'+wetFrag(k));};
 // contact-shadow texture for the ground shader: dark right at the wood, fading over ~1 m
 const aoTex=(()=>{const d=new Uint8Array(GS*GS*4);for(let i=0;i<GS*GS;i++){const k=1-smooth(0,1.1,dist[i]);d[i*4]=255*k;d[i*4+1]=255*(1-smooth(0,.45,Math.abs(dist[i]-.35)));const gx=i%GS,gz=(i/GS)|0;const wx=(gx+.5)*CELL-GE,wz=(gz+.5)*CELL-GE;d[i*4+2]=255*smooth(.3,-.15,pathD(wx,wz));d[i*4+3]=255*smooth(.75,-.05,pondD(wx,wz));}// a: the pond's wet mud bank
  const t=new THREE.DataTexture(d,GS,GS);t.magFilter=t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;})();

 // ================= forest floor =================
 // big mesh with heights from env.js groundH(); vertex colours give the large-scale moss / teal / earth patches,
 // the painted Fal forest floor (ground3.jpg) gives the detail at two scales, plus moss fuzz and root contact shadows.
 {const S=MOBILE?40:150;const g=new THREE.PlaneGeometry(260,260,S,S).rotateX(-Math.PI/2);const p=g.attributes.position;const col=new Float32Array(p.count*3);const c=new THREE.Color();
  const moss=new THREE.Color(0x5E8C55),teal=new THREE.Color(0x3F6B5C),earth=new THREE.Color(0x6E5A47),fall=new THREE.Color(0x6B5034),deep=new THREE.Color(0x36585A);
  const colAt=(x,z)=>{const r=Math.hypot(x,z);const n=fbm2(x*.08+11,z*.08+3),m=fbm2(x*.3,z*.3);
   c.copy(teal).lerp(moss,smooth(.35,.7,n));c.lerp(earth,smooth(5.,2.4,r+(m-.5)*2.5)*.6);c.lerp(fall,smooth(12,22,r+(n-.5)*6)*(.5+.4*m));/* the forest beyond the ring: an autumn leaf floor, not green lawn */c.lerp(deep,smooth(34,80,r)*.4);c.multiplyScalar(.82+m*.3);return c;};
  // the big mesh is coarse (1.7 m), so in the middle it sits 4 cm low and a fine 25 cm patch carries the real shape
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);const inner=Math.max(Math.abs(x),Math.abs(z))<15.6;p.setY(i,groundH0(x,z)-(inner?.1:0)-(pondD(x,z)<2.5?.8:0));colAt(x,z);
   col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
  const pg=new THREE.PlaneGeometry(32,32,MOBILE?48:128,MOBILE?48:128).rotateX(-Math.PI/2);{const pp=pg.attributes.position;const pc=new Float32Array(pp.count*3);
   for(let i=0;i<pp.count;i++){const x=pp.getX(i),z=pp.getZ(i);pp.setY(i,groundH(x,z));colAt(x,z);pc[i*3]=c.r;pc[i*3+1]=c.g;pc[i*3+2]=c.b;}
   pg.setAttribute('color',new THREE.BufferAttribute(pc,3));pg.computeVertexNormals();
   /* the pond dip on the coarse phone patch (67 cm cells) made one sharp crease: past it the bank's normals tilted away, so the lantern's
      pool and the moonlight stopped dead along a straight dark line. Bank normals come from the smooth height field over a wide (~0.7 m)
      footprint instead, eased towards up, so the light falls off softly over the dip */
   {const nn=pg.attributes.normal,e=.7,v=V(),w=V();for(let i=0;i<pp.count;i++){const x=pp.getX(i),z=pp.getZ(i);const pd=pondD(x,z);if(pd>1.8)continue;
     const k=smooth(1.8,.6,pd);v.set(groundH(x-e,z)-groundH(x+e,z),2*e,groundH(x,z-e)-groundH(x,z+e)).normalize();v.y+=.6;v.normalize();
     w.set(nn.getX(i),nn.getY(i),nn.getZ(i)).lerp(v,k).normalize();nn.setXYZ(i,w.x,w.y,w.z);}}}
  /* drip map (filled once the rain height map exists): r = the soaked strip just outside every overhead edge (landings, decks, the
     house), g = sheltered ground under them. 0.25 m cells over x -8..8, z -2..8 */
  const DW=64,DH=40,dripD=new Uint8Array(DW*DH*4),dripTex=new THREE.DataTexture(dripD,DW,DH);dripTex.magFilter=dripTex.minFilter=THREE.LinearFilter;dripTex.needsUpdate=true;
  const dripB={value:new THREE.Vector4(-8,-2,1/16,1/10)};let dripDone=0,dripWait=0;G._dripD=dripD;/* test hook */
  G._dripBuild=()=>{const R=window.__rain;if(dripDone||!R||!R.heightAt)return;if(++dripWait<30)return;dripDone=1;const cov=new Uint8Array(DW*DH);
   for(let j=0;j<DH;j++)for(let i=0;i<DW;i++){const x=-8+(i+.5)*.25,z=-2+(j+.5)*.25;const h=R.heightAt(x,z);cov[j*DW+i]=h!=null&&h-groundH(x,z)>1.2?1:0;}
   const at=(i,j)=>i<0||j<0||i>=DW||j>=DH?0:cov[j*DW+i];
   for(let j=1;j<DH-1;j++)for(let i=1;i<DW-1;i++){const k=j*DW+i;let near=0;for(let b=-2;b<=2;b++)for(let a=-2;a<=2;a++)if(at(i+a,j+b))near=Math.max(near,1-Math.hypot(a,b)/2.6);
    const dw=cov[k]?0:near;/* a strip ~10-50 cm wide outside the edge */const hs=Math.abs(Math.sin(i*12.99+j*78.23)*43758.5)%1;
    dripD[k*4]=255*Math.min(1,dw*(.75+.25*hs));dripD[k*4+1]=255*cov[k];}
   dripTex.needsUpdate=true;};
  const gt=groundT.clone();gt.needsUpdate=true;gt.repeat.set(1,1);gt.wrapS=gt.wrapT=THREE.RepeatWrapping;
  const mat=new THREE.MeshStandardMaterial({map:gt,vertexColors:true,roughness:1,metalness:0});
  mat.onBeforeCompile=s=>{s.uniforms.uAO={value:aoTex};s.uniforms.uGE={value:GE};s.uniforms.uGlow=glowU;
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvGW=(modelMatrix*vec4(position,1.)).xz;');
   s.uniforms.uNz=NZU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;uniform sampler2D uAO;uniform float uGE,uGlow;'+GLSL_NOISE)
    .replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.rgb=mix(diffuseColor.rgb,pathC,pathK);'+
     /* round the chopping block: years of splitting leave the earth strewn with small chips, slivers and curls of bark.
        Fresh pale chips nearest the block, older grey ones further out, dark bark scraps among them (no meshes: a few cells of the floor) */
     '{float crP=length((vGW-vec2(13.5,8.1))*vec2(1.,1.3))-.45;float cr=min(min(length(vGW-vec2(-4.62,4.4)),length(vGW-vec2(12.5,7.4))),crP);float pk=smoothstep(.6,.0,crP);{float cz=smoothstep(1.5,.35,cr+(fbm(vGW*2.)-.5)*.5);'+
     /* the same strew round the outdoor stump and, mostly bark flakes and old grey chips, round the firewood stack (pk) */'vec2 q=vGW*9.;vec2 ci=floor(q),cf=fract(q)-.5;float h=fract(sin(dot(ci,vec2(127.1,311.7)))*43758.5);'+
     'float an=h*6.283;vec2 d=mat2(cos(an),-sin(an),sin(an),cos(an))*(cf-(vec2(fract(h*17.),fract(h*29.))-.5)*.5);float sl=smoothstep(.17,.12,abs(d.y)*(1.+.9*fract(h*7.)))*smoothstep(.34,.27,abs(d.x)*(.9+.7*fract(h*5.)));'+
     'float on=sl*step(1.-cz*(.42-.14*pk),h)*(.75+.25*smoothstep(.0,.05,abs(d.y)-.0));float bk=step(.8-.3*pk,fract(h*13.));float old=smoothstep(.35,1.,cr)+.3*fract(h*3.)+.4*pk;'+
     'vec3 cc=mix(vec3(.42,.32,.2),vec3(.24,.2,.15),clamp(old,0.,1.))*(.75+.3*fract(h*11.));cc=mix(cc,vec3(.11,.075,.055),bk);'+
     'diffuseColor.rgb=mix(diffuseColor.rgb*(1.-.25*cz),cc,on*.9);}}').replace('#include <map_fragment>',`
     // two texture scales blended by noise: no visible tiling. The far scale is softened so the painted clumps read as ground, not stickers.
     float pathK=0.;vec3 pathC=vec3(0.);float pondMud=0.,pondWet=0.,forK=0.;
     vec2 gw=vGW+(vec2(fbm(vGW*.21),fbm(vGW*.21+3.7))-.5)*2.4;/* domain warp: the painted moss clumps stop repeating as same-size round blobs */vec4 g1=texture2D(map,gw/4.6,4.5);vec4 g2=texture2D(map,vGW/12.7+.37,5.);/* the source image (ground3.jpg) is a painted floor with painted oak leaves, stones and clover: at the 12.7 m scale its leaves lay as flat 1 m stickers. Read it heavily softened (mip bias, no branch) as colour only, so no flat painted blades or stones sit next to the real 3D ones */float bn=fbm(vGW*.09);vec3 gc=mix(g1.rgb,g2.rgb,smoothstep(.35,.65,bn));
     // close to the camera a finer third scale adds crisp detail (the far scales blur when you zoom in)
     vec3 g0=gc*(.7+.6*fbm(vGW*3.3+.71))*vec3(.96+.1*fbm(vGW*1.9+5.),1.,.96);/* near detail: the painted image's round grass clumps read as flat discs up close; mottled moss noise instead */float nearK=1.-smoothstep(2.5,11.,length(vViewPosition));gc=mix(gc,g0,.6*nearK);
     vec3 gm=vec3(.08+.22*fbm(vGW*9.7+.13));gc=mix(gc,gc*(.55+3.4*dot(gm,vec3(.3,.55,.15))),.2*nearK);gc*=1.+(fbm(vGW*26.)-.5)*.3*nearK;
     float lum=dot(gc,vec3(.3,.55,.15));gc=mix(vec3(lum),gc,.82);
     // moss fuzz: fine light/dark mottling, brighter mossy cushions in patches
     float mf=fbm(vGW*2.3);float mp=smoothstep(.5,.72,fbm(vGW*.35+4.)+(fbm(vGW*2.7+5.)-.5)*.45)*(.55+.45*smoothstep(.3,.7,fbm(vGW*6.1+1.)));/* the lighter moss beds are broken into tufts and ragged edges: from the home view they were smooth pale-green discs, a painted look */gc*=.82+.36*mf;gc=mix(gc,gc*vec3(.95,1.18,.9)+vec3(.0,.025,.0),mp*.45);
     diffuseColor*=vec4(gc*1.85,1.);{float ok=smoothstep(10.,4.,length(vGW-vec2(0.,1.)));diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.86,1.2,.84),ok*.6);}
     // night: the photo's floor stays a readable moonlit moss green, not near-black
     {float ev=clamp(uGlow/1.8,0.,1.);diffuseColor.rgb*=1.+.45*ev;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.82,1.25,.95),ev*.7);}
     // roots: soft contact shadow, a ring of damp dark earth hugging the wood
     float litA=.3+.22*(1.-smoothstep(5.,11.,length(vGW-vec2(0.,1.5))+(fbm(vGW*.5+21.)-.5)*3.));/* under the big crown the oak drops most: a thicker leaf bed out to ~10 m, thinning raggedly *//* autumn leaf litter amount, raised near roots, path edges and the pond below */
     /* under the forest ring the floor is shaded and leaf-buried, not a mown lawn: from the clearing's edge outwards the moss gives way to brown litter in patches */
     {float ff=smoothstep(10.5,17.,length(vGW-vec2(0.,1.5))+(fbm(vGW*.35+7.)-.5)*5.);forK=ff;litA+=ff*.9;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.33)))*vec3(1.25,.95,.62)*.9,ff*(.35+.6*smoothstep(.25,.65,fbm(vGW*.6+2.))));}
     vec2 auv=(vGW+uGE)/(2.*uGE);if(auv.x>0.&&auv.x<1.&&auv.y>0.&&auv.y<1.){vec4 ao=texture2D(uAO,auv);{vec2 ab=min(auv,1.-auv);ao*=smoothstep(0.,.07,min(ab.x,ab.y));}/* the root/path/pond map ends at +-16 m: fade it out over the last ~2 m, or the forest path and moss band stopped on a straight square border */litA+=ao.r*.9+ao.g*.35+smoothstep(.02,.3,ao.b)*(1.-smoothstep(.45,.85,ao.b))*.6;diffuseColor.rgb*=1.-ao.r*.42;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.72,1.3,.62)+vec3(.0,.016,.0),ao.g*.7);/* photo: a band of green moss where every root meets the floor */
      /* the last ~20 cm against the wood: soil and moss tucked up to the root, not a clean cut line of lawn against bark. Dark crumbly humus
         with leaf mould, broken by cushions of moss that creep up onto the bark foot; litter heaps against the root as wind would leave it */
      {float tk=smoothstep(.56,.9,ao.r+(fbm(vGW*3.1+5.)-.5)*.18);float hm=fbm(vGW*11.+2.);vec3 soil=vec3(.2,.152,.105)*(.6+.8*hm)*(.75+.5*lum);
       float ms=smoothstep(.48,.62,fbm(vGW*1.7+9.)+(hm-.5)*.3);vec3 mossC=diffuseColor.rgb*vec3(.85,1.12,.8)*(.8+.4*fbm(vGW*31.));
       diffuseColor.rgb=mix(diffuseColor.rgb,mix(soil,mossC,ms),tk*.85);litA+=tk*(1.-ms)*.7;}
      // trodden path: packed brown earth with a few pressed blades left at its frayed edges
      /* the walked edge: moss scuffed thin and dried a straw-grey beside the trodden earth (feet stray off the line), fewer leaves left lying */
      {float ed=smoothstep(.04,.3,ao.b)*(1.-smoothstep(.5,.9,ao.b))*smoothstep(.3,.7,fbm(vGW*4.7+2.));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.33)))*vec3(1.15,1.,.72),ed*.55);litA*=1.-ed*.4;}
      pathK=ao.b*smoothstep(.35,.75,ao.b+(fbm(vGW*2.3)-.5)*.8)*(.55+.25*fbm(vGW*.8))*(1.-.35*clamp(uGlow/1.8,0.,1.));pathC=vec3(.17,.135,.1)*(.6+.7*fbm(vGW*7.))*(.65+.7*lum)*(1.-ao.r*.4);pathC*=1.+.55*clamp(uGlow/1.8,0.,1.);/* [ENV] night: the packed earth catches the moonlight more than the moss, so the way out stays readable */
      // grit and small pebbles pressed into the packed earth
      {vec2 pq=vGW*9.;vec2 pi=floor(pq),pf=fract(pq)-.5;float ph=fract(sin(dot(pi,vec2(41.3,289.1)))*43758.5);vec2 po=vec2(fract(ph*13.),fract(ph*71.))-.5;vec2 pe=(pf-po*.6)*vec2(1.,1.6+fract(ph*3.));float pb=smoothstep(.09,.05,length(pe)*(.8+.4*fract(ph*11.)))*step(.9,ph);pathC=mix(pathC,vec3(.22,.2,.17)*(.7+.5*fract(ph*7.)),pb*.6);pathC*=.85+.3*fbm(vGW*22.);}
      // the pond bank: dark wet mud, glossy, ragged at its outer edge; trodden earth turns to mud where the track meets the water
      {float m=smoothstep(.0,.55,ao.a+(fbm(vGW*3.1+5.)-.5)*.45);/* damp brown earth (not a black hole up close), darker and glossy only in the soaked strip at the waterline */float wt=smoothstep(.8,.97,ao.a+(fbm(vGW*7.3)-.5)*.12);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.085,.066,.045)*(.6+.8*fbm(vGW*9.))*mix(1.,.62,wt),m*.88);pathK*=1.-m*.75;pondMud=m;pondWet=wt*m;}
      /* where he pours the dirty bucket over the trunk landing's edge (Brain: stream lands ~(-0.45, 4.05)): a dark, wet, slightly muddy splash patch */
      {float dp=length(vGW-vec2(-.45,4.05))+(fbm(vGW*5.3)-.5)*.22;float m=smoothstep(.36,.1,dp);diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.42,.38,.33)+vec3(.014,.01,.007),m*.9);litA*=1.-m*.5;}/* no gloss: the coarse phone floor facets showed as a black mirror polygon */}
     // ---- autumn leaf litter (Environment): oak leaves blown into drifts against the roots, along the path edges and around the
     // pond, a thin scatter everywhere else. Procedural (no texture taps): leaf specks per 14 cm cell up close, and their average
     // colour further out where a speck would be under a pixel, so it reads from the home view without shimmering.
     {vec2 pd=(vGW-vec2(${POND.x.toFixed(2)},${POND.z.toFixed(2)}))/vec2(${POND.rx.toFixed(2)},${POND.rz.toFixed(2)});float pr=length(pd);/* [ENV] the bank: dark wet mud at the waterline, its outer edge frayed into the moss (no drawn ring) */pathK*=max(smoothstep(.3,.62,fbm(vGW*3.7)+(1.45-pr)*1.1),smoothstep(1.5,2.3,pr+(fbm(vGW*2.9+4.)-.5)*.5));/* was mix(..,1.,step(2.2,pr)): the path's fray near the pond switched off on a hard ellipse, a straight-looking pale/dark cut across the trodden earth (Lights' 'wedge') */pathC*=mix(.55,1.,smoothstep(1.,1.32,pr+(fbm(vGW*5.)-.5)*.18))*mix(vec3(.9,.95,1.),vec3(1.),smoothstep(1.,1.3,pr));litA+=smoothstep(1.,1.25,pr)*(1.-smoothstep(1.6,2.6,pr))*.7;
      litA*=.5+1.1*fbm(vGW*.45+11.);litA=clamp(litA,0.,.95);
      // [ENV] real litter, not evenly spaced ovals: two overlapping layers of lobed oak leaves (12 and 18 cm, the second grid turned
      // and shifted so no rows show), each leaf its own size, turn and colour (rust, ochre, brown, a few pale yellow, some dark and
      // rotting), a midrib, a shade at its curled edge and a soft contact shadow, gathered in drifts with bare moss between.
      litA*=.45+.9*fbm(vGW*1.7+3.);litA=clamp(litA,0.,.95);
      vec2 lq=vGW*8.;vec2 lw=fwidth(lq);float far=smoothstep(.1,.3,max(lw.x,lw.y));/* [ENV] Props phone pass: leaves under ~4 px became a crawling grid of orange dashes; they melt into their average colour sooner */
      vec3 lcol=vec3(0.);float lm=0.,lsh=0.;
      for(int L=0;L<${MOBILE?1:2};L++){/* phones: one layer (fill rate) */float sc=L==0?8.:5.5;float ra=L==0?${MOBILE?'.52':'0.'}:.83;/* phones draw one layer only: turned off the world axes, so the specks do not line up in rows along x/z */vec2 pq=mat2(cos(ra),-sin(ra),sin(ra),cos(ra))*vGW*sc+float(L)*vec2(.37,.71);
       vec2 li=floor(pq),lf=fract(pq)-.5;float lh=fract(sin(dot(li+float(L)*17.3,vec2(12.9898,78.233)))*43758.5453);
       float on=step(lh,min(.7,litA*(L==0?1.05:.8)*mix(.05,1.8,smoothstep(.42,.6,fbm(vGW*.55+13.)))));/* never every cell: a full bed of same-size blades read as a printed pattern *//* drifts and bare moss between, not an even confetti */float la=fract(lh*91.7)*6.283;vec2 lr=mat2(cos(la),-sin(la),sin(la),cos(la))*(lf-(vec2(fract(lh*17.),fract(lh*29.))-.5)*${MOBILE?'.36':'.22'});
       float sz=.58+.47*fract(lh*41.);lr/=sz;float u=lr.x/.36;float pr=sqrt(max(0.,1.-u*u))*(1.-.25*u);
       float lob=.74+.26*abs(sin((u+1.)*5.5+lh*3.));float w=.155*pr*lob;float e=fwidth(lr.y)+.003;float d=abs(lr.y)-w;
       float m=(1.-smoothstep(-e,e,d))*step(abs(u),1.);m=max(m,(1.-smoothstep(.007,.007+e,abs(lr.y)))*step(.95,u)*step(u,1.3));m*=on;
       float sh=(1.-smoothstep(0.,.09,d))*step(abs(u),1.2)*on;
       float c=fract(lh*7.);vec3 cc=c<.3?vec3(.58,.24,.07):c<.55?vec3(.66,.44,.13):c<.75?vec3(.38,.22,.1):c<.87?vec3(.76,.6,.22):vec3(.2,.14,.08);
       cc*=.8+.55*fract(lh*53.);cc=mix(cc,vec3(.16,.11,.06),step(.72,fract(lh*37.))*.6);/* a share of them dark, wet and rotting */float mid=1.-smoothstep(0.,.012+e,abs(lr.y));float edge=smoothstep(.45,1.,abs(lr.y)/max(w,.01));
       cc*=(1.-.3*mid)*(1.-.35*edge)*(.9+.2*sign(lr.y)*fract(lh*5.));
       lsh=max(lsh,sh*(1.-lm));lcol=mix(lcol,cc,m);lm=max(lm,m);}
      vec3 avg=vec3(.5,.3,.1);float ff=1.-pathK*.6;
      diffuseColor.rgb*=1.-.3*lsh*(1.-lm)*(1.-far)*ff;
      /* far off the single leaves melt into their average: keep the drifts and their colour mix (rust, ochre, brown) there too, so the home view shows leaf beds and bare moss, not an even orange wash */float dr0=smoothstep(.36,.62,fbm(vGW*.55+13.)+(fbm(vGW*2.9+8.)-.5)*.3);float hu=fbm(vGW*1.3+31.);avg=mix(vec3(.56,.26,.08),vec3(.62,.42,.13),smoothstep(.35,.65,hu))*mix(.65,1.1,fbm(vGW*4.1+2.));
      float k=mix(lm,clamp(litA*mix(.2,1.6,dr0),0.,.9)*mix(.6,.85,forK),far)*ff;diffuseColor.rgb=mix(diffuseColor.rgb,mix(lcol*vec3(2.3,1.45,1.15),avg*vec3(1.6,1.3,1.2),far)*(.75+.6*lum),k);}`);};
  {const ob=mat.onBeforeCompile;mat.onBeforeCompile=s=>{ob(s);addWet(s,'.35');s.uniforms.uDrip={value:dripTex};s.uniforms.uDripB=dripB;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D uDrip;uniform vec4 uDripB;');s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.3,pondMud*.8);roughnessFactor=mix(roughnessFactor,.1,pondWet);{vec2 dq=texture2D(uDrip,(vGW-uDripB.xy)*uDripB.zw).rg;float dr=min(dq.r*1.5,1.)*uWet;diffuseColor.rgb*=1.-.5*dr;roughnessFactor=mix(roughnessFactor,.3,dr*.85);/* drip lines: the soil right outside every landing and deck edge, where the eaves drop their water, is soaked dark; under the cover it stays drier */float wm=uWet*(1.-.75*dq.g)*clamp(pathK*1.2+smoothstep(.56,.9,texture2D(uAO,(vGW+uGE)/(2.*uGE)).r)*.6,0.,1.);diffuseColor.rgb*=1.-.4*wm;roughnessFactor=mix(roughnessFactor,.38,wm*.8);}/* rain: the trodden paths and the soil at the roots turn to dark, slick mud */');};}
  {const ob=mat.onBeforeCompile;mat.onBeforeCompile=s=>{ob(s);addLan(s,'1.3');};}mat.customProgramCacheKey=()=>'groundFloor-tuck2-chips2-crown1-ao42-pfray-edge1-scuff1-drip1-mp2-far2-soft1';/* [ENV] explicit key (SHADERS rule) */
  const ground=new THREE.Mesh(g,mat);ground.receiveShadow=true;G.ground=ground;
  const patch=new THREE.Mesh(pg,mat);patch.receiveShadow=true;G.groundPatch=patch;
  /* one draw for the floor: the big coarse mesh and the fine 32 m patch share the material, so they are drawn as one merged mesh.
     G.ground / G.groundPatch stay (off-scene) as the height grids meshH and treedress read; the per-frame tick runs on the drawn floor */
  {const fl=new THREE.Mesh(mergeGeometries([g,pg]),mat);fl.name='groundFloor';fl.receiveShadow=true;scene.add(fl);G.floor=fl;}
  let lastT=performance.now();
  G.floor.onBeforeRender=(r,sc,cam)=>{const now=performance.now(),dt=Math.min(.1,(now-lastT)/1000);lastT=now;
   // wet: dusk and night dew, morning dew, rain; puddles fill in rain and dry slowly after it
   // a faint dew at night and in the morning; really wet only in rain (Wind's wet(): soaks in ~8 s, dries over ~2 min, same as bark and ropes)
   const rw=C.wind&&C.wind.wet?C.wind.wet():ST.rainK;const want=Math.max(Math.min(1,glowU.value/1.8)*.1,ST.mornK*.35,rw);wetU.value+=(want-wetU.value)*Math.min(1,dt*1.5);
   ST.puddle=ST.rainK>.05?Math.min(1,ST.puddle+dt*ST.rainK/25):Math.max(0,ST.puddle-dt/90);if(G.updatePuddles)G.updatePuddles(cam);
   const h=window.__dbg&&window.__dbg.hero&&window.__dbg.hero.root;if(h){const p=h.position;heroU.value.set(p.x,p.y,p.z);}tickSteps(dt,h?h.position:null);if(G._dripBuild)G._dripBuild();if(G._pileWatch)G._pileWatch();
   lanTick();if(G.updateGrass)G.updateGrass(cam);if(G.updateFootprints)G.updateFootprints();if(G.updateLife)G.updateLife(dt,cam);if(G._flush)G._flush(dt);};
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
  const ob=grassMat.onBeforeCompile;grassMat.onBeforeCompile=s=>{ob(s);NOFLIP(s);addWet(s,'.9');s.uniforms.uGlow=glowU;s.uniforms.uHero=heroU;s.uniforms.uCrit=critU;s.uniforms.uSteps=stepsU;
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform vec3 uHero;uniform vec3 uCrit;'+STEP_GLSL).replace('#include <project_vertex>',`{vec3 ipw=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);vec2 dv=ipw.xz-uHero.xz;float dd=length(dv);
     float f=smoothstep(.55,.1,dd)*step(abs(ipw.y-uHero.y),.6)*uv.y;vec2 pd=dd>.001?dv/dd:vec2(1.,0.);
     transformed+=windLocal(vec3(pd.x*.22,-.12,pd.y*.22)*f*length(instanceMatrix[1].xyz)*.6);
     // where a boot came down: the tuft is pressed flat outwards from the print and slowly rises again
     {vec3 sn=stepNear(ipw.xz,.32);if(sn.z>.001){float hv=max(0.,(instanceMatrix*vec4(transformed,1.)).y-ipw.y);transformed+=windLocal(vec3(sn.x*hv*.85,-hv*.72,sn.y*hv*.85)*sn.z);}}/* blades laid down outwards, height for height */
     // a hedgehog or mouse parts the grass too (smaller radius)
     vec2 cv=ipw.xz-uCrit.xz;float cd=length(cv);float cf=smoothstep(.28,.05,cd)*uv.y;vec2 cdn=cd>.001?cv/cd:vec2(1.,0.);transformed+=windLocal(vec3(cdn.x*.14,-.06,cdn.y*.14)*cf*length(instanceMatrix[1].xyz)*.6);}
    #include <project_vertex>`);
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vDew;').replace('#include <begin_vertex>','#include <begin_vertex>\nvDew=vec3(uv,instanceMatrix[3][0]*3.1+instanceMatrix[3][2]*7.7);');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vDew;uniform float uGlow;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n{vec2 g=vec2(vDew.x*3.,vDew.y*48.)+vDew.z;vec2 q=floor(g),f=fract(g)-.5;f.y*=.35;float h=fract(sin(dot(q,vec2(12.9898,78.233)))*43758.5453);totalEmissiveRadiance+=vec3(.75,.85,1.)*step(.985,h)*smoothstep(.16,.03,length(f))*step(.15,vDew.y)*smoothstep(.3,.8,uWet)*.55*(1.-.9*clamp(uGlow/1.8,0.,1.));/* a drop only glints in daylight: at night it was a lit dot */}');s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vColor.rgb*vColor.rgb*.06;');
   /* [ENV] a blade seen edge-on to a light (its back-face normal is not flipped, see NOFLIP) can give one huge specular pixel; bloom smeared it into a
      screen-wide green blob in a storm (Lights, frame 931). A blade never outshines a lamp: clamp it, and drop NaN */
   s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','outgoingLight=(outgoingLight.r+outgoingLight.g+outgoingLight.b<1e3)?min(outgoingLight,vec3(1.6)):vec3(0.);\n#include <opaque_fragment>');};
  {const ob2=grassMat.onBeforeCompile;grassMat.onBeforeCompile=s=>{ob2(s);addLan(s,'4.');};}grassMat.customProgramCacheKey=()=>'groundGrass-clamp1-lan-step2-wet2';}
 // variants: tall spiky (the photo's tufts), short dense, and a cheap far version
 const tuftA=tuftGeo(MOBILE?8:13,MOBILE?3:6,11,.2,.46,.1),tuftB=tuftGeo(MOBILE?6:15,MOBILE?2:4,23,.08,.2,.16),tuftF=tuftGeo(MOBILE?4:7,2,37,.22,.5,.14);
 // Grass is cut into 14 m chunks (24 m far out), one InstancedMesh per chunk and detail level, so the camera's frustum culls what is
 // off screen, and chunks far from the camera swap to a cheaper tuft (fewer blades and segments) or switch off.
 const CH=MOBILE?32:14,CHF=MOBILE?64:24,grassChunks=[];// phones: fewer, bigger chunks (draw-call budget)
 function scatterGrass(geo,lo,N,gen,size,name,far,one){const pts=[];let guard=0;
  while(pts.length<N&&guard++<N*40){// clumps: a seed spot, a few tufts around it
   const s=gen();const cnt=2+Math.floor(R()*6);
   for(let j=0;j<cnt&&pts.length<N;j++){const x=s[0]+rr(-.9,.9),z=s[1]+rr(-.9,.9);const d=rootD(x,z);if(d<.06)continue;const r=Math.hypot(x,z);
    // density: dense along root edges, sparse on bare trodden earth near the trunk, patchy elsewhere
    const pd=pathD(x,z);if(pd<-.05||(pd<.12&&R()<.75))continue;if(z>POND.z-.3&&pondD(x,z)<1.1)continue;/* the camera side of the pond stays open */const tr=(!far&&trackD(x,z)<.5)?smooth(.5,.05,trackD(x,z)):0;
    const dens=Math.max(smooth(1.7,.12,d),smooth(.38,.62,fbm2(x*.18+2,z*.18+9))*(.25+.75*smooth(3,6,r))*(MOBILE?.42:.8));if(R()>dens)continue;
    const sz=rr(size[0],size[1])*(1+smooth(10,40,r)*.5);let q=slopeQ(x,z,rr(0,6.28));
    // trodden: squashed low and pushed over, away from the track (a worn edge, not a mown lawn)
    if(tr>0){const e=.05;const gx=trackD(x+e,z)-trackD(x-e,z),gz=trackD(x,z+e)-trackD(x,z-e);const ax=V(gz,0,-gx).normalize();if(ax.lengthSq()>.5)q=new THREE.Quaternion().setFromAxisAngle(ax,.75*tr).multiply(q);}
    const m=new THREE.Matrix4().compose(V(x,meshH(x,z)-.02,z),q,V(sz*rr(.85,1.2),sz*rr(.8,1.25)*(1-.55*tr),sz*rr(.85,1.2)));
    const hsh=(Math.sin(x*127.1+z*311.7)*43758.5453)%1,hs=Math.abs(hsh);/* [ENV] per-tuft variety from a position hash (the shared R() stream stays as it was) */const dry=Math.max(smooth(.48,.78,fbm2(x*.4,z*.4+20)),hs<.16?.55+hs*2.5:0);/* autumn: wider straw and olive patches, and single dry tufts in the green */const c=new THREE.Color().setHSL(rr(.27,.38)-dry*.16,rr(.22,.38)+dry*.04,rr(.33,.47)+dry*.1);if(hs>.8)c.multiplyScalar(.72+(hs-.8)*1.2);/* some tufts in shade-dark green */pts.push({x,z,m,c});}}
  const buckets=new Map();for(const p of pts){const cs=far?CHF:CH;const k=one?'all':Math.floor(p.x/cs)+','+Math.floor(p.z/cs);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
  for(const list of buckets.values()){const mk=g=>{if(!g)return null;const im=new THREE.InstancedMesh(g,grassMat,list.length);list.forEach((p,i)=>{im.setMatrixAt(i,p.m);im.setColorAt(i,p.c);});
    im.computeBoundingSphere();im.receiveShadow=true;im.castShadow=false;im.name=name;im.visible=false;scene.add(im);return im;};
   let cx=0,cz=0;for(const p of list){cx+=p.x;cz+=p.z;}grassChunks.push({c:V(cx/list.length,0,cz/list.length),hi:mk(geo),lo:mk(lo),far,n:list.length});}}
 // detail levels: hi near the camera, lo further out, nothing past the fog
 const tuftAlo=tuftGeo(MOBILE?5:7,2,11,.2,.46,.1),tuftBlo=tuftGeo(MOBILE?4:8,MOBILE?1:2,23,.08,.2,.16);
 scatterGrass(tuftA,tuftAlo,MOBILE?236:900,ring(2.4,18),[.7,1.25],'grassTall');
 scatterGrass(tuftB,tuftBlo,MOBILE?180:800,ring(2.2,14),[.8,1.3],'grassShort',false,MOBILE);// phones: one chunk each for the short and the far grass (draw calls)
 scatterGrass(tuftF,null,MOBILE?80:450,ring(16,48,.85),[1.3,2.1],'grassFar',true,MOBILE);
 G.grass=grassChunks;
 const LOD_HI=MOBILE?10:16,LOD_OFF=MOBILE?55:75;
 G.updateGrass=cam=>{for(const ch of grassChunks){const d=Math.hypot(cam.position.x-ch.c.x,cam.position.z-ch.c.z);
   if(ch.far){ch.hi.visible=d<LOD_OFF;continue;}const hi=d<LOD_HI;ch.hi.visible=hi||!ch.lo;if(ch.lo)ch.lo.visible=!hi&&d<LOD_OFF;}};

 // ================= moss cushions =================
 // soft lumpy pillows of moss where the roots meet the ground and on the sides of stones (the cosy, overgrown look)
 const mossRocks=[];
 {const base=smoothIco(MOBILE?1:3);const p=base.attributes.position;const col=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){const v=V(p.getX(i),p.getY(i),p.getZ(i));const k=1+(vnoise(v.x*2.5+3,v.z*2.5+v.y*2)-.5)*.5;const y=v.y<0?v.y*.2:v.y*.55;p.setXYZ(i,v.x*k,y*k,v.z*k);
   const up=Math.max(0,v.y);const c=new THREE.Color(0x1C3026).lerp(new THREE.Color(0x3C6236),smooth(.1,.9,up));col.set([c.r,c.g,c.b],i*3);}
  base.computeVertexNormals();base.setAttribute('color',new THREE.BufferAttribute(col,3));
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
  mat.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMW=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;');
   s.uniforms.uNz=NZU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;'+GLSL_NOISE).replace('#include <color_fragment>','#include <color_fragment>\n{float f=fbm(vMW.xz*14.+vMW.y*9.);float f2=fbm(vMW.xz*3.1);diffuseColor.rgb*=.6+.6*f;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.9,1.15,.8),f2*.6);\n/* [ENV] fuzz: tiny bright moss tips and dark gaps between the fronds, so a cushion is a pile of moss, not a smooth plastic lump */float fz=fbm(vMW.xz*61.+vMW.y*47.);diffuseColor.rgb*=.55+.9*fz;diffuseColor.rgb+=vec3(.05,.08,.02)*smoothstep(.62,.8,fz);}').replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n{float h0=fbm(vMW.xz*38.+vMW.y*29.);normal=normalize(normal+vec3(dFdx(h0),dFdy(h0),0.)*-9.);}');};
  mat.customProgramCacheKey=()=>'groundMoss-fuzz1';
  const N=MOBILE?42:70;const im=new THREE.InstancedMesh(base,mat,N);let n=0;
  for(let t=0;t<N*30&&n<N;t++){const s=pick(R()<.65?ring(2.2,8):ring(8,13),(x,z)=>{const d=rootD(x,z);return d>.04&&d<.5&&pathD(x,z)>.15;},6);if(!s)continue;const [x,z]=s;
   let sz=rr(.09,.24)*(n%5===0?1.5:1);E.set(0,rr(0,6.28),0);Q.setFromEuler(E);/* [ENV] the big ones were smooth green pebbles that read as plastic: a real stone sits there now (stones below), with a small moss cushion tucked at its foot */let mx=x,mz=z;if(sz>.2){mossRocks.push([x,z,sz]);const ha=Math.abs(Math.sin(x*91.7+z*47.3))*6.283;mx=x+Math.cos(ha)*sz*.75;mz=z+Math.sin(ha)*sz*.75;sz*=.5;}M.compose(V(mx,groundH(mx,mz)-sz*.25,mz),Q,Sc.set(sz*rr(.8,1.2),sz*rr(.9,1.3),sz*rr(.8,1.1)));im.setMatrixAt(n,M);G._stones=(G._stones||[]);G._stones.push([x,z,sz*.8]);
   Col.setHSL(rr(.28,.36),rr(.15,.28),rr(.42,.55));im.setColorAt(n,Col);n++;}
  im.count=n;im.receiveShadow=true;scene.add(im);G.moss=im;}

 // ================= stones =================
 const fract=v=>v-Math.floor(v);
 // near stones get the finer mesh; the distant ones (past 9 m, small on screen and in the fog) a coarser copy of the same shape
 {const mkStone=d=>{const base=smoothIco(d);const p=base.attributes.position;
  for(let i=0;i<p.count;i++){const v=V(p.getX(i),p.getY(i),p.getZ(i));const k=1+(vnoise(v.x*1.7+v.z,v.y*1.9+2)-.5)*.45+(vnoise(v.x*5,v.z*5+v.y*3)-.5)*.08;p.setXYZ(i,v.x*k*1.15,(v.y<0?v.y*.5:v.y*.92)*k,v.z*k);}
  base.computeVertexNormals();const nr=base.attributes.normal;const col=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){const up=nr.getY(i);const c=new THREE.Color(0x585550).lerp(new THREE.Color(0x46503A),smooth(.4,.8,up)*.6).multiplyScalar(.85+vnoise(p.getX(i)*4,p.getZ(i)*4)*.25);col.set([c.r,c.g,c.b],i*3);}
  base.setAttribute('color',new THREE.BufferAttribute(col,3));return base;};
  const base=mkStone(MOBILE?2:4);
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,envMapIntensity:.2});mat.customProgramCacheKey=()=>'groundStone-moss3';
  mat.onBeforeCompile=s=>{addWet(s,'.3');s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;varying vec3 vON;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMW=position;vON=normal;');
   s.uniforms.uNz=NZU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vMW;varying vec3 vON;'+GLSL_NOISE).replace('#include <color_fragment>','#include <color_fragment>\n{float worn=step(1.,vColor.g);diffuseColor.rgb/=mix(1.,40.,worn);float b=fbm(vMW.xz*6.+vMW.y*4.);float g=fbm(vMW.xz*23.+vMW.y*19.);diffuseColor.rgb*=.62+.5*b;\n// pitted granite grain, dark cracks, pale lichen rosettes and a moss cap on the top only\ndiffuseColor.rgb*=.8+.35*g;diffuseColor.rgb*=mix(1.,.45,smoothstep(.36,.3,abs(fbm(vMW.xz*4.+vMW.y*7.+3.)-.5)+.28));\nfloat li=smoothstep(.66,.72,fbm(vMW.xz*9.+vMW.y*5.+11.))*step(-.2,vON.y);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.55,.58,.47),li*.55);\nfloat cap=smoothstep(.55,.9,vON.y+(fbm(vMW.xz*5.)-.5)*.7);float fz=fbm(vMW.xz*55.+vMW.y*41.);/* [ENV] the moss on top is a fuzzy dark-green pelt (bright tips, dark gaps), not a smooth mint coat */diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.08,.15,.055)*(.4+1.*fz)*(.75+.4*g),cap*.85*(1.-worn));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.068,.06)*(.7+.6*g)*(.75+.5*b),worn*.9);}');};
  const N=MOBILE?25:75;const im=new THREE.InstancedMesh(base,mat,N+N+12+mossRocks.length);let n=0;let nf=0;/* far stones join the near mesh (one draw; ~+3k tris on phones) */const far={setMatrixAt:(i,m)=>{im.setMatrixAt(n,m);},setColorAt:(i,c)=>{im.setColorAt(n,c);n++;}};
  for(let i=0;i<N*20&&n+nf<N;i++){const near=n+nf<N*.5;const s=pick(near?ring(2.6,9):ring(9,45),(x,z)=>rootD(x,z)>.15&&pathD(x,z)>.15,8);if(!s)continue;const [x,z]=s;const r=Math.hypot(x,z);
   const sz=rr(.06,.22)*(n%9===0?2.2:1)*(r>12?1.8:1);if(pathD(x,z)<.15+sz*1.45)continue;// the whole stone stays off the walk line, not just its centreE.set(rr(-.2,.2),rr(0,6.28),rr(-.2,.2));Q.setFromEuler(E);M.compose(V(x,groundH(x,z)-sz*.3,z),Q,Sc.set(sz*rr(.95,1.35),sz*rr(.7,1.05),sz*rr(.85,1.2)));Col.setScalar(rr(.85,1.1));
   if(r>9){far.setMatrixAt(nf,M);far.setColorAt(nf,Col);nf++;}else{im.setMatrixAt(n,M);im.setColorAt(n,Col);n++;}
   // grass and moss like to gather at a stone's foot
   G._stones=(G._stones||[]);G._stones.push([x,z,sz]);}
  // [ENV] mossy rocks where the big moss cushions were (position hash, so the shared R() stream and every other layout stay as they were)
  for(const [x,z,s0] of mossRocks){const h=Math.abs(Math.sin(x*12.9898+z*78.233)*43758.5453)%1;const sz=s0*(1.05+.35*h);if(pathD(x,z)<.15+sz*1.45)continue;E.set((h-.5)*.4,h*6.283,(fract(h*7.)-.5)*.3);Q.setFromEuler(E);
   M.compose(V(x,groundH(x,z)-sz*.35,z),Q,Sc.set(sz*(1.1+.3*fract(h*3.)),sz*(.75+.25*fract(h*5.)),sz*(.95+.3*fract(h*11.))));Col.setScalar(.9+.2*fract(h*13.));im.setMatrixAt(n,M);im.setColorAt(n,Col);n++;}
  im.count=n;im.castShadow=!MOBILE;im.receiveShadow=true;scene.add(im);G.stones=im;im.frustumCulled=false;
  }

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
  const g=new THREE.PlaneGeometry(1,1,2,MOBILE?1:2).rotateX(-Math.PI/2);/* phones: 4 tris a leaf (the curl is across the blade), so twice the leaves cost fewer tris */const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,x*x*.35+z*z*.12+.01);}g.computeVertexNormals();
  const nr=g.attributes.normal;for(let i=0;i<nr.count;i++){const n=V(nr.getX(i),nr.getY(i),nr.getZ(i)).lerp(V(0,1,0),.6).normalize();nr.setXYZ(i,n.x,n.y,n.z);}
  const mat=new THREE.MeshStandardMaterial({map:tex,alphaTest:.5,side:THREE.DoubleSide,roughness:.9});
  const N=MOBILE?280:900,ND=MOBILE?150:520,NX=MOBILE?190:0;/* autumn: more litter, readable from the home view */const im=new THREE.InstancedMesh(g,mat,N+ND+NX);let n=0;
  const pal=[[.07,.7,.36],[.04,.65,.3],[.1,.65,.4],[.16,.45,.32],[.02,.55,.26],[.12,.4,.26],[.09,.8,.46],[.12,.78,.46]];
  for(let i=0;i<N*20&&n<N;i++){const s=pick(R()<.7?ring(2.3,11):ring(11,30),(x,z)=>rootD(x,z)>.05&&pathD(x,z)>-.1,5);if(!s)continue;const [x,z]=s;
   const sz=rr(.1,.18);const q=slopeQ(x,z,rr(0,6.28));q.multiply(new THREE.Quaternion().setFromEuler(E.set(rr(-.25,.25),0,rr(-.25,.25))));M.compose(V(x,meshH(x,z)+.012,z),q,Sc.set(sz,sz,sz*1.15));im.setMatrixAt(n,M);
   const c=pal[Math.floor(R()*pal.length)];Col.setHSL(c[0]+rr(-.02,.02),c[1],c[2]+rr(-.05,.05));im.setColorAt(n,Col);n++;}
  // autumn drifts: the wind piles leaves up against the roots and the foot of the trunk, layer on layer, in clumps
  const stack=new Map();let nd=0;
  for(let i=0;i<ND*30&&nd<ND;i++){const s=pick(ring(2.2,10),(x,z)=>{const d=rootD(x,z);return d>.02&&d<.5&&pathD(x,z)>0&&fbm2(x*.6+7,z*.6)>.42;},6);if(!s)continue;
   for(let j=0;j<4&&nd<ND;j++){const x=s[0]+rr(-.18,.18),z=s[1]+rr(-.18,.18);const d=rootD(x,z);if(d<.01)continue;
    const key=Math.round(x*8)+','+Math.round(z*8);const h=stack.get(key)||0;stack.set(key,h+1);
    const sz=rr(.08,.14);const q=slopeQ(x,z,rr(0,6.28));q.multiply(new THREE.Quaternion().setFromEuler(E.set(rr(-.45,.45),0,rr(-.45,.45))));
    // closer to the wood the pile is higher and the leaves tilt up against it
    M.compose(V(x,meshH(x,z)+.014+h*.012+smooth(.5,0,d)*.03,z),q,Sc.set(sz,sz,sz*1.15));im.setMatrixAt(n,M);
    const c=pal[Math.floor(R()*pal.length)];Col.setHSL(c[0]+rr(-.02,.03),c[1],c[2]+rr(-.08,.04));im.setColorAt(n,Col);n++;nd++;}}
  /* phones: more leaves on the near floor (half-cost blades above). Own random stream, so every layout after this one stays where it was:
     small clusters as they fall from the crown, thicker under it, none on the walk line */
  {const r2=rng(55123),q2=(a,b)=>a+r2()*(b-a);let nx=0;
   for(let t=0;t<NX*40&&nx<NX;t++){const a=q2(0,6.283),rad=Math.sqrt(q2(2.4*2.4,12*12));const cx=Math.cos(a)*rad,cz=Math.sin(a)*rad*.9;if(fbm2(cx*.55+13,cz*.55)<.4)continue;
    for(let j=0;j<3&&nx<NX;j++){const x=cx+q2(-.3,.3),z=cz+q2(-.3,.3);if(rootD(x,z)<.05||pathD(x,z)<.05||pondD(x,z)<.3)continue;
     const sz=q2(.09,.17);const q=slopeQ(x,z,q2(0,6.28));q.multiply(new THREE.Quaternion().setFromEuler(E.set(q2(-.3,.3),0,q2(-.3,.3))));M.compose(V(x,meshH(x,z)+.013+j*.006,z),q,Sc.set(sz,sz,sz*1.15));im.setMatrixAt(n,M);
     const c=pal[Math.floor(r2()*pal.length)];Col.setHSL(c[0]+q2(-.02,.03),c[1],c[2]+q2(-.07,.05));im.setColorAt(n,Col);n++;nx++;}}}
  im.count=n;im.receiveShadow=true;scene.add(im);G.leaves=im;}

 // ================= twigs =================
 // thin dead sticks: tapered from butt to tip, with side shoots and a grey-brown bark streaked along the grain; half-pressed into the litter
 {const r=rng(5);
  const branch=(parts,pts,rad,tip=.25)=>{const cu=new THREE.CatmullRomCurve3(pts);const TS=MOBILE?4:9,RS=MOBILE?4:5;const g=new THREE.TubeGeometry(cu,TS,rad,RS,false);
   const p=g.attributes.position;const c=V();for(let i=0;i<=TS;i++){const u=i/TS;cu.getPointAt(u,c);const k=1-(1-tip)*u;for(let j=0;j<=RS;j++){const vi=i*(RS+1)+j;p.setXYZ(vi,c.x+(p.getX(vi)-c.x)*k,c.y+(p.getY(vi)-c.y)*k,c.z+(p.getZ(vi)-c.z)*k);}}
   g.deleteAttribute('normal');g.computeVertexNormals();const a=new Float32Array(p.count);for(let i=0;i<p.count;i++)a[i]=Math.floor(i/(RS+1))/TS;g.setAttribute('aU',new THREE.BufferAttribute(a,1));parts.push(g);};
  const shapes=[];
  {const P=[];branch(P,[V(-.42,.012,0),V(-.12,.02,.03),V(.18,.016,-.02),V(.44,.01,.04)],.011);branch(P,[V(-.02,.018,.015),V(.1,.024,.12),V(.2,.018,.22)],.006);branch(P,[V(.22,.015,-.01),V(.31,.02,-.11)],.0045);shapes.push(mergeGeometries(P));}
  {const P=[];branch(P,[V(-.3,.01,0),V(-.05,.015,-.03),V(.28,.012,.02)],.008);branch(P,[V(-.1,.014,-.02),V(-.02,.02,-.12),V(.04,.015,-.2)],.0045);shapes.push(mergeGeometries(P));}
  {const P=[];branch(P,[V(-.18,.008,0),V(0,.012,.02),V(.17,.008,-.01)],.006,.4);shapes.push(mergeGeometries(P));}
  const mat=new THREE.MeshStandardMaterial({color:0x6A5A4A,roughness:1,vertexColors:true});
  mat.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aU,aSeed;varying vec3 vTw;').replace('#include <begin_vertex>','#include <begin_vertex>\nvTw=vec3(aU*5.,(position.y+position.z)*260.,aSeed);');
   s.uniforms.uNz=NZU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vTw;'+GLSL_NOISE).replace('#include <color_fragment>','#include <color_fragment>\n{float st=fbm(vec2(vTw.y,vTw.x+vTw.z));diffuseColor.rgb*=.55+.6*st;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.4,.36),smoothstep(.6,.8,fbm(vec2(vTw.y*.4,vTw.z*2.)))*.5);}');};
  const N=MOBILE?22:85;const per=[[],[],[]];
  for(let i=0;i<N*20&&per[0].length+per[1].length+per[2].length<N;i++){const s=pick(i%3?ring(2.2,8):ring(2.4,16),(x,z)=>rootD(x,z)>.2&&pathD(x,z)>.1,5);if(!s)continue;const [x,z]=s;
   const k=r()<.35?0:(r()<.55?1:2);const sz=rr(.7,1.25);M.compose(V(x,groundH(x,z)-.006,z),slopeQ(x,z,rr(0,6.28)),Sc.set(sz,sz,sz*rr(.8,1.2)));per[k].push(M.clone());}
  // baked into one static mesh (one draw call for every stick in the clearing)
  const all=[];per.forEach((list,k)=>list.forEach(m=>{const g=shapes[k].clone().applyMatrix4(m);const n=g.attributes.position.count;const c=rr(.75,1.2),sd=rr(0,50);
   g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(n*3).fill(c),3));g.setAttribute('aSeed',new THREE.BufferAttribute(new Float32Array(n).fill(sd),1));all.push(g);}));
  mat.customProgramCacheKey=()=>'groundTwigs1';/* Apple rule: explicit key */const tw=new THREE.Mesh(mergeGeometries(all),mat);tw.receiveShadow=true;tw.name='twigs';scene.add(tw);G.twigs=tw;}

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
  const endM=new THREE.MeshStandardMaterial({map:endT,roughness:.95,vertexColors:true});
  // log/stump: a slightly lumpy cylinder; the top of a lying log greens with moss (vertex colour)
  const wood=(r0,r1,h,seg,mossUp,seed,flare=0)=>{const g=new THREE.CylinderGeometry(r0,r1,h,seg,flare?(MOBILE?4:7):(MOBILE?3:5));const p=g.attributes.position,uv=g.attributes.uv,nr=g.attributes.normal;
   for(let i=0;i<p.count;i++){if(Math.abs(nr.getY(i))<.5){const a=Math.atan2(p.getZ(i),p.getX(i));let k=1+(vnoise(a*2.2+seed,p.getY(i)*3)-.5)*.14;/* [ENV] stumps: the base flares into root buttresses that run into the ground (not a can stood on the moss) */if(flare){const t=(p.getY(i)+h/2)/h;const bt=Math.pow(Math.max(0,Math.sin(a*2.5+seed*1.7)*.5+.5),2.2);k*=1+flare*Math.pow(Math.max(0,1-t),2.6)*(.35+1.1*bt);}p.setX(i,p.getX(i)*k);p.setZ(i,p.getZ(i)*k);uv.setXY(i,uv.getX(i)*Math.max(1,Math.round(r0*14)),uv.getY(i)*h*1.6);}}
   g.computeVertexNormals();const c=new Float32Array(p.count*3);g.setAttribute('color',new THREE.BufferAttribute(c,3));c.fill(1);g.userData.mossUp=mossUp;return g;};
  const tint=(mesh,mossK)=>{const g=mesh.geometry,p=g.attributes.position,c=g.attributes.color;mesh.updateMatrixWorld(true);const n=V(),w=V();const nm=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
   for(let i=0;i<p.count;i++){n.fromBufferAttribute(g.attributes.normal,i).applyMatrix3(nm).normalize();w.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
    const m=smooth(.2,.8,n.y+(fbm2(w.x*3,w.z*3+w.y*3)-.5)*.8)*mossK;const low=smooth(.35,0,w.y-groundH(w.x,w.z))*.35;c.setXYZ(i,(1-m*.55)*(1-low),(1-m*.25)*(1-low),(1-m*.6)*(1-low));}c.needsUpdate=true;};
  const grp=new THREE.Group();grp.name='woodpile';const add=(g,x,z,ry,tilt,sink,mossK)=>{const m=new THREE.Mesh(g,[barkM,endM,endM]);m.position.set(x,groundH(x,z)+sink,z);m.rotation.set(tilt[0],ry,tilt[1]);grp.add(m);tint(m,mossK);m.userData.old=mossK>=.9?1:0;m.castShadow=!MOBILE;m.receiveShadow=true;return m;};
  const ok=(x,z)=>rootD(x,z)>.4;
  // chopping stump with an old axe cut, and the stacked firewood next to it
  const chop=[12.5,7.4],pile=[13.5,8.1],big=[15.4,6.7],big2=[16.6,2.9],log=[11.0,3.4];
  if(ok(...chop)){const st=add(wood(.26,.31,.5,MOBILE?12:16,0,1,.45),chop[0],chop[1],.4,[0,0],.2,.4);
   /* the axe's cut in the block: a dark slot across the top where the blade bites at the end of every split (a thin sunk wedge, bark-dark) */
   st.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(st);for(const [o,yaw,l] of [[0,.5,.17]]){const g=new THREE.BoxGeometry(l,.02,.01).toNonIndexed();
    g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*3).fill(.42),3));
    const m=new THREE.Mesh(g,barkM);m.position.set(chop[0]+Math.sin(yaw+1.57)*o,bb.max.y-.0085,chop[1]+Math.cos(yaw+1.57)*o);m.rotation.y=yaw;grp.add(m);}}
  /* the firewood stack: split pieces (halves, thirds, quarters, a few small rounds), ~42 cm long, bark on the outer arc, pale split
     faces, laid in courses that nest in the gaps below; both ends are cribbed (each course's end pair laid crosswise to the last) so the
     stack stands. Every piece rests on the course below (a course starts at the lowest top of the one under it, so no piece floats).
     He takes armfuls from the top and adds a trip's logs back: G.pileSet(k) shows k pieces (top first to go) */
  if(ok(...pile)){const r=rng(77);const L=.42,W=.92,PC=[];const pq=new THREE.Quaternion(),pe=new THREE.Euler();
   const piece=(kind,rad)=>{// kind: 0 round, 1 half, 2 third, 3 quarter. Cylinder axis along x
     const th=[6.283,3.1416,2.094,1.571][kind],t0=r()*6.283,seg=MOBILE?(kind?5:7):(kind?7:10);
     const g=new THREE.CylinderGeometry(rad,rad*(.97+.05*r()),L*(.92+.16*r()),seg,1,false,t0,th);const parts=[g];
     if(kind){const len=g.parameters.height;for(const t of [t0,t0+th]){const f=new THREE.PlaneGeometry(rad,len);// a split face from the axis to the arc
       f.translate(rad/2,0,0);f.rotateY(t-Math.PI/2);const n=f.attributes.normal;if(t!==t0)for(let k=0;k<n.count;k++)n.setXYZ(k,-n.getX(k),-n.getY(k),-n.getZ(k));
       if(t!==t0){const ix=f.index.array;for(let k=0;k<ix.length;k+=3){const q=ix[k+1];ix[k+1]=ix[k+2];ix[k+2]=q;}}
       f.clearGroups();parts.push(f);}}
     g.rotateZ(Math.PI/2);for(let k=1;k<parts.length;k++)parts[k].rotateZ(Math.PI/2);
     return parts;};
   const pieces=[];// [geoms, pose matrix, base course]
   let base=0;const NCO=MOBILE?5:6;
   for(let c=0;c<NCO;c++){const row=[];const cross=c%2===1;const top=c===NCO-1;
    // the two crib ends: along x on even courses, crosswise (along z, two pieces) on odd ones
    for(const e of [-1,1]){if(cross){for(const xo of [-.12,.12])row.push({kind:1+((r()*3)|0),rad:.065+r()*.02,x:xo,z:e*(W/2-.05),yaw:Math.PI/2+(r()-.5)*.08,crib:1});}
     else row.push({kind:1+((r()*3)|0),rad:.07+r()*.02,x:0,z:e*(W/2-.07),yaw:(r()-.5)*.06,crib:1});}
    // the fill between the cribs, staggered half a piece on alternate courses
    const sp=.135,n=Math.floor((W-.36)/sp)+(c%2?0:1);const z0=-(n-1)/2*sp+(c%2?sp*.25:0);
    for(let k=0;k<n;k++){if(top&&r()<.35)continue;const kd=r()<.12?0:1+((r()*3)|0);row.push({kind:kd,rad:kd?.07+r()*.03:.05+r()*.015,x:(r()-.5)*.04,z:z0+k*sp+(r()-.5)*.02,yaw:(r()-.5)*.08});}
    let minTop=1e9;
    for(const q of row){const parts=piece(q.kind,q.rad);// roll it so a flat split face or the bark lies down, then sit its lowest point on this course
     const roll=q.kind?(r()<.5?0:Math.PI)+(r()-.5)*.5:r()*6.283;const R=new THREE.Matrix4().makeRotationFromEuler(pe.set(roll,0,0));for(const g of parts)g.applyMatrix4(R);
     const bb=new THREE.Box3();for(const g of parts){g.computeBoundingBox();bb.union(g.boundingBox);}
     const M2=new THREE.Matrix4().makeRotationY(q.yaw).setPosition(q.x,base-bb.min.y,q.z);for(const g of parts)g.applyMatrix4(M2);
     minTop=Math.min(minTop,base+(bb.max.y-bb.min.y));pieces.push({parts,c,crib:q.crib||0,z:q.z});}
    base=minTop-.012;}// the next course settles slightly into the one below
   // removal order: top course first, the fill before the cribs, from the open side
   pieces.sort((a,b)=>(a.c-b.c)||(b.crib-a.crib)||(b.z-a.z));
   const PM=new THREE.Matrix4().compose(V(pile[0],groundH(...pile)+.005,pile[1]),pq.setFromAxisAngle(V(0,1,0),-.35),V(1,1,1));
   pieces.forEach((pc,idx)=>pc.parts.forEach((g,k)=>{const m=new THREE.Mesh(g,k?endM:[barkM,endM,endM]);
     m.applyMatrix4(PM);m.userData.pileIdx=idx;m.castShadow=!MOBILE;m.receiveShadow=true;
     g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*3).fill(1),3));grp.add(m);}));
   G._pileN=pieces.length;}
  if(ok(...big))add(wood(.42,.55,.62,MOBILE?14:20,1,2,.6),big[0],big[1],1.1,[.04,-.03],.18,.9);
  if(ok(...big2))add(wood(.3,.4,.38,MOBILE?12:16,1,3,.55),big2[0],big2[1],.2,[0,.05],.14,1);
  if(ok(...log))add(wood(.17,.21,2.6,MOBILE?10:14,1,4),log[0],log[1],.5,[0,Math.PI/2],.08,1);
  // windfall: old trunks lying in the undergrowth between the clearing and the tree ring, mossy on top, some on a slant
  {const NL=MOBILE?7:11;let nl=0;for(let t=0;t<400&&nl<NL;t++){const a=rr(0,6.28),r=rr(10.5,21);const x=Math.cos(a)*r,z=Math.sin(a)*r*.95;
    if((z>1&&Math.abs(x)<13)||rootD(x,z)<2||!exitClear(x,z)||Math.hypot(x-chop[0],z-chop[1])<3||Math.hypot(x-log[0],z-log[1])<3)continue;
    const len=rr(2.4,4.6),rad=rr(.16,.3);add(wood(rad*.85,rad,len,MOBILE?9:14,1,10+nl),x,z,rr(0,6.28),[rr(-.08,.08),Math.PI/2+rr(-.1,.1)],rad*.55,1);
    G._stones=(G._stones||[]);for(let k=-1;k<=1;k++)G._stones.push([x,z,len*.3]);nl++;}}
  // phones' draw-call budget: bake every piece into one bark mesh and one end-grain mesh (2 draw calls in all)
  {const bark=[],ends=[];const vc=[0,0],PR=[];grp.updateMatrixWorld(true);
   for(const m of grp.children){const g=m.geometry.clone().applyMatrix4(m.matrix);const mats=Array.isArray(m.material)?m.material:[m.material];
    const groups=g.groups.length?g.groups:[{start:0,count:g.index?g.index.count:g.attributes.position.count,materialIndex:0}];
    for(const gr of groups){const mt=mats[gr.materialIndex]||mats[0];const sub=new THREE.BufferGeometry();for(const k of ['position','normal','uv'])sub.setAttribute(k,g.attributes[k]);
     /* end grain: only the chopping stump and the split logs are fresh; old stumps and windfall are cut years ago: grey, dark, cracked, the stump tops mossed over */
     if(mt===endM){const n=g.attributes.position.count,cc=new Float32Array(n*3),old=m.userData.old||0;for(let i=0;i<n;i++){const x=g.attributes.position.getX(i),y=g.attributes.position.getY(i),z=g.attributes.position.getZ(i);const up=g.attributes.normal.getY(i)>.6?1:0;
       const nz=fbm2(x*4.3+y,z*4.3);const mo=old*up*smooth(.38,.62,nz+.12);let r=1-old*(.5+.15*nz),gg=1-old*(.5+.15*nz),b=1-old*(.56+.15*nz);r=r*(1-mo)+.3*mo;gg=gg*(1-mo)+.42*mo;b=b*(1-mo)+.2*mo;cc[i*3]=r;cc[i*3+1]=gg;cc[i*3+2]=b;}sub.setAttribute('color',new THREE.BufferAttribute(cc,3));}
     if(mt===barkM)sub.setAttribute('color',g.attributes.color||new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*3).fill(1),3));
     sub.setIndex(g.index?Array.from(g.index.array.slice(gr.start,gr.start+gr.count)):Array.from({length:gr.count},(_,i)=>gr.start+i));{const w=mt===barkM?0:1;if(m.userData.pileIdx!=null)PR.push([m.userData.pileIdx,w,vc[w],sub.attributes.position.count]);vc[w]+=sub.attributes.position.count;}(mt===barkM?bark:ends).push(sub);}}
   while(grp.children.length)grp.remove(grp.children[0]);
   for(const [list,mt] of [[bark,barkM],[ends,endM]])if(list.length){const m=new THREE.Mesh(mergeGeometries(list),mt);m.castShadow=!MOBILE;m.receiveShadow=true;grp.add(m);}
   /* the firewood stack's pieces are ranges in these two meshes: a piece he has taken is collapsed to a point (no extra draw call) */
   if(PR.length){const orig=new Map();let shown=G._pileN;
    G.pileSet=k=>{k=Math.max(0,Math.min(G._pileN,Math.round(k)));if(k===shown)return;shown=k;const ms=[grp.children[0],grp.children[1]];
     for(const [idx,w,o,c] of PR){const P=ms[w]&&ms[w].geometry.attributes.position;if(!P)continue;const key=w+':'+o;if(!orig.has(key))orig.set(key,P.array.slice(o*3,(o+c)*3));const src=orig.get(key);
      if(idx<k)P.array.set(src,o*3);else for(let i=0;i<c;i++){P.array[(o+i)*3]=src[0];P.array[(o+i)*3+1]=src[1];P.array[(o+i)*3+2]=src[2];}
      P.needsUpdate=true;}};
    G.pileGet=()=>shown;
    /* the stack follows the economy (brain.js stock.logs is the kitchen's): an armful carried up (+2 there) leaves the stack, a wood
       trip (+3) is stacked here. A random start, never quite empty */
    let last=null,cnt=Math.round(G._pileN*(.55+.4*Math.random()));G.pileSet(cnt);
    G._pileWatch=()=>{const B=window.__brain,l=B&&B.stock&&B.stock.logs;if(l==null)return;if(last!=null){const d=l-last;if(d===2||d===3){cnt=Math.max(3,Math.min(G._pileN,cnt+(d===2?-2:3)));G.pileSet(cnt);}}last=l;};G.pileTo=k=>{cnt=k;G.pileSet(k);};/* test hook */}}
  /* seat the stumps and logs in the floor like the oak's roots: a soft contact shadow and a moss collar where the wood meets the ground (not stood on the lawn) */
  {const d=aoTex.image.data,p=grp.children[0]&&grp.children[0].geometry.attributes.position;if(p){for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);if(y-groundH(x,z)>.22)continue;
     for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++){const gx=Math.floor((x+GE)/CELL)+a,gz=Math.floor((z+GE)/CELL)+b;if(gx<0||gz<0||gx>=GS||gz>=GS)continue;const wx=(gx+.5)*CELL-GE,wz=(gz+.5)*CELL-GE;const r=Math.hypot(wx-x,wz-z);const j=(gz*GS+gx)*4;
      d[j]=Math.max(d[j],255*.7*smooth(.45,0,r));d[j+1]=Math.max(d[j+1],255*.85*smooth(.55,.15,r));}}aoTex.needsUpdate=true;}}
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
  /* hoof- and boot-sized dips in the trodden earth by the ladder foot and along the pond track: they hold a little water after rain and
     dry first (the same water and mirror as the big puddles, a few small discs). Positions are fixed, jittered by a hash (the shared stream stays) */
  for(const [x0,z0] of [[.22,4.9],[-.18,5.35],[.62,5.95],[1.12,6.7],[1.0,7.35],[.62,7.68],[-.42,4.62],[2.3,7.5]]){const hs=Math.abs(Math.sin(x0*91.7+z0*37.3)*43758.5)%1;const x=x0+(hs-.5)*.12,z=z0+(((hs*7.)%1)-.5)*.12;
   if(rootD(x,z)<.2||pondD(x,z)<.25||spots.some(q=>Math.hypot(q[0]-x,q[1]-z)<q[2]+.2))continue;spots.push([x,z,.09+.07*hs,.55+.35*((hs*13.)%1),hs*6.28]);}
  const parts=[];spots.forEach(([x,z,r,e,a],i)=>{const g=new THREE.CircleGeometry(1,r<.3?10:28);/* the small dips: 10 sides */const p=g.attributes.position;const sd=new Float32Array(p.count).fill(i*7.3+1);
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
       vec3 refl=texture2DProj(tDiffuse,uv).rgb;vec3 V=normalize(cameraPosition-vW);float fr=.34+.66*pow(1.-max(V.y,0.),4.);
       vec3 water=vec3(.085,.074,.058);/* overcast rain: a grey-lit pool of muddy water, not a black hole cut in the floor */vec3 c=mix(water,refl*color*1.35+vec3(.02,.024,.026),fr);float rim=smoothstep(.05,.45,m);c=mix(vec3(.07,.055,.04),c,rim);/* a muddy brown lip where the water thins out at the edge */gl_FragColor=vec4(c,m*.92);
       #include <tonemapping_fragment>
       #include <colorspace_fragment>
      }`}});
    const u=mesh.material.uniforms;u.uLevel=levelU;u.uRain=rainU;u.uTime=timeU;// Reflector clones the uniforms: re-link the live ones
    mesh.material.transparent=true;mesh.material.depthWrite=false;
    // skip the extra render while the clearing is dry
    const orig=mesh.onBeforeRender;mesh.onBeforeRender=function(...a){if(levelU.value<.02)return;orig.apply(this,a);};
   }else{
    const mat=new THREE.MeshStandardMaterial({color:0x29241B,roughness:.06,metalness:.2,transparent:true,depthWrite:false});
    mat.customProgramCacheKey=()=>'groundPuddleM3';/* Apple rule */mat.onBeforeCompile=sh=>{sh.uniforms.uLevel=levelU;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aSeed;attribute vec2 aLP;varying vec2 vLP;varying float vSd;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLP=aLP;vSd=aSeed;');
     sh.uniforms.uNz=NZU;sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uLevel;varying vec2 vLP;varying float vSd;'+GLSL_NOISE+MASK).replace('#include <alphamap_fragment>','#include <alphamap_fragment>\nfloat pm=pmask(vLP,vSd,uLevel);diffuseColor.a*=pm*.9;diffuseColor.rgb=mix(vec3(.07,.055,.04),diffuseColor.rgb,smoothstep(.05,.45,pm));')
      /* the phone has no mirror: the water mirrors the overcast sky (the fog colour, which follows the hour) at grazing angles, so a dip reads as
         a grey-lit pool with a muddy lip, never a black hole cut in the floor */
      .replace('#include <opaque_fragment>','#ifdef USE_FOG\n{float fr=.1+.38*pow(1.-clamp(dot(normalize(vViewPosition),normal),0.,1.),4.);float cl=vn(vLP*1.7+vSd*3.1)*.6+vn(vLP*4.3+vSd)*.4;outgoingLight=mix(outgoingLight,fogColor*(.3+.45*cl),fr*smoothstep(.05,.45,pm));/* low sun-less sky in broken grey, not a flat pale sheet at grazing angles */}\n#endif\n#include <opaque_fragment>');};
    mesh=new THREE.Mesh(geo,mat);}
   mesh.rotation.x=-Math.PI/2;mesh.position.y=.012;mesh.renderOrder=1;scene.add(mesh);G.puddles=mesh;
   G.updatePuddles=cam=>{levelU.value=ST.puddle;rainU.value=ST.rainK;timeU.value=ST.T;mesh.visible=ST.puddle>.02;};}}

 // ================= the pond =================
 // Still dark water with a slow wind-driven ripple, the sky and the treeline mirrored in it (on desktop a real low-res mirror),
 // the moon's glint, rain rings, lily pads with two water lilies, a clump of reeds, stones on the bank and a muddy rim.
 // One draw call for the water and a cheap shader, so it costs next to nothing on a phone.
 {const c0=Math.cos(POND.a),s0=Math.sin(POND.a);
  let level=99;for(let i=0;i<96;i++){const a=i/96*6.283;let r=1.3;for(let k=0;k<30;k++){const x=POND.x+(Math.cos(a)*c0-Math.sin(a)*s0)*POND.rx*r,z=POND.z+(Math.cos(a)*s0+Math.sin(a)*c0)*POND.rz*r;if(pondD(x,z)<=0){level=Math.min(level,groundH(x,z));break;}r-=.03;}}
  level-=.035;level+=MOBILE?.09:.03;/* the drawn floor (phones: ~67 cm cells) rounds the dip off and came up through the water half a metre inside the shore; the depth fade below keeps it from spilling */
  // the water's real depth over the RENDERED floor (phone ground cells are ~67 cm, so the shoreline the GPU draws is a coarse
  // polygon): the water fades out exactly where that floor comes up through it, so no hard cut-out edge shows up close
  const DB=(()=>{const W=64,H=48,x0=POND.x-2.4,z0=POND.z-2.0,sx=4.8/W,sz=4.0/H,d=new Uint8Array(W*H);
   for(let j=0;j<H;j++)for(let i=0;i<W;i++){const h=meshH(x0+(i+.5)*sx,z0+(j+.5)*sz);d[j*W+i]=Math.max(0,Math.min(255,Math.round(((level-(h==null?level+.3:h))+.3)/.9*255)));}
   const t=new THREE.DataTexture(d,W,H,THREE.RedFormat,THREE.UnsignedByteType);t.magFilter=t.minFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.needsUpdate=true;
   return {t,v:new THREE.Vector4(x0,z0,1/(W*sx),1/(H*sz))};})();
  const geo=new THREE.CircleGeometry(1,64,0,Math.PI*2);{const p=geo.attributes.position;for(let i=0;i<p.count;i++){const u=p.getX(i)*1.25,v=p.getY(i)*1.25;p.setXY(i,POND.x+(u*POND.rx*c0-v*POND.rz*s0),-(POND.z+(u*POND.rx*s0+v*POND.rz*c0)));}
   const d=new Float32Array(p.count);for(let i=0;i<p.count;i++)d[i]=pondD(p.getX(i),-p.getY(i));geo.setAttribute('aD',new THREE.BufferAttribute(d,1));
   // y was mirrored above, so flip the winding back (the surface faces up)
   const ix=geo.index.array;for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}}
  const U={uT:{value:0},uMoon:{value:new THREE.Vector3(-.7,.5,.15).normalize()},uNight:{value:0},uDeep:{value:new THREE.Color(.02,.035,.04)},
   uSp0:{value:new THREE.Vector4(0,0,-9,0)},uSp1:{value:new THREE.Vector4(0,0,-9,0)},uNz:NZU,uSky:{value:new THREE.Color(.3,.4,.5)},uDepth:{value:DB.t},uDB:{value:DB.v},uLp:{value:Array.from({length:6},()=>new THREE.Vector4(0,-99,0,0))},/* [ENV] the lit lamps (env.lampPts) */tDiffuse:{value:null},textureMatrix:{value:new THREE.Matrix4()},color:{value:new THREE.Color(1,1,1)}};
  const VS=`#include <fog_pars_vertex>
   uniform mat4 textureMatrix;attribute float aD;varying float vD;varying vec3 vW;varying vec4 vRU;
   void main(){vD=aD;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vRU=textureMatrix*vec4(position,1.);vec4 mvPosition=viewMatrix*w;gl_Position=projectionMatrix*mvPosition;
   #include <fog_vertex>
   }`;
  const FS=(refl)=>`#include <fog_pars_fragment>
   uniform float uT,uNight;uniform vec3 uMoon,uDeep,uSky,color;uniform vec4 uSp0,uSp1,uDB;uniform vec4 uLp[6];uniform sampler2D uDepth;
   float spC=0.;vec2 splash(vec2 p,vec4 s){float age=uT-s.z;if(age<0.||age>3.)return vec2(0.);vec2 d=p-s.xy;float r=length(d)+1e-4;float fr=age*.38;float env=exp(-age*1.4)*smoothstep(.12,0.,abs(r-fr))*s.w;float w=sin((r-fr)*46.)*env;
    spC+=max(0.,w)*.9+smoothstep(.09,0.,r)*exp(-age*5.)*s.w*1.5;/* crest lines + the churned spot right where the bucket went in */return d/r*w;}uniform sampler2D tDiffuse;varying float vD;varying vec3 vW;varying vec4 vRU;`+GLSL_NOISE+`
   void main(){
    // ripples and rain rings from Wind (game/wind.js W.hookWater): calm = nearly a mirror, gusts roughen it
    float dep=texture2D(uDepth,(vW.xz-uDB.xy)*uDB.zw).r*.9-.3;// metres of water over the drawn floor
    vec3 n=waterNormal(vW);{vec2 sp=splash(vW.xz,uSp0)+splash(vW.xz,uSp1);n=normalize(n+vec3(sp.x,0.,sp.y)*.5);}
    vec3 V=normalize(cameraPosition-vW);vec3 R=reflect(-V,n);
    // fresnel from the flat surface (wind ripples only wobble the mirror): ripple normals made the whole pond read as pale sky up close
    float fr=.02+.98*pow(1.-max(mix(V.y,dot(V,n),.25),0.),5.);
    // what the water mirrors: the sky over a dark ragged treeline (phones), or the real scene (desktop)
    float an=atan(R.z,R.x);float tl=.05+.1*vn(vec2(an*4.,1.3))+.04*vn(vec2(an*17.,4.1));/* from nearer and higher the mirror shows the tall forest and the oak round the clearing (up to ~30 deg), not open sky; the low home view keeps its bright sky so the pond still reads from there */tl=mix(tl,.52+.22*vn(vec2(an*3.,7.7))+.08*vn(vec2(an*13.,2.2)),smoothstep(.24,.42,V.y));/* close by day (phones) the pool lies under the oak and the forest wall: the crowns fill its mirror to ~45-55 deg, only ragged gaps show sky (it read as a milky grey plate) */
    // a bright sky in it even at the low home-view angle, so the pond reads as water from afar (day and night)
    vec3 sky=mix(uSky*1.,uSky*1.35,smoothstep(.2,.9,R.y))*mix(.6,1.,max(uNight,1.-smoothstep(.12,.35,V.y)));/* by day the near water stays tea-dark; the far, grazing water still mirrors the bright sky */sky=mix(uSky*.2,sky,smoothstep(tl-.03,tl+.05,R.y));
    ${refl?'vec4 ru=vRU;ru.xy+=waterSlope(vW)*.03*ru.w;sky=texture2DProj(tDiffuse,ru).rgb*color;':''}
    /* [ENV] a forest pool, not a blue plate: tea-dark water under the mirror, the mirror with more contrast (dark reeds and crowns in it, the sky gaps bright), and a touch deeper in the middle */${refl?'sky=sky*sky*1.35;':''}vec3 c=mix(uDeep*vec3(.8,.85,.6)*mix(1.,.6,smoothstep(-.2,-.8,vD)),sky,clamp(fr*1.25+.015,0.,1.));
    /* the water is unlit: under a grey overcast or in the low golden-hour light the floor round it darkens, so its tea-dark body and mirror dim with the sky (night has its own sheen below) */
    float dayK=max(uNight,clamp(dot(uSky,vec3(.3,.55,.15))/.4,.55,1.));c*=dayK;/* floor .55: under a rain sky the pond went pitch black */
    c+=vec3(.85,.92,1.)*pow(max(dot(R,uMoon),0.),220.)*uNight*2.5;
    // night: darker open water inside a thin moonlit waterline, so its shape still reads through the blue mist
    c*=1.-.35*uNight*smoothstep(-.1,-.5,vD);
    // night: the open water catches the bright blue night sky above the clearing (a soft silver sheen), lighter than the mist around it
    {float lane=.45+.9*vn(vec2(vW.x*.7+vW.z*.25,vW.z*2.6)+uT*.03);c+=vec3(.16,.26,.34)*uNight*(.12+.88*fr)*lane*.8*smoothstep(-.05,-.4,vD);}/* [ENV] broken by wind lanes: not a flat silver sheet */c+=uSky*vec3(.9,1.,1.1)*.55*uNight*smoothstep(.0,.006,dep)*smoothstep(.028,.01,dep)*(.35+.9*vn(vW.xz*2.7));/* right at the visible edge and broken along its length: a continuous ring a few cm inside the wet rim read as a drawn outline *//* the moonlit waterline: a thin line where the drawn floor meets the water */
    /* [ENV] rain: every drop's ring catches the sky on its crest (the ripple normal alone barely moved the dark water: in rain the pool read as a still black plate) */
    {float rg=clamp(length(waterRings(vW.xz))*2.4,0.,1.)*smoothstep(-.02,-.25,vD);c=mix(c,max(sky,uSky*.55)*1.1+uSky*.06,rg*.4);}
    ${refl?'':`/* [ENV] phones have no mirror: the lit windows, the trunk door and the lanterns glint in the water as warm wobbling patches, broken up by the ripples and rain rings */
    {vec3 Rr=reflect(-V,normalize(mix(vec3(0.,1.,0.),n,1.6)));for(int i=0;i<6;i++){vec4 l=uLp[i];if(l.w<=0.)continue;vec3 L=l.xyz-vW;float dl=length(L);float k=max(dot(Rr,L/dl),0.);
      c+=vec3(1.,.6,.28)*l.w*(pow(k,700.)*2.2+pow(k,60.)*.1)*(.35+fr)*smoothstep(-.03,-.2,vD);}}`}
    // splash: bright broken crests and a pale churned spot where the bucket dips (sky-tinted, dimmer at night)
    c=mix(c,sky*1.15+uSky*.08,clamp(spC,0.,1.)*mix(.5,.35,uNight));/* the crests mirror the sky like the rest of the water: no painted white ring */
    // phones have no real mirror: the far bank, the reeds and the dark wood beyond show as a soft dark band along the
    // far shore (and the near water mirrors the sky), so the surface has depth instead of one flat tone
    {vec2 cd=vW.xz-vec2(${POND.x.toFixed(3)},${POND.z.toFixed(3)});float far=smoothstep(-.1,.6,dot(normalize(cd+1e-4),-normalize(V.xz+1e-4)));
     float band=smoothstep(-.75,-.08,vD)*far*smoothstep(.3,.55,V.y);/* close views only: from the home view the pond must stay a bright read */${refl?'band=0.;':''}/* the reeds and stems on the far bank mirrored as thin dark upright streaks, wobbled by the ripples */float st=smoothstep(.42,.78,vn(vec2(atan(cd.y,cd.x)*38.+n.x*6.,.5)));c=mix(c,c*.3+uDeep*.15,band*(.5+.45*st));}
    // shallow at the rim: you see the mud bottom through it, then it fades into the bank
    float sh=smoothstep(.0,.14,dep)*smoothstep(.1,-.3,vD);c=mix(c*vec3(.6,.55,.42)+vec3(.008,.006,.004)*dayK,c,sh);/* the muddy shallows only in the last hand-width of depth: a wide beige rim made the whole pool a pale plate */float a=.95*smoothstep(.0,.035,dep)*smoothstep(.12,-.05,vD);
    gl_FragColor=vec4(c,a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    vec3 pre=gl_FragColor.rgb;
    #include <fog_fragment>
    gl_FragColor.rgb=mix(gl_FragColor.rgb,pre,.85);// the fog thins over the water: it stays visible at night
   }`;
  const fogU=THREE.UniformsLib.fog;let water;
  if(!MOBILE){water=new Reflector(geo,{textureWidth:512,textureHeight:512,clipBias:.003,shader:{name:'Pond',uniforms:{...THREE.UniformsUtils.clone(fogU),...U},vertexShader:VS,fragmentShader:FS(true)}});
   water.material.uniforms.color.value.setRGB(.82,.86,.9);}
  else water=new THREE.Mesh(geo,new THREE.ShaderMaterial({uniforms:{...THREE.UniformsUtils.clone(fogU),...U},vertexShader:VS,fragmentShader:FS(false)}));
  water.material.fog=true;water.material.transparent=true;water.material.depthWrite=false;
  if(C.wind&&C.wind.hookWater)water.material.onBeforeCompile=sh=>{C.wind.hookWater(sh,THREE);};water.material.customProgramCacheKey=()=>'pond-env2'+(MOBILE?'m':'d');/* [ENV] */
  // falling leaves land on the pond and float (Wind)
  if(C.wind&&C.wind.addWater)C.wind.addWater((x,z)=>pondD(x,z)<-.12?level:null);
  water.rotation.x=-Math.PI/2;water.position.y=level;water.renderOrder=1;water.name='pond';scene.add(water);
  const WU=water.material.uniforms;
  // lily pads (round, a notch to the middle, fine veins) and two white water lilies
  const padT=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=128;const x=cv.getContext('2d');x.translate(64,64);
   const g=x.createRadialGradient(0,0,4,0,0,60);g.addColorStop(0,'#5E8A3E');g.addColorStop(.8,'#3F6B2E');g.addColorStop(1,'#2C4A22');x.fillStyle=g;
   x.beginPath();x.moveTo(0,0);x.arc(0,0,60,-1.35,4.5);x.closePath();x.fill();x.strokeStyle='rgba(150,190,110,.35)';x.lineWidth=1.2;
   for(let k=0;k<13;k++){const a=-1.2+k*.44;x.beginPath();x.moveTo(0,0);x.lineTo(Math.cos(a)*56,Math.sin(a)*56);x.stroke();}
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;})();
  const NP=MOBILE?7:11;const pads=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({map:padT,alphaTest:.5,roughness:.45,side:THREE.DoubleSide}),NP);
  const padPos=[];let np=0;for(let t=0;t<400&&np<NP;t++){const a=rr(0,6.28),r=Math.sqrt(R())*.9;const x=POND.x+(Math.cos(a)*c0*POND.rx-Math.sin(a)*s0*POND.rz)*r,z=POND.z+(Math.cos(a)*s0*POND.rx+Math.sin(a)*c0*POND.rz)*r;
   // they gather on the far, sheltered side, away from where he dips the bucket
   if(pondD(x,z)>-.35||x>POND.x+1||padPos.some(q=>Math.hypot(q[0]-x,q[1]-z)<.38))continue;const sz=rr(.26,.42);padPos.push([x,z,sz]);
   M.compose(V(x,level+.006+np*.0004,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz,1,sz));pads.setMatrixAt(np,M);Col.setHSL(rr(.24,.3),rr(.3,.45),rr(.75,.95));pads.setColorAt(np,Col);np++;}
  pads.count=np;pads.receiveShadow=true;scene.add(pads);G.pads=pads;
  // [ENV] autumn oak leaves afloat on the pond: a dozen, one draw call; they drift slowly round the open water, turn and bob on the
  // ripple, and slip under the lily pads' edge rather than through them. Slightly curled (a bent strip), so they catch light, not stickers.
  const floatL=(()=>{const cv=document.createElement('canvas');cv.width=64;cv.height=96;const x=cv.getContext('2d');x.translate(32,48);
   x.fillStyle='#fff';x.beginPath();x.moveTo(0,-46);for(let k=0;k<=8;k++){const t=k/8,y=-46+t*86,w=(Math.sin(t*Math.PI)*.85+.15)*24*(1+.22*Math.sin(t*Math.PI*7));x.lineTo(w,y);}
   x.lineTo(2,40);x.lineTo(2,48);x.lineTo(-2,48);x.lineTo(-2,40);for(let k=8;k>=0;k--){const t=k/8,y=-46+t*86,w=(Math.sin(t*Math.PI)*.85+.15)*24*(1+.22*Math.sin(t*Math.PI*7+.6));x.lineTo(-w,y);}x.closePath();x.fill();
   x.globalCompositeOperation='source-atop';x.strokeStyle='rgba(90,50,20,.55)';x.lineWidth=2;x.beginPath();x.moveTo(0,44);x.lineTo(0,-40);x.stroke();x.lineWidth=1;
   for(let k=0;k<5;k++){const y=-30+k*14;x.beginPath();x.moveTo(0,y+6);x.lineTo(15,y-2);x.moveTo(0,y+6);x.lineTo(-15,y-2);x.stroke();}
   const g=x.createRadialGradient(0,0,4,0,0,46);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(1,'rgba(60,30,10,.35)');x.fillStyle=g;x.fillRect(-32,-48,64,96);
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;})();
  const lg=new THREE.PlaneGeometry(.1,.15,2,1).rotateX(-Math.PI/2);{const p=lg.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i);p.setY(i,Math.abs(x)*.25);}lg.computeVertexNormals();}
  const NL=MOBILE?9:14;const fls=new THREE.InstancedMesh(lg,new THREE.MeshStandardMaterial({map:floatL,alphaTest:.5,roughness:.5,side:THREE.DoubleSide}),NL);fls.name='pondLeaves';
  // own seeded random: the shared R() stream must stay as it was, or every reed and stone after this would move
  let fs=917;const rl=(a,b)=>{fs=(fs*16807)%2147483647;return a+(b-a)*(fs/2147483647);};
  const FL=[];for(let t=0;t<300&&FL.length<NL;t++){const x=POND.x+rl(-1.6,1.6),z=POND.z+rl(-1.1,1.1);if(pondD(x,z)>-.18||padPos.some(q=>Math.hypot(q[0]-x,q[1]-z)<q[2]*.55+.06))continue;
   FL.push({x,z,y:rl(0,6.28),s:rl(.8,1.25),ph:rl(0,6.28),w:rl(.4,1),vx:0,vz:0});const h=rl(0,1);Col.setRGB(...(h<.45?[1,.5,.16]:h<.8?[1,.74,.24]:[.66,.32,.14])).multiplyScalar(rl(.75,1));fls.setColorAt(FL.length-1,Col);}
  fls.count=FL.length;fls.receiveShadow=true;fls.frustumCulled=false;scene.add(fls);G.pondLeaves=fls;
  const flP=V(POND.x,level,POND.z),flE=new THREE.Euler();let flT=0;const upLeaves=(dt)=>{flT+=dt;const wv=C.wind&&C.wind.sample?C.wind.sample(flP):null;const wx=wv?wv.x:.3,wz=wv?wv.z:.1;
   for(let i=0;i<FL.length;i++){const L=FL[i];// a lazy wander downwind plus a slow eddy; the bank and the pads push back
    const ex=Math.sin(flT*.07*L.w+L.ph)*.012,ez=Math.cos(flT*.05*L.w+L.ph*1.7)*.012;L.vx+=(wx*.004*L.w+ex-L.vx)*dt*.5;L.vz+=(wz*.004*L.w+ez-L.vz)*dt*.5;
    let nx=L.x+L.vx*dt,nz=L.z+L.vz*dt;const d=pondD(nx,nz);if(d>-.2){const gx=pondD(nx+.05,nz)-pondD(nx-.05,nz),gz=pondD(nx,nz+.05)-pondD(nx,nz-.05);const gl=Math.hypot(gx,gz)||1;nx-=gx/gl*.004;nz-=gz/gl*.004;L.vx*=.5;L.vz*=.5;}
    for(const q of padPos){const dx=nx-q[0],dz=nz-q[1],r=Math.hypot(dx,dz),m=q[2]*.55+.05;if(r<m&&r>1e-4){nx=q[0]+dx/r*m;nz=q[1]+dz/r*m;}}
    L.x=nx;L.z=nz;L.y+=Math.sin(flT*.11+L.ph)*dt*.06;const bob=Math.sin(flT*1.3+L.ph)*.003;
    M.compose(V(L.x,level+.008+bob,L.z),Q.setFromEuler(flE.set(Math.sin(flT*.9+L.ph)*.06,L.y,Math.cos(flT*.8+L.ph)*.06,'YXZ')),Sc.set(L.s,L.s,L.s));fls.setMatrixAt(i,M);}
   fls.instanceMatrix.needsUpdate=true;};upLeaves(0);
  {// water lily: two rings of pointed, slightly cupped petals (cream at the base, a blush of pink at the tips) round a golden heart
   const petal=(L,W,open,a)=>{const g=new THREE.BufferGeometry();const v=[0,0,0, -W,.004,L*.45, 0,.012,L, W,.004,L*.45, 0,-.004,L*.5];
    g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex([0,1,4, 1,2,4, 2,3,4, 3,0,4]);
    g.setAttribute('color',new THREE.Float32BufferAttribute([1,.97,.9, 1,.95,.93, 1,.78,.86, 1,.95,.93, 1,.97,.92],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([.5,0,0,.5,.5,1,1,.5,.5,.5],2));
    g.rotateX(-open);g.rotateY(a);g.computeVertexNormals();return g.toNonIndexed();};
   const P=[];for(let k=0;k<8;k++)P.push(petal(.055,.017,.32,k/8*6.283));for(let k=0;k<8;k++)P.push(petal(.045,.014,.85,k/8*6.283+.39));for(let k=0;k<6;k++)P.push(petal(.03,.011,1.2,k/6*6.283+.2));
   const fl=mergeGeometries(P);const fm=new THREE.MeshStandardMaterial({color:0xF2ECF0,emissive:0x2A2228,roughness:.6,side:THREE.DoubleSide});
   const cg=new THREE.SphereGeometry(.018,8,6).scale(1,.6,1).translate(0,.012,0);const cm=new THREE.MeshStandardMaterial({color:0xE8C040,roughness:.7});
   const paintC=(g,c)=>{g=g.index?g.toNonIndexed():g;const a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set(c,i);g.setAttribute('color',new THREE.BufferAttribute(a,3));g.deleteAttribute('uv');return g;};
   const flg=mergeGeometries([fl.index?fl.toNonIndexed():fl,paintC(cg,[1.4,.95,.25])].map(g=>{if(g.attributes.uv)g.deleteAttribute('uv');return g;}));fm.vertexColors=true;const fi=new THREE.InstancedMesh(flg,fm,2);let nf=0;for(const [x,z,sz] of padPos.slice(0,2)){M.compose(V(x+sz*.1,level+.012,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(1.2,1.2,1.2));fi.setMatrixAt(nf,M);nf++;}
   fi.count=nf;scene.add(fi);G.lilies=fi;}
  // reeds: tall, slim, dark blades in clumps along the back of the pond, swaying with the grass
  {const reedG=(()=>{// rush blades plus two or three cattails (a slim stalk with a velvety brown head), all in the grass material so they sway together
    const parts=[tuftGeo(MOBILE?8:14,MOBILE?3:5,91,.55,1.1,.22).toNonIndexed()];const r=rng(17);
    for(let k=0;k<3;k++){const H=.95+r()*.35,ox=(r()-.5)*.16,oz=(r()-.5)*.16;
     const mk=(g,c)=>{g=g.toNonIndexed();const p=g.attributes.position;const uv=new Float32Array(p.count*2),cc=new Float32Array(p.count*3);
      for(let i=0;i<p.count;i++){uv[i*2]=.5;uv[i*2+1]=Math.max(0,p.getY(i))/H;cc.set(c(p.getY(i)/H),i*3);}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setAttribute('color',new THREE.BufferAttribute(cc,3));return g;};
     parts.push(mk(new THREE.CylinderGeometry(.004,.006,H,4,3,true).translate(ox,H/2,oz),t=>[.16+t*.15,.24+t*.2,.12+t*.08]));
     parts.push(mk(new THREE.CapsuleGeometry(.016,.1,MOBILE?1:2,MOBILE?5:6).translate(ox,H-.08,oz),t=>[.72,.4,.2]));}
    return mergeGeometries(parts);})();const NR=MOBILE?9:14;const im=new THREE.InstancedMesh(reedG,grassMat,NR);let n=0;
   for(let t=0;t<600&&n<NR;t++){const x=POND.x+rr(-3.4,3.4),z=POND.z+rr(-2.6,2.6);const d=pondD(x,z);if(d<-.3||d>.25||x>POND.x+1.2||z>POND.z+.3||rootD(x,z)<.5)continue;// back and left banks: the camera side stays open
    const sz=rr(.8,1.25);M.compose(V(x,Math.max(level-.05,groundH(x,z)-.02),z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(.7,1),sz,sz*rr(.7,1)));im.setMatrixAt(n,M);Col.setHSL(rr(.2,.27),rr(.2,.32),rr(.48,.58));im.setColorAt(n,Col);n++;}
   im.count=n;im.receiveShadow=true;scene.add(im);G.reeds=im;}
  // stones on the bank, half in the mud
  if(G.stones){const NS=MOBILE?7:10;const im=G.stones;let n=im.count;const n0=n;
   // right at the waterline, half sunk; half of them on the camera side so the bank reads from the home view
   for(let t=0;t<900&&n<n0+NS&&n<im.instanceMatrix.count-2;t++){const a=(n-n0)%2?rr(.3,2.8):rr(0,6.28),k=rr(.8,1.4);const x=POND.x+Math.cos(a)*POND.rx*k,z=POND.z+Math.sin(a)*POND.rz*k;const d=pondD(x,z);if(d<-.12||d>.22||ptrackD(x,z)<.55||rootD(x,z)<.2)continue;
    const sz=rr(.08,.2)*(n===n0?1.6:1);M.compose(V(x,groundH(x,z)-sz*.35,z),Q.setFromEuler(E.set(rr(-.2,.2),rr(0,6.28),rr(-.2,.2))),Sc.set(sz*1.2,sz*.75,sz));im.setMatrixAt(n,M);im.setColorAt(n,Col.setScalar(rr(.8,1.05)));n++;G._stones=G._stones||[];G._stones.push([x,z,sz]);}
   im.count=n;im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}
  // critters walk round the water
  G._stones=G._stones||[];G._stones.push([POND.x,POND.z,Math.max(POND.rx,POND.rz)*.75],[POND.x+c0*1.3,POND.z+s0*1.3,1.5],[POND.x-c0*1.3,POND.z-s0*1.3,1.5]);
  // where he fills the bucket: the end of the pond track, at the waterline
  const te=PTRACK[PTRACK.length-1];const dir=V(POND.x-te[0],0,POND.z-te[1]).normalize();
  // the waterline along the track's heading: step from well outside the pond inwards until the ground drops under the water
  let fx=te[0]-dir.x*2,fz=te[1]-dir.z*2;for(let k=0;k<300&&meshH(fx,fz)>level-.04;k++)/* the drawn floor: the bucket goes in where the water is visibly ~4 cm deep */{fx+=dir.x*.02;fz+=dir.z*.02;}
  const fill=V(fx+dir.x*.12,level,fz+dir.z*.12);const stand=V(fx-dir.x*.42,0,fz-dir.z*.42);stand.y=groundH(stand.x,stand.z);
  const P3=(x,z)=>V(x,groundH(x,z),z);
  // two flat stepping stones from where he stands out to the waterline, worn smooth, half in the mud
  if(G.stones){const im=G.stones;for(const t of [.3,.78]){if(im.count>=im.instanceMatrix.count)break;const x=stand.x+(fill.x-stand.x)*t,z=stand.z+(fill.z-stand.z)*t;const sz=.13-.02*t;
    M.compose(V(x,Math.max(groundH(x,z),level)-sz*.18,z),Q.setFromEuler(E.set(rr(-.05,.05),rr(0,6.28),rr(-.05,.05))),Sc.set(sz*1.25,sz*.32,sz));im.setMatrixAt(im.count,M);{if(!im.geometry.boundingBox)im.geometry.computeBoundingBox();const bb=im.geometry.boundingBox;(G._stepTops=G._stepTops||[]).push([x,z,Math.min(bb.max.x,bb.max.z)*sz*.9,Math.max(groundH(x,z),level)-sz*.18+bb.max.y*sz*.32]);}im.setColorAt(im.count,Col.setScalar(40));im.count++;}// 40 = 'worn' flag for the stone shader (no moss cap)
   im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}
  G.pond={mesh:water,level,x:POND.x,z:POND.z,r:(POND.rx+POND.rz)*.5,radius:(POND.rx+POND.rz)*.5,center:V(POND.x,level,POND.z),fill,stand,face:Math.atan2(dir.x,dir.z),
   path:[...[[0,4.3],[.5,5.6],[1.4,7.2]],...PTRACK.slice(1)].map(([x,z])=>P3(x,z)).concat([stand]),
   nodes:{g_foot:P3(0,4.3),g_path2:P3(1.4,7.2),g_pfork:P3(1.4,7.2),g_pond:stand},pondD};
  // splash rings for the bucket dip (Character) or anything that falls in: __ground.pond.splash(x,z,k=1)
  // also emits __ground.on('pond', e) with {act:'splash', pos:[x,y,z], k} for Sound
  let spI=0;G.pond.splash=(x,z,k=1)=>{const u=water.material.uniforms[spI?'uSp1':'uSp0'];spI^=1;u.value.set(x,z,WU.uT.value,Math.min(2,k));
   const L=LST.pond;if(L)for(const f of L){try{f({act:'splash',pos:[x,level,z],k});}catch(e){console.error(e);}}};
  G._pond=(dt,cam)=>{WU.uT.value+=dt;upLeaves(dt);const E2=window.__env;if(E2&&E2.moonRim){WU.uMoon.value.copy(E2.moonRim.dir.value);WU.uNight.value=E2.moonRim.strength.value;}if(E2&&E2.lampPts)WU.uLp.value.forEach((v,i)=>v.copy(E2.lampPts.value[i]));/* [ENV] */
   const fc=scene.fog&&scene.fog.color;if(fc){WU.uSky.value.copy(fc);WU.uDeep.value.copy(fc).multiplyScalar(.085).add(Col.setRGB(.016,.017,.01));}};}

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
  mat.customProgramCacheKey=()=>'groundMudPrints1';const g=new THREE.PlaneGeometry(.12,.28).rotateX(-Math.PI/2);const NF=48,NS=MOBILE?14:24;const im=new THREE.InstancedMesh(g,mat,NF+NS);im.frustumCulled=false;
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
 {const nut=new THREE.SphereGeometry(1,MOBILE?5:10,MOBILE?3:8).scale(.62,.62,1);const cap=new THREE.SphereGeometry(1,MOBILE?5:10,MOBILE?2:6,0,Math.PI*2,0,Math.PI*.55).scale(.72,.72,.55).rotateX(-Math.PI/2).translate(0,0,-.42);
  const stalk=new THREE.CylinderGeometry(.06,.08,.3,MOBILE?3:5,1,MOBILE).rotateX(Math.PI/2).translate(0,0,-1.05);
  const paint=(g,c)=>{const n=g.attributes.position.count;const a=new Float32Array(n*3);for(let i=0;i<n;i++)a.set(c,i*3);g.setAttribute('color',new THREE.BufferAttribute(a,3));g.deleteAttribute('uv');return g.toNonIndexed();};
  const g=mergeGeometries([paint(nut,[.2,.095,.035]),paint(cap,[.11,.085,.055]),paint(stalk,[.09,.07,.05])/* linear: the old values read as pale beige beads */]);g.translate(0,.62,0);
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45});mat.onBeforeCompile=s=>addWet(s,'.6');
  const N=MOBILE?30:110;const im=new THREE.InstancedMesh(g,mat,N);let n=0;
  for(let i=0;i<N*20&&n<N;i++){const s=pick(ring(2.2,9),(x,z)=>rootD(x,z)>.04&&pathD(x,z)>0,5);if(!s)continue;const k=1+Math.floor(R()*3);/* they drop in twos and threes, not one by one */
   for(let j=0;j<k&&n<N;j++){const x=s[0]+(j?rr(-.09,.09):0),z=s[1]+(j?rr(-.09,.09):0);if(rootD(x,z)<.04)continue;const sz=rr(.013,.018);
   E.set(rr(-.3,.3),rr(0,6.28),rr(-.15,.15));Q.setFromEuler(E);M.compose(V(x,meshH(x,z)-.004,z),Q,Sc.set(sz,sz,sz));im.setMatrixAt(n,M);Col.setScalar(rr(.8,1.2));im.setColorAt(n,Col);n++;}}
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
  fm.onBeforeCompile=s=>{windHook(s);NOFLIP(s);addWet(s,'.75');s.uniforms.uGlow=glowU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uGlow;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=1.-.85*clamp(uGlow/1.8,0.,1.);/* the fronds\' soft self-lift is a daylight fill: under the moon they glowed */');s.uniforms.uHero=heroU;s.uniforms.uSteps=stepsU;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aK;uniform vec3 uHero;'+STEP_GLSL)
   .replace('#include <begin_vertex>',`#include <begin_vertex>\n{float k=aK;const float SW=.05;${SWAY}}
   /* he wades through: fronds within reach bow away from his legs, and the ones under a boot are pressed down for a while */
   {vec3 fw=(instanceMatrix*vec4(transformed,1.)).xyz;vec2 fv=fw.xz-uHero.xz;float fd=length(fv);vec2 fdn=fd>.001?fv/fd:vec2(1.,0.);
    float fh=smoothstep(.7,.15,fd)*step(abs(instanceMatrix[3][1]-uHero.y),.7)*aK;vec3 sn=stepNear(fw.xz,.4);float fs=sn.z;float fy=max(0.,fw.y-instanceMatrix[3][1]);
    if(fh+fs>.001)transformed+=windLocal(vec3(fdn.x*.28*fh+sn.x*fy*.7*fs,-.1*fh-fy*.6*fs,fdn.y*.28*fh+sn.y*fy*.7*fs));}`);addLan(s,'3.5');};fm.customProgramCacheKey=()=>'groundFern-lan1-step2-wet1';
  const geos=MOBILE?[mk(8,.7,3)]:[mk(7,.75,3),mk(9,.6,8)];// phones: one variant (one draw call)
  geos.forEach((fg,vi)=>{const NF=MOBILE?32:80;const im=new THREE.InstancedMesh(fg,fm,NF);let n=0;
   for(let i=0;i<NF*30&&n<NF;i++){const s=pick(R()<.5?ring(2.6,8):ring(10,24),(x,z)=>{const d=rootD(x,z);return d>.25&&d<(Math.hypot(x,z)>10?99:2.2)&&pathD(x,z)>.2;},6);if(!s)continue;const [x,z]=s;
    const sz=rr(.8,1.4)*(Math.hypot(x,z)>10?rr(1.3,1.8):1);if(pathD(x,z)<.12+.36*sz)continue;/* the fronds (~0.36 m x size) stay off the trodden ways: he passed through the edge of two by the ladder path */M.compose(V(x,meshH(x,z)-.02,z),slopeQ(x,z,rr(0,6.28)),Sc.set(sz,sz*rr(.85,1.1),sz));im.setMatrixAt(n,M);
    Col.setHSL(rr(.3,.38),rr(.3,.45),rr(.6,.75));im.setColorAt(n,Col);n++;}
   im.count=n;im.receiveShadow=true;scene.add(im);});
  G.ferns=true;}

 // ================= mushrooms =================
 // little clusters with warm caps that glow faintly at night (a cosy touch in the cold blue). Glow uniform: C.shroomGlow.
 {const cap=new THREE.SphereGeometry(1,MOBILE?8:14,MOBILE?3:7,0,Math.PI*2,0,Math.PI*.5).scale(1,.55,1).translate(0,.9,0);
  const gill=new THREE.CircleGeometry(.98,MOBILE?8:14).rotateX(Math.PI/2).translate(0,.9,0);
  const stem=new THREE.CylinderGeometry(.24,.34,.95,MOBILE?6:8,MOBILE?1:2,MOBILE).translate(0,.47,0);{const p=stem.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i);p.setX(i,p.getX(i)+Math.sin(y*2.5)*.05);}}
  const paint=(g,f)=>{const p=g.attributes.position;const c=new Float32Array(p.count*3);const a=new Float32Array(p.count);for(let i=0;i<p.count;i++){const r=f(p.getY(i));c.set(r[0],i*3);a[i]=r[1];}g.setAttribute('color',new THREE.BufferAttribute(c,3));g.setAttribute('aCap',new THREE.BufferAttribute(a,1));};
  paint(stem,y=>[[.86,.84,.76],0]);paint(gill,y=>[[.62,.5,.4],.15]);paint(cap,y=>{const k=smooth(.9,1.45,y);return [[.62+k*.28,.32+k*.1,.2+k*.04],smooth(.95,1.4,y)];});
  const mg=mergeGeometries([stem.toNonIndexed(),gill.toNonIndexed(),cap.toNonIndexed()]);
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65});G.shroomGlow=glowU;
  mat.onBeforeCompile=sh=>{sh.uniforms.uGlow=glowU;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aCap;varying float vCap;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCap=aCap;');
   sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uGlow;varying float vCap;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.5,.2)*vCap*uGlow;');};
  const NM=MOBILE?28:64,NRN=MOBILE?8:16;/* + a rain flush: extra ones that come up in damp spots after a good rain and wither later */const im=new THREE.InstancedMesh(mg,mat,NM+NRN);let n=0;
  for(let t=0;t<NM*30&&n<NM;t++){// they grow at the foot of the roots
   const s=pick(ring(3,10),(x,z)=>{const d=rootD(x,z);return d>.08&&d<.6;},6);if(!s)continue;const [cx,cz]=s;const k=2+Math.floor(R()*4);
   for(let j=0;j<k&&n<NM;j++){const x=cx+rr(-.22,.22),z=cz+rr(-.22,.22);if(rootD(x,z)<.05)continue;const sz=rr(.03,.08)*(j===0?1.3:1);E.set(rr(-.25,.25),rr(0,6.28),rr(-.25,.25));Q.setFromEuler(E);
    M.compose(V(x,meshH(x,z)-.015,z),Q,Sc.set(sz,sz*rr(.9,1.5),sz));im.setMatrixAt(n,M);Col.setHSL(rr(.03,.08),rr(.5,.8),rr(.6,.78));im.setColorAt(n,Col);n++;}}
  // the flush: little groups at the damp edges of the puddle hollows and the pond bank, hidden (scale 0) until it has rained a while
  const fl=[];{const spots=[...(G.puddleSpots||[]).map(q=>[q[0],q[1],q[2]*.75]),[POND.x,POND.z,Math.max(POND.rx,POND.rz)+.35]];
   for(let t=0;t<400&&fl.length<NRN;t++){const sp=spots[t%spots.length];const a=rr(0,6.28);const cx=sp[0]+Math.cos(a)*sp[2]*rr(1,1.25),cz=sp[1]+Math.sin(a)*sp[2]*rr(1,1.25);
    if(rootD(cx,cz)<.1||pathD(cx,cz)<.2||pondD(cx,cz)<.08)continue;const k=2+Math.floor(R()*3);
    for(let j=0;j<k&&fl.length<NRN;j++){const x=cx+rr(-.15,.15),z=cz+rr(-.15,.15);const sz=rr(.025,.06)*(j===0?1.25:1);E.set(rr(-.2,.2),rr(0,6.28),rr(-.2,.2));
     fl.push({p:V(x,meshH(x,z)-.015,z),q:new THREE.Quaternion().setFromEuler(E),s:V(sz,sz*rr(.9,1.4),sz),d:rr(0,.35)});Col.setHSL(rr(.06,.11),rr(.35,.6),rr(.62,.8));im.setColorAt(n+fl.length-1,Col);}}}
  const n0=n;for(let i=0;i<fl.length;i++)im.setMatrixAt(n0+i,M.makeScale(0,0,0));n+=fl.length;
  let wetT=0,dryT=1e9,gro=0,shown=-1;
  G._flush=(dt)=>{if(ST.rainK>.3){wetT+=dt;dryT=0;}else{dryT+=dt;if(dryT>420)wetT=0;}const want=wetT>25&&dryT<420?1:0;/* ~25 s of real rain: they come up over ~1.5 min; ~7 min after it stops they wither */
   gro+=(want-gro)*Math.min(1,dt/(want?40:60));flushU.value=gro;if(G.litter)return;/* baked into the litter mesh: the vertex shader grows them */if(Math.abs(gro-shown)<.01)return;shown=gro;
   for(let i=0;i<fl.length;i++){const f=fl[i];const k=Math.min(1,Math.max(0,(gro-f.d)/(1-f.d)));const e=k*k*(3-2*k);M.compose(f.p,f.q,Sc.copy(f.s).multiply(V(e,e*(.6+.4*e),e)));im.setMatrixAt(n0+i,M);}im.instanceMatrix.needsUpdate=true;};
  G.flush=()=>({wetT,dryT,gro,n:fl.length});G._flushSet={n0,fl};
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
  // [ENV] a card seen edge-on thins out and goes instead of smearing into a dark striped fin (its texture minified to a streak).
  // Geometric normal from screen derivatives of the view position (no texture reads involved).
  {const ob=mat.onBeforeCompile;mat.onBeforeCompile=s=>{ob(s);NOFLIP(s);s.uniforms.uWet=wetU;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uWet;').replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n{diffuseColor.rgb*=1.-.24*uWet;roughnessFactor=mix(roughnessFactor,.62,uWet*.6);}/* soaked leaves: darker, only a soft sheen (the card normals point out of the clump, a sharp gloss put white blotches on it) */');/* the back of a card shades with the bush's outward normal: flipped, it went near-black (dark crescents round the bushes at night) */s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>',
   '{vec3 gnE=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));diffuseColor.a*=smoothstep(.3,.6,abs(dot(gnE,normalize(vViewPosition))));}/* fade near-edge-on cards sooner: their minified leaf texture cut by alphaTest gave stair-stepped fins */\n#include <alphatest_fragment>');};
   mat.customProgramCacheKey=()=>'groundBush-edgeFade2-wet2';}
  const NB=MOBILE?24:40;(MOBILE?[mkBush(1,14)]:[mkBush(1,22),mkBush(2,16)]).forEach((bg,vi)=>{const im=new THREE.InstancedMesh(bg,mat,NB);im.name='groundBushes';/* [CAMERA] name used to fade them like oak leaves when they hide the hero */let n=0;
   const NS=MOBILE?3:5;// the first few frame the clearing on the left and right edges of the main view, like the photo
   for(let b=0;b<NB*40&&n<NB;b++){let x,z,r;
    if(n<NS){const sd=(n+vi)%2?1:-1;x=sd*rr(8.5,13);z=rr(-6,5);r=Math.hypot(x,z);}
    else{const a=rr(0,6.28);r=rr(10,42);x=Math.cos(a)*r;z=Math.sin(a)*r;
    // keep the view to the house open (camera looks from +z), crowd the sides and the back
    if((z>-3&&Math.abs(x)<15))continue;}
    if(rootD(x,z)<1||!exitClear(x,z))continue;
    const sz=rr(1.1,2.2)*(r>25?1.4:1);M.compose(V(x,groundH(x,z)-.15,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(.9,1.4),sz*rr(.7,1),sz*rr(.9,1.3)));im.setMatrixAt(n,M);
    Col.setHSL(rr(.3,.38),rr(.2,.35),rr(.48,.6));im.setColorAt(n,Col);n++;}
   /* the framing bushes stood alone, a single round ball in the fog when the camera turns to its limit: each gets two lower
      companions overlapping it into an irregular clump. They take the slots of the last far bushes (hash-placed: the shared
      random stream and the instance count stay as they were) */
   {const cM=new THREE.Matrix4(),cp=V(),cq=new THREE.Quaternion(),cs=V();let k=n-1;
    for(let f=0;f<Math.min(NS,n)&&k>=NS+2;f++){im.getMatrixAt(f,cM);cM.decompose(cp,cq,cs);
     for(let j=0;j<2&&k>=NS;j++,k--){const h=Math.abs(Math.sin(cp.x*(41.3+j*17.)+cp.z*(29.1+j*5.))*43758.5)%1;const a=h*6.283,d=cs.x*(.55+.25*h);const x=cp.x+Math.cos(a)*d,z=cp.z+Math.sin(a)*d;
      const sc=.55+.25*((h*7.)%1);M.compose(V(x,groundH(x,z)-.2,z),Q.setFromAxisAngle(V(0,1,0),h*40.),Sc.set(cs.x*sc*1.2,cs.y*sc*.85,cs.z*sc*1.1));im.setMatrixAt(k,M);
      const au=(h*13.)%1;Col.setHSL(au<.3?.12:au<.45?.06:.33+.05*h,au<.45?.55:.28,au<.45?.44:.5);im.setColorAt(k,Col);}}}
   im.count=n;im.receiveShadow=true;scene.add(im);});
  // ---- the far edge of the clearing: a dense wall of undergrowth and young trees in front of the painted forest ----
  // It gives depth: near plants, then this thicket, then the far trees and the fog. Kept out of the camera's view line.
  const edgeOK=(x,z)=>!(z>1&&Math.abs(x)<13)&&rootD(x,z)>1.5&&exitClear(x,z);
  /* the camera orbits the oak only from the front (yaw within ~±0.8 of home, 0.32..1.2 x the home distance, i.e. ~10-36 m out on a phone):
     anything tall standing in that arc, out between the clearing and the lens, filled the frame at the yaw limits (a young tree's crown hid
     the trunk and the lower house). Young trees keep out of the whole arc, bushes out of its outer part; they fill the sides and the back */
  const camArc=(x,z,dMin)=>{const dx=x,dz=z-2.4;return Math.abs(Math.atan2(dx,dz))<1.05&&Math.hypot(dx,dz)>dMin;};
  {const bg=mkBush(5,MOBILE?14:20);const NE=MOBILE?66:180;/* [ENV perf] phones: overdraw */const EXU=MOBILE?34:50;const im=new THREE.InstancedMesh(bg,mat,NE+(MOBILE?40:70)+EXU);/* + room for the far seam ring, appended below */im.name='groundBushes';let n=0;
   for(let t=0;t<NE*40&&n<NE;t++){const a=rr(0,6.28),r=(R()<.4?rr(10,15):rr(15,25))+(vnoise(a*3,1)-.5)*3;const x=Math.cos(a)*r,z=Math.sin(a)*r*.95;if(!edgeOK(x,z)||camArc(x,z,17))continue;
    const sz=rr(1.2,2.4);M.compose(V(x,groundH(x,z)-.25,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(1,1.6),sz*rr(.8,1.25),sz*rr(1,1.5)));im.setMatrixAt(n,M);
    Col.setHSL(rr(.3,.4),rr(.18,.32),rr(.38,.52));const au=R();if(au<.2)Col.setHSL(rr(.1,.15),rr(.45,.6),rr(.42,.52));else if(au<.33)Col.setHSL(rr(.04,.07),rr(.5,.65),rr(.36,.46));/* autumn: a third yellow / rust */im.setColorAt(n,Col);n++;}
   im.count=n;im.computeBoundingSphere();im.receiveShadow=true;scene.add(im);G.thicket=im;}
  {// young trees: a slim, slightly crooked trunk with a few side twigs, and two or three leaf clumps up top
   const r=rng(9);const parts=[];let px=0,pz=0;const pts=[];for(let i=0;i<=6;i++){const y=i/6*4.2;px+=(r()-.5)*.18;pz+=(r()-.5)*.18;pts.push(V(px,y,pz));}
   const cu=new THREE.CatmullRomCurve3(pts);const tg=new THREE.TubeGeometry(cu,MOBILE?6:10,1,MOBILE?5:6,false);{const p=tg.attributes.position;const tmp=V();
    // taper: pull each ring towards the curve by height
    for(let i=0;i<p.count;i++){tmp.fromBufferAttribute(p,i);const t=Math.min(1,Math.max(0,tmp.y/4.2));const c=cu.getPoint(t);const k=(.12*(1-t)+.045)*(1+.6*smooth(.12,0,t));/* [ENV] a sapling trunk ~9 cm at the crown, not a 5 cm stick */tmp.sub(c).multiplyScalar(k).add(c);p.setXYZ(i,tmp.x,tmp.y,tmp.z);}tg.computeVertexNormals();}
   parts.push(tg);for(let b=0;b<3;b++){const y0=1.8+b*.7,a=r()*6.28;const c0=cu.getPoint(y0/4.2);const c1=c0.clone().add(V(Math.cos(a)*.7,.45,Math.sin(a)*.7));parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(c0,c1),MOBILE?1:2,.025,MOBILE?3:4,false));}
   const trunkG=mergeGeometries(parts.map(g=>g.index?g.toNonIndexed():g));
   const tmat=new THREE.MeshStandardMaterial({color:0x4B3B30,roughness:.95});
   // [ENV] bark instead of a plain brown tube: vertical fissures, grey lichen, a mossy green foot (procedural, no texture taps in branches)
   tmat.onBeforeCompile=sh=>{sh.uniforms.uNz=NZU;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vYP;').replace('#include <begin_vertex>','#include <begin_vertex>\nvYP=position;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vYP;'+GLSL_NOISE).replace('#include <color_fragment>',`#include <color_fragment>
     {vec2 bq=vec2((vYP.x-vYP.z)*38.,vYP.y*1.6);float f=fbm(bq);float fi=smoothstep(.5,.62,fbm(vec2((vYP.x-vYP.z)*90.,vYP.y*2.5)+3.));diffuseColor.rgb*=.7+.5*f;diffuseColor.rgb*=1.-.45*fi;
      float li=smoothstep(.62,.75,fbm(vec2((vYP.x+vYP.z)*30.,vYP.y*5.)+9.));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.36,.4,.3),li*.35);
      float mo=smoothstep(.9,.1,vYP.y+(f-.5)*.6);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.11,.15,.07),mo*.5);}`);};
   tmat.customProgramCacheKey=()=>'youngTree-bark1';
   /* [ENV ask] clumps stacked unevenly and spread, so they read as small trees, not one ball on a stick *//* [ENV] one big lumpy crown, not balls on a stick: overlapping clumps of mixed size from ~2.2 m up, no sky between them */
   const crownG=mergeGeometries((MOBILE?[[7,7,1.5,0,3.3,0],[8,6,1.15,.75,2.75,.35],[11,6,1.05,-.6,3.95,-.3],[12,6,1.,-.25,2.55,-.6]]:
    [[7,10,1.6,.05,3.35,0],[8,8,1.2,.8,2.75,.4],[11,8,1.15,-.65,4.05,-.3],[12,7,1.05,-.4,2.5,-.6],[13,7,1.,.45,4.35,.55]]).map(([sd,nc,sc,x,y,z])=>mkBush(sd,nc).scale(sc,sc*.85,sc).translate(x,y-.55*sc*.85,z)));
   const NT=MOBILE?32:66;const ti=new THREE.InstancedMesh(trunkG,tmat,NT),ci=new THREE.InstancedMesh(crownG,mat,NT);let n=0;
   for(let t=0;t<NT*50&&n<NT;t++){const a=rr(0,6.28),rad=R()<.25?rr(12,16):rr(16,28);const x=Math.cos(a)*rad,z=Math.sin(a)*rad;if(!edgeOK(x,z)||camArc(x,z,9))continue;
    const sz=rr(.75,1.25);{const yq=Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)).clone();const h1=Math.abs(Math.sin(x*91.7+z*47.3)*43758.5)%1,h2=Math.abs(Math.sin(x*13.1+z*77.9)*24634.6)%1;/* [ENV] each leans its own way a little: not one tree copied forty times */const lq=new THREE.Quaternion().setFromEuler(new THREE.Euler((h1-.5)*.16,0,(h2-.5)*.16));const tall=(n%3===0)?rr(1.7,2.1):1;/* a third grow to 7-9 m */M.compose(V(x,groundH(x,z)-.1,z),lq.multiply(yq),Sc.set(sz*(.85+h2*.3)*(tall>1?1.2:1),sz*rr(.9,1.2)*tall,sz*(.85+h1*.3)*(tall>1?1.2:1)));ti.setMatrixAt(n,M);ci.setMatrixAt(n,M);ti.setColorAt(n,new THREE.Color().setRGB(.8+h1*.4,.8+h1*.35,.8+h2*.35));}
    Col.setHSL(rr(.28,.38),rr(.2,.35),rr(.42,.56));const au=R();if(au<.2)Col.setHSL(rr(.1,.15),rr(.45,.6),rr(.42,.52));else if(au<.33)Col.setHSL(rr(.04,.07),rr(.5,.65),rr(.36,.46));/* autumn: a third yellow / rust */ci.setColorAt(n,Col);n++;}
   for(const im of [ci]){im.count=n;im.computeBoundingSphere();im.receiveShadow=true;scene.add(im);}ti.count=n;G.youngTrees=ti;
   // phones' draw-call budget: the slim trunks are static, so they are baked into the woodpile's bark mesh (bark texture, one call less)
   const bark=G.woodpile&&G.woodpile.children[0];
   if(bark&&n){const gs=[bark.geometry];const tc=new THREE.Color();for(let i=0;i<n;i++){ti.getMatrixAt(i,M);const g=trunkG.clone().applyMatrix4(M);if(ti.instanceColor)ti.getColorAt(i,tc);else tc.setRGB(1,1,1);
     const cnt=g.attributes.position.count;const cc=new Float32Array(cnt*3);for(let k=0;k<cnt;k++){cc[k*3]=tc.r*.62;cc[k*3+1]=tc.g*.58;cc[k*3+2]=tc.b*.55;}g.setAttribute('color',new THREE.BufferAttribute(cc,3));
     g.setIndex(Array.from({length:cnt},(_,k)=>k));for(const k of Object.keys(g.attributes))if(!bark.geometry.attributes[k])g.deleteAttribute(k);gs.push(g);}
    const mg=mergeGeometries(gs);if(mg){bark.geometry.dispose();bark.geometry=mg;mg.computeBoundingSphere();}else{ti.receiveShadow=true;scene.add(ti);}}
   else{ti.receiveShadow=true;scene.add(ti);}}
  // ---- where the clearing meets the painted far forest (a 96 m cylinder): a ring of big, fog-tinted undergrowth hides
  // the line where the ground plane meets the painting, so the forest floor runs into the trees with no seam
  {const NR=MOBILE?40:70;const seam=[];/* collected here, drawn by the thicket instanced mesh built above (one draw call less) */const im={setMatrixAt:(i,m)=>seam.push([m.clone()]),setColorAt:(i,c)=>{seam[seam.length-1].push(c.clone());}};let n=0;
   for(let i=0;i<NR;i++){const a=i/NR*Math.PI*2+rr(-.03,.03),r=rr(86,93);const x=Math.cos(a)*r,z=Math.sin(a)*r;const sz=rr(5,8);
    M.compose(V(x,groundH(x,z)-1,z),Q.setFromAxisAngle(V(0,1,0),rr(0,6.28)),Sc.set(sz*rr(1.4,2),sz*rr(.6,.9),sz*rr(1.4,2)));im.setMatrixAt(n,M);Col.setHSL(.42,.18,rr(.22,.3));im.setColorAt(n,Col);n++;}
   /* the far seam ring joins the thicket's instanced mesh: same bush material, one draw for both */{const T=G.thicket;let k=T.count;for(const [m,c] of seam){if(k>=T.instanceMatrix.count)break;T.setMatrixAt(k,m);T.setColorAt(k,c);k++;}/* the clearing's back half (seen only when the camera turns to its limits) had a few lone bushes in empty fog: a denser band of
      understory there, low and lumpy, a third in autumn yellow and rust. Own random stream: every other layout stays put */
     {const r3=rng(31337),q3=(a,b)=>a+r3()*(b-a);let e=0;for(let t=0;t<2000&&e<(MOBILE?34:50)&&k<T.instanceMatrix.count;t++){const a=q3(0,6.283),rad=q3(9.5,17);const x=Math.cos(a)*rad,z=Math.sin(a)*rad*.95;
       if(z>1.5||!edgeOK(x,z)||camArc(x,z,17))continue;const sz=q3(.9,1.8);M.compose(V(x,groundH(x,z)-.25,z),Q.setFromAxisAngle(V(0,1,0),q3(0,6.28)),Sc.set(sz*q3(1.1,1.7),sz*q3(.6,.95),sz*q3(1.1,1.6)));T.setMatrixAt(k,M);
       const au=r3();if(au<.22)Col.setHSL(q3(.1,.15),q3(.45,.6),q3(.4,.5));else if(au<.36)Col.setHSL(q3(.04,.07),q3(.5,.65),q3(.34,.44));else Col.setHSL(q3(.3,.4),q3(.18,.3),q3(.36,.5));T.setColorAt(k,Col);k++;e++;}}
     T.count=k;T.instanceMatrix.needsUpdate=true;if(T.instanceColor)T.instanceColor.needsUpdate=true;T.computeBoundingSphere();G.seamRing=T;}}}


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
  let cur=null,wait=rr(25,50),route=null,ti=0,pause=0,dist=0,curl=0,scared=false,lastStep=0;
  // a route from the forest edge, around the trunk (never through the roots), into the forest on the other side
  const plan=()=>{const a0=rr(0,6.28),a1=a0+Math.PI*rr(.6,1.4)*(R()<.5?1:-1);const pts=[];const N=40;
   for(let i=0;i<=N;i++){const t=i/N;const a=a0+(a1-a0)*t;const r=lerp3(17,rr(6,9),17,t);pts.push(V(Math.cos(a)*r,0,Math.sin(a)*r));}
   for(const q of pts){let k=0;while(rootD(q.x,q.z)<.4&&k++<20){q.multiplyScalar(1.05);}
    // step round stones and moss cushions (their radius plus half a hedgehog) and round the puddles
    for(let it=0;it<3;it++)for(const [sx,sz,sr] of (G._stones||[])){const dx=q.x-sx,dz=q.z-sz,d=Math.hypot(dx,dz),need=sr*1.35+.14;if(d<need){const k2=(need-d)/Math.max(d,1e-3);q.x+=dx*k2;q.z+=dz*k2;}}
    for(const p of (G.puddleSpots||[])){const px=p.x??p[0],pz=p.z??p[1],pr=(p.r??p[2]??.6)+.15;const dx=q.x-px,dz=q.z-pz,d=Math.hypot(dx,dz);if(d<pr){const k2=(pr-d)/Math.max(d,1e-3);q.x+=dx*k2;q.z+=dz*k2;}}
    q.y=groundH(q.x,q.z);}return new THREE.CatmullRomCurve3(pts);};
  const lerp3=(a,b,c,t)=>t<.5?a+(b-a)*smooth(0,.5,t):b+(c-b)*smooth(.5,1,t);
  G._critters=(dt)=>{if(!cur){wait-=dt*(1+eve());if(wait>0)return;cur=critters[R()<.55?'hog':'mouse'];route=plan();dist=0;pause=0;curl=0;scared=false;lastStep=0;cur.position.copy(route.getPointAt(0));{const p0=route.getPointAt(0);emit(cur===critters.hog?'hedgehog':'mouse','appear',p0.x,p0.y,p0.z,cur===critters.hog?'hedgehog':'mouse');}cur.rotation.y=Math.atan2(...(()=>{const a=route.getPointAt(0),b=route.getPointAt(.01);return [b.x-a.x,b.z-a.z];})());cur.visible=true;return;}
   const u=cur.userData;const L=route.getLength();const kind=cur===critters.hog?'hedgehog':'mouse';const P=cur.position;
   // the hero close by: the hedgehog curls up and waits; the mouse bolts along its way
   {const h=heroU.value;const near=h.y>-50&&h.y<groundH(h.x,h.z)+.6&&Math.hypot(h.x-P.x,h.z-P.z)<2.5;
    if(near&&!scared){scared=true;if(u.dash)emit(kind,'flee',P.x,P.y,P.z,kind);else{curl=rr(4,7);pause=0;emit(kind,'curl',P.x,P.y,P.z,kind);}}if(!near&&curl<=0)scared=false;}
   if(curl>0){curl-=dt;cur.scale.setScalar(1);cur.children[0]&&(u.head.rotation.x=Math.min(.9,u.head.rotation.x+dt*3));if(curl<=0){u.head.rotation.x=0;emit(kind,'uncurl',P.x,P.y,P.z,kind);}}
   else if(pause>0){pause-=dt;u.head.rotation.y=Math.sin(pause*6)*.4;}
   else{dist+=dt*u.speed*(u.dash?(.75+.35*Math.sin(dist*1.6)):1)*(scared&&u.dash?2.5:1);if(!scared&&R()<dt*(u.dash?.5:.25)){pause=rr(.6,2.2);emit(kind,'sniff',P.x,P.y,P.z,kind,{dur:pause});}u.head.rotation.y*=.9;
    // footsteps in the litter: one event every few strides (Sound rate-limits)
    if(dist-lastStep>(u.dash?.35:.25)){lastStep=dist;emit(kind,u.dash&&scared?'dash':'step',P.x,P.y,P.z,kind);}}
   const t=Math.min(1,dist/L);const pos=route.getPointAt(t),ahead=route.getPointAt(Math.min(1,t+.01));
   cur.position.copy(pos);cur.position.y=groundH(pos.x,pos.z)+(pause>0?0:Math.abs(Math.sin(dist*u.step))*u.bob);
   // turn smoothly toward the way ahead (no snapping on tight bends)
   {const want=Math.atan2(ahead.x-pos.x,ahead.z-pos.z);let d=want-cur.rotation.y;d=Math.atan2(Math.sin(d),Math.cos(d));cur.rotation.y+=d*Math.min(1,dt*6);}
   if(u.legs){const ph=dist*u.step*.5;u.legs.forEach((L,i)=>{L.rotation.x=pause>0?L.rotation.x*.85:Math.sin(ph+((i===0||i===3)?0:Math.PI))*.6;});}
   critU.value.set(pos.x,cur.position.y,pos.z);
   if(t>=1){emit(kind,'leave',P.x,P.y,P.z,kind);cur.visible=false;cur=null;critU.value.set(0,-99,0);wait=rr(70,160);}};
  G.spawnCritter=k=>{wait=0;if(cur){cur.visible=false;cur=null;}if(k){cur=critters[k];route=plan();dist=0;pause=0;cur.visible=true;}};}
 // ---- night ground mist: a soft, slowly curling wisp of low fog round the hero's feet and the critters' feet ----
 // three thin horizontal layers (5, 12 and 22 cm up) of procedural fog; a few quads, no extra passes, so it costs nothing on a phone
 {const u={t:{value:0},on:{value:0},col:{value:new THREE.Color(.5,.6,.68)}};
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{t:u.t,on:u.on,col:u.col}]),
   vertexShader:`#include <fog_pars_vertex>\nattribute vec2 aL;varying vec2 vUv;varying vec2 vW;varying vec2 vL;void main(){vUv=uv;vL=aL;vec4 w=modelMatrix*vec4(position,1.);vW=w.xz;vec4 mvPosition=viewMatrix*w;gl_Position=projectionMatrix*mvPosition;\n#include <fog_vertex>\n}`,
   fragmentShader:`#include <fog_pars_fragment>\nuniform float t,on;uniform vec3 col;varying vec2 vUv;varying vec2 vW;varying vec2 vL;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    void main(){vec2 c=vUv-.5;float r=length(c)*2.;float a=t*.12*vL.y;mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a));vec2 q=R*c*3.+vW*.6;
     float f=n(q*2.+t*.05)*.6+n(q*4.3-t*.08)*.4;float al=smoothstep(1.,.05,r)*smoothstep(1.,.5,r+.2)*smoothstep(.3,.85,f)*on*vL.x;
     gl_FragColor=vec4(col,al);\n#include <fog_fragment>\n}`});
  // three layers (5, 12 and 22 cm up, each smaller, fainter and turning the other way) merged into one mesh: aL = (alpha, spin)
  const mkM=(s)=>{const L=[[.05,1,.2,1],[.12,.8,.13,-1],[.22,.55,.08,1]].map(([y,sc,a,k])=>{const g=new THREE.PlaneGeometry(s*sc,s*sc).rotateX(-Math.PI/2).translate(0,y,0);const n=g.attributes.position.count;const al=new Float32Array(n*2);for(let i=0;i<n;i++){al[i*2]=a;al[i*2+1]=k;}g.setAttribute('aL',new THREE.BufferAttribute(al,2));return g;});
   const mm=m.clone();mm.uniforms.t=u.t;mm.uniforms.on={value:0};mm.uniforms.col=u.col;const q=new THREE.Mesh(mergeGeometries(L),mm);q.renderOrder=5;q.frustumCulled=false;q.visible=false;scene.add(q);return q;};
  const hm=mkM(1.6),cm=mkM(.7);G.footMist={hero:hm,critter:cm,u};
  const setOn=(g,v)=>{g.visible=v>.01;g.material.uniforms.on.value=v;};
  let hv=0,cv=0;
  G._mist=(dt)=>{u.t.value+=dt;const night=Math.max(ST.nightK,smooth(.4,.9,eve()));
   const hp=heroU.value;const onGround=hp.y>-50&&hp.y<groundH(hp.x,hp.z)+.35;hv+=((onGround?night:0)-hv)*Math.min(1,dt*.8);
   hm.position.set(hp.x,groundH(hp.x,hp.z),hp.z);setOn(hm,hv);
   const cp=critU.value;cv+=((cp.y>-50?night:0)-cv)*Math.min(1,dt*1.5);if(cp.y>-50)cm.position.set(cp.x,cp.y,cp.z);setOn(cm,cv);};}
 // ================= daytime life: butterflies, ground birds, a squirrel =================
 // All code-animated and instanced (one draw call each), only by day, and they all keep away from the hero.
 const dayK=()=>1-eve();
 const heroNear=(x,z,r)=>{const h=heroU.value;return h.y>-50&&h.y<groundH(h.x,h.z)+.6&&Math.hypot(h.x-x,h.z-z)<r;};
 const paintV=(g,c)=>{g=g.index?g.toNonIndexed():g;const a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set(c,i);g.setAttribute('color',new THREE.BufferAttribute(a,3));if(g.attributes.uv)g.deleteAttribute('uv');return g;};
 const IM=new THREE.Matrix4(),IQ=new THREE.Quaternion(),IE=new THREE.Euler(),IS=V(1,1,1),IP=V();
 // ---- butterflies: two hinged wings flapped in the vertex shader; they drift round a home spot (pond, clearing edge, flowers) ----
 {const NB=MOBILE?5:8;const wingT=(()=>{const cv=document.createElement('canvas');cv.width=128;cv.height=128;const x=cv.getContext('2d');
   // one wing seen from above (fore + hind lobe), dark rim and a pale spot; white base so instanceColor tints it
   x.fillStyle='#fff';x.beginPath();x.ellipse(70,46,50,34,-.35,0,6.283);x.fill();x.beginPath();x.ellipse(52,92,34,28,.4,0,6.283);x.fill();
   x.globalCompositeOperation='source-atop';x.strokeStyle='#222';x.lineWidth=9;x.beginPath();x.ellipse(70,46,50,34,-.35,0,6.283);x.stroke();x.beginPath();x.ellipse(52,92,34,28,.4,0,6.283);x.stroke();
   x.fillStyle='#F6EFD8';x.beginPath();x.arc(92,38,7,0,6.283);x.fill();x.fillStyle='rgba(0,0,0,.35)';x.fillRect(0,0,14,128);
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;})();
  const wl=new THREE.PlaneGeometry(.05,.05).rotateX(-Math.PI/2).translate(.025,0,0);const wr=wl.clone().scale(-1,1,1);
  {const u=wr.attributes.uv;for(let i=0;i<u.count;i++)u.setX(i,u.getX(i));}
  const g=mergeGeometries([wl,wr]);const mat=new THREE.MeshStandardMaterial({map:wingT,alphaTest:.5,side:THREE.DoubleSide,roughness:.8});
  const bu={t:{value:0}};mat.onBeforeCompile=sh=>{sh.uniforms.uBT=bu.t;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uBT;').replace('#include <begin_vertex>',`#include <begin_vertex>
    {float ph=instanceMatrix[3][0]*7.+instanceMatrix[3][2]*3.;float a=(.15+.95*(.5+.5*sin(uBT*19.+ph)))*(1.-.6*step(.5,fract(uBT*.31+ph)));
     float ax=abs(transformed.x);transformed.y=ax*sin(a);transformed.x=sign(transformed.x)*ax*cos(a);}`);};
  mat.customProgramCacheKey=()=>'groundButterfly1';const im=new THREE.InstancedMesh(g,mat,NB);im.frustumCulled=false;im.visible=false;scene.add(im);G.butterflies=im;
  const cols=[[.95,.55,.15],[.98,.85,.3],[.95,.95,.9],[.55,.7,.95],[.95,.6,.2],[.9,.9,.6],[.98,.98,.95],[.85,.45,.1]];
  const homes=()=>{const r=R();if(r<.35&&G.pond){const a=rr(0,6.28);return [G.pond.x+Math.cos(a)*rr(2.5,3.8),G.pond.z+Math.sin(a)*rr(2,3)];}const a=rr(0,6.28),d=rr(5,11);return [Math.cos(a)*d,Math.sin(a)*d*.9];};
  const B=[];for(let i=0;i<NB;i++){const [hx,hz]=homes();B.push({hx,hz,x:hx,z:hz,y:.6,ph:rr(0,100),sp:rr(.35,.6),flee:0});im.setColorAt(i,Col.setRGB(...cols[i%cols.length]));}
  G._butter=(dt)=>{const k=dayK()*(1-ST.rainK);im.visible=k>.3;if(!im.visible)return;bu.t.value+=dt;const T=bu.t.value;
   B.forEach((b,i)=>{if(b.flee<=0&&heroNear(b.x,b.z,2.2)){b.flee=6;}
    if(b.flee>0){b.flee-=dt;// flutter up and away from him, then settle at a new home
     const h=heroU.value;const dx=b.x-h.x,dz=b.z-h.z,d=Math.hypot(dx,dz)||1;b.x+=dx/d*dt*1.4;b.z+=dz/d*dt*1.4;b.y=Math.min(2.6,b.y+dt*.5);if(b.flee<=0){const [hx,hz]=homes();b.hx=hx;b.hz=hz;}}
    else{// lazy figure-of-eight wander round home, dipping toward the grass
     const a=T*b.sp+b.ph;const tx=b.hx+Math.sin(a)*1.3+Math.sin(a*2.3)*.4,tz=b.hz+Math.sin(a*.8)*Math.cos(a)*1.1;const k2=Math.min(1,dt*1.2);b.x+=(tx-b.x)*k2;b.z+=(tz-b.z)*k2;
     b.y+=((groundH(b.x,b.z)+.35+.3*Math.sin(a*1.7)+.15*Math.sin(a*5.1))-b.y)*Math.min(1,dt*1.5);}
    const yaw=Math.atan2(Math.cos(T*b.sp+b.ph),-Math.sin(T*b.sp+b.ph))+Math.sin(T*3+b.ph)*.3;
    IM.compose(IP.set(b.x,b.y+Math.sin(T*9+b.ph)*.02,b.z),IQ.setFromEuler(IE.set(0,yaw,0)),IS.set(1.4,1.4,1.4));im.setMatrixAt(i,IM);});
   im.instanceMatrix.needsUpdate=true;};}
 // ---- ground birds (robin-like): hop, peck, look about on the open grass in the morning and by day; flush when he comes near ----
 {const NBD=MOBILE?3:5;const parts=[paintV(new THREE.SphereGeometry(.05,8,6).scale(1,.85,1.35),[.42,.33,.25]),paintV(new THREE.SphereGeometry(.043,8,6).scale(1,.8,1.1).translate(0,-.012,.03),[.85,.42,.18]),
   paintV(new THREE.SphereGeometry(.03,8,6).translate(0,.04,.055),[.4,.32,.25]),paintV(new THREE.ConeGeometry(.007,.022,4).rotateX(Math.PI/2).translate(0,.038,.093),[.2,.17,.12]),
   paintV(new THREE.BoxGeometry(.04,.006,.06).rotateX(-.35).translate(0,.01,-.085),[.3,.24,.18]),paintV(new THREE.SphereGeometry(.006,4,3).translate(.02,.048,.07),[.02,.02,.02]),paintV(new THREE.SphereGeometry(.006,4,3).translate(-.02,.048,.07),[.02,.02,.02]),
   paintV(new THREE.CylinderGeometry(.003,.003,.04,3).translate(.015,-.04,0),[.3,.25,.2]),paintV(new THREE.CylinderGeometry(.003,.003,.04,3).translate(-.015,-.04,0),[.3,.25,.2])];
  const g=mergeGeometries(parts);g.translate(0,.062,0);const im=new THREE.InstancedMesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85}),NBD);im.frustumCulled=false;im.visible=false;scene.add(im);G.birds=im;
  const spot=()=>{for(let k=0;k<40;k++){const a=rr(0,6.28),r=rr(3.5,11);const x=Math.cos(a)*r,z=Math.sin(a)*r*.9;if(rootD(x,z)>.5&&(!G.pondD||G.pondD(x,z)>.6))return [x,z];}return [5,8];};
  const Bd=[];for(let i=0;i<NBD;i++){const [x,z]=spot();Bd.push({x,z,y:groundH(x,z),yaw:rr(0,6.28),st:'look',t:rr(.3,2),hop:0,hx:0,hz:0,peck:0,air:0,gone:0});}
  G._birds=(dt)=>{const day=dayK()>.5;const rain=ST.rainK>.25;im.visible=day;if(!day)return;
   Bd.forEach((b,i)=>{if(b.gone>0){b.gone-=rain?0:dt;if(b.gone<=0){const [x,z]=spot();Object.assign(b,{x,z,st:'land',air:1.2,t:1});}else{IM.makeScale(0,0,0);im.setMatrixAt(i,IM);return;}}
    if(rain&&b.st!=='fly'&&b.gone<=0){// shelter: off into the trees until the rain stops
     emit('bird','flee',b.x,groundH(b.x,b.z),b.z,'bird'+i);b.st='fly';const a=Math.atan2(b.z,b.x);b.hx=Math.cos(a);b.hz=Math.sin(a);b.t=2.5;}
    if(b.st!=='fly'&&heroNear(b.x,b.z,3)){emit('bird','flee',b.x,groundH(b.x,b.z),b.z,'bird'+i);b.st='fly';const h=heroU.value;b.hx=Math.sign(b.x-h.x||1);b.hz=Math.sign(b.z-h.z||1);b.t=2.5;}
    let pitch=0,bob=0;b.t-=dt;
    if(b.st==='fly'){// flush: up and away over the bushes
     b.x+=b.hx*dt*4;b.z+=b.hz*dt*4;b.air+=dt*2.2;b.yaw=Math.atan2(b.hx,b.hz);if(b.t<=0){b.gone=rr(20,50);b.air=0;}}
    else if(b.st==='land'){b.air=Math.max(0,b.air-dt*1.6);if(b.air<=0){emit('bird','land',b.x,groundH(b.x,b.z),b.z,'bird'+i);b.st='look';b.t=rr(.5,1.5);}}
    else if(b.st==='hop'){if(b.hop===0)emit('bird','hop',b.x,groundH(b.x,b.z),b.z,'bird'+i);b.hop+=dt/.22;const f=Math.min(1,b.hop);b.x+=Math.sin(b.yaw)*dt*.7;b.z+=Math.cos(b.yaw)*dt*.7;bob=Math.sin(f*Math.PI)*.05;if(b.hop>=1){b.hop=0;if(b.t<=0||rootD(b.x,b.z)<.3||(G.pondD&&G.pondD(b.x,b.z)<.4)){b.st=R()<.5?'peck':'look';b.t=rr(.4,1.6);b.pk=0;if(rootD(b.x,b.z)<.3)b.yaw+=Math.PI;}}}
    else if(b.st==='peck'){const pk=Math.floor((b.peck+Math.PI*1.5)/(Math.PI*2));b.peck+=dt*9;if(Math.floor((b.peck+Math.PI*1.5)/(Math.PI*2))>pk)emit('bird','peck',b.x,groundH(b.x,b.z),b.z,'bird'+i);pitch=Math.max(0,Math.sin(b.peck))*.9;if(b.t<=0){b.st='look';b.t=rr(.4,1.2);}}
    else{// look: sharp little head turns (whole bird), then hop on
     if(R()<dt*3)b.yaw+=rr(-.8,.8);if(b.t<=0){b.st='hop';b.t=rr(.3,1.4);b.hop=0;}}
    const y=groundH(b.x,b.z)+bob+b.air;IM.compose(IP.set(b.x,y,b.z),IQ.setFromEuler(IE.set(pitch,b.yaw,0,'YXZ')),IS.set(1,1,1));im.setMatrixAt(i,IM);});
   im.instanceMatrix.needsUpdate=true;};}
 // ---- a red squirrel: now and then (by day) it bounds in from the edge, up onto a big root, sits up, flicks its tail, bounds off ----
 {const P=[paintV(new THREE.SphereGeometry(.06,8,6).scale(1,.9,1.6),[.62,.3,.14]),paintV(new THREE.SphereGeometry(.045,8,6).translate(0,.04,.1),[.64,.32,.15]),
   paintV(new THREE.SphereGeometry(.03,6,4).scale(.9,.8,1).translate(0,-.005,-.02),[.9,.82,.7]),paintV(new THREE.ConeGeometry(.012,.03,4).translate(.022,.085,.09),[.6,.28,.12]),paintV(new THREE.ConeGeometry(.012,.03,4).translate(-.022,.085,.09),[.6,.28,.12]),
   paintV(new THREE.SphereGeometry(.006,4,3).translate(.025,.05,.135),[.02,.02,.02]),paintV(new THREE.SphereGeometry(.006,4,3).translate(-.025,.05,.135),[.02,.02,.02])];
  // the big bushy tail: a fat curl up the back
  const tc=new THREE.CatmullRomCurve3([V(0,.01,-.08),V(0,.07,-.17),V(0,.17,-.16),V(0,.22,-.08),V(0,.2,-.03)]);const tail=new THREE.TubeGeometry(tc,8,.034,6,false);
  {const p=tail.attributes.position;const c=V();for(let i=0;i<=8;i++){tc.getPointAt(i/8,c);const k=.55+.45*Math.sin(Math.min(1,i/8*1.3)*Math.PI*.9);for(let j=0;j<=6;j++){const vi=i*7+j;p.setXYZ(vi,c.x+(p.getX(vi)-c.x)*k,c.y+(p.getY(vi)-c.y)*k,c.z+(p.getZ(vi)-c.z)*k);}}tail.computeVertexNormals();}
  P.push(paintV(tail,[.68,.34,.16]));const g=mergeGeometries(P);g.translate(0,.055,0);
  const sq=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));sq.visible=false;sq.castShadow=!MOBILE;scene.add(sq);G.squirrel=sq;
  // root perches: big root tops 2.5-5 m from the trunk, found by casting down onto the tree once
  const perches=[];{const rc=new THREE.Raycaster();for(let k=0;k<200&&perches.length<8;k++){const a=rr(0,6.28),r=rr(2.2,5);const x=Math.cos(a)*r,z=Math.sin(a)*r;if(rootD(x,z)>.01)continue;
    rc.set(V(x,3,z),V(0,-1,0));const h=rc.intersectObjects(obstacles,true)[0];if(h&&h.point.y>groundH(x,z)+.12&&h.point.y<1.1)perches.push(V(x,h.point.y,z));}}
  let S0=null,wait=rr(30,70);G.spawnSquirrel=()=>{wait=0;};G._perches=perches;
  G._squirrel=(dt)=>{if(!S0){if(!perches.length||dayK()<.6||ST.rainK>.3){sq.visible=false;return;}wait-=dt;if(wait>0)return;
    // straight runs from the edge to the perch and away again, never through the pond or across the paths' busy bit
    const clear=(A,Bp)=>{for(let k=0;k<=20;k++){const x=A.x+(Bp.x-A.x)*k/20,z=A.z+(Bp.z-A.z)*k/20;if(G.pondD&&G.pondD(x,z)<.5)return false;}return true;};
    let p,e,o;for(let k=0;k<30;k++){p=perches[Math.floor(R()*perches.length)];const a=Math.atan2(p.z,p.x)+rr(-.8,.8);e=V(Math.cos(a)*16,0,Math.sin(a)*16);
     const a2=a+rr(.6,1.4)*(R()<.5?1:-1);o=V(Math.cos(a2)*16,0,Math.sin(a2)*16);if(clear(e,p)&&clear(p,o))break;}
    e.y=groundH(e.x,e.z);o.y=groundH(o.x,o.z);
    S0={from:e,p,to:o,ph:'in',t:0,sit:rr(4,9),pos:e.clone(),yaw:0,up:0};sq.visible=true;}
   const s=S0;const go=(tgt,speed)=>{const d=V(tgt.x-s.pos.x,0,tgt.z-s.pos.z);const L=d.length();if(L<.05)return true;const st=Math.min(L,speed*dt);s.pos.x+=d.x/L*st;s.pos.z+=d.z/L*st;
     // bounding gait: little arcs; climbs smoothly onto the root near the perch
     const near=Math.hypot(s.pos.x-s.p.x,s.pos.z-s.p.z);const gy=groundH(s.pos.x,s.pos.z);s.pos.y=near<.6?gy+(s.p.y-gy)*(1-near/.6):gy;s.t+=dt;s.pos.y+=Math.abs(Math.sin(s.t*11))*.05;
     const want=Math.atan2(d.x,d.z);let dd=want-s.yaw;dd=Math.atan2(Math.sin(dd),Math.cos(dd));s.yaw+=dd*Math.min(1,dt*10);return false;};
   if(s.ph!=='out'&&ST.rainK>.25){emit('squirrel','flee',s.pos.x,s.pos.y,s.pos.z,'squirrel');s.ph='out';}
   if(s.ph!=='out'&&heroNear(s.pos.x,s.pos.z,3.5)){emit('squirrel','chitter',s.pos.x,s.pos.y,s.pos.z,'squirrel');emit('squirrel','flee',s.pos.x,s.pos.y,s.pos.z,'squirrel');s.ph='out';}
   if(s.ph==='in'&&!s.climbed&&Math.hypot(s.pos.x-s.p.x,s.pos.z-s.p.z)<.7){s.climbed=true;emit('squirrel','climb',s.pos.x,s.pos.y,s.pos.z,'squirrel',{dur:.35});}
   if(s.ph==='in'){if(go(s.p,2.2)){s.ph='sit';s.pos.copy(s.p);}}
   else if(s.ph==='sit'){s.sit-=dt;s.ch=(s.ch??rr(.5,2))-dt;if(s.ch<=0){s.ch=rr(1.5,4);emit('squirrel','chitter',s.pos.x,s.pos.y,s.pos.z,'squirrel');}s.up=Math.min(1,s.up+dt*3);s.yaw+=Math.sin(s.sit*2.1)*dt*1.5;if(s.sit<=0)s.ph='out';}
   else{s.up=Math.max(0,s.up-dt*5);if(go(s.to,3.2)){sq.visible=false;S0=null;wait=rr(60,150);return;}}
   // sitting up: tilt back on the haunches, a quick tail flick
   sq.position.copy(s.pos);sq.rotation.set(-.55*s.up+(s.ph==='sit'?Math.max(0,Math.sin(s.sit*9))*.08:0),s.yaw,0,'YXZ');};}
 G.updateLife=(dt,cam)=>{if(G._skitter)G._skitter(dt);G._gw(dt);G._moths(dt);G._critters(dt);G._mist(dt);if(G._pond)G._pond(dt,cam);G._butter(dt);G._birds(dt);G._squirrel(dt);};
 // ---- one draw call for the litter: fallen leaves, acorns and mushrooms baked into one static mesh with a two-cell atlas
 // (left: the oak-leaf picture, right: plain white for the vertex-coloured acorns and mushrooms); mushroom caps keep their glow ----
 if(G.leaves&&G.acorns&&G.shrooms){const leafTex=G.leaves.material.map;const cv=document.createElement('canvas');cv.width=384;cv.height=128;const x=cv.getContext('2d');
  const src=leafTex.image;x.drawImage(src,0,0,128,128);x.fillStyle='#fff';x.fillRect(132,4,120,120);if(G.pads)x.drawImage(G.pads.material.map.image,256,0,128,128);const atlas=new THREE.CanvasTexture(cv);atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=4;
  const parts=[];const im4=new THREE.Matrix4(),nm=new THREE.Matrix3(),ic=new THREE.Color();
  /* the floor darkens in the crevices between the roots (aoTex r: 1-ao.r*.42 plus the tucked soil); baked leaves and acorns there took the full light and glowed
     on the dark humus as if floating. Same occlusion baked into their vertex colour, so the litter sits IN the shade with the floor */
  const litAO=(x,z)=>{const gx=Math.floor((x+GE)/CELL),gz=Math.floor((z+GE)/CELL);if(gx<0||gz<0||gx>=GS||gz>=GS)return 1;const k=1-smooth(0,1.1,dist[gz*GS+gx]);return 1-k*.4;};
  const bake=(im,cell)=>{const g0=im.geometry.index?im.geometry.toNonIndexed():im.geometry;const P=g0.attributes.position,Nn=g0.attributes.normal,Uv=g0.attributes.uv,Cv=g0.attributes.color,Cap=g0.attributes.aCap;
   const FS=im===G.shrooms&&G._flushSet;for(let i=0;i<im.count;i++){const fi=FS?i-FS.n0:-1,ff=fi>=0&&fi<FS.fl.length?FS.fl[fi]:null;if(ff)im4.compose(ff.p,ff.q,ff.s);else im.getMatrixAt(i,im4);nm.getNormalMatrix(im4);if(im.instanceColor)im.getColorAt(i,ic);else ic.setRGB(1,1,1);
    const n=P.count;const pos=new Float32Array(n*3),nor=new Float32Array(n*3),uv=new Float32Array(n*2),col=new Float32Array(n*3),cap=new Float32Array(n);const v=V();const afl=new Float32Array(n*4);for(let k=0;k<n;k++)afl.set(ff?[ff.p.x,ff.p.y,ff.p.z,ff.d]:[0,0,0,-1],k*4);
    for(let k=0;k<n;k++){v.fromBufferAttribute(P,k).applyMatrix4(im4);pos.set([v.x,v.y,v.z],k*3);v.fromBufferAttribute(Nn,k).applyMatrix3(nm).normalize();nor.set([v.x,v.y,v.z],k*3);
     if(cell!==1&&Uv){uv[k*2]=(cell+Math.min(.98,Math.max(.02,Uv.getX(k))))/3;uv[k*2+1]=Uv.getY(k);}else{uv[k*2]=.5;uv[k*2+1]=.5;}
     const r=Cv?Cv.getX(k):1,gg=Cv?Cv.getY(k):1,b=Cv?Cv.getZ(k):1;const sh=litAO(pos[k*3],pos[k*3+2]);col.set([r*ic.r*sh,gg*ic.g*sh,b*ic.b*sh],k*3);cap[k]=Cap?Cap.getX(k):0;}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('aCap',new THREE.BufferAttribute(cap,1));g.setAttribute('aFl',new THREE.BufferAttribute(afl,4));parts.push(g);}
   scene.remove(im);};
  bake(G.leaves,0);bake(G.acorns,1);bake(G.shrooms,1);if(G.pads)bake(G.pads,2);if(G.lilies)bake(G.lilies,1);
  const mat=new THREE.MeshStandardMaterial({map:atlas,vertexColors:true,alphaTest:.5,side:THREE.DoubleSide,roughness:.78});
  mat.onBeforeCompile=sh=>{addWet(sh,'.45');sh.uniforms.uGlow=glowU;sh.uniforms.uFlush=flushU;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float aCap;varying float vCap;attribute vec4 aFl;uniform float uFlush;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCap=aCap;if(aFl.w>=0.){float fk=clamp((uFlush-aFl.w)/(1.-aFl.w),0.,1.);fk=fk*fk*(3.-2.*fk);transformed=aFl.xyz+(transformed-aFl.xyz)*vec3(fk,fk*(.6+.4*fk),fk);}/* rain-flush mushrooms grow up from their foot */');
   sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uGlow;varying float vCap;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.5,.2)*vCap*uGlow;');};
  mat.customProgramCacheKey=()=>'groundLitter-flush1-ao1';
  const litter=new THREE.Mesh(mergeGeometries(parts),mat);litter.name='litter';litter.receiveShadow=true;scene.add(litter);G.litter=litter;}
 // ---- the litter stirs: a gust rolling over the clearing (Wind) picks single leaves off the floor and sends them skittering and
 // tumbling downwind a metre or three; they fetch up against a root, the bank or a stone and lie there. His boots kick one up now
 // and then when he walks through the leaves. One small instanced mesh (MOBILE 10 / desktop 18 leaves), the litter's own atlas cell.
 {const NK=MOBILE?10:18;const g=new THREE.PlaneGeometry(1,1,2,2).rotateX(-Math.PI/2);{const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,x*x*.35+z*z*.12);uv.setX(i,Math.min(.98,Math.max(.02,uv.getX(i)))/3);}g.computeVertexNormals();}
  const lm=G.litter.material,km=new THREE.MeshStandardMaterial({map:lm.map,alphaTest:.5,side:THREE.DoubleSide,roughness:.78});
  const im=new THREE.InstancedMesh(g,km,NK);im.name='leafSkitter';im.frustumCulled=false;im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);im.receiveShadow=true;
  const pal=[[.07,.7,.36],[.04,.65,.3],[.1,.65,.4],[.16,.45,.32],[.12,.4,.26],[.09,.8,.46]];const Z=new THREE.Matrix4().makeScale(0,0,0);
  for(let i=0;i<NK;i++){const c=pal[i%pal.length];Col.setHSL(c[0],c[1],c[2]);im.setColorAt(i,Col);im.setMatrixAt(i,Z);}scene.add(im);G.skitter=im;
  const K=[];for(let i=0;i<NK;i++)K.push({on:0,t:0});let acc=0,hp=null,kickAcc=0;const q=new THREE.Quaternion(),e=new THREE.Euler(),m=new THREE.Matrix4(),p3=V(),sc=V();
  const ok=(x,z)=>rootD(x,z)>.06&&pondD(x,z)>.15;
  const start=(x,z,vx,vz,hop)=>{let l=K.find(k=>!k.on);if(!l){l=K.reduce((a,b)=>a.t>b.t?a:b);}/* all busy: the longest-resting one goes */
   Object.assign(l,{on:1,x,z,vx,vz,ph:rr(0,6.3),hop,run:rr(.7,2.2),t:0,yaw:rr(0,6.3),roll:rr(0,6.3),rs:rr(5,11)*(R()<.5?-1:1),sz:rr(.1,.16),k:0,rest:0});};
  G._skitter=dt=>{const W=C.wind;if(!W||!W.sample)return;
   // gusts: a leaf goes where the gust is strong (sampled at a random spot in the clearing each frame)
   const a=rr(0,6.28),r=Math.sqrt(rr(2.5*2.5,13*13)),x=Math.cos(a)*r,z=Math.sin(a)*r*.9;const w=W.sample({x,z});
   acc+=dt*Math.max(0,w.s-.62)*(MOBILE?5:8);if(acc>=1){acc=0;if(ok(x,z)&&pathD(x,z)>-.2){const sp=1.1+R()*.9;start(x,z,w.x/Math.max(.3,w.s)*sp*Math.min(1.6,w.s),w.z/Math.max(.3,w.s)*sp*Math.min(1.6,w.s),rr(.04,.12));}}
   // his boots in the leaves
   const h=window.__dbg&&window.__dbg.hero&&window.__dbg.hero.root;if(h){const hpp=h.position;if(hp){const d=Math.hypot(hpp.x-hp[0],hpp.z-hp[1]);const v=d/Math.max(dt,1e-3);
     if(v>.5&&v<4&&hpp.y-groundH(hpp.x,hpp.z)<.15&&Math.hypot(hpp.x,hpp.z)>2.3){kickAcc+=dt*.45;if(kickAcc>=1){kickAcc=0;const dx=(hpp.x-hp[0])/d,dz=(hpp.z-hp[1])/d;const sx=hpp.x+dx*.15+rr(-.12,.12),sz2=hpp.z+dz*.15+rr(-.12,.12);if(ok(sx,sz2))start(sx,sz2,dx*rr(.5,.9)+rr(-.2,.2),dz*rr(.5,.9)+rr(-.2,.2),rr(.03,.07));}}}
    hp=[hpp.x,hpp.z];}
   let any=false;for(let i=0;i<NK;i++){const l=K[i];if(!l.on)continue;any=true;l.t+=dt;
    if(!l.rest){const f=Math.max(0,1-l.t/l.run);/* slows as the gust passes */const nx=l.x+l.vx*f*dt,nz=l.z+l.vz*f*dt;
     if(!ok(nx,nz)){l.rest=1;}else{l.x=nx;l.z=nz;}l.ph+=dt*(6+8*f);l.roll+=l.rs*dt*f;l.yaw+=dt*f*1.5;if(l.t>l.run)l.rest=1;}
    l.k=Math.min(1,l.k+dt*8);
    const air=l.rest?0:Math.abs(Math.sin(l.ph))*l.hop*Math.max(0,1-l.t/l.run);const y=meshH(l.x,l.z)+.014+air;
    // tumbling about the wind axis while it skips; flat (a little curled up) once it lies
    const tilt=l.rest?0:Math.sin(l.roll)*1.2;q.setFromEuler(e.set(tilt*.6,l.yaw,tilt,'YXZ'));
    if(l.rest&&l.t>l.run+40){l.k-=dt*.04;if(l.k<=0){l.on=0;im.setMatrixAt(i,Z);continue;}}/* after a while it has blended into the litter */
    m.compose(p3.set(l.x,y,l.z),q,sc.set(l.sz*l.k,l.sz*l.k,l.sz*1.15*l.k));im.setMatrixAt(i,m);}
   if(any)im.instanceMatrix.needsUpdate=true;};}
 // everything this module added to the scene (for the perf budget checks)
 G.objects=C.scene.children.filter(o=>!__before.has(o));
 return G;
}
