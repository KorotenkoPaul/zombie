// Tree dressing: the life on the oak itself, so the trunk does not look bare and freshly cleaned.
// Owned by the "tree dressing" thread. index.html calls createTreeDress() once, after the house boards are built.
//  - bark: darker, cooler and damper towards the ground (soft AO), moss on the up/back-facing sides of roots and limbs,
//    pale lichen spots higher up. Chained onto the bark material of tree.js (tree.js itself is untouched).
//  - soil and fallen-leaf litter piled in the pockets between the big roots, right at the trunk foot
//  - soft moss cushions on root tops and in limb forks
//  - sparse ivy climbing the lower trunk (stems + leaves that flutter in the wind)
//  - small ferns and grass tufts tucked into root crevices and forks
// Everything is instanced or merged: 6 draw calls, about half the counts on phones.
//
// createTreeDress({scene, TREE, MOBILE, leafT, U, rootD, avoid, blockers}) -> {bark, ivy, moss, litter, ferns, tufts}
//   U:        {t, wind} uniforms (ENV.U) for the wind sway
//   rootD:    (x,z) -> metres to the nearest root (ground.js), used to find the pockets between roots
//   avoid:    room volumes [[x0,x1,y0,y1,z0,z1],...] (TREE_AVOID): nothing grows inside the house
//   blockers: instanced meshes (boards, beams): leaves never poke through a floor or a landing
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundH } from './env.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

const NOISE = `
float td_h(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float td_n(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(td_h(i),td_h(i+vec3(1,0,0)),f.x),mix(td_h(i+vec3(0,1,0)),td_h(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(td_h(i+vec3(0,0,1)),td_h(i+vec3(1,0,1)),f.x),mix(td_h(i+vec3(0,1,1)),td_h(i+vec3(1,1,1)),f.x),f.y),f.z);}
float td_f(vec3 p){return td_n(p)*.55+td_n(p*2.13+3.1)*.3+td_n(p*4.37+7.7)*.15;}`;

// leaf flutter for instanced cards: small rotation-ish wobble growing with distance from the stem (uv.y)
const FLUTTER = `{vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);
 float gust=.55+.45*sin(uT*.35+ip.x*.05-ip.z*.04);
 float k=clamp(uv.y,0.,1.)*SW*uW*gust;
 transformed.z+=sin(uT*2.3+ip.x*3.1+ip.y*2.7)*k;
 transformed.x+=sin(uT*1.7+ip.z*2.9+ip.y*1.3)*k*.5;}`;
