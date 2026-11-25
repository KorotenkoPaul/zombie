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
//   uFogBank vec2 (front, k): morning fog bank rolling in from the forest along dir. Mist factor at wp:
//                k*clamp((front-dot(wp.xz,uWind.xy))/10.,0.,1.)  (thick where the bank has arrived)
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
//   raining() / setRain(on)  rare rain spells (every 18-54 game hours), 3-10 real min (on('rain', e) with e.on)
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

// a program cache key that stays unique per material after wrapping onBeforeCompile: three's default key is
// onBeforeCompile.toString(), which after a wrap is the WRAPPER's source, the same for every wrapped material (so they
// shared one program: the white boards on Pavel's phone). Capture the wrapped hook's source and any own key now.
const wrapKey = (m, prev, tag) => { const own = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey : null, src = prev ? prev.toString() : '';
  return () => (own ? own.call(m) : '') + '|' + src + '|' + tag; };
export const WIND_GLSL = `
uniform float uWT,uWet,uRain;uniform vec2 uFogBank;uniform vec4 uWind;uniform vec4 uGust;uniform vec2 uDrift;
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
 vec2 dd=uWind.xy,q=vec2(-dd.y,dd.x);/* [ENV] heavy limbs lag a gust: they feel it as if ~6 m further downwind (~0.7 s late), the leaves at once */float s=windStrength(p+vec3(dd.x,0.,dd.y)*6.);float ph=uWT*.7-dot(p.xz,dd)*.12,sh=.1+.6*s;
 vec2 o=dd*(.4*s*s+sin(ph)*sh*.6)+q*sin(ph*1.37+1.)*sh*.3;return vec3(o.x,0.,o.y)*a;}
vec3 windLocal(vec3 w){
#ifdef USE_INSTANCING
 // rotation * uniform scale: the inverse is the transpose over scale^2 (much cheaper than inverse() per vertex)
 mat3 m=mat3(instanceMatrix);return transpose(m)*w/dot(m[0],m[0]);
#else
 return w;
#endif
}`;

// Water (pond, puddles): W.hookWater(shader) adds this to the FRAGMENT shader (and the wind uniforms + noise texture).
//   vec2 waterSlope(vec3 wp)   surface slope: wind ripples running downwind (calm = nearly a mirror, gusts roughen
//                              it in patches that travel with the gust) + rain-drop rings while it rains
//   vec3 waterNormal(vec3 wp)  the same as a world-space normal (y up), to use for reflections/fresnel/highlights
export const WATER_GLSL = `
uniform sampler2D uWNoise;
vec2 waterRings(vec2 xz){vec2 c=floor(xz/.32);vec2 f=xz/.32-c-.5;float h=fract(sin(dot(c,vec2(127.1,311.7)))*43758.5);
 vec2 o=vec2(fract(h*13.7),fract(h*29.3))-.5;f-=o*.4;float age=fract(uWT*(.9+h*.6)+h*7.);float r=length(f);
 float rr=age*.45;float ring=smoothstep(.07,0.,abs(r-rr))*(1.-age)*step(h,uRain*.9);return r>1e-3?f/r*ring*.5:vec2(0.);}
vec2 waterSlope(vec3 p){float s=windStrength(p);vec2 d=uWind.xy;
 vec2 a=texture2D(uWNoise,p.xz*.35-uDrift*.18+d*uWT*.05).rg-.5,b=texture2D(uWNoise,p.xz*.9+vec2(-d.y,d.x)*uWT*.03-uDrift*.4).gr-.5;
 vec2 w=(a*.6+b*.4)*(.04+.5*s);return w+waterRings(p.xz);}
vec3 waterNormal(vec3 p){vec2 sl=waterSlope(p);return normalize(vec3(-sl.x,1.,-sl.y));}`;

