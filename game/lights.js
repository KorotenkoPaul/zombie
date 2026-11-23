// Interior light sources. Every warm light in the house comes from a real source: a lantern, the workshop
// dome lamp, the candle, the oven fire, the glowing door in the trunk. A source that is off emits nothing:
// no light, no emissive, no halo, no fog glow, no warm window. There is no warm "room fill" anywhere.
//
// Owned by the "interior light" work. index.html calls createLights() once (after props) and
// lights.update() every frame. Props owns the lamp/oven meshes (props.js), Environment owns halos/fog (env.js).
//
// API (window.__lights):
//   list()                 -> [{name, room, kind, on, level, auto}]
//   set(name, on)          -> switch a source by hand (stays manual until auto(name))
//   toggle(name)           -> flip it
//   auto(name?)            -> give a source (or all of them) back to the day/night + routine logic
//   get(name)              -> {name, room, kind, on, level, auto, pos}
//   pos(name)              -> world Vector3 of the source (where the hero reaches to switch it)
//   room(roomName)         -> 0..1, how lit a room is right now (kitchen, bedroom, workshop, outside)
//   onChange(cb)           -> cb(name, on) whenever a source is switched
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = x => Math.max(0, Math.min(1, x));

// how a source wakes up and dies down (seconds), and how it flickers
const KINDS = {
  oil:      { on: .7,  off: .5,  flick: 'flame' },   // oil lanterns: catch, flare, settle
  electric: { on: .12, off: .08, flick: 'bulb' },    // dome lamp: quick, a small stutter
  candle:   { on: 1.0, off: .35, flick: 'candle' },
  fire:     { on: 4.5, off: 14,  flick: 'fire' },    // oven: the fire takes, the embers die slowly
  door:     { on: 1.5, off: 1.5, flick: 'flame' },
};

