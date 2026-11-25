// ================= props.js — furniture and objects inside the treehouse =================
// Every object is modelled in code: bevelled boards with painted wood grain, lathe-turned metal and
// ceramic, extruded tools. Static parts of each object are merged per material (few draw calls);
// interactive parts stay separate: oven door on a hinge, a book whose pages turn, grabbable tools.
// Local convention for every builder: floor at y=0, front of the object faces +z, centred on x/z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
let seed = 7; const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + R() * (b - a);

// ---------------- painted textures (canvas, generated once) ----------------
function canvas(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function texOf(c, { srgb = true, rep = 1 } = {}) { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; return t; }
// painted Fal AI textures (game/*.jpg): start with the canvas version, swap in the image when it loads
// shared images: index.html's tex() loads ASSET + name; take that very image when it is already loaded (window.__tex[name].image),
// else load the same URL (ASSET prefix included) so the browser serves it from its cache instead of a second download (Optimization)
function sharedImg(url, cb) { const t = window.__tex && window.__tex[url], im = t && t.image; if (im && (im.complete || im.close || im.getContext) && im.width) { cb(im); return; }
  const img = new Image(); img.crossOrigin = 'anonymous'; /* as THREE.TextureLoader: same request mode, so the cache entry is shared */ img.onload = () => cb(img); img.src = (window.__ASSET || '') + url; }
function upgrade(t, url) { sharedImg(url, img => { t.image = img; t.dispose(); t.needsUpdate = true; }); /* dispose: GPU storage is immutable and the size changes */ return t; }
// swap a material's procedural grain for a photo-scanned wood (the boards' scans, see NOTES-planks): the scans run their grain
// along u, ours along v, so the image is drawn turned 90° into a canvas (downsized: furniture needs less than floors).
// boxUV gives 1.11 u and 0.56 v per metre; the scan covers ~1 m across the grain and ~2.4 m along it.
// (Planks thread) the wood pieces are merged into one mesh per material, so the variety comes from the shader: boxUV gives
// every piece its own random UV offset, and a slow noise of that UV gives each board/leg/door plank its own tone, a few
// greyer weathered ones, and long faint streaks along the grain. Same program, same draw calls, roughness untouched.
function varyWood(mat, k = 1) {
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
float vwH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vwN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(vwH(i),vwH(i+vec2(1,0)),f.x),mix(vwH(i+vec2(0,1)),vwH(i+vec2(1,1)),f.x),f.y);}`)
   .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
{vec2 q=vMapUv*vec2(.45,.16);float n=vwN(q),n2=vwN(vMapUv*vec2(9.,.35)+5.);
 diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.8,.76,.72),vec3(1.14,1.05,.94),n)*(.93+.14*n2),${k.toFixed(2)});
 float g=smoothstep(.72,.9,vwN(q*.8+3.7))*.35*${k.toFixed(2)};diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.3,.55,.15)))*vec3(1.04,.99,.92),g);}
#endif`); };
  mat.customProgramCacheKey = () => 'varyWood' + k; mat.needsUpdate = true; return mat; }
// (Planks thread) working wear on the tops he works on: the kitchen counter, the workbench and the side bench. M.woodLight is
// merged with every shelf and table, so the marks live in a world-space layer that only switches on for the upward faces of
// those three tops (WTOPS, filled from the placed groups after shiftRooms). Knife cuts, saw kerfs, hammer dents, pot and
// lantern scorch rings, oil and tea stains, a hand-worn front edge. Grooves and dents bend the normal (bump), so they catch
// the lamp; far away the fine marks fade into a matching overall darkening (no shimmer). Same program, same draw calls.
const WTOPS = { a: [0, 1, 2].map(() => new THREE.Vector4(0, -99, 0, -1)), b: [0, 1, 2].map(() => new THREE.Vector4(.1, .1, 1, 0)) };
function setTop(i, g, kind, hx, hz, top, ry = 0) { if (!g) return; WTOPS.a[i].set(g.position.x, g.userData.floorY + top, g.position.z, kind); WTOPS.b[i].set(hx, hz, Math.cos(ry), Math.sin(ry)); }
function workTops(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { prev && prev(sh, r); sh.uniforms.uTA = { value: WTOPS.a }; sh.uniforms.uTB = { value: WTOPS.b };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWT;').replace('#include <project_vertex>', `#include <project_vertex>
{vec4 wq=vec4(transformed,1.);
#ifdef USE_INSTANCING
wq=instanceMatrix*wq;
#endif
vWT=(modelMatrix*wq).xyz;}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWT;uniform vec4 uTA[3];uniform vec4 uTB[3];
float wtOn=0.;vec2 wtDH=vec2(0.);float wtRg=1.;
float wH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float wN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(wH(i),wH(i+vec2(1,0)),f.x),mix(wH(i+vec2(0,1)),wH(i+vec2(1,1)),f.x),f.y);}
float wSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
// knife / chisel cuts: short straight grooves, mostly along two working directions, on two offset jittered grids (cs = cell size)
float wCuts(vec2 p,float dens,float cs,float fw){float g=0.;for(int k=0;k<2;k++){vec2 q=p/cs+float(k)*vec2(.37,.71);vec2 i=floor(q);
 for(int dx=-1;dx<=1;dx++)for(int dy=-1;dy<=1;dy++){vec2 c=i+vec2(dx,dy)+float(k)*17.;if(wH(c)>dens)continue;
  float a=mix(wH(c+7.1)*3.14,(wH(c+2.3)<.5?.35:1.85)+(wH(c+8.8)-.5)*.5,.75);vec2 o=floor(q)+vec2(dx,dy)+vec2(wH(c+3.3),wH(c+5.7));
  vec2 d=vec2(cos(a),sin(a))*(.2+.45*wH(c+9.1));float dd=wSeg(q,o-d,o+d)*cs;float w=.00035+.0005*wH(c+4.4);
  g=max(g,(1.-smoothstep(w,w+fw,dd))*(.35+.65*wH(c+11.)));}}return g;}
float wRing(vec2 p,vec2 c,float r,float w){vec2 v=p-c;float a=atan(v.y,v.x);float rr=r*(1.+.06*(wN(vec2(a*2.,r*40.))-.5));
 float d=abs(length(v)-rr)/w;return exp(-d*d*1.6)*mix(.45,1.,smoothstep(.15,.5,wN(vec2(a*3.2+r*9.,1.7))))*(.75+.25*wN(v*90.));}
// height (m, negative = cut into the wood) and, through the out params, colour masks
float wHeight(vec2 p,float kind,float hx,float hz,float fw,out float cut,out float kerf){
 float h=0.;cut=0.;kerf=0.;
 float zone=kind<.5?smoothstep(.06,0.,max(abs(p.x+.3)-.2,abs(p.y)-.24)):(kind<1.5?.3:.15);
 cut=wCuts(p,.04+.22*zone,.03,fw);h-=cut*.0005;
 if(kind>.5&&kind<1.5){
  for(int i=0;i<8;i++){float fi=float(i);float x=mix(.05,.8,wH(vec2(fi,4.2)))*(i<2?-1.:1.);float ln=.025+.07*wH(vec2(fi,6.1));float t=(wH(vec2(fi,8.))-.5)*.25;
   float d=wSeg(p,vec2(x,hz+.01),vec2(x+t*ln,hz-ln));float k=(1.-smoothstep(.0007,.0007+fw,d))*smoothstep(hz-ln-.004,hz-ln+.01,p.y);kerf=max(kerf,k);}
  h-=kerf*.0016;
  vec2 q=p/.055;vec2 i=floor(q);vec2 f=q-i;if(wH(i+3.)<.3){vec2 c=vec2(.2,.2)+.6*vec2(wH(i+1.),wH(i+2.));float r=(.06+.08*wH(i+5.));float d=length(f-c)/r;h-=.001*smoothstep(1.,.2,d);}
 }
 return h;}`).replace('#include <roughnessmap_fragment>', `{vec3 fn=cross(dFdx(vWT),dFdy(vWT));float fl=length(fn);
 for(int t=0;t<3;t++){vec4 A=uTA[t],B=uTB[t];if(A.w<-.5||fl<1e-12||abs(fn.y)/fl<.85||abs(vWT.y-A.y)>.012)continue;
  vec2 w=vWT.xz-A.xz;vec2 p=vec2(w.x*B.z-w.y*B.w,w.x*B.w+w.y*B.z);if(abs(p.x)>B.x+.01||abs(p.y)>B.y+.01)continue;
  vec2 ex=dFdx(vWT.xz),ey=dFdy(vWT.xz);ex=vec2(ex.x*B.z-ex.y*B.w,ex.x*B.w+ex.y*B.z);ey=vec2(ey.x*B.z-ey.y*B.w,ey.x*B.w+ey.y*B.z);
  float fw=max(length(ex),length(ey));float vis=smoothstep(.004,.0012,fw);float kind=A.w;float cut,kerf,c2,k2;
  float h0=wHeight(p,kind,B.x,B.y,fw,cut,kerf);
  if(vis>.01){wtDH=vis*vec2(wHeight(p+ex,kind,B.x,B.y,fw,c2,k2)-h0,wHeight(p+ey,kind,B.x,B.y,fw,c2,k2)-h0);wtOn=1.;}
  vec3 col=diffuseColor.rgb;
  // cuts: fresh ones show paler wood, old ones dark with grime; far away a mean darkening instead of the lines
  float n1=wN(p*31.);col*=mix(1.,1.-.03*(kind<.5?1.:.7),1.-vis);col=mix(col,col*mix(vec3(.74,.68,.62),vec3(1.08,1.04,.96),step(.7,n1)),cut*vis*.55);
  col=mix(col,col*vec3(.42,.36,.32),kerf*vis);
  // hands: the front edge is darker and a little greasy where he leans and grips, worn paler in the middle of the bench
  float edge=smoothstep(.16,.01,B.y-p.y)*smoothstep(B.x,B.x-.35,abs(p.x))*(.55+.45*wN(p*14.));
  col=mix(col,col*vec3(.8,.74,.68),edge*.55);wtRg=1.-.2*edge;
  float worn=smoothstep(.5,.1,length(p*vec2(1./B.x,1.6/B.y)))*(.5+.5*wN(p*6.));col=mix(col,mix(col,vec3(dot(col,vec3(.33)))*vec3(1.1,1.03,.94),.5),worn*.35);
  if(kind<.5){
   // pot ring and an older fainter one, a mug ring, water-darkened wood by the sink, a few dark spills
   float sc=wRing(p,vec2(-.2,.15),.08,.011)+.45*wRing(p,vec2(-.08,-.17),.05,.008);float fill=smoothstep(.085,.05,length(p-vec2(-.2,.15)))*.12;
   col=mix(col,col*vec3(.3,.2,.13),clamp(sc*.6+fill,0.,1.));
   float tea=wRing(p,vec2(-.42,.2),.036,.004);col=mix(col,col*vec3(.55,.45,.37),tea*.7);
   float wet=smoothstep(.07,0.,abs(p.x-.02))*(.5+.5*wN(p*12.))+smoothstep(.06,0.,abs(p.x-.44))*.6*wN(p*12.+4.);col=mix(col,col*vec3(.62,.6,.6),clamp(wet,0.,1.)*.55);
   float sp=smoothstep(.62,.8,wN(p*22.+9.))*smoothstep(.55,.7,wN(p*3.+1.));col=mix(col,col*vec3(.6,.52,.46),sp*.6);wtRg*=1.-.25*sp;
  }else if(kind<1.5){
   // oil stain, a lantern scorch ring, paint spots, pencil ticks along the front, burn mark of a hot tool
   float oil=smoothstep(.62,.7,wN(p*9.+2.)*.6+wN(p*31.)*.15+smoothstep(.13,0.,length(p-vec2(.52,-.04)))*.55);col=mix(col,col*vec3(.45,.38,.32),oil*.75);wtRg*=1.-.35*oil;
   float sc=wRing(p,vec2(-.26,.16),.054,.009);col=mix(col,col*vec3(.3,.2,.13),sc*.6);
   float bt=smoothstep(.022,.006,wSeg(p,vec2(-.68,-.1),vec2(-.6,-.13)))*(.6+.4*wN(p*80.));col=mix(col,vec3(.08,.05,.035),bt*.8);
   for(int i=0;i<5;i++){float fi=float(i);vec2 c=vec2(mix(-.75,.8,wH(vec2(fi,1.3))),mix(-.25,.25,wH(vec2(fi,2.7))));float r=.004+.01*wH(vec2(fi,3.9));
    float m=smoothstep(r,r*.6,length((p-c)*vec2(1.,1.+wH(vec2(fi,5.))))+.004*(wN(p*300.)-.5));
    vec3 pc=i==0?vec3(.42,.08,.05):i==1?vec3(.2,.32,.16):i==2?vec3(.8,.78,.7):i==3?vec3(.42,.08,.05):vec3(.15,.2,.3);col=mix(col,pc,m*.85);wtRg*=1.-.4*m;}
   float pt=0.;for(int i=0;i<6;i++){float x=-.42+float(i)*.05;pt=max(pt,1.-smoothstep(.0004,.0004+fw,wSeg(p,vec2(x,B.y-.005),vec2(x,B.y-(i==0||i==5?.04:.022)))));}
   col=mix(col,vec3(.18,.18,.2),pt*vis*.8);
  }
  diffuseColor.rgb=col;}}
#include <roughnessmap_fragment>
roughnessFactor*=wtRg;`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if(wtOn>0.){vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition);vec3 R1=cross(sy,normal),R2=cross(normal,sx);float det=dot(sx,R1)*faceDirection;
 vec3 gr=sign(det)*(wtDH.x*R1+wtDH.y*R2);normal=normalize(abs(det)*normal-gr);}`); };
  mat.customProgramCacheKey = () => 'varyWood1wt'; mat.needsUpdate = true; return mat; }
function scanWood(mat, url, { w = 512, h = 1024, color = 0xffffff, bump = 1.2 } = {}) {
  sharedImg(url, img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.translate(w, 0); g.rotate(Math.PI / 2); g.drawImage(img, 0, 0, h, w);
    for (const [k, srgb] of [['map', true], ['bumpMap', false]]) { const t = mat[k]; if (!t) continue; t.image = c; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.repeat.set(.9, .75); t.dispose(); t.needsUpdate = true; }
    mat.color.set(color); mat.bumpScale = bump; mat.needsUpdate = true; });
  return mat; }
function hexA(hex, a) { const c = new THREE.Color(hex); return `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${a})`; }
// wood grain runs along canvas y (= texture v)
function woodCanvas(base, dark, light, { knots = 2, w = 256, h = 512, s = 1 } = {}) {
  return canvas(w * s, h * s, (g) => { g.scale(s, s); // s=2: same painting, twice the pixels (crisp up close)
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { const x = R() * w, bw = rr(6, 40); g.fillStyle = hexA(R() < .6 ? dark : light, rr(.05, .16)); g.fillRect(x, 0, bw, h); g.fillRect(x - w, 0, bw, h); }
    for (let i = 0; i < 170; i++) {
      const x0 = R() * w, k = 1 + (R() * 3 | 0), amp = rr(1, 5), ph = R() * 6.28; g.strokeStyle = hexA(R() < .75 ? dark : light, rr(.06, .28)); g.lineWidth = rr(.5, 1.8);
      for (const off of [0, -w, w]) { g.beginPath(); for (let y = 0; y <= h; y += 8) { const x = x0 + off + Math.sin(y / h * 6.283 * k + ph) * amp; y ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    }
    for (let i = 0; i < knots; i++) { const x = rr(30, w - 30), y = rr(40, h - 40); for (let r = 14; r > 1; r -= 2.5) { g.strokeStyle = hexA(dark, .25 + (14 - r) / 30); g.lineWidth = 1.4; g.beginPath(); g.ellipse(x, y, r * .55, r * 1.3, 0, 0, 6.283); g.stroke(); } g.fillStyle = hexA(dark, .7); g.beginPath(); g.ellipse(x, y, 2.5, 4.5, 0, 0, 6.283); g.fill(); }
  });
}
function quiltCanvas() {
  const cols = ['#D88E8C', '#A3C47E', '#B7A0D0', '#8EB8DA', '#E9CB78', '#F1E7D6', '#DDA27E', '#C98FB4', '#9FD0C0'];
  return canvas(512, 512, (g) => {
    const n = 4, s = 512 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const c = cols[(i * 5 + j * 3 + (i * j) % 4) % cols.length]; const x = i * s, y = j * s;
      const gr = g.createRadialGradient(x + s / 2, y + s / 2, 4, x + s / 2, y + s / 2, s * .75); gr.addColorStop(0, c); gr.addColorStop(1, hexA(new THREE.Color(c).multiplyScalar(.82).getHex(), 1)); g.fillStyle = gr; g.fillRect(x, y, s, s);
      const pat = (i + j * 2) % 4; g.fillStyle = 'rgba(255,255,255,.22)';
      if (pat === 0) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { g.beginPath(); g.arc(x + 12 + a * 21, y + 12 + b * 21, 3, 0, 6.283); g.fill(); }
      if (pat === 1) for (let a = 0; a < 8; a++) g.fillRect(x, y + a * 16 + 4, s, 5);
      if (pat === 2) { g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 3; for (let a = -s; a < s; a += 18) { g.beginPath(); g.moveTo(x + a, y); g.lineTo(x + a + s, y + s); g.stroke(); } }
      g.strokeStyle = 'rgba(80,50,40,.35)'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
      g.strokeStyle = 'rgba(255,250,235,.75)'; g.lineWidth = 1.6; g.setLineDash([6, 5]); g.strokeRect(x + 8, y + 8, s - 16, s - 16); g.setLineDash([]);
    }
  });
}
function rugCanvas(kind) {
  return canvas(256, 256, (g, w, h) => {
    if (kind === 'check') { g.fillStyle = '#E4DCCB'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(96,122,150,.45)'; g.fillRect(i * 16, 0, 8, h); g.fillRect(0, i * 16, w, 8); } }
    else if (kind === 'orange') { g.fillStyle = '#C9773A'; g.fillRect(0, 0, w, h); g.fillStyle = '#E39A52'; g.fillRect(18, 18, w - 36, h - 36); g.strokeStyle = '#A85A2A'; g.lineWidth = 5; g.strokeRect(30, 30, w - 60, h - 60); g.strokeStyle = 'rgba(255,220,160,.5)'; g.lineWidth = 2; g.strokeRect(40, 40, w - 80, h - 80); }
    else { g.fillStyle = '#7C8466'; g.fillRect(0, 0, w, h); g.fillStyle = '#A3A27E'; g.fillRect(16, 16, w - 32, h - 32); g.fillStyle = '#8A8D6C'; g.fillRect(34, 34, w - 68, h - 68); for (const y of [24, h - 30]) { g.fillStyle = '#C9B98A'; g.fillRect(16, y, w - 32, 6); } }
    const id = g.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (R() - .5) * 26; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } g.putImageData(id, 0, 0);
    g.strokeStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < h; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
}
function fringeCanvas(col) { return canvas(128, 32, (g) => { for (let x = 0; x < 128; x += 3) { g.strokeStyle = col; g.globalAlpha = rr(.7, 1); g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + rr(-2, 2), rr(22, 32)); g.stroke(); } }); }
function staveCanvas(base, dark, n) { const c = woodCanvas(base, dark, '#E0A86A', { knots: 1 }); const g = c.getContext('2d'); for (let i = 0; i < n; i++) { const x = i * c.width / n; g.fillStyle = hexA(dark, .7); g.fillRect(x, 0, 2.5, c.height); g.fillStyle = 'rgba(255,220,170,.15)'; g.fillRect(x + 3, 0, 2, c.height); } return c; }
function weaveCanvas() { return canvas(128, 128, (g) => { g.fillStyle = '#8A5E36'; g.fillRect(0, 0, 128, 128); for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 16) { const o = (y / 8) % 2 ? 8 : 0; const gr = g.createLinearGradient(x + o, 0, x + o + 14, 0); gr.addColorStop(0, '#9C6D3E'); gr.addColorStop(.5, '#D2A066'); gr.addColorStop(1, '#9C6D3E'); g.fillStyle = gr; g.beginPath(); g.ellipse(x + o + 7, y + 4, 7, 3.4, 0, 0, 6.283); g.fill(); } }); }
function pageCanvas() { return canvas(128, 180, (g) => { g.fillStyle = '#F4ECD8'; g.fillRect(0, 0, 128, 180); g.fillStyle = 'rgba(60,45,30,.55)'; for (let y = 18; y < 166; y += 7) { let x = 12; while (x < 112) { const ww = rr(5, 18); if (x + ww > 116) break; g.fillRect(x, y, ww, 2.2); x += ww + 3.5; } } g.fillStyle = 'rgba(120,90,50,.08)'; g.fillRect(0, 0, 10, 180); }); }
function pageEdgeCanvas() { return canvas(64, 64, (g) => { g.fillStyle = '#EFE5CC'; g.fillRect(0, 0, 64, 64); for (let y = 0; y < 64; y += 2) { g.fillStyle = `rgba(150,120,80,${rr(.05, .25)})`; g.fillRect(0, y, 64, 1); } }); }
function paperPlanCanvas() { return canvas(256, 180, (g) => { g.fillStyle = '#EFE6CF'; g.fillRect(0, 0, 256, 180); g.strokeStyle = 'rgba(70,90,130,.18)'; for (let x = 0; x < 256; x += 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 180); g.stroke(); } for (let y = 0; y < 180; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); } g.strokeStyle = 'rgba(40,50,80,.8)'; g.lineWidth = 2; g.strokeRect(40, 40, 120, 80); g.beginPath(); g.moveTo(40, 40); g.lineTo(100, 14); g.lineTo(160, 40); g.stroke(); g.strokeRect(70, 70, 26, 50); g.strokeRect(116, 58, 28, 22); g.lineWidth = 1; g.beginPath(); g.moveTo(180, 40); g.lineTo(180, 120); g.moveTo(175, 40); g.lineTo(185, 40); g.moveTo(175, 120); g.lineTo(185, 120); g.stroke(); }); }
function pictureCanvas() { return canvas(160, 120, (g) => { const s = g.createLinearGradient(0, 0, 0, 120); s.addColorStop(0, '#9DB8C9'); s.addColorStop(1, '#E7D2A8'); g.fillStyle = s; g.fillRect(0, 0, 160, 120); g.fillStyle = '#6F8B5E'; g.beginPath(); g.moveTo(0, 80); g.quadraticCurveTo(50, 50, 90, 78); g.quadraticCurveTo(130, 60, 160, 74); g.lineTo(160, 120); g.lineTo(0, 120); g.fill(); g.fillStyle = '#8A6A4A'; g.fillRect(60, 70, 34, 24); g.fillStyle = '#A44A36'; g.beginPath(); g.moveTo(56, 70); g.lineTo(77, 56); g.lineTo(98, 70); g.fill(); g.fillStyle = '#4C6B47'; for (const x of [20, 30, 128, 140]) { g.beginPath(); g.moveTo(x, 90); g.lineTo(x + 7, 60); g.lineTo(x + 14, 90); g.fill(); } }); }
function labelCanvas(c1, c2) { return canvas(64, 32, (g) => { g.fillStyle = c1; g.fillRect(0, 0, 64, 32); g.fillStyle = c2; g.fillRect(0, 10, 64, 12); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(8, 14, 30, 3); }); }

// ---------------- geometry helpers ----------------
// perf: a one-segment rounded box is a chamfered box: 6 faces, 12 bevel strips, 8 corner triangles (44 triangles instead of 108).
// Normals run from face to face across each bevel, so it shades like RoundedBoxGeometry; UVs are per-face planar like a box.
function chamferBox(w, h, d, r) { const H = [w / 2, h / 2, d / 2]; const pos = [], nor = [], uvs = [];
  const pt = (ax, s) => { const p = [0, 0, 0]; for (let k = 0; k < 3; k++) p[k] = s[k] * (k === ax ? H[k] : H[k] - r); return p; }; const nm = (ax, s) => { const n = [0, 0, 0]; n[ax] = s[ax]; return n; };
  const tri = (A, B, C) => { const e1 = [0, 1, 2].map(k => B[0][k] - A[0][k]), e2 = [0, 1, 2].map(k => C[0][k] - A[0][k]); const cx = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nn = [0, 1, 2].map(k => A[1][k] + B[1][k] + C[1][k]); const v = (cx[0] * nn[0] + cx[1] * nn[1] + cx[2] * nn[2]) >= 0 ? [A, B, C] : [A, C, B];
    for (const [p, n] of v) { pos.push(...p); nor.push(...n); const a = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2; const o = [0, 1, 2].filter(k => k !== a); uvs.push(p[o[0]] / (2 * H[o[0]]) + .5, p[o[1]] / (2 * H[o[1]]) + .5); } };
  const quad = (A, B, C, D) => { tri(A, B, C); tri(A, C, D); }; const V3 = (ax, s) => [pt(ax, s), nm(ax, s)];
  for (let ax = 0; ax < 3; ax++) for (const sa of [-1, 1]) { const o = [0, 1, 2].filter(k => k !== ax); const S = (u, v) => { const s = [0, 0, 0]; s[ax] = sa; s[o[0]] = u; s[o[1]] = v; return s; };
    quad(V3(ax, S(-1, -1)), V3(ax, S(1, -1)), V3(ax, S(1, 1)), V3(ax, S(-1, 1))); }
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) { const c = 3 - a - b; for (const sa of [-1, 1]) for (const sb of [-1, 1]) { const S = sc => { const s = [0, 0, 0]; s[a] = sa; s[b] = sb; s[c] = sc; return s; };
    quad(V3(a, S(-1)), V3(a, S(1)), V3(b, S(1)), V3(b, S(-1))); } }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const s = [sx, sy, sz]; tri(V3(0, s), V3(1, s), V3(2, s)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); return g; }
const rb = (w, h, d, r = .012, seg = 1) => { const rr2 = Math.max(.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)); return seg === 1 ? chamferBox(w, h, d, rr2) : new RoundedBoxGeometry(w, h, d, seg, rr2); };
// box-projected UVs in metres; wood grain follows `grain` axis (0=x,1=y,2=z)
function boxUV(geo, grain, scale = 1 / .9) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv; const ox = R() * 5, oy = R() * 5;
  for (let i = 0; i < p.count; i++) {
    const a = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))]; const ax = a[0] > a[1] ? (a[0] > a[2] ? 0 : 2) : (a[1] > a[2] ? 1 : 2);
    const o = [0, 1, 2].filter(k => k !== ax); let ua, va; if (o.includes(grain)) { va = grain; ua = o.find(k => k !== grain); } else { ua = o[0]; va = o[1]; }
    const P = [p.getX(i), p.getY(i), p.getZ(i)]; uv.setXY(i, P[ua] * scale + ox, P[va] * scale * .5 + oy);
  }
  uv.needsUpdate = true; return geo;
}
let FINE = 0;   // [PROPS round] set while building things the hero holds up to the camera (pot, kettle, ladle, plate, lantern): rounder
// fine(build): those few vessels get 24 sides and no size-based LOD reduction (a 20 cm pot came out a 10-sided prism)
const fine = f => { FINE = 1; try { return f(); } finally { FINE = 0; } };
function lathe(pts, seg = 16) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), Math.min(seg, FINE ? 24 : 16)); } // perf: 16 around is smooth at phone size
function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

// ---------------- materials ----------------
let M = null;
function makeMaterials(renderer) {
  // warm interior environment for the metals and glazes (only on these materials; scene lighting untouched)
  let env = null;
  try {
    const s = new THREE.Scene(); const geo = new THREE.SphereGeometry(10, 32, 16); const col = [];
    const top = new THREE.Color(0xFFD8A0), mid = new THREE.Color(0x9A6A40), bot = new THREE.Color(0x2E2018), c = new THREE.Color();
    for (let i = 0; i < geo.attributes.position.count; i++) { const y = geo.attributes.position.getY(i) / 10; if (y > 0) c.copy(mid).lerp(top, y); else c.copy(mid).lerp(bot, -y); col.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const win = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshBasicMaterial({ color: 0x8FB4D6 })); win.position.set(0, 2, -9); s.add(win);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xFFE2B0).multiplyScalar(3) })); lamp.position.set(3, 7, 3); s.add(lamp);
    const pm = new THREE.PMREMGenerator(renderer); env = pm.fromScene(s, .02).texture; pm.dispose();
  } catch (e) { env = null; }
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const wt = (b, d, l, k, s = 1) => { const c = woodCanvas(b, d, l, { knots: k, s }); return { map: texOf(c), bumpMap: texOf(c, { srgb: false }), bumpScale: 1.2 }; };
  ENV0 = env;
  const metal = (color, metalness, roughness, ei = 1) => std({ color, metalness, roughness, envMap: env, envMapIntensity: ei });
  const qt = upgrade(texOf(quiltCanvas()), 'quilt.jpg'); const pg = texOf(pageCanvas()); pg.wrapS = pg.wrapT = THREE.ClampToEdgeWrapping;
  M = {
    env,
    wood: std({ ...wt('#C98A4E', '#7A4826', '#EDB477', 2, 2), roughness: .84 }),          /* oiled, not varnished: the bunk read as glossy plastic */          // honey furniture
    woodLight: std({ ...wt('#D9A066', '#8E5A30', '#F4C88E', 1, 2), roughness: .72 }),     // table tops, shelves
    woodDark: std({ ...wt('#7E4E2E', '#3E2414', '#A8703F', 2), roughness: .78 }),      // frames, legs
    // (wood, woodLight, woodDark get the photo scans once loaded: see scanWood below)
    woodRed: std({ ...wt('#A85E34', '#5E2E16', '#D48A52', 1), roughness: .7 }),        // tool handles
    stave: std({ map: texOf(staveCanvas('#B87842', '#4A2A14', 14)), roughness: .75 }),
    staveDark: std({ map: texOf(staveCanvas('#9A6036', '#3A2010', 12)), roughness: .78 }),
    weave: std({ map: texOf(weaveCanvas(), { rep: 7 }), bumpMap: texOf(weaveCanvas(), { srgb: false, rep: 7 }), bumpScale: 1.2, roughness: .9 }),   // fine wicker, not big dots
    iron: metal(0x34383F, .65, .45, .6),
    hoopIron: metal(0x3B3530, .55, .78, .35),   // barrel hoops: blackened forged iron gone dull and a little rusty, no gloss
    enamel: metal(0x4F5965, .35, .32, .9),
    enamelDark: metal(0x30353C, .4, .4, .6),
    steel: metal(0xB4BBC3, .9, .28, 1.1),
    chrome: metal(0xE2E6EA, 1, .14, 1.3),
    brass: metal(0xD8AE55, .85, .28, 1.2),
    copper: metal(0xC0754A, .9, .32, 1),
    hood: metal(0x7E858D, .85, .34, 1.0),
    fridge: metal(0xDAD4C4, .35, .3, 1.0) /* cream-silver like the photo (Critic P8) */,   // silver-grey retro fridge like the photo
    ceramic: metal(0xF2EDE3, 0, .22, .7),
    glazeBlue: metal(0x6F8FA8, 0, .25, .7),
    glazeCream: metal(0xE8D9B8, 0, .3, .7),
    glass: std({ color: 0xC8DCE6, roughness: .08, metalness: 0, transparent: true, opacity: .35, envMap: env, envMapIntensity: 1.2, depthWrite: false }),
    jarGlass: std({ color: 0xC88A3A, roughness: .15, transparent: true, opacity: .75, envMap: env, envMapIntensity: 1 }),
    rubber: std({ color: 0x24201E, roughness: .6 }),
    gripRed: std({ color: 0x8E3226, roughness: .5 }), /* old cellulose handles: deeper, dirtier tones (were toy-bright) */
    gripYellow: std({ color: 0xB0832E, roughness: .5 }),
    gripBlue: std({ color: 0x34546E, roughness: .5 }),
    linen: std({ color: 0xF4EDE0, roughness: .92 }),
    mattress: std({ color: 0xE6DFCF, roughness: .9 }),
    quilt: std({ map: qt, roughness: .95, side: THREE.DoubleSide }),
    clothBlue: std({ color: 0x7E9CB6, roughness: .95, side: THREE.DoubleSide }),
    felt: std({ color: 0x9A5A3A, roughness: 1 }),
    paper: std({ map: pg, roughness: .9, side: THREE.DoubleSide }),
    pageEdge: std({ map: texOf(pageEdgeCanvas()), roughness: .9 }),
    plan: std({ map: texOf(paperPlanCanvas()), roughness: .9 }),
    picture: std({ map: texOf(pictureCanvas()), roughness: .8 }),
    bread: std({ color: 0xC8884A, roughness: .8 }),
    darkInside: std({ color: 0x15100D, roughness: 1, side: THREE.BackSide }),
    fire: std({ color: 0x2A120A, emissive: 0xFF6A1E, emissiveIntensity: 1.2, roughness: 1 }),
    ovenGlass: std({ color: 0x2A160C, emissive: 0xFF7A2A, emissiveIntensity: .8, roughness: .1, metalness: 0, envMap: env, envMapIntensity: 1.2, transparent: true, opacity: .55, depthWrite: false }),
    covers: [0x8E3B2E, 0x2F5D7C, 0x4E6B3A, 0xB2803A, 0x6B4A7A, 0x9C5B2E, 0x3E4C5E].map(c => std({ color: c, roughness: .85, ...bookClothOf() })), /* book cloth: a fine weave, rubbed pale at the edges and corners (were flat plastic colours) */
    cans: [['#B8442E', '#E9D7A8'], ['#3F6E9A', '#F0E6CC'], ['#6E8F4A', '#F3E2B0'], ['#C99A3A', '#5A3A22']].map(([a, b]) => std({ map: texOf(labelCanvas(a, b)), metalness: .5, roughness: .4, envMap: env, envMapIntensity: .8 })),
  };
  // linen (pillows, bolster, lampshade): a real weave with slubs, soft washed-out stains and a faint ticking stripe,
  // so the pillows read as cloth instead of smooth cream plastic (realism sweep). Low contrast: up close a weave, from the room just soft cloth
  { const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#F6EFE2'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(150,130,105,${.025 + Math.random() * .035})`; g.fillRect(0, y, w, 1); }
      for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(255,252,245,${.04 + Math.random() * .05})`; g.fillRect(x, 0, 1, h); }
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(140,118,92,${.05 + Math.random() * .07})`; g.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 26, 1); } /* slubs */
      for (let i = 0; i < 5; i++) { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30); gr.addColorStop(0, 'rgba(150,120,70,.09)'); gr.addColorStop(1, 'rgba(150,120,70,0)'); g.save(); g.translate(Math.random() * w, Math.random() * h); g.scale(1, .6 + Math.random() * .6); g.fillStyle = gr; g.fillRect(-30, -30, 60, 60); g.restore(); }
    });
    M.linen.map = texOf(c, { rep: 5 }); M.linen.bumpMap = texOf(c, { srgb: false, rep: 5 }); M.linen.bumpScale = .8; M.linen.color.set(0xffffff); M.linen.needsUpdate = true; }
  wearEnamel(M.fridge, 0xDAD4C4, 7, { grime: .16, chips: 9 });
  // realism sweep (tools and dishes up close): the glazed mugs and jars, and the dark enamel pot, get used glaze (grime in the
  // rim and foot, chips, crazing) instead of a flat plastic colour; the mattress is striped ticking; vegetables and the whetstone
  // get their own surfaces
  /* no chips on these: on a lathe the texture's side edges meet at the seam, where two chips side by side read as a pair of eyes */
  wearEnamel(M.glazeBlue, 0x7F9DB4, 21, { grime: .12, chips: 0 }); wearEnamel(M.glazeCream, 0xEADDBE, 22, { grime: .14, chips: 0 }); wearEnamel(M.enamelDark, 0x4A5058, 23, { grime: .1, chips: 0 });
  tickingOf(M.mattress); /* a well-used old fridge: grime in the edges, chips, crazing */
  scanWood(M.wood, 'wood-floor.jpg', { color: 0xF2DCC4 }); scanWood(M.woodLight, 'wood-wall.jpg', { color: 0xE6C49C }); scanWood(M.woodDark, 'wood-dark.jpg', { w: 256, h: 512, color: 0xC49470, bump: 1.6 });
  varyWood(M.wood); workTops(varyWood(M.woodLight)); varyWood(M.woodDark, .7); // (Planks thread) every piece its own tone
  return M;
}

// ---------------- merge static meshes per material (keeps draw calls low) ----------------
const STD2 = new Map(); const std2 = (c) => { if (!STD2.has(c)) STD2.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: .85 })); return STD2.get(c); }; // shared per colour: fewer materials, fewer merged meshes
// perf: every colour-only standard material is drawn through one shared vertex-coloured material per (roughness band, metal or
// not, env-lit or not, side). bake() and the global static merge both use it, so most objects end up one or two draw calls.
// ---------- perf: one texture atlas for the small textured props (rugs, the picture, labels, cloths) ----------
// Each of them was its own draw call only because of its own texture. A material that has nothing but a colour map
// (opaque, no bump/normal/emissive, not live) is drawn into one atlas: its UVs (after the map's repeat/offset) are
// remapped into its tile, repeats are baked by tiling the image in the tile, and colour, roughness and metalness ride in
// the vertex attributes exactly as in plainV (same shader trick), so they all merge into one mesh. A texture that a
// Fal image replaces later (upgrade()) is redrawn into its tile when it arrives (poll).
const ATL = (() => {
  const NOATL = typeof location !== 'undefined' && /[?&]noatlas/.test(location.search); /* debug: A/B against the separate textures */
  const src = new Map(); /* texture -> { t, gs: [{g, uv0}], u0, u1, v0, v1 } */ let mat = null, cv = null, tex = null; const PAD = 6;
  const ok = m => m && m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && m.map && m.map.image && !m.bumpMap && !m.normalMap && !m.roughnessMap && !m.metalnessMap && !m.alphaMap && !m.aoMap && !m.emissiveMap && !m.lightMap && !m.transparent && !m.alphaTest && !m.polygonOffset && !m.vertexColors && !m.userData.keep && m.userData.env0 === undefined && m.emissive.getHex() === 0 && m.side !== THREE.BackSide && m.map.rotation === 0 && !NIGHT_METALS.includes(m) && !m.envMap && m.metalness < .3; /* no env map: an env-lit atlas made the rugs and barrels glow orange at night (the room's IBL never dims) */
  const api = {
    take(m, g) { if (NOATL || !ok(m) || !g.attributes.uv) return false; const t = m.map; t.updateMatrix(); const uv = g.attributes.uv, e = t.matrix.elements; let s = src.get(t);
      if (!s) src.set(t, s = { t, gs: [], u0: 1e9, u1: -1e9, v0: 1e9, v1: -1e9, img: null });
      const a = new Float32Array(uv.count * 2); for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); const x = e[0] * u + e[3] * v + e[6], y = e[1] * u + e[4] * v + e[7]; a[i * 2] = x; a[i * 2 + 1] = y; s.u0 = Math.min(s.u0, x); s.u1 = Math.max(s.u1, x); s.v0 = Math.min(s.v0, y); s.v1 = Math.max(s.v1, y); }
      if (s.u1 - s.u0 > 6 || s.v1 - s.v0 > 6) return false; /* a long repeated strip stays on its own texture */ s.gs.push({ g, a }); return true; },
    mat() { if (!mat) { mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, side: THREE.DoubleSide }); mat.userData.atlas = true;
        mat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float vmet; varying float vMet;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMet = vmet;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMet;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * clamp(vColor.a, .04, 1.);').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMet;\n//#include <metalnessmap_fragment>'); }; /* the commented include stays as the anchor rain.js's wet hook inserts after (it found none: merged props never got wet) */
        mat.customProgramCacheKey = () => 'atlasV'; } return mat; },
    // tile size: the texture's own pixels per repeat, at most 512
    build() { if (!src.size) return; const L = [...src.values()].filter(s => s.gs.length);
      for (const s of L) { let iw = s.t.image.width || 256, ih = s.t.image.height || 256; if (Math.max(iw, ih) <= 2 * Math.min(iw, ih)) iw = ih = Math.max(iw, ih); /* a square Fal image may replace a 1:2 canvas */ const ru = Math.max(.05, s.u1 - s.u0), rv = Math.max(.05, s.v1 - s.v0);
        let wm = 0; for (const { g } of s.gs) { g.computeBoundingBox(); const z = g.boundingBox.getSize(new THREE.Vector3()); wm = Math.max(wm, z.x, z.y, z.z); } /* a Fal image may replace a small canvas later: at least ~300 px per metre */
        let w = Math.min(500, Math.max(iw * ru, wm * 300)), h = Math.min(500, Math.max(ih * rv, wm * 300 * rv / ru)); const k = Math.min(1, 500 / Math.max(w, h)); /* 500 + padding: four in a 2048 row */ s.w = Math.max(16, Math.round(w * k)); s.h = Math.max(16, Math.round(h * k)); }
      // shelf packing, tallest first: 1024², else 2048 x 1024, and only then shrink everything until it fits
      let sc = 1, W = 1024, H = 1024;
      for (let tries = 0; tries < 8; tries++) { if (tries === 1 && sc === 1 && W === 1024) { W = 2048; sc = 1.0001; } let x = 0, y = 0, rowH = 0, fit = true; for (const s of [...L].sort((a, b) => b.h - a.h)) { const w = Math.round(s.w * sc) + 2 * PAD, h = Math.round(s.h * sc) + 2 * PAD; if (x + w > W) { x = 0; y += rowH; rowH = 0; } if (y + h > H) { fit = false; break; } s.px = x + PAD; s.py = y + PAD; s.pw = w - 2 * PAD; s.ph = h - 2 * PAD; x += w; rowH = Math.max(rowH, h); } if (fit) break; if (tries) sc *= .85; }
      cv = document.createElement('canvas'); cv.width = W; cv.height = H; tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; api.mat().map = tex;
      for (const s of L) { api.draw(s);
        // remap: atlas u = (px + (u'-u0)/(u1-u0)*pw)/W ; v: flipY, the tile's bottom is v0
        for (const { g, a } of s.gs) { const uv = g.attributes.uv; const du = Math.max(1e-6, s.u1 - s.u0), dv = Math.max(1e-6, s.v1 - s.v0);
          for (let i = 0; i < uv.count; i++) uv.setXY(i, (s.px + (a[i * 2] - s.u0) / du * s.pw) / W, 1 - (s.py + s.ph - (a[i * 2 + 1] - s.v0) / dv * s.ph) / H); uv.needsUpdate = true; } }
      tex.needsUpdate = true; api.list = L.map(s => (s.t.image.src ? s.t.image.src.split('/').pop() : 'canvas' + s.t.image.width + 'x' + s.t.image.height) + ' ' + s.pw + 'x' + s.ph); },
    // the image repeated over the tile's uv range, also into the padding (so mip levels don't bleed in the neighbours)
    draw(s) { const x = cv.getContext('2d'), img = s.t.image; s.img = img; const du = Math.max(1e-6, s.u1 - s.u0), dv = Math.max(1e-6, s.v1 - s.v0); const cw = s.pw / du, ch = s.ph / dv;
      x.save(); x.beginPath(); x.rect(s.px - PAD, s.py - PAD, s.pw + 2 * PAD, s.ph + 2 * PAD); x.clip();
      const ue = PAD / cw, ve = PAD / ch;
      for (let ku = Math.floor(s.u0 - ue); ku < Math.ceil(s.u1 + ue); ku++) for (let kv = Math.floor(s.v0 - ve); kv < Math.ceil(s.v1 + ve); kv++)
        x.drawImage(img, s.px + (ku - s.u0) * cw, s.py + (s.v1 - (kv + 1)) * ch, cw, ch);
      x.restore(); },
    poll(dt) { if (!tex || (api._t = (api._t || 0) - dt) > 0) return; api._t = .5; let ch = false; for (const s of src.values()) if (s.img && s.t.image !== s.img && s.t.image && (s.t.image.complete !== false)) { api.draw(s); ch = true; } if (ch) tex.needsUpdate = true; },
    get texture() { return tex; } };
  return api; })();
const PLAINV = new Map(); let ENV0 = null; /* the shared env map, taken from the metal materials */
// roughness rides in the vertex colour's alpha (opaque materials ignore alpha), so one material covers every roughness
function plainOf(m) {
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.polygonOffset || m.alphaTest || m.map || m.bumpMap || m.normalMap || m.transparent || m.vertexColors || m.userData.keep || m.emissive.getHex() !== 0) return null;
  const env = m.envMap || ENV0; const side = m.side === THREE.BackSide ? THREE.BackSide : THREE.DoubleSide; const key = `vc|${side}`; /* one material for env-lit and plain colours: on rough parts the reflection is negligible */
  if (!PLAINV.has(key)) { const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMap: env || null, envMapIntensity: .9, side }); /* metalness and env reflections kept per band (Critic P8: enamel and the fridge went dark without them) */ pm.userData.plainV = true;
    pm.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float vmet; varying float vMet;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMet = vmet;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMet;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * clamp(vColor.a, .04, 1.);').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMet;\n//#include <metalnessmap_fragment>'); }; /* anchor for rain.js's wet hook, as in the atlas */
    pm.customProgramCacheKey = () => 'plainV'; PLAINV.set(key, pm); }
  return PLAINV.get(key); }
// perf: round parts get as many sides as their real size needs (about one side per 6-7 mm of radius, at least 8), so a 4 cm jar
// is not built like a barrel. Rebuilt from the generator's own parameters; anything else passes through unchanged.
const _lodWS = new THREE.Vector3();
const _lodOK = new WeakMap();
function lodGeo(o) { const g = o.geometry, P = g.parameters; if (FINE || !P || !g.attributes.position) return g; o.getWorldScale(_lodWS); const sa = [Math.abs(_lodWS.x), Math.abs(_lodWS.y), Math.abs(_lodWS.z)].sort((a, b) => a - b), sc = sa[1] || 1; const segs = (r, n, mn = 8) => Math.max(Math.min(mn, n), Math.min(n, Math.ceil(r * sc * 100)));
  const T = THREE; let mk = null, n0 = 0, n1 = 0;
  switch (g.type) {
    case 'CylinderGeometry': n0 = P.radialSegments; n1 = segs(Math.max(P.radiusTop, P.radiusBottom), n0); mk = n => new T.CylinderGeometry(P.radiusTop, P.radiusBottom, P.height, n, P.heightSegments, P.openEnded, P.thetaStart, P.thetaLength); break;
    case 'ConeGeometry': n0 = P.radialSegments; n1 = segs(P.radius, n0); mk = n => new T.ConeGeometry(P.radius, P.height, n, P.heightSegments, P.openEnded, P.thetaStart, P.thetaLength); break;
    case 'SphereGeometry': n0 = P.widthSegments; n1 = segs(P.radius, n0); mk = n => new T.SphereGeometry(P.radius, n, n === n0 ? P.heightSegments : Math.max(Math.min(6, P.heightSegments), Math.min(P.heightSegments, Math.ceil(n * .66))), P.phiStart, P.phiLength, P.thetaStart, P.thetaLength); break;
    case 'TorusGeometry': n0 = P.tubularSegments; n1 = segs(P.radius, n0); mk = n => new T.TorusGeometry(P.radius, P.tube, n === n0 ? P.radialSegments : segs(P.tube, P.radialSegments, 4), n, P.arc); break;
    case 'CircleGeometry': n0 = P.segments; n1 = segs(P.radius, n0); mk = n => new T.CircleGeometry(P.radius, n, P.thetaStart, P.thetaLength); break;
    case 'LatheGeometry': { let r = 0; for (const p of P.points) r = Math.max(r, Math.abs(p.x)); n0 = P.segments; n1 = segs(r, n0); mk = n => new T.LatheGeometry(P.points, n, P.phiStart, P.phiLength); break; }
    default: return g; }
  if (n1 >= n0) return g;
  // only when the geometry is exactly what its generator made (not translated, scaled or bent afterwards)
  let ok = _lodOK.get(g); if (ok === undefined) { const ref = mk(n0), a = ref.attributes.position.array, b = g.attributes.position.array; ok = a.length === b.length; for (let k = 0; ok && k < a.length; k += 7) if (Math.abs(a[k] - b[k]) > 1e-6) ok = false; ref.dispose(); _lodOK.set(g, ok); }
  return ok ? mk(n1) : g; }
function colorize(g, c, a, met) { if (met !== undefined) g.setAttribute('vmet', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(met), 1)); const n = g.attributes.position.count, k = a === undefined ? 3 : 4, ca = new Float32Array(n * k); for (let i = 0; i < n; i++) { ca[i * k] = c.r; ca[i * k + 1] = c.g; ca[i * k + 2] = c.b; if (k === 4) ca[i * k + 3] = a; } g.setAttribute('color', new THREE.Float32BufferAttribute(ca, k)); }
// bake(group, keepCast): merge the group's static meshes (not inside a userData.live node, not hidden) into one mesh per material.
// keepCast: also split by each part's own castShadow flag (the late pass, after small parts were set not to cast).
function bake(group, keepCast = false) {
  /* ancestors too: lodGeo's getWorldScale refreshes the parents' world matrices, so a stale parent here would shift every rebuilt part (the telescope tube floated 1.2 m up) */
  group.updateWorldMatrix(true, true); const inv = group.matrixWorld.clone().invert(); const by = new Map(); const kill = [];
  group.traverse(o => { if (!o.isMesh || o === group || Array.isArray(o.material) || o.userData.live || (keepCast && o.material.userData.keep) || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || o.userData.keepMesh) return; if (o.morphTargetInfluences) return; let p = o.parent; while (p && p !== group) { if (p.userData.live || !p.visible) return; p = p.parent; } let g0 = lodGeo(o), g = g0.index ? g0.toNonIndexed() : g0.clone(); if (g0 !== o.geometry) g0.dispose(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'vmet'].includes(k)) g.deleteAttribute(k); if (g.attributes.color && !o.material.vertexColors) g.deleteAttribute('color'); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); let mat = o.material; const pm = plainOf(mat); if (pm) { if (mat.flatShading) g.computeVertexNormals(); colorize(g, mat.color, mat.roughness, mat.metalness); mat = pm; } else if (mat.vertexColors && !g.attributes.color) colorize(g, new THREE.Color(1, 1, 1)); const key = keepCast ? mat.uuid + (o.castShadow ? 's' : 'n') + (o.receiveShadow ? 'r' : '') : mat.uuid; if (!by.has(key)) by.set(key, { mat, cast: o.castShadow, rec: o.receiveShadow, gs: [], os: [] }); by.get(key).gs.push(g); by.get(key).os.push(o); });
  for (const e of by.values()) { if (keepCast && e.gs.length < 2) { e.gs[0].dispose(); e.skip = true; continue; } e.os.forEach(o => o.removeFromParent()); }
  for (const { mat, cast, rec, gs, skip } of by.values()) { if (skip) continue; const m = new THREE.Mesh(mergeGeometries(gs, false), mat); m.castShadow = keepCast ? cast : true; m.receiveShadow = keepCast ? rec : true; group.add(m); gs.forEach(g => g.dispose()); }
  return group;
}

// ---------------- small shared parts ----------------
function W(parent, w, h, d, x, y, z, { mat = M.wood, r = .016, grain, rx = 0, ry = 0, rz = 0 } = {}) {
  if (grain === undefined) grain = w >= h && w >= d ? 0 : (h >= d ? 1 : 2);
  return add(parent, boxUV(r === 0 ? new THREE.BoxGeometry(w, h, d) : rb(w, h, d, r), grain), mat, x, y, z, rx, ry, rz); // r 0: plain box for hidden parts (perf)
}
function knob(parent, x, y, z, mat = M.brass, r = .018) { add(parent, new THREE.SphereGeometry(r, 14, 10), mat, x, y, z + r * .6); add(parent, new THREE.CylinderGeometry(r * .45, r * .55, r * .9, 10), mat, x, y, z + r * .1, Math.PI / 2); }
// frame-and-panel cabinet door: proud stiles and rails, a recessed panel and a raised field with a real chamfer (Critic N5)
function panelDoor(parent, w, h, x, y, z, mat = M.wood) { const f = Math.min(.055, w * .16), d = .024;
  W(parent, w - .004, h - .004, .012, x, y, z + .006, { mat, r: .004, grain: 1 }); // back sheet / recessed panel
  for (const s of [-1, 1]) { W(parent, f, h, d, x + s * (w - f) / 2, y, z + d / 2, { mat, r: .007, grain: 1 }); W(parent, w - 2 * f + .004, f, d, x, y + s * (h - f) / 2, z + d / 2, { mat, r: .007, grain: 0 }); }
  const fw = w - 2 * f - .03, fh = h - 2 * f - .03; if (fw > .04 && fh > .04) { const sh = new THREE.Shape(); sh.moveTo(-fw / 2 + .02, -fh / 2 + .02); sh.lineTo(fw / 2 - .02, -fh / 2 + .02); sh.lineTo(fw / 2 - .02, fh / 2 - .02); sh.lineTo(-fw / 2 + .02, fh / 2 - .02); sh.lineTo(-fw / 2 + .02, -fh / 2 + .02);
    const e = new THREE.ExtrudeGeometry(sh, { depth: .004, bevelEnabled: true, bevelSize: .02, bevelThickness: .008, bevelSegments: 1 }); boxUV(e, 1); add(parent, e, mat, x, y, z + .014); } }
function screw(parent, x, y, z) { add(parent, new THREE.CylinderGeometry(.006, .006, .004, 8), M.iron, x, y, z, Math.PI / 2); }

// draped cloth: a plane laid over a w×d top that falls `drop` over the long sides
function drapeGeo(len, wid, drop, { r = .05, wrinkle = .01, endDrop = 0, puff = 0 } = {}) {
  const nx = puff ? 32 : 24, nz = puff ? 20 : 16; const geo = new THREE.PlaneGeometry(1, 1, nx, nz); const p = geo.attributes.position, uv = geo.attributes.uv;
  const fold = (s, half) => { const a = Math.abs(s), arcL = r * Math.PI / 2; if (a <= half - r) return [s, 0]; const d = a - (half - r); if (d < arcL) { const th = d / r; return [Math.sign(s) * (half - r + (r + .01) * Math.sin(th)), -(r - r * Math.cos(th))]; } return [Math.sign(s) * (half + .01), -r - (d - arcL)]; };
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i), v = uv.getY(i); const s = (v - .5) * (wid + 2 * drop); let [z, y] = fold(s, wid / 2); let x = -len / 2 + u * (len + endDrop);
    if (x < -len / 2) { } if (endDrop && x > len / 2) { const d = x - len / 2; x = len / 2 + .004; y += -d; }
    const flat = y > -.001; y += flat ? wrinkle * (.5 + .5 * Math.sin(x * 11 + z * 4) * Math.sin(z * 9 + 1)) : 0; if (!flat) z += Math.sign(z) * wrinkle * (1.2 + Math.sin(x * 17));
    // quilted puff: each patch (4 per texture repeat) bulges up between its stitched seams
    if (puff) { const fu = ((x / .9 * 4) % 1 + 1) % 1, fv = ((s / .9 * 4) % 1 + 1) % 1; const b = Math.pow(Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv), .6); if (flat) y += puff * b; else z += Math.sign(z) * puff * .7 * Math.pow(Math.sin(Math.PI * fu), .6); }
    p.setXYZ(i, x, y, z); uv.setXY(i, x / .9, s / .9); // v follows the unfolded cloth width, so the hanging sides are not smeared
  }
  geo.computeVertexNormals(); return geo;
}
function pillowGeo(w, h, d) { const g = rb(w, h, d, Math.min(w, h, d) * .45, 3); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const nx = p.getX(i) / (w / 2), nz = p.getZ(i) / (d / 2); const k = 1 - .55 * Math.pow(Math.max(Math.abs(nx), Math.abs(nz)), 3); p.setY(i, p.getY(i) * k); p.setZ(i, p.getZ(i) * (1 + .04 * Math.sin(nx * 3)));
    /* cloth, not a moulded block: creases fanning in from the corners and edges, a soft dent where the head lay */
    const y = p.getY(i), top = y > 0 ? 1 : .35, an = Math.atan2(nz, nx), e = Math.min(1, Math.max(Math.abs(nx), Math.abs(nz)));
    const cr = Math.pow(Math.max(0, Math.sin(an * 9 + Math.sin(an * 3) * 1.3)), 6) * Math.pow(e, 2.5) * .018 + Math.sin(nx * 7.3 + nz * 4.1) * Math.sin(nz * 6.2 - nx * 2.3) * .005;
    const dent = y > 0 ? Math.exp(-((nx + .1) ** 2 * 4 + (nz - .05) ** 2 * 3.5)) * h * .22 : 0;
    p.setY(i, p.getY(i) - Math.sign(y) * cr * top - dent); }
  g.computeVertexNormals(); return g; }

// ================= builders =================
function bunkBed() {
  const g = new THREE.Group(); const L = 2.0, D = .95, H = 1.78, p = .085; const lv = [.30, 1.07]; const info = { levels: [] };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { W(g, p, H, p, sx * (L / 2 - p / 2), H / 2, sz * (D / 2 - p / 2), { r: .016, grain: 1 }); add(g, rb(p + .012, .03, p + .012, .01), M.wood, sx * (L / 2 - p / 2), H + .012, sz * (D / 2 - p / 2)); }
  for (const y of lv) {
    for (const sz of [-1, 1]) W(g, L - 2 * p + .01, .13, .055, 0, y, sz * (D / 2 - .035));
    for (const sx of [-1, 1]) W(g, .055, .13, D - 2 * p + .01, sx * (L / 2 - .035), y, 0);
    for (let i = 0; i < 9; i++) W(g, .13, .022, D - .12, -L / 2 + .16 + i * (L - .32) / 8, y + .03, 0, { mat: M.woodDark, r: 0, grain: 2 }); // slats under the mattress: plain boxes
    const top = y + .045 + .15; add(g, rb(L - .17, .15, D - .15, .055, 2), M.mattress, 0, y + .045 + .075, 0);
    // pillow at the head end (+x)
    add(g, pillowGeo(.36, .16, .6), M.linen, L / 2 - .28, top + .05, 0, 0, 0, -.12);
    // quilt over the foot two-thirds, folded sheet edge at its head
    const qL = L - .62; const q = add(g, drapeGeo(qL, D - .15, .12, { wrinkle: .008, puff: .026 }), M.quilt, -L / 2 + .08 + qL / 2, top + .012, 0); q.castShadow = false;
    add(g, rb(.09, .05, D - .12, .024, 3), M.linen, -L / 2 + .08 + qL + .02, top + .02, 0);
    info.levels.push({ top: top + .012, x0: -L / 2 + .09, x1: L / 2 - .09, z0: -(D - .15) / 2, z1: (D - .15) / 2, head: 1 });
  }
  // head and foot boards
  for (const sx of [-1, 1]) for (const y of [.62, 1.42, 1.62]) W(g, .05, .11, D - 2 * p + .01, sx * (L / 2 - .04), y, 0);
  // upper guard rail on the front with a short post
  W(g, L * .58, .09, .05, -L * .21, 1.4, D / 2 - .035); W(g, .06, .36, .06, -L * .21 + L * .29, 1.28, D / 2 - .035, { grain: 1 });
  // ladder at the front right
  // (Pavel: it used to lean into the top mattress.) Now the foot stands out front and the top rests against the outside of the
  // upper frame rail, with two iron hooks over that rail, so the rails stay in front of the mattress all the way up.
  { const lg = new THREE.Group(); lg.position.set(L / 2 - .3, 0, D / 2 + .26); lg.rotation.x = -.16; g.add(lg); for (const sx of [-1, 1]) W(lg, .05, 1.52, .045, sx * .16, .76, 0, { grain: 1 }); for (let i = 0; i < 5; i++) W(lg, .3, .04, .035, 0, .25 + i * .27, 0, { r: .008 });
    for (const sx of [-1, 1]) { const hy = (lv[1] + .09) / Math.cos(.16); add(lg, new THREE.TorusGeometry(.03, .007, 6, 12, Math.PI), M.iron, sx * .16, hy, -.045, 0, Math.PI / 2, 0); } }
  bake(g); g.userData.info = info; return g;
}
function slippers() { const g = new THREE.Group();
  const sole = new THREE.Shape(); sole.moveTo(0, -.12); sole.bezierCurveTo(.05, -.12, .055, -.04, .05, .02); sole.bezierCurveTo(.05, .09, .03, .13, 0, .13); sole.bezierCurveTo(-.03, .13, -.05, .09, -.05, .02); sole.bezierCurveTo(-.055, -.04, -.05, -.12, 0, -.12);
  const soleG = EX(sole, .014, .004); soleG.rotateX(Math.PI / 2); soleG.translate(0, .009, 0);
  const capG = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); const lining = std2(0xE8D8B8);
  for (const [x, a] of [[-.07, .25], [.08, -.1]]) { const s = new THREE.Group(); s.position.set(x, 0, 0); s.rotation.y = a; g.add(s); add(s, soleG, M.rubber); add(s, soleG, M.felt, 0, .012, 0).scale.set(.94, .5, .94);
    const cap = add(s, capG, M.felt, 0, .02, .055); cap.scale.set(.052, .045, .075); const hole = add(s, new THREE.CircleGeometry(1, 18), lining, 0, .0215, -.02, -Math.PI / 2); hole.scale.set(.04, .05, 1);
    add(s, new THREE.TorusGeometry(.045, .006, 6, 20, Math.PI), M.felt, 0, .022, -.02, -Math.PI / 2, 0, 0).scale.set(1, 1.15, 1); }
  return bake(g); }
function basket() { const g = new THREE.Group();
  // real wicker relief (close zoom: the flat dotted texture read as printed): the outer wall is cut into 1.6 cm rows of strands
  // that go over and under 18 upright stakes, so each strand bulges out between the stakes, row by row offset
  { const prof = [[0, 0], [.17, 0], [.2, .05]]; for (let y = .06; y <= .3001; y += .008) prof.push([.2 + (y - .05) / .25 * .02, y]); prof.push([.215, .34], [.2, .34], [.19, .06], [0, .06]);
    const lg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 72); const P = lg.attributes.position; /* lathe() caps at 16 around: too few for the stakes */
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = Math.hypot(x, z); if (y < .055 || y > .305 || r < .195) continue; const a = Math.atan2(z, x);
      const row = Math.floor((y - .055) / .016), fy = ((y - .055) / .016) % 1, ph = a * 9 / Math.PI + (row % 2) * 1; // 18 stakes
      const k = 1 + .028 * Math.max(0, Math.sin(ph * Math.PI)) * Math.sin(fy * Math.PI) - .012 * (fy < .12 || fy > .88 ? 1 : 0); P.setX(i, x * k); P.setZ(i, z * k); }
    lg.computeVertexNormals(); add(g, lg, M.weave); } add(g, new THREE.TorusGeometry(.218, .018, 8, 32), M.weave, 0, .34, 0, Math.PI / 2);
  // a checked cloth thrown over the contents: humped over what is inside, sagging over the rim in soft folds (was a smooth white dome)
  { const cg = new THREE.PlaneGeometry(.52, .52, 26, 26); cg.rotateX(-Math.PI / 2); const P = cg.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x); let y;
      if (r < .2) y = .345 + .07 * (1 - Math.pow(r / .2, 2)) + .01 * Math.sin(x * 40) * Math.sin(z * 33);
      else { const o = r - .2; y = .345 - Math.min(.13, o * 1.4) + .012 * Math.sin(a * 7 + 1) * Math.min(1, o / .05); const k = (.226 + o * .3) / r; /* a short skirt over the rim, never down to the floor */ P.setX(i, x * k); P.setZ(i, z * k); } P.setY(i, y); }
    cg.computeVertexNormals(); const tm = new THREE.MeshStandardMaterial({ map: texOf(towelCanvas()), roughness: .95, side: THREE.DoubleSide, color: 0xBDB2A2 }); /* a washed, sun-faded check (dulled again: at closest zoom it read as a fresh picnic cloth) */ tm.map.repeat.set(2, 2); add(g, cg, tm, 0, 0, 0, 0, .4, 0); }
  return bake(g); }
function chair() {
  const g = new THREE.Group(); const S = .46, w = .44, d = .42;
  for (const sx of [-1, 1]) { W(g, .045, S - .04, .045, sx * .18, (S - .04) / 2, d / 2 - .04, { grain: 1, mat: M.woodDark }); W(g, .045, .95, .045, sx * .18, .475, -d / 2 + .04, { grain: 1, mat: M.woodDark, rx: -.05 }); }
  W(g, w, .045, d, 0, S - .0225, 0, { r: .014 });
  for (const sz of [-1, 1]) W(g, .34, .03, .025, 0, .16, sz * (d / 2 - .04), { mat: M.woodDark, r: .008 }); for (const sx of [-1, 1]) W(g, .025, .03, .3, sx * .18, .2, 0, { mat: M.woodDark, r: .008 });
  for (const y of [.9, .7]) W(g, .4, y > .8 ? .09 : .05, .03, 0, y, -d / 2 + .02 - (y - S) * .05, { r: .012 });
  for (const x of [-.08, 0, .08]) W(g, .035, .17, .02, x, .8, -d / 2 + .02 - .015, { r: .008, grain: 1 });
  bake(g); g.userData.info = { seat: S }; return g;
}
function table() { const g = new THREE.Group(); W(g, .82, .04, .56, 0, .72, 0, { mat: M.woodLight, r: .019 }); for (const [x, z] of [[-.35, -.22], [.35, -.22], [-.35, .22], [.35, .22]]) W(g, .05, .7, .05, x, .35, z, { mat: M.woodDark, grain: 1 }); for (const sz of [-1, 1]) W(g, .66, .08, .025, 0, .66, sz * .22, { mat: M.woodDark }); for (const sx of [-1, 1]) W(g, .025, .08, .4, sx * .35, .66, 0, { mat: M.woodDark }); return bake(g); }
function mug(mat = M.glazeBlue) { const g = new THREE.Group(); add(g, lathe([[0, .002], [.035, 0], [.04, .01], [.042, .09], [.038, .09], [.036, .012], [0, .012]], 20), mat); add(g, new THREE.TorusGeometry(.024, .007, 8, 16, Math.PI), mat, .042, .05, 0, 0, 0, -Math.PI / 2); return g; }
function candle() { const g = new THREE.Group(); const fm = new THREE.MeshBasicMaterial({ color: 0xFFB050, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }); const fl = new THREE.Mesh(lathe([[0, 0], [.007, .006], [.008, .016], [.004, .03], [0, .038]], 10), fm); fl.position.y = .107; fl.userData.live = true; g.add(fl); g.userData.flame = fm; add(g, lathe([[0, 0], [.05, 0], [.055, .012], [.03, .016], [0, .016]]), M.brass); { const wax = std2(0xEDE3CC); wax.roughness = .55; add(g, lathe([[0, .016], [.018, .016], [.018, .1], [.0165, .104], [.012, .1], [.005, .101], [0, .1]], 18), wax); for (const [a, l] of [[.4, .035], [2.3, .022], [4.1, .045]]) add(g, new THREE.CapsuleGeometry(.0035, l, 3, 6), wax, Math.cos(a) * .018, .1 - l / 2 - .004, Math.sin(a) * .018); add(g, new THREE.CylinderGeometry(.0012, .0012, .012, 4), std2(0x1A1410), 0, .106, 0, .15); add(g, new THREE.CylinderGeometry(.028, .03, .004, 16), wax, 0, .018, 0); } /* [bedroom round] wax with a melted dip, runs down the side, a burnt wick and a puddle in the dish (it was a linen-textured tube) */ return g; }

// a book: covers on a hinge, page blocks and one page that can turn
function book({ w = .145, h = .205, cover = M.covers[1], open = 1 } = {}) {
  const g = new THREE.Group(); g.userData.live = true; const t = .012;
  const L = new THREE.Group(), Rr = new THREE.Group(); g.add(L, Rr);
  add(L, rb(w + .008, .004, h + .01, .002), cover, -(w + .008) / 2, .002, 0); add(L, rb(w, t, h, .002), M.pageEdge, -w / 2 - .002, .004 + t / 2, 0);
  add(Rr, rb(w + .008, .004, h + .01, .002), cover, (w + .008) / 2, .002, 0); add(Rr, rb(w, t, h, .002), M.pageEdge, w / 2 + .002, .004 + t / 2, 0);
  add(g, new THREE.CylinderGeometry(.012, .012, h + .01, 10, 1, true, 0, Math.PI), cover, 0, .006, 0, Math.PI / 2, 0, Math.PI);
  const pgL = add(L, new THREE.PlaneGeometry(w, h), M.paper, -w / 2 - .002, .004 + t + .0005, 0, -Math.PI / 2); pgL.receiveShadow = true;
  const pgR = add(Rr, new THREE.PlaneGeometry(w, h), M.paper, w / 2 + .002, .004 + t + .0005, 0, -Math.PI / 2);
  const seg = 12; const pg = new THREE.PlaneGeometry(w, h, seg, 1); pg.translate(w / 2, 0, 0); pg.rotateX(-Math.PI / 2);
  const page = add(g, pg, M.paper, .002, .004 + t + .002, 0); page.castShadow = false; page.visible = false;
  const base = pg.attributes.position.array.slice();
  const st = { open, turning: 0, a: 0, page, pageL: pgL, pageR: pgR };
  function setOpen(k) { st.open = k; const a = (1 - k) * (Math.PI / 2 - .02); L.rotation.z = -a; Rr.rotation.z = a; }
  function shapePage(a) { // a: 0 = lying on the right, PI = on the left; the free edge lags and curls
    const p = pg.attributes.position; const c = -.75 * Math.sin(a);
    for (let i = 0; i < p.count; i++) { const u = clamp01(base[i * 3] / w); let x = 0, y = 0; const n = 16; for (let k = 0; k < n; k++) { const uu = (k + .5) / n * u; const phi = a + c * uu * (1.6 - uu); x += Math.cos(phi) * u * w / n; y += Math.sin(phi) * u * w / n; } p.setXYZ(i, x, y, base[i * 3 + 2]); }
    p.needsUpdate = true; pg.computeVertexNormals();
  }
  function turn(dir = 1) { if (st.turning) return false; st.turning = dir; st.a = 0; page.visible = true; shapePage(dir > 0 ? 0 : Math.PI); return true; }
  // openTo(k, sec): the covers swing to k (0 closed, 1 flat open) with an ease, for picking up / putting down
  const ot = { from: open, to: open, t: 1, d: .6 };
  function openTo(k, d = .6) { ot.from = st.open; ot.to = clamp01(k); ot.t = 0; ot.d = Math.max(.05, d); }
  function update(dt) { if (ot.t < 1) { ot.t = Math.min(1, ot.t + dt / ot.d); const e = ot.t * ot.t * (3 - 2 * ot.t); setOpen(ot.from + (ot.to - ot.from) * e); } if (!st.turning) return; st.a = Math.min(1, st.a + dt / .85); const e = st.a < .5 ? 2 * st.a * st.a : 1 - Math.pow(-2 * st.a + 2, 2) / 2; const a = st.turning > 0 ? e * Math.PI : (1 - e) * Math.PI; shapePage(a); if (st.a >= 1) { st.turning = 0; page.visible = false; } }
  // world position of the corner a hand would lift to turn the page
  function corner(target = V()) { return g.localToWorld(target.set(w * .95, .02, h * .4)); }
  setOpen(open);
  g.userData.book = { setOpen, openTo, turn, update, corner, state: st };
  return g;
}
const clamp01 = x => Math.max(0, Math.min(1, x));
function closedBook(w, h, d, mat) { const g = new THREE.Group(); add(g, rb(w, h, d, .004), mat, 0, h / 2, 0); add(g, rb(w - .006, h - .01, d - .004, .002), M.pageEdge, .004, h / 2, 0); for (const y of [.2, .8]) add(g, new THREE.BoxGeometry(.003, .008, d + .002), M.brass, -w / 2, h * y, 0); return g; }

function stove() {
  const g = new THREE.Group(); const Wd = .8, D = .62, legH = .08, top = .9; const ow = Wd - .2, oy0 = .17, oy1 = .66;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, lathe([[0, 0], [.03, 0], [.035, .02], [.025, legH]], 12), M.iron, sx * (Wd / 2 - .06), 0, sz * (D / 2 - .06));
  for (const sx of [-1, 1]) add(g, rb(.1, top - legH - .03, D, .02, 3), M.enamel, sx * (Wd / 2 - .05), legH + (top - legH - .03) / 2, 0);
  add(g, rb(Wd - .18, oy0 - legH, D, .01), M.enamel, 0, legH + (oy0 - legH) / 2, 0);
  add(g, rb(Wd - .18, top - .03 - oy1, D, .01), M.enamel, 0, oy1 + (top - .03 - oy1) / 2, 0);
  add(g, rb(Wd - .18, oy1 - oy0, .04), M.enamel, 0, (oy0 + oy1) / 2, -D / 2 + .02);
  // oven cavity: inside faces only, glowing back wall and a rack
  add(g, new THREE.BoxGeometry(ow, oy1 - oy0, D - .06), M.darkInside, 0, (oy0 + oy1) / 2, .01);
  // fire: two small logs and live teardrop flames at the back of the cavity (flicker in update)
  for (const [x, a] of [[-.06, .35], [.07, -.3]]) add(g, new THREE.CylinderGeometry(.022, .025, ow * .55, 10), M.woodDark, x * .6, oy0 + .03, -D / 2 + .12, 0, a, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(ow * .32, ow * .34, .012, 18), M.fire, 0, oy0 + .006, -D / 2 + .14); // embers bed
  const fire = new THREE.Group(); fire.userData.live = true; fire.position.set(0, oy0 + .03, -D / 2 + .13); g.add(fire);
  const flameGeo = lathe([[0, 0], [.022, .01], [.028, .035], [.02, .07], [.008, .1], [0, .115]], 10);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xFFA040, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
  // perf: the six flames are one mesh; each vertex carries its flame's spot, speed and phase and the flicker runs in the vertex shader
  const flameU = { uT: { value: 0 }, uHeat: { value: 0 }, uSpread: { value: 1 } };   // uSpread (Lights): how far the fire has spread from the kindling at the left (0..1) const flames = [];
  { const fg = flameGeo.index ? flameGeo.toNonIndexed() : flameGeo; const gs = []; for (let i = 0; i < 6; i++) { const q = fg.clone(); const n = q.attributes.position.count; const fl = new Float32Array(n * 4); const fx = -.13 + i * .052 + rr(-.01, .01), fz = rr(-.03, .03), k = rr(.7, 1.3), ph = R() * 6.28;
      for (let v = 0; v < n; v++) fl.set([fx, fz, k, ph], v * 4); q.setAttribute('fl', new THREE.Float32BufferAttribute(fl, 4)); gs.push(q); }
    flameMat.onBeforeCompile = sh => { Object.assign(sh.uniforms, flameU); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 fl; uniform float uT, uHeat, uSpread;').replace('#include <begin_vertex>',
      'float fn = sin(uT * 9. * fl.z + fl.w) * .5 + sin(uT * 23. * fl.z + fl.w * 2.) * .3; vec3 transformed = position * vec3(1. + fn * .12, (.6 + uHeat * .7) * (1. + fn * .35), 1. + fn * .12); float fa = sin(uT * 5. + fl.w) * .12; transformed.xy = mat2(cos(fa), sin(fa), -sin(fa), cos(fa)) * transformed.xy; float thr = clamp((fl.x + .14) / .3, 0., 1.) * .8; transformed *= smoothstep(thr, thr + .2, uSpread); transformed.x += fl.x; transformed.z += fl.y;'); };   /* Lights: the flames catch one by one from the kindling (left) across the logs, and go out in the same order backwards */
    flameMat.customProgramCacheKey = () => 'ovenFlames'; const fm = new THREE.Mesh(mergeGeometries(gs, false), flameMat); fm.frustumCulled = false; fm.userData.live = true; fire.add(fm); }
  // an empty baking tray on the rack (critic P2 pass 22: buns sat in it all night over the embers; nobody bakes here, so it is empty) - rr calls kept so the random stream below stays the same
  { const tr = new THREE.Group(); tr.position.set(0, oy0 + .206, .02); g.add(tr); add(tr, rb(ow * .78, .012, D * .55, .004), M.iron, 0, .006, 0); for (let i = 0; i < 4; i++) rr(-.03, .03); }
  for (let i = 0; i < 7; i++) add(g, new THREE.CylinderGeometry(.004, .004, D - .1, 6), M.steel, -ow / 2 + .04 + i * (ow - .08) / 6, oy0 + .2, .02, Math.PI / 2);
  // cooktop, backsplash, burners
  add(g, rb(Wd + .02, .035, D + .02, .01), M.enamelDark, 0, top - .0175, 0);
  add(g, rb(Wd + .02, .16, .04, .012), M.enamel, 0, top + .08, -D / 2 + .01);
  for (const [x, z] of [[-.19, -.12], [.19, -.12], [-.19, .13], [.19, .13]]) {
    add(g, new THREE.CylinderGeometry(.065, .07, .012, 20), M.iron, x, top + .006, z);
    add(g, new THREE.TorusGeometry(.085, .008, 6, 24), M.iron, x, top + .02, z, Math.PI / 2);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 4; add(g, rb(.19, .012, .012, .004), M.iron, x, top + .026, z, 0, a); }
  }
  // control strip and knobs
  add(g, rb(Wd - .06, .1, .03, .01), M.enamelDark, 0, top - .09, D / 2 + .005);
  for (let i = 0; i < 4; i++) { const x = -.27 + i * .18; add(g, lathe([[0, 0], [.022, 0], [.024, .012], [.018, .03], [0, .032]], 16), M.chrome, x, top - .09, D / 2 + .02, Math.PI / 2); add(g, rb(.006, .03, .01, .002), M.rubber, x, top - .09, D / 2 + .055); }
  // oven door on a hinge at its bottom edge
  const door = new THREE.Group(); door.userData.live = true; door.position.set(0, oy0 - .005, D / 2); g.add(door);
  const dh = oy1 - oy0 + .03, dw = Wd - .1;
  // Lights (critic E14): the door is a frame round a real window. It was a solid slab with the glass laid on its face, so
  // nothing inside the oven could ever be seen and the glass read as a painted orange panel. Opening = the glass (dw-.2 x dh-.21).
  { const oy = dh / 2 - .015, oh = dh - .21, ow2 = dw - .2, top = oy + oh / 2, bot = oy - oh / 2, sw = (dw - ow2) / 2;
    add(door, rb(dw, dh - top, .035, .012, 3), M.enamel, 0, (dh + top) / 2, .0175); add(door, rb(dw, bot, .035, .012, 3), M.enamel, 0, bot / 2, .0175);
    for (const sx of [-1, 1]) add(door, rb(sw, oh + .002, .035, .006), M.enamel, sx * (dw - sw) / 2, oy, .0175);
    const iw = .02;   // the dark inner bead round the window
    for (const sy of [-1, 1]) add(door, rb(ow2 + 2 * iw, iw, .012, .004), M.enamelDark, 0, oy + sy * (oh + iw) / 2, .036);
    for (const sx of [-1, 1]) add(door, rb(iw, oh, .012, .004), M.enamelDark, sx * (ow2 + iw) / 2, oy, .036); }
  add(door, new THREE.PlaneGeometry(dw - .2, dh - .21), M.ovenGlass, 0, dh / 2 - .015, .0425);
  add(door, new THREE.CylinderGeometry(.011, .011, dw - .14, 12), M.chrome, 0, dh - .05, .075, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) add(door, new THREE.CylinderGeometry(.008, .008, .045, 8), M.chrome, sx * (dw / 2 - .1), dh - .05, .055, Math.PI / 2);
  { const tw = new THREE.MeshStandardMaterial({ map: texOf(towelCanvas()), roughness: .95, side: THREE.DoubleSide }); const t = add(door, drapeGeo(.2, .03, .2, { r: .016, wrinkle: .006 }), tw, -.12, dh - .05, .075); t.castShadow = false; }
  bake(door); // one mesh per material; the door group itself stays live (it swings)
  const glow = add(g, new THREE.PlaneGeometry(.0001, .0001), M.fire, 0, 0, 0); glow.visible = false; void glow; void fire;
  bake(g);
  let openK = 0, heatK = 0;
  g.userData.oven = {
    door, handle: () => door.localToWorld(V(0, dh - .05, .075)), flameMat, fireGroup: fire,
    setOpen(k) { openK = clamp01(k); door.rotation.x = openK * 1.45; }, get open() { return openK; },
    setSpread(k) { flameU.uSpread.value = k; }, setHeat(k) { const em = Math.min(1, k * 6); /* a cold stove's coal bed is dead black, embers glow only while there is heat */ M.fire.emissiveIntensity = .06 * em + .45 * k; /* Lights: the bed under the coals is ash, a dull glow; the coals on it (lights.js) carry the heat */ M.ovenGlass.emissiveIntensity = .03 * em + .12 * k; /* Lights (critic E14): a glowing pane read as a painted orange rectangle; the pane stays dark glass and the fire and coals behind it show through */ heatK = k; },
    flicker(t) { fire.visible = heatK > .05; if (!fire.visible) return; flameU.uT.value = t; flameU.uHeat.value = heatK; flameMat.opacity = .55 + heatK * .4; M.fire.emissiveIntensity = (.06 + .45 * heatK) * (.88 + Math.sin(t * 13) * .08 + Math.sin(t * 31) * .05); },
  };
  return g;
}
// ---- kitchen extras (photo: pots, hanging utensils, tea towel) ----
function towelCanvas() { return canvas(128, 128, (g) => { g.fillStyle = '#F2E8D6'; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(178,58,46,.55)'; for (let i = 0; i < 8; i++) { g.fillRect(i * 16 + 4, 0, 6, 128); g.fillRect(0, i * 16 + 4, 128, 6); } g.fillStyle = 'rgba(178,58,46,.85)'; g.fillRect(0, 108, 128, 8); }); }
function pot() { const g = new THREE.Group(); add(g, lathe([[0, 0], [.085, 0], [.095, .01], [.095, .11], [.1, .115], [.092, .115], [.087, .02], [0, .02]], 28), M.enamelDark);
  add(g, lathe([[0, 0], [.1, 0], [.098, .01], [.04, .03], [.015, .034], [0, .034]], 24), M.enamelDark, 0, .115, 0); add(g, new THREE.SphereGeometry(.014, 10, 8), M.rubber, 0, .152, 0);
  for (const s of [-1, 1]) add(g, new THREE.TorusGeometry(.022, .006, 6, 12, Math.PI), M.iron, s * .1, .09, 0, 0, s > 0 ? 0 : Math.PI, s * Math.PI / 2); return g; }
function pan(r = .11) { const g = new THREE.Group(); add(g, lathe([[0, 0], [r, 0], [r + .012, .04], [r + .006, .042], [r - .004, .006], [0, .006]], 28), M.iron, 0, 0, 0, Math.PI / 2); // hangs flat against the wall, handle up
  add(g, rb(.026, .2, .012, .005), M.woodDark, 0, r + .11, .02); add(g, rb(.02, .05, .01, .004), M.iron, 0, r + .015, .02); add(g, new THREE.TorusGeometry(.008, .003, 6, 10), M.iron, 0, r + .205, .02); return g; }
function ladle(len = .32) { const g = new THREE.Group(); add(g, new THREE.SphereGeometry(.04, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.steel, 0, -len / 2, 0); add(g, rb(.012, len, .004, .002), M.steel, 0, 0, -.01, -.06); add(g, new THREE.TorusGeometry(.01, .003, 6, 10), M.steel, 0, len / 2 + .008, -.012); return g; }
// carved wooden utensils (they were a flat slotted plate on a stick): one lofted solid each, an oval cross-section whose width
// and thickness follow the carving along the length (y, tip at -len/2), so the bowl, neck and handle swell and taper with real
// thickness, the spatula blade thins to a bevelled edge at the tip, and the spoon's bowl is dished (the section dips in the middle)
function loftUtensil(len, wf, hf, df = () => 0, N = 14, Mn = 44) { const P = [], UV = [], I = [];
  for (let i = 0; i <= Mn; i++) { const t = i / Mn, y = -len / 2 + t * len, w = Math.max(.0004, wf(t)), h = Math.max(.0003, hf(t)), d = df(t);
    for (let j = 0; j <= N; j++) { const a = j / N * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); P.push(w * c, y, h * sn - d * (1 - c * c)); UV.push(j / N, t); } }
  for (let i = 0; i < Mn; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + N + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals(); return g; }
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function spatula(len = .3) { const g = new THREE.Group(); const B = .36; // blade | neck | handle; the blade end is squared with round corners
  const wf = t => t < B ? .029 * Math.pow(Math.min(1, t / .035), .35) * (1 - .1 * sm(.2, B, t)) : t < B + .1 ? .026 - .018 * sm(B, B + .1, t) : .008 + .003 * sm(.6, .95, t) * (1 - sm(.97, 1, t) * .9) ;
  const hf = t => t < B ? .0012 + .0028 * sm(0, B, t) : t < B + .1 ? .004 + .002 * sm(B, B + .1, t) : .0058 * (1 - .85 * sm(.97, 1, t));
  add(g, loftUtensil(len, wf, hf), M.woodLight); return g; }
function woodSpoon(len = .28) { const g = new THREE.Group(); const B = .3;
  const wf = t => t < B ? .03 * Math.sqrt(Math.max(0, 1 - Math.pow((t - B / 2) / (B / 2), 2))) + (t > B / 2 ? .007 * sm(B / 2, B, t) : 0) : t < B + .08 ? .009 - .002 * sm(B, B + .08, t) : .0072 + .0028 * sm(.55, .95, t) * (1 - sm(.97, 1, t) * .9);
  const hf = t => t < B ? .0026 * Math.min(1, Math.sqrt(Math.max(0, 1 - Math.pow((t - B / 2) / (B / 2), 2))) * 3) + .0004 : t < B + .08 ? .0045 + .0012 * sm(B, B + .08, t) : .0056 * (1 - .85 * sm(.97, 1, t));
  const df = t => t < B ? .011 * Math.pow(Math.max(0, 1 - Math.pow((t - B / 2) / (B / 2 * .92), 2)), .8) : 0;
  add(g, loftUtensil(len, wf, hf, df), M.woodLight); return g; }
function utensilRail(w = .55) { const g = new THREE.Group(); add(g, new THREE.CylinderGeometry(.008, .008, w, 10), M.brass, 0, 0, .04, 0, 0, Math.PI / 2); for (const s of [-1, 1]) add(g, rb(.02, .03, .05, .006), M.brass, s * w / 2, 0, .02);
  const hook = (x) => add(g, new THREE.TorusGeometry(.012, .0025, 6, 12, Math.PI * 1.4), M.brass, x, -.012, .04, 0, Math.PI / 2, 0);
  const items = [[-.17, spatula(.2), -.12], [-.03, ladle(.24), -.14], [.08, woodSpoon(.23), -.135], /* same reach as before: the spatula's tip stays clear of the kettle lid */ [.18, ladle(.2), -.12]]; for (const [x, o, y] of items) { hook(x); o.position.set(x, y, .045); g.add(o); }
  return bake(g); }
function coatHooks() { const g = new THREE.Group(); W(g, .34, .07, .025, 0, 0, .0125, { mat: M.woodDark, r: .008 });
  for (const x of [-.11, 0, .11]) { add(g, new THREE.CylinderGeometry(.008, .008, .06, 8), M.woodDark, x, 0, .05, Math.PI / 2); add(g, new THREE.SphereGeometry(.013, 10, 8), M.woodDark, x, 0, .08); }
  // a mustard scarf and a cap on the hooks
  const sc = add(g, drapeGeo(.11, .03, .32, { r: .015, wrinkle: .01 }), new THREE.MeshStandardMaterial({ color: 0xC9962E, roughness: .95, side: THREE.DoubleSide }), -.11, .0, .065, 0, Math.PI / 2, 0); void sc;
  const cap = add(g, new THREE.SphereGeometry(.075, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5A4632, roughness: .9 }), .11, -.04, .09); cap.scale.set(1, .75, 1); add(g, new THREE.CylinderGeometry(.06, .07, .008, 18, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x4A3826, roughness: .9 }), .11, -.04, .12, 0, Math.PI / 2, 0);
  return g; }
// the photo's kettle is chrome: worn and dulled by use, soot climbing from the base where the flame licks it, water
// spots and fine scratches. Its reflection dims at night (NIGHT_METALS) so it never glows in the dark kitchen.
const NIGHT_METALS = [];
let _ketMat = null;
function kettleMat() { if (_ketMat) return _ketMat; let ls = 4242; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#C9CDD1'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) { g.fillStyle = `rgba(${LR() < .5 ? '255,255,255' : '90,95,100'},${LR() * .07})`; g.fillRect(x, 0, 1, h); } /* brushed, worn */
    const sg = g.createLinearGradient(0, h, 0, 0); sg.addColorStop(0, 'rgba(22,18,16,.95)'); sg.addColorStop(.22, 'rgba(30,24,20,.8)'); sg.addColorStop(.38, 'rgba(60,48,38,.3)'); sg.addColorStop(.5, 'rgba(60,48,38,0)'); g.fillStyle = sg; g.fillRect(0, 0, w, h); /* soot from the base */
    g.filter = 'blur(3px)'; for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(35,28,22,${.12 + LR() * .2})`; const x = LR() * w; g.beginPath(); g.ellipse(x, h * (.62 + LR() * .08), 3 + LR() * 6, 10 + LR() * 22, 0, 0, 6.3); g.fill(); } g.filter = 'none'; /* soft soot tongues licking up */
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(250,250,250,${.1 + LR() * .2})`; g.beginPath(); const x = LR() * w, y = LR() * h * .55; g.moveTo(x, y); g.lineTo(x + (LR() - .5) * 30, y + (LR() - .5) * 8); g.stroke(); } /* scratches */
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(150,140,120,${.1 + LR() * .15})`; g.beginPath(); g.arc(LR() * w, LR() * h * .5, 1 + LR() * 4, 0, 6.3); g.fill(); } /* dried water spots */ });
  _ketMat = new THREE.MeshStandardMaterial({ map: texOf(c), metalness: .85, roughness: .38, envMap: M.env, envMapIntensity: .8 }); _ketMat.userData.env0 = .8; NIGHT_METALS.push(_ketMat); return _ketMat; }
function kettle() { const g = new THREE.Group(); g.userData.live = true; add(g, lathe([[0, 0], [.08, 0], [.095, .02], [.1, .06], [.09, .11], [.06, .135], [.035, .14], [.035, .145], [0, .145]], 28), kettleMat());
  add(g, lathe([[0, 0], [.038, 0], [.04, .008], [.02, .02], [.012, .032], [0, .036]], 16), kettleMat(), 0, .142, 0);
  add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(.07, .05, 0), V(.12, .09, 0), V(.15, .14, 0), V(.17, .155, 0)]), 12, .012, 8), kettleMat());
  add(g, new THREE.TorusGeometry(.07, .009, 8, 20, Math.PI), M.rubber, 0, .14, 0); return g; }
function hood(height) { const g = new THREE.Group(); const c = add(g, new THREE.CylinderGeometry(.13, .5, .3, 4, 1, true), M.hood, 0, .15, 0, 0, Math.PI / 4); c.scale.set(1.15, 1, .72); c.material.side = THREE.DoubleSide;
  add(g, rb(.84, .045, .54, .01), M.hood, 0, .0, 0); add(g, rb(.2, height, .18, .01), M.hood, 0, .3 + height / 2, -.04); for (const y of [.33, .3 + height * .5]) add(g, rb(.22, .02, .2, .006), M.iron, 0, y, -.04); return bake(g); }
function sinkCounter() {
  const g = new THREE.Group(); const Wd = .96, D = .6, H = .9;
  const sx0 = .02, sx1 = .44; // the sink cut in the countertop
  // cabinet body: solid below the basin, and only beside it up top, so the basin is a real hollow (no wood showing inside it)
  const lh = H - .31, ly = .06 + lh / 2; W(g, Wd / 2, lh, D - .04, -Wd / 4, ly, -.02, { mat: M.wood, grain: 1 }); W(g, Wd - .06, .06, D - .1, 0, .03, -.05, { mat: M.woodDark });
  // open bay under the basin: the drain bucket stands in it (out.water)
  W(g, Wd / 2, lh, .02, Wd / 4, ly, -.02 - (D - .04) / 2 + .01, { mat: M.woodDark, grain: 1 }); W(g, .025, lh, D - .04, Wd / 2 - .0125, ly, -.02, { mat: M.wood, grain: 1 }); W(g, Wd / 2 - .03, .02, D - .06, Wd / 4 - .01, .07, -.02, { mat: M.woodDark });
  W(g, .025, lh + .02, .03, .012, ly, D / 2 - .05, { mat: M.wood, grain: 1 }); // centre stile between the door and the bay
  W(g, sx0 + Wd / 2, .21, D - .04, (-Wd / 2 + sx0) / 2, H - .25 + .105, -.02, { mat: M.wood, grain: 1 }); W(g, Wd / 2 - sx1, .21, D - .04, (sx1 + Wd / 2) / 2, H - .25 + .105, -.02, { mat: M.wood, grain: 1 });
  panelDoor(g, .44, .58, -.235, .44, D / 2 - .04); knob(g, -.04, .58, D / 2 - .01);
  W(g, .9, .1, .02, 0, H - .14, D / 2 - .03, { mat: M.wood });
  // countertop with a cut for the sink (two slabs and front/back strips)
  W(g, sx0 + Wd / 2 + .02, .05, D + .03, (-Wd / 2 - .02 + sx0) / 2, H - .025, 0, { mat: M.woodLight }); W(g, Wd / 2 + .02 - sx1, .05, D + .03, (sx1 + Wd / 2 + .02) / 2, H - .025, 0, { mat: M.woodLight }); W(g, sx1 - sx0, .05, .12, (sx0 + sx1) / 2, H - .025, -D / 2 + .045, { mat: M.woodLight });
  // farmhouse basin
  const bx = (sx0 + sx1) / 2, bw = sx1 - sx0, bd = D - .1, bz = .04;
  // deep enamel basin: bottom, four inner walls, a rounded rim on the counter, a drain with a strainer
  const en = wearEnamel(new THREE.MeshStandardMaterial({ roughness: .3, metalness: .05, envMap: M.env, envMapIntensity: .6 }), 0xEDE8DE, 3, { grime: .22, chips: 7 }); /* used enamel, not new plastic */
  add(g, rb(bw - .01, .02, bd - .01, .008), en, bx, H - .21, bz); for (const s of [-1, 1]) add(g, rb(.018, .22, bd, .008), en, bx + s * (bw / 2 - .009), H - .11, bz); add(g, rb(bw, .22, .018, .008), en, bx, H - .11, bz - bd / 2 + .009);
  add(g, rb(bw + .02, .24, .04, .016, 3), en, bx, H - .12, bz + bd / 2 - .005); // farmhouse apron (front wall)
  for (const s of [-1, 1]) { add(g, rb(.026, .014, bd + .03, .006), en, bx + s * (bw / 2 + .002), H + .004, bz); add(g, rb(bw + .03, .014, .026, .006), en, bx, H + .004, bz + s * (bd / 2 + .002)); }
  add(g, new THREE.CircleGeometry(.026, 20), M.darkInside, bx, H - .199, bz, -Math.PI / 2); add(g, new THREE.TorusGeometry(.027, .004, 6, 20), M.steel, bx, H - .199, bz, Math.PI / 2);
  for (const a of [0, Math.PI / 2]) add(g, rb(.044, .003, .004, .001), M.steel, bx, H - .197, bz, 0, a);
  add(g, new THREE.CylinderGeometry(.018, .018, H - .21 - .5, 12), M.iron, bx, (H - .21 + .5) / 2, bz); add(g, new THREE.CylinderGeometry(.024, .02, .03, 12), M.iron, bx, .5, bz); // drain pipe into the bay
  // dishes are live state now (see out.dishes): dirty ones in the basin, drying in the rack, clean on the shelf
  // faucet
  const fz = -D / 2 + .07; add(g, new THREE.CylinderGeometry(.022, .026, .03, 14), M.chrome, bx, H + .015, fz);
  add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, .2, 0), V(0, .27, .05), V(0, .25, .13), V(0, .2, .15)]), 24, .012, 10), M.chrome, bx, H + .02, fz);
  for (const s of [-1, 1]) { add(g, new THREE.CylinderGeometry(.008, .01, .05, 10), M.chrome, bx + s * .08, H + .025, fz); for (const a of [0, Math.PI / 2]) add(g, rb(.05, .008, .008, .003), M.chrome, bx + s * .08, H + .05, fz, 0, a); add(g, new THREE.SphereGeometry(.009, 10, 8), M.ceramic, bx + s * .08, H + .056, fz); }
  // GRAB: the tap's lever on the front rim of the basin, right of centre, where his right hand gets to it at the sink (the old
  // cross-handles at the back stay as decoration, 65 cm from where he stands). A live stick with a ball that tips forward = water on.
  const lev = new THREE.Group(); lev.position.set(.31, H + .01, .285); lev.userData.live = true; g.add(lev);
  add(lev, new THREE.CylinderGeometry(.016, .02, .02, 14), M.chrome, 0, .01, 0);
  const lst = new THREE.Group(); lst.position.set(0, .02, 0); lst.rotation.x = -.35; lev.add(lst);
  add(lst, new THREE.CylinderGeometry(.006, .008, .07, 10), M.chrome, 0, .035, 0); add(lst, new THREE.SphereGeometry(.014, 12, 10), M.ceramic, 0, .074, 0);
  g.userData.lever = lst;
  // on the counter: cutting board with bread, jar, canister
  add(g, lathe([[0, 0], [.06, 0], [.075, .05], [.07, .13], [.045, .17], [.04, .19], [0, .19]], 22), M.glazeCream, -.43, H, -.22); add(g, lathe([[0, 0], [.048, 0], [.05, .01], [.03, .03], [0, .034]], 16), M.glazeCream, -.43, H + .19, -.22);
  add(g, lathe([[0, 0], [.045, 0], [.047, .11], [.035, .12], [0, .12]], 18), M.glazeBlue, -.45, H, -.05);
  bake(g); g.userData.info = { top: H }; return g;
}
function barrel(h = .78, mat) { const g = new THREE.Group(); const r0 = h * .3, b = h * .055; const pts = []; for (let i = 0; i <= 12; i++) { const y = i / 12 * h; pts.push([r0 + b * Math.sin(Math.PI * i / 12), y]); } pts.push([r0 - .02, h], [r0 - .02, h - .03], [0, h - .03]);
  // [PROPS round] one flat facet per stave (14, matching the 14 joints in the stave texture), so the staves read as boards
  // with crisp joints instead of one smooth glossy tube; the hoops are flat forged bands (rectangular section, 4 cm by 3 mm)
  // lying on the bulge, not round black rubber rings. Fewer triangles than before (14 + 4x28 x 4 faces vs 32 + 4x40x6).
  add(g, new THREE.LatheGeometry([[0, 0], ...pts].map(([r, y]) => new THREE.Vector2(r, y)), 14), mat || M.stave); add(g, new THREE.CylinderGeometry(r0 - .02, r0 - .02, .01, 14), M.staveDark, 0, h - .03, 0);
  for (const t of [.1, .3, .7, .9]) { const y = t * h, hw = .02, rAt = q => r0 + b * Math.sin(Math.PI * q / h);   // same 14 facets as the staves: the band lies flat on every stave
    const ra = rAt(y - hw) + .0035, rb2 = rAt(y + hw) + .0035;
    add(g, new THREE.LatheGeometry([[ra - .004, y - hw], [ra, y - hw], [rb2, y + hw], [rb2 - .004, y + hw]].map(([r, yy]) => new THREE.Vector2(r, yy)), 14), M.hoopIron); } return bake(g); }
// galvanised steel: zinc spangle (crystal flakes of slightly different grey), dull water lines, a rusty rim at the foot
let _galv = null;
function galvMat() { if (_galv) return _galv; let ls = 2468; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#9EA2A2'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 260; k++) { const x = LR() * w, y = LR() * h, r = 4 + LR() * 12, v = 130 + LR() * 70 | 0; g.fillStyle = `rgba(${v},${v + 2},${v + 3},.45)`; g.beginPath(); for (let q = 0; q < 6; q++) { const t = q / 6 * 6.283 + LR() * .6, rr = r * (.6 + LR() * .5); g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr); } g.fill(); }
    for (let k = 0; k < 10; k++) { const y = h * (.2 + LR() * .6); g.fillStyle = `rgba(90,86,76,${.08 + LR() * .1})`; g.fillRect(0, y, w, 2 + LR() * 5); }
    const gr = g.createLinearGradient(0, 0, 0, h * .14); gr.addColorStop(0, 'rgba(120,62,30,.6)'); gr.addColorStop(1, 'rgba(120,62,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h * .14); });
  const t = texOf(c); t.flipY = false; const b = texOf(c, { srgb: false }); b.flipY = false; _galv = new THREE.MeshStandardMaterial({ map: t, bumpMap: b, bumpScale: .4, metalness: .6, roughness: .55, envMap: M.env, envMapIntensity: .5 }); return _galv; }
function bucket(h = .36, metal = false) { const g = new THREE.Group(); const r0 = h * .5, r1 = h * .62, NS = metal ? 28 : 12;
  // [PROPS round] a pressed tin pail is round (the 16-facet cap made it a polygon), a coopered bucket has 12 flat staves; its hoops
  // are flat forged bands lying on the staves, not round black rubber rings; the tin pail keeps its rolled wire rim
  add(g, new THREE.LatheGeometry([[0, 0], [r0, 0], [r1, h], [r1 - .012, h], [r0 - .012, .015], [0, .015]].map(([x, y]) => new THREE.Vector2(x, y)), NS), metal ? galvMat() : M.stave);
  if (metal) { const r = r1 + .002; add(g, new THREE.TorusGeometry(r, .006, 6, 28), M.steel, 0, h * .985, 0, Math.PI / 2); }
  else for (const t of [.15, .8]) { const hw = .014, ya = h * t - hw, yb = h * t + hw, ra = r0 + (r1 - r0) * ya / h + .003, rb2 = r0 + (r1 - r0) * yb / h + .003;
    add(g, new THREE.LatheGeometry([[ra - .003, ya], [ra, ya], [rb2, yb], [rb2 - .003, yb]].map(([x, y]) => new THREE.Vector2(x, y)), NS), M.hoopIron); }
  /* the bail: from two ears at the rim up to 7 cm over its middle, where the fist holds it (a full half-circle rose 19 cm over the rim and the
     fist, at the grip point, held it low by one side: the thin wire ran down into the water, watcher R20-3) */
  { const ey = h - .012, er = r1 + .008;/* ears just under the rolled rim, outside it: lower ears on the tapered wall put the arc inside the rim, through the water */ add(g, new THREE.TorusGeometry(er, .004, 6, 24, Math.PI), M.iron, 0, ey, 0, 0, Math.PI / 2, 0).scale.set(1, .085 / er, 1);
    for (const s of [-1, 1]) add(g, new THREE.CylinderGeometry(.012, .012, .008, 10), M.iron, 0, ey, s * er, Math.PI / 2, 0, 0); }
  return bake(g); }
const RUG_IMG = { check: 'rug-blue.jpg', orange: 'rug-orange.jpg', green: 'rug-green.jpg' };
function rug(w, d, kind, fringe) { const g = new THREE.Group(); const t = upgrade(texOf(rugCanvas(kind)), RUG_IMG[kind]); if (kind === 'check') t.repeat.set(w / .7, d / .7); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 1, color: kind === 'orange' ? 0xCDC2BC : 0xffffff });   /* the orange rug glowed like a lit panel in the sun: wool is duller; [photo round] but the photo's rug is a light peach, not brick red: a lighter, slightly cool tint */ { const pg = new THREE.PlaneGeometry(w, d, 24, 16); pg.rotateX(-Math.PI / 2); const P = pg.attributes.position; const ph = R() * 6, fx = R() * w - w / 2;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i); let y = .014;   /* boards bow up to ~1 cm: at .006 a high board showed through the rug */
      y += .006 * Math.max(0, Math.sin(x * 9 + ph + z * 2)) * Math.max(0, 1 - Math.abs(x - fx) / (w * .3)); // a soft ruck where it was kicked
      y += .003 * Math.sin(x * 23 + z * 7 + ph) * Math.sin(z * 17);
      for (const [cx, cz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) { const dd = Math.hypot(x - cx, z - cz); if (dd < .16) y += .028 * Math.pow(1 - dd / .16, 2); } // corners curl up
      P.setY(i, y); }
    pg.computeVertexNormals(); const rm = add(g, pg, m, 0, 0, 0); rm.castShadow = false; m.side = THREE.DoubleSide; }
  if (fringe) { const fm = new THREE.MeshStandardMaterial({ map: texOf(fringeCanvas(fringe)), transparent: true, alphaTest: .4, roughness: 1, side: THREE.DoubleSide }); fm.map.repeat.set(w * 6, 1); for (const s of [-1, 1]) add(g, new THREE.PlaneGeometry(w * .96, .06), fm, 0, .004, s * (d / 2 + .03), -Math.PI / 2, 0, s > 0 ? 0 : Math.PI).castShadow = false; }
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); return g; }
function wallShelf(w, { brackets = true, mat = M.woodLight } = {}) { const g = new THREE.Group(); W(g, w, .035, .24, 0, 0, .12, { mat }); if (brackets) for (const s of [-1, 1]) { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(.18, 0); sh.quadraticCurveTo(.06, -.04, 0, -.17); sh.lineTo(0, 0); const e = new THREE.ExtrudeGeometry(sh, { depth: .03, bevelEnabled: true, bevelSize: .004, bevelThickness: .004, bevelSegments: 2 }); add(g, e, M.woodDark, s * (w / 2 - .08) - .015, -.018, .01, 0, -Math.PI / 2, 0); } return g; }
// a jar that reads as a jar up close: shoulder and neck, a ridged screw lid, contents behind glass, a paper label
const JAR_FILL = [0x8E2A2A, 0xB8862E, 0x6E7A2E, 0xC8642A]; let jarN = 0;
// photo: a round blue-glazed stoneware crock with a lid stands on the floor left of the bunk. Glaze stops short of the
// foot (raw cream clay shows at the base, as on real dipped stoneware) and a raised cream slip ring circles the shoulder.
function crock() { const g = new THREE.Group();
  add(g, lathe([[0, .004], [.09, 0], [.105, .012], [.107, .03], [0, .03]], 22), M.glazeCream);
  add(g, lathe([[0, .03], [.107, .03], [.128, .09], [.135, .15], [.124, .21], [.098, .25], [.086, .262], [.088, .275], [.074, .275], [.07, .262], [0, .262]], 22), M.glazeBlue);
  add(g, new THREE.TorusGeometry(.127, .005, 4, 22), M.glazeCream, 0, .205, 0, Math.PI / 2, 0, 0);
  add(g, lathe([[0, .262], [.08, .262], [.083, .268], [.07, .282], [.03, .29], [.018, .292], [.02, .308], [.012, .314], [0, .315]], 22), M.glazeBlue);
  return g; }
// ---- lived-in details (photo round 2): small things a person who lives here collects ----
// peg rail with a hand-knitted scarf and a canvas shoulder bag hanging off the pegs (bedroom wall by the bunk)
function pegRail() { const g = new THREE.Group(); W(g, .62, .075, .022, 0, 0, .011, { mat: M.woodDark, r: .006 });
  for (const x of [-.22, 0, .22]) { add(g, new THREE.CylinderGeometry(.009, .011, .07, 8), M.woodDark, x, 0, .056, Math.PI / 2 - .25, 0, 0); add(g, new THREE.SphereGeometry(.014, 8, 6), M.woodDark, x, .008, .09); }
  const knit = std2(0x8C3A32), knitL = std2(0xB8A27A); // a red scarf with a cream stripe, folded over the left peg
  for (const [dx, len, dz] of [[-.035, .5, .045], [.03, .42, .058]]) { add(g, new THREE.BoxGeometry(.13, len, .014, 1, 6, 1), knit, -.22 + dx, -len / 2 + .015, dz, .04, 0, dx * 1.2);
    for (const k of [.3, .82]) add(g, new THREE.BoxGeometry(.132, .03, .015), knitL, -.22 + dx, -len * k + .015, dz, .04, 0, dx * 1.2);
    for (let i = 0; i < 8; i++) add(g, new THREE.CylinderGeometry(.003, .002, .05, 3), knit, -.22 + dx - .058 + i * .0165, -len + .015 - .02, dz); }
  const canv = std2(0x9C8C6C), strap = std2(0x5A4632); // the bag on the right peg: a soft sack body, flap and strap
  { const b = add(g, new THREE.SphereGeometry(.13, 12, 9), canv, .22, -.29, .06); b.scale.set(.85, 1, .3); add(g, new THREE.BoxGeometry(.2, .1, .012), canv, .22, -.2, .125, -.12, 0, 0);
    add(g, new THREE.TorusGeometry(.12, .008, 4, 14, Math.PI), strap, .22, -.16, .07, 0, 0, 0); add(g, new THREE.BoxGeometry(.02, .035, .006), strap, .22, -.24, .13); }
  return g; }
// a bunch of herbs hung upside down to dry: twine tie at the top, stems fanning down into dry leafy heads
function herbBundle(seed, col) { const g = new THREE.Group(); let ls = seed; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const stem = std2(0x6E6A3C), leaf = std2(col);
  add(g, new THREE.CylinderGeometry(.0015, .0015, .1, 3), std2(0xC8B080), 0, -.05, 0); add(g, new THREE.CylinderGeometry(.014, .014, .02, 8), std2(0xC8B080), 0, -.1, 0);
  const lg = new THREE.PlaneGeometry(.014, .032); lg.translate(0, -.016, 0); const lm = leaf.clone(); lm.side = THREE.DoubleSide; lm.roughness = .9; // dry leaf cards along each stem
  for (let i = 0; i < 16; i++) { const a = LR() * 6.28, t = .04 + LR() * .18, L = .15 + LR() * .07; const s = add(g, new THREE.CylinderGeometry(.0015, .002, L, 3), stem, Math.sin(t) * L * .5 * Math.cos(a), -.1 - L / 2, Math.sin(t) * L * .5 * Math.sin(a), Math.sin(a) * t, 0, -Math.cos(a) * t);
    for (let k = 0; k < 6; k++) { const f = .3 + k * .13, y = -.1 - L * f, r = Math.sin(t) * L * f; const q = add(g, lg, lm, Math.cos(a) * r, y, Math.sin(a) * r, (LR() - .5) * 1.2, LR() * 6.28, Math.PI - (LR() - .5) * 1.4); q.castShadow = false; } }
  return g; }
function jar(h, r, mat) { const g = new THREE.Group(); add(g, lathe([[0, 0], [r * .9, 0], [r, r * .12], [r * 1.04, h * .12], [r * 1.04, h * .74], [r * .96, h * .82], [r * .78, h * .87], [r * .76, h * .9], [r * .76, h * .93], [0, h * .93]], 22), mat);
  if (mat === M.jarGlass) { add(g, new THREE.CylinderGeometry(r * .92, r * .92, h * .66, 16), std2(JAR_FILL[jarN++ % JAR_FILL.length]), 0, h * .38, 0); }
  add(g, new THREE.CylinderGeometry(r * .82, r * .82, h * .1, 22), M.steel, 0, h * .97, 0); add(g, new THREE.TorusGeometry(r * .82, h * .012, 4, 22), M.steel, 0, h * .93, 0, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(r * 1.045, r * 1.045, h * .32, 22, 1, true), M.linen, 0, h * .44, 0); return g; }
// perf: the four tin labels share one atlas texture (one material), each can's UVs pick its quarter
let _canAtlas = null;
function canAtlas() { if (_canAtlas) return _canAtlas; const c = document.createElement('canvas'); c.width = 256; c.height = 32; const x = c.getContext('2d'); M.cans.forEach((m, i) => x.drawImage(m.map.image, i * 64, 0, 64, 32));
  const t = texOf(c); t.wrapS = THREE.ClampToEdgeWrapping; const m0 = M.cans[0]; _canAtlas = new THREE.MeshStandardMaterial({ map: t, metalness: m0.metalness, roughness: m0.roughness, envMap: m0.envMap, envMapIntensity: m0.envMapIntensity }); return _canAtlas; }
function can(h, r, mat) { const g = new THREE.Group(); const ci = M.cans.indexOf(mat); const cg = new THREE.CylinderGeometry(r, r, h, Math.max(8, Math.min(20, Math.ceil(r * 200))));
  if (ci >= 0) { const uv = cg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, (ci + Math.min(.995, Math.max(.005, uv.getX(i)))) / 4); mat = canAtlas(); } add(g, cg, mat, 0, h / 2, 0); for (const y of [.003, h - .003]) add(g, new THREE.TorusGeometry(r, .003, 4, 20), M.steel, 0, y, 0, Math.PI / 2); return g; }
function picture(w, h) { const g = new THREE.Group(); for (const [ww, hh, x, y] of [[w, .035, 0, h / 2], [w, .035, 0, -h / 2], [.035, h, w / 2, 0], [.035, h, -w / 2, 0]]) W(g, ww, hh, .03, x, y, .015, { mat: M.woodDark, r: .008 }); add(g, new THREE.PlaneGeometry(w - .03, h - .03), M.picture, 0, 0, .012); return bake(g); }
function lanternHousing(rod) { const g = new THREE.Group(); const s = .17, h = .2; add(g, new THREE.CylinderGeometry(.02, s * .78, .08, 4), M.iron, 0, h / 2 + .04, 0, 0, Math.PI / 4); add(g, new THREE.CylinderGeometry(s * .5, s * .5, .02, 4), M.iron, 0, -h / 2 - .01, 0, 0, Math.PI / 4);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(g, new THREE.BoxGeometry(.012, h, .012), M.iron, x * s * .35, 0, z * s * .35);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; add(g, new THREE.PlaneGeometry(s * .7, h * .95), M.glass, Math.sin(a) * s * .35, 0, Math.cos(a) * s * .35, 0, a); }
  add(g, new THREE.TorusGeometry(.025, .005, 6, 16), M.iron, 0, h / 2 + .09, 0); add(g, new THREE.CylinderGeometry(.006, .006, rod, 6), M.iron, 0, h / 2 + .1 + rod / 2, 0); return g; }
function domeShade(rod) { const g = new THREE.Group(); const m = add(g, lathe([[.2, 0], [.19, .03], [.14, .1], [.07, .15], [.035, .17], [0, .18]], 28), M.enamelDark); m.material = M.enamelDark; const inner = add(g, lathe([[.19, .002], [.14, .095], [.07, .145], [0, .17]], 28), new THREE.MeshStandardMaterial({ color: 0xF0E2C0, roughness: .6, side: THREE.BackSide, emissive: 0xFFC27A, emissiveIntensity: 0 }));
  g.userData.inner = inner.material; inner.userData.live = true; // hangs on a chain of small links up to the roof beam, with a ceiling rose at the top
  { const n = Math.max(2, Math.round(rod / .035)); const lg = new THREE.TorusGeometry(.011, .0028, 5, 10); for (let i = 0; i < n; i++) add(g, lg, M.iron, 0, .185 + i * rod / n + .012, 0, 0, (i % 2) * Math.PI / 2, 0).scale.set(1, 1.5, 1);
    add(g, new THREE.CylinderGeometry(.03, .04, .025, 14), M.iron, 0, .18 + rod + .012, 0); }
  add(g, new THREE.TorusGeometry(.2, .008, 6, 32), M.iron, 0, 0, 0, Math.PI / 2); return g; }
// plank door in its frame. The leaf hangs on a live pivot at its hinge edge (local x = +w/2), so it can swing;
// a slide bolt on the room side (+z) shoots into a keeper on the latch-side post.
function plankDoor(h = 1.9, w = .77) { const g = new THREE.Group(); const fr = new THREE.Group(); g.add(fr);
  for (const [ww, hh, x, y] of [[.09, h + .09, -w / 2 - .045, h / 2], [.09, h + .09, w / 2 + .045, h / 2], [w + .18, .09, 0, h + .045]]) W(fr, ww, hh, .07, x, y, .01, { mat: M.woodDark });
  const piv = new THREE.Group(); piv.position.set(w / 2, 0, .0); piv.userData.live = true; g.add(piv); const leaf = new THREE.Group(); leaf.position.x = -w / 2; piv.add(leaf);
  const n = 5, pw = w / n; for (let i = 0; i < n; i++) W(leaf, pw - .008, h - .02, .045, -w / 2 + pw * (i + .5), h / 2 + .005, 0, { mat: M.wood, r: .01, grain: 1 });
  for (const y of [.35, h - .35]) W(leaf, w - .06, .12, .03, 0, y, .035, { mat: M.woodDark });
  W(leaf, .1, Math.hypot(w - .2, h - .9) , .028, 0, h / 2, .033, { mat: M.woodDark, rz: Math.atan2(w - .2, h - .9) }); // Z brace: worn shelter door
  for (const y of [.35, h - .35]) { add(leaf, rb(.2, .035, .008, .004), M.iron, w / 2 - .1, y, .052); for (const k of [0, 1, 2]) screw(leaf, w / 2 - .17 + k * .06, y, .056); }
  // [PROPS round] a forged D-pull with two clenched straps instead of a black ball knob (it read as a plastic bead)
  { const hx = -w / 2 + .1, hy = h * .46; add(leaf, new THREE.TorusGeometry(.042, .0065, 5, 12, Math.PI), M.hoopIron, hx, hy, .05, 0, Math.PI / 2, Math.PI / 2);
    for (const s of [-1, 1]) add(leaf, rb(.022, .03, .005, .002), M.hoopIron, hx, hy + s * .042, .052); }
  // slide bolt: plate + sliding bar + knob, above the handle
  const by = h * .55; add(leaf, rb(.16, .045, .008, .003), M.iron, -w / 2 + .14, by, .054);
  const bar = new THREE.Group(); bar.position.set(-w / 2 + .14, by, .066); leaf.add(bar); bar.userData.live = true;
  add(bar, new THREE.CylinderGeometry(.009, .009, .17, 10), M.steel, 0, 0, 0, 0, 0, Math.PI / 2); add(bar, new THREE.CylinderGeometry(.006, .006, .03, 8), M.steel, .02, .018, 0); add(bar, new THREE.SphereGeometry(.011, 10, 8), M.steel, .02, .034, 0);
  for (const x of [-.06, .06]) add(leaf, rb(.02, .03, .022, .003), M.iron, -w / 2 + .14 + x, by, .062);
  add(fr, rb(.035, .04, .03, .004), M.iron, -w / 2 - .03, by, .06); // keeper on the latch-side post
  bake(fr); bake(leaf);
  g.userData.door = { piv, bar, w, h, barX: -w / 2 + .14 };
  return g; }
// an oil lantern on a forged wall bracket; the wall is at local +x .192 (plate with two nails, arm, diagonal brace, hook)
function bracketLantern() { const g = new THREE.Group(); g.add(lanternHousing(.025)); const wx = .192, ay = .245;
  add(g, rb(.02, .17, .06, .004), M.iron, wx, ay - .05, 0);
  for (const y of [ay + .01, ay - .11]) add(g, new THREE.CylinderGeometry(.006, .006, .012, 6), M.iron, wx - .012, y, 0, 0, 0, Math.PI / 2);
  add(g, new THREE.BoxGeometry(wx - .01, .014, .012), M.iron, wx / 2, ay, 0);                              // the arm
  add(g, new THREE.TorusGeometry(.012, .004, 5, 10), M.iron, 0, ay - .006, 0, 0, Math.PI / 2, 0);              // hook at its tip
  const b0 = V(wx - .01, ay - .12, 0), b1 = V(wx * .45, ay, 0), bd = b1.clone().sub(b0);
  const br = add(g, new THREE.BoxGeometry(.01, bd.length(), .01), M.iron, (b0.x + b1.x) / 2, (b0.y + b1.y) / 2, 0); br.rotation.z = -Math.atan2(bd.x, bd.y);
  return g; }
function switchPlate() { const g = new THREE.Group(); add(g, rb(.08, .12, .012, .006), M.ceramic, 0, 0, .006); add(g, rb(.018, .035, .02, .004), M.ceramic, 0, 0, .014); return g; }

// ------------- workshop -------------
// used enamel (sink, fridge): box faces map 0..1 each, so a frame in the texture lands on every edge: grime worked into
// the edges, chips knocked out of them (black iron with a grey rim), hairline crazing and water stains on the faces.
// mattress ticking: cream cotton with narrow grey-blue stripes, slubs, a faint body stain and bump (was a bare white box)
function tickingOf(mat) { let ls = 777; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#E9E1CE'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(88,104,122,.75)'; g.fillRect(x + 2, 0, 3, h); g.fillStyle = 'rgba(88,104,122,.45)'; g.fillRect(x + 7, 0, 1, h); }
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(${LR() < .5 ? '255,255,250' : '150,140,120'},${.05 + LR() * .06})`; g.fillRect(0, y, w, 1); } // weave
    for (let k = 0; k < 6; k++) { const x = LR() * w, y = LR() * h, r = 20 + LR() * 50; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(160,130,80,.12)'); gr.addColorStop(1, 'rgba(160,130,80,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } });
  mat.map = texOf(c); mat.map.repeat.set(3, 1); mat.bumpMap = texOf(c, { srgb: false }); mat.bumpMap.repeat.set(3, 1); mat.bumpScale = .6; mat.color.set(0xffffff); mat.needsUpdate = true; return mat; }
// vegetable skins: carrot (fine rings and root hairs' dots), potato (earthy speckle, eyes, bumps)
function vegSkin(kind) { let ls = kind === 'carrot' ? 41 : 43; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(128, 128, (g, w, h) => { if (kind === 'carrot') { g.fillStyle = '#E27A2C'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 3 + LR() * 5) { g.fillStyle = `rgba(150,70,20,${.25 + LR() * .3})`; g.fillRect(0, y, w, 1); } for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(120,60,20,.5)'; g.fillRect(LR() * w, LR() * h, 2, 1); } }
    else { g.fillStyle = '#B28C5C'; g.fillRect(0, 0, w, h); for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(${LR() < .5 ? '90,66,40' : '205,175,130'},${.2 + LR() * .3})`; g.fillRect(LR() * w, LR() * h, 1 + LR() * 2, 1 + LR() * 2); } for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(70,48,28,.8)'; g.beginPath(); g.ellipse(LR() * w, LR() * h, 2.5, 1.5, LR() * 3, 0, 7); g.fill(); } } });
  return { map: texOf(c), bumpMap: texOf(c, { srgb: false }), bumpScale: kind === 'carrot' ? 1 : 2 }; }
// sharpening stone: fine grit speckle, a darker oiled hollow worn down the middle, lighter edges
function gritOf() { let ls = 99; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(128, 128, (g, w, h) => { g.fillStyle = '#9A968C'; g.fillRect(0, 0, w, h); for (let k = 0; k < 1600; k++) { g.fillStyle = `rgba(${LR() < .5 ? '40,38,36' : '170,166,156'},${.25 + LR() * .35})`; g.fillRect(LR() * w, LR() * h, 1, 1); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(20,18,16,0)'); gr.addColorStop(.5, 'rgba(20,18,16,.18)'); gr.addColorStop(1, 'rgba(20,18,16,0)'); g.fillStyle = gr; g.fillRect(w * .1, 0, w * .8, h); });
  return { map: texOf(c), bumpMap: texOf(c, { srgb: false }), bumpScale: 1.5 }; }
function wearEnamel(mat, hex, seed = 1, { grime = .35, chips = 22 } = {}) {
  let ls = 9973 * seed; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const base = new THREE.Color(hex), b = `rgb(${base.r * 255 | 0},${base.g * 255 | 0},${base.b * 255 | 0})`;
  const c = canvas(512, 512, (g, w, h) => { g.fillStyle = b; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${LR() < .5 ? '255,255,250' : '170,165,150'},${.012 + LR() * .022})`; const r = 4 + LR() * 30; g.beginPath(); g.arc(LR() * w, LR() * h, r, 0, 6.3); g.fill(); } /* uneven glaze */
    const E = 22; for (const [x0, y0, x1, y1] of [[0, 0, 0, E], [0, h, 0, h - E], [0, 0, E, 0], [w, 0, w - E, 0]]) { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, `rgba(105,95,78,${grime})`); gr.addColorStop(1, 'rgba(105,95,78,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(140,120,80,${.02 + LR() * .035})`; const x = LR() * w, y = LR() * h; g.beginPath(); g.ellipse(x, y, 8 + LR() * 30, 3 + LR() * 10, LR() * 3, 0, 6.3); g.fill(); } /* water marks */
    g.strokeStyle = 'rgba(110,100,85,.1)'; g.lineWidth = 1; for (let i = 0; i < 14; i++) { let x = LR() * w, y = LR() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (LR() - .5) * 40; y += (LR() - .5) * 40; g.lineTo(x, y); } g.stroke(); } /* crazing */
    for (let i = 0; i < chips; i++) { const side = LR() * 4 | 0, t = LR(), d = 2 + LR() * 9, x = side === 0 ? d : side === 1 ? w - d : t * w, y = side === 2 ? d : side === 3 ? h - d : t * h, r = 1.5 + LR() * 3.5;
      g.fillStyle = 'rgba(205,205,200,.9)'; g.beginPath(); g.ellipse(x, y, r * 1.5, r * 1.1, LR() * 3, 0, 6.3); g.fill(); g.fillStyle = 'rgba(28,26,28,.95)'; g.beginPath(); g.ellipse(x, y, r, r * .7, LR() * 3, 0, 6.3); g.fill();
      if (LR() < .5) { g.fillStyle = 'rgba(120,60,28,.35)'; g.fillRect(x - 1, y, 2 + LR() * 2, 6 + LR() * 18); } } /* chips, some weeping rust */ });
  mat.map = texOf(c); mat.bumpMap = texOf(c, { srgb: false }); mat.bumpScale = .5; mat.color.set(0xffffff); mat.roughness = Math.max(mat.roughness, .42); mat.needsUpdate = true; return mat; }
// an old nail tin (Critic P10): worn painted tinplate with a paper label, rolled beads and a loose lid with a wire bail.
// Matte, rusty and only faintly reflective, so the night env map does not light it up like plastic.
let _tinMats = null;
function tinMats() { if (_tinMats) return _tinMats;
  let ls = 311; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; }; /* own RNG: the shared seed must not shift */ const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#4C4E44'; x.fillRect(0, 0, 512, 128); /* faded olive paint */
  for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(${90 + LR() * 60 | 0},${50 + LR() * 30 | 0},${25 + LR() * 15 | 0},${.15 + LR() * .4})`; const w = 2 + LR() * 14; x.fillRect(LR() * 512, LR() * 128, w, w * (.5 + LR())); } /* rust freckles */
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(110,58,28,${.15 + LR() * .25})`; const xx = LR() * 512; x.fillRect(xx, LR() * 30 + 90, 2 + LR() * 3, 10 + LR() * 30); } /* streaks from the bottom */
  x.fillStyle = '#C9B48A'; x.fillRect(150, 26, 230, 70); x.fillStyle = 'rgba(90,60,30,.25)'; for (let i = 0; i < 30; i++) x.fillRect(150 + LR() * 230, 26 + LR() * 70, 4 + LR() * 20, 2 + LR() * 6); /* stained paper label */
  x.fillStyle = '#8A2A1E'; x.fillRect(150, 30, 230, 9); x.fillRect(150, 83, 230, 9); x.fillStyle = '#2A2018'; x.font = 'bold 30px serif'; x.textAlign = 'center'; x.fillText('ГВОЗДИ', 265, 74);
  x.fillStyle = 'rgba(60,40,25,.6)'; x.fillRect(372, 26, 8, 70); x.fillRect(150, 26, 4, 70); /* torn, darkened edges */
  const env = ENV0; const body = new THREE.MeshStandardMaterial({ map: texOf(c), roughness: .78, metalness: .35, envMap: env, envMapIntensity: .25 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x5A4A3C, roughness: .7, metalness: .45, envMap: env, envMapIntensity: .25 });
  return (_tinMats = { body, rim }); }
function nailTin() { const g = new THREE.Group(); const { body, rim } = tinMats(); const r = .105, h = .13;
  add(g, new THREE.CylinderGeometry(r, r, h - .012, 32, 1, true), body, 0, h / 2, 0, 0, 2.9, 0);
  add(g, new THREE.CircleGeometry(r, 24), rim, 0, .002, 0, Math.PI / 2);
  for (const y of [.004, h - .008]) add(g, new THREE.TorusGeometry(r + .002, .004, 6, 32), rim, 0, y, 0, Math.PI / 2); /* rolled beads */
  const lid = new THREE.Group(); lid.position.set(.012, h + .004, -.006); lid.rotation.set(.05, .3, -.035); g.add(lid); /* sits a little askew, not pressed home */
  add(lid, new THREE.CylinderGeometry(r + .006, r + .006, .012, 32), rim); add(lid, new THREE.TorusGeometry(r - .02, .003, 5, 28), rim, 0, .007, 0, Math.PI / 2);
  const bail = new THREE.TorusGeometry(r + .004, .0018, 4, 20, Math.PI); add(g, bail, M.iron, 0, h - .02, 0, .5, 0, 0); /* wire handle, tipped back */
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(.006, 8, 6), rim, s * (r + .002), h - .02, 0);
  return g; }
function workbench() {
  const g = new THREE.Group(); const L = 1.7, D = .66, H = .9; const info = {};
  for (let i = 0; i < 3; i++) W(g, L, .065, D / 3 - .006, 0, H - .0325, -D / 2 + (i + .5) * D / 3, { mat: M.woodLight, r: .02 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W(g, .085, H - .065, .085, sx * (L / 2 - .1), (H - .065) / 2, sz * (D / 2 - .08), { mat: M.wood, grain: 1 });
  for (const sz of [-1, 1]) { W(g, L - .2, .11, .04, 0, H - .12, sz * (D / 2 - .06), { mat: M.wood }); W(g, L - .2, .07, .05, 0, .17, sz * (D / 2 - .08), { mat: M.wood }); }
  for (let i = 0; i < 4; i++) W(g, L - .24, .025, (D - .2) / 4 - .01, 0, .215, -D / 2 + .1 + (i + .5) * (D - .2) / 4, { mat: M.woodDark, r: .006 });
  // things on the lower shelf
  { const b = new THREE.Group(); b.position.set(.35, .23, 0); g.add(b); W(b, .36, .14, .22, 0, .07, 0, { mat: M.woodDark }); add(b, new THREE.CylinderGeometry(.01, .01, .3, 8), M.iron, 0, .2, 0, 0, 0, Math.PI / 2); for (const s of [-1, 1]) W(b, .02, .2, .02, s * .15, .15, 0, { mat: M.woodDark, grain: 1 }); }
  { const t = nailTin(); t.position.set(-.4, .228, .02); g.add(t); } /* Critic P10: was a bare steel puck that glowed at night */
  // front vice at the left end
  { const v = new THREE.Group(); v.position.set(-L / 2 + .22, H - .06, D / 2); g.add(v); add(v, rb(.24, .11, .05, .01), M.iron, 0, -.02, .025); W(v, .26, .1, .045, 0, -.02, .08, { mat: M.woodDark }); add(v, new THREE.CylinderGeometry(.014, .014, .18, 10), M.steel, 0, -.03, .14, Math.PI / 2); add(v, new THREE.CylinderGeometry(.01, .01, .22, 8), M.steel, 0, -.03, .23, 0, 0, Math.PI / 2); for (const s of [-1, 1]) add(v, new THREE.SphereGeometry(.018, 10, 8), M.steel, s * .11, -.03, .23); }
  // on top: plans, a tin of screwdrivers, a box of nails, a block plane
  add(g, new THREE.PlaneGeometry(.42, .3), M.plan, -.05, H + .002, .05, -Math.PI / 2, 0, .12);
  { const t = can(.13, .045, M.cans[1]); t.position.set(.62, H, -.2); g.add(t); for (let i = 0; i < 4; i++) { const sd = screwdriver([M.gripRed, M.gripYellow, M.gripBlue, M.gripRed][i], .17); sd.position.set(.62 + Math.cos(i * 1.6) * .02, H + .05, -.2 + Math.sin(i * 1.6) * .02); sd.rotation.set(rr(-.2, .2), 0, rr(-.25, .25)); g.add(sd); } }
  { const b = new THREE.Group(); b.position.set(.35, H, -.18); g.add(b); W(b, .16, .05, .1, 0, .025, 0, { mat: M.woodDark, r: .006 }); for (let i = 0; i < 10; i++) add(b, new THREE.CylinderGeometry(.002, .002, .05, 5), M.steel, rr(-.06, .06), .05, rr(-.035, .035), rr(-.6, .6), 0, Math.PI / 2 + rr(-.3, .3)); }
  { const p = new THREE.Group(); p.position.set(-.5, H, -.15); p.rotation.y = .4; g.add(p); W(p, .22, .05, .06, 0, .025, 0, { mat: M.woodRed, r: .012 }); add(p, rb(.12, .04, .05, .015), M.iron, -.01, .065, 0); add(p, new THREE.SphereGeometry(.02, 10, 8), M.woodRed, .07, .07, 0); }
  // curled shavings from the plane
  { const sm = std2(0xD8BC8E); sm.side = THREE.DoubleSide; sm.roughness = .8; for (let i = 0; i < 9; i++) { const r0 = rr(.009, .014), L = rr(.06, .11), wd = rr(.012, .02), pg = new THREE.PlaneGeometry(L, wd, 18, 1), P = pg.attributes.position; for (let j = 0; j < P.count; j++) { const u = (P.getX(j) + L / 2) / L, th = u * L / r0, r = r0 * (1 + .9 * (1 - u)); P.setXYZ(j, r * Math.sin(th), P.getY(j) + u * wd * .6, r * Math.cos(th)); } pg.computeVertexNormals(); add(g, pg, sm, -.38 + rr(-.08, .1), H + .016, -.1 + rr(-.08, .1), Math.PI / 2 + rr(-.4, .4), rr(0, 6), 0); } } /* [workshop round] thin, wide plane shavings rolled into loose spirals (round tori read as macaroni) */
  // more bench clutter like the photo: offcut blocks, tape measure, a carpenter's pencil, a C-clamp at the front edge
  for (const [x, z, w, h, a] of [[.22, .16, .2, .05, .3], [.3, .2, .12, .04, -.2], [.26, .17, .09, .09, .5]]) W(g, w, h, .07, x, H + h / 2 + (h > .06 ? .0 : 0), z, { mat: M.woodLight, ry: a, r: .006 });
  { const t = new THREE.Group(); t.position.set(.72, H, .16); t.rotation.y = -.4; g.add(t); add(t, rb(.07, .07, .035, .012), M.gripYellow, 0, .018, 0, Math.PI / 2); add(t, new THREE.CylinderGeometry(.012, .012, .036, 12), M.iron, 0, .036, 0); add(t, rb(.12, .002, .018, .0008), M.gripYellow, .09, .002, .0); }
  { const p = add(g, rb(.16, .008, .014, .003), M.gripRed, .02, H + .006, .12, 0, .5); void p; }
  { const c = new THREE.Group(); c.position.set(-.3, H - .03, D / 2 - .02); g.add(c); const cs = new THREE.Shape(); cs.moveTo(0, .09); cs.lineTo(.07, .09); cs.lineTo(.07, -.09); cs.lineTo(0, -.09); cs.lineTo(0, -.07); cs.lineTo(.05, -.07); cs.lineTo(.05, .07); cs.lineTo(0, .07); add(c, EX(cs, .02), M.gripRed, -.01, 0, .02, 0, -Math.PI / 2, 0); add(c, new THREE.CylinderGeometry(.006, .006, .12, 8), M.steel, 0, -.06, 0); add(c, rb(.05, .01, .01, .003), M.steel, 0, -.12, 0); }
  bake(g); g.userData.info = { top: H }; return g;
}
function stool(S = .48) { const g = new THREE.Group(); add(g, lathe([[0, 0], [.15, 0], [.165, .008], [.172, .024], [.166, .04], [.15, .048], [0, .048]], 32), M.wood, 0, S - .048, 0);
  add(g, new THREE.CylinderGeometry(.152, .152, .002, 20), M.woodDark, 0, S + .0005, 0);   // [PROPS round] the seat's top: one slab of straight grain, worn dark by sitting (the lathe's UVs swirled the grain round the centre like an orange plastic lid)
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const l = add(g, new THREE.CylinderGeometry(.022, .018, S - .03, 10), M.woodDark, Math.cos(a) * .12, (S - .03) / 2, Math.sin(a) * .12); l.rotation.set(Math.sin(a) * .13, 0, -Math.cos(a) * .13); }
  const ring = add(g, new THREE.TorusGeometry(.14, .011, 6, 28), M.woodDark, 0, .17, 0, Math.PI / 2); void ring; bake(g); g.userData.info = { seat: S }; return g; }
// ---- tools: built with their handle along +y and the grip point at the origin region ----
const EX = (sh, depth, bev = .003) => { const e = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 1, curveSegments: 6 }); e.translate(0, 0, -depth / 2); return e; };
function roundRect(w, h, r) { const s = new THREE.Shape(); s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return s; }
function wrench(len = .26) {
  const g = new THREE.Group(); const R0 = len * .12, t = len * .05, hw = len * .095;
  // open jaw head at the top
  const s = R0 * .42, yt = Math.sqrt(R0 * R0 - s * s); const head = new THREE.Shape(); head.moveTo(s, yt); head.absarc(0, 0, R0, Math.atan2(yt, s), Math.atan2(yt, -s), true); head.lineTo(-s, -R0 * .05); head.absarc(0, -R0 * .05, s, Math.PI, 2 * Math.PI, false); head.lineTo(s, yt);
  add(g, EX(head, t), M.steel, 0, len / 2, 0, 0, 0, .3);
  // box end with a hole at the bottom
  const ring = new THREE.Shape(); ring.absarc(0, 0, R0 * .82, 0, Math.PI * 2, false); const hole = new THREE.Path(); hole.absarc(0, 0, R0 * .48, 0, Math.PI * 2, true); ring.holes.push(hole);
  add(g, EX(ring, t * .9), M.steel, 0, -len / 2, 0);
  add(g, EX(roundRect(hw, len - R0 * 1.6, hw * .45), t * .7), M.steel, 0, 0, 0);
  add(g, EX(roundRect(hw * .45, len * .5, hw * .2), t * .3, .001), M.chrome, 0, 0, t * .45);
  g.userData.grip = V(0, -len * .05, 0); return g;
}
function hammer() { const g = new THREE.Group(); add(g, lathe([[0, -.15], [.014, -.15], [.017, -.12], [.015, 0], [.012, .1], [.014, .14], [0, .14]], 14), M.woodRed); add(g, rb(.12, .035, .035, .008), M.iron, .02, .155, 0); add(g, new THREE.CylinderGeometry(.022, .02, .035, 16), M.iron, .085, .155, 0, 0, 0, Math.PI / 2); add(g, new THREE.CircleGeometry(.0205, 16), M.steel, .1035, .155, 0, 0, Math.PI / 2, 0); /* [workshop round] a bright struck face on the black head */
  for (const s of [-1, 1]) add(g, new THREE.TorusGeometry(.05, .008, 6, 12, Math.PI * .45), M.iron, -.03, .115, s * .009, 0, 0, Math.PI * .55); g.userData.grip = V(0, -.07, 0); return g; }
function screwdriver(mat, len = .2) { const g = new THREE.Group(); const hl = len * .45; add(g, lathe([[0, 0], [.012, 0], [.016, hl * .2], [.016, hl * .8], [.011, hl], [0, hl]], 16), mat, 0, -hl, 0); add(g, new THREE.CylinderGeometry(.0035, .0035, len - hl, 8), M.steel, 0, (len - hl) / 2, 0); add(g, rb(.009, .012, .002, .0008), M.steel, 0, len - hl + .004, 0); g.userData.grip = V(0, -hl / 2, 0); return g; }
function pliers() { const g = new THREE.Group(); for (const s of [-1, 1]) { const h = new THREE.Group(); h.rotation.z = s * .12; g.add(h); add(h, rb(.012, .11, .008, .003), M.steel, 0, .03, 0); add(h, new THREE.CylinderGeometry(.009, .007, .1, 10), M.gripRed, s * -.004, -.07, 0); add(h, rb(.012, .06, .01, .004), M.steel, 0, .11, 0, 0, 0, -s * .14); } add(g, new THREE.CylinderGeometry(.012, .012, .016, 14), M.steel, 0, .085, 0, Math.PI / 2); g.userData.grip = V(0, -.07, 0); return g; }
function saw() { const g = new THREE.Group(); const sh = new THREE.Shape(); sh.moveTo(0, -.05); sh.lineTo(.44, -.03); for (let x = .44; x > 0; x -= .016) sh.lineTo(x - .008, -.03 - .012 * (1 - x / .44) - .012); sh.lineTo(0, -.11); sh.lineTo(0, -.05);
  const b = add(g, new THREE.ShapeGeometry(sh), M.steel, .02, 0, 0); b.material = M.steel; add(g, new THREE.ShapeGeometry(sh), M.steel, .02, 0, -.0005, 0, Math.PI, 0).scale.x = -1;
  const hs = roundRect(.13, .13, .03); const hole = new THREE.Path(); hole.absellipse(-.01, .01, .03, .042, 0, Math.PI * 2, true); hs.holes.push(hole); add(g, EX(hs, .025), M.woodRed, -.04, -.06, 0); for (const y of [-.04, -.08]) screw(g, .015, y, .015); g.userData.grip = V(-.04, -.06, 0); return g; }
function toolWall() {
  const g = new THREE.Group(); const Wd = 1.4, H = .78; const tools = {};
  for (let i = 0; i < 3; i++) W(g, Wd, H / 3 - .012, .035, 0, (i + .5) * H / 3, 0, { mat: M.wood, r: .008 });
  for (const [w, h, x, y] of [[Wd + .08, .06, 0, H + .02], [Wd + .08, .06, 0, -.02], [.06, H + .1, Wd / 2 + .01, H / 2], [.06, H + .1, -Wd / 2 - .01, H / 2]]) W(g, w, h, .05, x, y, .01, { mat: M.woodDark, r: .01 });
  const peg = (x, y) => add(g, new THREE.CylinderGeometry(.007, .007, .05, 8), M.woodDark, x, y, .04, Math.PI / 2);
  const hang = (name, obj, x, y, rz = 0, s = 1.3) => { bake(obj); obj.traverse(o => { if (o.isMesh) o.castShadow = false; }); obj.position.set(x, y, .045); obj.rotation.z = rz; obj.scale.setScalar(s); obj.userData.live = true; g.add(obj); tools[name] = obj; };
  // big wrench on the left, a row of spanners, hammer, saw, screwdrivers, pliers, adjustable bar
  hang('wrenchBig', wrench(.36), -.58, .4, .08); peg(-.58, .66);
  [.22, .2, .18, .16, .14].forEach((l, i) => { hang('wrench' + (i + 1), wrench(l), -.38 + i * .1, .55 + (.22 - l) * .65, 0); peg(-.38 + i * .1, .72); });
  hang('hammer', hammer(), .17, .5, 0); peg(.17, .74);
  hang('saw', saw(), .42, .74, -Math.PI / 2 + .02); peg(.38, .74);
  ['gripRed', 'gripYellow', 'gripBlue'].forEach((c, i) => { hang('screwdriver' + (i + 1), screwdriver(M[c], .2), -.36 + i * .08, .2, Math.PI); });
  add(g, rb(.3, .02, .05, .006), M.woodDark, -.28, .3, .04);
  hang('pliers', pliers(), -.02, .2, 0); peg(-.02, .33);
  hang('wrenchLong', wrench(.3), .3, .16, Math.PI / 2 - .1);
  bake(g); return { g, tools };
}
function workshopShelves(w = .95) { const g = new THREE.Group(); const levels = [0, .42, .84];
  for (const y of levels) { const s = wallShelf(w); s.position.y = y; g.add(s); }
  // books, jars, cans, a box
  let x = -w / 2 + .06; for (let i = 0; i < 6; i++) { const bw = rr(.025, .045), bh = rr(.17, .23); const b = closedBook(bw, bh, .16, M.covers[i % M.covers.length]); b.position.set(x + bw / 2, .84 + .018, .12); b.rotation.z = i === 5 ? -.25 : 0; g.add(b); x += bw + .004; }
  { const j = jar(.12, .045, M.jarGlass); j.position.set(.25, .858, .12); g.add(j); const c = can(.1, .04, M.cans[0]); c.position.set(.36, .858, .1); g.add(c); }
  [[-.3, M.cans[2]], [-.18, M.cans[3]], [.05, M.cans[1]]].forEach(([x, m]) => { const c = can(rr(.08, .12), rr(.035, .045), m); c.position.set(x, .438, .12); g.add(c); });
  { const j = jar(.1, .05, M.jarGlass); j.position.set(.28, .438, .12); g.add(j); }
  W(g, .22, .1, .16, -.25, .018 + .05, .12, { mat: M.woodRed }); { const j = jar(.09, .04, M.glazeBlue); j.position.set(.05, .018, .12); g.add(j); } { const c = can(.13, .05, M.cans[3]); c.position.set(.25, .018, .12); g.add(c); }
  // denser like the photo: books on the middle shelf, more jars on top, a jar and a tin below
  { let x = .08; for (let k = 0; k < 3; k++) { const bw = rr(.03, .04), bh = rr(.16, .2); const b = closedBook(bw, bh, .15, M.covers[(k + 3) % M.covers.length]); b.position.set(x, .438, .11); g.add(b); x += bw + .004; } }
  for (const [x, h, r] of [[-.08, .09, .035], [.08, .12, .04]]) { const jj = jar(h, r, M.jarGlass); jj.position.set(x, .858, .1); g.add(jj); }
  { const jj = jar(.1, .035, M.glazeCream); jj.position.set(-.42, .018, .12); g.add(jj); const c = can(.07, .05, M.cans[0]); c.position.set(.4, .018, .1); g.add(c); }
  // packed like the photo's workshop: every gap gets the small stuff a workshop collects (kraft boxes, twine, a coil of
  // wire, a rolled rag)
  { const kraft = std2(0xA9845A), kraftD = std2(0x8C6A44), twine = std2(0xC8B080), rag = std2(0x7A8A9A);
    const box = (x, y, w, h, d, m, ry = 0) => { const b = add(g, rb(w, h, d, .004), m, x, y + h / 2, .12, 0, ry, 0); const fz = d / 2 + .0015; add(g, rb(w * .72, h * .34, .003, .001), M.linen, x + Math.sin(ry) * fz, y + h * .56, .12 + Math.cos(ry) * fz, 0, ry, 0); /* paper label on the front */ add(g, rb(w * 1.01, .004, d * 1.01, .001), m, x, y + h * .8, .12, 0, ry, 0); /* lid rim */ return b; };
    const spool = (x, y) => { add(g, new THREE.CylinderGeometry(.03, .03, .055, 14), twine, x, y + .0275 + .006, .12); for (const k of [0, 1]) add(g, new THREE.CylinderGeometry(.036, .036, .006, 14), M.woodLight, x, y + .003 + k * .061, .12); };
    // top
    box(-.165, .858, .06, .07, .1, kraftD, .1); spool(.16, .858);
    // middle
    spool(-.055, .438); box(.41, .438, .1, .08, .13, kraft, -.08); box(.41, .518, .085, .05, .11, kraftD, .12);
    add(g, new THREE.CylinderGeometry(.026, .026, .1, 10), rag, -.43, .438 + .026, .12, Math.PI / 2, 0, 0);
    // bottom
    add(g, new THREE.TorusGeometry(.042, .006, 6, 18), M.copper, -.07, .018 + .006, .12, Math.PI / 2, 0, 0); add(g, new THREE.TorusGeometry(.036, .006, 6, 18), M.copper, -.07, .018 + .018, .12, Math.PI / 2, 0, .3);
    box(.145, .018, .08, .06, .11, kraft, .2); }
  return bake(g); }

let _boxPaint = null; const boxPaint = () => _boxPaint || (_boxPaint = wearEnamel(new THREE.MeshStandardMaterial({ roughness: .5, metalness: .35, envMap: M.env, envMapIntensity: .4 }), 0x9E2A1E, 11, { grime: .3, chips: 14 }));
function sideBench() {
  const g = new THREE.Group(); const L = 1.0, D = .42, H = .78;
  W(g, L, .05, D, 0, H - .025, 0, { mat: M.woodLight, r: .01 }); W(g, L - .02, .045, D - .02, 0, .14, 0, { mat: M.woodDark, r: .008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W(g, .06, H - .05, .06, sx * (L / 2 - .05), (H - .05) / 2, sz * (D / 2 - .05), { mat: M.wood, grain: 1 });
  W(g, L - .1, .08, .03, 0, H - .09, D / 2 - .03, { mat: M.wood });
  // on top: pencil cup, jars of screws, a small toolbox, an oil can, a rag
  { const c = can(.11, .035, M.cans[2]); c.position.set(.36, H, .05); g.add(c); for (let i = 0; i < 5; i++) { const pc = add(g, new THREE.CylinderGeometry(.004, .004, .15, 6), [M.gripYellow, M.gripRed, M.gripBlue][i % 3], .36 + rr(-.015, .015), H + .14, .05 + rr(-.015, .015), rr(-.2, .2), 0, rr(-.2, .2)); void pc; } }
  for (const [x, z, h] of [[.18, -.08, .1], [.07, -.1, .08]]) { const j = jar(h, .035, M.jarGlass); j.position.set(x, H, z); g.add(j); }
  { const b = new THREE.Group(); b.position.set(-.2, H, -.02); b.rotation.y = .15; g.add(b); add(b, rb(.26, .1, .14, .01), boxPaint(), 0, .05, 0); /* painted steel, chipped (was glossy red plastic) */ add(b, rb(.27, .015, .15, .006), M.iron, 0, .1, 0); add(b, new THREE.TorusGeometry(.04, .007, 6, 14, Math.PI), M.iron, 0, .108, 0); }
  { const o = new THREE.Group(); o.position.set(-.4, H, .08); g.add(o); add(o, lathe([[0, 0], [.04, 0], [.042, .05], [.02, .08], [.006, .09], [.004, .17], [0, .17]], 18), M.copper); }
  { const r = add(g, drapeGeo(.18, .12, .02, { wrinkle: .006 }), M.clothBlue, .02, H + .002, .1); r.rotation.y = .5; }
  // under-shelf crate with offcuts
  { const b = new THREE.Group(); b.position.set(-.15, .165, 0); g.add(b); W(b, .4, .16, .3, 0, .08, 0, { mat: M.woodDark }); for (let i = 0; i < 4; i++) W(b, rr(.25, .38), .03, .05, rr(-.03, .03), .17 + i * .01, -.1 + i * .065, { mat: M.woodLight, ry: rr(-.15, .15) }); }
  bake(g); g.userData.info = { top: H }; return g;
}

// ------------- deck -------------
function telescope() {
  /* tripod tall enough for the hero's eye: eyepiece ~1.34 m (Grab); the legs stretch, the tube and brass keep their size */
  const g = new THREE.Group(); const top = 1.36, LK = top / 1.08;
  // aged brass (less candy-yellow than TB) and a dark lacquered tube body, like an old field telescope
  const TB = new THREE.MeshStandardMaterial({ color: 0xA08C62, metalness: .9, roughness: .34, envMap: M.env, envMapIntensity: .85 }) /* [photo round] polished brass fittings that catch the light like the photo's; low saturation so the sun never turns it orange plastic */, LAC = new THREE.MeshStandardMaterial({ color: 0x75623F, roughness: .46, metalness: .85, envMap: M.env, envMapIntensity: .8 }) /* the photo's tube is brass all over: a darker, hand-worn brass body between the bright fittings (the navy lacquer read as black stripes) */;
  for (let i = 0; i < 3; i++) { const l = new THREE.Group(); l.position.set(0, top, 0); l.rotation.y = i * Math.PI * 2 / 3 + .4; l.scale.set(1, LK, LK); g.add(l); W(l, .035, 1.16, .025, 0, -.55, .19, { mat: M.woodDark, grain: 1, r: .008, rx: -.33 }); add(l, rb(.04, .025, .035, .008), TB, 0, -.02, .02); add(l, rb(.022, .016, .13, .004), M.woodDark, 0, -.5, .105); add(l, new THREE.CylinderGeometry(.006, .006, .03, 6), TB, 0, -1.08, .38); }
  add(g, new THREE.CylinderGeometry(.065, .065, .014, 3), M.woodDark, 0, top - .5 * LK, 0); // spreader tray
  add(g, new THREE.CylinderGeometry(.05, .06, .05, 20), TB, 0, top, 0);
  const yoke = new THREE.Group(); yoke.position.set(0, top + .05, 0); g.add(yoke);
  for (const s of [-1, 1]) add(yoke, rb(.015, .1, .03, .006), TB, 0, .05, s * .06);
  const tube = new THREE.Group(); tube.position.set(0, .1, 0); tube.rotation.z = .38; yoke.add(tube); tube.userData.live = true;
  const prof = [[0, -.42], [.02, -.42], [.02, -.36], [.03, -.355], [.03, -.25], [.038, -.24], [.038, -.2], [.045, -.19], [.046, .25], [.054, .26], [.054, .3], [.058, .32], [.058, .5], [.062, .51], [.062, .53], [.054, .53], [.054, .52], [0, .52]];
  const tg = lathe(prof.map(([r, y]) => [r, y]), 28); tg.rotateZ(-Math.PI / 2); add(tube, tg, TB);
  add(tube, new THREE.CylinderGeometry(.0475, .0475, .43, 28, 1, true), LAC, .03, 0, 0, 0, 0, Math.PI / 2); // lacquered body
  for (const x of [-.19, .25, .32]) add(tube, new THREE.TorusGeometry(x > 0 ? .056 : .046, .005, 6, 24), M.copper, x, 0, 0, 0, Math.PI / 2);
  add(tube, new THREE.CircleGeometry(.052, 24), new THREE.MeshStandardMaterial({ color: 0x1A2A3A, roughness: .05, metalness: .2, envMap: M.env, envMapIntensity: 1.5 }), .515, 0, 0, 0, Math.PI / 2);
  add(tube, new THREE.CylinderGeometry(.012, .012, .14, 8), TB, 0, 0, 0, Math.PI / 2);
  add(tube, lathe([[0, 0], [.024, 0], [.026, .012], [.022, .05], [0, .05]], 18), M.rubber, -.47, 0, 0, 0, 0, Math.PI / 2); // eyepiece cup
  { const f = lathe([[0, -.09], [.011, -.09], [.011, .07], [.016, .08], [.016, .1], [0, .1]], 14); f.rotateZ(-Math.PI / 2); add(tube, f, TB, .1, .07, 0); for (const x of [.04, .16]) add(tube, rb(.012, .025, .01, .003), TB, x, .052, 0); }
  bake(tube); bake(g); g.userData.tube = tube; return g;
}

// ================= round 6: things the hero handles (food, wood, gear, chores) =================
let MX = null;
// canvas twill for the coat: diagonal ribs, slubs, rubbed-pale wear and grime (map near white so the material colour rules)
let _twill = null;
function twillOf() { if (_twill) return _twill; let ls = 3131; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(128, 128, (g, w, h) => { g.fillStyle = '#F2F2F2'; g.fillRect(0, 0, w, h);
    for (let k = -h; k < w; k += 3) { g.strokeStyle = `rgba(${LR() < .5 ? '150,150,150' : '255,255,255'},${.15 + LR() * .2})`; g.lineWidth = 1; g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); }
    for (let k = 0; k < 25; k++) { const x = LR() * w, y = LR() * h, r = 6 + LR() * 16; const gr = g.createRadialGradient(x, y, 0, x, y, r); const pale = LR() < .5; gr.addColorStop(0, pale ? 'rgba(255,250,235,.25)' : 'rgba(40,36,28,.14)'); gr.addColorStop(1, 'rgba(128,128,128,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } });
  const t = texOf(c); t.repeat.set(9, 9); const b = texOf(c, { srgb: false }); b.repeat.set(9, 9); _twill = { map: t, bumpMap: b, bumpScale: 1.2 }; return _twill; }
// leather (quiver, bow grip, diary): was a flat brown at roughness .7 and read as plastic close up. Pebbled grain, fine
// creases, darker worn patches and paler scuffs, with the same pattern as a bump map so the grain catches the light.
let _bcloth = null;
function bookClothOf() { if (_bcloth) return _bcloth; let ls = 9191; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#DADADA'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(${LR() < .5 ? '150,150,150' : '255,255,255'},${.1 + LR() * .14})`; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(${LR() < .5 ? '150,150,150' : '255,255,255'},${.08 + LR() * .12})`; g.fillRect(x, 0, 1, h); } // the weave
    const e = g.createLinearGradient(0, 0, w, 0); e.addColorStop(0, 'rgba(255,250,235,.45)'); e.addColorStop(.06, 'rgba(255,250,235,0)'); e.addColorStop(.94, 'rgba(255,250,235,0)'); e.addColorStop(1, 'rgba(255,250,235,.45)'); g.fillStyle = e; g.fillRect(0, 0, w, h);
    const f = g.createLinearGradient(0, 0, 0, h); f.addColorStop(0, 'rgba(255,250,235,.4)'); f.addColorStop(.05, 'rgba(255,250,235,0)'); f.addColorStop(.95, 'rgba(255,250,235,0)'); f.addColorStop(1, 'rgba(255,250,235,.4)'); g.fillStyle = f; g.fillRect(0, 0, w, h); // edges rubbed pale
    for (let k = 0; k < 14; k++) { const x = LR() * w, y = LR() * h, r = 8 + LR() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, LR() < .5 ? 'rgba(40,30,20,.18)' : 'rgba(255,245,225,.16)'); gr.addColorStop(1, 'rgba(128,128,128,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } });
  const t = texOf(c); const b = texOf(c, { srgb: false }); _bcloth = { map: t, bumpMap: b, bumpScale: .9 }; return _bcloth; }
let _leather = null;
function leatherOf() { if (_leather) return _leather; let ls = 7171; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#E8E8E8'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2600; k++) { const x = LR() * w, y = LR() * h, r = .6 + LR() * 1.4; g.fillStyle = `rgba(${LR() < .55 ? '140,140,140' : '255,255,255'},${.06 + LR() * .1})`; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); } // pebble grain
    for (let k = 0; k < 30; k++) { g.strokeStyle = `rgba(90,90,90,${.1 + LR() * .15})`; g.lineWidth = .6 + LR() * .8; g.beginPath(); let x = LR() * w, y = LR() * h; g.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (LR() - .5) * 26; y += (LR() - .3) * 10; g.lineTo(x, y); } g.stroke(); } // creases
    for (let k = 0; k < 18; k++) { const x = LR() * w, y = LR() * h, r = 12 + LR() * 34; const gr = g.createRadialGradient(x, y, 0, x, y, r); const pale = LR() < .4; gr.addColorStop(0, pale ? 'rgba(255,245,225,.14)' : 'rgba(40,30,20,.12)'); gr.addColorStop(1, 'rgba(128,128,128,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } });
  const t = texOf(c); t.repeat.set(2, 2); const b = texOf(c, { srgb: false }); b.repeat.set(2, 2); _leather = { map: t, bumpMap: b, bumpScale: .9 }; return _leather; }
function mx() { if (MX) return MX; const s = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .8, ...o });
  /* terracotta: fired-clay mottling, white salt bloom up by the rim, a darker damp band at the foot, scuffs (was a flat orange) */
  const tc = canvas(256, 128, (g, w, h) => { g.fillStyle = '#B5623C'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${150 + Math.random() * 60 | 0},${70 + Math.random() * 40 | 0},${40 + Math.random() * 25 | 0},${.12 + Math.random() * .25})`; const r = 1 + Math.random() * 5; g.fillRect(Math.random() * w, Math.random() * h, r, r); }
    const gb = g.createLinearGradient(0, 0, 0, h); /* lathe v runs foot (canvas bottom) -> rim (~35% from the top) -> inside */ gb.addColorStop(.2, 'rgba(235,225,205,0)'); gb.addColorStop(.33, 'rgba(235,225,205,.45)'); gb.addColorStop(.45, 'rgba(235,225,205,0)'); gb.addColorStop(.75, 'rgba(70,35,20,0)'); gb.addColorStop(1, 'rgba(70,35,20,.5)'); g.fillStyle = gb; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(240,232,215,${.08 + Math.random() * .18})`; g.fillRect(Math.random() * w, h * (.3 + Math.random() * .12), 3 + Math.random() * 18, 1 + Math.random() * 3); }
    for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(90,45,25,.25)'; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + 6 + Math.random() * 14, y + Math.random() * 3 - 1.5); g.stroke(); } });
  /* the watering can: green paint gone chalky, chipped to grey zinc at the edges, a few rust freckles (was smooth plastic) */
  const zc = canvas(256, 128, (g, w, h) => { g.fillStyle = '#62806A'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${80 + Math.random() * 40 | 0},${110 + Math.random() * 40 | 0},${90 + Math.random() * 30 | 0},${.1 + Math.random() * .2})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 2 + Math.random() * 6); }
    for (let i = 0; i < 45; i++) { const x = Math.random() * w, y = Math.random() < .5 ? Math.random() * h * .15 : h * (.85 + Math.random() * .15); g.fillStyle = 'rgba(160,165,160,.85)'; g.beginPath(); g.ellipse(x, y, 2 + Math.random() * 6, 1 + Math.random() * 3, Math.random() * 3, 0, 6.3); g.fill(); }
    for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(120,60,30,${.2 + Math.random() * .35})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 5); } });
  MX = { terracotta: s(0xffffff, { roughness: 1, map: texOf(tc), bumpMap: texOf(tc, { srgb: false }), bumpScale: .8 }), soil: s(0x3A2A1E, { roughness: 1 }), leaf: s(0x557F3C, { roughness: .6, side: THREE.DoubleSide }), leafDark: s(0x36572A, { roughness: .65, side: THREE.DoubleSide }),
    carrot: s(0xFFFFFF, { roughness: .6, ...vegSkin('carrot') }), onion: s(0xC8964E, { roughness: .45 }), potato: s(0xFFFFFF, { roughness: .9, ...vegSkin('potato') }), stone: s(0xF0EEE8, { ...gritOf(), roughness: .9 }), stoneDark: s(0xC8C4BC, { ...gritOf(), roughness: .85 }),
    straw: s(0xC9A45A, { roughness: 1 }), zinc: s(0xffffff, { metalness: .25, roughness: .74, envMap: M.env, envMapIntensity: .35, map: texOf(zc), bumpMap: texOf(zc, { srgb: false }), bumpScale: .6 }), bark: (() => { const c = canvas(256, 256, (g) => { g.fillStyle = '#4E3A2A'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 70; i++) { const x0 = Math.random() * 256; g.strokeStyle = Math.random() < .6 ? 'rgba(28,18,10,.8)' : 'rgba(120,96,70,.55)'; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); let x = x0; g.moveTo(x, -5); for (let y = 0; y <= 260; y += 16) { x += (Math.random() - .5) * 6; g.lineTo(x, y); } g.stroke(); }
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${70 + Math.random() * 40},${50 + Math.random() * 30},.35)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 6 + Math.random() * 14); } });
      return s(0xffffff, { map: texOf(c), bumpMap: texOf(c, { srgb: false }), bumpScale: 3, roughness: 1, side: THREE.DoubleSide }); })(),
    splitwood: (() => { const c = canvas(128, 256, (g) => { g.fillStyle = '#C8955E'; g.fillRect(0, 0, 128, 256); for (let i = 0; i < 40; i++) { g.strokeStyle = Math.random() < .5 ? 'rgba(120,70,35,.35)' : 'rgba(240,200,150,.35)'; g.lineWidth = .5 + Math.random() * 2; g.beginPath(); let x = Math.random() * 128; g.moveTo(x, 0); for (let y = 0; y <= 256; y += 32) { x += (Math.random() - .5) * 5; g.lineTo(x, y); } g.stroke(); } });
      return s(0xffffff, { map: texOf(c), bumpMap: texOf(c, { srgb: false }), bumpScale: 2, roughness: .9 }); })(), endgrain: endGrainMat(11, false),
    grille: s(0x8A7350, { roughness: 1 }), meat: s(0xA2343A, { roughness: .5 }), fat: s(0xEEDCCB, { roughness: .6 }), paper: s(0xD8C7A0, { roughness: .95 }), sack: s(0xB59B6E, { roughness: 1 }),
    jacket: s(0x56613F, { roughness: .95, ...twillOf() }), jacketDark: s(0x3E4733, { roughness: .95, ...twillOf() }), /* waxed-cotton twill with wear, not a flat plastic green */ patch: s(0x4F4630, { roughness: 1, ...twillOf() }), leather: s(0x9A6038, { roughness: .78, ...leatherOf() }), fletch: s(0xD9D2C0, { roughness: .9, side: THREE.DoubleSide }),
    rope: s(0x6E5C3E, { roughness: 1 }), stew: s(0x6A3A1E, { roughness: .35 }), sawdust: s(0xE2C08A, { roughness: 1 }), ribbon: s(0xA0302A, { roughness: .8, side: THREE.DoubleSide }) };
  return MX; }
// a box between two points (legs, struts) and a tapered rod between two points
function strut(parent, a, b, w, d, mat) { const dir = b.clone().sub(a); const m = add(parent, rb(w, dir.length(), d, Math.min(w, d) * .25), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize()); return m; }
function rod(parent, a, b, r0, r1, mat, seg = 10) { const dir = b.clone().sub(a); const m = add(parent, new THREE.CylinderGeometry(r1, r0, dir.length(), seg), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize()); return m; }
// ---- natural logs: one unit log (radius ~1, length 1 along z) per variant, with material groups 0 bark, 1 end grain, 2 split face.
// Uneven radius and bulges along the length, a slight bend, knots/branch stubs, tilted sawn or rough chopped ends,
// split halves/quarters for firewood, and a curling strip of loose bark on some.
const LOG_VARIANTS = [{ split: 0, stubs: 1 }, { split: 0, stubs: 2, strip: 1, bend: .07 }, { split: 0, stubs: 0, bend: .1, chop: 1 }, { split: 1, stubs: 1 }, { split: 2, stubs: 0, chop: 1 }, { split: 2, stubs: 1, strip: 1 }, { split: 1, stubs: 0, chop: 1, bend: .05 }];
const _logGeos = [];
function logGeo(vi, lo = false) {
  const ck = vi + (lo ? 'lo' : ''); if (_logGeos[ck]) return _logGeos[ck]; const NB = lo ? 11 : 18, NH = lo ? 7 : 11, NL = lo ? 3 : 6;
  const o = LOG_VARIANTS[vi]; let sd = (vi + 1) * 7919; const rn = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }; const ri = (a, b) => a + rn() * (b - a);
  // cross-section outline in the plane: runs of bark (b) and split (s) points
  const pts = [];
  if (o.split === 0) { for (let j = 0; j <= NB; j++) pts.push([j / NB * Math.PI * 2, 1, 'b']); }
  else { const a1 = o.split === 1 ? Math.PI : Math.PI / 2; for (let j = 0; j <= NH; j++) pts.push([j / NH * a1, 1, 'b']);
    const line = (x0, y0, x1, y1, n) => { for (let k = 1; k <= n; k++) { const t = k / n; pts.push([null, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], 's']); } };
    if (o.split === 1) line(-1, 0, 1, 0, NL); else { line(0, 1, 0, 0, lo ? 2 : 3); line(0, 0, 1, 0, lo ? 2 : 3); } }
  const P2 = pts.map(([a, r, t], i) => { const q = a === null ? r : [Math.cos(a), Math.sin(a)]; return { x: q[0], y: q[1], t, a: a === null ? Math.atan2(q[1], q[0]) : a, i }; });
  let cx = 0, cy = 0; for (const p of P2) { cx += p.x; cy += p.y; } cx /= P2.length; cy /= P2.length; if (o.split === 0) cx = cy = 0;
  const ph = [ri(0, 6), ri(0, 6), ri(0, 6), ri(0, 6)], bend = [ri(-1, 1) * (o.bend || .03), ri(-1, 1) * (o.bend || .03)];
  const tilt = [[ri(-.06, .06), ri(-.06, .06)], [ri(-.06, .06), ri(-.06, .06)]]; if (o.chop) tilt[1] = [ri(-.18, .18), ri(-.15, .15)];
  const K = lo ? 6 : 10; const ring = []; // ring[k][j] = [x,y,z] (centred on the piece, pith at (-cx,-cy))
  for (let k = 0; k < K; k++) { const z0 = k / (K - 1) - .5; const row = [];
    for (const p of P2) { const bulge = 1 + .055 * Math.sin(z0 * 4.1 + ph[0]) + .03 * Math.sin(z0 * 9.3 + ph[1]) + .045 * Math.sin(p.a * 3 + ph[2] + z0 * 2.2) + .025 * Math.sin(p.a * 7 + ph[3]);
      const s = p.t === 'b' ? bulge : 1 + (bulge - 1) * .3; let x = p.x * s, y = p.y * s; if (p.t === 's') { x += .025 * Math.sin(z0 * 13 + p.i); y += .025 * Math.cos(z0 * 11 + p.i * 2); }
      const bz = z0 * z0 - .25; x += bend[0] * bz * 4 - cx; y += bend[1] * bz * 4 - cy;
      let z = z0; if (k === 0) z += tilt[0][0] * x + tilt[0][1] * y; if (k === K - 1) z += tilt[1][0] * x + tilt[1][1] * y + (o.chop ? ri(-.02, .02) : 0);
      row.push([x, y, z]); } ring.push(row); }
  const parts = [], mats = [];
  // side strips: one per run of same-tag segments, so bark/split edges stay sharp
  let j0 = 0; const N = P2.length;
  const segTag = j => (P2[j].t === 'b' && P2[j + 1].t === 'b') ? 'b' : 's';
  while (j0 < N - 1) { const tg = segTag(j0); let j1 = j0; while (j1 < N - 1 && segTag(j1) === tg) j1++;
    const pos = [], uv = [], idx = []; let len = 0; const cols = [];
    for (let j = j0; j <= j1; j++) { if (j > j0) { const a = ring[0][j - 1], b = ring[0][j]; len += Math.hypot(a[0] - b[0], a[1] - b[1]); } cols.push(len); }
    for (let k = 0; k < K; k++) for (let c = 0; c <= j1 - j0; c++) { const v = ring[k][j0 + c]; pos.push(...v); uv.push(cols[c] * (tg === 'b' ? .55 : .8), (v[2] + .5) * (tg === 'b' ? 1.4 : 2)); }
    const W2 = j1 - j0 + 1; for (let k = 0; k < K - 1; k++) for (let c = 0; c < W2 - 1; c++) { const a = k * W2 + c, b = a + 1, d = a + W2, e = d + 1; idx.push(a, b, d, b, e, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    parts.push(g); mats.push(tg === 'b' ? 0 : 2); j0 = j1; }
  // end caps: a fan from the centre, UV centred on the pith so the rings sit right on split pieces
  for (const [k, sg] of [[0, -1], [K - 1, 1]]) { const pos = [], uv = [], idx = []; const row = ring[k]; let mz = 0; for (const v of row) mz += v[2]; mz /= row.length;
    pos.push(0, 0, mz + (o.chop && sg > 0 ? .015 : 0)); uv.push((cx) * .45 + .5, (cy) * .45 + .5);
    for (const v of row) { pos.push(...v); uv.push((v[0] + cx) * .45 + .5, (v[1] + cy) * .45 + .5); }
    for (let j = 1; j < row.length; j++) { if (sg > 0) idx.push(0, j, j + 1); else idx.push(0, j + 1, j); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); parts.push(g); mats.push(1); }
  // knots and branch stubs on the bark
  for (let i = 0; i < (o.stubs || 0); i++) { const pb = P2.filter(p => p.t === 'b'); const p = pb[Math.floor(ri(.2, .8) * pb.length)]; const z = ri(-.3, .3); const k = Math.round((z + .5) * (K - 1)); const v = ring[k][p.i];
    const st = new THREE.CylinderGeometry(.09, .2, .32, 7, 1); st.deleteAttribute('normal'); const m = new THREE.Matrix4(); const dir = V(v[0] + cx, v[1] + cy, .55).normalize();
    m.compose(V(v[0], v[1], v[2]).addScaledVector(V(p.x, p.y, 0).normalize(), .02), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir), V(1, 1, 1)); st.applyMatrix4(m); st.computeVertexNormals(); parts.push(st); mats.push(0); }
  // a strip of loose bark curling away from the trunk
  if (o.strip) { const pb = P2.filter(p => p.t === 'b'); const a0 = pb[Math.floor(pb.length * .35)].a; const sp = new THREE.CylinderGeometry(1.03, 1.03, .42, 5, 4, true, a0 + Math.PI / 2, .45); const p = sp.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); const t = Math.max(0, (y + .05) / .26); const x = p.getX(i), z = p.getZ(i); const s = 1 + .14 * t * t; p.setXYZ(i, x * s, y, z * s); }
    sp.rotateX(Math.PI / 2); sp.translate(-cx, -cy, .1); sp.computeVertexNormals(); parts.push(sp); mats.push(0); }
  for (const g of parts) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); }
  const geo = mergeGeometries(parts, true); geo.groups.forEach((gr, i) => { gr.materialIndex = mats[i]; }); geo.computeBoundingSphere(); _logGeos[ck] = geo; return geo;
}
// sawn end grain of a log left outdoors (realism sweep: the old one was a clean cartoon target with one painted line):
// wobbly growth rings that crowd toward the bark, a pale sapwood band, the heart off-centre, radial drying checks that
// open toward the rim, faint saw-kerf arcs, grey weathering in blotches, a dark bark rim. Bump from the same canvas.
// chop = the chopping block's top: also axe scars (thin dark gouges in every direction) and a dirty, trampled-dark rim.
function endGrainMat(sd, chop) { let ls = sd * 7919 + 13; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const N = 256, C = N / 2; const c = canvas(N, N, (g) => {
    const hx = C + (LR() - .5) * 14, hy = C + (LR() - .5) * 14;
    const r = g.createRadialGradient(hx, hy, 2, C, C, C); r.addColorStop(0, '#8E6A46'); r.addColorStop(.55, '#A9835A'); r.addColorStop(.8, '#B8956A'); r.addColorStop(.88, '#C9AA7E'); r.addColorStop(.93, '#6E4A2C'); r.addColorStop(1, '#2E1E12'); g.fillStyle = r; g.fillRect(0, 0, N, N);
    // growth rings: wobbly closed curves, tighter outward, alternating dark latewood
    const ph = [LR() * 6, LR() * 6, LR() * 6]; for (let k = 0, rad = 4; rad < C * .9; k++) { rad += 3.2 * (1 - rad / C * .55) + LR() * 2.2;
      g.strokeStyle = `rgba(${70 + LR() * 20},${45 + LR() * 12},${25},${.22 + LR() * .25})`; g.lineWidth = .6 + LR() * 1.3; g.beginPath();
      for (let a = 0; a <= 64; a++) { const t = a / 64 * Math.PI * 2; const w = rad * (1 + .035 * Math.sin(t * 2 + ph[0]) + .02 * Math.sin(t * 5 + ph[1] + k * .1) + .012 * Math.sin(t * 11 + ph[2])); const x = hx + (C - hx) * rad / C + Math.cos(t) * w, y = hy + (C - hy) * rad / C + Math.sin(t) * w; if (a) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    // saw-kerf arcs across the face
    g.globalAlpha = .1; for (let k = 0; k < 18; k++) { g.strokeStyle = LR() < .5 ? '#3A2616' : '#E8D2AE'; g.lineWidth = 1 + LR() * 2; g.beginPath(); g.arc(C - 260, C + (k - 9) * 14 + LR() * 6, 300, -.35, .35); g.stroke(); } g.globalAlpha = 1;
    // weathering: grey blotches, stronger toward the rim
    for (let k = 0; k < 120; k++) { const a = LR() * Math.PI * 2, d = Math.sqrt(LR()) * C * .88, x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, rr2 = 4 + LR() * 16; const gr = g.createRadialGradient(x, y, 0, x, y, rr2); gr.addColorStop(0, `rgba(120,116,108,${.08 + .16 * d / C})`); gr.addColorStop(1, 'rgba(120,116,108,0)'); g.fillStyle = gr; g.fillRect(x - rr2, y - rr2, rr2 * 2, rr2 * 2); }
    // drying checks: thin dark wedges from near the heart out to the bark, wider outside
    const nc = 3 + Math.floor(LR() * 3); for (let k = 0; k < nc; k++) { let a = LR() * Math.PI * 2; const r0 = C * (.08 + LR() * .25), r1 = C * (.7 + LR() * .22); g.fillStyle = 'rgba(28,16,8,.85)'; g.beginPath(); const pts = []; for (let t = 0; t <= 1.0001; t += .1) { const rr = r0 + (r1 - r0) * t; a += (LR() - .5) * .06; pts.push([hx + Math.cos(a) * rr, hy + Math.sin(a) * rr, .3 + t * 1.8, -Math.sin(a), Math.cos(a)]); }
      pts.forEach(([x, y, w, nx, ny], i) => { if (i) g.lineTo(x + nx * w, y + ny * w); else g.moveTo(x + nx * w, y + ny * w); }); for (let i = pts.length - 1; i >= 0; i--) { const [x, y, w, nx, ny] = pts[i]; g.lineTo(x - nx * w, y - ny * w); } g.fill(); }
    if (chop) { // axe scars and grime
      for (let k = 0; k < 70; k++) { const a = LR() * Math.PI * 2, d = Math.sqrt(LR()) * C * .75, x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, b = LR() * Math.PI, L = 8 + LR() * 26;
        g.strokeStyle = `rgba(40,24,12,${.35 + LR() * .4})`; g.lineWidth = .8 + LR() * 1.4; g.beginPath(); g.moveTo(x - Math.cos(b) * L / 2, y - Math.sin(b) * L / 2); g.lineTo(x + Math.cos(b) * L / 2, y + Math.sin(b) * L / 2); g.stroke();
        g.strokeStyle = 'rgba(225,200,160,.35)'; g.lineWidth = .6; g.beginPath(); g.moveTo(x - Math.cos(b) * L / 2 + 1, y - Math.sin(b) * L / 2 + 1); g.lineTo(x + Math.cos(b) * L / 2 + 1, y + Math.sin(b) * L / 2 + 1); g.stroke(); }
      const gr = g.createRadialGradient(C, C, C * .3, C, C, C * .92); gr.addColorStop(0, 'rgba(60,45,30,0)'); gr.addColorStop(1, 'rgba(60,45,30,.45)'); g.fillStyle = gr; g.fillRect(0, 0, N, N); }
  });
  return new THREE.MeshStandardMaterial({ map: texOf(c), bumpMap: texOf(c, { srgb: false }), bumpScale: 1.6, roughness: .93, color: 0xD2C6B6 }); }
function logMats() { const X = mx(); return [X.bark, X.endgrain, X.splitwood]; }
// vertex mask: parts whose float attribute `attr` is >= uniform `u` collapse out of view (main pass and shadow passes alike)
function maskMat(m, attr, u, cmp = '>') { const pm = m.clone(); const ob = m.onBeforeCompile, ck = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  const inj = (sh, r, base) => { if (base && base !== THREE.Material.prototype.onBeforeCompile) base.call(m, sh, r); sh.uniforms['u_' + attr] = u;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute float ${attr}; uniform float u_${attr};`).replace('#include <project_vertex>', `#include <project_vertex>\nif (${attr} ${cmp} u_${attr} - .5) gl_Position = vec4(2., 2., 2., 1.);`); };
  pm.onBeforeCompile = (sh, r) => inj(sh, r, ob); pm.customProgramCacheKey = () => ck + '|mask_' + attr;
  const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); dm.onBeforeCompile = (sh, r) => inj(sh, r, null); dm.customProgramCacheKey = () => 'maskD_' + attr;
  const di = new THREE.MeshDistanceMaterial(); di.onBeforeCompile = (sh, r) => inj(sh, r, null); di.customProgramCacheKey = () => 'maskP_' + attr; return { mat: pm, depth: dm, dist: di }; }
// a stack of logs, merged into one mesh per material (bark, end grain, split face); slots go bottom-up and each vertex knows its
// slot, so setCount(n) takes logs off the top by masking (perf: 3 draw calls for any number of logs and variants)
const _logParts = [];
function logParts(v, lo = false) { const ck = v + (lo ? 'lo' : ''); if (_logParts[ck]) return _logParts[ck]; const b = logGeo(v, lo).toNonIndexed(); const out = [[], [], []];
  for (const gr of b.groups) { const g = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'uv']) { const a = b.attributes[k]; g.setAttribute(k, new THREE.Float32BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize)); } out[gr.materialIndex].push(g); }
  return (_logParts[ck] = out.map(l => l.length ? mergeGeometries(l, false) : null)); }
function logStack(slots, len, lo = false) {
  const g = new THREE.Group(); g.userData.live = true; const n = slots.length; const uC = { value: n }; const per = [[], [], []];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  slots.forEach((s, i) => { q.setFromEuler(e.set(s.rx || 0, s.ry || 0, s.rz)); m.compose(V(s.x, s.y, s.z || 0), q, V(s.r, s.r, len * (s.l || 1)));
    // [PROPS round] cordwood ends are not all one sticker-clean tone: some fresh and pale, most greyed by weather, a few dark
    // and damp or reddish heartwood (vertex colour on the end-grain part only; same draws)
    const tr = R(), tint = tr < .25 ? [1, .97, .92] : tr < .65 ? [.8, .77, .72] : tr < .85 ? [.62, .55, .48] : [.98, .84, .72], tv = rr(.92, 1.06);
    logParts(s.v, lo).forEach((pg, k) => { if (!pg) return; const c = pg.clone(); c.applyMatrix4(m); const nV = c.attributes.position.count; c.setAttribute('slot', new THREE.Float32BufferAttribute(new Float32Array(nV).fill(i), 1));
      if (k === 1) { const ca = new Float32Array(nV * 3); for (let j = 0; j < nV; j++) ca.set([tint[0] * tv, tint[1] * tv, tint[2] * tv], j * 3); c.setAttribute('color', new THREE.Float32BufferAttribute(ca, 3)); }
      per[k].push(c); }); });
  logMats().forEach((mat, k) => { if (!per[k].length) return; const mm = maskMat(mat, 'slot', uC); if (k === 1) mm.mat.vertexColors = true; const mesh = new THREE.Mesh(mergeGeometries(per[k], false), mm.mat); mesh.customDepthMaterial = mm.depth; mesh.customDistanceMaterial = mm.dist;
    mesh.castShadow = mesh.receiveShadow = true; mesh.userData.live = true; g.add(mesh); per[k].forEach(x => x.dispose()); });
  g.userData.logs = { max: n, count: n, slots, setCount(k) { k = Math.max(0, Math.min(n, Math.round(k))); uC.value = k; this.count = k; } };
  return g;
}
function pyramidSlots(rows, r, gap, rnd = .006, vars = [0, 1, 2]) { const out = []; let y = r; rows.forEach((cnt, j) => { for (let i = 0; i < cnt; i++) out.push({ x: (i - (cnt - 1) / 2) * gap + rr(-rnd, rnd) * 2, y: y + rr(-rnd, rnd), z: rr(-.03, .03), r: r * rr(.82, 1.12), rz: rr(0, 6), ry: rr(-.06, .06), rx: rr(-.04, .04), l: rr(.88, 1.06), v: vars[Math.floor(R() * vars.length)] }); y += gap * .84; }); return out; }
function logPiece(len, r, v = 0) { const g = new THREE.Group(); const m = new THREE.Mesh(logGeo(v), logMats()); m.scale.set(r, r, len); m.castShadow = m.receiveShadow = true; m.userData.live = true; g.add(m); return g; }

// fridge with a hollow food compartment, a hinged lower door and meat on the shelves that follows the stock
function fridge() {
  const g = new THREE.Group(); const Wd = .64, D = .6, H = 1.58, split = 1.02, X = mx();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, new THREE.CylinderGeometry(.025, .03, .05, 10), M.rubber, sx * (Wd / 2 - .07), .025, sz * (D / 2 - .08));
  const bz = -.025, bd = D - .05, z0 = bz - bd / 2, z1 = bz + bd / 2, t = .035, y0 = .05;
  add(g, rb(Wd, H - split, bd, .09, 5), M.fridge, 0, split + (H - split) / 2, bz); // freezer block
  for (const s of [-1, 1]) add(g, rb(t, split - y0 + .04, bd, .02), M.fridge, s * (Wd / 2 - t / 2), (y0 + split) / 2, bz);
  add(g, rb(Wd, t + .02, bd, .02), M.fridge, 0, y0 + (t + .02) / 2, bz); add(g, rb(Wd, split - y0, t, .015), M.fridge, 0, (y0 + split) / 2, z0 + t / 2);
  // cream liner, wire shelves, a bottle and a jar that always stay
  const lw = Wd - 2 * t, lb = y0 + t + .02, lt = split - .005; add(g, new THREE.PlaneGeometry(lw, lt - lb), M.ceramic, 0, (lb + lt) / 2, z0 + t + .002);
  add(g, new THREE.PlaneGeometry(lw, bd - t), M.ceramic, 0, lt - .001, z0 + t + (bd - t) / 2, Math.PI / 2);
  const shelfY = [lb + .3, lb + .6]; for (const y of shelfY) { add(g, rb(lw - .01, .008, bd - t - .04, .003), M.steel, 0, y, z0 + t + (bd - t - .04) / 2); }
  { const b = lathe([[0, 0], [.028, 0], [.028, .14], [.012, .18], [.01, .21], [0, .21]], 14); add(g, b, M.jarGlass, .2, shelfY[1] + .004, z0 + .1); const j = jar(.1, .04, M.glazeCream); j.position.set(-.18, shelfY[0] + .004, z0 + .09); g.add(j); }
  // gasket line and the freezer door (fixed) as before, both a little proud of the body
  add(g, rb(Wd - .01, H - split - .02, .06, .07, 4), M.fridge, 0, split + (H - split - .02) / 2, z1 + .03);
  add(g, rb(Wd - .04, .012, .02, .004), M.rubber, 0, split - .006, z1 + .01);
  const hd = (p, y0_, y1_, x, z) => { add(p, rb(.035, y1_ - y0_, .03, .014, 3), M.chrome, x, (y0_ + y1_) / 2, z + .02); for (const y of [y0_ + .02, y1_ - .02]) add(p, rb(.03, .03, .04, .01), M.chrome, x, y, z); };
  hd(g, split + .05, split + .27, -Wd / 2 + .07, z1 + .075);
  for (const y of [.25, split - .2, split + .15, H - .15]) add(g, rb(.03, .07, .03, .01), M.chrome, Wd / 2 - .02, y, z1 + .02);
  add(g, rb(.14, .025, .006, .006), M.chrome, .1, H - .12, z1 + .064);
  // lower door on a live pivot at the hinge side (+x); a door shelf with a bottle on the inside
  const piv = new THREE.Group(); piv.position.set(Wd / 2 - .005, 0, z1); piv.userData.live = true; g.add(piv);
  const dw = Wd - .01; add(piv, rb(dw, split - .07, .06, .05, 4), M.fridge, -dw / 2, .06 + (split - .07) / 2, .03);
  add(piv, new THREE.PlaneGeometry(dw - .08, split - .17), M.ceramic, -dw / 2, .06 + (split - .07) / 2, -.001, 0, Math.PI, 0);
  add(piv, rb(dw - .1, .05, .06, .01), M.ceramic, -dw / 2, .55, -.03); add(piv, lathe([[0, 0], [.025, 0], [.025, .12], [.01, .16], [0, .16]], 12), M.glass, -dw / 2 + .12, .575, -.035);
  hd(piv, split - .3, split - .06, -dw + .065, .075);
  add(piv, rb(.1, .13, .002, .001), X.paper, -dw / 2 + .12, .8, .061, 0, 0, .06); add(piv, rb(.08, .06, .002, .001), std2(0xC9B98F), -dw / 2 + .2, .66, .061, 0, 0, -.1); for (const [mx2, my2, mc] of [[-dw / 2 + .12, .855, 0xA03028], [-dw / 2 + .2, .685, 0x2E5A8A], [-dw / 2 - .08, .9, 0xD8A830]]) add(piv, new THREE.CylinderGeometry(.011, .011, .008, 12), std2(mc), mx2, my2, .064, Math.PI / 2); for (let li = 0; li < 6; li++) add(piv, rb(.05 + (li % 3) * .01, .0025, .001, .0005), std2(0x3A3A52), -dw / 2 + .115 - (li % 2) * .006, .835 - li * .016, .0625, 0, 0, .06); add(piv, rb(.066, .046, .001, .0005), std2(0x5E4E3A), -dw / 2 + .2, .66, .0625, 0, 0, -.1); /* [kitchen round] a list and an old photo under magnets: the door was a blank beige slab at close zoom */ bake(piv);
  // meat: up to 6 pieces, half of them wrapped in butcher paper; setStock(n) shows the first n
  const meat = []; const spots = [[-.13, shelfY[0]], [.08, shelfY[0]], [-.12, shelfY[1]], [.1, lb], [-.1, lb], [.12, shelfY[1] + .0]];
  spots.forEach(([x, y], i) => { const p = new THREE.Group(); p.position.set(x, y + .006, z0 + t + .17 + (i % 2) * .05); p.rotation.y = rr(-.4, .4);
    if (i % 2) { add(p, rb(.15, .045, .11, .02), X.paper, 0, .0225, 0); add(p, new THREE.TorusGeometry(.06, .002, 4, 16), X.rope, 0, .0225, 0, 0, Math.PI / 2, 0).scale.set(1, .45, 1); }
    else { add(p, rb(.14, .035, .1, .018), X.meat, 0, .0175, 0); add(p, rb(.14, .037, .02, .008), X.fat, 0, .0185, -.045); }
    meat.push(p); });
  // perf: all pieces in one mesh; each vertex knows its piece, setStock(n) masks the rest
  const meatU = { value: 6 }; { const by = new Map(); meat.forEach((p, i) => { p.updateMatrixWorld(true); p.traverse(o => { if (!o.isMesh) return; const m0 = o.material, pm = plainOf(m0) || m0; let q = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); q.applyMatrix4(o.matrixWorld); if (pm !== m0) colorize(q, m0.color, m0.roughness, m0.metalness); q.setAttribute('slot', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count).fill(i), 1));
      if (!by.has(pm)) by.set(pm, []); by.get(pm).push(q); }); });
    for (const [pm, qs] of by) { const mm = maskMat(pm, 'slot', meatU); const me = new THREE.Mesh(mergeGeometries(qs, false), mm.mat); me.customDepthMaterial = mm.depth; me.customDistanceMaterial = mm.dist; me.userData.live = true; me.castShadow = false; me.receiveShadow = true; g.add(me); } }
  g.userData.fridge = { piv, meat, meatU, inside: V(0, (lb + split) / 2, z0 + bd / 2), handle: V(-dw + .065, split - .18, .11) };
  return bake(g);
}

function fryPan() { const g = new THREE.Group(); add(g, lathe([[0, 0], [.1, 0], [.112, .035], [.106, .037], [.094, .006], [0, .006]], 28), M.iron); rod(g, V(.105, .03, 0), V(.27, .05, 0), .011, .009, M.iron, 8); add(g, rb(.09, .022, .026, .008), M.woodDark, .24, .05, 0, 0, 0, -.1); return g; }
function steak() { const X = mx(), g = new THREE.Group(); const sh = new THREE.Shape(); sh.moveTo(-.06, -.03); sh.quadraticCurveTo(-.075, .035, -.02, .042); sh.quadraticCurveTo(.05, .05, .068, .01); sh.quadraticCurveTo(.07, -.04, .0, -.045); sh.quadraticCurveTo(-.05, -.05, -.06, -.03);
  const m = new THREE.MeshStandardMaterial({ color: X.meat.color.clone(), roughness: .45 }); add(g, EX(sh, .016, .004), m, 0, .012, 0, -Math.PI / 2); add(g, new THREE.TorusGeometry(.045, .006, 5, 18, 2.2), X.fat, -.004, .012, .0, Math.PI / 2, 0, 2.6); m.userData.keep = true; g.userData.mat = m; return g; }
function plateOfFood() { const X = mx(), g = new THREE.Group(); add(g, lathe([[0, 0], [.07, 0], [.095, .013], [.1, .018], [.06, .007], [0, .007]], 28), M.ceramic);
  const food = []; const st = steak(); st.scale.setScalar(.85); st.position.set(-.02, .0, .01); g.add(st); food.push(st);
  for (let i = 0; i < 4; i++) { const p = add(g, new THREE.SphereGeometry(.018, 8, 6), X.potato, .045 + rr(-.012, .012), .017, -.04 + i * .022); p.scale.set(1.2, .8, 1); food.push(p); }
  for (let i = 0; i < 3; i++) { const c = add(g, new THREE.CylinderGeometry(.012, .012, .006, 10), X.carrot, -.04 + i * .018, .012, -.05); food.push(c); }
  food.forEach(f => f.userData.live = true); g.userData.food = food; return g; }
function choppingBoard() { const X = mx(), g = new THREE.Group(); W(g, .28, .022, .2, 0, .011, 0, { mat: M.woodLight, r: .008 }); add(g, new THREE.CylinderGeometry(.012, .012, .024, 12), M.darkInside, .12, .011, 0);
  { const c = lathe([[0, 0], [.016, .01], [.017, .05], [.011, .11], [0, .13]], 12); add(g, c, X.carrot, .04, .039, .045, 0, 0, Math.PI / 2); add(g, new THREE.ConeGeometry(.01, .045, 6), X.leaf, .062, .039, .045, 0, 0, -Math.PI / 2); }
  for (const [x, z] of [[.08, -.04], [.1, -.02], [.06, -.06]]) add(g, new THREE.CylinderGeometry(.015, .015, .007, 12), X.carrot, x, .0255, z, 0, 0, rr(-.1, .1));
  add(g, new THREE.SphereGeometry(.032, 14, 10), X.onion, -.08, .052, .05).scale.set(1, .9, 1); add(g, new THREE.SphereGeometry(.028, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), X.fat, -.08, .022, -.04);
  add(g, new THREE.SphereGeometry(.028, 10, 8), X.potato, -.02, .045, -.05).scale.set(1.25, .8, 1); return bake(g); }
function knife() { const g = new THREE.Group(); const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(.12, 0); sh.quadraticCurveTo(.15, .01, .16, .03); sh.lineTo(0, .03); sh.lineTo(0, 0); add(g, EX(sh, .0015, .0005), M.steel, .01, -.015, 0); add(g, rb(.095, .02, .016, .007), M.woodDark, -.045, 0, 0); for (const x of [-.07, -.03]) add(g, new THREE.CylinderGeometry(.003, .003, .018, 6), M.brass, x, 0, 0, Math.PI / 2); g.userData.grip = V(-.045, 0, 0); return bake(g); }
function pantryShelf(h = 1.45) { const g = new THREE.Group(), X = mx(); const w = .5, d = .26; const tools = {};
  for (const s of [-1, 1]) W(g, .03, h, d, s * (w / 2 - .015), h / 2, d / 2, { mat: M.woodDark, grain: 1 });
  W(g, w - .02, h - .08, .012, 0, h / 2, .008, { mat: M.wood, grain: 1 });
  const ys = [.05, .05 + (h - .07) * .27, .05 + (h - .07) * .52, .05 + (h - .07) * .76, h - .015]; for (const y of ys) W(g, w - .06, .025, d - .01, 0, y, d / 2 + .004, { mat: M.woodLight });
  const top = i => ys[i] + .0125;
  for (const [x, s] of [[-.1, 1], [.11, .85]]) { const sk = add(g, lathe([[0, 0], [.08, 0], [.1, .05], [.1, .15], [.075, .21], [.03, .24], [.045, .27], [0, .27]], 16), X.sack, x, top(0), .13); sk.scale.set(s, s, s * .9); add(g, new THREE.TorusGeometry(.035, .006, 5, 12), X.rope, x, top(0) + .235 * s, .13, Math.PI / 2); }
  /* GRAB: the can and jar he takes stand at the shelf's left end (-x), the only end he can reach past the woodpile; the stacked can rests on the two that stay */
  [.13, -.08, .01].forEach((x, i) => { const c = can(.11, .038, M.cans[i]); c.position.set(x, top(1), .14); g.add(c); }); { const c = can(.11, .038, M.cans[3]); c.position.set(-.035, top(1) + .11, .14); g.add(c); }
  [[.165, .14, .05, M.jarGlass], [-.05, .12, .045, M.glazeCream], [.06, .1, .04, M.jarGlass]].forEach(([x, hh, r, m]) => { const j = jar(hh, r, m); j.position.set(x, top(2), .14); g.add(j); });
  [[-.15, .07, .05, M.cans[1]], [-.04, .07, .05, M.cans[2]]].forEach(([x, hh, r, m]) => { const c = can(hh, r, m); c.position.set(x, top(3), .14); g.add(c); });
  { const b = lathe([[0, 0], [.035, 0], [.035, .15], [.014, .2], [.012, .23], [0, .23]], 14); add(g, b, M.jarGlass, .1, top(3), .14); }
  const tc = can(.11, .038, M.cans[0]); tc.position.set(-.17, top(1), .15); bake(tc); tc.userData.live = true; g.add(tc); tools.supplyCan = tc;
  const tj = jar(.13, .045, M.glazeCream); tj.position.set(-.16, top(2), .15); bake(tj); tj.userData.live = true; g.add(tj); tools.supplyJar = tj;
  bake(g); g.userData.tools = tools; return g; }
function crate(w = .36, h = .4, d = .36) { const g = new THREE.Group(); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { W(g, w - .02, .1, .018, 0, .065 + i * .125, s * (d / 2 - .009), { mat: i === 1 && s > 0 ? M.woodRed : M.wood }); W(g, .018, .1, d - .036, s * (w / 2 - .009), .065 + i * .125, 0, { mat: M.wood }); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W(g, .04, h - .02, .04, sx * (w / 2 - .025), (h - .02) / 2, sz * (d / 2 - .025), { mat: M.woodDark, grain: 1 });
  for (let i = 0; i < 3; i++) W(g, w, .02, d / 3 - .006, 0, h - .01, -d / 3 + i * d / 3, { mat: M.woodLight }); return bake(g); }
function radio() { const g = new THREE.Group(), X = mx(); const w = .3, h = .22, d = .14;
  const arch = (ww, hh) => { const s = new THREE.Shape(); s.moveTo(-ww / 2, 0); s.lineTo(ww / 2, 0); s.lineTo(ww / 2, hh * .6); s.quadraticCurveTo(ww / 2, hh, 0, hh); s.quadraticCurveTo(-ww / 2, hh, -ww / 2, hh * .6); s.lineTo(-ww / 2, 0); return s; };
  add(g, EX(arch(w, h), d, .008), M.woodRed); const gr = new THREE.ShapeGeometry(arch(w - .07, h - .085), 12); add(g, gr, X.grille, 0, .07, d / 2 + .0085);
  for (const x of [-.04, 0, .04]) add(g, rb(.008, .11, .006, .002), M.woodDark, x, .07 + .055, d / 2 + .01);
  const dm = new THREE.MeshStandardMaterial({ color: 0x4A3218, emissive: 0xFFB050, emissiveIntensity: 0, roughness: .3 }); add(g, rb(.13, .03, .004, .003), dm, 0, .04, d / 2 + .009);
  add(g, rb(.136, .036, .003, .004), M.brass, 0, .04, d / 2 + .007);
  const needle = add(g, rb(.002, .024, .002, .0005), M.gripRed, -.05, .04, d / 2 + .013); needle.userData.live = true;
  add(g, new THREE.CylinderGeometry(.017, .019, .02, 16), M.woodDark, -.11, .04, d / 2 + .016, Math.PI / 2);
  const knob = add(g, new THREE.CylinderGeometry(.017, .019, .02, 16), M.woodDark, .11, .04, d / 2 + .016, Math.PI / 2); knob.userData.live = true;
  add(knob, rb(.004, .014, .004, .001), M.brass, 0, -.011, .006); // pointer line on the knob (child turns with it)
  for (const x of [-.11, .11]) add(g, rb(.03, .012, .04, .004), M.rubber, x, .006, 0);
  bake(g); g.userData.radio = { needle, knob, dm, knobLocal: V(.11, .04, d / 2 + .03) }; return g; }
function plant() { const g = new THREE.Group(), X = mx();
  add(g, lathe([[0, 0], [.085, 0], [.09, .01], [.112, .19], [.124, .2], [.124, .226], [.111, .226], [.104, .2], [0, .2]], 24), X.terracotta);
  add(g, new THREE.CircleGeometry(.105, 20), X.soil, 0, .206, 0, -Math.PI / 2);
  const ls = new THREE.Shape(); ls.moveTo(0, 0); ls.quadraticCurveTo(.04, .05, 0, .15); ls.quadraticCurveTo(-.04, .05, 0, 0); const lg = new THREE.ShapeGeometry(ls, 6);
  for (let i = 0; i < 16; i++) { const st = new THREE.Group(); st.position.set(rr(-.02, .02), .206, rr(-.02, .02)); st.rotation.y = i * 2.4; g.add(st); const tilt = .15 + (i % 4) * .22, len = rr(.12, .26) * (1 - (i % 4) * .12);
    const tip = V(0, len * Math.cos(tilt), len * Math.sin(tilt)); rod(st, V(), tip, .004, .003, X.leafDark, 5); const lf = add(st, lg, i % 3 ? X.leaf : X.leafDark, tip.x, tip.y, tip.z, -Math.min(1.45, tilt + .45), 0, 0); lf.rotation.x = Math.min(1.45, tilt + .45); lf.scale.setScalar(rr(.8, 1.15)); }
  // one dry yellowed leaf on the soil: a cared-for plant, but not a showroom one
  add(g, lg, std2(0xA88A3A), .03, .208, .02, -Math.PI / 2 + .1, 0, .8).scale.setScalar(.7);
  return bake(g); }
function wateringCan() { const g = new THREE.Group(), X = mx(); add(g, lathe([[0, 0], [.075, 0], [.08, .01], [.08, .16], [.072, .18], [.045, .19], [.045, .2], [0, .2]], 22), X.zinc);
  rod(g, V(.07, .03, 0), V(.27, .22, 0), .016, .009, X.zinc, 10); rod(g, V(.265, .215, 0), V(.29, .24, 0), .014, .026, X.zinc, 12);
  add(g, new THREE.TorusGeometry(.085, .009, 6, 18, Math.PI), X.zinc, -.01, .18, 0); add(g, new THREE.TorusGeometry(.06, .008, 6, 14, Math.PI), X.zinc, -.08, .1, 0, 0, 0, Math.PI / 2);
  g.userData.grip = V(-.01, .265, 0); g.userData.spout = V(.29, .24, 0); return bake(g); }
function broom() { const g = new THREE.Group(), X = mx(); add(g, new THREE.CylinderGeometry(.013, .015, 1.2, 10), M.woodLight, 0, .2 + .6, 0);
  const hd = add(g, lathe([[0, 0], [.13, 0], [.12, .05], [.07, .17], [.035, .25], [0, .26]], 16), X.straw); hd.scale.set(.3, 1, 1);
  for (const y of [.17, .21]) add(g, new THREE.TorusGeometry(.06 - (y - .17) * .6, .006, 5, 14), X.rope, 0, y, 0, Math.PI / 2).scale.set(.4, 1, 1);
  g.userData.grip = V(0, 1.0, 0); return bake(g); }
function diary() { const X = mx(), g = new THREE.Group(); const w = .13, d = .18, t = .026; add(g, rb(w, t, d, .004), X.leather, 0, t / 2, 0); add(g, rb(w - .006, t - .008, d - .008, .002), M.pageEdge, .005, t / 2, 0);
  add(g, rb(.018, t + .004, d + .004, .002), X.leather, w / 2 - .01, t / 2, 0); add(g, rb(w + .004, t + .003, .014, .002), std2(0x3E2618), 0, t / 2, .04);
  add(g, new THREE.PlaneGeometry(.008, .07), X.ribbon, -.02, .002, -d / 2 - .03, -Math.PI / 2 + .1); return bake(g); }
function pencil() { const g = new THREE.Group(); add(g, new THREE.CylinderGeometry(.0045, .0045, .14, 6), M.gripYellow, 0, .0045, 0, 0, 0, Math.PI / 2); add(g, new THREE.ConeGeometry(.0045, .02, 6), M.woodLight, .08, .0045, 0, 0, 0, -Math.PI / 2); add(g, new THREE.CylinderGeometry(.0047, .0047, .012, 8), M.brass, -.076, .0045, 0, 0, 0, Math.PI / 2); return bake(g); }
function whetstone() { const X = mx(), g = new THREE.Group(); W(g, .24, .035, .085, 0, .0175, 0, { mat: M.woodDark }); add(g, rb(.2, .022, .055, .004), X.stoneDark, 0, .046, 0); add(g, rb(.2, .022, .055, .004), X.stone, 0, .067, 0);
  add(g, lathe([[0, 0], [.025, 0], [.025, .06], [.008, .075], [.004, .1], [0, .1]], 12), M.brass, .16, 0, .02); return bake(g); }
function repairLantern() { const g = new THREE.Group(); const L = lanternHousing(.01); L.scale.setScalar(.75); L.position.y = .09; g.add(L); add(g, new THREE.TorusGeometry(.075, .004, 6, 18, Math.PI), M.iron, 0, .17, 0);
  add(g, new THREE.CylinderGeometry(.004, .004, .02, 6), M.linen, 0, .03, 0); g.userData.grip = V(0, .245, 0);
  // the carried lantern (Lights: in his hand at night it read unlit - pale cold glass, no flame): its own glass, which warms
  // with the hand light's level, and a candle whose flame shows while it burns (props update polls __lights 'hand')
  const glass = M.glass.clone(); glass.emissive = new THREE.Color(0xFF9A40); glass.emissiveIntensity = 0; glass.userData.keep = true;
  L.traverse(o => { if (o.isMesh && o.material === M.glass) o.material = glass; });
  add(g, new THREE.CylinderGeometry(.016, .018, .05, 10), std2(0xE8D8B8), 0, .028, 0);
  const flame = new THREE.Mesh(lathe([[0, 0], [.009, .006], [.011, .016], [.006, .03], [0, .038]], 8), new THREE.MeshBasicMaterial({ color: 0xFFC466 }));
  flame.position.set(0, .053, 0); flame.visible = false; flame.userData.live = true; g.add(flame);
  g.userData.glow = { glass, flame }; return bake(g); }
function jacket() { const X = mx(), g = new THREE.Group(); // origin = the hanging loop, the jacket faces +z
  add(g, new THREE.TorusGeometry(.014, .003, 4, 10), X.jacketDark, 0, -.012, 0);
  const lg = lathe([[.214, -.7], [.215, -.68], [.205, -.5], [.2, -.3], [.195, -.14], [.17, -.08], [.12, -.04], [.05, -.01], [0, 0]], 28); { const P = lg.attributes.position; for (let j = 0; j < P.count; j++) { const x = P.getX(j), y = P.getY(j), z = P.getZ(j), a = Math.atan2(z, x), d = Math.min(1, Math.max(0, (-y - .12) / .3)); const k = 1 + d * (.05 * Math.sin(a * 7 + y * 4) + .03 * Math.sin(a * 11 - y * 9)); P.setX(j, x * k); P.setZ(j, z * k * .38 + .03); } lg.computeVertexNormals(); } /* [kitchen round] a body with real volume: shoulders round the peg, a flattened tube with soft vertical folds (the extruded slab read as cardboard) */
  add(g, lg, X.jacket, 0, -.03, 0); add(g, rb(.17, .06, .11, .02), X.jacketDark, 0, -.05, .03);
  for (const s of [-1, 1]) { add(g, new THREE.CylinderGeometry(.04, .05, .5, 10), X.jacket, s * .2, -.36, .055, -.07, 0, s * .05); add(g, new THREE.CylinderGeometry(.053, .053, .05, 10), X.jacketDark, s * .212, -.6, .072, -.07, 0, s * .05); } /* sleeves hang as round tubes with a cuff */
  add(g, rb(.008, .6, .006, .002), X.jacketDark, 0, -.41, .107); { const hm = add(g, new THREE.CylinderGeometry(.219, .219, .04, 28, 1, true), X.jacketDark, 0, -.71, .03); hm.scale.set(1, 1, .4); } /* hem band */ for (let i = 0; i < 5; i++) add(g, new THREE.CylinderGeometry(.008, .008, .006, 10), M.iron, .018, -.15 - i * .11, .108, Math.PI / 2);
  for (const s of [-1, 1]) add(g, rb(.11, .03, .012, .004), X.jacketDark, s * .1, -.46, .098, 0, s * .22, 0);
  add(g, rb(.075, .085, .006, .003), X.patch, .1, -.28, .097, 0, .22, .15); add(g, rb(.055, .06, .006, .003), X.patch, -.2, -.42, .104, -.07, 0, .05); // patched elbow and chest: an old, mended coat
  g.userData.grip = V(0, -.05, .05); return bake(g); }
function bowOnWall() { const X = mx(), g = new THREE.Group(); // in the y-z plane, bulging toward +z; origin at the grip
  const c = new THREE.CatmullRomCurve3([V(0, -.56, 0), V(0, -.3, .08), V(0, 0, .11), V(0, .3, .08), V(0, .56, 0)]); { const tg = new THREE.TubeGeometry(c, 40, .017, 8), P = tg.attributes.position, q = V(); for (let i = 0; i < P.count; i++) { const y = P.getY(i), t = Math.min(1, Math.abs(y) / .56); q.copy(c.getPoint(Math.min(1, Math.max(0, (y + .56) / 1.12)))); const f = 1 - .6 * Math.pow(t, 1.4); P.setX(i, P.getX(i) * f * 1.25); P.setZ(i, q.z + (P.getZ(i) - q.z) * f * .7); } tg.computeVertexNormals(); add(g, tg, M.wood); } /* scanned wood grain; [gear round] limbs taper to the tips and are flat (wide across, thin in the draw), not one round rod */ for (const sy of [-1, 1]) add(g, new THREE.CylinderGeometry(.006, .009, .045, 8), std2(0x2A2018), 0, sy * .54, .003); add(g, new THREE.CylinderGeometry(.0013, .0013, 1.1, 4), std2(0xBFAF88), 0, 0, .002); /* dark horn tips with the string nocks; a thin waxed tan string (it read as a white cord) */ 
  add(g, new THREE.CylinderGeometry(.022, .022, .12, 10), X.leather, 0, 0, .11); return bake(g); }
function quiver() { return fine(() => quiver0()); }
function quiver0() { const X = mx(), g = new THREE.Group(); // origin at the strap ring on top
  add(g, lathe([[0, -.52], [.04, -.52], [.05, -.5], [.055, -.05], [.058, 0], [.05, 0], [.047, -.05], [0, -.05]], 16), X.leather);
  add(g, new THREE.TorusGeometry(.057, .005, 5, 16), std2(0x3E2618), 0, -.25, 0, Math.PI / 2);
  add(g, new THREE.TorusGeometry(.058, .006, 5, 16), std2(0x3E2618), 0, -.03, 0, Math.PI / 2); add(g, new THREE.TorusGeometry(.046, .007, 5, 16), std2(0x3E2618), 0, -.5, 0, Math.PI / 2); // rim and base bands
  add(g, rb(.012, .44, .008, .003), std2(0x4A2E1C), 0, -.27, -.055); for (let i = 0; i < 18; i++) add(g, rb(.016, .003, .004, .001), std2(0xC8B48C), 0, -.06 - i * .024, -.06); // the back seam, laced with pale thread
  add(g, rb(.022, .5, .006, .002), std2(0x4A2E1C), .0, -.24, .058, .0, 0, .05); // the carrying strap down the front
  for (let i = 0; i < 6; i++) { const a = i * 1.05, x = Math.cos(a) * .025, z = Math.sin(a) * .025, h = .1 + (i % 3) * .015; add(g, new THREE.CylinderGeometry(.0032, .0032, .2, 6), std2(0x9C7E52), x, h - .07, z); for (let v = 0; v < 3; v++) { const va = a + v * 2.094; add(g, new THREE.PlaneGeometry(.011, .065), X.fletch, x + Math.cos(va) * .0085, h, z - Math.sin(va) * .0085, 0, va, 0); } add(g, new THREE.CylinderGeometry(.0042, .0036, .012, 6), std2(0x2A221A), x, h + .036, z); } /* [gear round] each arrow: a tan shaft, three feather vanes round it (one flat card read as a paper tag) and a dark nock */
  return bake(g); }
// the meat sack (realism sweep: it was a smooth yellow blob with a red box stuck on it): coarse burlap with a visible weave,
// lumpy where the cuts inside press out, gathered at the neck under a twine tie, and a dark blood-soaked patch at the bottom
let _burlap = null;
function burlapMat() { if (_burlap) return _burlap; let ls = 5151; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#8E7550'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const o = ((x + y) / 4) % 2; g.fillStyle = `rgba(${o ? '196,168,118' : '70,54,34'},${.1 + LR() * .14})`; g.fillRect(x, y + (o ? 0 : 2), 3, 2); g.fillRect(x + (o ? 2 : 0), y, 2, 3); }
    for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(60,45,28,${.2 + LR() * .2})`; g.lineWidth = 1 + LR(); g.beginPath(); const y = LR() * h; g.moveTo(0, y); g.lineTo(w, y + (LR() - .5) * 8); g.stroke(); } // slubs
    for (let k = 0; k < 40; k++) { const x = LR() * w, y = LR() * h, r = 4 + LR() * 18; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(50,38,24,${.12 + LR() * .15})`); gr.addColorStop(1, 'rgba(50,38,24,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } // grime
    for (let k = 0; k < 9; k++) { const x = LR() * w, y = h * (.05 + LR() * .22), r = 14 + LR() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(78,18,16,.75)'); gr.addColorStop(.7, 'rgba(70,22,18,.35)'); gr.addColorStop(1, 'rgba(70,22,18,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } // blood soaked through at the bottom (v = 0 is the bottom of the lathe)
  });
  const t = texOf(c); t.repeat.set(4, 1); const b = texOf(c, { srgb: false }); b.repeat.set(4, 1); t.flipY = b.flipY = false;
  _burlap = new THREE.MeshStandardMaterial({ map: t, bumpMap: b, bumpScale: 1.4, roughness: 1 }); return _burlap; }
function meatBag() { return fine(() => meatBag0()); }
function meatBag0() { const X = mx(), g = new THREE.Group(); const prof0 = [[0, 0], [.09, 0], [.13, .05], [.14, .14], [.11, .21], [.045, .255], [.04, .27], [.06, .3], [.05, .315], [0, .3]];
  const prof = []; for (let i = 0; i < prof0.length - 1; i++) { const [a, b] = [prof0[i], prof0[i + 1]], n = i < 5 ? 4 : 1; for (let k = 0; k < n; k++) prof.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } prof.push(prof0[prof0.length - 1]);   // more rows: the lumps were cut into flat facets
  const lg = lathe(prof, 24);
  { const P = lg.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z); const body = Math.max(0, Math.sin(Math.min(1, y / .24) * Math.PI));
      const k = 1 + body * (.09 * Math.sin(a * 3 + y * 20) + .06 * Math.sin(a * 5 - y * 31) + .04 * Math.cos(a * 2 + 1.3)) + (y > .255 ? .18 * Math.sin(a * 9) : 0); /* lumps of meat inside; the gathered neck frills */
      P.setX(i, x * k); P.setZ(i, z * k); P.setY(i, y - (y < .03 ? .0 : .012 * Math.sin(a * 2) * body)); void r; } lg.computeVertexNormals(); }
  const s = add(g, lg, burlapMat(), 0, -.3, 0); s.scale.set(1, 1, .8);
  add(g, new THREE.TorusGeometry(.043, .006, 5, 14), X.rope, 0, -.042, 0, Math.PI / 2); add(g, new THREE.TorusGeometry(.046, .005, 5, 14), X.rope, 0, -.05, 0, Math.PI / 2 + .12);
  { const c = new THREE.CatmullRomCurve3([V(.04, -.045, .02), V(.07, -.07, .045), V(.075, -.12, .05)]); add(g, new THREE.TubeGeometry(c, 8, .004, 5), X.rope); } // the twine's loose end
  g.userData.grip = V(0, 0, 0); return bake(g); }
function logArmful() { return fine(() => logArmful0()); }
function logArmful0() { const X = mx(), g = new THREE.Group(); for (const [x, y, v] of [[-.06, 0, 3], [.06, 0, 4], [0, .1, 5]]) { const l = logPiece(.5, .065, v); l.position.set(x, y, 0); l.rotation.z = rr(0, 3); g.add(l); }
  // [PROPS round] two cords pulled tight round the bundle (they were round hoops standing off the logs like handles): each
  // follows the hull of the three logs, so it lies on the bark and runs straight across the gaps
  const PS = []; g.updateMatrixWorld(true); g.traverse(o => { if (!o.isMesh) return; const P = o.geometry.attributes.position, v = V(); for (let i = 0; i < P.count; i += 3) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); PS.push([v.x, v.y]); } });
  for (const z of [-.14, .14]) { const pts = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a); let best = PS[0], bd = -9; for (const c of PS) { const d = c[0] * dx + c[1] * dy; if (d > bd) { bd = d; best = c; } } pts.push(V(best[0] + .006 * dx, best[1] + .006 * dy, z + .003 * Math.sin(a * 3))); }
    add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, .0055, 5, true), X.rope); }
  g.userData.grip = V(0, .05, 0); return bake(g); }
function sawhorse() { const X = mx(), g = new THREE.Group(); const L = .95, H = .62;
  W(g, L, .08, .09, 0, H - .04, 0, { mat: M.wood });
  for (const sx of [-1, 1]) { for (const sz of [-1, 1]) strut(g, V(sx * (L / 2 - .1), H - .07, sz * .03), V(sx * (L / 2 - .05), 0, sz * .22), .055, .045, M.woodDark); W(g, .03, .06, .36, sx * (L / 2 - .075), .22, 0, { mat: M.wood }); }
  W(g, 1.15, .035, .2, .1, H + .0175, 0, { mat: M.woodDark }); // the plank, sawn part way across near the end ([PROPS round] an old board off the pile, not glossy fresh orange pine)
  W(g, .22, .035, .2, .62, .02, .12, { mat: M.woodLight, ry: .6, rz: .05 }); // an off-cut on the ground
  // sawdust under the cut: a low heap of loose crumbs, not a flat painted disc (it is merged by bake: no extra draw calls)
  { const parts = []; for (let i = 0; i < 46; i++) { const a = rr(0, 6.28), d = Math.sqrt(R()) * .2, h = .012 * (1 - d / .2) + .002, q = new THREE.BoxGeometry(rr(.008, .018), rr(.003, .006), rr(.008, .018));
      q.rotateY(rr(0, 3)); q.translate(.5 + Math.cos(a) * d, h * R(), .02 + Math.sin(a) * d * .7); parts.push(q); }
    add(g, mergeGeometries(parts), X.sawdust, 0, 0, 0); }
  return bake(g); }
// the axe head: forged iron gone dark, rust blooming round the eye and along the top and bottom, hammer marks, and a
// bright honed bevel with fine scratches along the bit (it was flat black). Extrude UVs are in metres: repeat maps the head.
let _axeMat = null;
function axeHeadMat() { if (_axeMat) return _axeMat; let ls = 9091; const LR = () => { ls = (ls * 16807) % 2147483647; return (ls - 1) / 2147483646; };
  const c = canvas(128, 128, (g, w, h) => { g.fillStyle = '#3B3C3F'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 60; k++) { const x = LR() * w, y = LR() * h, r = 2 + LR() * 6; g.fillStyle = `rgba(${LR() < .5 ? '20,20,22' : '90,92,96'},${.12 + LR() * .2})`; g.beginPath(); g.ellipse(x, y, r, r * (.6 + LR() * .4), LR() * 3, 0, 7); g.fill(); } // hammer marks
    for (let k = 0; k < 55; k++) { const u = LR(), x = u < .5 ? LR() * w * .45 : LR() * w * .75, y = u < .5 ? LR() * h : (LR() < .5 ? LR() * h * .18 : h - LR() * h * .18), r = 2 + LR() * 7; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${120 + LR() * 30},${55 + LR() * 20},25,${.5 + LR() * .3})`); gr.addColorStop(1, 'rgba(110,50,20,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    const eg = g.createLinearGradient(w * .7, 0, w * .9, 0); eg.addColorStop(0, 'rgba(160,165,170,0)'); eg.addColorStop(1, 'rgba(170,175,180,.95)'); g.fillStyle = eg; g.fillRect(w * .7, 0, w * .3, h);
    g.strokeStyle = 'rgba(230,232,235,.35)'; g.lineWidth = .5; for (let k = 0; k < 30; k++) { const y = LR() * h; g.beginPath(); g.moveTo(w * (.76 + LR() * .06), y); g.lineTo(w * .95, y + (LR() - .5) * 6); g.stroke(); } });
  const t = texOf(c); t.repeat.set(5, 5); t.offset.set(.2, .5); const b = texOf(c, { srgb: false }); b.repeat.set(5, 5); b.offset.set(.2, .5);
  _axeMat = new THREE.MeshStandardMaterial({ map: t, bumpMap: b, bumpScale: 1.2, metalness: .7, roughness: .55, envMap: M.env, envMapIntensity: .5 }); return _axeMat; }
function axe() { const g = new THREE.Group(); // origin at the head; the handle runs down -y
  const c = new THREE.CatmullRomCurve3([V(0, .02, 0), V(.01, -.25, 0), V(-.005, -.5, 0), V(.012, -.68, 0)]); add(g, new THREE.TubeGeometry(c, 16, .016, 8), M.woodDark); add(g, new THREE.SphereGeometry(.022, 10, 8), M.woodDark, .012, -.69, 0).scale.set(1, .7, 1); /* a worn, dark oiled handle (was pale and plain) */
  const sh = new THREE.Shape(); sh.moveTo(-.035, .03); sh.lineTo(.03, .028); sh.quadraticCurveTo(.09, .05, .13, .075); sh.quadraticCurveTo(.145, 0, .13, -.075); sh.quadraticCurveTo(.09, -.04, .03, -.028); sh.lineTo(-.035, -.03); sh.lineTo(-.035, .03);
  add(g, EX(sh, .022, .004), axeHeadMat(), 0, 0, 0); add(g, rb(.012, .15, .026, .002), M.steel, .132, 0, 0); // honed edge
  g.userData.grip = V(.01, -.55, 0); return bake(g); }
function handSaw() { const g = new THREE.Group(); const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(.5, 0); sh.lineTo(.5, .06); sh.lineTo(0, .12); sh.lineTo(0, 0); add(g, EX(sh, .0015, .0005), M.steel);
  const hs = new THREE.Shape(); hs.moveTo(-.02, -.01); hs.lineTo(-.15, .0); hs.quadraticCurveTo(-.17, .08, -.13, .15); hs.lineTo(-.02, .14); hs.lineTo(-.02, -.01); const hole = new THREE.Path(); hole.absellipse(-.09, .07, .028, .045, 0, Math.PI * 2, true); hs.holes.push(hole);
  add(g, EX(hs, .024, .004), M.woodRed); for (const [x, y] of [[-.01, .03], [-.01, .1]]) add(g, new THREE.CylinderGeometry(.005, .005, .03, 8), M.brass, x, y, 0, Math.PI / 2); g.userData.grip = V(-.09, .07, 0); return bake(g); }

// ================= placement =================
export function buildProps(ctx) {
  let shiftRooms = () => {}, candleObj = null;
  const { scene, renderer, OBST, floors = [], L } = ctx; const { KT, BD, WS, DK, LL } = L;
  makeMaterials(renderer);
  const rc = new THREE.Raycaster();
  // put an object on the real floor top (boards are 7 cm thick, their top is not the level value)
  const floorAt = (x, y, z) => { rc.set(V(x + roomDx(x, y), y + .4, z), V(0, -1, 0)); rc.far = .7; const h = floors.length ? rc.intersectObjects(floors, false)[0] : null; return h ? h.point.y : y + .035; };
  const placed = {};
  // room offsets from the house builder: L.dxL moves the left rooms (kitchen, bedroom), L.dxR the workshop.
  // Everything below is written in the original coordinates and shifted at the end (see shiftRooms).
  const nScene0 = scene.children.length, nObst0 = OBST.length;
  shiftRooms = () => {
    for (let i = nScene0; i < scene.children.length; i++) { const o = scene.children[i]; const dx = roomDx(o.position.x, o.position.y); if (!dx) continue; o.position.x += dx; o.updateMatrixWorld(true); if (o.userData.box) o.userData.box.translate(V(dx, 0, 0)); if (o.userData.home) o.userData.home.pos.x += dx; }
    for (let i = nObst0; i < OBST.length; i++) { const b = OBST[i]; const dx = roomDx((b.x0 + b.x1) / 2, b.y); b.x0 += dx; b.x1 += dx; }
  };
  const roomDx = (x, y) => (x < .8 && y > KT - .3 && y < DK + 1) ? (L.dxL || 0) : (x > .8 && y > WS - .3 && y < KT + 1.2) ? (L.dxR || 0) : 0;
  function place(name, g, x, y, z, { ry = 0, solid = true, seat = false, floor = true, wall = false } = {}) {
    const fy = floor && !wall ? floorAt(x, y, z) : y; g.position.set(x, fy, z); g.rotation.y = ry; g.updateMatrixWorld(true); const sz0 = new THREE.Box3().setFromObject(g).getSize(V()); const small = Math.max(sz0.x, sz0.y, sz0.z) < .45; g.traverse(o => { if (o.isMesh) { o.castShadow = small ? false : o.castShadow !== false; } }); scene.add(g); g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g); g.userData.box = b; g.userData.floorY = fy; g.name = name; if (solid && !wall) OBST.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y, seat, n: name }); placed[name] = g; return g;
  }
  const out = { objects: placed, tools: {}, surfaces: {} };

  // ---------- kitchen (back wall z≈1.05, open front +z) ----------
  const st = place('stove', stove(), -3.25, KT, 1.4); out.oven = st.userData.oven;
  const ket = fine(() => bake(kettle())); ket.position.set(-.19, .91, .13); /* the front-left ring (kitchen thread): on the back ring the handle was 66 cm from the shorter hero's shoulder, out of reach over the stove */ st.add(ket); out.tools.kettle = ket; ket.userData.home = { parent: st, pos: ket.position.clone(), quat: ket.quaternion.clone() };
  { const pt = bake(pot()); pt.position.set(.19, .93, .13); st.add(pt); }
  place('krail', utensilRail(.5), -3.25, KT + 1.37, 1.56, { solid: false, wall: true }); // hangs from the front edge of the hood, over the stove
  place('hood', hood(Math.max(.2, (BD - .2) - (KT + 1.42) - .3)), -3.25, KT + 1.42, 1.32, { solid: false, wall: true });
  place('counter', sinkCounter(), -2.3, KT, 1.38);
  place('fridge', fridge(), -1.43, KT, 1.38);
  place('picture', picture(.34, .26), -1.45, KT + 1.92, 1.06, { solid: false, wall: true });
  { const g = new THREE.Group(); /* photo round 2: herbs drying on a twine under the shelf, at both ends of the window (behind the counter's front edge: his head stays clear) */
    add(g, new THREE.CylinderGeometry(.0015, .0015, .34, 3), std2(0xC8B080), -.27, 0, 0, 0, 0, Math.PI / 2); for (const tx of [-.43, -.11]) add(g, new THREE.CylinderGeometry(.0015, .0015, .235, 3), std2(0xC8B080), tx, .117, 0); /* [kitchen round] the twine hangs from the shelf by two strings (it floated in front of the window) */
    for (const [x, sd, c] of [[-.4, 11, 0x4A5630], [-.3, 23, 0x5E5C36], [-.19, 37, 0x56502F]]) { const b = herbBundle(sd, c); b.position.set(x, 0, 0); b.rotation.y = sd; g.add(b); }
    place('herbs', bake(g), -2.3, KT + 1.72, 1.17, { solid: false, wall: true }); }
  { const s = wallShelf(.86); const items = [[-.3, jar(.14, .05, M.glazeCream)], [-.17, jar(.11, .045, M.jarGlass)], [.3, mug(M.glazeCream)]]; /* the middle is the clean-dish spot (out.dishes) */ for (const [x, o] of items) { o.position.set(x, .018, .12); s.add(o); } bake(s); place('kshelf', s, -2.3, KT + 1.97, 1.04, { solid: false, wall: true }); }
  // kitchen eating spot (Brain: no carrying the plate up to the bedroom): the corner barrel wears a loose plank top, a stool beside it
  const kbar = place('kbarrel', barrel(.78), -4.02, KT, 3.33);
  { const tp = new THREE.Group(); for (let i = -1; i <= 1; i++) W(tp, .2, .03, .6, i * .205, .015, 0, { mat: M.woodLight, r: .008, grain: 2 }); for (const x of [-.14, .14]) W(tp, .5, .025, .05, 0, -.0125, x, { mat: M.woodDark, r: .006, grain: 0 }); tp.rotation.y = .12;
    tp.position.set(0, .785, 0); kbar.add(tp); bake(tp); }
  const kst = place('kstool', stool(), -3.40, KT, 3.33, { seat: true }); /* 62 cm from the barrel: he sits half turned (face +.87 rad), legs past the barrel's left, chest turned to the plate */ out.surfaces.kitchenTable = { top: kbar.userData.floorY + .815, seat: kst.userData.floorY + .48, table: 'eatTable', stool: 'eatSeat', face: -Math.PI / 2 + .87 };
  place('kbucket', bucket(.34), -4.22, KT, 3.86); /* corner behind the barrel (was under the stool) */
  place('krug', rug(1.7, 1.0, 'orange'), -2.6, KT, 2.72, { solid: false });
  // [PROPS] the kitchen lantern hangs on a wall bracket on the right wall just past the fridge, wick ~1.58 m over the floor, so he
  // lights it with a match from his hand (it hung from the ceiling over the walk line in front of the counter, 32 cm out of reach)
  place('klamp', bake(bracketLantern()), -.93 - .192, KT + 1.64, 1.92, { solid: false, wall: true }); // beside the window, not in front of it; high enough to walk under

  // ---------- bedroom ----------
  // layout: bunk, reading table and chair sit 25 cm toward +x so the walk from the bedroom ladder top passes the bunk's end post
  // with room to spare; the basket went under the right end of the table
  const TX = .25, TZ = -.08; const bunk = place('bunkbed', bunkBed(), -2.4 + TX, BD, 1.71, { seat: true });
  place('slippers', slippers(), -2.95 + TX, BD, 2.32, { solid: false, ry: .2 });
  place('basket', basket(), -.28 + TX, BD, 1.33, { solid: false }); // under the right end of the reading table, between its legs
  /* chair left of the table middle and nearer it: the hero stands at the shut door bolt around x -0.1, z 2.55 (W7) */
  const chairO = place('chair', chair(), -.74 + TX, BD, 2.26, { ry: Math.PI, seat: true }); chairO.userData.seat = true; /* GRAB: furniture he sits on (it slides with him: chairPull) */ out.surfaces.chairSeat = chairO.userData.floorY + chairO.userData.info.seat;
  const tbl = place('table', table(), -.35 + TX, BD, 1.37); const tTop = tbl.userData.floorY + .74;
  const bk = book({ cover: M.covers[0] }); bk.position.set(-.33 + TX, tTop, 1.6 + TZ); bk.rotation.y = 0; scene.add(bk); out.book = bk.userData.book; out.book.obj = bk; bk.userData.noProxy = true; out.tools.book = bk; bk.userData.home = { parent: scene, pos: bk.position.clone(), quat: bk.quaternion.clone() };
  { const m = bake(mug(M.glazeBlue)); m.position.set(-.06 + TX, tTop, 1.35 + TZ); scene.add(m); const c = bake(candle()); c.position.set(-.62 + TX, tTop, 1.32 + TZ); scene.add(c); candleObj = c; const st2 = new THREE.Group(); st2.position.set(-.585 + TX, tTop, 1.61 + TZ); /* 3.5 cm right: room for the watering can at the table's end */ for (let i = 0; i < 3; i++) { const b = closedBook(.03, .16 - i * .012, .21 - i * .012, M.covers[(i + 2) % 7]); b.rotation.z = Math.PI / 2; b.position.set(.08 - i * .006, .015 + .03 * i, 0); b.rotation.y = rr(-.15, .15); st2.add(b); } scene.add(st2); bake(st2); }
  // door in Tree's opening of the right wall (z 2.3..3.25, up to BD+2.0); hinge at the front (z≈3.2), opens into the room.
  // It rests open (~95°) along z≈3.2 so the way in stays clear; __props.door.setOpen(k) swings it (0 shut), setBolt(k) slides the bolt (1 locked).
  { const dg = place('door', plankDoor(1.9, .77), .4, BD, 2.775, { ry: -Math.PI / 2, solid: false }); const D = dg.userData.door;
    const ds = { open: 1, bolt: 0, toO: 1, toB: 0 };
    const apply = () => { D.piv.rotation.y = ds.open * 1.66; D.bar.position.x = D.barX - ds.bolt * .055; };
    out.door = { obj: dg, get open() { return ds.open; }, get bolt() { return ds.bolt; },
      setOpen(k) { ds.open = ds.toO = clamp01(k); if (ds.open > .02) ds.bolt = ds.toB = 0; apply(); },
      setBolt(k) { ds.bolt = ds.toB = ds.open > .02 ? 0 : clamp01(k); apply(); },
      openTo(k) { ds.toO = clamp01(k); }, boltTo(k) { ds.toB = clamp01(k); },
      get target() { return ds.toO; }, get boltTarget() { return ds.toB; },
      // the leaf (for a palm pushing on it) and its width; hand(kind) is set by grab.js: openTo/boltTo then only move the door
      // ('open') or the bolt ('bolt') while a palm is on it (Pavel: nothing moves by itself). Without grab.js the old timed swing.
      leaf() { return D.piv.children[0]; }, width: D.w, hand: null,
      // world points for the hand: the knob on the latch edge, and the bolt knob
      handle(t = V()) { D.piv.updateMatrixWorld(true); return D.piv.children[0].localToWorld(t.set(-D.w / 2 + .1, D.h * .46, .07)); },
      boltKnob(t = V()) { D.bar.updateMatrixWorld(true); return D.bar.localToWorld(t.set(.02, .034, .01)); },
      update(dt) { let ch = false; const hd = out.door.hand;
        for (const [k, t, r] of [['open', 'toO', .9], ['bolt', 'toB', 3]]) { if (ds[k] === ds[t]) continue;
          if (k === 'bolt' && ds.open > .02) continue; // the bolt waits until the door is shut
          if (hd && !hd(k)) continue; // no palm on it: it stays where it is
          const rr = hd && k === 'open' ? .42 : r; /* by hand: a steady pull, about 0.7 rad/s */ const d = ds[t] - ds[k]; ds[k] = Math.abs(d) < rr * dt ? ds[t] : ds[k] + Math.sign(d) * rr * dt; ch = true; }
        if (ch) { if (ds.open > .02) { ds.bolt = 0; if (ds.toO > .02) ds.toB = 0; } apply(); }
        wind(dt); } };
    // wind: an open, unattended door swings on a spring toward the wind; in a strong gust (s > ~1) it slams shut-ish and bangs.
    // Not while someone moves it (open != toO) and never when bolted shut.
    const sw = { a: 0, v: 0, cd: 0 }; const wp = V();
    function wind(dt) { const Wd = window.__wind; if (!Wd || !Wd.sample || ds.open !== ds.toO || ds.open < .05) { if (sw.a) { if (ds.open !== ds.toO) ds.open = clamp01(ds.open + sw.a / 1.66); /* the hand takes it from where the wind left it, no jump */ sw.a = 0; sw.v = 0; apply(); } return; }
      dg.getWorldPosition(wp); wp.y += 1; let f = 0; try { const w = Wd.sample(wp); const s = w.s || 0; // push toward closing when the wind blows into the room through the doorway (-x), open when it blows out
        f = (-(w.x || 0)) * (s > 1 ? 2.2 : .6) + Math.sin(performance.now() * .0013) * .05 * s; } catch (e) { f = 0; }
      // hinge friction: a door resting still stays put in ordinary wind; only a strong gust (s > ~1) gets it swinging
      if (Math.abs(f) < .45 && Math.abs(sw.v) < .02) { sw.v = 0; return; }
      sw.v += (f - sw.a * 9 - sw.v * 2.2) * dt; sw.a += sw.v * dt; sw.cd -= dt;
      const lo = -ds.open * 1.66 + .02, hi = .06; // can't open past the wall stop, can close all the way
      if (sw.a < lo || sw.a > hi) { const hit = Math.abs(sw.v); sw.a = Math.max(lo, Math.min(hi, sw.a)); sw.v *= -.3;
        if (hit > .9 && sw.cd <= 0 && window.__audio && window.__audio.play) { try { window.__audio.play('shutter', wp, { gain: Math.min(1.2, hit / 2) }); } catch (e) { /* no sound */ } sw.cd = .6; } }
      D.piv.rotation.y = ds.open * 1.66 + sw.a; }
    apply(); }
  place('hooks', bake(coatHooks()), .17, BD + 1.6, .97, { solid: false, wall: true });
  { const b = closedBook(.035, .2, .15, M.covers[4]); b.rotation.set(0, .6, Math.PI / 2); b.position.set(.25, 1.07 + .045 + .15 + .03, .12); bunk.add(b); }
  // bedroom lantern: there is no electricity in this world, so no wall switch (it used to switch a lamp hung out of reach under
  // the ceiling). An oil lantern hangs on a forged wall bracket just inside the door, on the latch side (where the switch was),
  // with the wick at ~1.58 m over the floor: he lights it with a match like the others and pinches it out before sleep.
  // The bracket: a wall plate with two nails, an arm out over the lantern, a diagonal brace, the lantern's ring on the arm's hook.
  // lights.js builds only the wick, flame and light at out.lights.bedroomLamp.pos (own: true); hero.js reaches the lamp
  // itself now that out.switches has no 'bedroom'.
  out.switches = {}; out.switchN = {};
  place('blamp', bracketLantern(), .18, BD + 1.65, 1.95, { solid: false, wall: true });
  place('brug', rug(1.8, 1.05, 'check', '#D8CFBD'), -2.0, BD, 2.85, { solid: false });
  place('crock', bake(crock()), -3.52, BD, 1.24, { ry: .5 });
  place('pegrail', bake(pegRail()), -3.8, BD + 1.5, 1.0, { solid: false, wall: true }); /* photo round 2: the bare wall left of the bunk, above the crock (nothing walks there) */
  { const g = new THREE.Group(); /* notes and a hand-drawn map pinned above the reading table */
    for (const [w, h, x, y, rz, m] of [[.26, .19, -.08, .02, .04, M.plan], [.11, .15, .14, .05, -.08, M.paper], [.1, .13, .13, -.11, .06, M.paper], [.09, .12, -.25, -.04, -.05, M.paper]]) { const q = add(g, new THREE.PlaneGeometry(w, h), m, x, y, .004 + Math.abs(x) * .004, 0, 0, rz); q.castShadow = false;
      add(g, new THREE.SphereGeometry(.007, 6, 4), std2(0xA8382C), x - Math.sin(rz) * h * .42, y + h * .42, .012); }
    place('notes', bake(g), -.18, BD + .93, .975, { solid: false, wall: true }); } /* the photo's blue crock left of the bunk, in the corner by the back wall (off the hatch and bunk paths) */
  { const s = wallShelf(.7); for (let i = 0, x = -.28; i < 7; i++) { const bw = rr(.025, .04); const bh = rr(.16, .22), b = closedBook(bw, bh, .15, M.covers[i]); b.position.set(x + bw / 2, .018, .12 + rr(-.012, .012)); if (i === 6) { const th = .3; b.rotation.z = th; b.position.set(x + bw / 2 * Math.cos(th) + bh * Math.sin(th) - .002, .018 + bw / 2 * Math.sin(th), .12); } s.add(b); x += bw + .003; } /* [bedroom round] uneven depths and the last book leaning back against the row (they stood like a row of tiles) */ const j = jar(.1, .04, M.glazeCream); j.position.set(.22, .018, .12); s.add(j); bake(s); place('bshelf', s, -.35, BD + 1.25, .99, { solid: false, wall: true }); }

  // ---------- workshop ----------
  const wb = place('workbench', workbench(), 2.75, WS, 1.86); out.surfaces.benchTop = wb.userData.floorY + .9;
  const tw = toolWall(); place('toolwall', tw.g, 2.6, WS + 1.05, 1.28, { solid: false, wall: true });
  for (const [k, o] of Object.entries(tw.tools)) { o.userData.home = { parent: o.parent, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.x }; out.tools[k] = o; }
  // a hammer and a wrench lying on the bench, ready to be picked up
  { const h = bake(hammer()); h.position.set(2.2, wb.userData.floorY + .9 + .018, 1.98); h.rotation.set(-Math.PI / 2, 0, -1.2); h.userData.live = true; scene.add(h); out.tools.benchHammer = h; h.userData.home = { parent: scene, pos: h.position.clone(), quat: h.quaternion.clone(), scale: 1 };
    const w = bake(wrench(.2)); w.position.set(3.25, wb.userData.floorY + .9 + .008, 2.0); w.rotation.set(-Math.PI / 2, 0, .5); scene.add(w); out.tools.benchWrench = w; w.userData.home = { parent: scene, pos: w.position.clone(), quat: w.quaternion.clone(), scale: 1 }; }
  { const g = new THREE.Group(), T = wb.userData.floorY + .9 + .018; /* photo round 2: back corner of the bench, clear of his work spots: a jar of nails and a coffee can of brushes and pencils */
    const j = jar(.11, .042, M.jarGlass); j.position.set(-.12, 0, 0); g.add(j); add(g, new THREE.CylinderGeometry(.036, .036, .06, 10), std2(0x6C6A66), -.12, .035, 0);
    const c = can(.12, .045, M.cans[2]); g.add(c);
    for (const [dx, dz, h, col, tip] of [[-.015, .01, .2, 0xB0832E, 0x2A2420], [.012, -.008, .19, 0x8E3226, 0x2A2420], [.0, .016, .22, 0x6B4A2C, 0xD8C8A0], [.018, .012, .17, 0x34546E, 0x3A3028]]) { const t = .1 * Math.sign(dx || .5); add(g, new THREE.CylinderGeometry(.004, .004, h, 5), std2(col), dx + Math.sin(t) * h * .5, .06 + h * .5, dz, 0, 0, -t); add(g, new THREE.CylinderGeometry(.006, .004, .03, 5), std2(tip), dx + Math.sin(t) * (h + .01), .06 + h + .012, dz, 0, 0, -t); }
    g.position.set(3.44, T, 1.64); scene.add(g); }
  place('wshelves', workshopShelves(.95), 4.4, WS + .95, 1.85, { ry: -Math.PI / 2, solid: false, wall: true });
  const stl = place('stool', stool(), 1.5, WS, 2.85, { seat: true }); /* moved off the vice: he stands there to saw (workshop thread) */ out.surfaces.stoolSeat = stl.userData.floorY + .48;
  place('wbarrel', barrel(.8), 1.55, WS, 1.55);
  place('wbucket', bucket(.36, true), 4.05, WS, 3.4);
  place('wrug', rug(1.6, .95, 'green', '#D9C99A'), 2.8, WS, 3.05, { solid: false });
  place('wlamp', bake(domeShade(1.2)), 3.75, WS + 1.44, 2.45, { solid: false, wall: true });
  place('sidebench', sideBench(), 4.12, WS, 2.45, { ry: -Math.PI / 2 });

  // ---------- deck and landings ----------
  place('telescope', telescope(), 3.28, DK, 1.3, { ry: -.6 + Math.PI }).position.y += .018; /* feet on the boards, not in them; 22 cm in from the rail (LEISURE: he stood between the rail posts behind the eyepiece and his foot and hand went into them) */
  place('dbasket', basket(), 1.4, DK, .95);
  place('lbarrel', barrel(.75), -2.6, LL, 1.4);
  place('lbucket', bucket(.34), -1.9, LL, 1.8);

  // ================= round 6: food, wood, gear and chores =================
  // world points for the hands: out.point(name) -> Vector3 (computed on call, so room shifts are included)
  const PT = {}; PT.eatTable = [kbar, V(.04, .815, -.02)]; PT.eatSeat = [kst, V(0, .48, 0)]; out.point = (name, t = V()) => { const p = PT[name]; if (!p) return null; p[0].updateMatrixWorld(true); return p[0].localToWorld(t.copy(p[1])); }; out.pointNames = () => Object.keys(PT);
  const homeOf = (o, extra = {}) => { o.userData.home = { parent: o.parent, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.x, ...extra }; };
  const tool = (name, o, parent, x, y, z, rot = [0, 0, 0]) => { o.position.set(x, y, z); o.rotation.set(...rot); o.userData.live = true; parent.add(o); homeOf(o); out.tools[name] = o; return o; };
  const ghY = (x, z) => { const G = window.__ground; try { return G && G.heightAt ? G.heightAt(x, z) : 0; } catch (e) { return 0; } };
  // --- kitchen: firewood by the stove (its size follows the stock), supply shelf, chopping board, stew pot + ladle, pan with meat, plate of food
  const wp = place('woodpile', logStack(pyramidSlots([4, 3, 2, 1], .062, .12, .008, [3, 4, 5, 6, 4]), .42), -3.99, KT, 1.33);
  out.woodpile = { obj: wp, max: wp.userData.logs.max, get count() { return wp.userData.logs.count; }, setCount: k => wp.userData.logs.setCount(k) };
  PT.woodpile = [wp, V(0, .5, .05)];
  // hung on the left wall above the firewood (the kitchen ladder stands at x -4, z 2 and must stay clear; under the stovepipe at KT+1.95)
  const pantry = place('pantry', pantryShelf(1.25), -4.372, KT + .56, 1.33, { ry: Math.PI / 2, wall: true, solid: false }); for (const [k, o] of Object.entries(pantry.userData.tools)) { homeOf(o); out.tools[k] = o; }
  PT.pantry = [pantry, V(0, .6, .3)];
  const cn = placed.counter, cTop = cn.userData.floorY + .9;
  tool('board', choppingBoard(), scene, -2.65, cTop, 1.51, [0, .05, 0]); tool('knife', knife(), scene, -2.63, cTop + .023, 1.46, [0, -.15, 0]);
  const plateO = tool('plate', fine(() => bake(plateOfFood())), st, .21, .915, .13); /* serving plate waits by the pan on the stove, front right (in reach; at the back he folded over the hot pan) */ const food = []; plateO.traverse(o => { if (o.isMesh && o.material !== M.ceramic) food.push(o); });
  // food on the plate: setFood(1) full, (.5) half eaten, (0) empty. (Meshes are merged per material, so we scale the food meshes down.)
  out.plate = { obj: plateO, setFood(k) { k = clamp01(k); for (const m of food) { m.visible = k > .02; m.scale.setScalar(.35 + .65 * k); } } }; out.plate.setFood(0);
  PT.board = [out.tools.board, V(0, .03, 0)]; PT.sink = [cn, V(.23, .76, .04)];
  { // ---- dishes as state: 4 pieces (2 plates, a bowl, a cup), each is dirty in the basin, drying in the rack, or clean on the shelf.
    // __props.dishes.setDirty(n): n pieces in the sink (taken from the shelf first); wash() moves one dirty piece to the rack;
    // putAway() moves one from the rack to the shelf; state() -> {dirty, rack, shelf}. Points: 'sink', 'rack', 'dishShelf'.
    const X = mx(); const dirtM = std2(0x6A4A2A), crumbM = std2(0x8A6A3A), stewM = X.stew;
    const mk = (kind, dirty) => { const g = new THREE.Group();
      if (kind === 'plate') { add(g, lathe([[0, 0], [.07, 0], [.1, .012], [.104, .016], [.06, .006], [0, .006]], 24), M.ceramic); if (dirty) { const d = add(g, new THREE.SphereGeometry(.05, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), dirtM, .01, .0058, -.005); d.scale.set(1, .05, .7); /* a thin domed film of gravy, not a flat painted disc */ for (let i = 0; i < 4; i++) add(g, new THREE.SphereGeometry(.006, 5, 4), crumbM, rr(-.04, .05), .009, rr(-.04, .04)); } }
      else if (kind === 'bowl') { add(g, lathe([[0, 0], [.04, 0], [.065, .04], [.07, .06], [.064, .06], [.058, .042], [.036, .008], [0, .008]], 22), M.glazeBlue); if (dirty) add(g, new THREE.CircleGeometry(.045, 14), stewM, 0, .02, 0, -Math.PI / 2); }
      else { add(g, lathe([[0, 0], [.035, 0], [.04, .07], [.036, .07], [.031, .004], [0, .004]], 16), M.glazeCream); add(g, new THREE.TorusGeometry(.022, .005, 6, 12, Math.PI * 1.2), M.glazeCream, .042, .038, 0, 0, 0, -Math.PI * .6); if (dirty) add(g, new THREE.CircleGeometry(.03, 12), std2(0x3A2414), 0, .02, 0, -Math.PI / 2); }
      bake(g); g.userData.live = true; return g; };
    const KIND = ['plate', 'plate', 'bowl', 'cup'];
    // the basin (counter local: centre x .23, z .04, bottom top at .9-.2)
    const BX = .23, BZ = .04, BY = .9 - .2;
    const inSink = [[BX - .06, BY + .1 * Math.cos(.4) + .004, BZ - .06, [0, 0, Math.PI / 2 - .4]], [BX + .05, BY + .002, BZ + .08, [0, 0, .05]], [BX + .07, BY + .002, BZ - .1, [0, 0, 0]], [BX - .03, BY + .045, BZ + .13, [0, 0, Math.PI / 2]]];
    // drying rack on the counter between the board and the basin (counter local)
    const rack = new THREE.Group(); rack.position.set(-.085, .9, .19); cn.add(rack); rack.userData.live = true;
    { const rg = new THREE.Group(); W(rg, .17, .012, .21, 0, .006, 0, { mat: M.woodLight, r: .004 }); for (const z of [-.08, .08]) { W(rg, .17, .02, .02, 0, .022, z, { mat: M.woodLight, r: .005 }); for (let i = 0; i < 6; i++) add(rg, new THREE.CylinderGeometry(.004, .004, .1, 6), M.woodLight, -.075 + i * .03, .07, z); } bake(rg); rack.add(rg); }
    const inRack = [[-.06, .112, 0, [0, 0, Math.PI / 2]], [-.03, .112, 0, [0, 0, Math.PI / 2]], [.0, .074, 0, [0, 0, Math.PI / 2]], [.055, .074, -.02, [Math.PI, 0, 0]]];
    // the shelf over the window: plates stacked, the cup in the bowl
    const ksh = placed.kshelf; const onShelf = [[-.02, .018, .12, [0, 0, 0]], [-.02, .034, .12, [0, 0, 0]], [.14, .018, .12, [0, 0, 0]], [.14, .028, .12, [0, 0, 0]]];
    const objs = KIND.map((k, i) => { const o = { dirty: mk(k, true), rack: mk(k, false), shelf: mk(k, false) };
      for (const [where, parent, slot] of [['dirty', cn, inSink[i]], ['rack', rack, inRack[i]], ['shelf', ksh, onShelf[i]]]) { const ob = o[where]; ob.position.set(slot[0], slot[1], slot[2]); ob.rotation.set(...slot[3]); parent.add(ob); ob.visible = false; ob.userData.slot = { parent, pos: ob.position.clone(), rot: ob.rotation.clone() }; } return o; });
    const loc = ['dirty', 'shelf', 'shelf', 'dirty'];
    const show = () => objs.forEach((o, i) => { for (const w of ['dirty', 'rack', 'shelf']) o[w].visible = loc[i] === w; });
    const count = w => loc.filter(l => l === w).length;
    out.dishes = { max: 4, state: () => ({ dirty: count('dirty'), rack: count('rack'), shelf: count('shelf') }),
      setDirty(n) { n = Math.max(0, Math.min(4, Math.round(n))); while (count('dirty') < n) { const i = loc.indexOf('out') >= 0 ? loc.indexOf('out') : loc.indexOf('shelf') >= 0 ? loc.indexOf('shelf') : loc.indexOf('rack'); /* 'out' first: the plate he ate from is the one that goes in the basin */ if (i < 0) break; loc[i] = 'dirty'; } while (count('dirty') > n) loc[loc.indexOf('dirty')] = 'shelf'; show(); return count('dirty'); },
      wash() { const i = loc.indexOf('dirty'); if (i < 0) return -1; loc[i] = 'rack'; show(); return i; },
      putAway() { const i = loc.indexOf('rack'); if (i < 0) return -1; loc[i] = 'shelf'; show(); return i; },
      // by hand (Character / dishes): take(from) lifts one piece out of the basin ('dirty') or the rack ('rack'): {i, kind, obj: dirty look,
      // clean: clean look}; the hero carries obj / clean in world space; settle(i, where) puts piece i back into its slot there.
      // slot(i, where) -> {pos, quat} in world space (where the hand has to bring it).
      take(from = 'dirty') { const i = loc.indexOf(from); if (i < 0) return null; loc[i] = 'hand'; show(); return { i, kind: KIND[i], obj: objs[i].dirty, clean: objs[i].rack }; },
      settle(i, where) { for (const w of ['dirty', 'rack', 'shelf']) { const ob = objs[i][w], sl = ob.userData.slot; if (ob.parent !== sl.parent) sl.parent.add(ob); ob.position.copy(sl.pos); ob.rotation.copy(sl.rot); ob.scale.setScalar(1); } loc[i] = where; show(); },
      slot(i, where) { const ob = objs[i][where], sl = ob.userData.slot; sl.parent.updateMatrixWorld(true); const m = new THREE.Matrix4().compose(sl.pos, new THREE.Quaternion().setFromEuler(sl.rot), V(1, 1, 1)).premultiply(sl.parent.matrixWorld); const pos = V(), quat = new THREE.Quaternion(); m.decompose(pos, quat, V()); return { pos, quat }; },
      where: i => loc[i], /* the serving plate is one of the shelf plates: while it is out (on the stove, in his hand) that plate is missing from the shelf, and after the meal it is the dirty one in the basin (a shelf plate no longer jumped into the sink) */ _plate() { const pv = plateO.visible, o = loc.indexOf('out'); if (pv && o < 0) { let i = loc.findIndex((l, k) => KIND[k] === 'plate' && l === 'shelf'); if (i < 0) i = loc.findIndex((l, k) => KIND[k] === 'plate' && l === 'rack'); if (i >= 0) { loc[i] = 'out'; show(); } } else if (!pv && o >= 0) { loc[o] = 'shelf'; show(); } },
      setState({ dirty = 0, rack: r = 0 } = {}) { for (let i = 0; i < 4; i++) loc[i] = i < dirty ? 'dirty' : i < dirty + r ? 'rack' : 'shelf'; show(); } };
    show(); PT.rack = [rack, V(0, .1, 0)]; PT.dishShelf = [ksh, V(.06, .1, .12)]; PT.sink = [cn, V(BX, .78, BZ)]; }

  { // ---- water: a supply bucket on a bracket shelf right of the window feeds the tap through a hose; the basin drains
    // down a pipe into a bucket in the open bay under the sink. Brain: water.setClean(0..1) (tap bucket level, tap runs only
    // while > 0), water.setDirty(0..1) (drain bucket). Character: tools 'waterBucket' and 'drainBucket' (grab/release),
    // water.tap(on) runs the tap, water.pour(name, on) pours from a bucket the hand holds (stream from its lowest rim point).
    const wm = new THREE.MeshStandardMaterial({ color: 0x3A5A68, roughness: .08, metalness: .1, envMap: M.env, envMapIntensity: 1.2, transparent: true, opacity: .82 });
    const dm = new THREE.MeshStandardMaterial({ color: 0x5A5440, roughness: .15, metalness: .05, envMap: M.env, envMapIntensity: .8, transparent: true, opacity: .9 });
    const H0 = .3, r0 = H0 * .5, r1 = H0 * .62;
    const mkB = (metal, mat) => { const g = new THREE.Group(); const b = bucket(H0, metal); g.add(b); const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat); disc.rotation.x = -Math.PI / 2; disc.renderOrder = 2; disc.userData.live = true; g.add(disc); g.userData.water = { disc, level: 0 }; g.userData.grip = V(0, H0 + .05, 0); return g; };
    // shelf + supply bucket with a spigot and a hose down to the tap
    const shX = -2.47, shY = cTop + .062, shZ = 1.04, shD = .26, shR = 3 * Math.PI / 4; // [PROPS] a low stand on the counter's back left, bail ~1.33 m over the floor: in his reach (Integrator: fetchwater)
    { const sh = new THREE.Group(); W(sh, shD + .03, .025, shD + .03, 0, .0675, 0, { mat: M.woodLight, r: .004 }); for (const s of [-1, 1]) W(sh, .045, .055, shD, s * .11, .0275, 0, { mat: M.woodDark, r: .004 }); bake(sh); sh.position.set(shX, cTop, shZ + .22); sh.rotation.y = .12; scene.add(sh); }
    const wb = mkB(true, wm); { const sp = new THREE.Group(); add(sp, new THREE.CylinderGeometry(.011, .011, .05, 10), M.brass, 0, 0, .025, Math.PI / 2); add(sp, rb(.012, .03, .012, .003), M.brass, 0, .02, .04); sp.position.set(0, .04, r0 + .01); wb.add(sp); bake(sp); }
    tool('waterBucket', wb, scene, shX, shY + .018, shZ + .22, [0, shR, 0]);
    const tapW = cn.localToWorld(V(.23, .9 + .015, -.23)); const spW = V(shX + Math.sin(shR) * (r0 + .06), shY + .018 + .04, shZ + .22 + Math.cos(shR) * (r0 + .06));
    { const c = new THREE.CatmullRomCurve3([spW, V(spW.x + .05, cTop + .014, spW.z - .03), V(tapW.x - .07, tapW.y, tapW.z - .02), tapW.clone().add(V(-.01, .01, -.04))].map(q => q.clone().sub(spW))); const hm = add(scene, new THREE.TubeGeometry(c, 24, .008, 6), std2(0x2A2A2A), spW.x, spW.y, spW.z); hm.castShadow = false; }
    // drain bucket in the bay
    const db = mkB(false, dm); tool('drainBucket', db, cn, .23, .08, .04);
    // tap stream and drips
    const sm = new THREE.MeshStandardMaterial({ color: 0xBFD8E4, roughness: .05, envMap: M.env, transparent: true, opacity: .55, depthWrite: false });
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .005, 1, 6, 1, true), sm); stream.visible = false; stream.userData.live = true; stream.userData.fluid = true; stream.userData.fx = true; stream.name = 'waterStream'; scene.add(stream);
    const pourS = new THREE.Mesh(new THREE.CylinderGeometry(.012, .02, 1, 8, 1, true), sm); pourS.visible = false; pourS.userData.live = true; pourS.userData.fluid = true; pourS.userData.fx = true; pourS.name = 'pourStream'; scene.add(pourS);
    const drip = new THREE.Mesh(new THREE.SphereGeometry(.006, 6, 5), sm); drip.visible = false; drip.userData.live = true; drip.userData.fluid = true; drip.userData.fx = true; drip.name = 'waterDrip'; cn.add(drip);
    const ws = { clean: .7, dirty: .15, tap: false, drainT: 0, dripT: 0, pour: null };
    const setLvl = (b, k) => { const W2 = b.userData.water; W2.level = clamp01(k); const r = r0 + (r1 - r0) * W2.level - .012; W2.disc.visible = W2.level > .02; W2.disc.scale.set(r, r, 1); W2.disc.position.y = .015 + (H0 - .03) * W2.level; };
    // slosh: the water surface stays level in world space and rocks against the bucket's acceleration while carried
    const sl = new Map(); const _q = new THREE.Quaternion(), _p = V();
    function slosh(b, dt) { const W2 = b.userData.water; let st = sl.get(b); b.updateMatrixWorld(true); b.getWorldPosition(_p); if (!st) { st = { p: _p.clone(), v: V(), t: V(), tv: V() }; sl.set(b, st); }
      const v = _p.clone().sub(st.p).divideScalar(Math.max(dt, 1e-3)); const a = v.clone().sub(st.v).divideScalar(Math.max(dt, 1e-3)); st.p.copy(_p); st.v.copy(v);
      const k = Math.min(.25, a.length() * .004); const tgt = V(a.z, 0, -a.x).normalize().multiplyScalar(k); if (!isFinite(tgt.x)) tgt.set(0, 0, 0);
      st.tv.addScaledVector(tgt.sub(st.t).multiplyScalar(40).sub(st.tv.clone().multiplyScalar(5)), Math.min(dt, .05)); st.t.addScaledVector(st.tv, Math.min(dt, .05));
      b.getWorldQuaternion(_q).invert(); const lv = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + st.t.x, 0, st.t.z)); W2.disc.quaternion.copy(_q).multiply(lv); }
    out.water = {
      get clean() { return ws.clean; }, get dirty() { return ws.dirty; },
      setClean(k) { ws.clean = clamp01(k); setLvl(wb, ws.clean); if (ws.clean <= 0) out.water.tap(false); }, setDirty(k) { ws.dirty = clamp01(k); setLvl(db, ws.dirty); },
      // the lever's ball (world): the hand pushes it forward to run the water, back to stop it (hero.js only calls tap() at the touch)
      get leverObj() { return cn.userData.lever || null; },
      lever(t = V()) { const L = cn.userData.lever; if (!L) return null; L.updateMatrixWorld(true); return L.localToWorld(t.set(0, .074, 0)); },
      tap(on) { { const L = cn.userData.lever; if (L) L.userData.to = on ? .45 : -.35; } ws.tap = !!on && ws.clean > 0 && wb.parent === wb.userData.home.parent; stream.visible = ws.tap; if (ws.tap) { const top = cn.localToWorld(V(.23, .9 + .22, -.08)), bot = cn.localToWorld(V(.23, .9 - .19, -.08)); stream.position.copy(top).add(bot).multiplyScalar(.5); stream.scale.set(1, top.y - bot.y, 1); } return ws.tap; },
      pour(name, on) { ws.pour = on ? (name === 'drainBucket' ? db : wb) : null; if (!on) pourS.visible = false; },
      update(dt) { { const L = cn.userData.lever; if (L && L.userData.to != null) { const d = L.userData.to - L.rotation.x; L.rotation.x += Math.sign(d) * Math.min(Math.abs(d), dt * 7); } } // the lever tips under the hand (0.1 s)
        // tap drains the supply bucket (a full bucket ~90 s of running water) into the drain bucket
        if (ws.tap) { if (wb.parent !== wb.userData.home.parent) out.water.tap(false); else { out.water.setClean(ws.clean - dt / 90); if (db.parent === db.userData.home.parent) out.water.setDirty(ws.dirty + dt / 100); ws.drainT = 6; } }
        ws.drainT -= dt; drip.visible = false; if (ws.drainT > 0 && db.parent === db.userData.home.parent) { ws.dripT = (ws.dripT + dt) % .55; const t = ws.dripT / .35; if (t < 1) { drip.visible = true; drip.position.set(.23, .49 - t * t * (.49 - (.08 + .015 + (H0 - .03) * ws.dirty)), .04); } }
        for (const b of [wb, db]) if (b.parent !== b.userData.home.parent || ws.pour === b) slosh(b, dt); else if (sl.has(b)) { sl.delete(b); b.userData.water.disc.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); }
        if (ws.pour) { const b = ws.pour, W2 = b.userData.water; if (W2.level <= .01) { pourS.visible = false; } else { b.updateMatrixWorld(true); let low = null; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const pw = b.localToWorld(V(Math.cos(a) * r1, H0, Math.sin(a) * r1)); if (!low || pw.y < low.y) low = pw; }
          const wl = b.localToWorld(V(0, .015 + (H0 - .03) * W2.level, 0)); if (low.y < wl.y + .02) { const L2 = .7; pourS.visible = true; pourS.position.set(low.x, low.y - L2 / 2, low.z); pourS.scale.set(1, L2, 1); const nk = W2.level - dt / 5; if (b === wb) out.water.setClean(nk); else out.water.setDirty(nk); } else pourS.visible = false; } } } };
    out.water.setClean(ws.clean); out.water.setDirty(ws.dirty);
    PT.waterShelf = [wb.userData.home.parent, wb.userData.home.pos.clone().add(V(0, .35, 0))]; PT.tap = [cn, V(.23, 1.0, -.15)]; PT.drainBay = [cn, V(.23, .45, .3)]; }

  { // the stew pot loses its lid and gets a ladle; both are tools now
    let potO = null; st.children.forEach(c => { if (!potO && c.position && Math.abs(c.position.x - .19) < .001 && Math.abs(c.position.z - .13) < .001) potO = c; });
    if (potO) { potO.removeFromParent(); }
    const pg = fine(() => { const pg = new THREE.Group(); { const X = mx(); add(pg, lathe([[0, 0], [.085, 0], [.095, .01], [.095, .11], [.1, .115], [.092, .115], [.087, .02], [0, .02]], 28), M.enamelDark); add(pg, new THREE.CircleGeometry(.088, 24), X.stew, 0, .085, 0, -Math.PI / 2); add(pg, new THREE.TorusGeometry(.087, .0035, 4, 28), std2(0x3E2412), 0, .0855, 0, Math.PI / 2); for (const [cx, cz, c, r] of [[.03, .02, 0, .3], [-.035, .03, 1, 1.1], [.01, -.04, 0, 2], [-.05, -.02, 2, .7], [.05, -.03, 1, 2.6], [-.01, .055, 2, 1.8], [.045, .045, 0, .9]]) add(pg, rb(.017, .011, .015, .004), [X.carrot, std2(0xC9B07A), std2(0x7A4428)][c], cx, .086, cz, .2, r, .15); /* [kitchen round] chunks of carrot, potato and meat in the stew and a dark film at the rim: it was one flat orange disc */ for (const s of [-1, 1]) add(pg, new THREE.TorusGeometry(.022, .006, 6, 12, Math.PI), M.iron, s * .1, .09, 0, 0, s > 0 ? 0 : Math.PI, s * Math.PI / 2); } return bake(pg); });
    tool('pot', pg, st, .19, .93, .13); tool('ladle', fine(() => bake(ladle(.3))), st, .2, .93 + .14, .1, [-.25, 0, -.45]);
    const fp = bake(fryPan()); fp.userData.live = true; fp.position.set(-.19, .91, .14); fp.rotation.y = -2.2; st.add(fp); const stk = steak(); stk.position.set(0, .006, 0); stk.visible = false; stk.userData.live = true; fp.add(stk);
    const raw = new THREE.Color(0xA2343A), done = new THREE.Color(0x6A3A22);
    // the pan: setMeat(true/false) puts a steak in it, setCook(0..1) browns it
    out.pan = { obj: fp, setMeat(on) { stk.visible = !!on; }, setCook(k) { stk.userData.mat.color.copy(raw).lerp(done, clamp01(k)); } };
    PT.pan = [fp, V(0, .05, 0)]; PT.pot = [st, V(.19, 1.06, .13)]; PT.oven = [st, V(0, .45, .45)]; }
  { // fridge API (the lower door is on a hinge; meat inside follows the stock)
    const F = placed.fridge.userData.fridge; const fs = { open: 0, to: 0, n: 0 };
    const apply = () => { F.piv.rotation.y = fs.open * 1.75; };
    out.fridge = { obj: placed.fridge, max: F.meat.length, get stock() { return fs.n; }, get open() { return fs.open; },
      setStock(n) { fs.n = Math.max(0, Math.min(F.meat.length, Math.round(n))); F.meatU.value = fs.n; },
      setOpen(k) { fs.open = fs.to = clamp01(k); apply(); }, openTo(k) { fs.to = clamp01(k); },
      handle(t = V()) { F.piv.updateMatrixWorld(true); return F.piv.localToWorld(t.copy(F.handle)); }, inside(t = V()) { return placed.fridge.localToWorld(t.copy(F.inside)); },
      update(dt) { if (fs.open !== fs.to) { const d = fs.to - fs.open; fs.open = Math.abs(d) < dt * 1.6 ? fs.to : fs.open + Math.sign(d) * dt * 1.6; apply(); } } };
    out.fridge.setStock(2); PT.fridge = [placed.fridge, F.inside.clone()]; }
  // --- bedroom: crate nightstand with the radio, broom, potted plant + watering can, diary and pencil
  // (the back-left corner is the oak's limb going through the floor: nothing stands there; the nightstand corner is by the bunk's head)
  const CRX = -.82, CRZ = 1.12; const crt = place('crate', crate(), CRX, BD, CRZ); const cY = crt.userData.floorY + .4;
  const rad = radio(); rad.position.set(CRX, cY, CRZ); rad.rotation.y = -.3; scene.add(rad); rad.userData.live = true;
  { const R = rad.userData.radio; const rs = { on: 0, tune: .3 }; R.knob.rotation.y = rs.tune * 5;
    out.radio = { obj: rad, get on() { return rs.on; }, setOn(k) { rs.on = clamp01(k); R.dm.emissiveIntensity = rs.on * 1.6; }, setTune(k) { rs.tune = clamp01(k); R.needle.position.x = -.05 + .1 * rs.tune; R.knob.rotation.y = rs.tune * 5; }, knob(t = V()) { return rad.localToWorld(t.copy(R.knobLocal)); }, dialMat: R.dm };
    out.radio.setTune(.3); PT.radio = [rad, R.knobLocal.clone()]; }
  tool('broom', broom(), scene, -1.02, floorAt(-1.02, BD, 1.0), 1.0, [0, Math.PI / 2, .1]); /* GRAB: 6 cm further off the bunk's corner post (his fist brushed it taking the broom) */
  // bedside stool in front of the bunk's head end (bed thread): at night he lays his folded vest on it and in the morning takes it back, both sitting on the bed edge (the floor is out of a seated arm's reach)
  { const bs = place('bedstool', stool(.38), -2.4 + TX + .31, BD, 1.71 + .8, { ry: .4 }); out.surfaces.bedStool = bs.userData.floorY + .38; }
  const plantO = place('plant', plant(), .26, BD, 1.66); /* on the floor at the reading table's right front corner, by the side wall: in front of the crate nightstand it stood where he crouches to tune the radio (watcher R45-1: knee and thigh through the leaves) */ PT.plant = [plantO, V(0, .3, 0)];
  tool('wateringCan', wateringCan(), scene, -.38, tTop, 1.39, [0, 0, 0]); /* LEISURE: 6 cm further along (gate: his head 5.4 cm into its handle end in the radio crouch at chair_side).  on the reading table's left end between the candle and the book pile, the spout along the table toward the plant at its right front corner (out over the left end it was in his face crouched at the radio): from the floor the handle (26 cm up) was out of reach, the palm stopped 17 cm short in a full squat and the ankles bent 60 deg (gate); up here he takes it standing */
  // diary + pencil sit beside the reading book, a forearm in from the edge (they used to lie 42 cm deep, past an arm's reach from the chair side)
  tool('diary', diary(), scene, -.16 + TX, tTop, 1.5 + TZ, [0, .22, 0]); tool('pencil', pencil(), scene, -.05 + TX, tTop, 1.53 + TZ, [0, .5, 0]);
  PT.table = [tbl, V(0, .76, 0)]; PT.chair = [chairO, V(0, .46, 0)];
  // --- workshop: whetstone and a lantern to repair on the bench; jacket on a peg by the open side; bow and quiver on the left wall
  { const bt = wb.userData.floorY + .9; const ws = whetstone(); ws.position.set(2.72, bt, 2.14); ws.rotation.y = .03; /* at the front edge: the hero's arm reaches only the front 25 cm of this deep bench (workshop thread) */ scene.add(ws); PT.whetstone = [ws, V(0, .08, 0)];
    tool('lantern', repairLantern(), scene, 2.55, bt, 2.07); /* front edge, in reach (workshop thread) */ PT.nails = [wb, V(.35, .95, -.18)]; PT.bench = [wb, V(0, .92, .1)]; }
  const peg = (x, y, z, ry) => { const p = new THREE.Group(); add(p, new THREE.CylinderGeometry(.014, .016, .09, 10), M.woodDark, 0, 0, .045, Math.PI / 2); add(p, new THREE.SphereGeometry(.02, 10, 8), M.woodDark, 0, 0, .09); add(p, rb(.06, .1, .015, .005), M.woodDark, 0, 0, .0075); p.position.set(x, y, z); p.rotation.y = ry; scene.add(p); return p; };
  { /* GRAB: the peg at 1.5 m, where his hand reaches the collar (at 1.72 m it hung 20 cm over his fingertips) */ const pj = peg(4.575, WS + 1.52, 3.72, -Math.PI / 2); const jk = jacket(); tool('jacket', jk, scene, 4.575 - .07, WS + 1.52 - .005, 3.72, [0, -Math.PI / 2, 0]); jk.position.x = 4.575 - .06 - .02; PT.jacketPeg = [pj, V(0, 0, .09)]; }
  { const pb = [peg(.925, WS + 1.82, 2.1, Math.PI / 2), peg(.925, WS + 1.1, 2.1, Math.PI / 2)]; tool('bow', bowOnWall(), scene, .925 + .1, WS + 1.45, 2.1, [0, 0, 0]); PT.bowPeg = [pb[0], V(0, 0, .09)];
    const pq = peg(.925, WS + 1.62, 1.72, Math.PI / 2); tool('quiver', quiver(), scene, .925 + .1, WS + 1.62, 1.72, [0, 0, -.12]); PT.quiverPeg = [pq, V(0, 0, .09)]; }
  // gear hanging at home: setHere(name, false) hides it (he has it on / with him), true shows it on its peg again
  out.setHere = (name, on) => { const o = out.tools[name]; if (!o) return; if (o.userData.fm) { fading.delete(o); fadeSet(o, on ? 1 : 0); } else o.visible = !!on; };
  // GRAB: toolFade(name, to, sec) fades a tool in or out on its own copy of the materials (the jacket in the hand while the worn coat fades the other way)
  const fading = new Map();
  out.toolFade = (name, to, sec = .6, from = null) => { const o = out.tools[name]; if (!o) return; if (!o.userData.fm) { const fm = []; o.traverse(m => { if (!m.isMesh) return; const one = x => { const c = x.clone(); c.onBeforeCompile = x.onBeforeCompile; if (x.customProgramCacheKey) c.customProgramCacheKey = x.customProgramCacheKey; fm.push(c); return c; }; m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material); }); o.userData.fm = fm; o.userData.fk = 1; }
    if (from != null) o.userData.fk = from; fading.set(o, { to, rate: 1 / Math.max(.05, sec) }); fadeSet(o, o.userData.fk); };
  const fadeSet = (o, k) => { o.userData.fk = k; for (const m of o.userData.fm) { m.opacity = k; m.transparent = k < .99; m.depthWrite = k > .5; } o.visible = k > .01; };
  // --- things he carries in from outside: hidden until grabbed, hidden again on release
  for (const [k, f] of [['meatBag', meatBag], ['logArmful', logArmful]]) { const o = f(); o.visible = false; tool(k, o, scene, 0, -50, 0); o.userData.home.hide = true; }
  // --- outside at the foot of the oak: a big log pile and a sawhorse with a half-sawn plank and the saw in the cut
  { const x = -4.45, z = 3.1; const lp = logStack(pyramidSlots([6, 5, 4, 3, 2], .1, .195, .012, [0, 1, 2, 0, 1]), .72, true); lp.position.set(x, ghY(x, z) - .01 + .075, z); lp.rotation.y = .5; scene.add(lp); /* [ground round] raised onto two old beams: real firewood is kept off the wet ground */
    { const sl = new THREE.Group(); for (const sz of [-.24, .24]) W(sl, 1.32, .08, .085, 0, .04, sz, { mat: M.woodDark, r: .012, ry: rr(-.03, .03) }); sl.position.set(x, ghY(x, z) - .012, z); sl.rotation.y = .5; scene.add(sl);
      // a leaf rake dropped by the far end of the pile, tines down on the little heap of oak leaves it raked together
      const lw = new THREE.Vector3(-1.15, 0, .32).applyAxisAngle(V(0, 1, 0), .5).add(V(x, 0, z)); const hx = lw.x, hz = lw.z;
      const rk = new THREE.Group(); add(rk, new THREE.CylinderGeometry(.013, .015, 1.45, 7), std2(0x5E4A36), .725, .05, 0, 0, 0, Math.PI / 2); add(rk, new THREE.BoxGeometry(.03, .025, .4), M.woodDark, 0, .05, 0);
      for (let i = 0; i < 12; i++) add(rk, new THREE.CylinderGeometry(.003, .003, .06, 3), M.woodDark, -.01, .022, -.18 + i * .0327, 0, 0, -.35);
      rk.position.set(hx + .05, ghY(hx, hz) + .03, hz); rk.rotation.set(0, 2.2, -.04); scene.add(rk);
      const lf = new THREE.Group(); const LC = [0x4A3420, 0x5A3E22, 0x3E2E1C, 0x4E4626, 0x3A3220, 0x5E3A1E]; const lsh = new THREE.Shape(); { const P = []; for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI, w = Math.sin(t) * (.016 + .006 * Math.cos(t * 7)); P.push([w, -Math.cos(t) * .03]); } lsh.moveTo(0, -.03); P.forEach(([w, y]) => lsh.lineTo(w, y)); for (let k = P.length - 1; k >= 0; k--) lsh.lineTo(-P[k][0], P[k][1]); } const lg = new THREE.ShapeGeometry(lsh, 1); lg.rotateX(-Math.PI / 2); lg.rotateX(Math.PI / 2); // a lobed oak-leaf outline
      for (let i = 0; i < 170; i++) { const a = rr(0, 6.28), d = R() * .3, lx = Math.cos(a) * d, lz = Math.sin(a) * d * .8, h = .13 * Math.pow(1 - d / .3, 1.5) * (.4 + .6 * R()); const q = add(lf, lg, std2(LC[i % 6]), lx, ghY(hx + lx, hz + lz) + h + .006, lz, -Math.PI / 2 + rr(-.4, .4), rr(-.4, .4), rr(0, 6.28)); q.castShadow = false; }
      lf.position.set(hx, 0, hz); scene.add(lf); } lp.name = 'logpile'; placed.logpile = lp; lp.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(lp); lp.userData.box = b; OBST.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y: ghY(x, z), n: 'logpile' }); PT.logpile = [lp, V(0, .9, .2)]; }
  { // chopping block (a sawn round standing on end) with the axe bitten into its top, beside the log pile
    const x = -3.95, z = 4.05, y0 = ghY(x, z); const cb = logPiece(.42, .21, 0); cb.traverse(o => { if (o.isMesh && Array.isArray(o.material)) o.material = o.material.map(m => m === mx().endgrain ? endGrainMat(5, true) : m); }); /* the block's top: axe scars */ cb.rotation.x = -Math.PI / 2; cb.position.set(x, y0 + .2, z); scene.add(cb); cb.name = 'chopblock'; placed.chopblock = cb; cb.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(cb); cb.userData.box = b; OBST.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y: y0, n: 'chopblock' });
    const ax = axe(); tool('axe', ax, scene, x + .05, y0 + .42 + .03, z, [0, .8, -2.25]); PT.chopblock = [cb, V(0, 0, .21)];
    // wood chips round it, each on the ground under it (the soil slopes here): thrown mostly to the front, where the
    // rounds were split; none on the root beside the block (it would float on, or sink into, the bark)
    const ch = new THREE.Group(); const SA = window.__ground && window.__ground.standAt; let nc = 0;
    for (let i = 0; i < 60 && nc < 16; i++) { const a = rr(-.6, 2.4), d = rr(.26, .7), cx = Math.cos(a) * d, cz = Math.sin(a) * d, gy = ghY(x + cx, z + cz);
      if (SA && SA(x + cx, z + cz) > gy + .015) continue;
      W(ch, rr(.035, .09), rr(.008, .016), rr(.018, .04), cx, gy - y0 + .005, cz, { mat: R() < .7 ? mx().splitwood : M.woodDark, ry: rr(0, 3), rz: rr(-.15, .15), r: .003 }); nc++; }
    ch.position.set(x, y0, z); scene.add(ch); }
  { // [ground round] the split wood from the block: quartered pieces thrown in a loose heap beside it, ready for the armful
    const x = -4.56, z = 4.02, y0 = ghY(x, z); const kh = new THREE.Group();
    for (let i = 0; i < 9; i++) { const l = rr(.3, .38), lay = i < 5 ? 0 : 1; const sp = new THREE.Group(); W(sp, .07, .06, l, 0, 0, 0, { mat: mx().splitwood, r: .006 }); W(sp, .005, .062, l, -.036, 0, 0, { mat: M.woodDark, r: .002 });
      sp.position.set(lay ? rr(-.12, .12) : -.2 + i * .1, .03 + lay * .065, rr(-.05, .05)); sp.rotation.set(0, rr(-.35, .35), rr(-.4, .4)); kh.add(sp); }
    kh.position.set(x, y0, z); kh.rotation.y = .3; scene.add(kh); kh.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(kh); kh.userData.box = b; kh.name = 'kindling'; placed.kindling = kh;
    OBST.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y: y0, n: 'kindling' }); }
  { const x = -3.6, z = 1.95; const sh = sawhorse(); sh.position.set(x, ghY(x, z), z); sh.rotation.y = Math.PI / 2; scene.add(sh); sh.name = 'sawhorse'; placed.sawhorse = sh; sh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(sh); sh.userData.box = b; OBST.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y: ghY(x, z), n: 'sawhorse' });
    tool('plankSaw', handSaw(), sh, .45, .62 + .035 + .13, .24, [0, Math.PI / 2, -.6]); PT.sawhorse = [sh, V(.45, .7, 0)]; }

  // ---------- grab / release for the hero's hands ----------
  const tq = new THREE.Quaternion();
  out.grab = (name, bone, { offset = V(0, .08, .03), rot = null } = {}) => {
    const o = out.tools[name]; if (!o || !bone) return null; const ws = bone.getWorldScale(V()).x || 1; bone.add(o); o.visible = true; homing.delete(o);
    o.scale.setScalar(((o.userData.home && o.userData.home.scale) || 1) / ws); if (rot) o.quaternion.copy(rot); else o.quaternion.identity();
    const grip = (o.userData.grip || V()).clone().applyQuaternion(o.quaternion).multiplyScalar(o.scale.x); o.position.copy(offset).multiplyScalar(1 / ws).sub(grip); return o;
  };
  // release(name) snaps the tool home; release(name, { blend: .4 }) lets go where the hand is and eases it onto its hook / spot
  const homing = new Map();
  out.release = (name, { blend = 0 } = {}) => { const o = out.tools[name]; const h = o && o.userData.home; if (!h) return;
    if (blend > 0 && o.parent !== h.parent) { h.parent.attach(o); homing.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.x, t: 0, d: blend, h }); return; }
    homing.delete(o); h.parent.add(o); if (h.hide) o.visible = false; o.position.copy(h.pos); o.quaternion.copy(h.quat); o.scale.setScalar(h.scale || 1); };
  // world spot where the tool lives (hook or bench), so the hand can reach there before release
  out.toolHome = (name, target = V()) => { const o = out.tools[name]; const h = o && o.userData.home; if (!h) return null; h.parent.updateMatrixWorld(true); return target.copy(h.pos).applyMatrix4(h.parent.matrixWorld); };
  // chair: chairPull(k) slides it back from the table by k * 0.2 m (0 = its home, where the seated pose is fitted).
  // Character: pull to 1 on the approach, ease back to 0 as the hips land (he scoots in), 1 again when he gets up.
  let chHome = null, chDir = null, chBox0 = null; const chairSt = { k: 0, to: 0, rate: 1 / .5 };
  out.chairPull = (k, sec = .5) => { if (!chHome) { /* taken on first use, after the room shift */ chHome = chairO.position.clone(); const tb = placed.table; chDir = V(0, 0, -1).applyQuaternion(chairO.quaternion).setY(0).normalize(); /* GRAB: straight back along the chair's own axis, the way the seated hero slides with it (towards the table centre it went 9 cm sideways under him) */ chBox0 = chairO.userData.box.clone(); }
    chairSt.to = Math.max(-1.25, Math.min(1, k)); /* GRAB: negative = scooted in under the table (k * 0.2 m), so the table top is within an arm's reach */ chairSt.rate = 1 / Math.max(.05, sec); };
  function tweens(dt) {
    for (const [o, f] of fading) { const d = f.to - o.userData.fk, st = f.rate * dt; fadeSet(o, Math.abs(d) <= st ? f.to : o.userData.fk + Math.sign(d) * st); if (o.userData.fk === f.to) fading.delete(o); }
    for (const [o, m] of homing) { m.t = Math.min(1, m.t + dt / m.d); const e = m.t * m.t * (3 - 2 * m.t); o.position.copy(m.p).lerp(m.h.pos, e); o.quaternion.copy(m.q).slerp(m.h.quat, e); o.scale.setScalar(m.s + ((m.h.scale || 1) - m.s) * e); if (m.t >= 1) homing.delete(o); }
    if (chairSt.k !== chairSt.to) { const d = chairSt.to - chairSt.k, st = chairSt.rate * dt; chairSt.k = Math.abs(d) <= st ? chairSt.to : chairSt.k + Math.sign(d) * st; const ak = Math.min(1, Math.abs(chairSt.k)), e = Math.sign(chairSt.k) * ak * ak * (3 - 2 * ak) * Math.max(1, Math.abs(chairSt.k));
      const off = chDir.clone().multiplyScalar(.2 * e); chairO.position.copy(chHome).add(off); chairO.updateMatrixWorld(true); chairO.userData.box.copy(chBox0).translate(off); }
  }
  out.chairO = chairO; out.bunk = bunk;
  out.lanternHousing = (parent, rod = .15) => { const h = lanternHousing(rod); bake(h); parent.add(h); return h; };
  void tq;

  // ---------- per-frame: book pages, oven heat ----------
  let pageT = 4, tAcc = 0;
  // ---- kettle steam: wisps rise from the spout while the oven is hot and the kettle sits on the stove ----
  const steamTex = texOf(canvas(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(.5, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }));
  const puffs = []; for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, color: 0xF4F0EA, transparent: true, opacity: 0, depthWrite: false })); s.visible = false; scene.add(s); puffs.push({ s, age: 9, life: 1, v: V() }); }
  let steamT = 0; const spout = V();
  function steam(dt, heat) {
    const k = out.tools.kettle; const onStove = k && k.parent === k.userData.home.parent;
    if (onStove && heat > .3) { steamT -= dt; if (steamT <= 0) { steamT = rr(.12, .28) / heat; const p = puffs.find(q => q.age >= q.life); if (p) { k.localToWorld(spout.set(.17, .16, 0)); p.s.position.copy(spout); p.age = 0; p.life = rr(1.4, 2.2); p.v.set(rr(.02, .06), rr(.16, .24), rr(-.03, .03)); p.s.visible = true; } } }
    for (const p of puffs) { if (p.age >= p.life) { p.s.visible = false; continue; } p.age += dt; const t = p.age / p.life; p.s.position.addScaledVector(p.v, dt); p.v.x += Math.sin(tAcc * 2 + p.life * 9) * .02 * dt; p.s.scale.setScalar(.04 + t * .22); p.s.material.opacity = .32 * Math.sin(Math.PI * Math.min(1, t * 1.3)) * (1 - t); }
  }
  // ---- the quilt sinks where someone lies on it: Character calls __props.bedPress(worldHipPos) / bedPress(null) ----
  const quiltMesh = (() => { let q = null; bunk.traverse(o => { if (o.isMesh && o.material === M.quilt && (!q || o.position.y < q.position.y)) q = o; }); return q; })(); // the LOWER bunk's quilt (he sleeps there; the last match was the upper one, so the cover never rose over him)
  out.quiltMat = M.quilt; // bed thread: hero.js bedTopAt() looks through the quilt to the pillow and mattress
  const qBase = quiltMesh ? quiltMesh.geometry.attributes.position.array.slice() : null, nBase = quiltMesh ? quiltMesh.geometry.attributes.normal.array.slice() : null;
  const press = { at: null, k: 0, shown: -1, cover: false };
  const qBot = (() => { if (!qBase) return 0; let m = 1e9; for (let i = 1; i < qBase.length; i += 3) if (qBase[i] < m) m = qBase[i]; return m; })();
  // BED (2026-11-24): the quilt mesh is merged with the UPPER bunk's quilt and its normals are not reliable there, so the old
  // "top = highest up-facing vertex" gave -1e9: every vertex counted as the top, the hanging sides and hem rose with him and
  // the quilt stood over a bare mattress in arches. Now from positions only: the lower quilt is everything within .3 m of its hem.
  const qLowMax = (() => { if (!qBase) return 0; let m = -1e9; for (let i = 1; i < qBase.length; i += 3) if (qBase[i] < qBot + .3 && qBase[i] > m) m = qBase[i]; return m; })();
  const qTop = qLowMax - .045;
  // bedPress(worldHip): a hollow where he sits or lies ON the quilt. bedCover(worldHip): he lies UNDER it: the quilt rises over a
  // body (head toward the pillow, +x in the bed), so his legs never show through. null releases either; both ease in and out.
  out.bedPress = (p) => { press.at = p ? bunk.worldToLocal(p.clone()) : press.at; press.on = !!p; if (p) press.cover = false; };
  out.bedCover = (p) => { press.at = p ? bunk.worldToLocal(p.clone()) : press.at; press.on = !!p; if (p) { press.cover = true; coverBones = null; } };
  const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  function bodyLift(x, z, c) { // height of the cover over a lying body, hips at c (bed local), feet toward -x
    const u = x - c.x; if (u < -1.15 || u > .7) return 0;
    const h = u < 0 ? .09 + .05 * sm(-.95, 0, u) : .14 + .03 * sm(0, .35, u); // feet .09, hips .14, chest .17
    const w = u < 0 ? .13 + .07 * sm(-.95, 0, u) : .2 + .03 * sm(0, .3, u); const dz = (z - c.z) / w;
    return h * Math.exp(-dz * dz * 1.3) * sm(-1.15, -.95, u) * (1 - sm(.45, .7, u)); }
  // H3b: under the quilt the cover follows his real body: every torso/limb bone of the sleeping hero lifts the cloth to its own
  // height plus the body's thickness there (soft union of blobs), so on his back, side or stomach the quilt drapes over him.
  // The head and hands stay out. Refreshed 5 times a second while he is in bed (breathing, turning over).
  // BED (2026-11-24): the cover is draped over CAPSULES along his bones (thigh, shin, foot, spine, arms), not blobs at the joints:
  // between two joints the blobs left a dip and his shins and boots came up through the quilt. Cloth falls from each limb's
  // top to the mattress in a soft curve, so it tents over bent knees and lies flat between the legs.
  const COVER_SEG = [['Hips', 'Spine1', .15], ['Spine1', 'Spine2', .16], ['Spine2', 'Neck', .13], ['LeftUpLeg', 'RightUpLeg', .12],
    ['LeftUpLeg', 'LeftLeg', .105], ['RightUpLeg', 'RightLeg', .105], ['LeftLeg', 'LeftFoot', .085], ['RightLeg', 'RightFoot', .085],
    ['LeftFoot', 'LeftToeBase', .09], ['RightFoot', 'RightToeBase', .09],
    ['LeftShoulder', 'LeftArm', .075], ['RightShoulder', 'RightArm', .075], ['LeftArm', 'LeftForeArm', .06], ['RightArm', 'RightForeArm', .06], ['LeftForeArm', 'LeftHand', .06, 1], ['RightForeArm', 'RightHand', .06, 1]];/* R54-1: a forearm and fist lying low beside him (under the hips' height) are covered too: the fist stood out through the quilt's side. Up on his chest or stomach they stay out on top *//* forearms and hands stay out (on top of the quilt), they tented it into peaks */
  let coverBones = null, coverT = 0; const cb = [];
  function findCoverBones() { if (coverBones) return coverBones; if (!press.at) return null; const at = bunk.localToWorld(press.at.clone()); let sk = null, best = 1e9;
    const shown = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    bunk.parent.traverse(o => { if (!o.isSkinnedMesh || !o.skeleton || !shown(o)) return; const hb = o.skeleton.bones.find(b => /Hips$/.test(b.name)) || o.skeleton.bones[0]; const d = hb.getWorldPosition(V()).distanceTo(at); if (d < best) { best = d; sk = o.skeleton; } }); if (!sk || best > 1) return null;
    const byName = {}; for (const bn of sk.bones) byName[bn.name.replace(/^.*[:_]/, '').replace(/^mixamorig/, '')] = bn;
    const list = []; for (const [a, b, r, low] of COVER_SEG) if (byName[a] && byName[b]) list.push({ a: byName[a], b: byName[b], r, f: /Leg|Foot|Toe/.test(a + b) ? .75 : 1.05, low: !!low, hips: byName.Hips }); return (coverBones = list.length >= 8 ? list : null); }
  out._quiltDbg = () => ({ qTop, qBot, m: quiltMesh, mesh: quiltMesh && quiltMesh.name, y: quiltMesh && quiltMesh.position.y, press: { on: press.on, k: press.k, cover: press.cover, at: press.at }, cb: cb.length, bones: coverBones && coverBones.length });
  const _cv = V(), _cw = V();
  // cloth height over one capsule at (x,z): the limb's top (+ cloth thickness) right over it, then falling away to the sides
  const LT = [0, .25, .5, .75, 1];
  function liftAt(x, z, y0) { let acc = 0; for (const q of cb) { const ex = q.bx - q.ax, ez = q.bz - q.az, L2 = ex * ex + ez * ez; let t = L2 > 1e-8 ? ((x - q.ax) * ex + (z - q.az) * ez) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      // a rounded crown over the limb, then the cloth slopes down: no sharp ridges (sideways the quilt stood up in pointed tents)
      // R56-1: the highest point of the limb under the cloth, not only the one nearest in plan: a raised shin stands near upright, its
      // plan is a dot and the nearest point could be the low ankle, so the knee and shin came up through the quilt as he swung his legs in
      let hb = -1e9; for (let j = -1; j < LT.length; j++) { const tt = j < 0 ? t : LT[j]; const dx = x - (q.ax + ex * tt), dz = z - (q.az + ez * tt), d = Math.sqrt(dx * dx + dz * dz); const yc = q.ay + (q.by - q.ay) * tt;
        const top = yc + q.r * q.f + .015;/* the legs thin (R42-2 box); chest and arms full, the sweater is thicker there (it came through in orange shards) */ const o = Math.max(0, d - q.r * .4); const dr = o < .06 ? 5 * o * o : .018 + .6 * (o - .06) + 9 * (o - .06) * (o - .06);/* R42-2: the cloth lies ON the limb and falls off it (it stood 25-30 cm over his legs like a box with straight sides) */
        const h = top - dr; if (h > hb) hb = h; }
      const h = hb - y0; if (h > 0) acc += Math.exp(h * 45) - 1; } return acc > 0 ? Math.log1p(acc) / 45 : 0; }
  // ---- BED (2026-11-24, Pavel: "the quilt just appears on top of him, he never covers himself"): the quilt's head flap folds over a
  // hinge across the bed. fold 0 = flat (a made bed), 1 = turned down onto the lower half. Character moves it with his hand on the
  // flap's free edge (quiltFold / quiltEdge), so it only ever moves where his hand takes it; quiltLive(s) refreshes it every frame.
  let qxMax = -1e9; if (qBase) for (let i = 0; i < qBase.length; i += 3) if (qBase[i + 1] <= qLowMax + .1 && qBase[i] > qxMax) qxMax = qBase[i];
  const FL = .3, FR = .1, qFlat = qLowMax - .034, qHinge = qxMax - FL; const fold = { a: 0, shown: 0 }; const _fp = [0, 0];
  // a point of the flap: x along the quilt, yo its height over the flat top (negative on the hanging sides), a the fold angle 0..PI.
  // The cloth bends round the hinge on a radius (no crease through itself), then runs straight; it keeps its thickness on the turn.
  function foldPt(x, yo, a, o) { const s = x - qHinge; if (s <= 0 || a < 1e-4) { o[0] = x; o[1] = qFlat + yo; return o; }
    if (yo < 0) yo *= 1 - .85 * a / Math.PI;/* its hanging sides fold flat with it */ const rho = FR / a; let px, py, th;
    if (s <= FR) { th = s / rho; px = qHinge + rho * Math.sin(th); py = qFlat + rho * (1 - Math.cos(th)); }
    else { th = a; px = qHinge + rho * Math.sin(a) + (s - FR) * Math.cos(a); py = qFlat + rho * (1 - Math.cos(a)) + (s - FR) * Math.sin(a); }
    o[0] = px - yo * Math.sin(th); o[1] = py + yo * Math.cos(th); return o; }
  out.quiltFold = (v) => { if (v == null) return fold.a / Math.PI; fold.a = clamp01(v) * Math.PI; };
  out.quiltLive = (t) => { press.fast = Math.max(press.fast || 0, t); };
  // the flap's free edge in the world, at the z of the given world point (kept off the corners): where his fingers hold it
  out.quiltEdge = (pw, sf = 1, zm = .33) => { if (!quiltMesh) return null; bunk.updateMatrixWorld(true); const pl = bunk.worldToLocal(pw.clone()); const zl = Math.max(-zm, Math.min(zm, pl.z));/* zm: up to its side hem */
    foldPt(qHinge + FL * sf, .012, fold.a, _fp);/* sf: how far along the flap the hand holds it (1 = its free edge) */ let X = _fp[0], Y = _fp[1]; if (press.cover && press.k > .001 && cb.length) Y += liftAt(X, zl, Y) * press.k; return bunk.localToWorld(V(X, Y, zl)); };
  out._quiltFoldDbg = () => ({ qxMax, qHinge, qFlat, a: fold.a });
  function pressQuilt(dt) {
    if (!quiltMesh) return; press.k += ((press.on ? 1 : 0) - press.k) * Math.min(1, dt * (press.cover ? 6 : 1.5));/* the cover drops as fast as it rises: getting up, his legs went out through the slowly sinking box *//* covering: the cloth is over him at once (rising over 2 s it let the sweater through, items thread) */ if (press.fast > 0) press.fast -= dt;
    const cover = press.cover && (press.on || press.k > .01) && (cb.length || findCoverBones()); coverT -= dt;
    const folded = Math.abs(fold.a - fold.shown) > 1e-3;
    if (cover) { if (!(coverT <= 0 || press.fast > 0 || folded || Math.abs(press.k - press.shown) >= .01)) return; }
    else if (!folded && (Math.abs(press.k - press.shown) < .01 || !press.at)) return;
    press.shown = press.k; fold.shown = fold.a;
    if (cover) { coverT = .2; bunk.updateMatrixWorld(true);
      if (findCoverBones()) { cb.length = 0; for (const q of coverBones) { q.a.getWorldPosition(_cv); bunk.worldToLocal(_cv); q.b.getWorldPosition(_cw); bunk.worldToLocal(_cw); if (q.low && q.hips) { const hy = bunk.worldToLocal(q.hips.getWorldPosition(V())).y; if (_cw.y > hy + .01) continue; } let f = q.f || 1; if (f < 1) { const sl = Math.abs(_cw.y - _cv.y) / Math.max(1e-4, _cv.distanceTo(_cw)); f += (1.05 - f) * Math.min(1, sl * 2.5); }/* R56-1: a leg that rises (knee up as he swings in) is covered at its full thickness: thinned, its trousers came up through the quilt at the hip; lying flat it stays thin (R42-2 box) */ cb.push({ ax: _cv.x, ay: _cv.y, az: _cv.z, bx: _cw.x, by: _cw.y, bz: _cw.z, r: q.r, f }); } } }
    const P = quiltMesh.geometry.attributes.position, a = P.array, k = press.k, c = press.at, A = fold.a;
    for (let i = 0; i < a.length; i += 3) { const x = qBase[i], y = qBase[i + 1], z = qBase[i + 2]; a[i] = x; a[i + 1] = y; a[i + 2] = z; if (y > qLowMax + .1) continue;/* the upper bunk's quilt */
      let X = x, Y = y; if (A > 1e-4 && x > qHinge) { foldPt(x, y - qFlat, A, _fp); X = _fp[0]; Y = _fp[1]; }
      if (cover && k > .001) { /* the hanging sides: the hem stays down, the cloth slopes from the lifted top edge to it */let L0 = liftAt(X, z, Y > qTop ? Y : qTop); if (Y < qTop) L0 *= Math.max(0, (Y - qBot) / (qTop - qBot)); Y += L0 * k; }
      else if (!cover && c && k > .001 && Math.abs(y - c.y) <= .3) { // an elongated hollow along the bed where he sits or lies on it, deepest under the hips
        const dx = (X - c.x) / .55, dz = (z - c.z) / .22, d = Math.sqrt(dx * dx + dz * dz); if (d <= 1.35) Y -= (d < 1 ? (1 - d * d) * .055 : -Math.sin((d - 1) / .35 * Math.PI) * .008) * k; }
      a[i] = X; a[i + 1] = Y; }
    P.needsUpdate = true; quiltMesh.geometry.computeVertexNormals(); quiltMesh.geometry.computeBoundingSphere(); }
  out.update = (dt, { reading = false, cooking = false, heat = 0 } = {}) => { { const lt = out.tools && out.tools.lantern, gw = lt && lt.userData.glow, LG = window.__lights; if (gw && LG && LG.get) { let k = 0; try { const h = LG.get('hand'); k = h ? (h.level || 0) : 0; } catch (e) { } if (Math.abs(k - (gw.k || 0)) > .01 || (k > .02) !== gw.flame.visible) { gw.k = k; gw.glass.emissiveIntensity = 1.1 * k; gw.flame.visible = k > .02; } if (gw.flame.visible) { const t = performance.now() * .001; gw.flame.scale.set(1, .85 + .15 * Math.sin(t * 17) * Math.sin(t * 7.3), 1); } } } if (out._atlas) out._atlas.poll(dt); { const st = window.__th && window.__th.state; if (st && (out._nmT = (out._nmT || 0) - dt) <= 0) { out._nmT = 1; let hr = 12; try { hr = st().hour; } catch (e) {} const day = Math.min(1, Math.max(0, Math.min(hr - 5.5, 20.5 - hr) / 1.5)); for (const m of NIGHT_METALS) m.envMapIntensity = m.userData.env0 * (.12 + .88 * day); } } /* metals: the env map is a daylight room, so at night their reflection fades instead of glowing */ if (out._toolProxyTick) out._toolProxyTick();
    steam(dt, heat); pressQuilt(dt);
    out.book.update(dt);
    if (reading) { pageT -= dt; if (pageT <= 0) { out.book.turn(1); pageT = rr(5, 9); } }
    out.oven.setHeat(heat); void cooking; /* lights.js owns the oven heat (passed in as heat) */ tAcc += dt; out.oven.flicker(tAcc);
    tweens(dt); out.dishes && out.dishes._plate(); out.door.update(dt); out.fridge.update(dt); out.water.update(dt);
    // the radio dial is a light source for lights.js (registered once lights.js is up)
    if (!out._radioLit && window.__lights && window.__lights.addSource) { out._radioLit = true; try { window.__lights.addSource('radio', { room: 'bedroom', kind: 'glow', pos: out.radio.knob(V()), mats: [[out.radio.dialMat, 1.2]], light: { I: .6, dist: 1.5 } }); } catch (e) { console.warn('radio light', e); } }
  };
  // ---------- stovepipe: from the hood duct across the kitchen ceiling, out through the left wall,
  // then up outside the bedroom wall past the eaves, with a rain cap (smoke.js reads out.chimneyTop) ----------
  { const g = new THREE.Group(); const r = .072, y1 = KT + 1.95, xo = -4.8, z = 1.3, top = BD + 3.25; /* photo: a stout pipe standing well clear of the bedroom eave with a coolie-hat cap (5.5 cm read as a 2 px line from the home view) */
    const seg = (a, b) => { const d = b.clone().sub(a); const m = add(g, new THREE.CylinderGeometry(r, r, d.length(), 16), M.iron, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); };
    const joint = (p) => add(g, new THREE.SphereGeometry(r * 1.08, 16, 10), M.iron, p.x, p.y, p.z);
    const band = (p, horiz) => add(g, new THREE.CylinderGeometry(r * 1.15, r * 1.15, .03, 16), M.iron, p.x, p.y, p.z, 0, 0, horiz ? Math.PI / 2 : 0);
    const A = V(-3.25, y1, z), B = V(xo, y1, z), C = V(xo, top, z);
    seg(V(-3.25, KT + 1.62, z), A); joint(A); seg(A, B); joint(B); seg(B, C);
    for (const x of [-3.9, -4.42]) band(V(x, y1, z), true); for (let y = y1 + .5; y < top - .2; y += .7) band(V(xo, y, z), false);
    // wall collar where it goes through the kitchen wall, a bracket on the bedroom wall, the cap
    add(g, rb(.05, .22, .22, .01), M.woodDark, -4.42, y1, z); add(g, rb(.62, .03, .05, .01), M.iron, -4.5, BD + 1.2, z);
    add(g, new THREE.CylinderGeometry(.012, .21, .13, 20), M.iron, xo, top + .15, z); add(g, new THREE.CylinderGeometry(.21, .21, .012, 20), M.iron, xo, top + .085, z); for (const s of [-1, 1]) for (const t of [0, 1]) add(g, rb(.012, .1, .012, .003), M.iron, xo + (t ? 0 : s * .06), top + .05, z + (t ? s * .06 : 0));
    bake(g); g.traverse(o => { if (o.isMesh) o.castShadow = false; }); scene.add(g); out.chimneyTop = V(xo, top, z); }
  shiftRooms();
  setTop(0, placed.counter, 0, .5, .315, .9); setTop(1, placed.workbench, 1, .85, .33, .9); setTop(2, placed.sidebench, 2, .5, .21, .78, -Math.PI / 2); // (Planks thread) worn work tops
  // ---------- light sources (computed before the static merge below, from the real positions) for lights.js: world positions + the emissive materials to switch ----------
  // each: { pos: Vector3 (world), obj, mats: [materials whose emissive/opacity show the source is on] }
  { const wp = (o, x = 0, y = 0, z = 0) => { o.updateMatrixWorld(true); return o.localToWorld(V(x, y, z)); };
    const st = placed.stove, kl = placed.klamp, wl = placed.wlamp, bl = placed.blamp;
    out.lights = {
      oven: { pos: wp(st, 0, .3, .05), obj: st, mats: [M.fire, M.ovenGlass, out.oven.flameMat], setHeat: out.oven.setHeat },
      kitchenLamp: { pos: wp(kl, 0, 0, 0), obj: kl, mats: [M.glass] },
      bedroomLamp: { pos: wp(bl, 0, 0, 0), obj: bl, mats: [M.glass], own: true },
      workshopLamp: { pos: wp(wl, 0, .06, 0), obj: wl, mats: [wl.userData.inner] },
      candle: { pos: wp(candleObj, 0, .13, 0), obj: candleObj, mats: [candleObj.userData.flame] },
    };
    out.materials = { fire: M.fire, ovenGlass: M.ovenGlass, flame: out.oven.flameMat, lampGlass: M.glass, domeInner: wl.userData.inner, candleFlame: candleObj.userData.flame };
  }
  // ---------- merge every static prop into one mesh per material (and shadow flag) for the whole house ----------
  // kept separate: interactive or raycast objects (chair, bunk bed, stove with its door, lamps that lights.js
  // finds by position, tools, the open book, the candle flame). The emptied groups stay in place with their boxes.
  // perf: phones get a stricter shadow budget (only furniture-sized parts cast)
  const MOB = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); const CAST_R = MOB ? .35 : .2; out.mobile = MOB;
  const NOMERGE = /[?&]nomerge/.test(location.search); /* debug: keep every prop as built (support checks) */
  if (!NOMERGE) { const KEEP = new Set(['chair', 'bunkbed', 'klamp', 'wlamp', 'blamp']); /* stove merged too: its door, fire and pots are live */
    const roots = []; for (let i = nScene0; i < scene.children.length; i++) { const o = scene.children[i]; if (KEEP.has(o.name) || o.userData.live || o.userData.book || Object.values(out.tools).includes(o)) continue; roots.push(o); }
    const by = new Map(); const kill = []; const MST = out._mergeStats = {}; out._liveMats = new Set(Object.values(out.materials || {}).filter(Boolean));
    for (const r of roots) { r.updateMatrixWorld(true); r.traverse(o => { if (!o.isMesh || o.userData.live || o.isSkinnedMesh) return; let p = o.parent; while (p && p !== r) { if (p.userData.live) return; p = p.parent; } if (o.material.transparent && o.material.depthWrite === false) return;
      let g0 = lodGeo(o), g = g0.index ? g0.toNonIndexed() : g0.clone(); if (g0 !== o.geometry) g0.dispose(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'vmet'].includes(k)) g.deleteAttribute(k); if (g.attributes.color && !o.material.vertexColors) g.deleteAttribute('color'); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.applyMatrix4(o.matrixWorld);
      g.computeBoundingSphere(); const cast = o.castShadow && g.boundingSphere.radius > CAST_R; /* only big parts cast (perf; phone stricter) */ const m0 = o.material; let key = m0.uuid + (cast ? 's' : 'n'), mat = m0; const pm = out._liveMats.has(m0) ? null : plainOf(m0); if (pm) { if (m0.flatShading) g.computeVertexNormals(); colorize(g, m0.color, m0.roughness, m0.metalness); mat = pm; key = pm.uuid + (cast ? 's' : 'n'); } else if (!out._liveMats.has(m0) && ATL.take(m0, g)) { if (m0.flatShading) g.computeVertexNormals(); colorize(g, m0.color, m0.roughness, m0.metalness); mat = ATL.mat(); key = 'atlas' + (cast ? 's' : 'n'); } else if (m0.vertexColors && !g.attributes.color) colorize(g, new THREE.Color(1, 1, 1));
      if (!by.has(key)) by.set(key, { mat, cast, gs: [] }); by.get(key).gs.push(g); kill.push(o); const rn = r.name || ('@' + r.position.toArray().map(v => v.toFixed(1))); MST[rn] = (MST[rn] || 0) + g.attributes.position.count / 3 * (cast ? 2 : 1); }); }
    for (const o of kill) o.removeFromParent();
    ATL.build(); out._atlas = ATL;
    // a material whose casting parts add up to a few hundred triangles is not worth its own shadow draw: fold it into the non-casting mesh
    for (const [k, e] of [...by]) { if (!e.cast) continue; let n = 0; for (const g of e.gs) n += g.attributes.position.count / 3; const kn = k.slice(0, -1) + 'n'; if (n > 400) continue;
      if (by.has(kn)) { by.get(kn).gs.push(...e.gs); by.delete(k); } else e.cast = false; }
    // and a small non-casting remainder of a material that also casts joins the casting mesh (one draw instead of two; a few extra shadow triangles)
    for (const [k, e] of [...by]) { if (e.cast) continue; const ks = k.slice(0, -1) + 's'; if (ks === k || !by.has(ks)) continue; /* ks === k: a small casting group just demoted above is its own 's' key; merging it into itself deleted it (the galvanised workshop bucket vanished) */ let n = 0; for (const g of e.gs) n += g.attributes.position.count / 3; if (n > 1500) continue; by.get(ks).gs.push(...e.gs); by.delete(k); }
    const sg = new THREE.Group(); sg.name = 'propsStatic'; for (const { mat, cast, gs } of by.values()) { const m = new THREE.Mesh(mergeGeometries(gs, false), mat); m.castShadow = cast; m.receiveShadow = true; sg.add(m); gs.forEach(x => x.dispose()); } scene.add(sg); out.staticGroup = sg; out.wetMats = sg.children.map(m => m.material).filter(m => m && m.isMeshStandardMaterial && !m.transparent); /* rain.js wets these too (per pixel, only where the sky reaches): its 7x7 footprint probe missed some merged outdoor parts (kindling, deck basket) */ }
  { const ws = V(); for (let i = nScene0; i < scene.children.length; i++) { const r = scene.children[i]; if (r === out.staticGroup) continue; r.updateMatrixWorld(true);
      r.traverse(o => { if (!o.isMesh || !o.castShadow || o.isInstancedMesh) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); o.getWorldScale(ws); if (o.geometry.boundingSphere.radius * Math.max(ws.x, ws.y, ws.z) < CAST_R) o.castShadow = false; }); } }
  // perf: the same merge inside every object that stays separate (kept furniture, live objects, tools): static parts by material
  // (plain colours share one vertex-coloured material), keeping each part's shadow flags; anything the code moves or edits is a
  // userData.live node and stays as it is, and a material that has a single part is left alone too.
  if (!NOMERGE) { for (const m of Object.values(out.materials || {})) if (m) m.userData.keep = true; if (quiltMesh) quiltMesh.userData.live = true;
    const deep = o => { bake(o, true); for (const c of o.children.slice()) walk(c); }, walk = c => { if (c.userData.live) deep(c); else for (const k of c.children.slice()) walk(k); };
    for (let i = nScene0; i < scene.children.length; i++) { const r = scene.children[i]; if (r === out.staticGroup || r.userData.book || r.isLight) continue; deep(r); } }
  // perf: every tool sitting at home (hooks, shelves, stove, bench) is drawn from one shared proxy mesh per material. Each tool
  // has an id in a vertex attribute; when it leaves home (grabbed, easing back, its parent moved, hidden) its id is masked out of
  // the proxy (vertices collapse) and its own meshes show again. Shadow-casting and live sub-parts always stay on the tool itself.
  if (!NOMERGE) { const names = Object.keys(out.tools).slice(0, 63), uHide = { value: new Array(64).fill(0) }, by = new Map(), TP = []; const prox = new Map();
    const proxMat = m => { if (prox.has(m)) return prox.get(m); const pm = m.clone(); const ob = m.onBeforeCompile, ck = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
      pm.onBeforeCompile = (sh, r) => { if (ob && ob !== THREE.Material.prototype.onBeforeCompile) ob.call(m, sh, r); sh.uniforms.uHide = uHide;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float tid; uniform float uHide[64];').replace('#include <project_vertex>', '#include <project_vertex>\nif (uHide[int(tid + .5)] > .5) gl_Position = vec4(2., 2., 2., 1.);'); };
      pm.customProgramCacheKey = () => ck + '|toolProxy'; prox.set(m, pm); return pm; };
    names.forEach((name, i) => { const o = out.tools[name], h = o.userData.home; if (!h || !o.visible || o.userData.noProxy) return; o.updateMatrixWorld(true); const ms = [];
      o.traverse(c => { if (!c.isMesh || c.castShadow || Array.isArray(c.material) || c.isInstancedMesh || c.isSkinnedMesh || !c.visible) return; const m = c.material; if (m.transparent || m.userData.keep || !m.isMeshStandardMaterial) return;
        if (c !== o && c.userData.live) return; for (let q = c.parent; q && q !== o; q = q.parent) if (q.userData.live || !q.visible) return;
        let g0 = lodGeo(c), g = g0.index ? g0.toNonIndexed() : g0.clone(); if (g0 !== c.geometry) g0.dispose(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'vmet'].includes(k)) g.deleteAttribute(k); if (g.attributes.color && !m.vertexColors) g.deleteAttribute('color'); if (m.vertexColors && !g.attributes.color) colorize(g, new THREE.Color(1, 1, 1), m.userData.plainV ? 1 : undefined, m.userData.plainV ? 0 : undefined);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.applyMatrix4(c.matrixWorld); g.setAttribute('tid', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i), 1));
        const key = m.uuid + (g.attributes.color ? g.attributes.color.itemSize : 0); if (!by.has(key)) by.set(key, { m, gs: [] }); by.get(key).gs.push(g); ms.push(c); });
      if (ms.length) { ms.forEach(c => c.visible = false); o.parent.updateMatrixWorld(true); TP.push({ i, o, h, ms, at: true, mw: ms.map(c => c.matrixWorld.clone()) }); } });
    // where the house's static merge already has a mesh of the same material, the tools join it (static parts get tool id 63, never masked)
    const injD = sh => { sh.uniforms.uHide = uHide; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float tid; uniform float uHide[64];').replace('#include <project_vertex>', '#include <project_vertex>\nif (uHide[int(tid + .5)] > .5) gl_Position = vec4(2., 2., 2., 1.);'); };
    const dMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); dMat.onBeforeCompile = injD; dMat.customProgramCacheKey = () => 'toolProxyD'; const pMat = new THREE.MeshDistanceMaterial(); pMat.onBeforeCompile = injD; pMat.customProgramCacheKey = () => 'toolProxyP';
    const pg = new THREE.Group(); pg.name = 'toolProxy'; for (const { m, gs } of by.values()) {
      const cands = out.staticGroup ? out.staticGroup.children.filter(t => t.material === m && !t.customDepthMaterial) : []; const tg = cands.find(t => !t.castShadow) || cands[0];
      const need = Object.keys(gs[0].attributes).filter(k => k !== 'tid').sort().join(); if (tg && Object.keys(tg.geometry.attributes).sort().join() === need && (!tg.geometry.attributes.color || tg.geometry.attributes.color.itemSize === gs[0].attributes.color.itemSize)) {
        const sgG = tg.geometry; sgG.setAttribute('tid', new THREE.Float32BufferAttribute(new Float32Array(sgG.attributes.position.count).fill(63), 1)); const mg = mergeGeometries([sgG, ...gs], false);
        if (mg) { tg.geometry = mg; sgG.dispose(); tg.material = proxMat(m); if (tg.castShadow) { tg.customDepthMaterial = dMat; tg.customDistanceMaterial = pMat; } gs.forEach(g => g.dispose()); continue; } sgG.deleteAttribute('tid'); }
      const mesh = new THREE.Mesh(mergeGeometries(gs, false), proxMat(m)); mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; pg.add(mesh); gs.forEach(g => g.dispose()); }
    scene.add(pg); out.toolProxy = pg;
    const vis = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    out._toolProxyInfo = () => TP.map(t => t.o === undefined ? '' : (t.at ? 1 : 0)).join(''); out._toolProxyTick = () => { for (const t of TP) { const { o, h } = t; const at = o.parent === h.parent && !homing.has(o) && o.position.distanceToSquared(h.pos) < 1e-8 && Math.abs(o.quaternion.dot(h.quat)) > .999999 && Math.abs(o.scale.x - (h.scale || 1)) < 1e-5 && vis(o) && t.ms.every((c, k) => c.matrixWorld.equals(t.mw[k])); /* any part moved (parent, covers, lids) -> the tool draws itself */
        if (at !== t.at) { t.at = at; uHide.value[t.i] = at ? 0 : 1; for (const c of t.ms) c.visible = !at; } } }; }
  out._roots = new Set(scene.children.slice(nScene0)); /* perf attribution (tests) */
  // perf (Optimization): everything that never moves keeps its matrix; live nodes (doors, lids, knobs, dishes, flames...), tools
  // (grabbed, eased home), the book and the chair (chairPull) keep updating. A frozen parent of a live child is fine.
  { const moving = new Set([chairO, ...Object.values(out.tools)]); let nFrozen = 0;
    const freeze = o => { if (o.userData.live || o.userData.book || moving.has(o)) return; o.updateMatrix(); o.matrixAutoUpdate = false; nFrozen++; for (const c of o.children) freeze(c); };
    for (const r of out._roots) freeze(r); out._frozen = nFrozen; }
  out.surfaces.bed = bunk.userData.info.levels.map(l => ({ top: bunk.userData.floorY + l.top, x0: bunk.position.x + l.x0, x1: bunk.position.x + l.x1, z0: bunk.position.z + l.z0, z1: bunk.position.z + l.z1, headDir: '+x' }));
  return out;
}
