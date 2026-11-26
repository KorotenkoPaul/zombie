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
float td_f(vec3 p){return td_n(p)*.55+td_n(p*2.13+3.1)*.3+td_n(p*4.37+7.7)*.15;}
// td_n with its analytic gradient (xyz): a bump from this is smooth per pixel (a screen-derivative bump is constant per 2x2 quad)
vec4 td_nd(vec3 x){vec3 i=floor(x),f=fract(x),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
 float a=td_h(i),b=td_h(i+vec3(1,0,0)),c=td_h(i+vec3(0,1,0)),d=td_h(i+vec3(1,1,0)),e=td_h(i+vec3(0,0,1)),g=td_h(i+vec3(1,0,1)),h=td_h(i+vec3(0,1,1)),k=td_h(i+vec3(1,1,1));
 float k1=b-a,k2=c-a,k3=e-a,k4=a-b-c+d,k5=a-c-e+h,k6=a-b-e+g,k7=-a+b+c-d+e-g-h+k;
 return vec4(a+k1*u.x+k2*u.y+k3*u.z+k4*u.x*u.y+k5*u.y*u.z+k6*u.z*u.x+k7*u.x*u.y*u.z,
  du*vec3(k1+k4*u.y+k6*u.z+k7*u.y*u.z,k2+k5*u.z+k4*u.x+k7*u.z*u.x,k3+k6*u.x+k5*u.y+k7*u.x*u.y));}`;

// leaf flutter for instanced cards: small rotation-ish wobble growing with distance from the stem (uv.y)
// ivy leaves: tip flutter driven by Wind (wind.js windSway: ~.1 calm, ~.4 breeze, ~2 in a gust), so gusts visibly ruffle them
const FLUTTER = `{vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);
 float k=clamp(uv.y,0.,1.)*SW;
#ifdef WIND_GLSL_ON
 vec2 w=windSway(ip,2.6);
 transformed+=windLocal(vec3(w.x,0.,w.y))*k*.6+windLocal(vec3(0.,0.,1.))*sin(uT*7.3+ip.x*13.1+ip.y*7.7)*k*.04*length(w);
#else
 transformed.z+=sin(uT*2.3+ip.x*3.1+ip.y*2.7)*k*uW;
#endif
}`;
// [rain round] ivy and ferns get wet with the bark (D.barkU.wet / damp), see swayMat
const tdWetU = m => { m.userData.wetU = tdWetU.U; return m; };
function swayMat(mat, U, amp, chunk) {
  mat.onBeforeCompile = s => {
    if (mat.userData.AX !== undefined) branchHook(s, mat.userData.AX, mat.userData.AZ);
    else if (mat.userData.wind && window.__wind && !s.vertexShader.includes('windSway')) window.__wind.hook(s); /* [wind round] ground things read Wind's gusts too */
    s.uniforms.uT = U.t; s.uniforms.uW = U.wind;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT,uW;' + (s.vertexShader.includes('windSway') ? '\n#define WIND_GLSL_ON' : ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{const float SW=${amp.toFixed(3)};${chunk}}`);
    // [rain round] leaves on the oak get wet with the bark (same uniforms): a touch darker while soaked, and a glisten (lower
    // roughness) while the rain is falling. Arithmetic only, no texture reads.
    const WU = mat.userData.wetU; if (WU) { s.uniforms.tdWet = WU.wet; s.uniforms.tdDamp = WU.damp;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float tdWet,tdDamp;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=1.-.2*tdDamp;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.32,tdWet*.85);'); }
  };
  // SHADERS rule: an explicit key. The default (the hook's source text) is the same for every swayMat, so the ivy and the
  // ferns could share one compiled program with the other's sway chunk
  const key = 'tdSway|' + amp.toFixed(3) + '|' + chunk + (mat.userData.wetU ? '|tdWet1' : '');
  mat.customProgramCacheKey = () => key;
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
  // [determinism] the house boards are laid with Math.random (index.html), so the blockers differ by millimetres between loads and a
  // sample that lands on an edge flips. With one shared stream that flip shifted every later draw (the ivy count ran 356-422 on
  // one build). Each candidate loop now reseeds per iteration (RSEED(key)), so a flip changes only that one candidate.
  let _rs = rng(424242); const R = () => _rs(); const rr = (a, b) => a + R() * (b - a);
  const RSEED = key => { _rs = rng((424242 ^ Math.imul(key + 1, 0x9E3779B1)) >>> 0); };
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
    D.dripU = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 0.5)) }; /* [autumn round] filled once the oak is sampled */
    D.barkU = tdWetU.U = { mossAmt: { value: 1 }, footDark: { value: 1 }, wet: { value: 0 }, damp: { value: 0 }, frost: { value: 0 }, day: { value: 1 }, near: { value: 0 }, rimK: { value: 1 },
      nrm: { value: ldT('barkN.jpg') }, hao: { value: ldT('barkH.jpg') }, relief: { value: 0.45 }, scale: { value: 0.55 }, cool: { value: 0.5 } };
    // rain from Wind (window.__wind.raining(), the weather spells); the old U.wind scalar is only the wind strength now
    D.update = (cam) => {
      if (cam) D.barkU.near.value = Math.hypot(cam.position.x - AX, cam.position.z - AZ) < 9 && cam.position.y < 17 ? 1 : 0;
      const now = performance.now() / 1000, dt = Math.min(0.5, Math.max(0, now - (D._lt || now))); D._lt = now;
      const W = window.__wind, on = W && W.raining ? W.raining() : 0;
      D._rk = (D._rk || 0) + (on - (D._rk || 0)) * Math.min(1, dt / 6); const rain = D._rk;
      const night = Math.min(1, ENVR.strength.value / 0.8 || 0);
      D.barkU.wet.value = rain; /* sheen only while it rains (no dew gloss): dry bark stays fully matte */
      /* by day the oak is a warm grey-brown, its cool violet cast is a night look; under the house it gets bounce light */
      D.barkU.cool.value = 0.15 + 0.35 * night; D.barkU.day.value = 1 - night;
      /* soaked bark: soaks up in ~25 s of rain, then dries over ~4 min, last in the furrows, the runs down the bark and the foot */
      const d = D.barkU.damp; d.value = rain > 0.05 ? Math.min(1, d.value + dt * rain / 25) : Math.max(0, d.value - dt / 240);
      /* hoar frost on the root tops on cold clear nights (Wind's __weather temp: ~4 °C before dawn): forms over ~90 s, melts in ~60 s */
      if (now - (D._wt || 0) > 0.5) { D._wt = now; const ws = window.__weather && window.__weather.state ? window.__weather.state() : null;
        D._ft = ws ? Math.min(1, Math.max(0, (5.3 - ws.temp) / 1.1)) * (ws.wet < 0.3 && !(ws.rainAmt > 0.05) ? 1 : 0) : 0; }
      const f = D.barkU.frost; f.value = (D._ft || 0) > f.value ? Math.min(D._ft, f.value + dt / 90) : Math.max(D._ft || 0, f.value - dt / 60); };
    // ---- junctions: where the limbs leave the trunk and where the house's beams bite into the bark ----
    // per-vertex attribute tdJ: x = crease (crotch / the fold where a limb meets the trunk, from how concave the surface is at
    // ~0.5 m scale), y = collar (the swollen bark ring just outside a crease), z = near a beam (0..1, gates the per-pixel bites)
    D.bites = [];
    {
      const g = TREE.bark.geometry, P = g.attributes.position, Nn = g.attributes.normal, n = P.count, ix = g.index;
      const mw = TREE.bark.matrixWorld; TREE.bark.updateMatrixWorld(true);
      const wp = new Float32Array(n * 3), wn = new Float32Array(n * 3); const t = V(0, 0, 0), nm = new THREE.Matrix3().getNormalMatrix(mw);
      for (let i = 0; i < n; i++) { t.fromBufferAttribute(P, i).applyMatrix4(mw); wp.set([t.x, t.y, t.z], i * 3); t.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); wn.set([t.x, t.y, t.z], i * 3); }
      // weld by position (the sculpt has seams), then vertex adjacency
      const wk = new Int32Array(n), wmap = new Map(); let nw = 0; const wpos = [];
      for (let i = 0; i < n; i++) { const k = Math.round(wp[i * 3] * 500) + ',' + Math.round(wp[i * 3 + 1] * 500) + ',' + Math.round(wp[i * 3 + 2] * 500); let w = wmap.get(k); if (w === undefined) { w = nw++; wmap.set(k, w); wpos.push(wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2]); } wk[i] = w; }
      const nb = Array.from({ length: nw }, () => new Set()); const I = ix ? ix.array : null; const nt = I ? I.length : n;
      for (let f = 0; f < nt; f += 3) { const a = wk[I ? I[f] : f], b = wk[I ? I[f + 1] : f + 1], c = wk[I ? I[f + 2] : f + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
      const nbA = nb.map(x => Int32Array.from(x)); const wnor = new Float32Array(nw * 3); for (let i = 0; i < n; i++) { const w = wk[i]; wnor[w * 3] += wn[i * 3]; wnor[w * 3 + 1] += wn[i * 3 + 1]; wnor[w * 3 + 2] += wn[i * 3 + 2]; }
      // Laplacian-smoothed copy of the surface: how far it moves along the normal says concave (+) or convex (-) at that scale
      let sp = Float32Array.from(wpos); const tmp = new Float32Array(nw * 3);
      for (let it = 0; it < (MOBILE ? 14 : 18); it++) { for (let w = 0; w < nw; w++) { const l = nbA[w]; if (!l.length) { tmp[w * 3] = sp[w * 3]; tmp[w * 3 + 1] = sp[w * 3 + 1]; tmp[w * 3 + 2] = sp[w * 3 + 2]; continue; } let x = 0, y = 0, z = 0; for (const j of l) { x += sp[j * 3]; y += sp[j * 3 + 1]; z += sp[j * 3 + 2]; } const k = 1 / l.length; tmp[w * 3] = sp[w * 3] * .4 + x * k * .6; tmp[w * 3 + 1] = sp[w * 3 + 1] * .4 + y * k * .6; tmp[w * 3 + 2] = sp[w * 3 + 2] * .4 + z * k * .6; } sp = tmp.slice(); }
      const cv = new Float32Array(nw); for (let w = 0; w < nw; w++) { const nx = wnor[w * 3], ny = wnor[w * 3 + 1], nz = wnor[w * 3 + 2], L = Math.hypot(nx, ny, nz) || 1; cv[w] = ((sp[w * 3] - wpos[w * 3]) * nx + (sp[w * 3 + 1] - wpos[w * 3 + 1]) * ny + (sp[w * 3 + 2] - wpos[w * 3 + 2]) * nz) / L; }
      // thresholds from the upper wood (limbs and junctions), so the scale of the model doesn't matter
      const up = []; for (let w = 0; w < nw; w++) if (wpos[w * 3 + 1] > 3.5) up.push(cv[w]); up.sort((a, b) => a - b);
      const pc = q => up[Math.min(up.length - 1, Math.floor(q * up.length))] || 0; const c0 = pc(0.86), c1 = pc(0.985);
      const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
      const cr = new Float32Array(nw); for (let w = 0; w < nw; w++) cr[w] = sm(c0, c1, cv[w]) * sm(2.2, 3.6, wpos[w * 3 + 1]);
      // the collar ring: within ~0.6 m of a crease (by distance, the mesh is coarse), filled in later once the grid exists
      const sp2 = new Float32Array(nw);
      // beams and boards whose end sits on the bark: contact points (the beam's end, snapped to the nearest bark vertex)
      const cell = 0.3, GR = new Map(); for (let w = 0; w < nw; w++) { const k = Math.floor(wpos[w * 3] / cell) + ',' + Math.floor(wpos[w * 3 + 1] / cell) + ',' + Math.floor(wpos[w * 3 + 2] / cell); let l = GR.get(k); if (!l) GR.set(k, l = []); l.push(w); }
      const nearest = (x, y, z, R) => { let best = R, bi = -1; const m = Math.ceil(R / cell), cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        for (let a = -m; a <= m; a++) for (let b = -m; b <= m; b++) for (let c = -m; c <= m; c++) { const l = GR.get((cx + a) + ',' + (cy + b) + ',' + (cz + c)); if (!l) continue; for (const w of l) { const d = Math.hypot(wpos[w * 3] - x, wpos[w * 3 + 1] - y, wpos[w * 3 + 2] - z); if (d < best) { best = d; bi = w; } } } return bi; };
      for (let w = 0; w < nw; w++) { if (cr[w] < 0.3) continue; const x = wpos[w * 3], y = wpos[w * 3 + 1], z = wpos[w * 3 + 2], cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) { const l = GR.get((cx + a) + ',' + (cy + b) + ',' + (cz + c)); if (!l) continue;
          for (const j of l) { const d = Math.hypot(wpos[j * 3] - x, wpos[j * 3 + 1] - y, wpos[j * 3 + 2] - z); if (d < 0.65) sp2[j] = Math.max(sp2[j], cr[w] * sm(0.65, 0.2, d)); } } }
      const M = new THREE.Matrix4(), pos = V(0, 0, 0), q = new THREE.Quaternion(), sc = V(0, 0, 0), ax = V(0, 0, 0);
      for (const im of blockers) { if (!im || !im.isInstancedMesh) continue; if (!im.geometry.boundingBox) im.geometry.computeBoundingBox(); const bb = im.geometry.boundingBox, ext = V(0, 0, 0); bb.getSize(ext); const ctr = bb.getCenter(V(0, 0, 0));
        for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, M); M.decompose(pos, q, sc); const e = [ext.x * Math.abs(sc.x), ext.y * Math.abs(sc.y), ext.z * Math.abs(sc.z)]; const L = Math.max(...e); const k = e.indexOf(L); if (L < 0.5) continue;
          const wid = Math.max(...e.filter((_, j) => j !== k)); if (wid > 0.4) continue; // beams and posts, not wide planks laid flat
          const c = ctr.clone().applyMatrix4(M); ax.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(q);
          if (Math.hypot(c.x - AX, c.z - AZ) > 9) continue;
          for (const sgn of [-1, 1]) { const ep = c.clone().addScaledVector(ax, sgn * L * 0.5); const w = nearest(ep.x, ep.y, ep.z, 0.35); if (w < 0) continue;
            const pt = V(wpos[w * 3], wpos[w * 3 + 1], wpos[w * 3 + 2]); if (D.bites.some(b => b.distanceTo(pt) < 0.12)) continue; pt.w = wid * 0.5 + 0.05; pt.ax = ax.clone().multiplyScalar(-sgn); pt.len = L; pt.flat = e.filter((_, j) => j !== k); D.bites.push(pt); } } }
      D.biteAll = D.bites.length; const NB = 72; D.bites.sort((a, b) => a.y - b.y); D.bites = D.bites.slice(0, NB);
      const J = new Float32Array(n * 3), BI = new Float32Array(n * 8);
      for (let i = 0; i < n; i++) { const w = wk[i]; const x = wpos[w * 3], y = wpos[w * 3 + 1], z = wpos[w * 3 + 2];
        let bite = 0, i1 = -1, i2 = -1, d1 = 9, d2 = 9; D.bites.forEach((b, bi) => { const d = Math.hypot(b.x - x, b.y - y, b.z - z); bite = Math.max(bite, 1 - sm(b.w + 0.2, b.w + 0.75, d)); const e = d - b.w; if (e > 0.85) return; if (e < d1) { i2 = i1; d2 = d1; i1 = bi; d1 = e; } else if (e < d2) { i2 = bi; d2 = e; } }); for (const [o, bi] of [[0, i1], [4, i2]]) { const b = D.bites[bi]; if (b) BI.set([b.x, b.y, b.z, b.w], i * 8 + o); else BI.set([0, -99, 0, -1], i * 8 + o); }
        J[i * 3] = cr[w]; J[i * 3 + 1] = sp2[w] * (1 - cr[w]) * (1 - sm(0, c0, cv[w])); J[i * 3 + 2] = bite; }
      g.setAttribute('tdJ', new THREE.BufferAttribute(J, 3)); { const ib = new THREE.InterleavedBuffer(BI, 8); g.setAttribute('tdB1', new THREE.InterleavedBufferAttribute(ib, 4, 0)); g.setAttribute('tdB2', new THREE.InterleavedBufferAttribute(ib, 4, 4)); } // the two nearest beam bites, passed flat per triangle (no uniform-array indexing)
      D.junction = { creases: cr.filter(x => x > 0.5).length, bites: D.bites.length, verts: nw };
      D.creaseAt = () => { const m = new Map(); for (let w = 0; w < nw; w++) if (cr[w] > 0.6) { const k = [0, 1, 2].map(j => Math.round(wpos[w * 3 + j] / 1.5)).join(','); const e = m.get(k) || [0, 0, 0, 0]; e[0] += wpos[w * 3]; e[1] += wpos[w * 3 + 1]; e[2] += wpos[w * 3 + 2]; e[3]++; m.set(k, e); } return [...m.values()].filter(e => e[3] > 4).map(e => [+(e[0] / e[3]).toFixed(1), +(e[1] / e[3]).toFixed(1), +(e[2] / e[3]).toFixed(1), e[3]]); };
    }
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      sh.uniforms.tdDrip = D.dripU; sh.uniforms.tdMoss = D.barkU.mossAmt; sh.uniforms.tdFoot = D.barkU.footDark; sh.uniforms.tdWet = D.barkU.wet; sh.uniforms.tdDamp = D.barkU.damp; sh.uniforms.tdFrost = D.barkU.frost; sh.uniforms.tdDay = D.barkU.day; sh.uniforms.tdNear = D.barkU.near; sh.uniforms.tdRimK = D.barkU.rimK;
      sh.uniforms.tdNrm = D.barkU.nrm; sh.uniforms.tdHao = D.barkU.hao; sh.uniforms.tdRelief = D.barkU.relief; sh.uniforms.tdScale = D.barkU.scale; sh.uniforms.tdCool = D.barkU.cool;
      sh.uniforms.tdRimC = ENVR.color; sh.uniforms.tdRimS = ENVR.strength; sh.uniforms.tdRimD = ENVR.dir;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;varying vec3 tdN;attribute vec3 tdJ;varying vec3 vTdJ;attribute float tdGr;varying float vTdGr;attribute vec4 tdB1,tdB2;flat varying vec4 vB1,vB2;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ntdP=(modelMatrix*vec4(transformed,1.)).xyz;tdN=normalize(mat3(modelMatrix)*objectNormal);vTdJ=tdJ;vTdGr=tdGr;vB1=tdB1;vB2=tdB2;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