export function createLights({ scene, ENV, P3, TREE, MOBILE, LV, windows = [] }) {
  const { KT, BD, WS, DK, LC, LG } = LV;
  const PL = (P3 && P3.lights) || {};
  const pm = (P3 && P3.materials) || {};
  const src = new Map();
  const listeners = [];
  let shadowBudget = MOBILE ? 0 : 2;     // point-light shadows (6 passes each, tiny frusta); the spot always has one

  function pointShadow(l, far) {
    if (shadowBudget <= 0) return;
    shadowBudget--;
    l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.camera.near = .06; l.shadow.camera.far = far;
    l.shadow.bias = -.004; l.shadow.normalBias = .03; l.shadow.radius = 3; l.shadow.autoUpdate = false;
  }

  // the lamp's own housing must not swallow its light; give each lantern its own pane material so panes glow per lamp
  function claimHousing(pos, r = .32) {
    const panes = [];
    const wp = V();
    scene.traverse(o => {
      if (!o.isMesh) return;
      o.getWorldPosition(wp);
      if (wp.distanceTo(pos) > r) return;
      o.castShadow = false;
      if (pm.lampGlass && o.material === pm.lampGlass) {
        if (!panes.length) panes.push(pm.lampGlass.clone());
        const m = panes[0]; m.emissive = new THREE.Color(0xFFB060); m.emissiveIntensity = 0; o.material = m;
      }
    });
    return panes;
  }

  // a standing/wall lantern body (Props' lantern housing) at a point, for the lanterns Props doesn't place itself
  function housing(pos) { if (!P3 || !P3.lanternHousing) return; const g = new THREE.Group(); g.position.copy(pos); scene.add(g); P3.lanternHousing(g, .2); g.updateMatrixWorld(true); }

  function bulbMesh(pos, r, col = 0xFFE0A0) {
    const m = new THREE.MeshStandardMaterial({ color: col, emissive: 0xFF9A30, emissiveIntensity: 0, roughness: .4 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m); b.position.copy(pos); scene.add(b); return m;
  }

  // a source: lights (with their full intensity), emissive materials (with full emissiveIntensity / opacity)
  function add(name, room, kind, pos, { lights = [], emis = [], opac = [], halo = null, haloSize = 1.5, extra = null, autoFn }) {
    let haloObj = null;
    if (ENV && ENV.addHalo) {
      // halos follow .intensity; an emissive-only lantern gets a light-less proxy so it still glows in the fog
      haloObj = halo || (lights[0] && lights[0].l) || Object.assign(new THREE.Object3D(), { intensity: 0 });
      if (!haloObj.parent) { haloObj.position.copy(pos); scene.add(haloObj); }
      ENV.addHalo(haloObj, haloSize);
    }
    const s = { idx: src.size, name, room, kind, pos: pos.clone(), lights, emis, opac, haloObj, extra, autoFn, on: false, level: 0, manual: null, seed: Math.random() * 9, flare: 0 };
    src.set(name, s); return s;
  }

  // ---------- kitchen: hanging lantern over the counter + a small one on the front counter ----------
  const kPos = PL.kitchenLamp ? PL.kitchenLamp.pos.clone() : V(-2.3, KT + 1.78, 1.75);
  {
    const l = new THREE.PointLight(0xFFB25E, 0, 5.5, 1.6); l.position.copy(kPos); scene.add(l); pointShadow(l, 5.5);
    const panes = claimHousing(kPos);
    const b = bulbMesh(kPos, .07);
    const front = V(-2.4, KT + 1.5, 3.5); housing(front); claimHousing(front, .3); const fb = bulbMesh(front, .06);
    add('kitchen', 'kitchen', 'oil', kPos, { lights: [{ l, I: 6 }], emis: [[b, 5], [fb, 4], ...panes.map(m => [m, .6])], autoFn: c => c.lamps > .45 });
  }

  // ---------- workshop: dome lamp, a real downward cone with a soft shadow, plus a faint bounce off the bench ----------
  const wPos = PL.workshopLamp ? PL.workshopLamp.pos.clone() : V(3.75, WS + 1.5, 2.45);
  {
    const sp = new THREE.SpotLight(0xFFC27A, 0, 6, 1.05, .75, 1.5); sp.position.copy(wPos).add(V(0, -.04, 0));
    sp.target.position.copy(wPos).add(V(-.35, -2, -.25)); scene.add(sp, sp.target);
    sp.castShadow = true; sp.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024); sp.shadow.camera.near = .08; sp.shadow.camera.far = 6;
    sp.shadow.bias = -.002; sp.shadow.normalBias = .03; sp.shadow.radius = 3; sp.shadow.autoUpdate = false;
    claimHousing(wPos, .3);
    const b = bulbMesh(wPos.clone().add(V(0, .05, 0)), .055, 0xFFF0C8);
    const emis = [[b, 6]]; if (pm.domeInner) { pm.domeInner.emissive = new THREE.Color(0xFFD9A0); emis.push([pm.domeInner, .9]); }
    add('workshop', 'workshop', 'electric', wPos, { lights: [{ l: sp, I: 14 }], emis, halo: sp, haloSize: 1.3, autoFn: c => c.lamps > .55 });
  }

  // ---------- bedroom: wall lantern + the candle on the reading table ----------
  const bPos = V(-2.0, BD + 1.95, 2.5);
  {
    const l = new THREE.PointLight(0xFFB25E, 0, 5.5, 1.6); l.position.copy(bPos); scene.add(l); pointShadow(l, 5.5);
    housing(bPos); const panes = claimHousing(bPos);
    const b = bulbMesh(bPos, .065);
    add('bedroom', 'bedroom', 'oil', bPos, { lights: [{ l, I: 6.5 }], emis: [[b, 5], ...panes.map(m => [m, .6])],
      autoFn: c => c.lamps > .4 && !(c.task === 'sleep' && c.asleep) });
  }
  if (PL.candle) {
    const cPos = PL.candle.pos.clone();
    let lights = [];
    if (!MOBILE) { const l = new THREE.PointLight(0xFF9C45, 0, 2.6, 2); l.position.copy(cPos).add(V(0, .04, 0)); scene.add(l); lights = [{ l, I: 1.6, sway: .012 }]; }
    add('candle', 'bedroom', 'candle', cPos, { lights, opac: [[PL.candle.mats[0] || pm.candleFlame, .95]], haloSize: .45,
      autoFn: c => c.task === 'read' && c.lamps > .25 });
  }

  // ---------- outside: lantern by the ladder landing (the deck lantern was removed: it read as a lantern on the bedroom roof) ----------
  {
    const p = V(-.62, LC + 1.25, 3.84); const l = new THREE.PointLight(0xFFB25E, 0, 5, 1.6); l.position.copy(p); scene.add(l);
    housing(p); const panes = claimHousing(p); const b = bulbMesh(p, .065);
    add('landing', 'outside', 'oil', p, { lights: [{ l, I: 5 }], emis: [[b, 5], ...panes.map(m => [m, .6])], autoFn: c => c.lamps > .6 });
  }

  // ---------- oven fire (Props draws the fire; we own whether it burns) ----------
  if (PL.oven || (P3 && P3.oven)) {
    const p = PL.oven ? PL.oven.pos.clone() : V(-3.25, KT + .3, 1.45);
    const l = new THREE.PointLight(0xFF7A2A, 0, 4.2, 1.8); l.position.copy(p).add(V(.05, .1, .55)); scene.add(l);
    add('oven', 'kitchen', 'fire', p, { lights: [{ l, I: 4.2, sway: .03 }], haloSize: .9, extra: k => {
      // index.html passes this level to props.update(), which calls oven.setHeat once per frame
      // Props keeps a faint ember glow at heat 0; a cold oven shows nothing
      if (pm.fire) pm.fire.emissiveIntensity = 2.45 * k;
      if (pm.ovenGlass) pm.ovenGlass.emissiveIntensity = .7 * k;
      const open = P3.oven ? P3.oven.open || 0 : 0; l.userData.open = open;
    }, autoFn: c => c.cookT > 0 });
  }

  // ---------- the glowing door in the trunk ----------
  let doorLight = null;
  if (TREE && TREE.doorAngle !== undefined && TREE.R) {
    const dd = V(Math.cos(TREE.doorAngle), 0, Math.sin(TREE.doorAngle));
    const ax = LV.TAX; const r = TREE.R(LG + .7) - .3;
    doorLight = new THREE.PointLight(0xFF9A40, 0, 4, 1.6); doorLight.position.set(ax[0] + dd.x * r, LG + .75, ax[1] + dd.z * r); scene.add(doorLight);
    // the lantern-lit cave inside the hollow: a warm light deep in it lights the carved walls, the one at the mouth spills onto the platform
    const rIn = TREE.R(LG + .7) - 1.0;
    const cave = new THREE.PointLight(0xFFA850, 0, 2.4, 1.4); cave.position.set(ax[0] + dd.x * rIn, LG + .85, ax[1] + dd.z * rIn); scene.add(cave);
    doorLight.position.set(ax[0] + dd.x * (r + .25), LG + .8, ax[1] + dd.z * (r + .25));
    const glow = TREE.bark && TREE.bark.material.userData.doorGlow;
    add('door', 'outside', 'door', doorLight.position, { lights: [{ l: doorLight, I: 4 }, { l: cave, I: 5, sway: .02 }], haloSize: 2.4,
      extra: (k, f) => { if (glow) glow.value = 1.6 * k * f; }, autoFn: c => c.lamps > .3 });
  }

  // ---------- windows: warm only while their room is lit; otherwise a faint cold sky reflection ----------
  const WARM = new THREE.Color(0xFFA548), COLD = new THREE.Color(0x5E8CC0), tmpC = new THREE.Color();
  for (const w of windows) { w.mat.emissive = w.mat.emissive.clone(); }

  // ---------- room glow, driven only by the room's own sources ----------
  // A lit room is warm all over (walls, ceiling, corners), not just a hotspot by the lamp: a soft unshadowed
  // bounce light in the middle of the room stands in for the light the warm planks throw back.
  // Light also leaves through the back windows onto the trunk (desktop: a small spill light; phones: halo only).
  const ROOMS = {
    kitchen:  { c: V(-2.65, KT + 1.05, 2.5), bounce: 2.0 },
    bedroom:  { c: V(-1.9, BD + 1.1, 2.3), bounce: 1.6 },
    workshop: { c: V(2.75, WS + 1.1, 2.9), bounce: 2.6 },
  };
  const glows = [];
  for (const [room, R] of Object.entries(ROOMS)) {
    const b = new THREE.PointLight(0xFFBE80, 0, 3.8, 1.3); b.position.copy(R.c); scene.add(b);
    glows.push({ room, l: b, I: R.bounce });
  }
  for (const w of windows) {
    if (!w.g || !ROOMS[w.room]) continue;
    w.g.updateMatrixWorld(true); const p = w.g.getWorldPosition(V());
    const n = V(0, 0, 1).applyQuaternion(w.g.quaternion); n.y = 0; n.normalize();
    const out = p.clone().sub(ROOMS[w.room].c); out.y = 0; if (out.dot(n) < 0) n.negate();
    const hp = p.clone().addScaledVector(n, .12);
    w.n = n; w.room0 = ROOMS[w.room].c;
    if (ENV && ENV.addHalo) { const h = Object.assign(new THREE.Object3D(), { intensity: 0 }); h.position.copy(hp); scene.add(h); ENV.addHalo(h, 1.25); glows.push({ room: w.room, halo: h, I: 2.6 }); }
    const back = Math.abs(n.z) > .7;
    if (back && !MOBILE) { const l = new THREE.PointLight(0xFFA850, 0, 3.4, 1.6); l.position.copy(p).addScaledVector(n, .45); scene.add(l); glows.push({ room: w.room, l, I: 2.4, spill: true }); }
  }
  const warm = {};

  // ---------- daytime: sunbeams through the windows, with warm dust drifting in them ----------
  // A soft additive prism from each window pane, along the real sun direction (the scene's shadow-casting
  // directional light), only for windows that face the sun, strongest when the sun is low (morning/evening).
  // Positions are built on the GPU from the window corners and the sun vector, so nothing is re-meshed per frame.
  let sunL = null; scene.traverse(o => { if (o.isDirectionalLight && o.castShadow && !sunL) sunL = o; });
  const beamU = { uT: { value: 0 } };
  // beam prism: position = (u, v, t) on the window (u, v) pushed t along the light; aS = across coordinate for soft edges
  const beamVS = `
    attribute float aS; uniform vec3 c0, eu, ev, dir; varying float vS, vT;
    void main(){ vS = aS; vT = position.z; vec3 p = c0 + eu*position.x + ev*position.y + dir*position.z;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`;
  const beamFS = `
    uniform float k; varying float vS, vT;
    void main(){ float a = k * pow(sin(3.14159*vS), 1.6) * pow(1.-vT, 1.4) * smoothstep(0., .06, vT);
      gl_FragColor = vec4(vec3(1., .86, .62) * a, 1.); }`;
  const dustVS = `
    attribute vec4 aD; uniform vec3 c0, eu, ev, dir; uniform float uT, px; varying float vA;
    void main(){ float t = fract(aD.z + uT*.012*(.5+aD.w));
      float u = clamp(aD.x + sin(uT*.31 + aD.w*40.)*.05, 0., 1.), v = clamp(aD.y + sin(uT*.23 + aD.w*70.)*.06, 0., 1.);
      vec3 p = c0 + eu*u + ev*v + dir*t; vec4 mv = viewMatrix * vec4(p, 1.);
      vA = sin(3.14159*u) * sin(3.14159*v) * (1.-t) * smoothstep(0., .08, t) * (.55 + .45*sin(uT*2.1 + aD.w*90.));
      gl_PointSize = px * (1.2 + aD.w*1.6) * 3. / max(.5, -mv.z); gl_Position = projectionMatrix * mv; }`;
  const dustFS = `
    uniform float k; varying float vA;
    void main(){ vec2 q = gl_PointCoord - .5; float d = 1. - smoothstep(.15, .5, length(q)); gl_FragColor = vec4(vec3(1., .85, .6) * d * vA * k, 1.); }`;
  const prism = (() => {
    const pos = [], across = [];
    for (const [a, b] of [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]]) {
      for (const [e, t] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) { const c = e ? b : a; pos.push(c[0], c[1], t); across.push(e); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.Float32BufferAttribute(across, 1)); return g;
  })();
  const beams = [];
  const nDust = MOBILE ? 22 : 40;
  for (const w of windows) {
    const pane = w.g && w.g.children[0];
    if (!pane || !pane.geometry || !pane.geometry.parameters || !w.n) continue;
    const { width: pw, height: ph } = pane.geometry.parameters;
    pane.updateMatrixWorld(true);
    const corner = (x, y) => pane.localToWorld(V(x * pw * .46, y * ph * .46, 0));
    const c0 = corner(-1, -1);
    const U = { c0: { value: c0 }, eu: { value: corner(1, -1).sub(c0) }, ev: { value: corner(-1, 1).sub(c0) }, dir: { value: V() }, uT: beamU.uT };
    const bm = new THREE.ShaderMaterial({ uniforms: { ...U, k: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexShader: beamVS, fragmentShader: beamFS });
    const m = new THREE.Mesh(prism, bm); m.frustumCulled = false; m.renderOrder = 3; m.visible = false; scene.add(m);
    const dg = new THREE.BufferGeometry(); const d = new Float32Array(nDust * 4);
    for (let i = 0; i < nDust * 4; i++) d[i] = Math.random();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nDust * 3), 3)); dg.setAttribute('aD', new THREE.BufferAttribute(d, 4));
    const dm = new THREE.ShaderMaterial({ uniforms: { ...U, k: { value: 0 }, px: { value: MOBILE ? 1.5 : 2 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: dustVS, fragmentShader: dustFS });
    const pts = new THREE.Points(dg, dm); pts.frustumCulled = false; pts.renderOrder = 3; pts.visible = false; scene.add(pts);
    beams.push({ w, U, m, pts });
  }
  const sunV = V();
  function updateBeams(dayK, T) {
    beamU.uT.value = T;
    let on = 0;
    if (sunL && dayK > .05) { sunV.copy(sunL.position).sub(sunL.target.position).normalize(); on = dayK * Math.min(1, sunL.intensity / 2.2); }
    const low = 1 - Math.min(1, Math.max(0, sunV.y - .15) / .7);      // low sun: long golden beams
    for (const b of beams) {
      const face = on > 0 ? sunV.x * b.w.n.x + sunV.z * b.w.n.z : 0;     // sun on the outer side of this window?
      const k = on * Math.max(0, Math.min(1, (face - .05) * 3)) * (.35 + .65 * low);
      b.m.visible = b.pts.visible = k > .01;
      if (!b.m.visible) continue;
      b.U.dir.value.copy(sunV).multiplyScalar(-(2.2 + low * 1.3));
      b.m.material.uniforms.k.value = k * .16; b.pts.material.uniforms.k.value = k;
    }
  }

  // ---------- the switching logic ----------
  function fire(name, on) { for (const cb of listeners) { try { cb(name, on); } catch (e) { console.error(e); } } }
  function setOn(s, on) { if (s.on === on) return; s.on = on; if (on) s.flare = 1; fire(s.name, on); }
  let cookT = 0, t = 0, frame = 0;
  let quality = 2, shadowEvery = MOBILE ? 3 : 2;   // shadow maps redrawn every Nth frame

  // smooth 1D value noise in [-1, 1]: flames breathe instead of pulsing like a sine
  const hash = n => { const x = Math.sin(n * 127.1) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  const noise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
  function flick(s, T) {
    const k = s.seed * 17;
    switch (KINDS[s.kind].flick) {
      // oil lantern: steady, a slow breath and a rare small dip when the wick gutters
      case 'flame': return .93 + noise(T * 1.3 + k) * .035 + noise(T * 7 + k) * .02 - Math.max(0, noise(T * .45 + k) - .55) * .25;
      case 'candle': return .84 + noise(T * 2.2 + k) * .07 + noise(T * 9 + k) * .05 + noise(T * 23 + k) * .02;
      case 'fire': return .8 + noise(T * 1.6 + k) * .1 + noise(T * 6 + k) * .07 + noise(T * 15 + k) * .03;
      default: return 1 + noise(T * 40) * .004;
    }
  }

  function update({ dt, T, lampOn = 0, dayK = 0, task = null, state = null, asleep = false }) {
    t += dt; frame++;
    const cooking = task === 'cook' && state === 'work';
    cookT = cooking ? 40 : Math.max(0, cookT - dt);     // the fire is fed while cooking and burns a while after
    const ctx = { lamps: lampOn, dayK, task, state, asleep, cookT };
    for (const r in warm) warm[r] = 0;
    for (const s of src.values()) {
      // once it is properly light, a lamp left burning goes out on its own after a while (the oil runs low,
      // nobody needs it): it hands itself back to the day/night logic, which says off in daylight
      if (s.manual === true && s.kind !== 'fire' && dayK > .7) { s.dayOn = (s.dayOn || 0) + dt; if (s.dayOn > 45) { s.manual = null; s.dayOn = 0; } }
      else s.dayOn = 0;
      const want = s.manual !== null ? s.manual : !!s.autoFn(ctx);
      setOn(s, want);
      const K = KINDS[s.kind];
      s.level = s.on ? Math.min(1, s.level + dt / K.on) : Math.max(0, s.level - dt / K.off);
      s.flare = Math.max(0, s.flare - dt * 1.6);
      // ignition: oil/candle flare up then settle; the bulb stutters once
      let k = s.level;
      if (s.kind === 'oil' || s.kind === 'candle') k = s.level * (1 + s.flare * .35 * Math.max(0, Math.sin(t * 31 + s.seed)));
      else if (s.kind === 'electric' && s.flare > .85) k *= (Math.sin(t * 90) > 0 ? 1 : .35);
      else if (s.kind === 'fire') k = s.level * s.level * (3 - 2 * s.level);
      const f = k > 0 ? flick(s, T) : 0;
      const open = s.extra && s.lights[0] && s.lights[0].l.userData.open || 0;
      for (const L of s.lights) {
        L.l.intensity = L.I * k * f * (1 + open * 1.2);
        if (L.sway) { if (!L.home) L.home = L.l.position.clone(); const a = T * 1.7 + s.seed * 5; L.l.position.set(L.home.x + noise(a) * L.sway, L.home.y + noise(a + 40) * L.sway * .6, L.home.z + noise(a + 80) * L.sway); }
        if (L.l.castShadow) { const lit = k > .01; if (lit && (!L.wasLit || (frame + s.idx) % shadowEvery === 0)) L.l.shadow.needsUpdate = true; L.wasLit = lit; }
      }
      for (const [m, I] of s.emis) m.emissiveIntensity = I * k * f;
      for (const [m, O] of s.opac) if (m) m.opacity = O * clamp01(k) * (.85 + f * .15);
      if (s.extra) s.extra(k, f);
      if (!s.lights.length && s.haloObj) s.haloObj.intensity = 4.5 * k * f;
      const share = s.kind === 'candle' ? .3 : s.kind === 'fire' ? .55 : 1;
      warm[s.room] = Math.min(1.2, (warm[s.room] || 0) + k * f * share);
    }
    for (const g of glows) { const v = g.off ? 0 : (warm[g.room] || 0) * g.I * (1 - dayK * .8); if (g.l) g.l.intensity = v; if (g.halo) g.halo.intensity = v; }
    updateBeams(dayK, T);
    for (const w of windows) {
      const lit = Math.min(1, warm[w.room] || 0);
      // panes are see-through glass (Pavel): only a faint warm tint while the room is lit, no cold self-glow;
      // the real window glow is the halo and the spill light outside (room glow above)
      tmpC.setRGB(0, 0, 0).lerp(WARM, clamp01(lit) * (1 - dayK * .7));
      w.mat.emissive.copy(tmpC); w.mat.emissiveIntensity = .18;
    }
  }

  function roomLevel(room) {
    let v = 0;
    for (const s of src.values()) if (s.room === room) v = Math.max(v, s.kind === 'candle' ? s.level * .35 : s.kind === 'fire' ? s.level * .55 : s.level);
    return v;
  }

  // quality for a frame-rate governor: 2 full, 1 no lantern (point) shadows + slower shadow redraws + no window spill
  // lights, 0 no shadows at all. The look of the rooms stays (same lights, bounce, halos); only shadows thin out.
  const shadowed = []; for (const s of src.values()) for (const L of s.lights) if (L.l.castShadow) shadowed.push(L.l);
  function setQuality(q) {
    q = Math.max(0, Math.min(2, q | 0)); if (q === quality) return quality; quality = q;
    for (const l of shadowed) { l.castShadow = l.isSpotLight ? q >= 1 : q >= 2; l.shadow.needsUpdate = true; }
    shadowEvery = q >= 2 ? (MOBILE ? 3 : 2) : 4;
    for (const g of glows) if (g.spill) g.off = q < 2;
    return quality;
  }
  const degrade = () => quality > 0 && setQuality(quality - 1) !== null;
  const upgrade = () => quality < 2 && setQuality(quality + 1) !== null;

  const view = s => ({ name: s.name, room: s.room, kind: s.kind, on: s.on, level: +s.level.toFixed(2), auto: s.manual === null, pos: s.pos.clone() });
  const api = {
    names: [...src.keys()],
    list: () => [...src.values()].map(view),
    get: n => src.has(n) ? view(src.get(n)) : null,
    pos: n => src.has(n) ? src.get(n).pos.clone() : null,
    set: (n, on) => { const s = src.get(n); if (!s) return false; s.manual = !!on; setOn(s, !!on); return true; },
    toggle: n => { const s = src.get(n); if (!s) return false; return api.set(n, !s.on); },
    auto: n => { for (const s of src.values()) if (!n || s.name === n) s.manual = null; },
    room: roomLevel,
    onChange: cb => listeners.push(cb),
    level: n => src.has(n) ? src.get(n).level : 0,
    update, degrade, upgrade, quality: q => q === undefined ? quality : setQuality(q),
  };
  return api;
}
