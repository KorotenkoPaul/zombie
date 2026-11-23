// Wind thread — one global wind for the whole scene (game/wind.js).
//
// Weather, not a metronome: the wind drifts between calm, a gentle breeze and a windy spell, each lasting one to a few
// minutes, and its direction wanders slowly. On top of that come gusts: a gust is a front that rolls through the
// scene along the wind direction (it comes from behind the tree, so the far forest stirs a moment before the near
// grass), then the wind dies down again. Everything that sways reads the same numbers, so it all moves together.
//
// Cost: a few floats updated on the CPU once per frame. All motion happens in vertex shaders, nothing per leaf on the CPU.
//
// Uniforms (shared objects, put them in shader.uniforms):
//   uWT   float  wind time, seconds
//   uWind vec4   (dirX, dirZ, base strength 0..~1, 0)   dir = where the wind blows TO, in world xz
//   uGust vec4   (front, 1/width, amplitude, tail)       front = position of the gust front along dir (metres)
//   uWet  float  0..1 how wet things are (rain soaks fast, dries over ~2 min): ropes sway less, glass runs with drops
//   uDrift vec2  how far the air has carried things so far (metres, world xz) - scroll fog noise by it
//
// GLSL (W.glsl, paste after #include <common>):
//   float windStrength(vec3 wp)          0 calm, ~.45 breeze, ~.85 windy, up to ~2 inside a strong gust
//   vec2  windSway(vec3 wp, float freq)  world xz offset for a flexible thing, ~.1 calm, ~.4 breeze, ~2 in a gust.
//                                        Multiply by your own amplitude in metres; freq ~1.2 heavy, ~1.7 grass, ~2.5 leaves
//   vec3  windRope(vec3 wp, float t, float len)  offset for a hanging rope: t 0 at the knot .. 1 at the free end
//   vec3  windBranch(vec3 wp, vec2 trunkAxisXZ)  smooth sway of the oak's big limbs (bark and leaves both add it)
//   vec2  windSwayS(vec3 wp, float freq)  same, but smooth in space: use it for anything that MOVES (particles),
//                                        or pass the point's rest position. windSway's per-position phase jumps otherwise.
//   vec3  windLocal(vec3 w)              turns a world offset into the instance's local space (InstancedMesh);
//                                        without instancing it returns w unchanged
//
// Hook for a material:  W.hook(shader) adds the uniforms and the GLSL; then use the functions in #include <begin_vertex>.
// JS API (window.__wind):
//   sample(pos)  -> {x, z, s, gust}   wind at a world point now (x,z = direction*strength)
//   state()      -> {mode, base, dir, gust}
//   set(mode)    force 'calm' | 'breeze' | 'windy' (or 'auto' to let the weather run again)
//   gust(amp)    send one gust through the scene now
//   level()      overall strength at the tree, 0..~2 (for sound, fog drift, ...)
//   rustle()     0..1 how loud the leaves should rustle now
//   raining() / setRain(on)  rare rain spells, 2-5 min (on('rain', e) with e.on)
//   on('gust'|'creak'|'mode'|'rain', fn) -> off()   events for sound: gust start/end at the tree, branch creaks (strength, pos), weather spell changes

const MODES = {
  calm:   { base: [0.03, 0.1],  dur: [50, 140], gustEvery: 70, gustAmp: [0.15, 0.3] },
  breeze: { base: [0.3, 0.5],   dur: [60, 180], gustEvery: 22, gustAmp: [0.3, 0.6] },
  windy:  { base: [0.65, 0.9],  dur: [35, 90],  gustEvery: 9,  gustAmp: [0.45, 0.9] }
};
// which spell follows which: calm and breeze are the usual weather, a windy spell is a short event
const NEXT = { calm: [['breeze', 0.85], ['windy', 0.15]], breeze: [['calm', 0.5], ['windy', 0.5]], windy: [['breeze', 0.8], ['calm', 0.2]] };
const PREVAIL = Math.atan2(0.66, 0.75); // blows from the far left-back corner towards the camera side
const SPAN = 60; // gusts start this far upwind of the tree and run this far past it

