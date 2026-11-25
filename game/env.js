// Environment: forest around the oak, ground, grass, rocks, rolling ground fog, lamp halos and colour grading.
// Owned by the "environment / colour / light" work. index.html calls createEnv() once and env.update() every frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// deterministic random so the forest is the same on every load
function rng(seed){let s=seed>>>0;return ()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};

// value noise on the CPU (ground colour, heights)
function hash2(x,y){const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);}
function vnoise(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);
 const a=hash2(ix,iy),b=hash2(ix+1,iy),c=hash2(ix,iy+1),d=hash2(ix+1,iy+1);return a+(b-a)*ux+(c-a)*uy+(a-b-c+d)*ux*uy;}
function fbm2(x,y){return vnoise(x,y)*.55+vnoise(x*2.1+5.2,y*2.1+1.3)*.3+vnoise(x*4.3+9.1,y*4.3+3.7)*.15;}

// ground height: flat where the hero and the house stand, gentle hills and a bowl rising into the forest
export function groundH(x,z){const r=Math.hypot(x,z*1.15);const far=smooth(16,40,r);
 return (fbm2(x*.045,z*.045)-.45)*2.4*far+far*far*2.2+(fbm2(x*.25+3,z*.25+7)-.5)*.18*smooth(9,14,r);}

const GLSL_NOISE=`
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
#ifndef FBM_OCT
#define FBM_OCT 4
#endif
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<FBM_OCT;i++){v+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,7.7);a*=.5;}return v;}`;