${MOBILE ? '#define TD_LITE' : ''}
#define TDRS .68
#define TDBK ${MOBILE ? 1 : 2}
#define TDR ${(11 / (2 * Math.PI * 0.55 * 0.68)).toFixed(5)}
varying vec3 vTdJ;varying float vTdGr;flat varying vec4 vB1,vB2;float tdCr=0.,tdCo=0.,tdBC=0.,tdBR=0.,tdBW=0.,tdBT=0.;vec3 tdBD=vec3(0.);
uniform vec4 tdDrip[8];varying vec3 tdP;varying vec3 tdN;uniform float tdMoss,tdFoot,tdWet,tdDamp,tdFrost,tdDay,tdNear,tdRimK,tdRimS;uniform vec3 tdRimC,tdRimD;float tdMM=0.,tdWM=0.,tdDM=0.,tdFM=0.,tdHB=0.,tdL=0.,tdFade=0.,tdH=.5;
uniform sampler2D tdNrm,tdHao;uniform float tdRelief,tdScale;
// triplanar in a frame: A = the way the furrows run (stretched), B and C across. Trunk: A=up, B=x, C=z (fixed world axes).
// Roots and limbs: A = outwards from the trunk (they radiate from it), B = up, C = the horizontal tangent.
float tdLf=0.;vec3 tdA=vec3(0.,1.,0.),tdB=vec3(1.,0.,0.),tdC=vec3(0.,0.,1.);
vec3 tdW(vec3 n,vec3 A,vec3 B,vec3 C){vec3 b=pow(abs(vec3(dot(n,B),dot(n,C),dot(n,A))),vec3(4.));
#ifdef TD_LITE
 b=max(b-min(b.x,min(b.y,b.z)),0.);
#endif
 return b/max(b.x+b.y+b.z,1e-4);}
// Each projection reads two coordinates: the "across" one (cc) and the "along" one (a = along A, stretched) or B.
// The trunk frame uses world z for cc. Roots and limbs radiate from the trunk, so there cc must be the arc length around the
// trunk (tdU = angle * TDR): dot(p, tangent) is constant along every radial line, which smeared the plates into rings of
// wood grain across the roots. TDR makes one turn a whole number of tiles at every octave; the gradients are explicit
// (from the continuous tdUd), so the angle's wrap leaves no mip seam.
float tdU=0.;vec2 tdUd=vec2(0.);vec3 tdDx=vec3(0.),tdDy=vec3(0.);
#ifdef TD_LITE
// phones: an explicit LOD from the gradients (taken in uniform flow above), so the reads inside the per-pixel weight branches
// never rely on implicit derivatives (Apple GPUs: undefined there, sparkling mips). Same cost as a plain read; the maps are 1024^2.
float tdBias=0.;
vec4 tdTex(sampler2D t,vec2 uv,vec2 gx,vec2 gy){return textureLod(t,uv,max(0.,.5*log2(max(max(dot(gx,gx),dot(gy,gy)),1e-12)*1048576.))+tdBias);}
#else
float tdBias=0.;
vec4 tdTex(sampler2D t,vec2 uv,vec2 gx,vec2 gy){float k=exp2(tdBias);return textureGrad(t,uv,gx*k,gy*k);}
#endif
vec4 tdS(sampler2D t,vec3 p,float m,float cc,vec2 cd,vec3 n,vec3 A,vec3 B,vec3 C,float s){vec3 w=tdW(n,A,B,C);float a=dot(p,A)*.8,b=dot(p,B);
 vec3 dx=tdDx*m*s,dy=tdDy*m*s;vec2 ax=vec2(dot(dx,A)*.8,dot(dy,A)*.8),bx=vec2(dot(dx,B),dot(dy,B)),cx=cd*m*s;
 vec4 r=vec4(0.);if(w.x>0.)r+=tdTex(t,vec2(cc,a)*s,vec2(cx.x,ax.x),vec2(cx.y,ax.y))*w.x;if(w.y>0.)r+=tdTex(t,vec2(b,a)*s,vec2(bx.x,ax.x),vec2(bx.y,ax.y))*w.y;
 if(w.z>0.)r+=tdTex(t,vec2(cc,b)*s,vec2(cx.x,bx.x),vec2(cx.y,bx.y))*w.z;return r;}
vec3 tdSN(vec3 p,float m,float cc,vec2 cd,vec3 n,vec3 A,vec3 B,vec3 C,float s,float k){vec3 w=tdW(n,A,B,C);float a=dot(p,A)*.8,b=dot(p,B);
 vec3 dx=tdDx*m*s,dy=tdDy*m*s;vec2 ax=vec2(dot(dx,A)*.8,dot(dy,A)*.8),bx=vec2(dot(dx,B),dot(dy,B)),cx=cd*m*s;
 vec3 tx=vec3(0.),ty=vec3(0.),tz=vec3(0.);
 if(w.x>0.)tx=tdTex(tdNrm,vec2(cc,a)*s,vec2(cx.x,ax.x),vec2(cx.y,ax.y)).xyz*2.-1.;if(w.y>0.)ty=tdTex(tdNrm,vec2(b,a)*s,vec2(bx.x,ax.x),vec2(bx.y,ax.y)).xyz*2.-1.;
 if(w.z>0.)tz=tdTex(tdNrm,vec2(cc,b)*s,vec2(cx.x,bx.x),vec2(cx.y,bx.y)).xyz*2.-1.;
 return ((C*tx.x+A*tx.y)*w.x+(B*ty.x+A*ty.y)*w.y+(C*tz.x+B*tz.y)*w.z)*k;}
// p = tdP*m+o. Both mappings, blended between the trunk and the roots / limbs.
// both mappings, blended in the trunk/root band; phones keep that band narrow (mixing the two coordinates instead of the two
// reads made a huge gradient across the band: long streaks on some roots)
vec4 tdTri(sampler2D t,float m,vec3 o,vec3 n,float s){vec3 p=tdP*m+o;vec4 a=vec4(0.),b=vec4(0.);
 if(tdLf<.99)a=tdS(t,p,m,p.z,vec2(tdDx.z,tdDy.z),n,vec3(0.,1.,0.),vec3(1.,0.,0.),vec3(0.,0.,1.),s);
 if(tdLf>.01)b=tdS(t,p,m,tdU*m+o.z,tdUd,n,tdA,tdB,tdC,s*TDRS);return mix(a,b,tdLf);}
vec3 tdTriN(float m,vec3 o,vec3 n,float s,float k){vec3 p=tdP*m+o;vec3 a=vec3(0.),b=vec3(0.);
 if(tdLf<.99)a=tdSN(p,m,p.z,vec2(tdDx.z,tdDy.z),n,vec3(0.,1.,0.),vec3(1.,0.,0.),vec3(0.,0.,1.),s,k);
 if(tdLf>.01)b=tdSN(p,m,tdU*m+o.z,tdUd,n,tdA,tdB,tdC,s*TDRS,k);return mix(a,b,tdLf);}

