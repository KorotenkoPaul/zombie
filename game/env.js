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
 float clear=mix(.5,1.,smoothstep(5.,13.,length(vFogW.xz)));float tau=(.012+.085*hk)*(.45+1.1*n)*od*min(d,60.)*clear;
 float hf=1.-exp(-tau);
 // aerial haze: the forest behind the oak dissolves into blue mist at dusk/night, as in the painting
 fogFactor=max(fogFactor,smoothstep(hz0,hz0+50.,d)*.6*hk);
 fogFactor=fogFactor+hf*(1.-fogFactor);
 vec3 haze=mix(fogColor,vec3(dot(fogColor,vec3(.33)))*1.5+vec3(.05,.09,.11),.45);gl_FragColor.rgb=mix(gl_FragColor.rgb,mix(fogColor,haze,hf),fogFactor);}
#endif`;

 const R=rng(20261123);const rr=(a,b)=>a+R()*(b-a);
 const U={t:{value:0},wind:{value:1}};
 const env={U};

 // ground, grass, rocks, ferns, mushrooms and bushes moved to ground.js (ground & vegetation thread).
 // the mushroom glow uniform stays here: update() drives it, ground.js reads it.
 env.shroomGlow={value:0};

 // ================= forest =================
 // trunk + roots + a few big branches as one geometry per variant; canopies are leaf-cluster cards like the oak
 const barkMat=(()=>{const t=barkT.clone();t.needsUpdate=true;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,3);return new THREE.MeshStandardMaterial({map:t,roughness:1,color:0x9A8C80});})();
 function tube(a,b,r0,r1,seg){const d=b.clone().sub(a);const L=d.length();const g=new THREE.CylinderGeometry(r1,r0,L,seg,Math.max(2,Math.round(L/1.5)),true);g.translate(0,L/2,0);
  const p=g.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i)/L;const w=1+Math.sin(y*9+p.getX(i)*3)*.06;p.setX(i,p.getX(i)*w);p.setZ(i,p.getZ(i)*w);}
  const q=new THREE.Quaternion().setFromUnitVectors(V(0,1,0),d.normalize());g.applyQuaternion(q);g.translate(a.x,a.y,a.z);return g;}
 const tips=[];
 function treeVariant(seed){const r=rng(seed);const H=14+r()*6,R0=.55+r()*.35;const parts=[];const ends=[];
  // trunk with a slight lean
  const lean=V((r()-.5)*1.2,H,(r()-.5)*1.2);parts.push(tube(V(0,-.3,0),lean,R0,R0*.35,10));
  // root flare: short thick tubes bending into the ground
  for(let i=0;i<5;i++){const a=i/5*6.28+r()*.6;parts.push(tube(V(0,1.3,0),V(Math.cos(a)*R0*3.2,-.25,Math.sin(a)*R0*3.2),R0*.75,R0*.25,6));}
  // big branches
  const nb=4+Math.floor(r()*3);for(let i=0;i<nb;i++){const y=H*(.42+r()*.45),a=r()*6.28,L=3+r()*4;const o=lean.clone().multiplyScalar(y/H);
   const e=o.clone().add(V(Math.cos(a)*L,L*(.35+r()*.5),Math.sin(a)*L));parts.push(tube(o,e,R0*.42*(1.1-y/H),R0*.12,6));ends.push(e);}
  ends.push(lean.clone().add(V(0,1,0)));
  const g=mergeGeometries(parts.map(p=>p.toNonIndexed()));g.computeVertexNormals();return {g,ends,H};}
 const variants=[treeVariant(7),treeVariant(19),treeVariant(42),treeVariant(77)];
 // positions: a ring of forest behind and to the sides, leaving the front of the house and the zombie paths open
 const spots=[];{let guard=0;const NT=MOBILE?18:28;while(spots.length<NT&&guard++<4000){const x=rr(-58,58),z=rr(-62,10);const r=Math.hypot(x,z);
   if(r<14)continue;if(z>-8&&Math.abs(x)<15)continue;if(z>-2&&Math.abs(x)<22)continue;if(spots.some(s=>Math.hypot(s.x-x,s.z-z)<7.5))continue;spots.push({x,z,v:Math.floor(R()*4),ry:rr(0,6.28),s:rr(.85,1.25)});}}
 {const byV=[[],[],[],[]];spots.forEach(s=>byV[s.v].push(s));const m=new THREE.Matrix4(),q=new THREE.Quaternion();
  byV.forEach((list,vi)=>{if(!list.length)return;const im=new THREE.InstancedMesh(variants[vi].g,barkMat,list.length);
   list.forEach((s,i)=>{q.setFromAxisAngle(V(0,1,0),s.ry);m.compose(V(s.x,groundH(s.x,s.z),s.z),q,V(s.s,s.s,s.s));im.setMatrixAt(i,m);
    for(const e of variants[vi].ends){const w=e.clone().multiplyScalar(s.s).applyQuaternion(q).add(V(s.x,groundH(s.x,s.z),s.z));tips.push({p:w,s:s.s,d:Math.hypot(s.x,s.z)});}});
   im.castShadow=!MOBILE;im.receiveShadow=true;scene.add(im);});}
 // canopy cards
 {const lt=leafT;const mat=new THREE.MeshStandardMaterial({map:lt,alphaTest:.5,side:THREE.DoubleSide,roughness:.85});
  const per=MOBILE?26:40;const N=tips.length*per;const im=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),mat,N);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),c=new THREE.Color();let n=0;
  for(const t of tips){for(let k=0;k<per;k++){const d=V(rr(-1,1),rr(-.5,.8),rr(-1,1)).normalize().multiplyScalar(Math.pow(R(),.5)*3.4*t.s);const p=t.p.clone().add(d);
    q.setFromEuler(new THREE.Euler(rr(-1.2,1.2),rr(0,6.28),rr(-1.2,1.2)));const sz=rr(1.6,2.6)*t.s;m.compose(p,q,V(sz,sz,sz));im.setMatrixAt(n,m);
    // deeper in the forest the leaves turn bluer and darker, like the painted reference
    const far=smooth(16,60,t.d);c.setRGB(.78-far*.25,.88-far*.25,.82-far*.1);im.setColorAt(n,c);n++;}}
  im.count=n;im.castShadow=!MOBILE;scene.add(im);env.canopy=im;}

 // far forest: a painted backdrop (Fal, from the reference: gnarled oak silhouettes in blue fog) on a cylinder around the scene.
 // Mirrored-repeat so there is no seam; at night the painting shows as is, by day it is re-tinted with the fog colour.
 const bgU={map:{value:null},dmap:{value:null},fogc:{value:new THREE.Color()},hor:{value:new THREE.Color()},night:{value:1},ok:{value:0}};
 new THREE.TextureLoader().load(new URL('forest-bg.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.MirroredRepeatWrapping;t.anisotropy=4;bgU.map.value=t;bgU.ok.value=1;if(!bgU.dmap.value)bgU.dmap.value=t;});
 new THREE.TextureLoader().load(new URL('forest-bg-day.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.MirroredRepeatWrapping;t.anisotropy=4;bgU.dmap.value=t;});
 {const RAD=96,H=64,Y0=-3;const g=new THREE.CylinderGeometry(RAD,RAD,H,64,1,true);g.translate(0,H/2+Y0,0);
  const mat=new THREE.ShaderMaterial({uniforms:bgU,side:THREE.BackSide,transparent:true,depthWrite:false,fog:false,
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`uniform sampler2D map,dmap;uniform vec3 fogc,hor;uniform float night,ok;varying vec2 vUv;
    void main(){vec2 uv=vec2(vUv.x*5.,vUv.y);vec3 c=texture2D(map,uv).rgb;c=mix(c,fogc*1.1,.3*(1.-vUv.y*.6));
     // day: the daytime painting of the same forest, nudged toward the current sky/fog colour (sunrise/sunset tint)
     vec3 dc=texture2D(dmap,uv).rgb;vec3 day=dc*mix(vec3(1.),mix(fogc,hor,.5)/max(dot(mix(fogc,hor,.5),vec3(.33)),.05),.3);day=mix(day,fogc,.18*(1.-vUv.y*.6));
     vec3 nt=c*.82;
     vec3 o=mix(day,nt,night);
     // bottom of the painting melts into the scene fog, so the far ground edge doesn't draw a straight line against it
     vec3 hz=mix(fogc,vec3(dot(fogc,vec3(.33)))*1.5+vec3(.05,.09,.11),.3);o=mix(o,hz,smoothstep(.34,.08,vUv.y));float a=smoothstep(1.,.86,vUv.y)*ok;
     gl_FragColor=vec4(o,a);
     #include <colorspace_fragment>
    }`});
  const mesh=new THREE.Mesh(g,mat);mesh.renderOrder=-1;mesh.frustumCulled=false;scene.add(mesh);env.backdrop=mesh;}

 // ================= rolling ground fog =================
 // (1) horizontal sheets of domain-warped noise just above the ground
 // soft edges (desktop): a half-resolution depth pre-pass of the opaque scene lets the fog fade where it meets the trunk, roots and house
 // instead of cutting them with a hard line. Phones skip it (SOFT 0) to save a scene pass.
 const SOFT=!MOBILE&&!!renderer;
 const softU={tDepth:{value:null},uRes:{value:new THREE.Vector2(1,1)},cNear:{value:.1},cFar:{value:500},soft:{value:SOFT?1:0}};
 const SOFT_GLSL=`
#include <packing>
uniform sampler2D tDepth;uniform vec2 uRes;uniform float cNear,cFar,soft;
float softK(float range){if(soft<.5)return 1.;float sd=texture2D(tDepth,gl_FragCoord.xy/uRes).x;
 float sz=-perspectiveDepthToViewZ(sd,cNear,cFar);float fz=-perspectiveDepthToViewZ(gl_FragCoord.z,cNear,cFar);return clamp((sz-fz)/range,0.,1.);}`;
 let depthRT=null;const depthMat=new THREE.MeshBasicMaterial({colorWrite:false});
 if(SOFT){depthRT=new THREE.WebGLRenderTarget(4,4,{depthBuffer:true});depthRT.depthTexture=new THREE.DepthTexture(4,4);depthRT.depthTexture.type=THREE.UnsignedIntType;softU.tDepth.value=depthRT.depthTexture;}
 // wind (wind.js, window.__wind): fog noise drifts downwind and puffs lean/churn with the gusts
 const windU={drift:{value:new THREE.Vector2()},wdir:{value:new THREE.Vector2(1,0)},wlv:{value:0}};
 const fogU={t:U.t,col:{value:new THREE.Color(0x8FB8CC)},op:{value:.5},cam:{value:V()},...softU,...windU};
 const FOGDEF=MOBILE?{FBM_OCT:3}:{};// phones: one octave less in the fog noise (the sheets run it 5x per pixel)
 const sheetMat=new THREE.ShaderMaterial({defines:FOGDEF,transparent:true,depthWrite:false,fog:false,uniforms:fogU,
  vertexShader:`varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float t,op;uniform vec3 col,cam;uniform vec2 drift;varying vec3 vW;${GLSL_NOISE}${SOFT_GLSL}
   void main(){vec2 p=(vW.xz-drift)*.075+vec2(vW.y*1.7,0.);vec2 q=vec2(fbm(p+vec2(t*.018,t*.007)),fbm(p+vec2(5.2,1.3)-vec2(t*.013,0.)));
    vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*.021),fbm(p+3.*q+vec2(8.3,2.8)-t*.016));float d=fbm(p+3.4*r);
    float dist=length(vW.xz-cam.xz);float edge=smoothstep(95.,55.,length(vW.xz))*smoothstep(3.,9.,dist)*mix(.45,1.,smoothstep(4.,12.,length(vW.xz)));
    float graze=smoothstep(.04,.45,abs(normalize(cam-vW).y));float a=smoothstep(.3,.85,d)*op*edge*graze*softK(.6);gl_FragColor=vec4(col*(.82+.4*d),a);}`});
 const sheets=[];(MOBILE?[[.3,1.1],[.9,.85]]:[[.25,1],[.7,.8],[1.3,.6]]).forEach(([y,k])=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(200,200).rotateX(-Math.PI/2),sheetMat.clone());m.material.uniforms=Object.assign({},fogU,{op:{value:.5}});m.position.y=y;m.renderOrder=4;m.userData.k=k;scene.add(m);sheets.push(m);});
 // (2) rolling puffs: camera-facing soft clouds that churn in place and drift around the tree
 const PN=MOBILE?46:80;const puffU={t:U.t,col:fogU.col,op:{value:.5},night:{value:1},...softU,...windU,lp:{value:Array.from({length:6},()=>new THREE.Vector4())}};
 const pg=new THREE.InstancedBufferGeometry();pg.copy(new THREE.PlaneGeometry(1,1));pg.instanceCount=PN;
 {const a=new Float32Array(PN*4),b=new Float32Array(PN*4);for(let i=0;i<PN;i++){let ang=rr(0,6.28),r=rr(3.5,34);if(i<PN*.35){ang=rr(.2,2.9);r=rr(7,14);}else if(i<PN*.55){ang=rr(3.6,5.9);r=rr(6,13);}// a ring just outside the roots: the big roots stay visible above the fog (photo)
   const sz=rr(2.6,6)*(r<10?.8:1.15);a.set([Math.cos(ang)*r,rr(.15,.9)*sz*.32,Math.sin(ang)*r,sz],i*4);b.set([rr(0,100),rr(.6,1.4)*(R()<.5?-1:1),rr(.55,1),rr(0,6.28)],i*4);}
  pg.setAttribute('iA',new THREE.InstancedBufferAttribute(a,4));pg.setAttribute('iB',new THREE.InstancedBufferAttribute(b,4));}
 const puffMat=new THREE.ShaderMaterial({defines:FOGDEF,transparent:true,depthWrite:false,fog:false,uniforms:puffU,
  vertexShader:`attribute vec4 iA,iB;uniform float t,wlv;uniform vec2 wdir;varying vec2 vUv;varying float vS,vA;varying float vFade;varying vec3 vW;varying float vWy;
   void main(){vUv=uv;vS=iB.x;vA=iB.z;
    // slow orbit around the oak plus a lazy wobble
    float ang=t*.01*iB.y+iB.w;float c=cos(ang),s=sin(ang);vec3 cpos=vec3(c*iA.x-s*iA.z,iA.y,s*iA.x+c*iA.z);
    cpos.xz+=wdir*wlv*(1.2+.8*sin(t*.3+iB.x));cpos.x+=sin(t*.05+iB.x)*1.2;cpos.z+=cos(t*.04+iB.x*1.7)*1.;cpos.y+=sin(t*.07+iB.x)*.15;
    vec4 mv=viewMatrix*vec4(cpos,1.);vW=cpos+vec3(0.,iA.w*.3,0.);float sz=iA.w*(1.+.08*sin(t*.11+iB.x));mv.xy+=position.xy*vec2(sz*1.6,sz);vWy=(inverse(viewMatrix)*mv).y;
    vFade=smoothstep(2.,8.,-mv.z);
    // keep the trunk base and roots clear: puffs between the camera side and the trunk fade out (fog stays around and behind them, as in the photo)
    float front=smoothstep(-2.,3.,cpos.z)*smoothstep(9.,5.,abs(cpos.x))*smoothstep(15.,10.,length(cpos.xz));vFade*=1.-front*.35;gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform float t,op,wlv;uniform vec3 col;uniform vec4 lp[6];varying vec2 vUv;varying float vS,vA,vFade;varying vec3 vW;varying float vWy;${GLSL_NOISE}${SOFT_GLSL}
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

 // ================= fireflies =================
 // a few soft yellow-green lights that wander low between the roots and the forest edge and blink slowly (dusk and night)
 const FF=MOBILE?22:40;const ffU={t:U.t,on:{value:0},px:{value:Math.min(2,window.devicePixelRatio||1)}};
 {const g=new THREE.BufferGeometry();const p=new Float32Array(FF*3),a=new Float32Array(FF*4);
  for(let i=0;i<FF;i++){const ang=rr(0,6.28),r=rr(3.5,20);p.set([Math.cos(ang)*r,rr(.3,2.6),Math.sin(ang)*r*.9],i*3);a.set([rr(0,100),rr(.6,1.6),rr(.8,2.2),rr(.5,1.2)],i*4);}
  g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('aF',new THREE.BufferAttribute(a,4));
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,uniforms:ffU,
   vertexShader:`attribute vec4 aF;uniform float t,on,px;varying float vB;
    void main(){float s=aF.x,sp=aF.y;vec3 p=position+vec3(sin(t*.31*sp+s)*aF.z,sin(t*.47*sp+s*1.3)*.35+sin(t*.13+s)*.25,cos(t*.27*sp+s*.7)*aF.z);
     vec4 mv=viewMatrix*vec4(p,1.);float bl=pow(max(0.,sin(t*aF.w*1.3+s*4.)),6.);vB=(.25+.75*bl)*on;
     gl_PointSize=clamp(90./-mv.z,2.,14.)*px*(.6+.4*bl);gl_Position=projectionMatrix*mv;}`,
   fragmentShader:`varying float vB;void main(){vec2 d=gl_PointCoord-.5;float r=length(d);float a=smoothstep(.5,0.,r);a=a*a;
    gl_FragColor=vec4(vec3(1.,.92,.45)*(a+smoothstep(.12,0.,r)),a*vB);}`});
  const pts=new THREE.Points(g,m);pts.frustumCulled=false;pts.renderOrder=7;scene.add(pts);env.fireflies=pts;}

 // ================= lamp halos (glow around lamps; works on phones where bloom is off) =================
 const haloTex=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=128;const x=cv.getContext('2d');const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,220,160,1)');g.addColorStop(.15,'rgba(255,190,110,.55)');g.addColorStop(.45,'rgba(255,150,70,.14)');g.addColorStop(1,'rgba(255,140,60,0)');x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(cv);})();
 const halos=[];env.addHalo=(light,size=1.6)=>{const s=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));s.scale.setScalar(size);scene.add(s);halos.push({s,l:light,size});};

 // ================= colour grading (after tone mapping) =================
 env.gradePass=new ShaderPass({uniforms:{tDiffuse:{value:null},sat:{value:1.22},con:{value:1.08},lift:{value:new THREE.Color(0x0c2232)},warm:{value:new THREE.Color(0xFFD9A0)},vig:{value:.32},night:{value:1}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float sat,con,vig,night;uniform vec3 lift,warm;varying vec2 vUv;
   float hi0(float l){return smoothstep(.25,.8,l);}
   void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 x=c.rgb;float l=dot(x,vec3(.2126,.7152,.0722));
    // warm/cold split like the painting: warm (orange) pixels get extra saturation and glow, cold ones lean to moonlit teal-blue
    float wk=clamp((x.r-x.b)*2.5,0.,1.),ck=clamp((x.b-x.r)*3.,0.,1.);
    x=mix(vec3(l),x,sat+wk*.38*night);x+=vec3(.05,.02,-.02)*wk*hi0(l)*night;x=mix(x,x*vec3(.86,1.02,1.12),ck*.35*night);
    x=(x-.5)*con+.5;
    // split toning: cold teal shadows, warm highlights (lamp light pops against the blue night)
    float sh=1.-smoothstep(0.,.45,l),hi=smoothstep(.45,1.,l);x+=lift*sh*(.6+.6*night);x=mix(x,x*warm*1.15,hi*.45*night);
    vec2 d=vUv-.5;x*=1.-vig*dot(d,d)*2.2;gl_FragColor=vec4(clamp(x,0.,1.),c.a);}`});

 // ================= cool night fill =================
 // a soft blue light from the front-left and a rim from behind, no shadows: the bark and leaves pick up the moonlit blue of the reference
 const fill=new THREE.DirectionalLight(0x86AEDC,0);fill.position.set(-8,14,26);const sky=new THREE.HemisphereLight(0x9CC2E0,0x35584E,0);scene.add(sky);scene.add(fill);
 const rim=new THREE.DirectionalLight(0x86C2F0,0);rim.position.set(-16,10,-10);scene.add(rim);

 // ================= per-frame =================
 const tmp=new THREE.Color(),tmpV=V();
 // the depth pre-pass draws everything with one plain material, so leaf/grass cards would become solid rectangles in it:
 // leave out alpha-tested and transparent objects (list refreshed now and then, other threads add objects after load)
 let cutList=[],cutAge=1e9;const isCut=o=>{const m=o.material;if(!m||o===puffs)return false;const ms=Array.isArray(m)?m:[m];return ms.some(x=>x.alphaTest>0||x.transparent||x.isSpriteMaterial||x.isPointsMaterial||x.isLineBasicMaterial);};
 const fogObjs=()=>{if(cutAge++>120){cutAge=0;cutList=[];scene.traverse(o=>{if((o.isMesh||o.isPoints||o.isLine||o.isSprite)&&isCut(o))cutList.push(o);});}return [...sheets,puffs,env.backdrop,...cutList];};let frameN=0;const dbs=new THREE.Vector2();
 let lastT=null;const wTmp=V();
 env.update=(s)=>{const {T,P,nightK,mornK,rainK,lampOn,camera,hour}=s;
  {const W=window.__wind;const dt=lastT===null?0:Math.min(.1,Math.max(0,T-lastT));lastT=T;
   if(W&&W.sample){const w=W.sample(wTmp.set(0,1,0))||{};const x=w.x||0,z=w.z||0,sp=w.s!==undefined?w.s:Math.hypot(x,z);const L=Math.hypot(x,z)||1;
    windU.wdir.value.set(x/L,z/L);windU.wlv.value=Math.min(1.5,sp);windU.drift.value.x+=x*dt*1.6;windU.drift.value.y+=z*dt*1.6;}}
  if(SOFT&&softU.soft.value>.5&&(frameN++&1)===0){renderer.getDrawingBufferSize(dbs);const w=Math.max(4,dbs.x>>1),h=Math.max(4,dbs.y>>1);
   if(depthRT.width!==w||depthRT.height!==h)depthRT.setSize(w,h);softU.uRes.value.copy(dbs);softU.cNear.value=camera.near;softU.cFar.value=camera.far;
   const hid=fogObjs().filter(o=>o&&o.visible);hid.forEach(o=>o.visible=false);const ov=scene.overrideMaterial,bg=scene.background,prev=renderer.getRenderTarget();
   const su=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;scene.overrideMaterial=depthMat;scene.background=null;renderer.setRenderTarget(depthRT);renderer.clear(false,true,false);renderer.render(scene,camera);
   renderer.setRenderTarget(prev);renderer.shadowMap.autoUpdate=su;scene.overrideMaterial=ov;scene.background=bg;hid.forEach(o=>o.visible=true);}U.t.value=T;/* U.wind is driven by game/wind.js now */
  const fc=tmp.copy(P.fog);
  fogU.col.value.copy(fc).lerp(new THREE.Color(0x8EC2DA),.3+nightK*.3);const dusk=hour===undefined?0:smooth(17.6,19.0,hour)*(hour<23?1:0);const eve=Math.max(nightK,lampOn||0,dusk);const dens=.15+eve*.85+mornK*.5+rainK*.25;fogU.cam.value.copy(camera.position);
  for(const m of sheets){m.material.uniforms.op.value=.22*dens*m.userData.k;m.material.uniforms.cam.value.copy(camera.position);m.material.uniforms.col.value.copy(fogU.col.value);m.material.uniforms.t.value=T;}
  puffU.op.value=.38*dens;
  {const L=halos.filter(h=>h.l.intensity>.05).map(h=>{h.l.getWorldPosition(tmpV);return [tmpV.x,tmpV.y,tmpV.z,Math.min(1,h.l.intensity/5)*h.size/1.6];}).sort((a,b)=>a[1]-b[1]);
   for(let i=0;i<6;i++){const v=puffU.lp.value[i];const l=L[i];if(l)v.set(l[0],l[1],l[2],l[3]*.9);else v.set(0,-99,0,0);}}
  bgU.fogc.value.copy(P.fog);bgU.hor.value.copy(P.hor);bgU.night.value=eve;
  for(const h of halos){const on=h.l.intensity>.05;h.s.visible=on;if(on){h.l.getWorldPosition(h.s.position);const k=Math.min(1,h.l.intensity/6);h.s.material.opacity=k*.85;h.s.scale.setScalar(h.size*(.85+k*.3));}}
  env.shroomGlow.value=eve*1.8;
  // dusk: thicken the distance fog once the lamps are on (the painting's 19:20 look); index.html sets near/far each frame before this
  if(scene.fog&&scene.fog.isFog){const f=scene.fog;f.far=Math.max(f.near+34,f.far-eve*(1-nightK)*26);}
  fill.intensity=eve*1.9*(1-rainK*.4);sky.intensity=eve*.9;rim.intensity=eve*3.2;
  ffU.on.value=eve*(1-rainK);const g=env.gradePass.uniforms;g.night.value=eve;g.sat.value=1.2+eve*.08;g.con.value=1.08+eve*.05;};
 env.sheets=sheets;env.puffs=puffs;window.__env=env;
 // called by index.html when FPS stays under 40 after pixel ratio is already at 1: fewer fog puffs, then no soft edges, then one fog sheet
 let qLevel=0;env.degrade=()=>{qLevel++;if(qLevel===1)pg.instanceCount=Math.round(PN*.6);else if(qLevel===2)softU.soft.value=0;else if(qLevel===3){sheets.slice(1).forEach(m=>m.visible=false);pg.instanceCount=Math.round(PN*.4);}return qLevel<=3;};
 return env;
}
