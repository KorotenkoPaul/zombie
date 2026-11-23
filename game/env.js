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
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,7.7);a*=.5;}return v;}`;

export function createEnv(C){
 const {scene,MOBILE,barkT,groundT,leafT}=C;
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
float fogFactor=1.0-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);float hk=1.;
#else
float fogFactor=smoothstep(fogNear,fogFar,vFogDepth);float hk=smoothstep(78.,36.,fogFar-fogNear);
#endif
{float HH=1.7;float yc=cameraPosition.y,yp=vFogW.y;float d=length(vFogW-cameraPosition);
 float dy=yp-yc;float ec=exp(-max(yc,0.)/HH),ep=exp(-max(yp,-1.)/HH);
 float od=abs(dy)>.01?HH*(ec-ep)/dy:ep;
 float n=hfN(vFogW.xz*.11)*.65+hfN(vFogW.xz*.31+7.)*.35;
 float clear=mix(.2,1.,smoothstep(4.5,11.,length(vFogW.xz)));float tau=(.03+.12*hk)*(.45+1.1*n)*od*min(d,60.)*clear;
 float hf=1.-exp(-tau);
 fogFactor=max(fogFactor,0.)+hf*(1.-fogFactor);
 vec3 haze=mix(fogColor,vec3(dot(fogColor,vec3(.33)))*1.5+vec3(.05,.09,.11),.45);gl_FragColor.rgb=mix(gl_FragColor.rgb,mix(fogColor,haze,hf),fogFactor);}
#endif`;

 const R=rng(20261123);const rr=(a,b)=>a+R()*(b-a);
 const U={t:{value:0},wind:{value:1}};
 const env={U};

 // ================= ground =================
 // big mesh with vertex colours: moss, cold teal in the hollows, trodden earth around the roots
 {const S=MOBILE?110:150;const g=new THREE.PlaneGeometry(260,260,S,S).rotateX(-Math.PI/2);const p=g.attributes.position;const col=new Float32Array(p.count*3);const c=new THREE.Color();
  const moss=new THREE.Color(0x6A9A5E),teal=new THREE.Color(0x45735F),earth=new THREE.Color(0x8A7058),deep=new THREE.Color(0x3A5E5E);
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);p.setY(i,groundH(x,z));const r=Math.hypot(x,z);
   const n=fbm2(x*.08+11,z*.08+3),m=fbm2(x*.3,z*.3);
   c.copy(teal).lerp(moss,smooth(.35,.7,n));c.lerp(earth,smooth(5.5,2.6,r+(m-.5)*2.5)*.75);c.lerp(deep,smooth(30,70,r)*.6);c.multiplyScalar(.85+m*.3);
   col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
  const gt=groundT.clone();gt.needsUpdate=true;gt.repeat.set(1,1);gt.wrapS=gt.wrapT=THREE.RepeatWrapping;
  const mat=new THREE.MeshStandardMaterial({map:gt,vertexColors:true,roughness:1,metalness:0});
  // two texture scales blended by noise: no visible tiling
  mat.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvGW=(modelMatrix*vec4(position,1.)).xz;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vGW;'+GLSL_NOISE)
    .replace('#include <map_fragment>',`vec4 g1=texture2D(map,vGW/4.2);vec4 g2=texture2D(map,vGW/11.3+.37);float bn=fbm(vGW*.09);vec4 gc=mix(g1,g2,smoothstep(.35,.65,bn));
     diffuseColor*=vec4(gc.rgb*1.8,1.);`);};
  const ground=new THREE.Mesh(g,mat);ground.receiveShadow=true;scene.add(ground);env.ground=ground;
  // painted forest floor from the reference (Fal): dark green grass, moss, teal ferns, fallen oak leaves; replaces ground2.jpg once loaded
  new THREE.TextureLoader().load(new URL('ground3.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;mat.map=t;mat.needsUpdate=true;});}

 // ================= grass tufts (cards in a star, swaying) =================
 const grassTex=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=256;const x=cv.getContext('2d');
  for(let i=0;i<34;i++){const bx=128+(Math.random()-.5)*90,lean=(Math.random()-.5)*150,h=120+Math.random()*120,w=5+Math.random()*7;
   const gr=x.createLinearGradient(0,256,0,256-h);gr.addColorStop(0,'#24402F');gr.addColorStop(.55,'#4E7A4A');gr.addColorStop(1,Math.random()<.25?'#9DB36A':'#79A564');x.fillStyle=gr;
   x.beginPath();x.moveTo(bx-w,256);x.quadraticCurveTo(bx+lean*.3-w*.4,256-h*.55,bx+lean,256-h);x.quadraticCurveTo(bx+lean*.3+w*.4,256-h*.55,bx+w,256);x.closePath();x.fill();}
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;})();
 {const parts=[];for(let k=0;k<3;k++){const q=new THREE.PlaneGeometry(1,1,1,2).translate(0,.5,0).rotateY(k*Math.PI/3);parts.push(q);}
  const g=mergeGeometries(parts);const nr=g.attributes.normal;for(let i=0;i<nr.count;i++)nr.setXYZ(i,0,1,0);
  const mat=new THREE.MeshStandardMaterial({map:grassTex,alphaTest:.45,side:THREE.DoubleSide,roughness:1});
  mat.onBeforeCompile=s=>{s.uniforms.uT=U.t;s.uniforms.uW=U.wind;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float uT,uW;')
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    vec3 ip=vec3(instanceMatrix[3][0],0.,instanceMatrix[3][2]);float hk=position.y*position.y;
    transformed.x+=(sin(uT*1.6+ip.x*.6+ip.z*.4)*.7+sin(uT*2.9+ip.z*1.3)*.3)*.12*hk*uW;transformed.z+=sin(uT*1.2+ip.x*.9)*.06*hk*uW;`);};
  const N=MOBILE?700:1300;const im=new THREE.InstancedMesh(g,mat,N);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=V(),c=new THREE.Color();let n=0;
  // clumps: a few seeds, tufts scattered around each
  while(n<N){const a=rr(0,Math.PI*2),r=Math.pow(R(),.7)*42+3.2;const cx=Math.cos(a)*r,cz=Math.sin(a)*r*.85;const cnt=3+Math.floor(R()*7);
   for(let j=0;j<cnt&&n<N;j++){const x=cx+rr(-1.4,1.4),z=cz+rr(-1.4,1.4);if(Math.hypot(x,z*1.1)<2.9)continue;const sz=rr(.35,.8)*(1+smooth(10,40,Math.hypot(x,z))*.6);
    q.setFromAxisAngle(V(0,1,0),rr(0,6.28));s.set(sz*rr(.8,1.3),sz,sz*rr(.8,1.3));m.compose(V(x,groundH(x,z)-.03,z),q,s);im.setMatrixAt(n,m);
    c.setHSL(rr(.27,.4),rr(.25,.45),rr(.42,.62));im.setColorAt(n,c);n++;}}
  im.receiveShadow=true;scene.add(im);env.grass=im;}

 // ================= rocks (mossy, around the roots) =================
 {const base=new THREE.IcosahedronGeometry(1,1);const p=base.attributes.position;for(let i=0;i<p.count;i++){const v=V(p.getX(i),p.getY(i),p.getZ(i));const k=1+(hash2(v.x*3.1+v.z,v.y*2.7)-.5)*.35;p.setXYZ(i,v.x*k,v.y*k*.6,v.z*k);}base.computeVertexNormals();
  const col=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){const up=Math.max(0,p.getY(i)/.6);const c=new THREE.Color(0x5C666C).lerp(new THREE.Color(0x3E5A3E),smooth(.45,.95,up)*.8);col.set([c.r,c.g,c.b],i*3);}
  base.setAttribute('color',new THREE.BufferAttribute(col,3));
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,flatShading:true});const N=MOBILE?40:70;const im=new THREE.InstancedMesh(base,mat,N);const m=new THREE.Matrix4(),q=new THREE.Quaternion();
  for(let i=0;i<N;i++){let x,z,r0=0;if(i<N*.45){const a=rr(-.3,Math.PI+.3)+(R()<.5?0:Math.PI),r=rr(3.4,8);x=Math.cos(a)*r;z=Math.sin(a)*r;}else{const a=rr(0,6.28),r=rr(8,45);r0=r;x=Math.cos(a)*r;z=Math.sin(a)*r;}
   const sz=rr(.07,.24)*(i%9===0?2.:1)*(r0>12?1.8:1);q.setFromEuler(new THREE.Euler(rr(-.2,.2),rr(0,6.28),rr(-.2,.2)));m.compose(V(x,groundH(x,z)+sz*.12,z),q,V(sz*rr(.9,1.6),sz,sz*rr(.9,1.4)));im.setMatrixAt(i,m);}
  im.castShadow=!MOBILE;im.receiveShadow=true;scene.add(im);}

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
 // bushes at the forest edge (low leaf clumps)
 {const mat=new THREE.MeshStandardMaterial({map:leafT,alphaTest:.5,side:THREE.DoubleSide,roughness:.9});const NB=MOBILE?22:36,per=9;const im=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),mat,NB*per);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),c=new THREE.Color();let n=0;
  for(let b=0;b<NB;b++){let x,z,g=0;do{const a=rr(0,6.28),r=rr(11,40);x=Math.cos(a)*r;z=Math.sin(a)*r;}while(((z>-4&&Math.abs(x)<17)||Math.hypot(x,z)<11)&&g++<50);
   const y=groundH(x,z);for(let k=0;k<per;k++){q.setFromEuler(new THREE.Euler(rr(-.9,.9),rr(0,6.28),rr(-.9,.9)));const sz=rr(1,1.7);m.compose(V(x+rr(-.8,.8),y+rr(.3,1),z+rr(-.8,.8)),q,V(sz,sz,sz));im.setMatrixAt(n,m);c.setRGB(.62,.75,.7);im.setColorAt(n,c);n++;}}
  im.count=n;scene.add(im);}

 // far forest: a painted backdrop (Fal, from the reference: gnarled oak silhouettes in blue fog) on a cylinder around the scene.
 // Mirrored-repeat so there is no seam; at night the painting shows as is, by day it is re-tinted with the fog colour.
 const bgU={map:{value:null},fogc:{value:new THREE.Color()},hor:{value:new THREE.Color()},night:{value:1},ok:{value:0}};
 new THREE.TextureLoader().load(new URL('forest-bg.jpg',import.meta.url).href,t=>{t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.MirroredRepeatWrapping;t.anisotropy=4;bgU.map.value=t;bgU.ok.value=1;});
 {const RAD=96,H=64,Y0=-3;const g=new THREE.CylinderGeometry(RAD,RAD,H,64,1,true);g.translate(0,H/2+Y0,0);
  const mat=new THREE.ShaderMaterial({uniforms:bgU,side:THREE.BackSide,transparent:true,depthWrite:false,fog:false,
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`uniform sampler2D map;uniform vec3 fogc,hor;uniform float night,ok;varying vec2 vUv;
    void main(){vec3 c=texture2D(map,vec2(vUv.x*5.,vUv.y)).rgb;c=mix(c,fogc*1.1,.3*(1.-vUv.y*.6));float l=dot(c,vec3(.3,.55,.15));
     vec3 day=mix(fogc*.55,mix(fogc,hor,.4)*1.25,smoothstep(.05,.55,l));
     vec3 nt=c*.82;
     vec3 o=mix(day,nt,night);float a=smoothstep(1.,.86,vUv.y)*ok;
     gl_FragColor=vec4(o,a);
     #include <colorspace_fragment>
    }`});
  const mesh=new THREE.Mesh(g,mat);mesh.renderOrder=-1;mesh.frustumCulled=false;scene.add(mesh);env.backdrop=mesh;}

 // ================= rolling ground fog =================
 // (1) horizontal sheets of domain-warped noise just above the ground
 const fogU={t:U.t,col:{value:new THREE.Color(0x8FB8CC)},op:{value:.5},cam:{value:V()}};
 const sheetMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:false,uniforms:fogU,
  vertexShader:`varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float t,op;uniform vec3 col,cam;varying vec3 vW;${GLSL_NOISE}
   void main(){vec2 p=vW.xz*.075+vec2(vW.y*1.7,0.);vec2 q=vec2(fbm(p+vec2(t*.018,t*.007)),fbm(p+vec2(5.2,1.3)-vec2(t*.013,0.)));
    vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*.021),fbm(p+3.*q+vec2(8.3,2.8)-t*.016));float d=fbm(p+3.4*r);
    float dist=length(vW.xz-cam.xz);float edge=smoothstep(95.,55.,length(vW.xz))*smoothstep(3.,9.,dist)*smoothstep(4.5,10.,length(vW.xz));
    float graze=smoothstep(.04,.45,abs(normalize(cam-vW).y));float a=smoothstep(.3,.85,d)*op*edge*graze;gl_FragColor=vec4(col*(.82+.4*d),a);}`});
 const sheets=[];[[.25,1],[.7,.8],[1.3,.6]].forEach(([y,k])=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(200,200).rotateX(-Math.PI/2),sheetMat.clone());m.material.uniforms=Object.assign({},fogU,{op:{value:.5}});m.position.y=y;m.renderOrder=4;m.userData.k=k;scene.add(m);sheets.push(m);});
 // (2) rolling puffs: camera-facing soft clouds that churn in place and drift around the tree
 const PN=MOBILE?46:80;const puffU={t:U.t,col:fogU.col,op:{value:.5},night:{value:1}};
 const pg=new THREE.InstancedBufferGeometry();pg.copy(new THREE.PlaneGeometry(1,1));pg.instanceCount=PN;
 {const a=new Float32Array(PN*4),b=new Float32Array(PN*4);for(let i=0;i<PN;i++){let ang=rr(0,6.28),r=rr(3.5,34);if(i<PN*.35){ang=rr(.2,2.9);r=rr(7,14);}// a ring just outside the roots: the big roots stay visible above the fog (photo)
   const sz=rr(2.6,6)*(r<10?.8:1.15);a.set([Math.cos(ang)*r,rr(.15,.9)*sz*.32,Math.sin(ang)*r,sz],i*4);b.set([rr(0,100),rr(.6,1.4)*(R()<.5?-1:1),rr(.55,1),rr(0,6.28)],i*4);}
  pg.setAttribute('iA',new THREE.InstancedBufferAttribute(a,4));pg.setAttribute('iB',new THREE.InstancedBufferAttribute(b,4));}
 const puffMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:false,uniforms:puffU,
  vertexShader:`attribute vec4 iA,iB;uniform float t;varying vec2 vUv;varying float vS,vA;varying float vFade;
   void main(){vUv=uv;vS=iB.x;vA=iB.z;
    // slow orbit around the oak plus a lazy wobble
    float ang=t*.006*iB.y+iB.w;float c=cos(ang),s=sin(ang);vec3 cpos=vec3(c*iA.x-s*iA.z,iA.y,s*iA.x+c*iA.z);
    cpos.x+=sin(t*.05+iB.x)*1.2;cpos.z+=cos(t*.04+iB.x*1.7)*1.;cpos.y+=sin(t*.07+iB.x)*.15;
    vec4 mv=viewMatrix*vec4(cpos,1.);float sz=iA.w*(1.+.08*sin(t*.11+iB.x));mv.xy+=position.xy*vec2(sz*1.6,sz);
    vFade=smoothstep(2.,8.,-mv.z);gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`uniform float t,op;uniform vec3 col;varying vec2 vUv;varying float vS,vA,vFade;${GLSL_NOISE}
   void main(){vec2 p=vUv-.5;float r=length(p*vec2(1.,1.25));
    // swirl: rotate the noise domain by an amount that depends on radius and time, so the clump churns
    float sw=(1.-r)*2.2+t*.05*sign(vS-50.);float cs=cos(sw),sn=sin(sw);vec2 rp=mat2(cs,-sn,sn,cs)*p;
    float n=fbm(rp*3.+vS)*.65+fbm(rp*6.-t*.03+vS*2.)*.35;
    float a=smoothstep(.5,.05,r)*smoothstep(.25,.7,n+.15)*smoothstep(0.,.25,vUv.y);
    gl_FragColor=vec4(col*(.85+.35*n+.12*(vUv.y)),a*op*vA*vFade);}`});
 const puffs=new THREE.Mesh(pg,puffMat);puffs.frustumCulled=false;puffs.renderOrder=6;scene.add(puffs);

 // ================= lamp halos (glow around lamps; works on phones where bloom is off) =================
 const haloTex=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=128;const x=cv.getContext('2d');const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,220,160,1)');g.addColorStop(.15,'rgba(255,190,110,.55)');g.addColorStop(.45,'rgba(255,150,70,.14)');g.addColorStop(1,'rgba(255,140,60,0)');x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(cv);})();
 const halos=[];env.addHalo=(light,size=1.6)=>{const s=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));s.scale.setScalar(size);scene.add(s);halos.push({s,l:light,size});};

 // ================= colour grading (after tone mapping) =================
 env.gradePass=new ShaderPass({uniforms:{tDiffuse:{value:null},sat:{value:1.22},con:{value:1.08},lift:{value:new THREE.Color(0x0c2232)},warm:{value:new THREE.Color(0xFFD9A0)},vig:{value:.32},night:{value:1}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float sat,con,vig,night;uniform vec3 lift,warm;varying vec2 vUv;
   void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 x=c.rgb;float l=dot(x,vec3(.2126,.7152,.0722));
    x=mix(vec3(l),x,sat);x=(x-.5)*con+.5;
    // split toning: cold teal shadows, warm highlights (lamp light pops against the blue night)
    float sh=1.-smoothstep(0.,.45,l),hi=smoothstep(.45,1.,l);x+=lift*sh*(.6+.6*night);x=mix(x,x*warm*1.12,hi*.35*night);
    vec2 d=vUv-.5;x*=1.-vig*dot(d,d)*2.2;gl_FragColor=vec4(clamp(x,0.,1.),c.a);}`});

 // ================= cool night fill =================
 // a soft blue light from the front-left and a rim from behind, no shadows: the bark and leaves pick up the moonlit blue of the reference
 const fill=new THREE.DirectionalLight(0x86AEDC,0);fill.position.set(-8,14,26);const sky=new THREE.HemisphereLight(0x9CC2E0,0x35584E,0);scene.add(sky);scene.add(fill);
 const rim=new THREE.DirectionalLight(0x6FA0D0,0);rim.position.set(10,14,-20);scene.add(rim);

 // ================= per-frame =================
 const tmp=new THREE.Color(),dark=new THREE.Color(0x0E1C28);
 env.update=(s)=>{const {T,P,nightK,mornK,rainK,lampOn,camera}=s;U.t.value=T;U.wind.value=1+rainK*1.5;
  const fc=tmp.copy(P.fog);
  fogU.col.value.copy(fc).lerp(new THREE.Color(0x8EC2DA),.3+nightK*.3);const eve=Math.max(nightK,lampOn||0);const dens=.35+eve*.65+mornK*.5+rainK*.2;fogU.cam.value.copy(camera.position);
  for(const m of sheets){m.material.uniforms.op.value=.3*dens*m.userData.k;m.material.uniforms.cam.value.copy(camera.position);m.material.uniforms.col.value.copy(fogU.col.value);m.material.uniforms.t.value=T;}
  puffU.op.value=.42*dens;
  bgU.fogc.value.copy(P.fog);bgU.hor.value.copy(P.hor);bgU.night.value=eve;
  for(const h of halos){const on=h.l.intensity>.05;h.s.visible=on;if(on){h.l.getWorldPosition(h.s.position);const k=Math.min(1,h.l.intensity/6);h.s.material.opacity=k*.85;h.s.scale.setScalar(h.size*(.85+k*.3));}}
  fill.intensity=eve*1.6*(1-rainK*.4);sky.intensity=eve*.9;rim.intensity=eve*1.4;
  const g=env.gradePass.uniforms;g.night.value=eve;g.sat.value=1.18+nightK*.08;};
 return env;
}