uniform float tdCool;` + NOISE)
        .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wn=normalize(tdN); float y=tdP.y;
#ifdef USE_MAP
          // the sculpted model's own painted texture has long vertical streaks: keep only its broad colour (a blurred mip),
          // the bark detail comes from the relief below
          { vec4 mb=texture2D(map,vMapUv,5.);
            #ifdef TD_LITE
            float mute=.85; // phones too: the model's painted streaks showed through as stripes and a pink cast
#else
            float mute=.85;
#endif
            diffuseColor.rgb=diffuseColor.rgb/max(sampledDiffuseColor.rgb,vec3(.004))*mix(sampledDiffuseColor.rgb,mb.rgb,mute); }
#endif
          // ---- bark relief: light worn crust on the ridges, deep dark furrows, fibrous detail up close ----
          { vec2 rv=tdP.xz-vec2(${AX.toFixed(3)},${AZ.toFixed(3)}); float r=length(rv); vec3 rad=r>1e-3?vec3(rv.x/r,0.,rv.y/r):vec3(1.,0.,0.);
            // roots and limbs: furrows along them. Near the ground the roots run outwards; higher up the limbs rise a little as they go out.
            tdA=normalize(rad+vec3(0.,.25*smoothstep(2.5,4.,y),0.)); tdC=vec3(-rad.z,0.,rad.x); tdB=normalize(cross(tdC,tdA));
            #ifdef TD_LITE
            tdLf=smoothstep(2.8,3.4,r); // phones: a narrower blend band (two reads only inside it)
#else
            tdLf=smoothstep(2.5,3.7,r);
#endif
            tdU=atan(rv.y,rv.x)*TDR;
#ifdef TD_LITE
            // the same angle with its wrap moved to the other side (a whole number of tiles apart, so the same texels): use whichever
            // is smooth across this pixel quad, so the implicit mip choice never sees the jump (Tarini's seam trick)
            { float u2=tdU+(tdU<0.?6.2831853*TDR:0.); if(fwidth(u2)<fwidth(tdU))tdU=u2; }
            tdDx=dFdx(tdP);tdDy=dFdy(tdP); tdUd=vec2(dFdx(tdU),dFdy(tdU)); // gradients for the explicit-LOD reads
#else
            tdDx=dFdx(tdP);tdDy=dFdy(tdP); tdUd=vec2(rv.x*tdDx.z-rv.y*tdDx.x,rv.x*tdDy.z-rv.y*tdDy.x)/max(r*r,1e-4)*TDR;
#endif
            }
          tdFade=1.-smoothstep(5.,16.,length(cameraPosition-tdP));
          // phones: one macro read and no close-up octave (GPU-bound at night); desktop: anti-tiling second read + micro detail up close
          vec4 hb=vec4(.5,1.,.5,1.);
#ifdef TD_LITE
          vec4 ha=tdTri(tdHao,1.,vec3(0.),wn,tdScale);
          // phones, only while the camera is near the trunk (uniform branch): the fine octave for close-ups, its height also drives
          // a screen-space micro bump below (no extra normal-map read)
          if(tdNear>.5){ hb=tdTri(tdHao,36./11.,vec3(7.3),wn,tdScale); tdHB=hb.r*tdFade; }
          // [bark close-up round] near the trunk the macro pattern's repeat (about 1.8 m) is broken by a second read at another scale
          // in slow world-space patches, as on desktop (uniform branch, then a per-pixel one with explicit-LOD reads)
          if(tdNear>.5){ float brk=smoothstep(.3,.7,td_n(tdP*vec3(.45,.3,.45)+11.)); if(brk>.01)ha=mix(ha,tdTri(tdHao,15./11.,vec3(3.1,1.7,5.3),wn,tdScale),brk); }
#else
          float brk=smoothstep(.3,.7,td_n(tdP*vec3(.45,.3,.45)+11.));
          vec4 ha=tdTri(tdHao,1.,vec3(0.),wn,tdScale);
          if(brk>.01)ha=mix(ha,tdTri(tdHao,15./11.,vec3(3.1,1.7,5.3),wn,tdScale),brk);
          if(tdFade>.01)hb=tdTri(tdHao,36./11.,vec3(7.3),wn,tdScale);
#endif
          tdH=ha.r;float cav=ha.g*mix(1.,.8+.2*hb.g,tdFade);
          float rel=min(1.,tdRelief*(1.+1.2*tdLf)); // roots: furrows darker too (T22)
          diffuseColor.rgb*=mix(1.,mix(.55,1.15,smoothstep(.05,.95,tdH))*mix(.74,1.,smoothstep(.05,.75,cav)),rel); // pores softer: close up they read as black pepper (smooth photo bark)
          diffuseColor.rgb*=mix(1.,.93+.14*hb.b,tdFade*rel*(1.-.6*tdLf)); // fine octave: a hint only (its cork pattern read as black pepper up close)
          { float g=dot(diffuseColor.rgb,vec3(.33)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(g*1.05,g*1.03,g*1.0),smoothstep(.62,.92,tdH)*.35*rel);
            // the photo's oak is a cooler grey-brown than the warm model texture, with violet-blue in the furrows and shadows
            diffuseColor.rgb=mix(diffuseColor.rgb,g*vec3(1.08,.97,.9),.35*tdCool);
            diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.82,.8,1.05),vec3(1.),smoothstep(.15,.6,tdH)),tdCool); }
          // ---- junctions (tdJ from the mesh): crotches, the collar round each limb, and the house's beams biting into the bark ----
          diffuseColor.rgb*=mix(1.,.42,vTdGr); // carved grooves in the roots and the trunk's cuts: deep shade, reads from the normal view
          tdCr=vTdJ.x; tdCo=vTdJ.y;
          // crotch / crease: the bark squeezed into tight folds and deep shade where the limb meets the trunk
          diffuseColor.rgb*=mix(1.,.5,tdCr*tdCr)*mix(1.,.7+.3*cav,tdCr);
          // collar: the swollen ring round the limb base, its ridges squeezed tight and a little paler with weathering
          diffuseColor.rgb*=mix(1.,mix(.78,1.18,smoothstep(.3,.8,tdH)),tdCo*.75);
          if(vB1.w>0.){ float pk=0.;
            // only the two bites nearest this triangle (from the mesh, flat), not a loop over all of them
            for(int k=0;k<TDBK;k++){ vec4 b=k==0?vB1:vB2; if(b.w<0.)continue; vec3 dv=tdP-b.xyz; float d=length(dv); if(d>b.w+.8)continue;
              float ci=1.-smoothstep(b.w*.8,b.w*1.02,d);                                    // crushed under the beam's end
              float rl=smoothstep(b.w*.85,b.w+.05,d)*(1.-smoothstep(b.w+.05,b.w+.2,d));      // callus roll the bark grew round it
              float wr=1.-smoothstep(b.w,b.w+.5,d);                                          // rubbed by the wood moving in the wind
              // water runs off the beam and stains the bark below it
              float run=(1.-smoothstep(b.w*.5,b.w*1.1,length(dv.xz)))*smoothstep(.02,.12,-dv.y)*(1.-smoothstep(.2,.9,-dv.y));
              if(rl>tdBR){tdBR=rl;tdBD=dv/max(d,1e-3);pk=(d-(b.w+.05))/.08;}
              tdBC=max(tdBC,ci);tdBW=max(tdBW,wr);tdBT=max(tdBT,run); }
            tdBR*=clamp(pk,-1.,1.); // signed: the roll's inner slope faces the beam, the outer slope faces away
            float g=dot(diffuseColor.rgb,vec3(.33));
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(g*1.08,g*1.02,g*.95)*1.25,tdBW*.35*smoothstep(.4,.8,tdH)); // worn, greyer ridges
            diffuseColor.rgb*=1.-tdBC*.45;                       // crushed, dark and dirty
            diffuseColor.rgb*=1.+abs(tdBR)*.25;                  // the fresh callus is a touch lighter
            diffuseColor.rgb*=1.-tdBT*.35*smoothstep(.2,.6,1.-tdH*.5); }
          vec2 ax=tdP.xz-vec2(${AX.toFixed(3)},${AZ.toFixed(3)}); float rd=length(ax);
          float lum=dot(diffuseColor.rgb,vec3(.3,.59,.11));
          // big soft patches + fine breakup
#ifdef TD_LITE
          float big=texture2D(tdHao,vec2(tdP.x+tdP.y*.55,tdP.z-tdP.y*.45)*.09).g*1.4-.35; // a skewed planar read that varies across every face (the old (x+z, y) one was constant along flat root tops: stripes)
          float fine=ha.b;
#else
          float big=td_f(tdP*vec3(.55,.35,.55));
          float fine=td_f(tdP*3.1+vec3(0.,big*2.,0.));
#endif
          // damp foot: the bark gets darker, cooler and a little greener towards the ground (photo: the base sinks into the fog)
          float foot=1.-smoothstep(-.3,4.8,y+(big-.5)*1.2);
          float rootTop=smoothstep(.25,.75,wn.y)*smoothstep(1.9,3.2,rd);
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.34,.38,.42),foot*.62*tdFoot*(1.-rootTop*.7));
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
          mm=max(mm,tdCr*smoothstep(-.25,.45,wn.y)*smoothstep(.2,.55,big+fine*.4)*smoothstep(3.,4.5,y)); // moss packs the crotches
          mm*=1.-tdBW*.85;
          mm=clamp(mm*tdMoss,0.,1.)*(1.-clamp(vGlow*2.5,0.,1.));
          // linear colours: deep olive in the shade, a little brighter yellow-green where it catches light
          vec3 moss=mix(vec3(.030,.048,.014),vec3(.085,.125,.028),smoothstep(.3,.8,fine));
          moss=mix(moss,vec3(.028,.045,.035),foot*.5);
          moss*=mix(vec3(1.),vec3(.72,1.08,.62),tdDamp); // soaked moss: deeper and greener
          diffuseColor.rgb=mix(diffuseColor.rgb,moss*(.7+2.*lum),mm*.9);
          // grey-green lichen spots on the drier upper bark
#ifdef TD_LITE
          float li=smoothstep(.62,.8,ha.b*.6+big*.5)*smoothstep(.6,1.,ha.r)*smoothstep(.8,2.5,y)*(1.-mm); // phones: from the bark map reads
#else
          float li=smoothstep(.72,.84,td_n(tdP*vec3(7.,4.,7.)+big*3.)+(tdH-.5)*.25)*smoothstep(.55,.7,td_n(tdP*.9+5.))*smoothstep(1.,3.,y)*(1.-mm)*smoothstep(.3,.6,tdH); /* [bark close-up round] on the ridges, its rim broken by the furrows (a clean noise contour read as a sticker up close) */
#endif
          // lichen in a few kinds: pale grey-green crust, minty foliose patches and the odd orange-yellow (Xanthoria) spot
#ifdef TD_LITE
          { float kind=.3; // phones: one kind (fract() of the smooth noise drew contour stripes)
#else
          { float kind=fract(big*5.17+tdP.y*.13);
#endif
            vec3 lc=kind<.55?vec3(.16,.18,.15):(kind<.85?vec3(.13,.19,.14):vec3(.22,.14,.04));
            diffuseColor.rgb=mix(diffuseColor.rgb,lc*(.55+lum*2.5),li*(kind<.85?.55:.45)); }
          // wet bark: darker, and glossy in the grooves' ridges (moss stays matte); streaks run down from the limbs
#ifdef TD_LITE
          float streak=big*.6+tdH*.4;
#else
          float streak=big*.6+tdH*.4; // patchy, on the ridges first: no stretched noise, so no glossy stripes
#endif
          tdWM=tdWet*(1.-mm*.8)*(.55+.45*smoothstep(.3,.7,streak));
          diffuseColor.rgb*=1.-tdWM*.3;
          // soaked bark after the rain: dark streaks running down the trunk and the roots that shrink as it dries
          // (water stays longest in the furrows, in the runs down the bark and at the damp foot)
          if(tdDamp>.003){ float run=texture2D(tdHao,vec2((tdP.x+tdP.z*.71)*.42,tdP.y*.045+.31)).g;
            float hold=run*.62+(1.-tdH)*.28+foot*.3-mm*.25;
            float dm=smoothstep(1.02-tdDamp*.85,1.2-tdDamp*.85,hold)*smoothstep(0.,.25,tdDamp);
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*diffuseColor.rgb*2.2,dm*.45); diffuseColor.rgb*=1.-dm*.32; tdDM=dm; }
          // [autumn round] drip lines under the landings: where a landing meets the trunk the rain runs off the boards and down
          // the bark, leaving dark water-stained runs (a faint stain always, soaked and glossy in the rain). tdDrip: (x, y of the
          // landing's underside, z, reach); arithmetic noise only, no texture reads in the loop.
          { float dr=0.; for(int i=0;i<8;i++){ vec4 s=tdDrip[i]; float h=s.y-tdP.y; float hl=.9+1.7*td_n(vec3(tdP.x*2.3,s.y,tdP.z*2.3));
              dr=max(dr,(1.-smoothstep(s.w*.45,s.w,length(tdP.xz-s.xz)))*smoothstep(-.02,.06,h)*(1.-smoothstep(hl*.5,hl,h))); }
            if(dr>.001){ float run=smoothstep(.38,.68,td_n(vec3(tdP.x*11.,tdP.y*.7,tdP.z*11.)))*(.6+.4*td_n(vec3(tdP.x*4.,tdP.y*2.,tdP.z*4.)));
              float k=dr*run*(1.-mm*.6)*(.6+.4*tdDamp); diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.5,.52,.47),k*.8); tdWM=max(tdWM,k*tdWet); } }
          // hoar frost: white rime on the upward faces of the roots near the ground, on the ridges first (furrows stay dark)
          if(tdFrost>.003){ float fm=tdFrost*smoothstep(.55,.9,wn.y)*(1.-smoothstep(.6,2.2,y))*smoothstep(.45,.8,tdH+ha.b*.3+(big-.5)*.6)*(1.-mm*.5);
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.37,.42)*(.7+.6*ha.b),fm*.5); tdFM=fm; } // a light dusting, not snow
          tdMM=mm;tdL=lum;
        }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 wn=normalize(tdN);
          tdBias=1.2; // the normal reads a little blurred too: single-texel pits lit from the side drew black pepper up close
#ifdef TD_LITE
          vec3 dn=tdTriN(1.,vec3(0.),wn,tdScale,3.);
          // [bark close-up round] near the trunk: the fine octave's own normal map (one read, explicit LOD), as on desktop. The old
          // screen-derivative micro bump was constant per 2x2 pixel quad and drew a sandpaper grain on the sunlit roots up close
          if(tdNear>.5)dn+=tdTriN(36./11.,vec3(7.3),wn,tdScale,1.1)*tdFade*(1.-.3*tdLf);
#else
          float brk=smoothstep(.3,.7,td_n(tdP*vec3(.45,.3,.45)+11.));
          vec3 dn=tdTriN(1.,vec3(0.),wn,tdScale,3.);
          if(brk>.01)dn=mix(dn,tdTriN(15./11.,vec3(3.1,1.7,5.3),wn,tdScale,3.*1.37),brk);
          if(tdFade>.01)dn+=tdTriN(36./11.,vec3(7.3),wn,tdScale,1.1)*tdFade*(1.-.3*tdLf); // on roots the fine octave read as wood grain
#endif
          tdBias=0.;
          dn*=1.+.6*smoothstep(.45,.9,wn.y); // tops of the limbs: as rough as the sides
          dn*=1.-tdBC*.6;                    // crushed bark is flattened
          dn+=tdBD*tdBR*.9;                   // the callus roll round a beam
          dn*=1.+tdCo*.5;                     // collar: deeper squeezed folds
          vec3 nw=normalize(wn+dn*tdRelief*(1.-tdMM*.7)*(1.+2.*tdLf)); // roots: deeper relief (Critic T22: they read smooth up close)
          vec3 nv=normalize((viewMatrix*vec4(nw,0.)).xyz);
          normal=normalize(mix(normal,nv,.92));
        }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(max(roughnessFactor,.92),.45,tdWM*(1.-tdFM)); // a soft wet sheen, not varnish // dry bark is fully matte')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // moonlit rim from Environment (env.moonRim): a cold fresnel edge on the side facing the moon
          vec3 wn=normalize(tdN), wv=normalize(cameraPosition-tdP);
          float fr=pow(1.-max(dot(wn,wv),0.),4.);
          float rim=fr*max(dot(wn,normalize(tdRimD)),0.)*tdRimS*tdRimK*(1.-.7*smoothstep(.5,.9,wn.y)); // an edge light, not a sheen on the tops
          rim*=mix(.3,1.,smoothstep(1.5,4.5,tdP.y))*(.55+.45*smoothstep(.3,.7,tdH)); // [house round] low on the faceted roots it drew long blue painted streaks: weaker there, and broken by the bark ridges
          totalEmissiveRadiance+=tdRimC*rim*(.12+tdL*1.6)*(1.-tdMM*.5)*(1.+tdWM*.8);
          // daylight bounced off the ground, the roots and the house's planks: warm fill so the trunk in the house's shade reads
          // as brown bark, not a black hole (weaker in the furrows and the deep crotches)
          totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.1,.95,.8)*tdDay*.5*(.45+.55*tdH)*(1.-tdCr*.7);
        }`);
    };
    const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    mat.customProgramCacheKey = () => prevKey() + '|treedress7';
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
  const pointOn = (q, rnd = R) => { const i = q.t * 9; let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } return V(T[i] + (T[i + 3] - T[i]) * u + (T[i + 6] - T[i]) * v, T[i + 1] + (T[i + 4] - T[i + 1]) * u + (T[i + 7] - T[i + 1]) * v, T[i + 2] + (T[i + 5] - T[i + 2]) * u + (T[i + 8] - T[i + 2]) * v); };
  function sampler(filter, rnd = R) {
    const L = tri.filter(filter); let sum = 0; const cum = L.map(q => (sum += q.ar));
    return () => { if (!L.length) return null; const x = rnd() * sum; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } const q = L[lo]; return { p: pointOn(q, rnd), n: q.n }; };
  }  // [autumn round] drip sources for the bark shader: bark faces right under a board or beam (a landing against the trunk), clustered
  // to at most 8. Deterministic (no rng), so nothing else moves.
  { const cand = [];
    for (const q of tri) { if (Math.abs(q.n.y) > 0.6 || q.c.y < 2) continue;
      for (const dy of [0.08, 0.2, 0.35]) if (inBox(boxes, q.c.x + q.n.x * 0.06, q.c.y + dy, q.c.z + q.n.z * 0.06, 0.02)) { cand.push([q.c.x, q.c.y + dy - 0.04, q.c.z, q.ar]); break; } }
    // cluster (0.9 m across, 1.2 m tall), rank by how much bark sits under that landing; the crown tops (above the house) are left out
    const cl = []; for (const c of cand) { if (c[1] > 11) continue; const k = cl.find(s => Math.hypot(s[0] - c[0], s[2] - c[2]) < 0.9 && Math.abs(s[1] - c[1]) < 1.2); if (k) { k[3] += c[3]; if (c[1] > k[1]) k[1] = c[1]; } else cl.push(c.slice()); }
    // the side facing the home view counts 3x (that is where they are seen); none over the trunk door (its lintel is not a landing)
    for (const c of cl) { const ang = Math.atan2(c[2] - AZ, c[0] - AX); c[3] *= 1 + 2 * Math.max(0, Math.sin(ang)); if (Math.abs(angDiff(ang, doorAng)) < 0.55 && c[1] < 3.6) c[3] = 0; }
    cl.sort((a, b) => b[3] - a[3]); const src = cl.filter(c => c[3] > 0.05).slice(0, 8);
    src.forEach((c, i) => D.dripU.value[i].set(c[0], c[1], c[2], 0.7)); D.drips = src.map(c => c.map(v => +v.toFixed(2))); }

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
  RSEED(9000001); /* [determinism] each section starts from its own seed */
  {
    const g = (() => { const s = new THREE.IcosahedronGeometry(1, MOBILE ? 1 : 2); /* rounder: a faceted blob read as a plastic lump */ s.deleteAttribute('normal'); s.deleteAttribute('uv'); const m = mergeVertices(s); const p = m.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.18 * Math.sin(x * 5.1 + z * 3.7) * Math.cos(z * 4.3 - y * 2); p.setXYZ(i, x * k, Math.max(y, -0.2) * k, z * k); }
      m.computeVertexNormals(); return m; })();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    mat.onBeforeCompile = sh => {
      branchHook(sh, AX, AZ);
      // tdS: 1 on the mossy earth humps between the roots (they share this mesh), tdHg: height above the ground there
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;attribute float tdSoil;varying float tdS,tdHg; /* tdHg: 0 at the floor, 1 at the hump top */').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ntdP=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;tdS=tdSoil;tdHg=(tdP.y-(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).y-.06)/max(length(instanceMatrix[1].xyz)-.06,.01);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;varying float tdS,tdHg;' + NOISE)
        // [ladder-foot round] the earth humps read as black speckled ovals with a hard rim cut into the floor: a frayed rim
        // (arithmetic noise, no texture reads) so the floor shows through in ragged bays, as moss creeping over the earth does
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif(tdS>.5&&tdHg<.5*td_n(tdP*17.)+.2*td_n(tdP*43.)-.16)discard;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{float f=td_f(tdP*14.);float g=td_n(tdP*55.);diffuseColor.rgb*=.8+.4*f-.18*(f-.5)*tdS+.18*(g-.5)*clamp(1.-length(fwidth(tdP))*55.*.9,0.,1.)*(1.-tdS);diffuseColor.rgb*=mix(mix(.6,.9,tdS),1.,smoothstep(-.2,3.,tdP.y));\n{float fz=td_f(tdP*41.+1.7);float fz2=td_n(tdP*113.+4.2);diffuseColor.rgb*=mix(1.,.62+.6*smoothstep(.3,.72,fz),clamp(1.-length(fwidth(tdP))*41.*.7,0.,1.))*mix(1.,.82+.36*fz2,clamp(1.-length(fwidth(tdP))*113.*.7,0.,1.));diffuseColor.rgb*=.92+.16*smoothstep(.3,.8,td_n(tdP*9.));}}')
        // a cushion of moss is a pile of tiny stems, not a smooth skin: a fine fuzzy bump on the lit side (critic: the patches
        // on the roots read as flat green felt from the close zoom)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
 { float px=length(fwidth(tdP)); float aF=clamp(1.-px*160.*3.,0.,1.)*(1.-tdS), aM=clamp(1.-px*47.*1.2,0.,1.)*(1.-tdS)*.4; /* [crown round] the bump is a screen derivative (constant per 2x2 pixel quad): stems under ~3 px drew a blocky pixel camouflage, so they fade out well before that */ /* earth humps: no stem bump (pixel stems speckled, the coarse ones drew dark worms on a 0.6 m hump) */ /* fade the stems once they are smaller than a pixel: aliased, they drew black hatching */
   /* [bark close-up round] the stems' bump from the noise's analytic gradient, not screen derivatives: up close (1.4 m zoom) the
      2x2-quad bump drew the cushions as blocky pixel camouflage */
   vec4 nF=td_nd(tdP*160.),nM=td_nd(tdP*47.); float hgt=(nF.x-.5)*.6*aF+(nM.x-.5)*.4*aM+.5;
   vec3 gw=nF.yzw*(160.*.6*aF)+nM.yzw*(47.*.4*aM), gv=(viewMatrix*vec4(gw,0.)).xyz; normal=normalize(normal-.0035*(gv-normal*dot(gv,normal)));
   diffuseColor.rgb*=.9+.2*hgt; /* [house round] the coarse stems drew dark worm stripes on the root cushions: a softer fuzz */ /* the wide earth humps: soft fuzz, not black speckles */ }`)
        // weather (same uniforms as the bark): soaked moss deeper and greener, hoar frost on the tops of the cushions on cold nights.
        // Only the green instances (moss), not the brown soil lumps that share this mesh.
        .replace('#include <color_fragment>', `#include <color_fragment>
{ vec3 c=diffuseColor.rgb; float green=smoothstep(.05,.3,(c.g-c.r)/max(c.g,1e-3));
  c=mix(c,c*vec3(.72,1.1,.6),tdDamp*green);
  c*=1.-.25*tdDamp*(1.-green)*tdS; /* [rain round] soaked earth humps */
  vec3 wN=normalize((vec4(vNormal,0.)*viewMatrix).xyz); float top=smoothstep(.3,.85,wN.y);
  float fr=tdFrost*top*green*(.35+.65*smoothstep(.4,.65,td_n(tdP*70.)));
  c=mix(c,vec3(.24,.26,.3),fr*.45);
  c=mix(c*vec3(1.05,.85,.75),c,mix(1.,smoothstep(.0,.6,tdHg),tdS)); /* the earth humps: browner low down, the moss on top */ diffuseColor.rgb=c; }`)
        // [rain round] wet moss glistens while it rains (the cushion tips more than the hollows), the earth humps soak darker
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,mix(.42+.3*td_n(tdP*47.),.7,tdS),tdWet*(1.-tdFrost));')
        .replace('#include <common>', '#include <common>\nuniform float tdDamp,tdFrost,tdWet;');
      sh.uniforms.tdDamp = D.barkU.damp; sh.uniforms.tdFrost = D.barkU.frost; sh.uniforms.tdWet = D.barkU.wet;
    };
    mat.customProgramCacheKey = () => 'tdMossCushion6'; /* SHADERS rule: own key */
    const NBM = Math.round(110 * MUL), NUP = Math.round(150 * MUL), N = NUP + Math.round(150 * MUL) + NBM, NSOIL = Math.round(70 * MUL), NDOOR = MOBILE ? 6 : 10, im = new THREE.InstancedMesh(g, mat, N + NDOOR + NSOIL);
    g.setAttribute('tdSoil', new THREE.InstancedBufferAttribute(new Float32Array(N + NDOOR + NSOIL), 1));
    const roots = sampler(q => q.n.y > 0.55 && q.c.y < 1.5 && q.c.y > -0.1 && radial(q.c.x, q.c.z) > 2.0);
    const limbs = sampler(q => q.n.y > 0.7 && q.c.y > 3.5 && q.c.y < 13 && radial(q.c.x, q.c.z) > 1.4);
    let n = 0;
    for (let k = 0; k < NUP * 4 && n < NUP; k++) { RSEED(512000 + k);
      const s = (k % 3 === 2 ? limbs : roots)(); if (!s) continue;
      const { p } = s; if (blocked(p.x, p.y, p.z, 0.28) || nearDoor(p.x, p.y, p.z)) continue;
      // grow in small colonies: keep a sample only if the big moss noise is high here (matches the shader patches loosely)
      if (Math.sin(p.x * 1.3 + p.z * 0.9) + Math.sin(p.y * 1.7 - p.x * 0.6) < -0.3) continue;
      // a colony of a few small domed cushions, not one wide flat sheet (critic: a 0.5 m flat patch read as green felt laid on
      // the root); small ones also follow the curved root without their edges standing off it
      const tA = V(1, 0, 0).cross(s.n); if (tA.lengthSq() < 1e-4) tA.set(0, 0, 1); tA.normalize(); const tB = s.n.clone().cross(tA);
      for (let j = 0, m = 2 + Math.floor(R() * 3); j < m && n < NUP; j++) {
        const a = rr(0, 6.28), d = j ? rr(0.05, 0.15) : 0, q = p.clone().addScaledVector(tA, Math.cos(a) * d).addScaledVector(tB, Math.sin(a) * d);
        const sz = rr(0.045, 0.11) * (j ? 0.8 : 1) * (p.y > 3 ? 0.8 : 1); if (j && blocked(q.x, q.y, q.z, 0.12 + sz)) continue; /* [house exterior round] a colony member under a floor's edge poked up through the board ends as a flat green disc */
        M4.compose(q.addScaledVector(s.n, -sz * 0.12), orient(s.n, rr(0, 6.28)), S.set(sz * rr(1, 1.35), sz * rr(0.45, 0.65) * 1.35, sz * rr(0.85, 1.15))); /* [house round] taller domes: from the root sweep they read as flat green blobs (same rr() calls, layout unchanged) */
        im.setMatrixAt(n, M4);
        const v = rr(0.85, 1.15); col.setRGB(0.085 * v, 0.125 * v * rr(0.95, 1.08), 0.03 * v); im.setColorAt(n, col); n++; } /* sunlit cushion moss is a lively yellow-green (it read as a dark sponge close up) */
    }
    // roofs: moss creeps over the shingles in a few patches, mostly low on the slope near the eaves and against the trunk
    const roofs = C.roofs; const qi = new THREE.Quaternion(), pi = V(), si = V(), nrm = V();
    if (roofs && roofs.isInstancedMesh) {
      const idx = [...Array(roofs.count).keys()];
      for (let k = 0; k < idx.length && n < NUP + Math.round(110 * MUL); k++) { RSEED(531000 + k);
        const i = idx[Math.floor(R() * idx.length)]; roofs.getMatrixAt(i, M4); M4.decompose(pi, qi, si);
        nrm.set(0, 1, 0).applyQuaternion(qi); if (nrm.y < 0.3) continue;
        // patchy: a low-frequency mask in world space, denser on the back (shady, -z) half and near the trunk
        const patch = Math.sin(pi.x * 2.1 + pi.z * 1.3) + Math.sin(pi.z * 2.7 - pi.y * 1.9) + (pi.z < AZ + 1.6 ? 0.5 : -0.4) + (radial(pi.x, pi.z) < 3 ? 0.4 : 0);
        if (patch < 0.6 || R() < 0.35) continue;
        // [PROPS roof round] moss roots in the damp step where this slate's butt edge lies on the one below, as a short row of
        // small domed cushions along that edge (the flat 15-30 cm ovals on the open slate read as green blots painted on)
        const dn = V(1, 0, 0).applyQuaternion(qi); if (dn.y > 0) dn.negate(); const ed = nrm.clone().cross(dn).normalize();
        const base = pi.clone().addScaledVector(dn, si.x * 0.5 + 0.012).addScaledVector(nrm, -si.y * 0.1);
        for (let j = 0, m = 1 + Math.floor(R() * 3); j < m && n < NUP + Math.round(110 * MUL); j++) {
          const p = base.clone().addScaledVector(ed, rr(-0.45, 0.45) * si.z), sz = rr(0.028, 0.055);
          M4.compose(p, orient(nrm, rr(0, 6.28)), S.set(sz * rr(1.1, 1.6), sz * 0.55, sz * rr(0.9, 1.2))); im.setMatrixAt(n, M4);
          const v = rr(0.8, 1.2); col.setRGB(0.07 * v, 0.1 * v, 0.03 * v); im.setColorAt(n++, col); }
      }
    }
    // plank landings and the deck: moss along the back (north) edges and the board ends, where water stays longest
    const boardsIM = (C.blockers || [])[0];
    if (boardsIM && boardsIM.isInstancedMesh) {
      for (let k = 0; k < 4000 && n < N; k++) { RSEED(550000 + k);
        const p = boardPoint(boardsIM, 0.3, 0.48, 0.45); if (!p) continue;
        if (inBox(avoid, p.x, p.y, p.z, 0.25) || inBox(avoid, p.x, p.y + 1.5, p.z, 0.25)) continue; // not inside the rooms
        if (p.z > AZ + 2.2 && R() < 0.8) continue; // mostly the back / trunk side
        if (Math.sin(p.x * 3.1 + p.z * 2.3) + Math.sin(p.z * 1.7 - p.x * 2.2) < 0.2) continue;
        if (R() < 0.55) continue; // only a thin creep of moss at the board ends
        const sz = rr(0.022, 0.04), ax = rr(0, 6.28); /* [house exterior round] a few small domes, not one flat squashed disc (read as a green blot painted on the board) */
        for (let j = 0, m = 2 + Math.floor(R() * 2); j < m && n < N; j++) { const q = p.clone().add(V(Math.cos(ax) * (j - (m - 1) / 2) * sz * 1.5, -sz * .12, Math.sin(ax) * (j - (m - 1) / 2) * sz * 1.5)), z = sz * rr(.7, 1.1); M4.compose(q, orient(UP, rr(0, 6.28)), S.set(z * rr(1, 1.3), z * .6, z * rr(.85, 1.1))); im.setMatrixAt(n, M4);
        const v = rr(0.8, 1.2); col.setRGB(0.06 * v, 0.088 * v, 0.026 * v); im.setColorAt(n++, col); }
      }
    }
    // the house grown into the tree: where a post, beam or landing board meets the trunk, moss creeps over the joint -
    // a cushion on the top of the wood right at the bark (water and dirt collect there) and a fringe on the bark above it
    { const tmp = V(0, 0, 0), sideV = V(0, 0, 0); D.joinMoss = 0;
      for (const b of D.bites) { if (n >= N) break; if (R() < (MOBILE ? 0.45 : 0.25)) continue; if (inBox(avoid, b.x, b.y + 0.1, b.z, 0.05) || nearDoor(b.x, b.y + 0.3, b.z)) continue;
        const ax = b.ax; const upOnBeam = V(0, 1, 0).addScaledVector(ax, -ax.y).normalize(); // the beam's top face direction
        const h = Math.min(...b.flat) * 0.5; // half thickness
        const k = MOBILE ? 2 + Math.floor(R() * 2) : 3 + Math.floor(R() * 3);
        for (let j = 0; j < k && n < N; j++) {
          const along = rr(0.0, 0.22) * (j ? 1 : 0.4); sideV.crossVectors(ax, upOnBeam).normalize();
          tmp.set(b.x, b.y, b.z).addScaledVector(ax, along + 0.02).addScaledVector(upOnBeam, h).addScaledVector(sideV, rr(-1, 1) * b.w * 0.7);
          const sz = rr(0.04, 0.085) * (1 - along * 1.6);
          M4.compose(tmp, orient(upOnBeam, rr(0, 6.28)), S.set(sz * rr(1.3, 2.1), sz * 0.32, sz * rr(0.9, 1.3))); im.setMatrixAt(n, M4);
          const v = rr(0.8, 1.2); col.setRGB(0.05 * v, 0.078 * v, 0.024 * v); im.setColorAt(n++, col); D.joinMoss++;
        }
        // a fringe on the bark just above the joint
        if (n < N && R() < 0.7) { const out = V(b.x - AX, 0, b.z - AZ).normalize(); tmp.set(b.x, b.y + h + rr(0.03, 0.1), b.z).addScaledVector(out, 0.01);
          const sz = rr(0.06, 0.1); M4.compose(tmp, orient(out.clone().lerp(UP, 0.4).normalize(), rr(0, 6.28)), S.set(sz * 2.2, sz * 0.3, sz * 1.1)); im.setMatrixAt(n, M4);
          const v = rr(0.8, 1.15); col.setRGB(0.045 * v, 0.07 * v, 0.022 * v); im.setColorAt(n++, col); D.joinMoss++; }
      } }
    // [house round] the trunk door: moss in the damp corners where the jambs meet the bark at the threshold (the bark round the
    // door was bare). Own rng stream so nothing placed after this moves. On the real carved triangles beside the jambs.
    D.doorMoss = 0;
    if (C.door) { const dr = C.door, RD = rng(7071), hw = dr.w / 2;
      const beside = sampler(q => { if (q.n.y < 0.4 || q.c.y < dr.y0 - 0.15 || q.c.y > dr.y0 + 0.18) return false; /* the threshold corners only, on bark that faces up */ const r = radial(q.c.x, q.c.z);
        const lat = Math.abs(angDiff(Math.atan2(q.c.z - AZ, q.c.x - AX), doorAng)) * r; return lat > hw + 0.07 && lat < hw + 0.4; }, RD);
      for (let k = 0; k < 60 && D.doorMoss < NDOOR; k++) { RSEED(586000 + k); const s = beside(); if (!s) break; const { p } = s;
        if (inBox(avoid, p.x, p.y, p.z, 0.02)) continue;
        const sz = 0.035 + RD() * 0.05; M4.compose(p.clone().addScaledVector(s.n, -sz * 0.2), orient(s.n, RD() * 6.28), S.set(sz * (1.1 + RD() * 0.4), sz * (0.45 + RD() * 0.2), sz)); im.setMatrixAt(n, M4);
        const v = 0.85 + RD() * 0.3; col.setRGB(0.075 * v, 0.11 * v, 0.03 * v); im.setColorAt(n++, col); D.doorMoss++; } }
    im.count = n; im.receiveShadow = true; D.group.add(im); D.moss = im;
  }

  // ================= 3. soil and leaf litter in the pockets between the roots =================
  RSEED(9000002); /* [determinism] each section starts from its own seed */
  {
    // pockets: ground spots right next to the wood (rootD small) close to the trunk, preferably hemmed in by roots on two sides
    const spots = [];
    for (let k = 0; k < 4000 && spots.length < 260 * MUL; k++) { RSEED(597000 + k);
      const a = rr(0, Math.PI * 2), d = rr(1.8, 5.2), x = AX + Math.cos(a) * d, z = AZ + Math.sin(a) * d;
      const rd = rootD(x, z); if (rd < 0.04 || rd > 0.55) continue;
      // hemmed in: wood both clockwise and anticlockwise within ~0.9 m
      let hem = 0; for (const s of [-1, 1]) for (let j = 1; j <= 4; j++) { const b = a + s * j * 0.22 / d * 1.0; if (rootD(AX + Math.cos(b) * d, AZ + Math.sin(b) * d) < 0.03) { hem++; break; } }
      if (hem < 1 || (hem < 2 && R() < 0.6)) continue;
      const y = groundH(x, z); if (nearDoor(x, y + 0.3, z) && R() < 0.5) continue;
      spots.push([x, y, z, rd, a, d]);
    }
    // soil mounds: low dark humps half buried, so the roots look like they grow out of earth, not out of a flat floor
    const sg = (() => { const s = new THREE.IcosahedronGeometry(1, MOBILE ? 0 : 1); s.deleteAttribute('normal'); s.deleteAttribute('uv'); const m = mergeVertices(s); m.computeVertexNormals(); return m; })();
    const smat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    smat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ntdP=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 tdP;' + NOISE)
        .replace('#include <map_fragment>', '#include <map_fragment>\n{float f=td_f(tdP*6.);float g=td_n(tdP*40.);diffuseColor.rgb*=.7+.5*f+.3*(g-.5);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.03,.045,.015),smoothstep(.55,.75,f)*.6);}');
    };
    smat.customProgramCacheKey = () => 'tdSoilMat1';
    // the soil humps share the moss cushions' instanced mesh (one draw call less)
    const soil = D.moss, NS = soil.instanceMatrix.count - soil.count, s0 = soil.count; let ns = 0; const soilA = soil.geometry.attributes.tdSoil;
    for (const [x, y, z, rd, a] of spots) {
      if (ns >= NS) break; if (R() < 0.55) continue;
      const w = rr(0.35, 0.75) * (0.6 + rd);
      M4.compose(V(x, y - 0.06, z), new THREE.Quaternion().setFromAxisAngle(UP, -a + rr(-0.3, 0.3)), S.set(w * 0.6, rr(0.08, 0.16), w)); soil.setMatrixAt(s0 + ns, M4);
      // [ladder-foot round] mossy earth, close to the floor's own tone (the near-black brown read as a hole); a few barer ones
      const v = rr(0.8, 1.1), hb = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5) % 1, bare = hb < 0.3 ? 0.3 + hb : hb * 0.25; /* a hash, not R(): the rng stream (and every placement after this) stays as it was */ col.setRGB((0.072 + 0.025 * bare) * v, (0.115 - 0.045 * bare) * v, (0.04 - 0.008 * bare) * v); soil.setColorAt(s0 + ns, col); soilA.setX(s0 + ns, 1); ns++;
    }
    soil.count = s0 + ns; D.soil = { count: ns };

    // fallen leaves: oak-leaf cards lying in the pockets, mostly brown and ochre, a few still green, some leaning on the roots
    const lg = new THREE.PlaneGeometry(1, 1); lg.rotateX(-Math.PI / 2);
    const lmat = new THREE.MeshStandardMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
    const NCAUGHT = Math.round(90 * MUL), NL = Math.round(420 * MUL), lit = new THREE.InstancedMesh(lg, lmat, NL + NCAUGHT + Math.round(16 * MUL)) /* + the fold leaves (autumn round) */; let nl = 0;
    const tints = [[0.62, 0.38, 0.2], [0.5, 0.3, 0.16], [0.75, 0.52, 0.22], [0.42, 0.3, 0.2], [0.55, 0.6, 0.3]];
    for (let k = 0; nl < NL && k < NL * 3; k++) { RSEED(631000 + k);
      const s = spots[Math.floor(R() * spots.length)]; if (!s) break;
      const [x0, , z0, rd] = s; const x = x0 + rr(-0.35, 0.35), z = z0 + rr(-0.35, 0.35);
      const r2 = rootD(x, z); if (r2 < 0.0) continue;
      const lean = r2 < 0.12 ? rr(0.3, 0.8) : rr(0, 0.25), y = groundH(x, z) + 0.02 + (r2 < 0.12 ? rr(0.02, 0.12) : rr(0, 0.05));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-lean, lean), rr(0, 6.28), rr(-lean, lean)));
      M4.compose(V(x, y, z), q, S.setScalar(rr(0.17, 0.27))); lit.setMatrixAt(nl, M4);
      const c = tints[Math.floor(R() * tints.length)], v = rr(0.75, 1.1); col.setRGB(c[0] * v * 1.2, c[1] * v * 1.2, c[2] * v * 1.2); lit.setColorAt(nl, col); nl++;
    }
    // autumn: leaves blown onto the root tops and caught on bark ledges and in the furrows of the lower trunk
    {
      const ledges = sampler(q => q.n.y > 0.35 && q.c.y > 0.1 && q.c.y < 4.5 && !(radial(q.c.x, q.c.z) < 2.4 && q.n.y > 0.9));
      let nc = 0;
      for (let k = 0; k < NCAUGHT * 6 && nc < NCAUGHT; k++) { RSEED(644000 + k);
        const s0 = ledges(); if (!s0) break; const p = s0.p;
        if (blocked(p.x, p.y + 0.05, p.z, 0.08) || nearDoor(p.x, p.y, p.z)) continue;
        // in little drifts: keep a spot only where a slow noise says leaves gather
        if (Math.sin(p.x * 2.3 + p.z * 1.1) + Math.sin(p.z * 2.9 - p.y * 1.7) < 0.3) continue;
        const up = s0.n.clone().lerp(UP, 0.4).normalize();
        const q = orient(up, rr(0, 6.28)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.4, 0.4), 0, rr(-0.4, 0.4))));
        M4.compose(p.clone().addScaledVector(s0.n, 0.012), q, S.setScalar(rr(0.13, 0.22))); lit.setMatrixAt(nl, M4);
        const c = tints[Math.floor(R() * 4)], v = rr(0.8, 1.15); col.setRGB(c[0] * v * 1.25, c[1] * v * 1.2, c[2] * v * 1.1); lit.setColorAt(nl++, col); nc++;
      }
      D.caughtLeaves = nc;
      // [autumn round] a few more higher up, in the bark folds of the trunk between the landings (where a gust drops them), own rng
      // so nothing placed after this moves. Trunk only (near the axis): out on the limbs they would not follow the limb sway.
      { const R2 = rng(7073), folds = sampler(q => q.n.y > 0.3 && q.c.y > 4.5 && q.c.y < 8.5 && radial(q.c.x, q.c.z) < 2.4, R2); let nu = 0; const NU = Math.round(16 * MUL);
        for (let k = 0; k < NU * 8 && nu < NU && nl < lit.count; k++) { const s0 = folds(); if (!s0) break; const p = s0.p;
          if (blocked(p.x, p.y + 0.05, p.z, 0.08)) continue;
          const up = s0.n.clone().lerp(UP, 0.4).normalize(), q = orient(up, R2() * 6.28);
          const sz = 0.12 + R2() * 0.08; M4.compose(p.clone().addScaledVector(s0.n, 0.012), q, S.setScalar(sz)); lit.setMatrixAt(nl, M4);
          const c = tints[Math.floor(R2() * 4)], v = 0.8 + R2() * 0.3; col.setRGB(c[0] * v * 1.25, c[1] * v * 1.2, c[2] * v * 1.1); lit.setColorAt(nl++, col); nu++; }
        D.foldLeaves = nu; }
    }
    lit.count = nl; lit.receiveShadow = true; D.group.add(lit); D.litter = lit; D.pockets = spots.length;
    // [draw-call round] one draw less on phones (298/300 there): bake these leaves into Ground's litter mesh instead of drawing them
    // as their own instanced mesh. Ground's atlas has three cells (its floor leaf | white | lily pad) and our leaves are the crown's
    // own leaf picture, which it does not hold: the atlas grows a fourth cell with that picture and every u already on Ground's
    // litter (and on its skitter leaves, which read the same map) is scaled by 3/4, so each keeps its exact texel. Our vertices go
    // at the end, so Ground's own ranges keep their indices. Desktop keeps its own mesh (full-resolution picture, the draws are free).
    D.litterMerged = false;
    // The phone's leafT is a KTX2 (GPU-compressed, no pixels to draw), so the cell is painted from leaf2-128.png (31 KB, the same
    // picture at the cell's own 128 px), loaded after start; until it arrives our leaves draw on their own as before.
    const bakeLitter = li => { const G = C.groundG, gl = G && G.litter, gm = gl && gl.material && gl.material.map, cv0 = gm && gm.image, sk = G && G.skitter;
      const og = gl && gl.geometry, A = og && og.attributes;
      const ok = MOBILE && cv0 && cv0.width === 384 && cv0.height === 128 && li && li.width && A && A.position && A.normal && A.uv && A.color && A.aCap && A.aFl && Object.keys(A).length === 6
        && (!sk || (sk.material.map === gm && sk.geometry.attributes.uv));
      if (ok) {
        const g0 = lg.toNonIndexed(), P = g0.attributes.position, Nn = g0.attributes.normal, Uv = g0.attributes.uv, n = P.count, m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), ic = new THREE.Color(), v = V();
        const tot = n * lit.count, pos = new Float32Array(tot * 3), nor = new Float32Array(tot * 3), uv = new Float32Array(tot * 2), cl = new Float32Array(tot * 3), cap = new Float32Array(tot), afl = new Float32Array(tot * 4);
        for (let i = 0; i < lit.count; i++) { lit.getMatrixAt(i, m4); nm.getNormalMatrix(m4); if (lit.instanceColor) lit.getColorAt(i, ic); else ic.setRGB(1, 1, 1);
          for (let k = 0; k < n; k++) { const o = i * n + k; v.fromBufferAttribute(P, k).applyMatrix4(m4); pos.set([v.x, v.y, v.z], o * 3); v.fromBufferAttribute(Nn, k).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], o * 3);
            uv[o * 2] = (3 + Math.min(0.98, Math.max(0.02, Uv.getX(k)))) / 4; uv[o * 2 + 1] = Uv.getY(k); cl.set([ic.r, ic.g, ic.b], o * 3); afl.set([0, 0, 0, -1], o * 4); } }
        const add = new THREE.BufferGeometry(); add.setAttribute('position', new THREE.BufferAttribute(pos, 3)); add.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); add.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        add.setAttribute('color', new THREE.BufferAttribute(cl, 3)); add.setAttribute('aCap', new THREE.BufferAttribute(cap, 1)); add.setAttribute('aFl', new THREE.BufferAttribute(afl, 4));
        if (og.index) { const ix = new Uint32Array(tot); for (let k = 0; k < tot; k++) ix[k] = k; add.setIndex(new THREE.BufferAttribute(ix, 1)); }
        const merged = mergeGeometries([og, add]);
        if (merged) {
          const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const x = cv.getContext('2d'); x.drawImage(cv0, 0, 0); x.drawImage(li, 384, 0, 128, 128);
          const su = (g, cnt) => { const u = g.attributes.uv; for (let k = 0; k < cnt; k++) u.setX(k, u.getX(k) * 0.75); u.needsUpdate = true; };
          su(merged, A.uv.count); if (sk) su(sk.geometry, sk.geometry.attributes.uv.count);
          gm.image = cv; gm.needsUpdate = true;
          gl.geometry = merged; og.dispose(); D.group.remove(lit); lit.visible = false; D.litterMerged = true;
        }
        add.dispose(); g0.dispose();
      }
      D.bakeIvyStems(); };
    D.bakeIvyStems = () => {};
    if (MOBILE && C.groundG && C.groundG.litter) { const im = new Image(); im.onload = () => { try { bakeLitter(im); } catch (e) { console.warn('treedress litter bake', e); } }; im.src = (window.__ASSET || '') + 'leaf2-128.png'; }
  }

  // ================= 4. ivy climbing the lower trunk =================
  RSEED(9000003); /* [determinism] each section starts from its own seed */
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
    const imat = swayMat(tdWetU(onTree(new THREE.MeshStandardMaterial({ map: ivyTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xb8c4b0, emissive: 0x050c07, emissiveMap: ivyTex }))), U, 0.05, FLUTTER);
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
        if (R() < 0.38 + 0.32 * thin) addLeaf(p.clone().addScaledVector(side, rr(0.03, 0.09)), out, rr(0.12, 0.19) * (0.7 + 0.5 * thin));
        if (R() < 0.3 + 0.32 * thin) addLeaf( /* [home-view round] ~30% fewer leaves: the vines read as dense dark curtains on the clean photo trunk (same R() calls, so the layout stays) */p.clone().addScaledVector(side, -rr(0.03, 0.09)), out, rr(0.12, 0.19) * (0.7 + 0.5 * thin));
        if (depth < 1 && R() < 0.05) climb(a + (R() < 0.5 ? -1 : 1) * 0.15, y + 0.1, Math.min(top, y + rr(0.6, 1.4)), depth + 1);
      }
      if (pts.length > 2) stems.push({ pts, r: depth ? 0.009 : 0.016 });
      D.vineLen = (D.vineLen || []).concat([[+a.toFixed(2), pts.length ? +pts[0].y.toFixed(1) : -1, +y.toFixed(1)]]);
    };
    for (const [vi, [a0, top]] of vines.entries()) { RSEED(760000 + vi); const a = a0 + rr(-0.1, 0.1); let y = 0.1; while (y < 1.6 && surf(a, y) > 3.0) y += 0.1; climb(a, y, top * (MOBILE ? 0.9 : 1), 0); }
    // higher up: short vines on the trunk between the rooms (they start in a free gap and stop at the next floor or wall)
    {
      let made = 0;
      for (let k = 0; k < 400 && made < (MOBILE ? 5 : 9); k++) { RSEED(764000 + k);
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
      for (let k = 0; k < 120 && strands < (MOBILE ? 10 : 18) && cand.length; k++) { RSEED(785000 + k);
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
    // ivy where the house meets the trunk: a few sprigs climb off the bark onto the post or beam (the beam is a blocker, so
    // these leaves skip the blocked() test and only keep out of the rooms)
    { D.joinIvy = 0; const sideV = V(0, 0, 0); let made = 0;
      const put = (p, out, size) => { if (nl >= NLV || inBox(avoid, p.x, p.y, p.z, 0.03)) return; const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), out.clone().add(V(rr(-0.3, 0.3), rr(0, 0.3), rr(-0.3, 0.3))).normalize());
        q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rr(-0.9, 0.9))); M4.compose(p, q, S.setScalar(size)); leaves.setMatrixAt(nl, M4);
        const v = rr(0.75, 1.15); col.setRGB(v * rr(0.9, 1.05), v, v * rr(0.85, 1)); if (R() < 0.08) col.setRGB(1.35, 1.1, 0.6); leaves.setColorAt(nl++, col); D.joinIvy++; };
      for (const b of D.bites) { if (made >= (MOBILE ? 10 : 22)) break; RSEED(808000 + ((Math.round(b.x * 20) * 7349 + Math.round(b.y * 20) * 3389 + Math.round(b.z * 20) * 1531) & 0xfffff)); if (R() < 0.5) continue; if (inBox(avoid, b.x, b.y + 0.1, b.z, 0.05) || nearDoor(b.x, b.y + 0.3, b.z)) continue; made++; (D.joinAt = D.joinAt || []).push([+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)]);
        const out = V(b.x - AX, 0, b.z - AZ).normalize(); const ax = b.ax, vert = Math.abs(ax.y) > 0.7;
        // horizontal wood (landing boards, joists, braces): creep along a side face, never on the top people walk on; posts: the outer face
        const fv = vert ? out.clone() : V(0, 1, 0).cross(ax).normalize().multiplyScalar(R() < 0.5 ? -1 : 1); const up = fv; sideV.crossVectors(ax, fv).normalize(); const h = vert ? b.w : Math.max(...b.flat) * 0.5;
        // on the bark round the joint
        for (let j = 0; j < (MOBILE ? 3 : 5); j++) { const a = rr(0, 6.28), rad = b.w + rr(0.04, 0.22); put(V(b.x, b.y, b.z).addScaledVector(sideV, Math.cos(a) * rad).add(V(0, Math.sin(a) * rad, 0)).addScaledVector(out, 0.03), out, rr(0.1, 0.16)); }
        // creeping out along the wood, on its top and sides, thinning out
        const reach = rr(0.2, Math.min(0.7, b.len * 0.4)), side = R() < 0.5 ? -1 : 1, pts = [];
        for (let t = 0.04; t < reach; t += 0.07) { const sw = Math.sin(t * 9 + b.x) * 0.5; const p = V(b.x, b.y, b.z).addScaledVector(ax, t).addScaledVector(up, h + 0.012).addScaledVector(sideV, sw * side * (vert ? b.w * 0.8 : Math.min(...b.flat) * 0.5));
          pts.push(p.clone()); if (R() < 0.85 - t) put(p.clone().addScaledVector(sideV, vert ? rr(-0.05, 0.05) : 0), up.clone().addScaledVector(sideV, rr(-0.6, 0.6)).normalize(), rr(0.08, 0.13) * (1 - t * 0.6)); }
        if (pts.length > 2) stems.push({ pts, r: 0.008 }); // phones too: without the stem the sprig's leaves floated loose along the beam
      }
      D.joinIvyAt = made; }
    leaves.count = nl; leaves.receiveShadow = true; leaves.castShadow = !MOBILE; D.group.add(leaves); D.ivy = leaves;
    const sgs = stems.map(s => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s.pts), Math.max(3, Math.round(s.pts.length * (MOBILE ? 0.7 : 1.5))), s.r, MOBILE ? 3 : 4, false));
    if (sgs.length && !MOBILE) { const sm = new THREE.Mesh(mergeGeometries(sgs), new THREE.MeshStandardMaterial({ color: 0x3a3424, roughness: 0.9 })); sm.receiveShadow = true; D.group.add(sm); D.ivyStems = sm; }
    // [draw-call round] phones had no ivy stems at all (a mesh of their own costs a draw at 298/300): the leaves of every vine and
    // of the sprigs on the beams floated loose. Bake them into Ground's litter mesh instead, on the plain white cell of its atlas
    // (uv .5,.5) with the stem colour in the vertex colour: no new draw.
    D.ivyStemsBaked = false;
    if (sgs.length && MOBILE) D.bakeIvyStems = () => { if (D.ivyStemsBaked || !D.litterMerged) return; const gl = C.groundG.litter, og = gl.geometry, sg = mergeGeometries(sgs).toNonIndexed(); const n = sg.attributes.position.count;
      if (!sg.attributes.normal) sg.computeVertexNormals();
      const c = new THREE.Color(0x3a3424), uv = new Float32Array(n * 2), cl = new Float32Array(n * 3), afl = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) { uv[k * 2] = 0.375; uv[k * 2 + 1] = 0.5; /* centre of the white cell, after the atlas grew to 4 cells */ cl.set([c.r, c.g, c.b], k * 3); afl.set([0, 0, 0, -1], k * 4); }
      const add = new THREE.BufferGeometry(); add.setAttribute('position', sg.attributes.position); add.setAttribute('normal', sg.attributes.normal); add.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      add.setAttribute('color', new THREE.BufferAttribute(cl, 3)); add.setAttribute('aCap', new THREE.BufferAttribute(new Float32Array(n), 1)); add.setAttribute('aFl', new THREE.BufferAttribute(afl, 4));
      if (og.index) { const ix = new Uint32Array(n); for (let k = 0; k < n; k++) ix[k] = k; add.setIndex(new THREE.BufferAttribute(ix, 1)); }
      const merged = mergeGeometries([og, add]); if (merged) { gl.geometry = merged; og.dispose(); D.ivyStemsBaked = true; } add.dispose(); sg.dispose(); }
  }

  // ================= 5. ferns and grass tufts in root crevices and forks =================
  RSEED(9000004); /* [determinism] each section starts from its own seed */
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
        const g = new THREE.PlaneGeometry(0.16, 1, 1, MOBILE ? 5 : 8); const p = g.attributes.position; const a = f / 7 * Math.PI * 2 + (f % 2) * 0.3, L = 0.75 + (f % 3) * 0.12, tilt = 0.55 + (f % 2) * 0.25;
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
    const fmat = swayMat(tdWetU(onTree(new THREE.MeshStandardMaterial({ map: fernTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, emissive: 0x0a1a12, emissiveMap: fernTex }))), U, 0.06,
      // [wind round] the fronds bend with Wind's shared gusts (the same front that runs through the crown, so a gust reaches them
      // on its way to the tree), a slow nod in calm; plus a faint leaflet shiver that grows with the gust. Old sine sway as fallback.
      `{vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);float k=clamp(uv.y,0.,1.);k*=k;