export function createEnv(C){
 const {scene,MOBILE,barkT,groundT,leafT,renderer}=C;
 // ================= ground-hugging height fog (in every lit material) =================
 // The distance fog of index.html stays; on top of it a layer of fog that is thick at the ground and thins out ~2 m up,
 // so roots, grass and the bottom of the trunk sink into blue mist like in the reference. Strength follows how thick
 // index.html makes the distance fog (night/morning/rain thick, day thin), so no extra uniforms are needed.
 THREE.ShaderChunk.fog_pars_vertex='#ifdef USE_FOG\nvarying float vFogDepth;\nvarying vec3 vFogW;\n#endif';
 THREE.ShaderChunk.fog_vertex='#ifdef USE_FOG\nvFogDepth=-mvPosition.z;\nvFogW=(inverse(viewMatrix)*mvPosition).xyz;\n#endif';
 THREE.ShaderChunk.fog_pars_fragment=`#ifdef USE_FOG
uniform vec3 fogColor;varying float vFogDepth;varying vec3 vFogW;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;uniform float fogFar;
#endif
float hfH(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float hfN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hfH(i),hfH(i+vec2(1,0)),f.x),mix(hfH(i+vec2(0,1)),hfH(i+vec2(1,1)),f.x),f.y);}
#endif`;
 THREE.ShaderChunk.fog_fragment=`#ifdef USE_FOG
#ifdef FOG_EXP2
float fogFactor=1.0-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);float hk=1.;float hz0=20.;
#else
float fogFactor=smoothstep(fogNear,fogFar,vFogDepth);float hk=smoothstep(78.,36.,fogFar-fogNear);float hz0=fogNear+4.;
#endif
{float HH=1.7;float yc=cameraPosition.y,yp=vFogW.y;float d=length(vFogW-cameraPosition);
 float dy=yp-yc;float ec=exp(-max(yc,0.)/HH),ep=exp(-max(yp,-1.)/HH);
 float od=abs(dy)>.01?HH*(ec-ep)/dy:ep;
 float n=hfN(vFogW.xz*.11)*.65+hfN(vFogW.xz*.31+7.)*.35;
 float clear=mix(.25,1.,smoothstep(5.,13.,length(vFogW.xz)));float tau=(.012+.085*hk)*(.45+1.1*n)*od*min(d,60.)*clear;
 float hf=1.-exp(-tau);
 // aerial haze: the forest behind the oak dissolves into blue mist at dusk/night, as in the painting
 fogFactor=max(fogFactor,smoothstep(hz0,hz0+50.,d)*.45*hk);
 fogFactor=fogFactor+hf*(1.-fogFactor);
 vec3 haze=mix(fogColor,vec3(dot(fogColor,vec3(.33)))*1.5+vec3(.05,.09,.11),.45);gl_FragColor.rgb=mix(gl_FragColor.rgb,mix(fogColor,haze,hf),fogFactor);}
#endif`;

 const R=rng(20261123);const rr=(a,b)=>a+R()*(b-a);
 const U={t:{value:0},wind:{value:1}};
 const env={U};
 env.wet={value:0};// 0 dry .. 1 soaked; follows rainK, dries slowly after the rain (for wet sheen in other threads' materials)


 // ground, grass, rocks, ferns, mushrooms and bushes moved to ground.js (ground & vegetation thread).
 // the mushroom glow uniform stays here: update() drives it, ground.js reads it.
 env.shroomGlow={value:0};

 // ================= forest =================
 // trunk + roots + a few big branches as one geometry per variant; canopies are leaf-cluster cards like the oak
 const barkMat=(()=>{const t=barkT.clone();t.needsUpdate=true;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,3);return new THREE.MeshStandardMaterial({map:t,roughness:1,color:0x9A8C80});})();
 // [ENV] the forest trunks take the crowns' own haze instead of the scene fog: under the full distance fog at 50 m they turned
 // paler than everything round them and stood in the day mist as white posts
 const trunkHz={hz:{value:new THREE.Color()},hzK:{value:.4}};env.trunkHaze=trunkHz;
 barkMat.onBeforeCompile=sh=>{Object.assign(sh.uniforms,trunkHz);sh.vertexShader='varying vec3 vHzW;\n'+sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvHzW=(modelMatrix*vec4(transformed,1.)).xyz;');
  sh.fragmentShader='uniform vec3 hz;uniform float hzK;varying vec3 vHzW;\n'+sh.fragmentShader.replace('#include <fog_fragment>','{float d=length(vHzW.xz-cameraPosition.xz);float k=hzK*(.75+.5*smoothstep(45.,85.,d));k=max(k,smoothstep(3.5,-.5,vHzW.y)*.85);gl_FragColor.rgb=mix(gl_FragColor.rgb,hz,clamp(k,0.,.92));}');};
 barkMat.customProgramCacheKey=()=>'forestBark-haze1';
 function tube(a,b,r0,r1,seg){const d=b.clone().sub(a);const L=d.length();const g=new THREE.CylinderGeometry(r1,r0,L,seg,Math.max(2,Math.round(L/(MOBILE?3:1.5)))/* phones: the forest stands 45 m+ out in fog, half the rings are enough */,true);g.translate(0,L/2,0);
  const p=g.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i)/L;const w=1+Math.sin(y*9+p.getX(i)*3)*.06;p.setX(i,p.getX(i)*w);p.setZ(i,p.getZ(i)*w);}
  const q=new THREE.Quaternion().setFromUnitVectors(V(0,1,0),d.normalize());g.applyQuaternion(q);g.translate(a.x,a.y,a.z);return g;}
 const tips=[];
 function treeVariant(seed){const r=rng(seed);const H=14+r()*6,R0=.55+r()*.35;const parts=[];const ends=[];
  // trunk with a slight lean
  const lean=V((r()-.5)*1.2,H,(r()-.5)*1.2);parts.push(tube(V(0,-.3,0),lean,R0,R0*.35,MOBILE?7:10));
  // root flare: short thick tubes bending into the ground
  for(let i=0;i<(MOBILE?3:5);i++){const a=i/(MOBILE?3:5)*6.28+r()*.6;parts.push(tube(V(0,1.3,0),V(Math.cos(a)*R0*3.2,-.25,Math.sin(a)*R0*3.2),R0*.75,R0*.25,6));}
  // big branches
  const nb=4+Math.floor(r()*3);for(let i=0;i<nb;i++){const y=H*(.42+r()*.45),a=r()*6.28,L=3+r()*4;const o=lean.clone().multiplyScalar(y/H);
   const e=o.clone().add(V(Math.cos(a)*L,L*(.35+r()*.5),Math.sin(a)*L));parts.push(tube(o,e,R0*.42*(1.1-y/H),R0*.12,MOBILE?5:6));ends.push(e);}
  ends.push(lean.clone().add(V(0,1,0)));
  const g=mergeGeometries(parts.map(p=>p.toNonIndexed()));g.computeVertexNormals();return {g,ends,H};}
 const variants=[treeVariant(7),treeVariant(19),treeVariant(42),treeVariant(77)];
 // positions: a ring of forest behind and to the sides, leaving the front of the house and the zombie paths open.
 // Pavel: no forest tree may be taller than our oak (crown top ~23 m), most are smaller, and the forest stands dense:
 // scale .48-.8 puts the tops at ~11-21 m, 3.4 m apart, from FR0 (57 m phone / 47 m desktop) 20 m deep (the far rings and the backdrop follow the same rule)
 const FR0=MOBILE?57:47;/* inner edge of the forest: beyond the camera's farthest zoom-out (phone home 33 m, desktop 24 m, x1.55) */
 const spots=[];{let guard=0;const NT=MOBILE?72:120;while(spots.length<NT&&guard++<12000){const a=rr(0,6.28),r=rr(FR0,FR0+20),x=Math.cos(a)*r,z=Math.sin(a)*r;
   // the ring starts beyond the camera's widest orbit (phone home distance 33 m x1.55): the camera never flies into a trunk and
   // no tree stands between the camera and the house from any side
   if(z>10)continue;if(spots.some(s=>Math.hypot(s.x-x,s.z-z)<3.4))continue;spots.push({x,z,v:Math.floor(R()*4),ry:rr(0,6.28),s:rr(.48,.8)});}}
 {const byV=[[],[],[],[]];spots.forEach(s=>byV[s.v].push(s));const m=new THREE.Matrix4(),q=new THREE.Quaternion();
  // all forest trunks baked into ONE mesh (one draw call instead of one per variant; they surround the scene, so culling saved nothing)
  const baked=[];byV.forEach((list,vi)=>{list.forEach(s=>{q.setFromAxisAngle(V(0,1,0),s.ry);m.compose(V(s.x,groundH(s.x,s.z),s.z),q,V(s.s,s.s,s.s));baked.push(variants[vi].g.clone().applyMatrix4(m));
    for(const e of variants[vi].ends){const w=e.clone().multiplyScalar(s.s).applyQuaternion(q).add(V(s.x,groundH(s.x,s.z),s.z));tips.push({p:w,s:s.s,d:Math.hypot(s.x,s.z),tr:s});}});});
  if(baked.length){const fm=new THREE.Mesh(mergeGeometries(baked),barkMat);baked.forEach(g=>g.dispose());fm.castShadow=!MOBILE;fm.receiveShadow=true;fm.name='forestTrunks';scene.add(fm);env.forestTrunks=fm;}}
 // canopy cards
 {const lt=leafT;/* phones: unlit cards (MeshBasic), their colour = the light they would get, computed once a frame (see foldLights) */const mat=MOBILE?new THREE.MeshBasicMaterial({map:lt,alphaTest:.5,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({map:lt,alphaTest:.5,side:THREE.DoubleSide,roughness:.85});
  const per=renderer?1:(MOBILE?18:32);/* with a renderer the cards are replaced by impostors below *//* phones: fewer, slightly bigger cards (draw budget) */const csz=MOBILE?1.18:1;const N=tips.length*per;const im=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),mat,N);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),c=new THREE.Color();let n=0;
  for(const t of tips){for(let k=0;k<per;k++){const d=V(rr(-1,1),rr(-.5,.8),rr(-1,1)).normalize().multiplyScalar(Math.pow(R(),.5)*3.4*t.s);const p=t.p.clone().add(d);
    q.setFromEuler(new THREE.Euler(rr(-1.2,1.2),rr(0,6.28),rr(-1.2,1.2)));const sz=rr(1.6,2.6)*t.s*csz;m.compose(p,q,V(sz,sz,sz));im.setMatrixAt(n,m);
    // deeper in the forest the leaves turn bluer and darker, like the painted reference
    const far=smooth(16,60,t.d);c.setRGB(.78-far*.25,.88-far*.25,.82-far*.1);im.setColorAt(n,c);n++;}}
  im.count=n;im.castShadow=!MOBILE;im.name='forestCanopy';scene.add(im);env.canopy=im;
  // impostors (phones and desktop: the forest stands 46 m+ out). One leaf clump (48 cards) is rendered once into a 256px texture,
  // every branch tip gets a single upright camera-facing quad with it instead of 18-32 cards (the far crowns were stacking ~23
  // alpha-tested layers per pixel), and the same clump fills the understory: bushes and low crowns packed between the trunks so
  // the forest reads as a thick wall (Pavel: denser). Unlit: their colour is the light they would get, set each frame (litForest).
  if(renderer){try{const S=256,rt=new THREE.WebGLRenderTarget(S,S,{depthBuffer:true});rt.texture.generateMipmaps=true;rt.texture.minFilter=THREE.LinearMipmapLinearFilter;
   const bs=new THREE.Scene(),bm=new THREE.MeshBasicMaterial({map:lt,alphaTest:.5,side:THREE.DoubleSide}),NB=48,bim=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),bm,NB);const rb=rng(91);
   for(let k=0;k<NB;k++){const d=V(rb()*2-1,(rb()*2-1)*.75+.1,rb()*2-1).normalize().multiplyScalar(Math.pow(rb(),.5)*3.4);q.setFromEuler(new THREE.Euler((rb()-.5)*2.4,rb()*6.28,(rb()-.5)*2.4));const sz=1.6+rb()*1.1;
    m.compose(d,q,V(sz,sz,sz));bim.setMatrixAt(k,m);const sh=.62+.45*((d.y+3.4)/6.8)+(d.z>0?.08:-.08)+(rb()-.5)*.12;bim.setColorAt(k,c.setRGB(sh,sh,sh));}// lighter on top and front: the clump keeps its volume
   bs.add(bim);const oc=new THREE.OrthographicCamera(-4.8,4.8,4.8,-4.8,.1,30);oc.position.set(0,0,12);oc.lookAt(0,0,0);
   const prev=renderer.getRenderTarget(),cc=renderer.getClearColor(new THREE.Color()),ca=renderer.getClearAlpha();renderer.setRenderTarget(rt);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(bs,oc);
   renderer.setRenderTarget(prev);renderer.setClearColor(cc,ca);bim.geometry.dispose();bm.dispose();
   const imat=new THREE.MeshBasicMaterial({map:rt.texture,alphaTest:.45,fog:false});
   // own haze instead of the scene fog: at 50-80 m the distance fog swallowed the forest whole; this keeps it a dark wall
   // that leans into the fog colour with depth and sinks into the ground mist at its feet
   const hazeU={hz:{value:new THREE.Color()},hzK:{value:.4}};env.forestHaze=hazeU;
   imat.onBeforeCompile=sh=>{Object.assign(sh.uniforms,hazeU);sh.vertexShader='varying vec3 vHz;\n'+sh.vertexShader.replace('#include <project_vertex>',`vec3 ctr=instanceMatrix[3].xyz;float isz=length(instanceMatrix[0].xyz);
     vec3 rgt=normalize(vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]));vec4 mvPosition=viewMatrix*vec4(ctr+rgt*transformed.x*isz+vec3(0.,transformed.y*length(instanceMatrix[1].xyz),0.),1.);gl_Position=projectionMatrix*mvPosition;vHz=ctr+vec3(0.,transformed.y*length(instanceMatrix[1].xyz),0.);`);
    sh.fragmentShader='uniform vec3 hz;uniform float hzK;varying vec3 vHz;\n'+sh.fragmentShader.replace('#include <fog_fragment>',`{float d=length(vHz.xz-cameraPosition.xz);float k=hzK*(.75+.5*smoothstep(45.,85.,d));k=max(k,smoothstep(3.5,-.5,vHz.y)*.85);gl_FragColor.rgb=mix(gl_FragColor.rgb,hz,clamp(k,0.,.92));}`);};
   // an octagon just around the clump's round silhouette instead of the full quad: 17% fewer pixels to shade
   const oct=new THREE.CircleGeometry(.5/Math.cos(Math.PI/8),8);{const op=oct.attributes.position,ou=oct.attributes.uv;for(let i=0;i<op.count;i++)ou.setXY(i,op.getX(i)+.5,op.getY(i)+.5);}
   const mkImp=(list,name)=>{const iq=new THREE.InstancedMesh(oct,imat,list.length);list.forEach((o,j)=>{m.compose(o.p,q.identity(),V(o.w,o.h,1));iq.setMatrixAt(j,m);iq.setColorAt(j,c.setRGB(o.c[0],o.c[1],o.c[2]));});
    iq.frustumCulled=false;iq.name=name;scene.add(iq);return iq;};
   // autumn (the reference season): about half the crowns stay green, the rest turn gold, orange-rust or ochre (multipliers on
   // the green leaf clump: red up, blue down); deeper in the fog they fade toward the cool blue-green
   const ra=rng(33),AUT=[[1,1,1],[1,1,1],[1,1,1],[1.85,1.12,.5],[1.85,1.12,.5],[1.95,.86,.42],[1.5,1.02,.55]];
   const tint=(d,k)=>{const far=smooth(FR0,FR0+22,d);const a=AUT[Math.floor(ra()*AUT.length)],f=1-far*.45;return [(.8-far*.2)*k*(1+(a[0]-1)*f),(.9-far*.2)*k*(1+(a[1]-1)*f),(.84-far*.08)*k*(1+(a[2]-1)*f)];};
   // crowns: fuller than the cards were (x1.6 wide), so neighbouring crowns merge into one canopy
   // phones (GPU cost): one crown per tree, sized to the spread of its branch tips, instead of one per tip (the tips' crowns
   // overlapped ~7 deep). Desktop keeps a crown per tip.
   let crowns=tips.map(t=>({p:t.p,w:9.6*t.s*1.6,h:9.6*t.s*1.45,c:tint(t.d,1)}));
   if(MOBILE){const by=new Map();for(const t of tips){if(!by.has(t.tr))by.set(t.tr,[]);by.get(t.tr).push(t);}crowns=[];
    for(const [tr,l] of by){const ctr=V();l.forEach(t=>ctr.add(t.p));ctr.multiplyScalar(1/l.length);let sx=0,sy=0;const rgt=V();
     for(const t of l){sx=Math.max(sx,Math.hypot(t.p.x-ctr.x,t.p.z-ctr.z));sy=Math.max(sy,Math.abs(t.p.y-ctr.y));}
     const cs=9.6*tr.s*.75;crowns.push({p:ctr.add(V(0,cs*.1,0)),w:(sx*1.5+cs)*1.05,h:sy*1.5+cs,c:tint(Math.hypot(tr.x,tr.z),1)});}}
   env.canopy=mkImp(crowns,'forestCanopyImpostors');scene.remove(im);im.geometry.dispose();im.dispose();
   // understory: low bushes on the forest floor, young trees' crowns at 3-8 m, and leaf mass hung between neighbouring crowns
   const ul=[];const ru=rng(57);const NU=MOBILE?130:560;for(let k=0;k<NU*3&&ul.length<NU;k++){const a=ru()*6.28,r=(MOBILE?FR0+1:FR0-3)+ru()*(MOBILE?20:24),x=Math.cos(a)*r,z=Math.sin(a)*r;if(z>12)continue;
    const lvl=ru();const w=lvl<.4?3.8+ru()*3.6:6+ru()*5;const y=groundH(x,z)+(lvl<.4?w*.34:4+ru()*8);ul.push({p:V(x,y,z),w:w*1.15,h:w,c:tint(r,lvl<.4?.72:.86)});}
   env.understory=mkImp(ul,'forestUnderstory');env.canopyTex=rt.texture;}catch(e){console.warn('canopy impostors',e);}}}

 // far forest: a painted backdrop (Fal, from the reference: gnarled oak silhouettes in blue fog) on a cylinder around the scene.
 // Mirrored-repeat so there is no seam; at night the painting shows as is, by day it is re-tinted with the fog colour.
 const bgU={map:{value:null},dmap:{value:null},fogc:{value:new THREE.Color()},hor:{value:new THREE.Color()},night:{value:1},ok:{value:0},bgHaze:{value:.3}};
 new THREE.TextureLoader().load(new URL('forest-bg.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.MirroredRepeatWrapping;t.anisotropy=4;bgU.map.value=t;bgU.ok.value=1;if(!bgU.dmap.value)bgU.dmap.value=t;});
 new THREE.TextureLoader().load(new URL('forest-bg-day.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.MirroredRepeatWrapping;t.anisotropy=4;bgU.dmap.value=t;});
 {const RAD=96,H=21,Y0=-3;const g=new THREE.CylinderGeometry(RAD,RAD,H,64,1,true);g.translate(0,H/2+Y0,0);
  const mat=new THREE.ShaderMaterial({uniforms:bgU,side:THREE.BackSide,transparent:true,depthWrite:false,fog:false,
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`uniform sampler2D map,dmap;uniform vec3 fogc,hor;uniform float night,ok,bgHaze;varying vec2 vUv;
    void main(){vec2 uv=vec2(vUv.x*14.,vUv.y*.8);vec3 c=texture2D(map,uv).rgb;c=mix(c,fogc*1.1,bgHaze*(1.-vUv.y*.6));
     // day: the daytime painting of the same forest, nudged toward the current sky/fog colour (sunrise/sunset tint)
     vec3 dc=texture2D(dmap,uv).rgb;vec3 day=dc*mix(vec3(1.),mix(fogc,hor,.5)/max(dot(mix(fogc,hor,.5),vec3(.33)),.05),.3);day=mix(day,fogc,.18*(1.-vUv.y*.6));
     vec3 nt=c*1.0;
     vec3 o=mix(day,nt,night);
     // bottom of the painting melts into the scene fog, so the far ground edge doesn't draw a straight line against it
     vec3 hz=mix(fogc,hor,.08);/* [ENV] the far rings' own haze colour: no brighter band to glint white between their trunks */o=mix(o,hz,smoothstep(.34,.08,vUv.y));float a=smoothstep(1.,.5,vUv.y+(texture2D(map,vec2(uv.x*3.,.5)).r-.3)*.4)*ok;
     gl_FragColor=vec4(o,a);
     #include <colorspace_fragment>
    }`});
  const mesh=new THREE.Mesh(g,mat);mesh.renderOrder=-1;mesh.frustumCulled=false;scene.add(mesh);env.backdrop=mesh;}

 // ================= far tree lines: layered silhouettes between the forest and the painted backdrop =================
 // Each ring is a cylinder seen from inside; the shader cuts it into trees (a trunk and a ragged round crown per cell, two
 // offset rows per ring) and fills them with one flat colour that leans further into the fog the farther the ring is, so the
 // rings read as aerial perspective and slide against each other as the camera turns. Opaque with discard: what they cover of
 // the backdrop is never drawn. Phones: 2 rings. Three offset rows of narrow trees 8-18 m tall: dense, never above the oak.
 const farRings=[];{const RINGS=MOBILE?[[80,.42,11],[90,.66,29]]:[[70,.34,11],[79,.52,29],[88,.7,47]];
  for(const [rad,k,seed] of RINGS){const u={tNoise:{value:null}/* set once the noise is baked, below */,col:{value:new THREE.Color()},haze:{value:new THREE.Color()},k:{value:k},R:{value:rad},seed:{value:seed},t:U.t};
   const g=new THREE.CylinderGeometry(rad,rad,40,MOBILE?72:112,1,true);g.translate(0,17,0);
   const m=new THREE.Mesh(g,new THREE.ShaderMaterial({uniforms:u,side:THREE.BackSide,fog:false,
    vertexShader:`varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform sampler2D tNoise;uniform vec3 col,haze;uniform float k,R,seed,t;varying vec3 vW;
     float hs(float n){return fract(sin(n*127.1+seed*31.7)*43758.5453);}
     float tree(float u,float y,float sp,float off){float c=floor((u+off)/sp);float x=(u+off)-(c+.5)*sp;x+=(hs(c)-.5)*sp*.5;
      float H=(.5+.5*hs(c+7.))*(9.+k*11.);float w=sp*(.42+.3*hs(c+3.));float cr=w*(1.2+.6*hs(c+5.));float yc=H-cr*.8;
      float d=length(vec2(x/w,(y-yc)/cr));float e=texture2D(tNoise,vec2(u*.23,y*.19)+seed).r;
      float crown=1.-step(1.+(e-.5)*.55,d);float trunk=step(abs(x+(y/yc-.5)*(hs(c+11.)-.5)*.6),(.25+.25*hs(c+9.))*(1.25-.5*clamp(y/yc,0.,1.)))*step(y,yc);/* tapered, a slight lean: not rectangles */return max(crown,trunk);}
     void main(){float u=atan(vW.z,vW.x)*R;float y=vW.y;
      float s=max(max(tree(u,y,4.2,0.),tree(u,y-1.2,3.4,1.9)),tree(u,y+.8,2.9,3.3));/* a ragged band of undergrowth and far trunks closes the bottom of each ring: the pale backdrop fog never shows through as white slivers */float ub=4.5+k*3.+3.*texture2D(tNoise,vec2(u*.031,.5)+seed*.7).r;s=max(s,step(y,ub));if(s<.5||y>40.)discard;
      // the bottom of each ring sinks into the ground fog; a faint vertical gradient and leaf noise keep the flat colour alive
      float n=texture2D(tNoise,vec2(u*.05,y*.05)+seed*.3).g;vec3 c=col*(.9+.2*n)*(.92+.1*smoothstep(0.,25.,y));
      c=mix(c,haze,k*.55+smoothstep(8.,-1.,y)*(1.-k*.4)*.6);gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
     }`}));m.renderOrder=-2;m.frustumCulled=false;scene.add(m);farRings.push(m);}}
 env.farRings=farRings;
 // ================= rolling ground fog =================
 // (1) horizontal sheets of domain-warped noise just above the ground
 // ---- baked fog noise: a 128x128 tiling texture with two independent 4-octave fbm channels (R, G), made once on load.
 // Fog shaders read it 1-3 times per pixel instead of running 4-octave procedural noise up to 5 times per layer (phone GPUs).
 const fogNoise=(()=>{const S=128,d=new Uint8Array(S*S*4);
  const lat=(n,seed)=>{const r=rng(seed);const a=new Float32Array(n*n);for(let i=0;i<n*n;i++)a[i]=r();return a;};
  const ch=[[[8,.5,11],[16,.25,23],[32,.125,37],[64,.0625,53]],[[8,.5,71],[16,.25,83],[32,.125,97],[64,.0625,101]]].map(o=>o.map(([n,a,s])=>[n,a,lat(n,s)]));
  const sm=t=>t*t*(3-2*t);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const i=(y*S+x)*4;ch.forEach((oct,c)=>{let v=0;for(const [n,a,L] of oct){const fx=x/S*n,fy=y/S*n,ix=Math.floor(fx),iy=Math.floor(fy),tx=sm(fx-ix),ty=sm(fy-iy);
    const g=(i,j)=>L[((j%n+n)%n)*n+((i%n+n)%n)];v+=a*((g(ix,iy)*(1-tx)+g(ix+1,iy)*tx)*(1-ty)+(g(ix,iy+1)*(1-tx)+g(ix+1,iy+1)*tx)*ty);}d[i+c]=Math.min(255,v/.94*255);});d[i+2]=0;d[i+3]=255;}
  const t=new THREE.DataTexture(d,S,S,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;})();
 // p is in "noise units" like the old fbm (one coarse cell = 1 unit; the texture tiles every 8 units)
 const FOG_NOISE=`uniform sampler2D tNoise;vec2 nz2(vec2 p){return texture2D(tNoise,p*.125).rg*.94;}float fbm(vec2 p){return nz2(p).r;}`;

 // soft edges (desktop): a half-resolution depth pre-pass of the opaque scene lets the fog fade where it meets the trunk, roots and house
 // instead of cutting them with a hard line. Phones skip it (SOFT 0) to save a scene pass.
 const SOFT=!MOBILE&&!!renderer;
 const softU={tDepth:{value:null},uRes:{value:new THREE.Vector2(1,1)},cNear:{value:.1},cFar:{value:500},soft:{value:SOFT?1:0},softS:{value:1}};
 const SOFT_GLSL=`
#include <packing>
uniform sampler2D tDepth;uniform vec2 uRes;uniform float cNear,cFar,soft,softS;
float softK(float range){if(soft<.5)return 1.;vec2 su=gl_FragCoord.xy/uRes;float sd=texture2D(tDepth,su).x;
 float sz=-perspectiveDepthToViewZ(sd,cNear,cFar);float fz=-perspectiveDepthToViewZ(gl_FragCoord.z,cNear,cFar);return clamp((sz-fz)/(range*softS),0.,1.);}`;
 let depthRT=null;const depthMat=new THREE.MeshBasicMaterial({colorWrite:false});
 if(SOFT){depthRT=new THREE.WebGLRenderTarget(4,4,{depthBuffer:true});depthRT.depthTexture=new THREE.DepthTexture(4,4);depthRT.depthTexture.type=THREE.UnsignedIntType;softU.tDepth.value=depthRT.depthTexture;}
 // wind (wind.js, window.__wind): fog noise drifts downwind and puffs lean/churn with the gusts
 const windU={drift:{value:new THREE.Vector2()},wdir:{value:new THREE.Vector2(1,0)},wlv:{value:0}};
 // the pond (ground.js, __ground.pond) stays clear of the ground fog: Pavel wants the water visible from the home view
 const pondU={pond:{value:new THREE.Vector3(0,-999,0)}};
 const fogU={tNoise:{value:fogNoise},t:U.t,col:{value:new THREE.Color(0x8FB8CC)},op:{value:.5},cam:{value:V()},trunkK:{value:.45},...softU,...windU,...pondU};
 const FOGDEF=MOBILE?{FBM_OCT:3}:{};// phones: one octave less in the fog noise (the sheets run it 5x per pixel)
 const sheetMat=new THREE.ShaderMaterial({defines:FOGDEF,transparent:true,depthWrite:false,fog:false,uniforms:fogU,
  vertexShader:`varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float t,op,trunkK;uniform vec3 col,cam,pond;uniform vec2 drift;varying vec3 vW;${FOG_NOISE}${SOFT_GLSL}
   void main(){vec2 p=(vW.xz-drift)*.075+vec2(vW.y*1.7,0.);vec2 q=nz2(p+vec2(t*.018,t*.007));
    vec2 r=nz2(p+3.*q+vec2(1.7,9.2)+t*.02);float d=fbm(p+3.4*r);
    float dist=length(vW.xz-cam.xz);float edge=smoothstep(95.,55.,length(vW.xz))*smoothstep(3.,9.,dist)*mix(trunkK,1.,smoothstep(5.,10.,length(vW.xz)))*mix(.1,1.,smoothstep(pond.z+.2,pond.z+2.2,length(vW.xz-pond.xy)));
    float graze=smoothstep(.04,.45,abs(normalize(cam-vW).y));float a=smoothstep(.3,.85,d)*op*edge*graze*softK(.6)*smoothstep(.35,1.8,cam.y-vW.y);/* a sheet near eye height reads as a hard horizontal line: it fades out as the camera comes down to it */gl_FragColor=vec4(col*(.82+.4*d),a);}`});
 const sheets=[];(MOBILE?[[.3,1.1],[.9,.85]]:[[.25,1],[.7,.8],[1.3,.6]]).forEach(([y,k])=>{const m=new THREE.Mesh(new THREE.CircleGeometry(97,40).rotateX(-Math.PI/2)/* the sheets fade out by r 95: a disc, not a 200 m square */,sheetMat.clone());m.material.uniforms=Object.assign({},fogU,{op:{value:.5}});m.position.y=y;m.renderOrder=4;m.userData.k=k;scene.add(m);sheets.push(m);});
 // (2) rolling puffs: camera-facing soft clouds that churn in place and drift around the tree
 const PB=MOBILE?12:22;/* low billows at the root feet (photo: fog in soft heaps between the roots, moss showing) */const PN=(MOBILE?46:80)+PB;const puffU={tNoise:{value:fogNoise},t:U.t,col:fogU.col,op:{value:.5},night:{value:1},frontK:{value:.7},...softU,...windU,lp:{value:Array.from({length:6},()=>new THREE.Vector4())},...pondU};
 const pg=new THREE.InstancedBufferGeometry();{/* an ellipse just around where the puff has any alpha (x .5, y .4 of the quad) instead of the full quad: ~35% less to rasterise */
  const eg=new THREE.CircleGeometry(.5/Math.cos(Math.PI/12),12),ep=eg.attributes.position,eu=eg.attributes.uv;for(let i=0;i<ep.count;i++){const y=ep.getY(i)*.82;ep.setY(i,y);eu.setXY(i,ep.getX(i)+.5,y+.5);}pg.copy(eg);}pg.instanceCount=PN;
 {const a=new Float32Array(PN*4),b=new Float32Array(PN*4);for(let i=0;i<PN;i++){let ang=rr(0,6.28),r=rr(3.5,34);if(i<PN*.35){ang=rr(.2,2.9);r=rr(7,14);}else if(i<PN*.55){ang=rr(3.6,5.9);r=rr(6,13);}// a ring just outside the roots: the big roots stay visible above the fog (photo)
   let sz=rr(2.6,6)*(r<10?.8:1.15),y=rr(.15,.9)*sz*.32,va=rr(.55,1);
   if(i>=PN-PB){const k=i-(PN-PB);ang=(k+rr(.15,.85))/PB*6.28;r=rr(3.6,7.5);sz=rr(1.3,2.4);y=sz*.18;va=1+rr(.6,1);}// billows: flagged by alpha>1, no orbit, kept even in front of the trunk
   a.set([Math.cos(ang)*r,y,Math.sin(ang)*r-.6,sz],i*4);b.set([rr(0,100),rr(.6,1.4)*(R()<.5?-1:1),va,rr(0,6.28)],i*4);}
  pg.setAttribute('iA',new THREE.InstancedBufferAttribute(a,4));pg.setAttribute('iB',new THREE.InstancedBufferAttribute(b,4));}
 const puffMat=new THREE.ShaderMaterial({defines:FOGDEF,transparent:true,depthWrite:false,fog:false,uniforms:puffU,
  vertexShader:`attribute vec4 iA,iB;uniform float t,wlv,frontK;uniform vec2 wdir;uniform vec3 pond;varying vec2 vUv;varying float vS,vA;varying float vFade;varying vec3 vW;varying float vWy;
   void main(){vUv=uv;vS=iB.x;float bl=step(1.,iB.z);vA=iB.z-bl;
    // slow orbit around the oak plus a lazy wobble
    float ang=(t*.01*iB.y+iB.w)*(1.-bl);float c=cos(ang),s=sin(ang);vec3 cpos=vec3(c*iA.x-s*iA.z,iA.y,s*iA.x+c*iA.z);
    cpos.xz+=wdir*wlv*(1.2+.8*sin(t*.3+iB.x))*(1.-bl*.8);cpos.x+=sin(t*.05+iB.x)*1.2*(1.-bl*.75);cpos.z+=cos(t*.04+iB.x*1.7)*(1.-bl*.75);cpos.y+=sin(t*.07+iB.x)*.15;
    vec4 mv=viewMatrix*vec4(cpos,1.);vW=cpos+vec3(0.,iA.w*.3,0.);float sz=iA.w*(1.+.08*sin(t*.11+iB.x));mv.xy+=position.xy*vec2(sz*1.6,sz);vWy=(inverse(viewMatrix)*mv).y;
    vFade=smoothstep(2.,8.,-mv.z);
    // keep the trunk base and roots clear: puffs between the camera side and the trunk fade out (fog stays around and behind them, as in the photo)
    float front=smoothstep(-2.,3.,cpos.z)*smoothstep(9.,5.,abs(cpos.x))*smoothstep(15.,10.,length(cpos.xz));vFade*=1.-front*frontK*(1.-bl);vFade*=1.-smoothstep(9.,6.,length(cpos.xz))*frontK*.6*(1.-bl);/* Ground: within ~8 m of the trunk the fog lies low in patches (billows), the roots and moss read */vFade*=smoothstep(pond.z+.3,pond.z+2.3,length(cpos.xz-pond.xy)-iA.w*.45);/* the pond stays clear (puff edge 2 m off the water) */vFade=mix(vFade,smoothstep(1.,4.,-mv.z),bl);gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform float t,op,wlv;uniform vec3 col;uniform vec4 lp[6];varying vec2 vUv;varying float vS,vA,vFade;varying vec3 vW;varying float vWy;${FOG_NOISE}${SOFT_GLSL}
   void main(){vec2 p=vUv-.5;float r=length(p*vec2(1.,1.25));
    // swirl: rotate the noise domain by an amount that depends on radius and time, so the clump churns
    float sw=(1.-r)*2.2+t*.05*sign(vS-50.)*(1.+wlv*1.5);float cs=cos(sw),sn=sin(sw);vec2 rp=mat2(cs,-sn,sn,cs)*p;
    float n=fbm(rp*3.+vS)*.65+fbm(rp*6.-t*.03+vS*2.)*.35;
    float a=smoothstep(.5,.05,r)*smoothstep(.25,.7,n+.15)*smoothstep(0.,.25,vUv.y);
    // fog lit by the lamps, the stove and the glowing door: warm light soaks into the nearby mist
    vec3 warm=vec3(0.);for(int i=0;i<6;i++){vec3 d=vW-lp[i].xyz;warm+=lp[i].w/(1.+dot(d,d)*.12);}
    vec3 cc=col*(.85+.35*n+.12*(vUv.y))+vec3(1.,.55,.22)*min(warm,1.)*(.18+.3*n);
    gl_FragColor=vec4(cc,a*op*vA*vFade*(soft>.5?smoothstep(-.35,.3,vWy):smoothstep(-.1,1.1,vWy))*softK(1.4)*(1.+min(warm,1.)*.25));}`});
 const puffs=new THREE.Mesh(pg,puffMat);puffs.frustumCulled=false;puffs.renderOrder=6;scene.add(puffs);

 // ================= mist between the distant trunks =================
 // curved bands of slow noise mist at several depths behind and beside the oak: the forest fades out layer by layer like the painting.
 // Bands face inwards; they thin out near the top and bottom and where they cross the camera side, cost is a few full-screen layers.
 const mistU={tNoise:{value:fogNoise},t:U.t,col:fogU.col,op:{value:.5},drift:windU.drift};
 const mistMat=new THREE.ShaderMaterial({defines:FOGDEF,uniforms:mistU,transparent:true,depthWrite:false,fog:false,side:THREE.DoubleSide,
  vertexShader:`varying vec2 vUv;varying vec3 vW;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float t,op;uniform vec3 col;uniform vec2 drift;varying vec2 vUv;varying vec3 vW;${FOG_NOISE}
   void main(){float ang=atan(vW.z,vW.x);vec2 p=vec2(ang*9.+drift.x*.02,vW.y*.22)+vec2(t*.012,0.);
    float n=fbm(p+vec2(fbm(p*1.7+t*.01),0.)*1.3);float a=smoothstep(.35,.8,n)*smoothstep(0.,.25,vUv.y)*smoothstep(1.,.45,vUv.y)*op;
    gl_FragColor=vec4(col*(.9+.3*n),a);}`});
 const mistBands=[];(MOBILE?[[30,9,.5],[52,12,.6]]:[[24,8,.42],[36,10,.5],[52,13,.6]]).forEach(([rad,h,k])=>{
  const g=new THREE.CylinderGeometry(rad,rad,h,40,1,true,Math.PI*.45,Math.PI*1.1);g.translate(0,h/2-.5,0);
  const m=new THREE.Mesh(g,mistMat.clone());m.material.uniforms=Object.assign({},mistU,{op:{value:.5}});m.renderOrder=3;m.userData.k=k;m.frustumCulled=false;scene.add(m);mistBands.push(m);});
 env.mist=mistBands;

 // ================= fireflies =================
 // a few soft yellow-green lights that wander low between the roots and the forest edge and blink slowly (dusk and night)
 const FF=MOBILE?22:40;const ffU={t:U.t,on:{value:0},px:{value:Math.min(2,window.devicePixelRatio||1)}};
 {const g=new THREE.BufferGeometry();const p=new Float32Array(FF*3),a=new Float32Array(FF*4);
  for(let i=0;i<FF;i++){const ang=rr(0,6.28),r=rr(3.5,20);p.set([Math.cos(ang)*r,rr(.3,2.6),Math.sin(ang)*r*.9],i*3);a.set([rr(0,100),rr(.6,1.6),rr(.8,2.2),rr(.5,1.2)],i*4);}
  g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('aF',new THREE.BufferAttribute(a,4));
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,uniforms:ffU,
   vertexShader:`attribute vec4 aF;uniform float t,on,px;varying float vB;
    void main(){float s=aF.x,sp=aF.y;vec3 p=position+vec3(sin(t*.31*sp+s)*aF.z,sin(t*.47*sp+s*1.3)*.35+sin(t*.13+s)*.25,cos(t*.27*sp+s*.7)*aF.z);
#ifdef WIND
     p.xz+=windSwayS(position,.6)*.35;/* [WIND] fireflies drift with the wind (game/wind.js) */
#endif

     vec4 mv=viewMatrix*vec4(p,1.);float bl=pow(max(0.,sin(t*aF.w*1.3+s*4.)),6.);vB=(.25+.75*bl)*on;
     gl_PointSize=clamp(90./-mv.z,2.,14.)*px*(.6+.4*bl);gl_Position=projectionMatrix*mv;}`,
   fragmentShader:`varying float vB;void main(){vec2 d=gl_PointCoord-.5;float r=length(d);float a=smoothstep(.5,0.,r);a=a*a;
    gl_FragColor=vec4(vec3(1.,.92,.45)*(a+smoothstep(.12,0.,r)),a*vB);}`});
  const pts=new THREE.Points(g,m);pts.frustumCulled=false;pts.renderOrder=7;scene.add(pts);env.fireflies=pts;}

 // ================= lamp halos (glow around lamps; works on phones where bloom is off) =================
 const haloTex=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=128;const x=cv.getContext('2d');const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,220,160,1)');g.addColorStop(.15,'rgba(255,190,110,.55)');g.addColorStop(.45,'rgba(255,150,70,.14)');g.addColorStop(1,'rgba(255,140,60,0)');x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(cv);})();
 const halos=[];env.addHalo=(light,size=1.6)=>{const s=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));s.scale.setScalar(size);scene.add(s);halos.push({s,l:light,size});return s;};

 // ================= colour grading (after tone mapping) =================
 const GRADE_BODY=`float l=dot(x,vec3(.2126,.7152,.0722));
    // warm/cold split like the painting: warm (orange) pixels get extra saturation and glow, cold ones lean to moonlit teal-blue
    float wk=clamp((x.r-x.b)*2.5,0.,1.),ck=clamp((x.b-x.r)*3.,0.,1.);
    x=mix(vec3(l),x,mix(sat,max(sat,satW),wk)+wk*.12*night);/* [LIGHTS] rain greys the cold night (sat), the lamp-lit rooms keep their dry saturation (satW): cosy against the storm */
    // lamp-lit wood toward the photo's golden amber, not red-orange: warm pixels' green is pulled a little toward their red
    // (hue ~20 -> ~30 deg) and the warm glow added on the bright ones is gold
    x.g+=(x.r-x.g)*.14*wk*night;x+=vec3(.045,.035,0.)*wk*hi0(l)*night;x=mix(x,x*vec3(.9,.98,1.2),ck*.4*night);x=mix(x,vec3(l)*vec3(.92,1.,1.1),ck*.25*night);x*=1.+.14*ck*night*(1.-smoothstep(.3,.7,l));/* the photo's night blues are lighter: lift the cold mid/darks, not the warm rooms *//* cold darks less saturated (the photo's night blues are muted, not deep teal) */
    // night greens (oak leaves, grass, moss) muted toward the photo's dark blue-teal instead of bright leaf green
    float gk=clamp((x.g-max(x.r,x.b))*4.,0.,1.);x=mix(x,vec3(l)*vec3(.8,1.02,1.12),gk*.3*night);
    // autumn daylight: leaf greens lean a little to yellow-olive (night keeps the blue-teal above)
    x.r+=(x.g-x.r)*.24*gk*(1.-night);x.b*=1.-.15*gk*(1.-night);
    x=(x-.5)*con+.5;
    // split toning: cold teal shadows, warm highlights (lamp light pops against the blue night)
    float sh=1.-smoothstep(0.,.45,l),hi=smoothstep(.45,1.,l);x+=lift*sh*(.6+.6*night);x=mix(x,x*warm*1.15,hi*.45*night);
    x=mix(x,x*vec3(1.07,1.0,.9)+vec3(.03,.012,.0)*(1.-l),morn*.6);
    vec2 d=vUv-.5;x*=1.-vig*dot(d,d)*2.2;`;
 env.gradePass=new ShaderPass({uniforms:{tDiffuse:{value:null},sat:{value:1.22},satW:{value:1.22},con:{value:1.08},lift:{value:new THREE.Color(0x0c1e36)},warm:{value:new THREE.Color(0xFFE2A8)},vig:{value:.32},night:{value:1},morn:{value:0},gOn:{value:1}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float sat,satW,con,vig,night,morn;uniform vec3 lift,warm;varying vec2 vUv;
   float hi0(float l){return smoothstep(.25,.8,l);}
   void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 x=c.rgb;${GRADE_BODY}gl_FragColor=vec4(clamp(x,0.,1.),c.a);}`});

 // ================= cool night fill =================
 // a soft blue light from the front-left and a rim from behind, no shadows: the bark and leaves pick up the moonlit blue of the reference
 const fill=new THREE.DirectionalLight(0x86AEDC,0);fill.position.set(-8,14,26);const sky=new THREE.HemisphereLight(0x9CC2E0,0x35584E,0);if(!MOBILE){scene.add(sky);scene.add(fill);}
 const rim=new THREE.DirectionalLight(0x86C2F0,0);
 // moon rim for materials that want a fresnel edge (bark, leaves, roofs): colour*strength, updated every frame; direction = towards the moon rim light
 env.moonRim={color:{value:new THREE.Color(0x86C2F0)},strength:{value:0},dir:{value:V(-20,15,4).normalize()}};rim.position.set(-20,15,4);if(!MOBILE)scene.add(rim);

 // ================= per-frame =================
 const tmp=new THREE.Color(),tmpV=V();
 // the depth pre-pass draws everything with one plain material, so leaf/grass cards would become solid rectangles in it:
 // leave out alpha-tested and transparent objects (list refreshed now and then, other threads add objects after load)
 let cutList=[],cutAge=1e9;const isCut=o=>{const m=o.material;if(!m||o===puffs)return false;const ms=Array.isArray(m)?m:[m];return ms.some(x=>x.alphaTest>0||x.transparent||x.isSpriteMaterial||x.isPointsMaterial||x.isLineBasicMaterial);};
 const fogObjs=()=>{if(cutAge++>120){cutAge=0;cutList=[];scene.traverse(o=>{if((o.isMesh||o.isPoints||o.isLine||o.isSprite)&&isCut(o))cutList.push(o);});}return [...sheets,puffs,env.backdrop,...(env.mist||[]),...cutList];};let frameN=0;const dbs=new THREE.Vector2();
 const wTmpC=new THREE.Color(),wTmpD=new THREE.Color(); let lastT=null;const wTmp=V();const dawnC=new THREE.Color(0xF0BFA0),rainC=new THREE.Color(0x8E9EA8);
 env.update=(s)=>{const {T,P,nightK,mornK,rainK,lampOn,camera,hour}=s;{const pd=window.__ground&&window.__ground.pond;if(pd)pondU.pond.value.set(pd.x,pd.z,pd.r||pd.radius||1.5);}const moonIll=s.moonIll===undefined?1:s.moonIll;
  {const W=window.__wind;const dt=lastT===null?0:Math.min(.1,Math.max(0,T-lastT));lastT=T;
   if(W&&W.sample){const w=W.sample(wTmp.set(0,1,0))||{};const x=w.x||0,z=w.z||0,sp=w.s!==undefined?w.s:Math.hypot(x,z);const L=Math.hypot(x,z)||1;
    windU.wdir.value.set(x/L,z/L);windU.wlv.value=Math.min(1.5,sp);windU.drift.value.x+=x*dt*1.6;windU.drift.value.y+=z*dt*1.6;}}
  /* the shared half-res fog pass (game/fogpass.js) feeds softK its own depth: skip ours then. Its depth is the full scene,
     grass and leaf cards included (ours leaves them out), so the soft range shrinks there or the low puffs fade away in the grass */
  {const fp=!!(window.__fogpass&&window.__fogpass.enabled);softU.soft.value=(fp||(SOFT&&qLevel<2))?1:0;softU.softS.value=fp?.22:1;}
  if(SOFT&&softU.soft.value>.5&&!(window.__fogpass&&window.__fogpass.enabled)&&(frameN++&1)===0){renderer.getDrawingBufferSize(dbs);const w=Math.max(4,dbs.x>>1),h=Math.max(4,dbs.y>>1);
   if(depthRT.width!==w||depthRT.height!==h)depthRT.setSize(w,h);softU.uRes.value.copy(dbs);softU.cNear.value=camera.near;softU.cFar.value=camera.far;
   const hid=fogObjs().filter(o=>o&&o.visible);hid.forEach(o=>o.visible=false);const ov=scene.overrideMaterial,bg=scene.background,prev=renderer.getRenderTarget();
   const su=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;scene.overrideMaterial=depthMat;scene.background=null;renderer.setRenderTarget(depthRT);renderer.clear(false,true,false);renderer.render(scene,camera);
   renderer.setRenderTarget(prev);renderer.shadowMap.autoUpdate=su;scene.overrideMaterial=ov;scene.background=bg;hid.forEach(o=>o.visible=true);}U.t.value=T;/* U.wind is driven by game/wind.js now */
  const fc=tmp.copy(P.fog);
  fogU.col.value.copy(fc).lerp(new THREE.Color(0x80B6D6),(.2+nightK*.24)*(1-mornK)).lerp(dawnC,mornK*.45);const dusk=hour===undefined?0:smooth(17.3,19.5,hour)*(hour<23?1:0);const eve=Math.max(nightK,lampOn||0,dusk);const dens=.15+eve*.85+mornK*.3+rainK*.25;fogU.cam.value.copy(camera.position);
  for(const m of sheets){m.material.uniforms.op.value=.22*dens*m.userData.k;m.material.uniforms.cam.value.copy(camera.position);m.material.uniforms.col.value.copy(fogU.col.value);m.material.uniforms.t.value=T;}
  puffU.op.value=.38*dens;for(const m of mistBands)m.material.uniforms.op.value=m.userData.k*(.25+.75*Math.min(1,dens));
  {const L=halos.filter(h=>h.l.intensity>.05).map(h=>{h.l.getWorldPosition(tmpV);return [tmpV.x,tmpV.y,tmpV.z,Math.min(1,h.l.intensity/5)*h.size/1.6];}).sort((a,b)=>a[1]-b[1]);
   for(let i=0;i<6;i++){const v=puffU.lp.value[i];const l=L[i];if(l)v.set(l[0],l[1],l[2],l[3]*.9);else v.set(0,-99,0,0);}}
  bgU.fogc.value.copy(P.fog);bgU.hor.value.copy(P.hor);bgU.night.value=eve;
  {const dark=wTmpD.setRGB(.13,.2,.2).lerp(wTmpC.copy(P.fog).multiplyScalar(.3),eve);for(const m of farRings){const u=m.material.uniforms;u.col.value.copy(dark).lerp(P.fog,u.k.value*.35);u.haze.value.copy(P.fog).lerp(P.hor,.08);/* [ENV] nearly the scene fog: the ring bottoms no longer glow white by day */}}
  for(const h of halos){const on=h.l.intensity>.05;h.s.visible=on;if(on){h.l.getWorldPosition(h.s.position);const k=Math.min(1,h.l.intensity/6);h.s.material.opacity=k*.85;h.s.scale.setScalar(h.size*(.85+k*.3));}}
  env.shroomGlow.value=eve*1.8;
  // dusk: thicken the distance fog once the lamps are on (the painting's 19:20 look); index.html sets near/far each frame before this
  if(scene.fog&&scene.fog.isFog&&mornK>0){const f=scene.fog;f.color.lerp(dawnC,mornK*.3);f.far+=mornK*24;f.near+=mornK*6;}
  if(scene.fog&&scene.fog.isFog){const f=scene.fog;f.far=Math.max(f.near+34,f.far-eve*(1-nightK)*26);}
  {const ml=(.3+.7*moonIll)*(1-rainK*.8);/* moonlit share: a bright moon on a clear night gives the cool rim, overcast or a thin moon hardly any */
  fill.intensity=eve*1.25*(1-rainK*.4)*(.6+.4*ml);sky.intensity=eve*.55;rim.intensity=eve*3.2*ml;env.moonRim.strength.value=eve*(1-rainK*.5)*(.25+.75*ml);env.moonLight=ml;}
  // rain: wetness lags the rain, forest bark goes dark and glossy, fog turns grey-blue and thick, colours go muted
  {const W=window.__wind;if(W&&W.wet)env.wet.value=W.wet();/* one wetness for everyone: Wind's (soaks in ~8 s, dries over ~2 min, real time) */else{const w=env.wet.value;env.wet.value=rainK>w?Math.min(rainK,w+.006):Math.max(rainK,w-.0008);}}
  const wt=env.wet.value;barkMat.roughness=1-wt*.55;barkMat.color.setRGB(.6*(1-wt*.35),.55*(1-wt*.35),.5*(1-wt*.3));
  if(rainK>0){fogU.col.value.lerp(rainC,rainK*.7);for(const m of mistBands)m.material.uniforms.op.value*=1+rainK*.6;}
  ffU.on.value=eve*(1-rainK);if(env.fireflies)env.fireflies.visible=ffU.on.value>.01;/* by day the points are fully transparent: don't draw them */const g=env.gradePass.uniforms;g.night.value=eve;g.morn.value=mornK*(1-rainK);g.sat.value=(1.2+eve*.08)*(1-rainK*.3);g.satW.value=1.2+eve*.08;g.con.value=1.08+eve*.05-rainK*.06;/* rain: greyer, flatter, like looking through wet air */
  warmBounce(eve,rainK,nightK);
  if(env.interiorOn){inProbe.sh.coefficients[0].x=eve*env.interiorK;}/* .y = warm tint inside, set by lights.js */
  if(MOBILE){phoneNight(eve,rainK);foldLights();}else litForest();
  if(env.forestHaze&&scene.fog){env.forestHaze.hz.value.copy(scene.fog.color);env.forestHaze.hzK.value=.38+.25*rainK;}if(scene.fog){trunkHz.hz.value.copy(scene.fog.color);trunkHz.hzK.value=.5+.25*rainK;}};
 // phone night look (reference photo): the half-res fog pass and the smaller layer set leave the phone darker and thinner than
 // the painting, so at night the phone gets a denser pale-blue ground fog, a hazier far forest, brighter moonlit bark with a
 // stronger blue rim and a cooler lift in the shadows. Uniform tweaks only: no extra draw calls or passes.
 const PH={foldF:.75,foldR:.5,leafK:1,trunk:.3,front:.8,puff:2.2,sheet:1.8,mist:2.4,fill:1.7,rim:1.6,moonRim:1.8,haze:.8,lift:new THREE.Color(0x122c52)};env.phoneNightK=PH;
 const liftBase=env.gradePass.uniforms.lift.value.clone(),liftTmp=new THREE.Color();
 function phoneNight(eve,rainK){const k=eve;PH.cur=k;const f=x=>1+(x-1)*k;
  puffU.op.value*=f(PH.puff);for(const m of sheets)m.material.uniforms.op.value*=f(PH.sheet);for(const m of mistBands)m.material.uniforms.op.value*=f(PH.mist);
  fill.intensity*=f(PH.fill);rim.intensity*=f(PH.rim);env.moonRim.strength.value*=f(PH.moonRim);
  bgU.bgHaze.value=.3+(PH.haze-.3)*k;fogU.trunkK.value=.45+(PH.trunk-.45)*k;puffU.frontK.value=.7+(PH.front-.7)*k;env.gradePass.uniforms.lift.value.copy(liftBase).lerp(liftTmp.copy(PH.lift),k*(1-rainK*.5));}
 // dusk/night bark: the photo's oak is warm brown in the evening, lit by the house. The light that comes up from below (the
 // hemisphere's ground colour) is pushed towards the amber of the lamps bouncing off the landings and roots, so the trunk's
 // sides and the undersides of the branches pick it up while tops stay moonlit blue. Light only: the bark texture and its
 // roughness are untouched.
 env.duskWarm={col:new THREE.Color(0xB06C3A),k:.8,amb:.4};
 // for the oak's bark shader (Tree): warm house light bouncing onto the trunk near the rooms. Suggested use in the bark material:
 //   outgoingLight += diffuseColor.rgb * barkWarm.color * barkWarm.strength * (near the house: y 2..11, front of the trunk)
 env.barkWarm={color:{value:new THREE.Color(0xFF9A50)},strength:{value:0}};let WH=null,WA=null;const wTmp2=new THREE.Color();
 function warmBounce(eve,rainK,nightK){if(!WH){scene.traverse(o=>{if(o.isHemisphereLight&&o!==sky&&!WH)WH=o;else if(o.isAmbientLight&&!WA)WA=o;});if(!WH)return;}
  if(WA)WA.color.set(0xFFE6C8);/* index sets the ambient's intensity each frame, not its colour: start from its own colour */
  env.barkWarm.strength.value=eve*(1-rainK*.4)*.35;
  const k=eve*env.duskWarm.k*(1-rainK*.5);if(k<=0)return;WH.groundColor.lerp(env.duskWarm.col,k);
  if(WA){WA.color.lerp(wTmp2.copy(env.duskWarm.col),k*.5);WA.intensity+=eve*env.duskWarm.amb*(1-rainK*.5);}}
 // phones: the two non-shadow directional lights (fill, rim) and the second hemisphere (sky) are not in the scene, so every lit
 // shader has fewer lights to loop over. Their light is folded into index's hemisphere and ambient each frame instead
 // (directional -> ambient at about the average cosine it gives over all normals), and the forest canopy (unlit on phones)
 // gets the colour these lights would give it.
 let LH=null,LA=null,LS=null;const ambBase=new THREE.Color(0xFFE6C8),cA=new THREE.Color(),cB=new THREE.Color(),cC=new THREE.Color();
 function foldLights(){if(!LH){scene.traverse(o=>{if(o.isHemisphereLight&&o!==sky&&!LH)LH=o;else if(o.isAmbientLight&&!LA)LA=o;else if(o.isDirectionalLight&&o.castShadow&&!LS)LS=o;});if(!LH||!LA)return;}
  const hi=LH.intensity,si=sky.intensity,ht=hi+si;
  if(si>0&&ht>0){LH.color.multiplyScalar(hi/ht).add(cA.copy(sky.color).multiplyScalar(si/ht));LH.groundColor.multiplyScalar(hi/ht).add(cA.copy(sky.groundColor).multiplyScalar(si/ht));LH.intensity=ht;}
  const ai=LA.intensity,fi=fill.intensity*PH.foldF,ri=rim.intensity*PH.foldR,at=ai+fi+ri;
  if(at>0){LA.color.multiplyScalar(ai/at).add(cA.copy(fill.color).multiplyScalar(fi/at)).add(cB.copy(rim.color).multiplyScalar(ri/at));}LA.intensity=at;
  // the folded moon fill is strong on phones (ambient ~2.3) and turned every neutral surface (slate, grey wood, stone) sky-blue:
  // keep its brightness but take a third of the colour out, and a fifth out of the sky hemisphere (moonlight is pale, not blue)
  {const nk=PH.cur||0;const ds=(c,k)=>{const l=c.r*.2126+c.g*.7152+c.b*.0722;c.r+=(l-c.r)*k;c.g+=(l-c.g)*k;c.b+=(l-c.b)*k;};ds(LA.color,.35*nk);ds(LH.color,.2*nk);}
  if(env.canopy){const c=env.canopy.material.color;// what a lit card gets on average (Lambert: albedo/pi x irradiance)
   cA.copy(LH.groundColor).lerp(LH.color,.6).multiplyScalar(LH.intensity);cA.add(cB.copy(LA.color).multiplyScalar(LA.intensity));
   if(LS)cA.add(cC.copy(LS.color).multiplyScalar(LS.intensity*.3));c.copy(cA).multiplyScalar(PH.leafK/Math.PI);}}
 // ---- interior night ambient (Lights: with every lamp off the bedroom on phones stayed ~75% as bright as lit, so the cosy dark
 // and the bunk shadow could not read). The ambient + hemisphere fill is cut to ~25% inside the room boxes at night; the moonlit
 // outside keeps it. No new uniform in every material: a LightProbe carries the strength (lightProbe[0].x) and its own
 // irradiance term is dropped, so the probe is a pure parameter. The mask uses the world position from the fog chunk (vFogW).
 const inProbe=new THREE.LightProbe();inProbe.name='envInteriorK';
 env.setInterior=rooms=>{const box=rooms.map(r=>`k=max(k,ib(p,vec3(${r[0].toFixed(3)},${r[2].toFixed(3)},${r[4].toFixed(3)}),vec3(${r[1].toFixed(3)},${r[3].toFixed(3)},${r[5].toFixed(3)})));`).join('');
  const c=THREE.ShaderChunk;c.lights_fragment_begin=c.lights_fragment_begin.replace('irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );','')
   .replace(/(#if \( NUM_HEMI_LIGHTS > 0 \)[\s\S]*?#pragma unroll_loop_end\s*#endif)/,'$1\n#if defined( USE_LIGHT_PROBES ) && defined( USE_FOG )\n{vec3 p=vFogW;float k=0.;'+box+'irradiance*=1.-k*lightProbe[0].x;/* [LIGHTS] inside, the moon-blue fill turns warm (no brighter on screen: warm reads brighter after the grade, so it is scaled down): lightProbe[0].y = how much */irradiance=mix(irradiance,vec3(dot(irradiance,vec3(.3,.59,.11)))*vec3(.66,.5,.37),k*lightProbe[0].y);}\n#endif');
  c.lights_pars_begin=c.lights_pars_begin+'\nfloat ib(vec3 p,vec3 a,vec3 b){vec3 d=min(p-a,b-p);return smoothstep(-.13,-.06,min(d.x,min(d.y,d.z)));}';
  scene.add(inProbe);env.interiorOn=true;};env.interiorK=.75;/* share of the fill cut inside at full night (Lights: ~25% left) */
 // desktop: the forest impostors are unlit too; give them what a lit leaf card would get from the scene's lights (same as foldLights)
 function litForest(){if(!env.canopy||!env.canopy.material.isMeshBasicMaterial)return;if(!LH){scene.traverse(o=>{if(o.isHemisphereLight&&o!==sky&&!LH)LH=o;else if(o.isAmbientLight&&!LA)LA=o;else if(o.isDirectionalLight&&o.castShadow&&!LS)LS=o;});if(!LH||!LA)return;}
  const c=env.canopy.material.color;cA.copy(LH.groundColor).lerp(LH.color,.6).multiplyScalar(LH.intensity);cA.add(cB.copy(sky.groundColor).lerp(sky.color,.6).multiplyScalar(sky.intensity));
  cA.add(cB.copy(LA.color).multiplyScalar(LA.intensity)).add(cB.copy(fill.color).multiplyScalar(fill.intensity*.5)).add(cB.copy(rim.color).multiplyScalar(rim.intensity*.3));
  if(LS)cA.add(cC.copy(LS.color).multiplyScalar(LS.intensity*.3));c.copy(cA).multiplyScalar(1/Math.PI);}
 // the grade folded into three's OutputPass (one full-screen pass less): same uniforms, run right after tone mapping + sRGB
 env.foldGrade=op=>{const gu=env.gradePass.uniforms;for(const k of ['sat','satW','con','lift','warm','vig','night','morn','gOn'])op.uniforms[k]=gu[k];
  op.uniforms.tFog={value:null};op.uniforms.fogOn={value:0};env.outU=op.uniforms;
  let fs=op.material.fragmentShader;fs=fs.replace(/gl_FragColor\s*=\s*texture2D\(\s*tDiffuse\s*,\s*vUv\s*\);/,'gl_FragColor=texture2D(tDiffuse,vUv);if(fogOn>.5){vec4 fg=texture2D(tFog,vUv);gl_FragColor.rgb=fg.rgb+gl_FragColor.rgb*(1.-fg.a);}/* half-res fog (premultiplied), merged here on phones */');
  fs=fs.replace('uniform sampler2D tDiffuse;','uniform sampler2D tDiffuse,tFog;uniform float fogOn,sat,satW,con,vig,night,morn,gOn;uniform vec3 lift,warm;float hi0(float l){return smoothstep(.25,.8,l);}');
  const e=fs.lastIndexOf('}');fs=fs.slice(0,e)+'if(gOn>.5){vec3 x=gl_FragColor.rgb;'+GRADE_BODY+'x+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;/* dither after the 8-bit grade: no banding in the sky and fog gradients */gl_FragColor.rgb=clamp(x,0.,1.);}\n}';op.material.fragmentShader=fs;op.material.needsUpdate=true;env.gradeFolded=true;};
 env.noiseTex=fogNoise;for(const m of farRings)m.material.uniforms.tNoise.value=fogNoise;/* the baked 128px tiling noise (R,G), also used by the sky clouds in index.html */
 env.sheets=sheets;env.puffs=puffs;window.__env=env;
 // called by index.html when FPS stays under 40 after pixel ratio is already at 1: fewer fog puffs, then no soft edges, then one fog sheet
 let qLevel=0;env.degrade=()=>{qLevel++;if(qLevel===1)pg.instanceCount=Math.round(PN*.6);else if(qLevel===2)softU.soft.value=0;else if(qLevel===3){sheets.slice(1).forEach(m=>m.visible=false);pg.instanceCount=Math.round(PN*.4);}return qLevel<=3;};
 return env;
}