export const WIND_GLSL = `
uniform float uWT,uWet;uniform vec4 uWind;uniform vec4 uGust;uniform vec2 uDrift;
float windGust(vec3 p){float x=uGust.x-dot(p.xz,uWind.xy);
 return uGust.z*(x<0.?exp(-x*x*uGust.y*uGust.y*6.):exp(-x/uGust.w));}
float windStrength(vec3 p){float n=sin(dot(p.xz,vec2(.11,.17))+uWT*.37)*.5+.5;return uWind.z*(.8+.4*n)+windGust(p);}
vec2 windSwayH(vec3 p,float freq,float hp){float s=windStrength(p);vec2 d=uWind.xy,q=vec2(-d.y,d.x);
 float ph=uWT*freq-dot(p.xz,d)*.45+hp;
 float o1=sin(ph)*.6+sin(ph*2.17+1.3)*.4,o2=sin(ph*1.31+2.1);
 float shake=.1+.9*s,lean=.35*s*s;
 return d*(lean+o1*shake*.55)+q*o2*shake*.3;}
// for things that stay put (a plant, a leaf card): each gets its own random phase from its position
vec2 windSway(vec3 p,float freq){return windSwayH(p,freq,fract(sin(dot(p.xz,vec2(12.9898,78.233)))*43758.5453)*.8);}
// for things that move (fireflies, motes, smoke, rope vertices): smooth in space, no jumps as the point moves
vec2 windSwayS(vec3 p,float freq){return windSwayH(p,freq,0.);}
// a hanging rope or rope ladder: t = 0 at the knot it hangs from .. 1 at its free end, len = its length in metres.
// Slow pendulum sway, mostly downwind, the free end moves most. Returns a world offset.
vec3 windRope(vec3 p,float t,float len){vec2 w=windSwayS(p,1.1)*.05*len*t*t*(1.-.45*uWet);/* wet rope: heavier, sways less */return vec3(w.x,0.,w.y);}
// the big limbs of the oak: a slow, smooth sway (no per-vertex randomness, so a branch moves as one piece).
// ax = the trunk axis (x,z). Still near the trunk and the house; the far limbs and the top of the crown move a few cm,
// ~15 cm in a strong gust. Leaf cards add the same offset at their centre, so they stay on their branch.
vec3 windBranch(vec3 p,vec2 ax){float d=length(p.xz-ax);float a=.09*max(smoothstep(5.5,10.,d),smoothstep(14.,19.,p.y));
 float s=windStrength(p);vec2 dd=uWind.xy,q=vec2(-dd.y,dd.x);float ph=uWT*.7-dot(p.xz,dd)*.12,sh=.1+.6*s;
 vec2 o=dd*(.4*s*s+sin(ph)*sh*.6)+q*sin(ph*1.37+1.)*sh*.3;return vec3(o.x,0.,o.y)*a;}
vec3 windLocal(vec3 w){
#ifdef USE_INSTANCING
 return inverse(mat3(instanceMatrix))*w;
#else
 return w;
#endif
}`;