#ifdef WIND_GLSL_ON
       vec2 w=windSway(ip,1.5);float sh=sin(uT*6.1+position.x*9.+ip.z*5.)*.05*min(length(w),1.5);
       transformed+=windLocal(vec3(w.x,0.,w.y)*SW*k*1.1+vec3(0.,sh*SW*k,0.));
#else
       float gust=.6+.4*sin(uT*.35+ip.x*.05);transformed.x+=sin(uT*1.6+ip.x*.7+ip.z*.4)*SW*k*uW*gust;transformed.z+=sin(uT*1.2+ip.z*.9)*SW*.7*k*uW*gust;
#endif
      }`);
    // grass tuft: a fan of narrow curved blades
    const tuftG = (() => {
      const parts = [];
      const NB = MOBILE ? 6 : 9; for (let b = 0; b < NB; b++) {
        const g = new THREE.PlaneGeometry(MOBILE ? 0.045 : 0.035, 1, 1, MOBILE ? 3 : 4); const p = g.attributes.position; const a = b / 9 * Math.PI * 2 + b * 0.7, L = 0.28 + (b % 4) * 0.07, lean = 0.25 + (b % 3) * 0.15;
        for (let i = 0; i < p.count; i++) { const t = p.getY(i) + 0.5, w = p.getX(i) * (1 - t * 0.85); const out = lean * t * t * L; p.setXYZ(i, Math.cos(a) * out - Math.sin(a) * w, t * L, Math.sin(a) * out + Math.cos(a) * w); }
        g.computeVertexNormals(); parts.push(g);
      }
      return mergeGeometries(parts);
    })();
    const tmat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 }); tmat.userData.wind = true;
    // [wind round] grass blades: Wind's grass sway (freq 1.7), so the gust front that runs through the crown passes over them too
    swayMat(tmat, U, 0.05,
      `{vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);float k=clamp(position.y/.5,0.,1.);k*=k;