export function createWind(opt = {}) {
  let seed = opt.seed || 9071;
  const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rr = (a, b) => a + R() * (b - a);

  const U = { uWT: { value: 0 }, uWind: { value: [0, 0, 0, 0] }, uGust: { value: [-1e4, 0.1, 0, 10] }, uDrift: { value: [0, 0] }, uWet: { value: 0 }, uRain: { value: 0 }, uFogBank: { value: [-1e4, 0] } };
  // three.js wants Vector4 for vec4 uniforms; take the class from the caller so this file has no imports
  const V4 = opt.THREE ? opt.THREE.Vector4 : null;
  if (opt.THREE) { U.uDrift.value = new opt.THREE.Vector2(0, 0); U.uFogBank.value = new opt.THREE.Vector2(-1e4, 0); }
  if (V4) { U.uWind.value = new V4(0, 0, 0, 0); U.uGust.value = new V4(-1e4, 0.1, 0, 10); }
  const setV = (u, a, b, c, d) => { const v = u.value; if (v.set) v.set(a, b, c, d); else { v[0] = a; v[1] = b; v[2] = c; v[3] = d; } };

  let mode = 'breeze', forced = null, spellLeft = rr(40, 90);
  let base = 0.35, target = rr(...MODES.breeze.base);
  let ang = PREVAIL, angT = PREVAIL;
  let gust = null, gustWait = rr(4, 10), T = 0;
  // the legacy scalar (env.js U.wind) still read by old sway code: keep it alive
  const legacy = opt.legacy || null;
  let fall = null; // falling leaves (W.addFallingLeaves)
  const waters = []; // water surfaces (W.addWater): f(x, z) -> surface height or null
  // events for sound and anything else that wants to react (W.on)
  const LS = {}; const emit = (k, e) => { for (const f of LS[k] || []) { try { f(e); } catch (er) { console.error('wind', k, er); } } };
  let gustIn = false, creakWait = 3, lastMode = 'breeze';
  // rain spells: rare (the gap between them is counted in GAME hours, 18-54 h, so the rain per game day stays the same
  // whatever the day length; 24 real min since d2b77b3), 3-10 real minutes long, they bring a livelier wind with them
  // morning fog bank: on most mornings a light breeze carries a bank of mist in from the forest, it rolls through the
  // clearing along the wind and lifts as the sun comes up. fogBank = {front (m along dir), k 0..1}
  const fb = { front: -1e4, k: 0, on: false, tried: false };
  let rainOn = false, rainLeft = 0, rainWait = opt.firstRain ?? rr(18, 54), rainKind = 'none', rainHr = null;
  // three kinds of rain: a fine drizzle (light, long, no wind change), a proper rain, and a rare storm (windy, heavy,
  // distant thunder and lightning lighting up the fog)
  const RAIN = { drizzle: { p: 0.45, dur: [270, 630], amt: 0.35 }, rain: { p: 0.4, dur: [180, 450], amt: 0.75 }, storm: { p: 0.15, dur: [225, 500], amt: 1 } };   // real s (x1.5 for the 24-min day)
  function setRain(on, quiet, kind) {
    if (on === rainOn && (!on || !kind || kind === rainKind)) return; rainOn = on;
    if (on) { if (!RAIN[kind]) { const r = R(); kind = r < RAIN.drizzle.p ? 'drizzle' : r < RAIN.drizzle.p + RAIN.rain.p ? 'rain' : 'storm'; }
      rainKind = kind; rainLeft = rr(...RAIN[kind].dur);
      if (!forced) { if (kind === 'storm') { mode = 'windy'; target = rr(0.75, 0.95); spellLeft = rainLeft; nextStrike = rr(6, 20); }
        else if (kind === 'rain' && mode === 'calm') { mode = 'breeze'; target = rr(...MODES.breeze.base); spellLeft = rainLeft * 0.6; } } }
    else { rainWait = rr(18, 54); rainKind = 'none'; }
    if (!quiet) emit('rain', { on, kind: rainKind });
  }
  // lightning: a storm strikes every 15-50 s, kilometres away. Each strike is two or three quick flickers (W.flash()),
  // and its thunder arrives distance/343 m/s later. In a plain rain an odd far rumble with no visible flash.
  let lastSt = null, nextStrike = 1e9, rumbleWait = rr(60, 200), lastThunder = -1e9; const pulses = [], thunders = []; let flashV = 0;
  function strike(dist) {
    dist = dist ?? rr(1.5, 7); const k = Math.min(1, 2.2 / dist) * rr(0.7, 1);
    const n = 1 + Math.floor(R() * 3); let t = T; for (let i = 0; i < n; i++) { pulses.push([t, k * (i ? rr(0.4, 0.9) : 1)]); t += rr(0.06, 0.25); }
    const az = ang + Math.PI + rr(-1.2, 1.2);  // mostly upwind: the storm is coming
    emit('lightning', { dist: dist * 1000, distKm: dist, strength: k, k, dir: [Math.cos(az), Math.sin(az)] });   // dist in metres (Sound)
    thunders.push({ t: T + dist / 0.343, dist, loud: Math.min(1, 1.6 / dist), dir: [Math.cos(az), Math.sin(az)] });
  }
  // calm, still evenings: once the sun is down the wind usually settles (unless it rains)
  let hourNow = null, eveDone = -1, dayN = 0, lastHr = null;
  const evening = () => hourNow != null && hourNow >= 18.2 && hourNow < 23.5;

  function pickNext() {
    if (evening() && !rainOn && R() < 0.75) return 'calm';
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
    hook(sh) { sh.uniforms.uWT = U.uWT; sh.uniforms.uWind = U.uWind; sh.uniforms.uGust = U.uGust; sh.uniforms.uDrift = U.uDrift; sh.uniforms.uWet = U.uWet; sh.uniforms.uRain = U.uRain; sh.uniforms.uFogBank = U.uFogBank;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL); return sh; },

    // water: wind uniforms + noise texture + WATER_GLSL in the fragment shader (after #include <common>, or at the top)
    hookWater(sh, THREE) {
      Object.assign(sh.uniforms, { uWT: U.uWT, uWind: U.uWind, uGust: U.uGust, uDrift: U.uDrift, uWet: U.uWet, uRain: U.uRain, uFogBank: U.uFogBank, uWNoise: { value: W.noiseTexture(THREE || opt.THREE) } });
      const add = WIND_GLSL.replace(/vec3 windLocal[\s\S]*$/, '') + WATER_GLSL;  // windLocal needs instancing: vertex only
      sh.fragmentShader = sh.fragmentShader.includes('#include <common>') ? sh.fragmentShader.replace('#include <common>', '#include <common>\n' + add) : add + '\n' + sh.fragmentShader;
      return sh;
    },
    // ready-made: a MeshStandardMaterial / MeshPhysicalMaterial (flat, not instanced) whose surface normal follows the
    // wind ripple and rain rings, so the lamps, the moon and the env map glint on it like on water.
    rippleStandard(mat, THREE) {
      const prev = mat.onBeforeCompile, wk = wrapKey(mat, prev, 'windWater');
      mat.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); W.hookWater(sh, THREE);
        sh.vertexShader = 'varying vec3 vWWater;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWWater=(modelMatrix*vec4(transformed,1.)).xyz;');
        sh.fragmentShader = 'varying vec3 vWWater;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize((viewMatrix*vec4(waterNormal(vWWater),0.)).xyz);'); };
      mat.customProgramCacheKey = wk; mat.needsUpdate = true; return mat;
    },
    // for a THREE.ShaderMaterial (no #include <common>): adds the uniforms, puts the GLSL in front of the vertex shader
    // and defines WIND, so the owner can write `#ifdef WIND ... #endif` and still compile without this file
    hookRaw(mat) { Object.assign(mat.uniforms, { uWT: U.uWT, uWind: U.uWind, uGust: U.uGust, uDrift: U.uDrift, uWet: U.uWet, uRain: U.uRain, uFogBank: U.uFogBank }); mat.vertexShader = WIND_GLSL + '\n' + mat.vertexShader; mat.defines = Object.assign(mat.defines || {}, { WIND: '' }); mat.needsUpdate = true; return mat; },

    update({ dt = 1 / 60, T: t, rainK = 0, hour = null } = {}) {
      dt = Math.min(0.1, Math.max(0, dt)); T = t ?? T + dt;
      // morning fog bank (needs the hour from index.html)
      if (hour != null) {
        const dawn = hour >= 4.6 && hour < 9;
        if (!dawn) fb.tried = false;
        if (dawn && !fb.on && !fb.tried && hour < 6.4) { fb.tried = true;
          if (R() < 0.6 + 0.35 * U.uWet.value) { /* most mornings, nearly always after a wet night */ fb.on = true; fb.front = -SPAN; if (mode === 'calm' && !forced) { mode = 'breeze'; target = rr(0.25, 0.4); spellLeft = rr(90, 160); } emit('fogbank', { on: true }); } }
        if (fb.on) { fb.front += dt * (0.35 + base * 0.6); fb.k += ((hour < 7.6 ? 1 : 0) - fb.k) * Math.min(1, dt / (hour < 7.6 ? 20 : 40));
          if (hour >= 9 || (hour > 7.6 && fb.k < 0.02)) { fb.on = false; fb.k = 0; fb.front = -1e4; emit('fogbank', { on: false }); } }
        U.uFogBank.value.set ? U.uFogBank.value.set(fb.front, fb.k) : (U.uFogBank.value[0] = fb.front, U.uFogBank.value[1] = fb.k);
      }
      if (hour != null) { if (lastHr != null && hour < lastHr - 12) dayN++; lastHr = hour; hourNow = hour;
        // the evening settles: soon after sunset the current spell gives way (mostly to calm, see pickNext)
        if (evening() && eveDone !== dayN && !rainOn && !forced) { eveDone = dayN; spellLeft = Math.min(spellLeft, rr(8, 30)); } }
      // rain spells
      if (rainOn) { rainLeft -= dt; if (rainLeft <= 0) setRain(false); } else { /* game hours: from the clock when index gives it, else the old 20 s per hour */ let dh = dt / 20; if (hour != null) { dh = rainHr == null ? 0 : hour - rainHr; if (dh < -12) dh += 24; if (dh < 0 || dh > 2) dh = 0; rainHr = hour; } rainWait -= dh; if (rainWait <= 0) setRain(true); }
      // lightning and thunder
      if (rainOn && rainKind === 'storm') { nextStrike -= dt; if (nextStrike <= 0) { strike(); nextStrike = rr(15, 50); } }
      else if (rainOn && rainKind === 'rain') { rumbleWait -= dt; if (rumbleWait <= 0) { rumbleWait = rr(120, 300); if (R() < 0.35) { const d = rr(8, 14); emit('lightning', { dist: d * 1000, distKm: d, strength: 0.1, k: 0, dir: [-Math.cos(ang), -Math.sin(ang)], unseen: true }); thunders.push({ t: T + d / 0.343, dist: d, loud: 0.15, dir: [-Math.cos(ang), -Math.sin(ang)] }); } } }
      for (let i = thunders.length - 1; i >= 0; i--) if (T >= thunders[i].t) { const th = thunders.splice(i, 1)[0]; lastThunder = T; emit('thunder', { dist: th.dist * 1000, distKm: th.dist, loud: th.loud, dir: th.dir }); }
      flashV = 0; for (let i = pulses.length - 1; i >= 0; i--) { const a = T - pulses[i][0]; if (a < 0) continue; if (a > 0.6) { pulses.splice(i, 1); continue; } flashV += pulses[i][1] * Math.exp(-a * 14); }
      flashV = Math.min(1, flashV);
      { const st = W.weather ? W.weather.state().state : null; if (st && st !== lastSt) { if (lastSt) emit('state', { state: st, prev: lastSt }); lastSt = st; } }
      // weather spells
      spellLeft -= dt;
      if (spellLeft <= 0 && !forced) { mode = pickNext(); if (rainOn && mode === 'calm') mode = 'breeze'; spellLeft = rr(...MODES[mode].dur); target = rr(...MODES[mode].base); }
      const still = evening() && mode === 'calm' && !rainOn ? 0.5 : 1;   // a calm evening is really still
      const want = Math.min(1.1, target * still + rainK * 0.35);
      base += (want - base) * Math.min(1, dt / 12);          // spells fade in and out over ~10-20 s
      // the direction wanders slowly around the prevailing one
      if (R() < dt / 25) angT = PREVAIL + rr(-0.5, 0.5);
      ang += (angT - ang) * Math.min(1, dt / 20);
      // gusts
      if (gust) { gust.front += gust.speed * dt; if (gust.front > SPAN + gust.tail * 4) gust = null; }
      else { gustWait -= dt * (1 + rainK) * (evening() && !rainOn ? 0.5 : 1); if (gustWait <= 0) { startGust(); gustWait = rr(0.4, 1.6) * MODES[mode].gustEvery; } }
      const dx = Math.cos(ang), dz = Math.sin(ang);
      U.uWT.value = T;
      U.uRain.value = rainK;
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
    // the CPU twin of GLSL windSwayS(p, freq): world xz sway offset (multiply by your amplitude), for code that must
    // know where a shader-swayed thing is (sounds at the end of a swing, a hand on a rope ladder)
    swayAt(p, freq) { const x = p.x ?? p[0], z = p.z ?? p[2]; const s = W.sample({ x, z }).s, dx = Math.cos(ang), dz = Math.sin(ang);
      const ph = T * freq - (x * dx + z * dz) * 0.45, o1 = Math.sin(ph) * 0.6 + Math.sin(ph * 2.17 + 1.3) * 0.4, o2 = Math.sin(ph * 1.31 + 2.1);
      const sh = 0.1 + 0.9 * s, a = 0.35 * s * s + o1 * sh * 0.55, b = o2 * sh * 0.3; return { x: dx * a - dz * b, z: dz * a + dx * b }; },
    // how loud the leaves should rustle now, 0..1 (the crown, a moment after the gust passes the far trees)
    rustle() { const s0 = base + W.gustAt(0, 0); return Math.min(1, 0.05 + s0 * 0.55); },
    // W.on('gust' | 'creak' | 'mode', fn) -> off(). gust: {phase:'start', amp} / {phase:'end'}; creak: {strength 0..1, pos [x,y,z]};
    // mode: {mode, prev} when the weather spell changes ('calm' | 'breeze' | 'windy')
    // rain: raining() 1/0 (index.html eases rainK towards it), setRain(true|false) e.g. from the ☁ button.
    // on('rain', e => e.on) fires when it starts or stops.
    raining() { return rainOn ? 1 : 0; },
    wet() { return U.uWet.value; },
    // morning fog bank: {front, k}; mist is thick upwind of the front (already reached), thin ahead of it
    fogBank() { return { front: fb.front, k: fb.k, on: fb.on }; },
    fogBankAt(x, z) { if (!fb.on) return 0; const d = x * Math.cos(ang) + z * Math.sin(ang); return fb.k * Math.min(1, Math.max(0, (fb.front - d) / 10)); },   // 0..1: how wet things are (soaks fast, dries slowly)
    setRain(on, kind) { setRain(!!on, false, kind); },
    // how hard it rains now (index.html eases rainK towards this): 0, drizzle .35, rain .75, storm 1
    rainAmt() { return rainOn ? RAIN[rainKind].amt : 0; },
    rainKind() { return rainKind; },
    // lightning flash 0..1 right now (W.applyFlash lights the scene with it); strike(distKm) for tests
    flash() { return flashV; },
    strike(d) { strike(d); },
    // light the scene with the lightning: call once per frame AFTER the day/night code has set these.
    // A far flash mostly lights the fog and the sky low down, a little the whole scene (cheap: no extra light).
    applyFlash({ hemi, fog, sky, fogMats } = {}) {
      const f = flashV; if (f < 0.002) return;
      const c = W._fc || (W._fc = fog && fog.color.clone());
      if (fog) { c.setRGB(0.72, 0.78, 0.92); fog.color.lerp(c, f * 0.55); }
      if (hemi) hemi.intensity += f * 1.4;
      if (sky && sky.hor) sky.hor.value.lerp(c, f * 0.6);
      if (fogMats) { const seen = new Set(); for (const m of fogMats) { const u = m.material && m.material.uniforms; const cv = u && u.col && u.col.value;
        if (cv && cv.lerp && !seen.has(cv)) { seen.add(cv); cv.lerp(c, f * 0.6); } } }
    },
    emit(k, e) { emit(k, e); },   // other wind-thread modules (housewind.js) raise events here too
    on(k, f) { (LS[k] = LS[k] || []).push(f); return () => { LS[k] = LS[k].filter(x => x !== f); }; },
    state() { return { mode: forced || mode, base: +base.toFixed(3), dir: [+Math.cos(ang).toFixed(3), +Math.sin(ang).toFixed(3)], gust: gust ? { front: +gust.front.toFixed(1), amp: +gust.amp.toFixed(2) } : null, spellLeft: +spellLeft.toFixed(0) }; },
    set(m) { if (m === 'auto') { forced = null; spellLeft = 0; return; } if (!MODES[m]) return; forced = m; mode = m; target = rr(...MODES[m].base); },
    gust(amp) { startGust(amp); },

    // a small tiling noise texture (fbm baked once): one or two texture reads instead of 4-5 octaves of procedural
    // noise per pixel. Shared by the fog layers (fogbank.js; Environment may use it too): __wind.noiseTexture(THREE)
    noiseTexture(THREE) {
      if (W._noise) return W._noise;
      const S = 128, d = new Uint8Array(S * S * 4);
      const lat = (n, seed) => { const a = new Float32Array(n * n); let sd = seed; for (let i = 0; i < n * n; i++) { sd = (sd * 16807) % 2147483647; a[i] = sd / 2147483647; } return a; };
      const oct = [[8, 0.5, 11], [16, 0.28, 23], [32, 0.14, 37], [64, 0.08, 53]].map(([n, a, sd]) => [n, a, lat(n, sd)]);
      const sm = t => t * t * (3 - 2 * t);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let v = 0, v2 = 0;
        for (const [n, a, L] of oct) { const fx = x / S * n, fy = y / S * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
          const g = (i, j) => L[((j % n + n) % n) * n + ((i % n + n) % n)];
          const val = (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
          v += val * a; v2 += (1 - val) * a * (n > 8 ? 1.2 : 0.6); }
        const i = (y * S + x) * 4; d[i] = Math.min(255, v / 1.0 * 255); d[i + 1] = Math.min(255, v2 / 1.1 * 255); d[i + 2] = 0; d[i + 3] = 255; }
      const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; W._noise = t; return t;
    },

    // ---- falling leaves: a few oak leaves torn off the crown, tumbling down and carried by the wind ----
    // Few (16 on phones, 30 on desktop), so a tiny CPU step per leaf is cheaper than anything clever. Calm: a leaf now
    // and then; a gust tears off a little flurry. They settle on the ground, lie a while, then fade.
    // o: {THREE, scene, crown: InstancedMesh of leaf cards, groundH(x,z), avoid: [[x0,x1,y0,y1,z0,z1]...] (rooms), MOBILE}
    // register a water surface (Ground's pond): f(x, z) -> world height of the surface there, or null if not water.
    // Falling leaves land on it and float. Returns a remove function.
    addWater(f) { waters.push(f); return () => { const i = waters.indexOf(f); if (i >= 0) waters.splice(i, 1); }; },
    waterAt(x, z) { for (const f of waters) { const h = f(x, z); if (h != null) return h; } return null; },

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
      const cols = [0xC8902C, 0xD8A838, 0xB86A26, 0xA8742E, 0x8C9A3C, 0xC0502A]; /* autumn: orange, gold, rust, one green in six */
      const c = new THREE.Color(); for (let i = 0; i < N; i++) im.setColorAt(i, c.setHex(cols[i % cols.length]).multiplyScalar(rr(0.8, 1.1)));
      o.scene.add(im); im.matrixAutoUpdate = false;   // per-instance matrices move, the mesh itself never does
      // spawn points: the leaf cards of the crown (their centres)
      const spots = []; const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
      if (o.crown) for (let i = 0; i < o.crown.count; i += 3) { o.crown.getMatrixAt(i, m4); v.setFromMatrixPosition(m4); if (v.y > 6) spots.push(v.toArray()); }
      if (!spots.length) spots.push([0, 14, -1]);
      const gH = o.groundH || (() => 0), rooms = o.avoid || [];
      // the top of whatever is under a point (deck, landing, roof, else the ground): o.surfaceH(x,z) -> height or null
      const floorAt = (x, z, y) => { const g = gH(x, z); const h = o.surfaceH ? o.surfaceH(x, z) : null; return h != null && h > g && h <= y + 0.05 ? h : g; };
      // water (W.addWater): a leaf that lands on it floats, drifts downwind, bobs on the ripple and slowly sinks
      const waterAt = (x, z) => { for (const f of waters) { const h = f(x, z); if (h != null) return h; } return null; };
      let gIn = false;
      const L = []; for (let i = 0; i < N; i++) L.push({ on: false });
      const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < N; i++) im.setMatrixAt(i, zero);
      let acc = 0;
      W.addPerfSteps = PERF => PERF.addStep('leafFall', () => { if (cap <= N / 2) return false; cap = N / 2; }, () => { cap = N; }, 55);
      let cap = N;
      fall = dt => {
        const s0 = W.level();
        acc += dt * (0.12 + 0.8 * s0 * s0);                     // a few leaves are always in the air; more as the wind grows
        // a gust reaching the crown shakes a handful loose at once
        { const g = W.gustAt(0, 0); if (!gIn && g > 0.2) { gIn = true; acc += 2 + Math.min(5, g * 5); } else if (gIn && g < 0.08) gIn = false; }
        while (acc >= 1) { acc -= 1; if (L.reduce((n, l) => n + (l.on ? 1 : 0), 0) >= cap) { acc = 0; break; } const l = L.find(l => !l.on); if (!l) break;
          const sp = spots[Math.floor(R() * spots.length)];
          Object.assign(l, { on: true, water: null, built: false, p: [sp[0] + rr(-0.4, 0.4), sp[1] + rr(-0.4, 0.2), sp[2] + rr(-0.4, 0.4)], v: [0, 0, 0], ph: rr(0, 6.3), fr: rr(1.5, 3), spin: [rr(-3, 3), rr(-2, 2), rr(-4, 4)], r: [rr(0, 6), rr(0, 6), rr(0, 6)], rest: 0, life: rr(8, 16), k: 1 }); }
        for (let i = 0; i < N; i++) { const l = L[i]; if (!l.on) continue; const p = l.p;
          if (l.water != null) {                                     // floating on the pond
            l.rest += dt; const w = W.sample({ x: p[0], z: p[2] });
            // the surface carries it slowly downwind (a few cm/s, faster in a gust); it stops at the bank
            const nx = p[0] + w.x * 0.06 * dt, nz = p[2] + w.z * 0.06 * dt; if (waterAt(nx, nz) != null) { p[0] = nx; p[2] = nz; }
            l.r[2] += dt * (0.05 + w.s * 0.12) * (l.spin[2] > 0 ? 1 : -1);  // turns slowly as it drifts
            p[1] = l.water + 0.004 + Math.sin(T * 2.1 + l.ph) * 0.004 * (0.3 + w.s);
            l.r[0] = -Math.PI / 2 + Math.sin(T * 1.7 + l.ph) * 0.05 * (0.3 + w.s);
            if (l.rest > l.life) { l.k -= dt * 0.08; p[1] -= (1 - l.k) * 0.02; if (l.k <= 0) { l.on = false; l.water = null; im.setMatrixAt(i, zero); continue; } }  // soaks and sinks
          } else if (l.rest > 0) {                                   // lying on a deck or the ground, then fading
            // on a roof, landing or deck it stays: handed to the litter (no fade), where it builds up until swept or blown off
            if (l.rest > l.life && l.built && LIT.add(p, l.r[2])) { l.on = false; im.setMatrixAt(i, zero); continue; }
            l.rest += dt; if (l.rest > l.life) { l.k -= dt * 0.5; if (l.k <= 0) { l.on = false; im.setMatrixAt(i, zero); continue; } }
            // a gust picks it up again: it skitters a little way along the boards and settles (the deck "breathes" leaves)
            const w = W.sample({ x: p[0], z: p[2] });
            if (w.s > 0.7 && l.k > 0.9 && R() < dt * (w.s - 0.6) * 2.5) { l.rest = 0; l.v = [w.x * 1.6, rr(0.5, 1.1), w.z * 1.6]; l.spin = [rr(-6, 6), rr(-3, 3), rr(-6, 6)]; l.life += rr(4, 8); }
          } else {
            const w = W.sample({ x: p[0], z: p[2] }); l.ph += dt * l.fr;
            // drag towards the wind (leaves are light), a swirl, and a fluttering fall
            const tx = w.x * 1.0 + Math.cos(l.ph) * 0.35, tz = w.z * 1.0 + Math.sin(l.ph * 0.8) * 0.35, ty = -0.9 + Math.sin(l.ph * 1.7) * 0.35 + w.gust * 0.3;
            const k = Math.min(1, dt * 1.8); l.v[0] += (tx - l.v[0]) * k; l.v[1] += (ty - l.v[1]) * k; l.v[2] += (tz - l.v[2]) * k;
            p[0] += l.v[0] * dt; p[1] += l.v[1] * dt; p[2] += l.v[2] * dt;
            for (let j = 0; j < 3; j++) l.r[j] += l.spin[j] * dt * (0.6 + w.s);
            const g = floorAt(p[0], p[2], p[1]) + 0.015, wh = waters.length ? waterAt(p[0], p[2]) : null;
            if (wh != null && wh > g - 0.015 && p[1] <= wh + 0.01) { p[1] = wh; l.water = wh; l.rest = 0.001; l.life = rr(50, 90); l.r[0] = -Math.PI / 2; l.r[1] = 0; }
            else if (p[1] <= g) { p[1] = g; l.rest = 0.001; l.built = g > gH(p[0], p[2]) + 0.5; if (l.built) l.life = Math.max(l.life, rr(12, 30)); l.r[0] = -Math.PI / 2 + rr(-0.2, 0.2); l.r[1] = 0; }
            // never through a room: a leaf that drifts into one is gone (the roof hides it)
            if (rooms.some(b => p[0] > b[0] && p[0] < b[1] && p[1] > b[2] - 0.35 && p[1] < b[3] + 0.6 && p[2] > b[4] && p[2] < b[5]))/* [ENV] down to the floor boards too: none settles on a rug */ { l.on = false; im.setMatrixAt(i, zero); continue; }
            if (Math.abs(p[0]) > 60 || Math.abs(p[2]) > 60) { l.on = false; im.setMatrixAt(i, zero); continue; }
          }
          q.setFromEuler(e.set(l.r[0], l.r[1], l.r[2])); m4.compose(v.set(p[0], p[1], p[2]), q, sc.setScalar(l.k)); im.setMatrixAt(i, m4);
        }
        im.instanceMatrix.needsUpdate = true;
        LIT.update(dt);
      };
      // a leaf torn off the litter (a gust, the hero's broom) flies again as a falling leaf; false if all are in the air
      const launch = (p, vel) => { const l = L.find(l => !l.on); if (!l) return false;
        Object.assign(l, { on: true, water: null, built: false, p: [p[0], p[1] + 0.03, p[2]], v: vel, ph: rr(0, 6.3), fr: rr(1.5, 3), spin: [rr(-6, 6), rr(-3, 3), rr(-6, 6)], r: [-Math.PI / 2, 0, rr(0, 6)], rest: 0, life: rr(8, 16), k: 1 }); return true; };
      const LIT = makeLitter(o, geo, mat, floorAt, gH, launch);
      W.litter = LIT.api;
      W.fallingLeaves = im; return im;
    }
  };

  // ---- autumn litter: leaves that came down on a roof, landing or deck stay there ----
  // One InstancedMesh (MOBILE 80 / desktop 200 leaves, the falling leaf's geometry and material: one draw call). A falling
  // leaf that rests on a built surface joins it; when full, the oldest is replaced. The world starts with a little litter.
  // A strong gust lifts a few back into the air. The hero's clear_roof sweeps the ones around him off the edge.
  // W.litter: level() 0..1 (how leafy the house is; Brain), count(), near(x,y,z,r) -> n, sweep(x,y,z,r,max) -> n swept
  function makeLitter(o, geo, mat, floorAt, gH, launch) {
    const THREE = o.THREE, LN = o.MOBILE ? 80 : 200;
    const im = new THREE.InstancedMesh(geo, mat, LN); im.frustumCulled = false; im.name = 'leafLitter';
    const P = new Float32Array(LN * 3), on = new Uint8Array(LN); let n = 0, head = 0, dirty = false, seeded = false, seedT = 0, sweepT = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const cols = [0xA8682A, 0xC0802E, 0x8A5426, 0xC89A3A, 0xB0582A, 0x94602C], c = new THREE.Color(); /* autumn: orange-gold */
    for (let i = 0; i < LN; i++) { im.setMatrixAt(i, zero); im.setColorAt(i, c.setHex(cols[i % cols.length]).multiplyScalar(rr(0.7, 1.0))); }
    o.scene.add(im); im.matrixAutoUpdate = false;
    const put = (i, x, y, z, yaw) => {
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; on[i] = 1;
      // flat on the boards with a little curl (a dry oak leaf never lies dead flat), random turn and size
      q.setFromEuler(e.set(-Math.PI / 2 + rr(-0.25, 0.25), rr(-0.2, 0.2), yaw)); m4.compose(v.set(x, y + 0.006, z), q, sc.setScalar(rr(1.0, 1.5))); im.setMatrixAt(i, m4); dirty = true; };
    const kill = i => { if (!on[i]) return; on[i] = 0; n--; im.setMatrixAt(i, zero); dirty = true; };
    // [ENV] never inside a room (the open cutaway side let them settle on the bedroom rug as flat brown blots)
    const rooms = o.avoid || [], inRoom = (x, y, z) => rooms.some(b => x > b[0] && x < b[1] && y > b[2] - 0.35 && y < b[3] + 0.6 && z > b[4] && z < b[5]);
    const add = (p, yaw) => { if (inRoom(p[0], p[1], p[2])) return false; let i = -1; for (let k = 0; k < LN; k++) { const j = (head + k) % LN; if (!on[j]) { i = j; break; } }
      if (i < 0) { i = head; on[i] = 0; n--; }                         // full: the oldest goes
      head = (i + 1) % LN; n++; put(i, p[0], p[1], p[2], yaw); return true; };
    // a little litter to start with, where leaves would really be: under the crown, on top surfaces well above the ground
    const seed = () => { const want = Math.round(LN * rr(0.3, 0.45)); let tries = 0;
      while (n < want && tries++ < want * 25) { const x = rr(-6.5, 6.5), z = rr(-2, 7.5); const h = o.surfaceH && o.surfaceH(x, z);
        if (h == null || h < gH(x, z) + 0.8) continue;
        // in little drifts (against a post, in a corner), not evenly sprinkled
        for (let k = 0, m = 2 + Math.floor(R() * 5); k < m && n < want; k++) { const a = rr(0, 6.3), d = rr(0, 0.25), cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, ch = o.surfaceH(cx, cz);
          if (ch != null && Math.abs(ch - h) < 0.08) add([cx, ch, cz], rr(0, 6.3)); } } };
    const blowOff = (i, w, up) => { const vel = [w.x * 1.2 + rr(-0.3, 0.3), up, w.z * 1.2 + rr(-0.3, 0.3)];
      if (launch([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], vel)) { kill(i); return true; } return false; };
    const api = {
      mesh: im, max: LN,
      count: () => n,
      level: () => Math.min(1, n / (LN * 0.6)),
      near(x, y, z, r = 1.5) { let k = 0; for (let i = 0; i < LN; i++) if (on[i] && Math.abs(P[i * 3 + 1] - y) < 1.2 && Math.hypot(P[i * 3] - x, P[i * 3 + 2] - z) < r) k++; return k; },
      // sweep: leaves within r of (x,z), near height y, are flicked away from the point and off the edge (they fly, then
      // land on the ground or the pond). max per call (default all within r); returns how many went.
      sweep(x, y, z, r = 1.5, max = 999) { let k = 0;
        for (let i = 0; i < LN && k < max; i++) { if (!on[i] || P[i * 3 + 1] - y < -0.5 || P[i * 3 + 1] - y > 2.2) continue;   /* his feet's level up to a roof edge in reach */ const dx = P[i * 3] - x, dz = P[i * 3 + 2] - z, d = Math.hypot(dx, dz);
          if (d > r) continue; const s = 1.3 / (d || 1); launch([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [dx * s, rr(0.5, 1.0), dz * s]); kill(i); k++; }   /* no free flyer: it just goes */
        return k; },
      clear() { for (let i = 0; i < LN; i++) kill(i); },
      stats: () => ({ count: n, max: LN, level: +api.level().toFixed(2) })
    };
    function update(dt) {
      if (!seeded && (seedT -= dt) <= 0) { seedT = 0.25; if (o.surfaceH && o.surfaceH(0, 4) !== undefined && window.__rain && window.__rain.ready) { seeded = true; seed(); } }
      // a strong gust lifts a leaf or two off the litter (only so many can be in the air at once)
      const s = W.level(); if (n && s > 0.8 && R() < dt * (s - 0.75) * 0.8 * Math.min(1, n / 20)) {   // most stay, wedged against posts and shingles
        const i = Math.floor(R() * LN); if (on[i]) blowOff(i, W.sample({ x: P[i * 3], z: P[i * 3 + 2] }), rr(0.6, 1.3)); }
      // the hero at clear_roof: the broom sends the nearest leaves off, one every ~0.35 s, while he stands and sweeps
      if (n && (sweepT -= dt) <= 0) { sweepT = 0.35; try { const h = o.hero && o.hero(); if (h && h.pos && /clear_roof|clearleaves|sweep/.test(h.task || '') && h.still) api.sweep(h.pos.x, h.pos.y, h.pos.z, 1.8, 1); } catch (err) { /* hero not ready */ } }
      if (dirty) { im.instanceMatrix.needsUpdate = true; dirty = false; }
    }
    return { api, add, update };
  }
  // ---- window.__weather: one place for Brain (jacket in rain or cold), Sound and the UI to read the weather ----
  // state() -> { state: 'clear'|'calm'|'drizzle'|'rain'|'storm'|'mist', intensity 0..1, wind: 'calm'|'breeze'|'windy', windLevel 0..2, gust bool, rain: 'none'|'drizzle'|'rain'|'storm',
  //   rainAmt 0..1, wet 0..1, mist 0..1 (morning fog bank), storm bool, stillEvening bool, sinceThunder s,
  //   temp °C (autumn: ~4 at dawn, ~13 mid-afternoon, colder in rain), feels °C (wind and wet on top), cold bool }
  // on('rain'|'lightning'|'thunder'|'state'|'mode'|'gust'|'fogbank', fn) -> off(): rain {on, kind};
  //   lightning {dist m, distKm, strength 0..1, dir [x,z]} on the flash frame; state {state, prev};
  //   thunder {dist m, distKm, loud 0..1, dir [x,z]} (arrives dist/343 m/s after its flash); test: setRain(true,'storm'), strike(2)
  W.weather = {
    state() {
      const h = hourNow ?? 12, lv = W.level(), amt = W.rainAmt(), wet = U.uWet.value;
      const temp = 8.5 + 4.5 * Math.cos((h - 15) / 24 * Math.PI * 2) - amt * 2.5;
      const feels = temp - Math.min(1, lv) * 3.5 - wet * 1.5;
      const st = rainOn ? rainKind : fb.k > 0.25 ? 'mist' : (forced || mode) === 'calm' ? 'calm' : 'clear';
      return { state: st, intensity: +(rainOn ? amt : st === 'mist' ? fb.k : Math.min(1, lv)).toFixed(2), wind: forced || mode, windLevel: +lv.toFixed(2), gust: gustIn, rain: rainKind, rainAmt: amt, wet: +wet.toFixed(2),
        mist: +fb.k.toFixed(2), storm: rainOn && rainKind === 'storm', stillEvening: evening() && mode === 'calm' && !rainOn,
        sinceThunder: Math.min(9999, +(T - lastThunder).toFixed(1)), temp: +temp.toFixed(1), feels: +feels.toFixed(1), cold: feels < 6 };
    },
    on: (k, f) => W.on(k, f), setRain: (on, kind) => W.setRain(on, kind), strike: d => W.strike(d), set: m => W.set(m)
  };
  W.update({ dt: 0, T: 0 });
  return W;
}