export function createWind(opt = {}) {
  let seed = opt.seed || 9071;
  const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rr = (a, b) => a + R() * (b - a);

  const U = { uWT: { value: 0 }, uWind: { value: [0, 0, 0, 0] }, uGust: { value: [-1e4, 0.1, 0, 10] }, uDrift: { value: [0, 0] }, uWet: { value: 0 } };
  // three.js wants Vector4 for vec4 uniforms; take the class from the caller so this file has no imports
  const V4 = opt.THREE ? opt.THREE.Vector4 : null;
  if (opt.THREE) U.uDrift.value = new opt.THREE.Vector2(0, 0);
  if (V4) { U.uWind.value = new V4(0, 0, 0, 0); U.uGust.value = new V4(-1e4, 0.1, 0, 10); }
  const setV = (u, a, b, c, d) => { const v = u.value; if (v.set) v.set(a, b, c, d); else { v[0] = a; v[1] = b; v[2] = c; v[3] = d; } };

  let mode = 'breeze', forced = null, spellLeft = rr(40, 90);
  let base = 0.35, target = rr(...MODES.breeze.base);
  let ang = PREVAIL, angT = PREVAIL;
  let gust = null, gustWait = rr(4, 10), T = 0;
  // the legacy scalar (env.js U.wind) still read by old sway code: keep it alive
  const legacy = opt.legacy || null;
  let fall = null; // falling leaves (W.addFallingLeaves)
  // events for sound and anything else that wants to react (W.on)
  const LS = {}; const emit = (k, e) => { for (const f of LS[k] || []) { try { f(e); } catch (er) { console.error('wind', k, er); } } };
  let gustIn = false, creakWait = 3, lastMode = 'breeze';
  // rain spells: rare (one every ~6-18 min), 2-5 min long, they bring a livelier wind with them
  let rainOn = false, rainLeft = 0, rainWait = opt.firstRain ?? rr(360, 1080);
  function setRain(on, quiet) {
    if (on === rainOn) return; rainOn = on;
    if (on) { rainLeft = rr(120, 300); if (mode === 'calm' && !forced) { mode = 'breeze'; target = rr(...MODES.breeze.base); spellLeft = rainLeft * 0.6; } }
    else rainWait = rr(360, 1080);
    if (!quiet) emit('rain', { on });
  }

  function pickNext() {
    const r = R(); let acc = 0;
    for (const [m, p] of NEXT[mode]) { acc += p; if (r <= acc) return m; }
    return 'breeze';
  }
  function startGust(amp) {
    const L = rr(10, 22);
    gust = { front: -SPAN, speed: rr(7, 11), inv: 1 / (L * 0.35), amp: amp ?? rr(...MODES[mode].gustAmp), tail: L };
  }

  const W = {
    U, glsl: WIND_GLSL,
    hook(sh) { sh.uniforms.uWT = U.uWT; sh.uniforms.uWind = U.uWind; sh.uniforms.uGust = U.uGust; sh.uniforms.uDrift = U.uDrift; sh.uniforms.uWet = U.uWet;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL); return sh; },

    // for a THREE.ShaderMaterial (no #include <common>): adds the uniforms, puts the GLSL in front of the vertex shader
    // and defines WIND, so the owner can write `#ifdef WIND ... #endif` and still compile without this file
    hookRaw(mat) { Object.assign(mat.uniforms, { uWT: U.uWT, uWind: U.uWind, uGust: U.uGust, uDrift: U.uDrift, uWet: U.uWet }); mat.vertexShader = WIND_GLSL + '\n' + mat.vertexShader; mat.defines = Object.assign(mat.defines || {}, { WIND: '' }); mat.needsUpdate = true; return mat; },

    update({ dt = 1 / 60, T: t, rainK = 0 } = {}) {
      dt = Math.min(0.1, Math.max(0, dt)); T = t ?? T + dt;
      // rain spells
      if (rainOn) { rainLeft -= dt; if (rainLeft <= 0) setRain(false); } else { rainWait -= dt; if (rainWait <= 0) setRain(true); }
      // weather spells
      spellLeft -= dt;
      if (spellLeft <= 0 && !forced) { mode = pickNext(); if (rainOn && mode === 'calm') mode = 'breeze'; spellLeft = rr(...MODES[mode].dur); target = rr(...MODES[mode].base); }
      const want = Math.min(1.1, target + rainK * 0.35);
      base += (want - base) * Math.min(1, dt / 12);          // spells fade in and out over ~10-20 s
      // the direction wanders slowly around the prevailing one
      if (R() < dt / 25) angT = PREVAIL + rr(-0.5, 0.5);
      ang += (angT - ang) * Math.min(1, dt / 20);
      // gusts
      if (gust) { gust.front += gust.speed * dt; if (gust.front > SPAN + gust.tail * 4) gust = null; }
      else { gustWait -= dt * (1 + rainK); if (gustWait <= 0) { startGust(); gustWait = rr(0.4, 1.6) * MODES[mode].gustEvery; } }
      const dx = Math.cos(ang), dz = Math.sin(ang);
      U.uWT.value = T;
      // wetness: soaks in within ~10 s of rain, dries over a couple of minutes
      U.uWet.value += (Math.min(1, rainK * 1.3) - U.uWet.value) * Math.min(1, dt / (rainK > U.uWet.value ? 8 : 120));
      { const s0 = base + W.gustAt(0, 0), d = U.uDrift.value; const ax = dx * s0 * 1.6 * dt, az = dz * s0 * 1.6 * dt; if (d.set) d.set(d.x + ax, d.y + az); else { d[0] += ax; d[1] += az; } }
      setV(U.uWind, dx, dz, base, 0);
      if (gust) setV(U.uGust, gust.front, gust.inv, gust.amp, gust.tail); else setV(U.uGust, -1e4, 0.1, 0, 10);
      if (legacy) legacy.value = 0.25 + W.level() * 1.1;
      if (fall) fall(dt);
      // --- events ---
      if (mode !== lastMode) { emit('mode', { mode, prev: lastMode }); lastMode = mode; }
      const gt = W.gustAt(0, 0);
      if (!gustIn && gt > 0.15) { gustIn = true; emit('gust', { amp: gust ? gust.amp : gt, phase: 'start' }); }
      else if (gustIn && gt < 0.08) { gustIn = false; emit('gust', { phase: 'end' }); }
      // the old oak creaks under load: rarely in a breeze, now and then when windy, almost surely in a strong gust
      const s0 = base + gt; creakWait -= dt;
      if (s0 > 0.45 && creakWait <= 0 && R() < dt * (s0 - 0.4) * 0.9) { creakWait = rr(5, 12); emit('creak', { strength: Math.min(1, (s0 - 0.4) / 1.2), pos: [rr(-7, 7), rr(9, 17), rr(-3, 1)] }); }
    },

    gustAt(x, z) {
      if (!gust) return 0;
      const d = x * Math.cos(ang) + z * Math.sin(ang); const k = gust.front - d;
      return gust.amp * (k < 0 ? Math.exp(-k * k * gust.inv * gust.inv * 6) : Math.exp(-k / gust.tail));
    },
    sample(p) {
      const x = p.x ?? p[0], z = p.z ?? p[2];
      const n = Math.sin(x * 0.11 + z * 0.17 + T * 0.37) * 0.5 + 0.5;
      const g = W.gustAt(x, z), s = base * (0.8 + 0.4 * n) + g;
      return { x: Math.cos(ang) * s, z: Math.sin(ang) * s, s, gust: g };
    },
    level() { return W.sample({ x: 0, z: 0 }).s; },
    // how loud the leaves should rustle now, 0..1 (the crown, a moment after the gust passes the far trees)
    rustle() { const s0 = base + W.gustAt(0, 0); return Math.min(1, 0.05 + s0 * 0.55); },
    // W.on('gust' | 'creak' | 'mode', fn) -> off(). gust: {phase:'start', amp} / {phase:'end'}; creak: {strength 0..1, pos [x,y,z]};
    // mode: {mode, prev} when the weather spell changes ('calm' | 'breeze' | 'windy')
    // rain: raining() 1/0 (index.html eases rainK towards it), setRain(true|false) e.g. from the ☁ button.
    // on('rain', e => e.on) fires when it starts or stops.
    raining() { return rainOn ? 1 : 0; },
    wet() { return U.uWet.value; },   // 0..1: how wet things are (soaks fast, dries slowly)
    setRain(on) { setRain(!!on); },
    on(k, f) { (LS[k] = LS[k] || []).push(f); return () => { LS[k] = LS[k].filter(x => x !== f); }; },
    state() { return { mode: forced || mode, base: +base.toFixed(3), dir: [+Math.cos(ang).toFixed(3), +Math.sin(ang).toFixed(3)], gust: gust ? { front: +gust.front.toFixed(1), amp: +gust.amp.toFixed(2) } : null, spellLeft: +spellLeft.toFixed(0) }; },
    set(m) { if (m === 'auto') { forced = null; spellLeft = 0; return; } if (!MODES[m]) return; forced = m; mode = m; target = rr(...MODES[m].base); },
    gust(amp) { startGust(amp); },

    // ---- falling leaves: a few oak leaves torn off the crown, tumbling down and carried by the wind ----
    // Few (16 on phones, 30 on desktop), so a tiny CPU step per leaf is cheaper than anything clever. Calm: a leaf now
    // and then; a gust tears off a little flurry. They settle on the ground, lie a while, then fade.
    // o: {THREE, scene, crown: InstancedMesh of leaf cards, groundH(x,z), avoid: [[x0,x1,y0,y1,z0,z1]...] (rooms), MOBILE}
    addFallingLeaves(o) {
      const THREE = o.THREE, N = o.MOBILE ? 16 : 30;
      // a single oak leaf drawn once into a small canvas: lobed blade, midrib
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
      x.translate(32, 33); x.fillStyle = '#fff'; x.beginPath();
      for (let i = 0; i <= 40; i++) { const t = i / 40 * Math.PI * 2, r = 1 + 0.16 * Math.cos(t * 5) ** 2 * Math.sign(Math.cos(t * 5));
        const px = Math.sin(t) * 13 * r * (0.75 + 0.25 * Math.cos(t)), py = -Math.cos(t) * 26; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.fill(); x.strokeStyle = 'rgba(90,70,40,.55)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, 30); x.lineTo(0, -24); x.stroke();
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.PlaneGeometry(0.09, 0.11);
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
      const im = new THREE.InstancedMesh(geo, mat, N); im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const cols = [0x6E8A3A, 0x8C9A3C, 0xB49A3A, 0xA8742E, 0x7A5A2E];
      const c = new THREE.Color(); for (let i = 0; i < N; i++) im.setColorAt(i, c.setHex(cols[i % cols.length]).multiplyScalar(rr(0.8, 1.1)));
      o.scene.add(im);
      // spawn points: the leaf cards of the crown (their centres)
      const spots = []; const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
      if (o.crown) for (let i = 0; i < o.crown.count; i += 3) { o.crown.getMatrixAt(i, m4); v.setFromMatrixPosition(m4); if (v.y > 6) spots.push(v.toArray()); }
      if (!spots.length) spots.push([0, 14, -1]);
      const gH = o.groundH || (() => 0), rooms = o.avoid || [];
      const L = []; for (let i = 0; i < N; i++) L.push({ on: false });
      const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < N; i++) im.setMatrixAt(i, zero);
      let acc = 0;
      fall = dt => {
        const s0 = W.level();
        acc += dt * (0.04 + 0.7 * s0 * s0);                     // leaves per second grow with the wind
        while (acc >= 1) { acc -= 1; const l = L.find(l => !l.on); if (!l) break;
          const sp = spots[Math.floor(R() * spots.length)];
          Object.assign(l, { on: true, p: [sp[0] + rr(-0.4, 0.4), sp[1] + rr(-0.4, 0.2), sp[2] + rr(-0.4, 0.4)], v: [0, 0, 0], ph: rr(0, 6.3), fr: rr(1.5, 3), spin: [rr(-3, 3), rr(-2, 2), rr(-4, 4)], r: [rr(0, 6), rr(0, 6), rr(0, 6)], rest: 0, life: rr(8, 16), k: 1 }); }
        for (let i = 0; i < N; i++) { const l = L[i]; if (!l.on) continue; const p = l.p;
          if (l.rest > 0) {                                          // lying on the ground, then fading
            l.rest += dt; if (l.rest > l.life) { l.k -= dt * 0.5; if (l.k <= 0) { l.on = false; im.setMatrixAt(i, zero); continue; } }
          } else {
            const w = W.sample({ x: p[0], z: p[2] }); l.ph += dt * l.fr;
            // drag towards the wind (leaves are light), a swirl, and a fluttering fall
            const tx = w.x * 2.2 + Math.cos(l.ph) * 0.35, tz = w.z * 2.2 + Math.sin(l.ph * 0.8) * 0.35, ty = -0.75 + Math.sin(l.ph * 1.7) * 0.35 + w.gust * 0.3;
            const k = Math.min(1, dt * 1.8); l.v[0] += (tx - l.v[0]) * k; l.v[1] += (ty - l.v[1]) * k; l.v[2] += (tz - l.v[2]) * k;
            p[0] += l.v[0] * dt; p[1] += l.v[1] * dt; p[2] += l.v[2] * dt;
            for (let j = 0; j < 3; j++) l.r[j] += l.spin[j] * dt * (0.6 + w.s);
            const g = gH(p[0], p[2]) + 0.015;
            if (p[1] <= g) { p[1] = g; l.rest = 0.001; l.r[0] = -Math.PI / 2 + rr(-0.2, 0.2); l.r[1] = 0; }
            // never through a room: a leaf that drifts into one is gone (the roof hides it)
            if (rooms.some(b => p[0] > b[0] && p[0] < b[1] && p[1] > b[2] && p[1] < b[3] + 0.6 && p[2] > b[4] && p[2] < b[5])) { l.on = false; im.setMatrixAt(i, zero); continue; }
            if (Math.abs(p[0]) > 60 || Math.abs(p[2]) > 60) { l.on = false; im.setMatrixAt(i, zero); continue; }
          }
          q.setFromEuler(e.set(l.r[0], l.r[1], l.r[2])); m4.compose(v.set(p[0], p[1], p[2]), q, sc.setScalar(l.k)); im.setMatrixAt(i, m4);
        }
        im.instanceMatrix.needsUpdate = true;
      };
      W.fallingLeaves = im; return im;
    }
  };
  W.update({ dt: 0, T: 0 });
  return W;
}