#ifdef WIND_GLSL_ON
       vec2 w=windSway(ip,1.7);transformed+=windLocal(vec3(w.x,0.,w.y))*SW*k*1.3;
#else
       transformed.x+=sin(uT*2.+ip.x*1.7+ip.z)*SW*k*uW;transformed.z+=sin(uT*1.5+ip.z*1.9)*SW*.6*k*uW;
#endif
      }`);
    tmat.onBeforeCompile = (prev => (s, r) => { prev(s, r); s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb*=mix(.35,1.15,tdH);'); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float tdH;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntdH=clamp(position.y/.45,0.,1.);'); s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float tdH;'); })(tmat.onBeforeCompile);
    { const k0 = tmat.customProgramCacheKey; tmat.customProgramCacheKey = () => k0() + '|tdTufts1'; }

    const NF = Math.round(26 * MUL), NFK = Math.round(14 * MUL), NF2 = NF + NFK, NTF = Math.round((MOBILE ? 60 : 110) * MUL);
    const ferns = new THREE.InstancedMesh(fernG, fmat, NF2), tufts = new THREE.InstancedMesh(tuftG, tmat, NTF);
    let nf = 0, nt = 0;
    // crevices: where two roots meet the trunk foot (ground just next to wood, close to the axis)
    const crev = [];
    for (let k = 0; k < 3000 && crev.length < 120; k++) { RSEED(904000 + k);
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
    for (let k = 0; k < 400 && (nf < NF || nt < NTF); k++) { RSEED(915000 + k);
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
    for (let k = 0; k < 600 && nf < NF2; k++) { RSEED(927000 + k);
      const s0 = highForks(); if (!s0) break; const p = s0.p;
      if (blocked(p.x, p.y + 0.3, p.z, 0.3)) continue;
      // a fork: wood rises again close by on at least one side (the surface curves up around this spot)
      let walls = 0; for (const [dx, dz] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) { const hs = colTop(p.x + dx, p.z + dz, p.y); if (hs > p.y + 0.15 && hs < p.y + 0.8) walls++; }
      if (walls < 2) continue;
      M4.compose(p.clone().addScaledVector(s0.n, -0.03), orient(s0.n.clone().lerp(UP, 0.7).normalize(), rr(0, 6.28)), S.setScalar(rr(0.3, 0.5))); ferns.setMatrixAt(nf, M4); ferns.setColorAt(nf++, col.setRGB(0.95, 0.95, 0.95));
      D.forkFerns = (D.forkFerns || 0) + 1;
    }
    ferns.count = nf; tufts.count = nt; ferns.receiveShadow = tufts.receiveShadow = true; D.group.add(ferns); if (!MOBILE) D.group.add(tufts); /* phones: the root-crevice grass tufts covered ~0.1% of the screen (Ground's grass is right there) - not worth a draw call */ D.ferns = ferns; D.tufts = tufts;
  }

  // ================= 6. mushrooms on the wood: bracket fungi on the trunk foot, little caps on the roots =================
  RSEED(9000005); /* [determinism] each section starts from its own seed */
  {
    const env = C.env || window.__env || {}; const glowU = env.shroomGlow || { value: 0 };
    const paint = (g, f) => { const p = g.attributes.position; const c = new Float32Array(p.count * 3), a = new Float32Array(p.count); for (let i = 0; i < p.count; i++) { const r = f(p.getX(i), p.getY(i), p.getZ(i)); c.set(r[0], i * 3); a[i] = r[1]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aCap', new THREE.BufferAttribute(a, 1)); return g.toNonIndexed(); };
    // small cap: stem + domed cap with darker gills, local +y up, about 1 unit tall
    const cap = new THREE.SphereGeometry(1, MOBILE ? 8 : 12, MOBILE ? 3 : 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.6, 1).translate(0, 0.9, 0);
    const gill = new THREE.CircleGeometry(0.97, MOBILE ? 8 : 12).rotateX(Math.PI / 2).translate(0, 0.9, 0);
    const stem = new THREE.CylinderGeometry(0.2, 0.3, 0.95, MOBILE ? 5 : 7, 1).translate(0, 0.47, 0);
    const smallG = mergeGeometries([paint(stem, () => [[0.8, 0.76, 0.66], 0]), paint(gill, () => [[0.5, 0.4, 0.32], 0.1]), paint(cap, (x, y) => { const k = smooth(0.9, 1.45, y); return [[0.55 + k * 0.3, 0.3 + k * 0.12, 0.18 + k * 0.05], smooth(0.95, 1.4, y) * 0.8]; })]);
    // bracket (shelf) fungus: a thick half-disc sticking out of the bark along local +z, pale rim, brown banded top
    const br = new THREE.SphereGeometry(1, 14, 6, -Math.PI / 2, Math.PI, 0, Math.PI * 0.5).scale(1, 0.32, 0.85);
    const brU = new THREE.CircleGeometry(1, 14, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 1, 0.85);
    const bracketG = mergeGeometries([paint(br, (x, y, z) => { const r = Math.hypot(x, z / 0.85); const band = 0.5 + 0.5 * Math.sin(r * 22); const k = smooth(0.7, 1, r); return [[0.36 + band * 0.08 + k * 0.4, 0.25 + band * 0.05 + k * 0.32, 0.16 + band * 0.03 + k * 0.22], 0]; }), paint(brU, () => [[0.72, 0.64, 0.5], 0])]);
    const mk = () => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }); m.customProgramCacheKey = () => 'tdFungi1'; m.onBeforeCompile = sh => { sh.uniforms.uGlow = glowU; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCap;varying float vCap;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCap=aCap;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;varying float vCap;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.5,.2)*vCap*uGlow;'); }; return m; };
    const NSM = Math.round(64 * MUL), NBR = Math.round(16 * MUL), NBASE = Math.round(16 * MUL);
    const small = new THREE.InstancedMesh(smallG, mk(), NSM), brk = new THREE.InstancedMesh(bracketG, mk(), NBR);
    // small caps: clusters on the tops and flanks of the roots
    const onRoots = sampler(q => q.n.y > 0.35 && q.c.y > 0.05 && q.c.y < 1.1 && radial(q.c.x, q.c.z) > 2.4);
    // sit each cap on the surface that is really drawn there (critic: they were gone): the carved roots and the rendered ground
    // differ from the sampled triangles / groundH by up to ~12 cm. Down-ray against the bark and the ground mesh; the first hit is the
    // surface. A cap under an overhang (something solid well above it) is left out: it could never be seen.
    const tSnap = performance.now();
    // (a) the bark: the final carved triangles (TREE.tris) bucketed by 0.3 m cells, low ones only; a vertical ray is a 2D point-in-triangle test
    const CS = 0.3, cells = new Map(), ck = (i, j) => i * 4096 + j; const T = (() => { const bk = TREE.bark, bg = bk && bk.geometry, pa = bg && bg.attributes.position; if (!pa) return TREE.tris; bk.updateMatrixWorld(true); const ix = bg.index ? bg.index.array : null, n = ix ? ix.length : pa.count, o = new Float32Array(n * 3), v = new THREE.Vector3(); for (let i = 0; i < n; i++) { v.fromBufferAttribute(pa, ix ? ix[i] : i).applyMatrix4(bk.matrixWorld); o[i * 3] = v.x; o[i * 3 + 1] = v.y; o[i * 3 + 2] = v.z; } return o; })(), nT = T.length / 9; // the bark AS DRAWN (index after the thin-shoot cut): TREE.tris still holds triangles the mesh no longer draws, and caps snapped onto them floated (Ground: caps on the root bark)
    for (let t = 0; t < nT; t++) { const i = t * 9; const y0 = Math.min(T[i + 1], T[i + 4], T[i + 7]); if (y0 > 2.2) continue;
      const x0 = Math.min(T[i], T[i + 3], T[i + 6]), x1 = Math.max(T[i], T[i + 3], T[i + 6]), z0 = Math.min(T[i + 2], T[i + 5], T[i + 8]), z1 = Math.max(T[i + 2], T[i + 5], T[i + 8]);
      for (let a = Math.floor(x0 / CS); a <= Math.floor(x1 / CS); a++) for (let b = Math.floor(z0 / CS); b <= Math.floor(z1 / CS); b++) { const k = ck(a, b); let L = cells.get(k); if (!L) cells.set(k, L = []); L.push(t); } }
    const barkTop = (x, z, yMax, up) => { const L = cells.get(ck(Math.floor(x / CS), Math.floor(z / CS))); if (!L) return null; let best = null;
      for (const t of L) { const i = t * 9; const ax = T[i], az = T[i + 2], bx = T[i + 3], bz = T[i + 5], cx = T[i + 6], cz = T[i + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue; const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue; if (up && (T[i + 5] - T[i + 2]) * (T[i + 6] - T[i]) - (T[i + 3] - T[i]) * (T[i + 8] - T[i + 2]) <= 0) continue; /* only a top face can carry a cap: a root's underside skin (back face from above) left them 5 cm over the drawn top */ const y = u * T[i + 1] + v * T[i + 4] + w * T[i + 7]; if (y <= yMax && (best === null || y > best)) best = y; }
      return best; };
    // (b) the ground as drawn: the ground mesh's own grid (bilinear), not groundH (its fine noise is not in the 128-cell mesh)
    let gridH = null;
    if (C.ground && C.ground.geometry) { const gm = C.ground; gm.updateMatrixWorld(true); const P = gm.geometry.attributes.position, W = [], v = V(); let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(gm.matrixWorld); W.push(v.x, v.y, v.z); mnx = Math.min(mnx, v.x); mxx = Math.max(mxx, v.x); mnz = Math.min(mnz, v.z); mxz = Math.max(mxz, v.z); }
      const n = Math.round(Math.sqrt(P.count)); if (n * n === P.count) { const H = new Float32Array(P.count); const sx = (mxx - mnx) / (n - 1), sz = (mxz - mnz) / (n - 1);
        for (let i = 0; i < P.count; i++) { const a = Math.round((W[i * 3] - mnx) / sx), b = Math.round((W[i * 3 + 2] - mnz) / sz); H[b * n + a] = W[i * 3 + 1]; }
        gridH = (x, z) => { const fx = (x - mnx) / sx, fz = (z - mnz) / sz; if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return null; const a = Math.floor(fx), b = Math.floor(fz), tx = fx - a, tz = fz - b;
          return (H[b * n + a] * (1 - tx) + H[b * n + a + 1] * tx) * (1 - tz) + (H[(b + 1) * n + a] * (1 - tx) + H[(b + 1) * n + a + 1] * tx) * tz; }; } }
    const snap = (p, maxUp = 0.45) => {
      const over = barkTop(p.x, p.z, 9); if (over !== null && over > p.y + maxUp) return null;   // under an overhang: never seen
      const bt = barkTop(p.x, p.z, p.y + maxUp, true), gh = gridH ? gridH(p.x, p.z) : null;
      const y = Math.max(bt ?? -1e9, gh ?? -1e9); if (y < -1e8 || y < p.y - 0.35) return null; p.y = y - 0.008; return p; };
    let ns = 0;
    for (let k = 0; k < 500 && ns < NSM - NBASE * 3; k++) { RSEED(984000 + k);
      const s0 = onRoots(); if (!s0) break; const p0 = s0.p; if (p0.z < AZ - 0.5 && R() < 0.75) continue; if (blocked(p0.x, p0.y + 0.2, p0.z, 0.1) || nearDoor(p0.x, p0.y, p0.z)) continue;
      const cnt = 2 + Math.floor(R() * 4);
      for (let j = 0; j < cnt && ns < NSM; j++) {
        const p = snap(p0.clone().add(V(rr(-0.12, 0.12), 0, rr(-0.12, 0.12)))); if (!p) continue;
        const up = s0.n.clone().lerp(UP, 0.65).normalize(); const sz = rr(0.025, 0.06) * (j === 0 ? 1.35 : 1);
        M4.compose(p, orient(up, rr(0, 6.28)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.25, 0.25), 0, rr(-0.25, 0.25)))), S.set(sz, sz * rr(0.9, 1.5), sz));
        small.setMatrixAt(ns, M4); col.setHSL(rr(0.03, 0.08), rr(0.45, 0.75), rr(0.55, 0.75)); small.setColorAt(ns++, col);
      }
    }
    // a few at the very foot of the roots, where they meet the soil
    for (let k = 0; k < 2000 && ns < NSM; k++) { RSEED(995000 + k);
      const a = rr(0, 6.28), d = rr(2.4, 7.5), x = AX + Math.cos(a) * d, z = AZ + Math.sin(a) * d, r2 = rootD(x, z);
      if (r2 < 0.02 || r2 > 0.14 || blocked(x, 0.5, z, 0.1) || nearDoor(x, 0.4, z)) continue;
      if (D.baseShroom === undefined) D.baseShroom = 0; if (D.baseShroom >= NBASE) break;
      const cnt = 2 + Math.floor(R() * 3), y0 = groundH(x, z);
      for (let j = 0; j < cnt && ns < NSM; j++) {
        const px = x + rr(-0.1, 0.1), pz = z + rr(-0.1, 0.1); const sz = rr(0.03, 0.065) * (j === 0 ? 1.3 : 1);
        const gp = snap(V(px, groundH(px, pz), pz)); if (!gp) continue;
        M4.compose(gp, new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.2, 0.2), rr(0, 6.28), rr(-0.2, 0.2))), S.set(sz, sz * rr(1, 1.6), sz));
        small.setMatrixAt(ns, M4); col.setHSL(rr(0.02, 0.09), rr(0.4, 0.7), rr(0.5, 0.72)); small.setColorAt(ns++, col);
      }
      D.baseShroom++;
    }
    // bracket fungi: stacked shelves on steep bark low on the trunk, mostly on the shady sides
    const onTrunk = sampler(q => Math.abs(q.n.y) < 0.3 && q.c.y > 0.5 && q.c.y < 3.4 && radial(q.c.x, q.c.z) < 3.6);
    let nb = 0;
    for (let k = 0; k < 300 && nb < NBR; k++) { RSEED(1011000 + k);
      const s0 = onTrunk(); if (!s0) break; const p0 = s0.p; if (s0.n.z < -0.3 && R() < 0.7) continue; // mostly on the sides and front-sides, where they are seen
      if (blocked(p0.x, p0.y, p0.z, 0.25) || nearDoor(p0.x, p0.y, p0.z)) continue;
      const out = V(s0.n.x, 0, s0.n.z).normalize(); const yaw = Math.atan2(out.x, out.z); const cnt = 1 + Math.floor(R() * 3);
      for (let j = 0; j < cnt && nb < NBR; j++) {
        const sz = rr(0.09, 0.17) * (1 - j * 0.2); const p = p0.clone().add(V(0, j * rr(0.09, 0.14), 0)).addScaledVector(out, -sz * 0.15);
        M4.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.1, 0.05), yaw + rr(-0.3, 0.3), rr(-0.15, 0.15), 'YXZ')), S.setScalar(sz));
        brk.setMatrixAt(nb, M4); const v = rr(0.8, 1.1); brk.setColorAt(nb++, col.setRGB(v, v * rr(0.95, 1.02), v * rr(0.9, 1)));
      }
    }
    small.count = ns; brk.count = nb; if (typeof window !== 'undefined') window.__shroomSnapMs = Math.round(performance.now() - tSnap);
    // bake both kinds into one plain mesh (they never move): one draw call instead of two
    const bake = (im, out) => { const m = new THREE.Matrix4(), c = new THREE.Color(); for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); im.getColorAt(i, c); const g2 = im.geometry.clone().applyMatrix4(m); const ca = g2.attributes.color; for (let k = 0; k < ca.count; k++) ca.setXYZ(k, ca.getX(k) * c.r, ca.getY(k) * c.g, ca.getZ(k) * c.b); out.push(g2); } };
    const parts = []; bake(small, parts); bake(brk, parts);
    const fung = new THREE.Mesh(parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry(), mk()); fung.name = 'fungi'; fung.userData.counts = { small: ns, brackets: nb, base: D.baseShroom || 0 }; fung.receiveShadow = !MOBILE; fung.castShadow = !MOBILE;
    small.dispose(); brk.dispose(); D.group.add(fung); D.shrooms = { count: ns }; D.brackets = { count: nb }; D.fungi = fung;
  }

  // ================= 7. hanging moss and lichen strands under the lower limbs (sway like ropes: wind.js windRope) =================
  RSEED(9000006); /* [determinism] each section starts from its own seed */
  {
    const tex = (() => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d'); const r = rng(99);
      for (let i = 0; i < 46; i++) {
        const x0 = 32 + (r() + r() - 1) * 22, len = 80 + r() * 170, w = 0.8 + r() * 1.6; const c = 120 + r() * 60;
        x.strokeStyle = `rgba(${c * 0.9 | 0},${c | 0},${c * 0.8 | 0},${0.65 + r() * 0.35})`; /* pale grey-green beard lichen (it read as bright green ribbons) */ x.lineWidth = w; x.beginPath(); x.moveTo(x0, 0);
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
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xbcbcac });
    mat.onBeforeCompile = sh => {
      const W = window.__wind; if (!W) return; W.hook(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);float len=length(instanceMatrix[1].xyz);float t=clamp(-position.y,0.,1.);
       vec3 off=windRope(ip,t,len)*3.5+windBranch(ip,vec2(${AX.toFixed(3)},${AZ.toFixed(3)}));
       transformed+=windLocal(off);}`);
    };
    mat.customProgramCacheKey = () => 'tdHanging1'; /* SHADERS rule */
    const N = Math.round(45 * MUL), im = new THREE.InstancedMesh(g, mat, N); let n = 0;
    const under = sampler(q => q.n.y < -0.35 && q.c.y > 3.6 && q.c.y < 10.5 && radial(q.c.x, q.c.z) > 2.2);
    for (let k = 0; k < 600 && n < N; k++) { RSEED(1059000 + k);
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
  RSEED(9000007); /* [determinism] each section starts from its own seed */
  // Same leaf and palette as Ground's fallen leaves (ground.js), so the boards and the forest floor match.
  // Only in corners and along the trunk / board ends, never on the hero's walking lines (read from the hero's walk graph
  // once it exists, so this is placed lazily on the first frames).
  {
    const GL = window.__ground && window.__ground.leaves;
    const boardsIM = (C.blockers || [])[0];
    D.boardLeaves = null;
    const bakeToLitter = im => { const G = window.__ground, gl = G && G.litter, gm = gl && gl.material && gl.material.map, cv = gm && gm.image, og = gl && gl.geometry, A = og && og.attributes;
      if (!cv || !(cv.width === 384 || cv.width === 512) || cv.height !== 128 || !A || Object.keys(A).length !== 6 || !A.aCap || !A.aFl || !im.geometry.attributes.uv) return false;
      const cells = cv.width / 128, g0 = im.geometry.index ? im.geometry.toNonIndexed() : im.geometry, P = g0.attributes.position, Nn = g0.attributes.normal, Uv = g0.attributes.uv, Cv = g0.attributes.color, k0 = P.count;
      const tot = k0 * im.count, pos = new Float32Array(tot * 3), nor = new Float32Array(tot * 3), uv = new Float32Array(tot * 2), cl = new Float32Array(tot * 3), afl = new Float32Array(tot * 4), m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), ic = new THREE.Color(), v = V();
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); nm.getNormalMatrix(m4); if (im.instanceColor) im.getColorAt(i, ic); else ic.setRGB(1, 1, 1);
        for (let k = 0; k < k0; k++) { const o = i * k0 + k; v.fromBufferAttribute(P, k).applyMatrix4(m4); pos.set([v.x, v.y, v.z], o * 3); v.fromBufferAttribute(Nn, k).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], o * 3);
          uv[o * 2] = Math.min(0.98, Math.max(0.02, Uv.getX(k))) / cells; uv[o * 2 + 1] = Uv.getY(k); cl.set([ic.r * (Cv ? Cv.getX(k) : 1), ic.g * (Cv ? Cv.getY(k) : 1), ic.b * (Cv ? Cv.getZ(k) : 1)], o * 3); afl.set([0, 0, 0, -1], o * 4); } }
      const add = new THREE.BufferGeometry(); add.setAttribute('position', new THREE.BufferAttribute(pos, 3)); add.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); add.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      add.setAttribute('color', new THREE.BufferAttribute(cl, 3)); add.setAttribute('aCap', new THREE.BufferAttribute(new Float32Array(tot), 1)); add.setAttribute('aFl', new THREE.BufferAttribute(afl, 4));
      if (og.index) { const ix = new Uint32Array(tot); for (let k = 0; k < tot; k++) ix[k] = k; add.setIndex(new THREE.BufferAttribute(ix, 1)); }
      const merged = mergeGeometries([og, add]); if (g0 !== im.geometry) g0.dispose(); add.dispose(); if (!merged) return false;
      gl.geometry = merged; og.dispose(); return true; };
    D.placeBoardLeaves = () => {
      const dbg = window.__dbg; if (D.boardLeaves || !GL || !boardsIM || !dbg || !dbg.N || !dbg.E) return false;
      const N = dbg.N, E = dbg.E;
      const segs = E.map(e => [N[e[0]] && N[e[0]].p, N[e[1]] && N[e[1]].p]).filter(q => q[0] && q[1]);
      const pathD = p => { let best = 99; for (const [a, b] of segs) { if (Math.min(Math.abs(p.y - a.y), Math.abs(p.y - b.y)) > 0.7) continue; const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz; let t = L ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / L : 0; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)); } return best; };
      const NL = Math.round(150 * MUL), im = new THREE.InstancedMesh(GL.geometry, GL.material, NL); let n = 0, piles = 0;
      const pal = [[.07, .7, .36], [.04, .65, .3], [.1, .65, .4], [.16, .45, .32], [.02, .55, .26], [.12, .4, .26]];
      const qi = new THREE.Quaternion(), pi = V(), si = V(), nrm = V(), centres = [];
      for (let k = 0; k < 3000 && n < NL && piles < (MOBILE ? 7 : 12); k++) { RSEED(1101000 + k);
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
      im.count = n; im.receiveShadow = true;
      // [autumn round] no draw of their own: same leaf picture as Ground's litter (its atlas cell 0), so they are baked into that
      // mesh (works whether or not the atlas has grown its 4th cell). If that is not possible they draw on their own as before.
      if (!bakeToLitter(im)) D.group.add(im); else D.boardLeavesBaked = true;
      D.boardLeaves = im; D.boardPiles = piles; D.pileAt = centres.map(c => c.toArray().map(v => +v.toFixed(2))); return true;
    };
  }

  // keep the bark's wet/rim uniforms in step with the time of day and the rain, without touching the main loop
  { const prev = TREE.bark.onBeforeRender; TREE.bark.onBeforeRender = function (...a) { D.update(a[2]); if (!D.boardLeaves && D.placeBoardLeaves) D.placeBoardLeaves(); if (prev) prev.apply(this, a); }; }

  // phones: small dressing neither casts nor receives shadows (cheaper shaders, nothing in the shadow pass)
  if (MOBILE) D.group.children.forEach(m => { m.castShadow = false; m.receiveShadow = false; });
  D.stats = () => ({ moss: D.moss.count, soil: D.soil.count, litter: D.litter.count, ivy: D.ivy.count, hanging: D.hanging.count, caught: D.caughtLeaves, baseShroom: D.baseShroom, boardPiles: D.boardPiles, upperVines: D.upperVines, strands: D.strands, forkFerns: D.forkFerns, ferns: D.ferns.count, shrooms: D.shrooms.count, brackets: D.brackets.count, junction: D.junction, joinMoss: D.joinMoss, joinIvy: D.joinIvy, frost: +D.barkU.frost.value.toFixed(2), wet: +D.barkU.wet.value.toFixed(2), damp: +D.barkU.damp.value.toFixed(2), tufts: D.tufts.count, pockets: D.pockets });
  return D;
}