function swayMat(mat, U, amp, chunk) {
  mat.onBeforeCompile = s => {
    if (mat.userData.AX !== undefined) branchHook(s, mat.userData.AX, mat.userData.AZ);
    s.uniforms.uT = U.t; s.uniforms.uW = U.wind;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT,uW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{const float SW=${amp.toFixed(3)};${chunk}}`);
  };
  return mat;
}

// things sitting on the oak follow the slow limb sway of the bark (wind.js windBranch), so nothing floats off a far branch
function branchHook(sh, AX, AZ) {
  const W = window.__wind; if (!W) return;
  if (!sh.vertexShader.includes('windBranch')) W.hook(sh);
  sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  {vec3 bip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);transformed+=windLocal(windBranch(bip,vec2(${AX.toFixed(3)},${AZ.toFixed(3)})));}
#endif`);
}
export function createTreeDress(C) {
  const { scene, TREE, MOBILE, leafT, U, rootD = () => 99, avoid = [], blockers = [] } = C;
  const R = rng(424242); const rr = (a, b) => a + R() * (b - a);
  const [AX, AZ] = TREE.axis; const doorAng = TREE.doorAngle ?? 1.15;
  const D = { group: new THREE.Group() }; D.group.name = 'treedress'; scene.add(D.group);
  const MUL = MOBILE ? 0.55 : 1;
  const onTree = m => { m.userData.AX = AX; m.userData.AZ = AZ; return m; };

  // ================= 1. bark: damp dark foot, moss, lichen =================
  // chained after tree.js's own shader so both keep working; everything is in world space, so it follows any oak model
  {
    const mat = TREE.bark.material, prev = mat.onBeforeCompile;
    const ENVR = (C.env || window.__env || {}).moonRim || { color: { value: new THREE.Color(0x86C2F0) }, strength: { value: 0 }, dir: { value: V(-1, .7, .2).normalize() } };
    // wetness: a little dew at night, soaked in the rain. Rain is read back from the wind uniform (env: wind = 1 + rain*1.5).
    // real oak bark relief: tileable maps baked from a Fal photo of oak bark (pipeline/bark_maps.py), mapped triplanar in
    // world space so nothing stretches on the sculpted model. barkN = normal, barkH = height / cavity / fine detail.
    const TL = new THREE.TextureLoader(), AS = window.__ASSET || '';
    const ldT = n => { const t = TL.load(AS + n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = MOBILE ? 4 : 8; return t; };
    D.barkU = { mossAmt: { value: 1 }, footDark: { value: 1 }, wet: { value: 0 }, rimK: { value: 1 },
      nrm: { value: ldT('barkN.jpg') }, hao: { value: ldT('barkH.jpg') }, relief: { value: 1 }, scale: { value: 0.55 }, cool: { value: 0.5 } };
    D.update = () => { const rain = Math.max(0, Math.min(1, ((U.wind ? U.wind.value : 1) - 1) / 1.5)); const night = Math.min(1, ENVR.strength.value / 0.8 || 0); D.barkU.wet.value = Math.max(night * 0.08, rain); /* dew is only a faint sheen; really wet only in the rain */ };
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      sh.uniforms.tdMoss = D.barkU.mossAmt; sh.uniforms.tdFoot = D.barkU.footDark; sh.uniforms.tdWet = D.barkU.wet; sh.uniforms.tdRimK = D.barkU.rimK;
      sh.uniforms.tdNrm = D.barkU.nrm; sh.uniforms.tdHao = D.barkU.hao; sh.uniforms.tdRelief = D.barkU.relief; sh.uniforms.tdScale = D.barkU.scale; sh.uniforms.tdCool = D.barkU.cool;
      sh.uniforms.tdRimC = ENVR.color; sh.uniforms.tdRimS = ENVR.strength; sh.uniforms.tdRimD = ENVR.dir;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;varying vec3 tdN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ntdP=(modelMatrix*vec4(transformed,1.)).xyz;tdN=normalize(mat3(modelMatrix)*objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
${MOBILE ? '#define TD_LITE' : ''}
varying vec3 tdP;varying vec3 tdN;uniform float tdMoss,tdFoot,tdWet,tdRimK,tdRimS;uniform vec3 tdRimC,tdRimD;float tdMM=0.,tdWM=0.,tdL=0.,tdFade=0.,tdH=.5;
uniform sampler2D tdNrm,tdHao;uniform float tdRelief,tdScale;
// triplanar in a frame: A = the way the furrows run (stretched), B and C across. Trunk: A=up, B=x, C=z (fixed world axes).
// Roots and limbs: A = outwards from the trunk (they radiate from it), B = up, C = the horizontal tangent.
float tdLf=0.;vec3 tdA=vec3(0.,1.,0.),tdB=vec3(1.,0.,0.),tdC=vec3(0.,0.,1.);
vec3 tdW(vec3 n,vec3 A,vec3 B,vec3 C){vec3 b=pow(abs(vec3(dot(n,B),dot(n,C),dot(n,A))),vec3(4.));return b/(b.x+b.y+b.z);}
vec4 tdS(sampler2D t,vec3 p,vec3 n,vec3 A,vec3 B,vec3 C,float s){vec3 w=tdW(n,A,B,C);float a=dot(p,A)*.8;
 return texture2D(t,vec2(dot(p,C),a)*s)*w.x+texture2D(t,vec2(dot(p,B),a)*s)*w.y+texture2D(t,vec2(dot(p,B),dot(p,C))*s)*w.z;}
vec3 tdSN(vec3 p,vec3 n,vec3 A,vec3 B,vec3 C,float s,float k){vec3 w=tdW(n,A,B,C);float a=dot(p,A)*.8;
 vec3 tx=texture2D(tdNrm,vec2(dot(p,C),a)*s).xyz*2.-1.,ty=texture2D(tdNrm,vec2(dot(p,B),a)*s).xyz*2.-1.,tz=texture2D(tdNrm,vec2(dot(p,B),dot(p,C))*s).xyz*2.-1.;
 return ((C*tx.x+A*tx.y)*w.x+(B*ty.x+A*ty.y)*w.y+(B*tz.x+C*tz.y)*w.z)*k;}
// both mappings, blended between the trunk and the roots / limbs
vec4 tdTri(sampler2D t,vec3 p,vec3 n,float s){vec4 a=vec4(0.),b=vec4(0.);
 if(tdLf<.99)a=tdS(t,p,n,vec3(0.,1.,0.),vec3(1.,0.,0.),vec3(0.,0.,1.),s);if(tdLf>.01)b=tdS(t,p,n,tdA,tdB,tdC,s);return mix(a,b,tdLf);}
vec3 tdTriN(vec3 p,vec3 n,float s,float k){vec3 a=vec3(0.),b=vec3(0.);
 if(tdLf<.99)a=tdSN(p,n,vec3(0.,1.,0.),vec3(1.,0.,0.),vec3(0.,0.,1.),s,k);if(tdLf>.01)b=tdSN(p,n,tdA,tdB,tdC,s,k);return mix(a,b,tdLf);}
uniform float tdCool;` + NOISE)
        .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wn=normalize(tdN); float y=tdP.y;
#ifdef USE_MAP
          // the sculpted model's own painted texture has long vertical streaks: keep only its broad colour (a blurred mip),
          // the bark detail comes from the relief below
          { vec4 mb=texture2D(map,vMapUv,5.);
            #ifdef TD_LITE
            float mute=.6;
#else
            float mute=.85;
#endif
            diffuseColor.rgb=diffuseColor.rgb/max(sampledDiffuseColor.rgb,vec3(.004))*mix(sampledDiffuseColor.rgb,mb.rgb,mute); }
#endif
          // ---- bark relief: light worn crust on the ridges, deep dark furrows, fibrous detail up close ----
          { vec2 rv=tdP.xz-vec2(${AX.toFixed(3)},${AZ.toFixed(3)}); float r=length(rv); vec3 rad=r>1e-3?vec3(rv.x/r,0.,rv.y/r):vec3(1.,0.,0.);
            // roots and limbs: furrows along them. Near the ground the roots run outwards; higher up the limbs rise a little as they go out.
            tdA=normalize(rad+vec3(0.,y>3.?.25:0.,0.)); tdC=vec3(-rad.z,0.,rad.x); tdB=normalize(cross(tdC,tdA));
            tdLf=smoothstep(2.5,3.7,r); }
          tdFade=1.-smoothstep(5.,16.,length(cameraPosition-tdP));
          // phones: one macro read and no close-up octave (GPU-bound at night); desktop: anti-tiling second read + micro detail up close
          vec4 hb=vec4(.5,1.,.5,1.);
#ifdef TD_LITE
          vec4 ha=tdTri(tdHao,tdP,wn,tdScale);
#else
          float brk=smoothstep(.3,.7,td_n(tdP*vec3(.45,.3,.45)+11.));
          vec4 ha=tdTri(tdHao,tdP,wn,tdScale);
          if(brk>.01)ha=mix(ha,tdTri(tdHao,tdP*1.37+vec3(3.1,1.7,5.3),wn,tdScale),brk);
          if(tdFade>.01)hb=tdTri(tdHao,tdP+7.3,wn,tdScale*3.3);
#endif
          tdH=ha.r;float cav=ha.g*mix(1.,.6+.4*hb.g,tdFade);
          float rel=tdRelief;
          diffuseColor.rgb*=mix(1.,mix(.55,1.15,smoothstep(.05,.95,tdH))*mix(.6,1.,cav),rel);
          diffuseColor.rgb*=mix(1.,.82+.36*hb.b,tdFade*rel);
          { float g=dot(diffuseColor.rgb,vec3(.33)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(g*1.05,g*1.03,g*1.0),smoothstep(.62,.92,tdH)*.35*rel);
            // the photo's oak is a cooler grey-brown than the warm model texture, with violet-blue in the furrows and shadows
            diffuseColor.rgb=mix(diffuseColor.rgb,g*vec3(1.08,.97,.9),.35*tdCool);
            diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.82,.8,1.05),vec3(1.),smoothstep(.15,.6,tdH)),tdCool); }
          vec2 ax=tdP.xz-vec2(${AX.toFixed(3)},${AZ.toFixed(3)}); float rd=length(ax);
          float lum=dot(diffuseColor.rgb,vec3(.3,.59,.11));
          // big soft patches + fine breakup
          float big=td_f(tdP*vec3(.55,.35,.55));
          float fine=td_f(tdP*3.1+vec3(0.,big*2.,0.));
          // damp foot: the bark gets darker, cooler and a little greener towards the ground (photo: the base sinks into the fog)
          float foot=1.-smoothstep(-.3,4.8,y+(big-.5)*1.2);
          float rootTop=smoothstep(.25,.75,wn.y)*smoothstep(1.9,3.2,rd);
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.34,.38,.42),foot*.9*tdFoot*(1.-rootTop*.65));
          // contact AO where the roots meet the ground, and under overhangs
          diffuseColor.rgb*=mix(1.,.55,(1.-smoothstep(-.35,.45,y))*tdFoot);
          diffuseColor.rgb*=mix(.72,1.,smoothstep(-.7,.15,wn.y));
          // moss: on surfaces facing up and to the back (shady side), heavy on the roots and the foot, on limb tops higher up
          float face=wn.y*.9+(-wn.z)*.35+(-wn.x)*.12;
          float zone=max(1.-smoothstep(.4,3.8,y),smoothstep(3.,5.,y)*.95)*(rd>1.8||y<2.?1.:.6);
          float mm=smoothstep(.18,.6,face+(big-.5)*.9+(fine-.5)*.35)*zone;
          mm*=smoothstep(.32,.55,big+zone*.25);
          mm*=1.-rootTop*.45;
          mm+=(1.-tdH)*.18*smoothstep(.05,.3,mm); // moss settles into the furrows first
          mm=clamp(mm*tdMoss,0.,1.)*(1.-clamp(vGlow*2.5,0.,1.));
          // linear colours: deep olive in the shade, a little brighter yellow-green where it catches light
          vec3 moss=mix(vec3(.030,.048,.014),vec3(.085,.125,.028),smoothstep(.3,.8,fine));
          moss=mix(moss,vec3(.028,.045,.035),foot*.5);
          diffuseColor.rgb=mix(diffuseColor.rgb,moss*(.7+2.*lum),mm*.9);
          // grey-green lichen spots on the drier upper bark
          float li=smoothstep(.74,.82,td_n(tdP*vec3(7.,4.,7.)+big*3.))*smoothstep(.55,.7,td_n(tdP*.9+5.))*smoothstep(1.,3.,y)*(1.-mm);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(lum*.9,lum*1.05,lum*.85)+vec3(.01,.015,.008),li*.35);
          // wet bark: darker, and glossy in the grooves' ridges (moss stays matte); streaks run down from the limbs
          float streak=td_n(vec3(tdP.x*2.2,tdP.y*.25,tdP.z*2.2));
          tdWM=tdWet*(1.-mm*.8)*(.55+.45*smoothstep(.3,.7,streak));
          diffuseColor.rgb*=1.-tdWM*.3;
          tdMM=mm;tdL=lum;
        }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 wn=normalize(tdN);
#ifdef TD_LITE
          vec3 dn=tdTriN(tdP,wn,tdScale,3.);
#else
          float brk=smoothstep(.3,.7,td_n(tdP*vec3(.45,.3,.45)+11.));
          vec3 dn=tdTriN(tdP,wn,tdScale,3.);
          if(brk>.01)dn=mix(dn,tdTriN(tdP*1.37+vec3(3.1,1.7,5.3),wn,tdScale,3.*1.37),brk);
          if(tdFade>.01)dn+=tdTriN(tdP+7.3,wn,tdScale*3.3,1.1)*tdFade;
#endif
          dn*=1.+.6*smoothstep(.45,.9,wn.y); // tops of the limbs: as rough as the sides
          vec3 nw=normalize(wn+dn*tdRelief*(1.-tdMM*.7));
          vec3 nv=normalize((viewMatrix*vec4(nw,0.)).xyz);
          normal=normalize(mix(normal,nv,.92));
        }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(max(roughnessFactor,.92),.32,tdWM); // dry bark is fully matte')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // moonlit rim from Environment (env.moonRim): a cold fresnel edge on the side facing the moon
          vec3 wn=normalize(tdN), wv=normalize(cameraPosition-tdP);
          float fr=pow(1.-max(dot(wn,wv),0.),3.);
          float rim=fr*max(dot(wn,normalize(tdRimD)),0.)*tdRimS*tdRimK*(1.-.7*smoothstep(.5,.9,wn.y)); // an edge light, not a sheen on the tops
          totalEmissiveRadiance+=tdRimC*rim*(.12+tdL*1.6)*(1.-tdMM*.5)*(1.+tdWM*.8);
        }`);
    };
    const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    mat.customProgramCacheKey = () => prevKey() + '|treedress5';
    mat.needsUpdate = true;
  }

  // ================= sampling the oak surface =================
  const T = TREE.tris; const nT = T.length / 9;
  const boxes = [];
  for (const im of blockers) {
    if (!im || !im.isInstancedMesh) continue;
    if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
    const m = new THREE.Matrix4(), b = new THREE.Box3();
    for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); b.copy(im.geometry.boundingBox).applyMatrix4(m); boxes.push([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]); }
  }
  const inBox = (list, x, y, z, p) => list.some(b => x > b[0] - p && x < b[1] + p && y > b[2] - p && y < b[3] + p && z > b[4] - p && z < b[5] + p);
  const blocked = (x, y, z, p = 0.1) => inBox(avoid, x, y, z, p + 0.15) || inBox(boxes, x, y, z, p);

  // triangle list with normal, area and centre
  const tri = [];
  {
    const a = V(), b = V(), c = V(), e1 = V(), e2 = V(), n = V();
    for (let t = 0; t < nT; t++) {
      a.fromArray(T, t * 9); b.fromArray(T, t * 9 + 3); c.fromArray(T, t * 9 + 6);
      e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2); const ar = n.length() / 2; if (ar < 1e-5) continue; n.normalize();
      tri.push({ t, ar, n: n.clone(), c: V((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3) });
    }
  }
  const pointOn = q => { const i = q.t * 9; let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; } return V(T[i] + (T[i + 3] - T[i]) * u + (T[i + 6] - T[i]) * v, T[i + 1] + (T[i + 4] - T[i + 1]) * u + (T[i + 7] - T[i + 1]) * v, T[i + 2] + (T[i + 5] - T[i + 2]) * u + (T[i + 8] - T[i + 2]) * v); };
  function sampler(filter) {
    const L = tri.filter(filter); let sum = 0; const cum = L.map(q => (sum += q.ar));
    return () => { if (!L.length) return null; const x = R() * sum; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } const q = L[lo]; return { p: pointOn(q), n: q.n }; };
  }
  const radial = (x, z) => Math.hypot(x - AX, z - AZ);
  const nearDoor = (x, y, z) => Math.abs(angDiff(Math.atan2(z - AZ, x - AX), doorAng)) < 0.5 && y < 4.8;
  const Q = new THREE.Quaternion(), M4 = new THREE.Matrix4(), S = V(), UP = V(0, 1, 0), col = new THREE.Color();
  const orient = (n, spin) => { Q.setFromUnitVectors(UP, n); return Q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin)); };

  // a random point on the top of a floor board, pushed towards one of its ends (world-space box of the instance)
  const _bb = new THREE.Box3();
  const boardPoint = (im, endMin, endMax, side) => {
    if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
    const i = Math.floor(R() * im.count); im.getMatrixAt(i, M4); _bb.copy(im.geometry.boundingBox).applyMatrix4(M4);
    const dx = _bb.max.x - _bb.min.x, dz = _bb.max.z - _bb.min.z, dy = _bb.max.y - _bb.min.y;
    if (dy > 0.2 || Math.max(dx, dz) < 0.3) return null;
    const e = (R() < 0.5 ? -1 : 1) * rr(endMin, endMax), w = rr(-side, side);
    const along = dx > dz; const cx = (_bb.min.x + _bb.max.x) / 2, cz = (_bb.min.z + _bb.max.z) / 2;
    return along ? V(cx + e * dx, _bb.max.y, cz + w * dz) : V(cx + w * dx, _bb.max.y, cz + e * dz);
  };
  // ================= 2. moss cushions on root tops and in limb forks =================
  {
    const g = (() => { const s = new THREE.IcosahedronGeometry(1, 2); s.deleteAttribute('normal'); s.deleteAttribute('uv'); const m = mergeVertices(s); const p = m.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.18 * Math.sin(x * 5.1 + z * 3.7) * Math.cos(z * 4.3 - y * 2); p.setXYZ(i, x * k, Math.max(y, -0.2) * k, z * k); }
      m.computeVertexNormals(); return m; })();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    mat.onBeforeCompile = sh => {
      branchHook(sh, AX, AZ);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ntdP=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;' + NOISE)
        .replace('#include <map_fragment>', '#include <map_fragment>\n{float f=td_f(tdP*14.);float g=td_n(tdP*55.);diffuseColor.rgb*=.62+.55*f+.25*(g-.5);diffuseColor.rgb*=mix(.6,1.,smoothstep(-.2,3.,tdP.y));}');
    };
    const NUP = Math.round(150 * MUL), N = NUP + Math.round(150 * MUL), im = new THREE.InstancedMesh(g, mat, N);
    const roots = sampler(q => q.n.y > 0.55 && q.c.y < 1.5 && q.c.y > -0.1 && radial(q.c.x, q.c.z) > 2.0);
    const limbs = sampler(q => q.n.y > 0.7 && q.c.y > 3.5 && q.c.y < 13 && radial(q.c.x, q.c.z) > 1.4);
    let n = 0;
    for (let k = 0; k < NUP * 4 && n < NUP; k++) {
      const s = (k % 3 === 2 ? limbs : roots)(); if (!s) continue;
      const { p } = s; if (blocked(p.x, p.y, p.z, 0.15) || nearDoor(p.x, p.y, p.z)) continue;
      // grow in small colonies: keep a sample only if the big moss noise is high here (matches the shader patches loosely)
      if (Math.sin(p.x * 1.3 + p.z * 0.9) + Math.sin(p.y * 1.7 - p.x * 0.6) < -0.3) continue;
      const sz = rr(0.09, 0.24) * (p.y > 3 ? 0.8 : 1);
      M4.compose(p.clone().addScaledVector(s.n, -sz * 0.15), orient(s.n, rr(0, 6.28)), S.set(sz * rr(1, 1.6), sz * rr(0.28, 0.45), sz * rr(0.8, 1.3)));
      im.setMatrixAt(n, M4);
      const v = rr(0.85, 1.15); col.setRGB(0.05 * v, 0.075 * v * rr(0.95, 1.08), 0.022 * v); im.setColorAt(n, col); n++;
    }
    // roofs: moss creeps over the shingles in a few patches, mostly low on the slope near the eaves and against the trunk
    const roofs = C.roofs; const qi = new THREE.Quaternion(), pi = V(), si = V(), nrm = V();
    if (roofs && roofs.isInstancedMesh) {
      const idx = [...Array(roofs.count).keys()];
      for (let k = 0; k < idx.length && n < NUP + Math.round(110 * MUL); k++) {
        const i = idx[Math.floor(R() * idx.length)]; roofs.getMatrixAt(i, M4); M4.decompose(pi, qi, si);
        nrm.set(0, 1, 0).applyQuaternion(qi); if (nrm.y < 0.3) continue;
        // patchy: a low-frequency mask in world space, denser on the back (shady, -z) half and near the trunk
        const patch = Math.sin(pi.x * 2.1 + pi.z * 1.3) + Math.sin(pi.z * 2.7 - pi.y * 1.9) + (pi.z < AZ + 1.6 ? 0.5 : -0.4) + (radial(pi.x, pi.z) < 3 ? 0.4 : 0);
        if (patch < 0.6 || R() < 0.35) continue;
        const p = pi.clone().addScaledVector(nrm, si.y * 0.5).add(V(rr(-0.08, 0.08), 0, rr(-0.08, 0.08)));
        const sz = rr(0.07, 0.15);
        M4.compose(p, orient(nrm, rr(0, 6.28)), S.set(sz * rr(1.2, 1.9), sz * 0.3, sz * rr(1, 1.4))); im.setMatrixAt(n, M4);
        const v = rr(0.8, 1.2); col.setRGB(0.055 * v, 0.08 * v, 0.025 * v); im.setColorAt(n++, col);
      }
    }
    // plank landings and the deck: moss along the back (north) edges and the board ends, where water stays longest
    const boardsIM = (C.blockers || [])[0];
    if (boardsIM && boardsIM.isInstancedMesh) {
      for (let k = 0; k < 4000 && n < N; k++) {
        const p = boardPoint(boardsIM, 0.3, 0.48, 0.45); if (!p) continue;
        if (inBox(avoid, p.x, p.y, p.z, 0.25) || inBox(avoid, p.x, p.y + 1.5, p.z, 0.25)) continue; // not inside the rooms
        if (p.z > AZ + 2.2 && R() < 0.8) continue; // mostly the back / trunk side
        if (Math.sin(p.x * 3.1 + p.z * 2.3) + Math.sin(p.z * 1.7 - p.x * 2.2) < 0.2) continue;
        if (R() < 0.55) continue; // only a thin creep of moss at the board ends
        const sz = rr(0.035, 0.07);
        M4.compose(p, orient(UP, rr(0, 6.28)), S.set(sz * rr(1.2, 2.0), sz * 0.22, sz * rr(0.8, 1.2))); im.setMatrixAt(n, M4);
        const v = rr(0.8, 1.2); col.setRGB(0.05 * v, 0.075 * v, 0.024 * v); im.setColorAt(n++, col);
      }
    }
    im.count = n; im.receiveShadow = true; D.group.add(im); D.moss = im;
  }

  // ================= 3. soil and leaf litter in the pockets between the roots =================
  {
    // pockets: ground spots right next to the wood (rootD small) close to the trunk, preferably hemmed in by roots on two sides
    const spots = [];
    for (let k = 0; k < 4000 && spots.length < 260 * MUL; k++) {
      const a = rr(0, Math.PI * 2), d = rr(1.8, 5.2), x = AX + Math.cos(a) * d, z = AZ + Math.sin(a) * d;
      const rd = rootD(x, z); if (rd < 0.04 || rd > 0.55) continue;
      // hemmed in: wood both clockwise and anticlockwise within ~0.9 m
      let hem = 0; for (const s of [-1, 1]) for (let j = 1; j <= 4; j++) { const b = a + s * j * 0.22 / d * 1.0; if (rootD(AX + Math.cos(b) * d, AZ + Math.sin(b) * d) < 0.03) { hem++; break; } }
      if (hem < 1 || (hem < 2 && R() < 0.6)) continue;
      const y = groundH(x, z); if (nearDoor(x, y + 0.3, z) && R() < 0.5) continue;
      spots.push([x, y, z, rd, a, d]);
    }
    // soil mounds: low dark humps half buried, so the roots look like they grow out of earth, not out of a flat floor
    const sg = (() => { const s = new THREE.IcosahedronGeometry(1, 2); s.deleteAttribute('normal'); s.deleteAttribute('uv'); const m = mergeVertices(s); m.computeVertexNormals(); return m; })();
    const smat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    smat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ntdP=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;' + NOISE)
        .replace('#include <map_fragment>', '#include <map_fragment>\n{float f=td_f(tdP*6.);float g=td_n(tdP*40.);diffuseColor.rgb*=.7+.5*f+.3*(g-.5);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.03,.045,.015),smoothstep(.55,.75,f)*.6);}');
    };
    const NS = Math.round(70 * MUL), soil = new THREE.InstancedMesh(sg, smat, NS); let ns = 0;
    for (const [x, y, z, rd, a] of spots) {
      if (ns >= NS) break; if (R() < 0.55) continue;
      const w = rr(0.35, 0.75) * (0.6 + rd);
      M4.compose(V(x, y - 0.06, z), new THREE.Quaternion().setFromAxisAngle(UP, -a + rr(-0.3, 0.3)), S.set(w * 0.6, rr(0.08, 0.16), w)); soil.setMatrixAt(ns, M4);
      const v = rr(0.8, 1.1); col.setRGB(0.04 * v, 0.03 * v, 0.02 * v); soil.setColorAt(ns, col); ns++;
    }
    soil.count = ns; soil.receiveShadow = true; D.group.add(soil); D.soil = soil;

    // fallen leaves: oak-leaf cards lying in the pockets, mostly brown and ochre, a few still green, some leaning on the roots
    const lg = new THREE.PlaneGeometry(1, 1); lg.rotateX(-Math.PI / 2);
    const lmat = new THREE.MeshStandardMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
    const NL = Math.round(420 * MUL), lit = new THREE.InstancedMesh(lg, lmat, NL); let nl = 0;
    const tints = [[0.62, 0.38, 0.2], [0.5, 0.3, 0.16], [0.75, 0.52, 0.22], [0.42, 0.3, 0.2], [0.55, 0.6, 0.3]];
    for (let k = 0; nl < NL && k < NL * 3; k++) {
      const s = spots[Math.floor(R() * spots.length)]; if (!s) break;
      const [x0, , z0, rd] = s; const x = x0 + rr(-0.35, 0.35), z = z0 + rr(-0.35, 0.35);
      const r2 = rootD(x, z); if (r2 < 0.0) continue;
      const lean = r2 < 0.12 ? rr(0.3, 0.8) : rr(0, 0.25), y = groundH(x, z) + 0.02 + (r2 < 0.12 ? rr(0.02, 0.12) : rr(0, 0.05));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-lean, lean), rr(0, 6.28), rr(-lean, lean)));
      M4.compose(V(x, y, z), q, S.setScalar(rr(0.17, 0.27))); lit.setMatrixAt(nl, M4);
      const c = tints[Math.floor(R() * tints.length)], v = rr(0.75, 1.1); col.setRGB(c[0] * v * 1.2, c[1] * v * 1.2, c[2] * v * 1.2); lit.setColorAt(nl, col); nl++;
    }
    lit.count = nl; lit.receiveShadow = true; D.group.add(lit); D.litter = lit; D.pockets = spots.length;
  }

  // ================= 4. ivy climbing the lower trunk =================
  {
    // trunk surface radius by (angle, height), read from the oak mesh
    const NA = 144, NY = 140, HY = 0.1, RS = new Float32Array(NA * NY);
    for (let i = 0; i < T.length; i += 3) {
      const x = T[i], y = T[i + 1], z = T[i + 2]; if (y < 0 || y >= NY * HY) continue; const d = radial(x, z); if (d > 4.8) continue;
      const ai = Math.floor(((Math.atan2(z - AZ, x - AX) + Math.PI) / (Math.PI * 2)) * NA) % NA, yi = Math.floor(y / HY);
      RS[yi * NA + ai] = Math.max(RS[yi * NA + ai], d);
    }
    // fill gaps
    for (let yi = 0; yi < NY; yi++) for (let ai = 0; ai < NA; ai++) if (!RS[yi * NA + ai]) { for (let s = 1; s < 8; s++) { const v = RS[yi * NA + (ai + s) % NA] || RS[yi * NA + (ai - s + NA) % NA] || (yi ? RS[(yi - 1) * NA + ai] : 0); if (v) { RS[yi * NA + ai] = v; break; } } }
    const surf = (a, y) => { const ai = Math.floor(((a + Math.PI * 3) % (Math.PI * 2)) / (Math.PI * 2) * NA) % NA, yi = Math.min(NY - 1, Math.max(0, Math.floor(y / HY))); let m = 0, c = 0; for (let s = -1; s <= 1; s++) for (let t = -1; t <= 1; t++) { const v = RS[Math.min(NY - 1, Math.max(0, yi + t)) * NA + (ai + s + NA) % NA]; if (v) { m += v; c++; } } return c ? m / c : 2; };

    // ivy leaf texture: dark glossy three-to-five lobed leaves with pale veins
    const ivyTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
      x.translate(64, 120);
      const lobe = (ang, len, w) => { x.save(); x.rotate(ang); x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(w, -len * 0.3, w * 0.9, -len * 0.8, 0, -len); x.bezierCurveTo(-w * 0.9, -len * 0.8, -w, -len * 0.3, 0, 0); x.fill(); x.restore(); };
      const gr = x.createLinearGradient(0, -110, 0, 0); gr.addColorStop(0, '#5c7a38'); gr.addColorStop(1, '#2c4420'); x.fillStyle = gr;
      lobe(0, 100, 34); lobe(-0.95, 70, 26); lobe(0.95, 70, 26); lobe(-1.75, 44, 18); lobe(1.75, 44, 18);
      x.strokeStyle = 'rgba(190,210,150,.55)'; x.lineWidth = 2.2; x.lineCap = 'round';
      for (const [a, l] of [[0, 88], [-0.95, 60], [0.95, 60], [-1.75, 36], [1.75, 36]]) { x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.sin(a) * l, -Math.cos(a) * l); x.stroke(); }
      x.fillStyle = '#4a3a22'; x.fillRect(-1.5, 0, 3, 8);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    })();
    const leafG = new THREE.PlaneGeometry(1, 1); leafG.translate(0, 0.5, 0);
    const imat = swayMat(onTree(new THREE.MeshStandardMaterial({ map: ivyTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xb8c4b0, emissive: 0x050c07, emissiveMap: ivyTex })), U, 0.05, FLUTTER);
    const NLV = Math.round(900 * MUL), leaves = new THREE.InstancedMesh(leafG, imat, NLV); let nl = 0;
    const stems = [];
    // a few vines: mostly on the sides and the back, one wandering across the front-left under the kitchen landing
    const vines = [[2.05, 4.6], [2.6, 3.4], [3.3, 5.6], [-2.4, 4.2], [-1.2, 3.0], [-0.35, 2.4], [0.25, 4.8]];
    const addLeaf = (p, out, size) => {
      if (nl >= NLV || blocked(p.x, p.y, p.z, 0.06)) return;
      const n = out.clone().add(V(rr(-0.35, 0.35), rr(0.05, 0.5), rr(-0.35, 0.35))).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rr(-0.9, 0.9)));
      M4.compose(p.clone().addScaledVector(out, 0.02), q, S.setScalar(size)); leaves.setMatrixAt(nl, M4);
      const v = rr(0.75, 1.2); col.setRGB(v * rr(0.9, 1.05), v, v * rr(0.85, 1)); if (R() < 0.08) col.setRGB(1.35, 1.1, 0.6); leaves.setColorAt(nl, col); nl++;
    };
    const climb = (a, y, top, depth) => {
      const pts = []; let wob = rr(0, 6);
      for (; y < top; y += 0.12) {
        a += Math.sin(y * 1.3 + wob) * 0.035 + rr(-0.02, 0.02);
        const r = surf(a, y) + 0.025, p = V(AX + Math.cos(a) * r, y, AZ + Math.sin(a) * r);
        if (pts.length && pts[pts.length - 1].distanceTo(p) > 0.45) break;
        if (nearDoor(p.x, p.y, p.z) || blocked(p.x, p.y, p.z, 0.04)) break;
        pts.push(p);
        const out = V(Math.cos(a), 0, Math.sin(a));
        // leaves in pairs along the stem, bigger and denser low down, thinning towards the tip
        const thin = 1 - (y - pts[0].y) / Math.max(0.5, top - pts[0].y);
        const side = V(-Math.sin(a), 0, Math.cos(a));
        if (R() < 0.55 + 0.35 * thin) addLeaf(p.clone().addScaledVector(side, rr(0.03, 0.09)), out, rr(0.12, 0.19) * (0.7 + 0.5 * thin));
        if (R() < 0.45 + 0.35 * thin) addLeaf(p.clone().addScaledVector(side, -rr(0.03, 0.09)), out, rr(0.12, 0.19) * (0.7 + 0.5 * thin));
        if (depth < 1 && R() < 0.05) climb(a + (R() < 0.5 ? -1 : 1) * 0.15, y + 0.1, Math.min(top, y + rr(0.6, 1.4)), depth + 1);
      }
      if (pts.length > 2) stems.push({ pts, r: depth ? 0.009 : 0.016 });
      D.vineLen = (D.vineLen || []).concat([[+a.toFixed(2), pts.length ? +pts[0].y.toFixed(1) : -1, +y.toFixed(1)]]);
    };
    for (const [a0, top] of vines) { const a = a0 + rr(-0.1, 0.1); let y = 0.1; while (y < 1.6 && surf(a, y) > 3.0) y += 0.1; climb(a, y, top * (MOBILE ? 0.9 : 1), 0); }
    // higher up: short vines on the trunk between the rooms (they start in a free gap and stop at the next floor or wall)
    {
      let made = 0;
      for (let k = 0; k < 400 && made < (MOBILE ? 5 : 9); k++) {
        const a = k % 3 ? rr(0.5, 2.5) : rr(-Math.PI, Math.PI), y = rr(3.8, 11.5), r = surf(a, y); // mostly the front half, where it shows between the rooms
        if (r > 2.6) continue; const p = V(AX + Math.cos(a) * r, y, AZ + Math.sin(a) * r);
        if (blocked(p.x, p.y, p.z, 0.2) || blocked(p.x, p.y + 0.6, p.z, 0.1)) continue;
        const before = stems.length; climb(a, y, y + rr(1.2, 2.6), 0); if (stems.length > before && stems[stems.length - 1].pts.length > 6) { made++; (D.upperAt = D.upperAt || []).push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), stems[stems.length - 1].pts.length]); }
      }
      D.upperVines = made;
    }
    // hanging ivy: strands dropping from the beams under the landings and the deck
    const beamsIM = (C.blockers || [])[1];
    if (beamsIM && beamsIM.isInstancedMesh) {
      if (!beamsIM.geometry.boundingBox) beamsIM.geometry.computeBoundingBox();
      const cand = []; const bb = new THREE.Box3();
      for (let i = 0; i < beamsIM.count; i++) {
        beamsIM.getMatrixAt(i, M4); bb.copy(beamsIM.geometry.boundingBox).applyMatrix4(M4);
        const dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z, dy = bb.max.y - bb.min.y;
        if (dy > 0.45 || Math.max(dx, dz) < 0.7 || bb.max.y < 1.5) continue;
        const c = bb.getCenter(V()); if (inBox(avoid, c.x, c.y, c.z, 0.1)) continue;
        cand.push(bb.clone());
      }
      let strands = 0;
      for (let k = 0; k < 120 && strands < (MOBILE ? 10 : 18) && cand.length; k++) {
        const b = cand[Math.floor(R() * cand.length)];
        const x = rr(b.min.x, b.max.x), z = rr(b.min.z, b.max.z), y0 = b.min.y - 0.01;
        if (z < AZ && R() < 0.6) continue;
        const L = rr(0.3, 1.1), pts = []; let ok = true;
        const bend = V(rr(-0.15, 0.15), 0, rr(-0.05, 0.2));
        for (let t = 0; t <= 1.0001; t += 0.1) { const p = V(x, y0 - t * L, z).addScaledVector(bend, t * t); if (t > 0.15 && blocked(p.x, p.y, p.z, 0.02)) { ok = false; break; } pts.push(p); }
        if (!ok || pts.length < 4) continue;
        stems.push({ pts, r: 0.007 }); strands++; (D.strandAt = D.strandAt || []).push([+x.toFixed(1), +y0.toFixed(1), +z.toFixed(1)]);
        for (let j = 1; j < pts.length; j++) {
          const p = pts[j]; const out = V(rr(-1, 1), rr(-0.2, 0.3), rr(0.2, 1)).normalize();
          if (R() < 0.8) addLeaf(p.clone().add(V(rr(-0.05, 0.05), 0, rr(-0.05, 0.05))), out, rr(0.09, 0.15) * (1.1 - j / pts.length * 0.4));
          if (R() < 0.4) addLeaf(p.clone().add(V(rr(-0.06, 0.06), 0, rr(-0.06, 0.06))), out.clone().negate().setY(0.2).normalize(), rr(0.08, 0.13));
        }
      }
      D.strands = strands;
    }
    leaves.count = nl; leaves.receiveShadow = true; leaves.castShadow = !MOBILE; D.group.add(leaves); D.ivy = leaves;
    const sgs = stems.map(s => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s.pts), Math.max(4, s.pts.length * 2), s.r, 4, false));
    if (sgs.length) { const sm = new THREE.Mesh(mergeGeometries(sgs), new THREE.MeshStandardMaterial({ color: 0x3a3424, roughness: 0.9 })); sm.receiveShadow = true; D.group.add(sm); D.ivyStems = sm; }
  }

  // ================= 5. ferns and grass tufts in root crevices and forks =================
  {
    const fernTex = (() => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d');
      x.strokeStyle = '#3d5a2a'; x.lineWidth = 3; x.beginPath(); x.moveTo(32, 256); x.lineTo(32, 4); x.stroke();
      for (let y = 244; y > 8; y -= 9) {
        const t = 1 - y / 256, w = 28 * Math.sin(Math.min(1, (1 - t) * 1.2) * Math.PI * 0.5 + 0.2) * (1 - t * 0.6);
        const g = x.createLinearGradient(0, y, 0, y - 10); g.addColorStop(0, '#30512a'); g.addColorStop(1, t > 0.7 ? '#6f9448' : '#4c7536'); x.fillStyle = g;
        for (const s of [-1, 1]) { x.beginPath(); x.moveTo(32, y); x.quadraticCurveTo(32 + s * w * 0.6, y - 9, 32 + s * w, y - 4); x.quadraticCurveTo(32 + s * w * 0.5, y + 2, 32, y + 3); x.fill(); }
      }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    // one fern = 7 arched fronds (a bent strip each); uv.y = how far along the frond (for the sway)
    const fernG = (() => {
      const parts = [];
      for (let f = 0; f < 7; f++) {
        const g = new THREE.PlaneGeometry(0.16, 1, 1, 8); const p = g.attributes.position; const a = f / 7 * Math.PI * 2 + (f % 2) * 0.3, L = 0.75 + (f % 3) * 0.12, tilt = 0.55 + (f % 2) * 0.25;
        for (let i = 0; i < p.count; i++) {
          const t = p.getY(i) + 0.5, w = p.getX(i);
          const out = Math.sin(tilt) * t * L, up = Math.cos(tilt) * t * L * 1.2 - t * t * 0.45 * L;
          const fold = Math.abs(w) * 0.5;
          p.setXYZ(i, Math.cos(a) * out - Math.sin(a) * w, up + fold, Math.sin(a) * out + Math.cos(a) * w);
        }
        g.computeVertexNormals(); parts.push(g);
      }
      return mergeGeometries(parts);
    })();
    const fmat = swayMat(onTree(new THREE.MeshStandardMaterial({ map: fernTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, emissive: 0x0a1a12, emissiveMap: fernTex })), U, 0.06,
      `{vec3 ip=vec3(instanceMatrix[3][0],0.,instanceMatrix[3][2]);float k=clamp(uv.y,0.,1.);k*=k;float gust=.6+.4*sin(uT*.35+ip.x*.05);
       transformed.x+=sin(uT*1.6+ip.x*.7+ip.z*.4)*SW*k*uW*gust;transformed.z+=sin(uT*1.2+ip.z*.9)*SW*.7*k*uW*gust;}`);
    // grass tuft: a fan of narrow curved blades
    const tuftG = (() => {
      const parts = [];
      for (let b = 0; b < 9; b++) {
        const g = new THREE.PlaneGeometry(0.035, 1, 1, 4); const p = g.attributes.position; const a = b / 9 * Math.PI * 2 + b * 0.7, L = 0.28 + (b % 4) * 0.07, lean = 0.25 + (b % 3) * 0.15;
        for (let i = 0; i < p.count; i++) { const t = p.getY(i) + 0.5, w = p.getX(i) * (1 - t * 0.85); const out = lean * t * t * L; p.setXYZ(i, Math.cos(a) * out - Math.sin(a) * w, t * L, Math.sin(a) * out + Math.cos(a) * w); }
        g.computeVertexNormals(); parts.push(g);
      }
      return mergeGeometries(parts);
    })();
    const tmat = swayMat(new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 }), U, 0.05,
      `{vec3 ip=vec3(instanceMatrix[3][0],0.,instanceMatrix[3][2]);float k=clamp(position.y/.5,0.,1.);k*=k;transformed.x+=sin(uT*2.+ip.x*1.7+ip.z)*SW*k*uW;transformed.z+=sin(uT*1.5+ip.z*1.9)*SW*.6*k*uW;}`);
    tmat.onBeforeCompile = (prev => (s, r) => { prev(s, r); s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb*=mix(.35,1.15,tdH);'); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float tdH;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntdH=clamp(position.y/.45,0.,1.);'); s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float tdH;'); })(tmat.onBeforeCompile);

    const NF = Math.round(26 * MUL), NFK = Math.round(14 * MUL), NF2 = NF + NFK, NTF = Math.round(110 * MUL);
    const ferns = new THREE.InstancedMesh(fernG, fmat, NF2), tufts = new THREE.InstancedMesh(tuftG, tmat, NTF);
    let nf = 0, nt = 0;
    // crevices: where two roots meet the trunk foot (ground just next to wood, close to the axis)
    const crev = [];
    for (let k = 0; k < 3000 && crev.length < 120; k++) {
      const a = rr(0, Math.PI * 2), d = rr(2.0, 4.6), x = AX + Math.cos(a) * d, z = AZ + Math.sin(a) * d, rd = rootD(x, z);
      if (rd < 0.05 || rd > 0.4) continue; const y = groundH(x, z); if (blocked(x, y + 0.4, z, 0.1) || nearDoor(x, y + 0.3, z)) continue; crev.push(V(x, y, z));
    }
    // forks and limb tops above the ground, where a little soil collects
    const forks = sampler(q => q.n.y > 0.8 && q.c.y > 4 && q.c.y < 12 && radial(q.c.x, q.c.z) > 1.3 && radial(q.c.x, q.c.z) < 5);
    const rootTops = sampler(q => q.n.y > 0.6 && q.c.y > 0.15 && q.c.y < 1.2 && radial(q.c.x, q.c.z) > 2.6);
    for (const p of crev) {
      if (nf < NF * 0.75 && R() < 0.3) { M4.compose(p, new THREE.Quaternion().setFromAxisAngle(UP, rr(0, 6.28)), S.setScalar(rr(0.45, 0.8))); ferns.setMatrixAt(nf, M4); const v = rr(0.75, 1.1); ferns.setColorAt(nf++, col.setRGB(v, v, v)); }
      else if (nt < NTF * 0.6) { M4.compose(p, new THREE.Quaternion().setFromAxisAngle(UP, rr(0, 6.28)), S.setScalar(rr(0.7, 1.3))); tufts.setMatrixAt(nt, M4); const v = rr(0.8, 1.1); tufts.setColorAt(nt++, col.setRGB(0.1 * v, 0.17 * v, 0.06 * v)); }
    }
    for (let k = 0; k < 400 && (nf < NF || nt < NTF); k++) {
      const top = k % 2 ? forks() : rootTops(); if (!top) continue; const p = top.p;
      if (blocked(p.x, p.y + 0.3, p.z, 0.25) || nearDoor(p.x, p.y, p.z)) continue;
      const q = orient(top.n.clone().lerp(UP, 0.6).normalize(), rr(0, 6.28));
      if (k % 2 && nf < NF && R() < 0.5) { M4.compose(p.clone().addScaledVector(top.n, -0.02), q, S.setScalar(rr(0.3, 0.5))); ferns.setMatrixAt(nf, M4); ferns.setColorAt(nf++, col.setRGB(0.95, 0.95, 0.95)); }
      else if (nt < NTF) { M4.compose(p.clone().addScaledVector(top.n, -0.02), q, S.setScalar(rr(0.45, 0.85))); tufts.setMatrixAt(nt, M4); const v = rr(0.8, 1.1); tufts.setColorAt(nt++, col.setRGB(0.1 * v, 0.17 * v, 0.06 * v)); }
    }
    // forks of the big branches: where a limb leaves the trunk or splits, a little soil gathers and ferns sprout
    // column grid: for each 0.25 m xz cell, the wood heights (tri centres) above 4 m, to tell a fork from a plain limb top
    const CG = new Map(); for (const q of tri) { if (q.c.y < 4.5) continue; const key = Math.round(q.c.x * 4) + ',' + Math.round(q.c.z * 4); let l = CG.get(key); if (!l) CG.set(key, l = []); l.push(q.c.y); }
    const colTop = (x, z, y) => { const l = CG.get(Math.round(x * 4) + ',' + Math.round(z * 4)); if (!l) return -99; let best = -99; for (const h of l) if (h > y + 0.15 && h < y + 0.8) best = Math.max(best, h); return best; };
    const highForks = sampler(q => q.n.y > 0.75 && q.c.y > 5 && q.c.y < 16 && radial(q.c.x, q.c.z) > 1.2 && radial(q.c.x, q.c.z) < 6.5);
    for (let k = 0; k < 600 && nf < NF2; k++) {
      const s0 = highForks(); if (!s0) break; const p = s0.p;
      if (blocked(p.x, p.y + 0.3, p.z, 0.3)) continue;
      // a fork: wood rises again close by on at least one side (the surface curves up around this spot)
      let walls = 0; for (const [dx, dz] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) { const hs = colTop(p.x + dx, p.z + dz, p.y); if (hs > p.y + 0.15 && hs < p.y + 0.8) walls++; }
      if (walls < 2) continue;
      M4.compose(p.clone().addScaledVector(s0.n, -0.03), orient(s0.n.clone().lerp(UP, 0.7).normalize(), rr(0, 6.28)), S.setScalar(rr(0.3, 0.5))); ferns.setMatrixAt(nf, M4); ferns.setColorAt(nf++, col.setRGB(0.95, 0.95, 0.95));
      D.forkFerns = (D.forkFerns || 0) + 1;
    }
    ferns.count = nf; tufts.count = nt; ferns.receiveShadow = tufts.receiveShadow = true; D.group.add(ferns, tufts); D.ferns = ferns; D.tufts = tufts;
  }

  // ================= 6. mushrooms on the wood: bracket fungi on the trunk foot, little caps on the roots =================
  {
    const env = C.env || window.__env || {}; const glowU = env.shroomGlow || { value: 0 };
    const paint = (g, f) => { const p = g.attributes.position; const c = new Float32Array(p.count * 3), a = new Float32Array(p.count); for (let i = 0; i < p.count; i++) { const r = f(p.getX(i), p.getY(i), p.getZ(i)); c.set(r[0], i * 3); a[i] = r[1]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aCap', new THREE.BufferAttribute(a, 1)); return g.toNonIndexed(); };
    // small cap: stem + domed cap with darker gills, local +y up, about 1 unit tall
    const cap = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.6, 1).translate(0, 0.9, 0);
    const gill = new THREE.CircleGeometry(0.97, 12).rotateX(Math.PI / 2).translate(0, 0.9, 0);
    const stem = new THREE.CylinderGeometry(0.2, 0.3, 0.95, 7, 2).translate(0, 0.47, 0);
    const smallG = mergeGeometries([paint(stem, () => [[0.8, 0.76, 0.66], 0]), paint(gill, () => [[0.5, 0.4, 0.32], 0.1]), paint(cap, (x, y) => { const k = smooth(0.9, 1.45, y); return [[0.55 + k * 0.3, 0.3 + k * 0.12, 0.18 + k * 0.05], smooth(0.95, 1.4, y) * 0.8]; })]);
    // bracket (shelf) fungus: a thick half-disc sticking out of the bark along local +z, pale rim, brown banded top
    const br = new THREE.SphereGeometry(1, 14, 6, -Math.PI / 2, Math.PI, 0, Math.PI * 0.5).scale(1, 0.32, 0.85);
    const brU = new THREE.CircleGeometry(1, 14, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 1, 0.85);
    const bracketG = mergeGeometries([paint(br, (x, y, z) => { const r = Math.hypot(x, z / 0.85); const band = 0.5 + 0.5 * Math.sin(r * 22); const k = smooth(0.7, 1, r); return [[0.36 + band * 0.08 + k * 0.4, 0.25 + band * 0.05 + k * 0.32, 0.16 + band * 0.03 + k * 0.22], 0]; }), paint(brU, () => [[0.72, 0.64, 0.5], 0])]);
    const mk = () => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }); m.onBeforeCompile = sh => { sh.uniforms.uGlow = glowU; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCap;varying float vCap;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCap=aCap;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;varying float vCap;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.5,.2)*vCap*uGlow;'); }; return m; };
    const NSM = Math.round(48 * MUL), NBR = Math.round(16 * MUL);
    const small = new THREE.InstancedMesh(smallG, mk(), NSM), brk = new THREE.InstancedMesh(bracketG, mk(), NBR);
    // small caps: clusters on the tops and flanks of the roots
    const onRoots = sampler(q => q.n.y > 0.35 && q.c.y > 0.05 && q.c.y < 1.1 && radial(q.c.x, q.c.z) > 2.4);
    let ns = 0;
    for (let k = 0; k < 200 && ns < NSM; k++) {
      const s0 = onRoots(); if (!s0) break; const p0 = s0.p; if (p0.z < AZ - 0.5 && R() < 0.75) continue; if (blocked(p0.x, p0.y + 0.2, p0.z, 0.1) || nearDoor(p0.x, p0.y, p0.z)) continue;
      const cnt = 2 + Math.floor(R() * 4);
      for (let j = 0; j < cnt && ns < NSM; j++) {
        const p = p0.clone().add(V(rr(-0.12, 0.12), 0, rr(-0.12, 0.12))); p.addScaledVector(s0.n, -0.01);
        const up = s0.n.clone().lerp(UP, 0.65).normalize(); const sz = rr(0.025, 0.06) * (j === 0 ? 1.35 : 1);
        M4.compose(p, orient(up, rr(0, 6.28)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.25, 0.25), 0, rr(-0.25, 0.25)))), S.set(sz, sz * rr(0.9, 1.5), sz));
        small.setMatrixAt(ns, M4); col.setHSL(rr(0.03, 0.08), rr(0.45, 0.75), rr(0.55, 0.75)); small.setColorAt(ns++, col);
      }
    }
    // bracket fungi: stacked shelves on steep bark low on the trunk, mostly on the shady sides
    const onTrunk = sampler(q => Math.abs(q.n.y) < 0.3 && q.c.y > 0.5 && q.c.y < 3.4 && radial(q.c.x, q.c.z) < 3.6);
    let nb = 0;
    for (let k = 0; k < 300 && nb < NBR; k++) {
      const s0 = onTrunk(); if (!s0) break; const p0 = s0.p; if (s0.n.z < -0.3 && R() < 0.7) continue; // mostly on the sides and front-sides, where they are seen
      if (blocked(p0.x, p0.y, p0.z, 0.25) || nearDoor(p0.x, p0.y, p0.z)) continue;
      const out = V(s0.n.x, 0, s0.n.z).normalize(); const yaw = Math.atan2(out.x, out.z); const cnt = 1 + Math.floor(R() * 3);
      for (let j = 0; j < cnt && nb < NBR; j++) {
        const sz = rr(0.09, 0.17) * (1 - j * 0.2); const p = p0.clone().add(V(0, j * rr(0.09, 0.14), 0)).addScaledVector(out, -sz * 0.15);
        M4.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.1, 0.05), yaw + rr(-0.3, 0.3), rr(-0.15, 0.15), 'YXZ')), S.setScalar(sz));
        brk.setMatrixAt(nb, M4); const v = rr(0.8, 1.1); brk.setColorAt(nb++, col.setRGB(v, v * rr(0.95, 1.02), v * rr(0.9, 1)));
      }
    }
    small.count = ns; brk.count = nb; small.receiveShadow = brk.receiveShadow = true; brk.castShadow = !MOBILE; D.group.add(small, brk); D.shrooms = small; D.brackets = brk;
  }

  // ================= 7. hanging moss and lichen strands under the lower limbs (sway like ropes: wind.js windRope) =================
  {
    const tex = (() => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d'); const r = rng(99);
      for (let i = 0; i < 46; i++) {
        const x0 = 32 + (r() + r() - 1) * 22, len = 80 + r() * 170, w = 0.8 + r() * 1.6; const c = 120 + r() * 60;
        x.strokeStyle = `rgba(${c * 0.82 | 0},${c | 0},${c * 0.72 | 0},${0.65 + r() * 0.35})`; x.lineWidth = w; x.beginPath(); x.moveTo(x0, 0);
        let px = x0; for (let y = 8; y < len; y += 8) { px += (r() - 0.5) * 3 - (px - 32) * 0.02 * (y / 256); x.lineTo(px, y); } x.stroke();
        // little tufts along the strand
        for (let y = 20; y < len; y += 14 + r() * 20) { x.fillStyle = x.strokeStyle; x.beginPath(); x.ellipse(x0 + (r() - 0.5) * 6, y, 1.5 + r() * 2, 3 + r() * 3, 0, 0, 6.28); x.fill(); }
      }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    // two crossed cards, top at y=0 hanging down to y=-1 (uv.y 1 at the top)
    const a = new THREE.PlaneGeometry(1, 1, 2, 6).translate(0, -0.5, 0);
    { const q = a.attributes.position; for (let i = 0; i < q.count; i++) { const t = -q.getY(i); q.setX(i, q.getX(i) * (1 - 0.75 * t)); } }
    const b = a.clone().rotateY(Math.PI / 2);
    const g = mergeGeometries([a, b]);
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; // averaged mips turned the strands into solid strips far away
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xa8b296 });
    mat.onBeforeCompile = sh => {
      const W = window.__wind; if (!W) return; W.hook(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);float len=length(instanceMatrix[1].xyz);float t=clamp(-position.y,0.,1.);
       vec3 off=windRope(ip,t,len)*3.5+windBranch(ip,vec2(${AX.toFixed(3)},${AZ.toFixed(3)}));
       transformed+=windLocal(off);}`);
    };
    const N = Math.round(45 * MUL), im = new THREE.InstancedMesh(g, mat, N); let n = 0;
    const under = sampler(q => q.n.y < -0.35 && q.c.y > 3.6 && q.c.y < 10.5 && radial(q.c.x, q.c.z) > 2.2);
    for (let k = 0; k < 600 && n < N; k++) {
      const s0 = under(); if (!s0) break; const p0 = s0.p;
      if (blocked(p0.x, p0.y - 0.3, p0.z, 0.2)) continue;
      const cnt = 2 + Math.floor(R() * 4);
      for (let j = 0; j < cnt && n < N; j++) {
        const p = p0.clone().add(V(rr(-0.25, 0.25), 0.03, rr(-0.25, 0.25))); const len = rr(0.25, 0.9) * (j === 0 ? 1.2 : 1), w = rr(0.12, 0.22);
        if (blocked(p.x, p.y - len, p.z, 0.1)) continue;
        M4.compose(p, new THREE.Quaternion().setFromAxisAngle(UP, rr(0, 3.14)), S.set(w, len, w)); im.setMatrixAt(n, M4);
        const v = rr(0.8, 1.15); im.setColorAt(n++, col.setRGB(v, v * rr(0.98, 1.05), v * rr(0.9, 1)));
      }
    }
    im.count = n; im.receiveShadow = true; D.group.add(im); D.hanging = im;
  }

  // ================= 8. little piles of fallen oak leaves on the landings and the deck =================
  // Same leaf and palette as Ground's fallen leaves (ground.js), so the boards and the forest floor match.
  // Only in corners and along the trunk / board ends, never on the hero's walking lines (read from the hero's walk graph
  // once it exists, so this is placed lazily on the first frames).
  {
    const GL = window.__ground && window.__ground.leaves;
    const boardsIM = (C.blockers || [])[0];
    D.boardLeaves = null;
    D.placeBoardLeaves = () => {
      const dbg = window.__dbg; if (D.boardLeaves || !GL || !boardsIM || !dbg || !dbg.N || !dbg.E) return false;
      const N = dbg.N, E = dbg.E;
      const segs = E.map(e => [N[e[0]] && N[e[0]].p, N[e[1]] && N[e[1]].p]).filter(q => q[0] && q[1]);
      const pathD = p => { let best = 99; for (const [a, b] of segs) { if (Math.min(Math.abs(p.y - a.y), Math.abs(p.y - b.y)) > 0.7) continue; const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz; let t = L ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / L : 0; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)); } return best; };
      const NL = Math.round(150 * MUL), im = new THREE.InstancedMesh(GL.geometry, GL.material, NL); let n = 0, piles = 0;
      const pal = [[.07, .7, .36], [.04, .65, .3], [.1, .65, .4], [.16, .45, .32], [.02, .55, .26], [.12, .4, .26]];
      const qi = new THREE.Quaternion(), pi = V(), si = V(), nrm = V(), centres = [];
      for (let k = 0; k < 3000 && n < NL && piles < (MOBILE ? 7 : 12); k++) {
        const rej = D.rej = D.rej || { up: 0, room: 0, path: 0, near: 0 };
        const p = boardPoint(boardsIM, 0.32, 0.45, 0.3); if (!p) { rej.up++; continue; }
        if (inBox(avoid, p.x, p.y, p.z, 0.2) || inBox(avoid, p.x, p.y + 1.5, p.z, 0.25)) { rej.room++; continue; } // the room volumes start above their floors
        if (pathD(p) < 0.6) { rej.path++; continue; }
        if (centres.some(c => c.distanceTo(p) < 0.9)) { rej.near++; continue; }
        // wind leaves them against something: the trunk, or a board end at the landing's rim
        const nearTrunk = radial(p.x, p.z) < 2.8; if (!nearTrunk && R() < 0.4) continue;
        centres.push(p); piles++;
        const cnt = 7 + Math.floor(R() * 9), rad = rr(0.12, 0.22);
        for (let j = 0; j < cnt && n < NL; j++) {
          const a = rr(0, 6.28), d = Math.sqrt(R()) * rad, h = (1 - d / rad) * 0.035 + rr(0, 0.008);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.35, 0.35), rr(0, 6.28), rr(-0.35, 0.35)));
          const sz = rr(0.08, 0.13); M4.compose(V(p.x + Math.cos(a) * d, p.y + 0.004 + h, p.z + Math.sin(a) * d), q, S.set(sz, sz, sz * 1.15)); im.setMatrixAt(n, M4);
          const c = pal[Math.floor(R() * pal.length)]; col.setHSL(c[0] + rr(-0.02, 0.02), c[1], c[2] + rr(-0.05, 0.05)); im.setColorAt(n++, col);
        }
      }
      im.count = n; im.receiveShadow = true; D.group.add(im); D.boardLeaves = im; D.boardPiles = piles; D.pileAt = centres.map(c => c.toArray().map(v => +v.toFixed(2))); return true;
    };
  }

  // keep the bark's wet/rim uniforms in step with the time of day and the rain, without touching the main loop
  { const prev = TREE.bark.onBeforeRender; TREE.bark.onBeforeRender = function (...a) { D.update(); if (!D.boardLeaves && D.placeBoardLeaves) D.placeBoardLeaves(); if (prev) prev.apply(this, a); }; }

  D.stats = () => ({ moss: D.moss.count, soil: D.soil.count, litter: D.litter.count, ivy: D.ivy.count, hanging: D.hanging.count, boardPiles: D.boardPiles, upperVines: D.upperVines, strands: D.strands, forkFerns: D.forkFerns, ferns: D.ferns.count, shrooms: D.shrooms.count, brackets: D.brackets.count, wet: +D.barkU.wet.value.toFixed(2), tufts: D.tufts.count, pockets: D.pockets });
  return D;
}
