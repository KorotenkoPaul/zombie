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
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const _v = new THREE.Vector3();

// how a source wakes up and dies down (seconds), and how it flickers
const KINDS = {
  oil:      { on: .7,  off: .5,  flick: 'flame' },   // oil lanterns: catch, flare, settle
  electric: { on: .12, off: .08, flick: 'bulb' },    // dome lamp: quick, a small stutter
  candle:   { on: 1.0, off: .35, flick: 'candle' },
  fire:     { on: 4.5, off: 14,  flick: 'fire' },    // oven: the fire takes, the embers die slowly
  door:     { on: 1.5, off: 1.5, flick: 'flame' },
  glow:     { on: .4,  off: .3,  flick: 'bulb' },     // a radio dial, an indicator: emissive only
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
  function housing(pos, rod = .02) { if (!P3 || !P3.lanternHousing) return null; const g = new THREE.Group(); g.position.copy(pos); scene.add(g); P3.lanternHousing(g, rod); g.updateMatrixWorld(true); return g; }

  // nothing floats: a lantern hangs on a chain from whatever is above it (ceiling, roof, floor of the room above);
  // if nothing is above, an iron bracket comes out of the nearest wall, post or trunk and the chain hangs from its tip
  const ironM = new THREE.MeshStandardMaterial({ color: 0x2C2F35, metalness: .7, roughness: .45 });
  const linkGeo = new THREE.TorusGeometry(.016, .0045, 5, 10);
  const rc = new THREE.Raycaster();
  function solids() { const out = []; scene.traverse(o => { const m = o.material; if ((o.isMesh || o.isInstancedMesh) && o.visible && !o.isSprite && m && !Array.isArray(m) && !m.transparent && !(m.alphaTest > 0) && !m.isShaderMaterial && !o.userData.noHang) out.push(o); }); return out; }
  const postM = new THREE.MeshStandardMaterial({ color: 0x5E3B24, roughness: .85 });
  function chain(a, b) {      // links from a (bottom) to b (top)
    const L = a.distanceTo(b), n = Math.max(1, Math.round(L / .042));
    const im = new THREE.InstancedMesh(linkGeo, ironM, n); im.userData.noHang = true; im.castShadow = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = b.clone().sub(a).normalize(), base = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), up);
    for (let i = 0; i < n; i++) { q.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i % 2) * Math.PI / 2, Math.PI / 2))); m.compose(a.clone().lerp(b, (i + .5) / n), q, V(1, 1.25, 1)); im.setMatrixAt(i, m); }
    scene.add(im); return im;
  }
  function hang(pos, topOff = .23) {
    const top = pos.clone().add(V(0, topOff, 0)), list = solids();
    rc.set(top, V(0, 1, 0)); rc.far = 2.6; const up = rc.intersectObjects(list, false)[0];
    if (up) { chain(top, up.point.clone().add(V(0, .02, 0))); const hook = new THREE.Mesh(new THREE.TorusGeometry(.025, .006, 6, 12), ironM); hook.position.copy(up.point).add(V(0, -.02, 0)); hook.userData.noHang = true; scene.add(hook); return 'chain'; }
    // bracket: find the nearest vertical surface around the lantern's top
    let best = null;
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, d = V(Math.cos(a), 0, Math.sin(a)); const o = top.clone().add(V(0, .25, 0)); rc.set(o, d); rc.far = 1.3; const h = rc.intersectObjects(list, false)[0]; if (h && (!best || h.distance < best.h.distance)) best = { h, d }; }
    let tip = top.clone().add(V(0, .25, 0)), wall;
    if (best) wall = best.h.point;
    else {
      // nothing around: a little wooden lamp post on the floor below, with the iron arm reaching over
      rc.set(pos, V(0, -1, 0)); rc.far = 4; const fl = rc.intersectObjects(list, false)[0]; if (!fl) return 'none';
      const toAxis = V((LV.TAX ? LV.TAX[0] : 0) - pos.x, 0, (LV.TAX ? LV.TAX[1] : 0) - pos.z).normalize();
      const base = V(pos.x + toAxis.x * .35, fl.point.y, pos.z + toAxis.z * .35), h = tip.y + .06 - base.y;
      const post = new THREE.Mesh(new THREE.BoxGeometry(.09, h, .09), postM); post.position.set(base.x, base.y + h / 2, base.z); post.castShadow = post.receiveShadow = true; post.userData.noHang = true; scene.add(post);
      wall = V(base.x, tip.y, base.z);
    }
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, wall.distanceTo(tip), 6), ironM);
    arm.position.copy(wall).lerp(tip, .5); arm.quaternion.setFromUnitVectors(V(0, 1, 0), tip.clone().sub(wall).normalize()); arm.userData.noHang = true; scene.add(arm);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(.03, .16, .08), ironM); plate.position.copy(wall); plate.lookAt(tip); plate.rotateY(Math.PI / 2); plate.userData.noHang = true; scene.add(plate);
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, 1, 5), ironM); const b0 = wall.clone().add(V(0, -.16, 0)), b1 = wall.clone().lerp(tip, .6);
    brace.scale.y = b0.distanceTo(b1); brace.position.copy(b0).lerp(b1, .5); brace.quaternion.setFromUnitVectors(V(0, 1, 0), b1.clone().sub(b0).normalize()); brace.userData.noHang = true; scene.add(brace);
    chain(top, tip); return 'bracket';
  }

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

  // ---------- kitchen: hanging lantern over the counter (the old front lantern hung in mid-air and was removed) ----------
  const kPos = PL.kitchenLamp ? PL.kitchenLamp.pos.clone() : V(-2.3, KT + 1.78, 1.75);
  {
    const l = new THREE.PointLight(0xFFB25E, 0, MOBILE ? 6.5 : 5.5, MOBILE ? 1.25 : 1.6); l.position.copy(kPos); scene.add(l); pointShadow(l, 5.5);
    const panes = claimHousing(kPos);
    const b = bulbMesh(kPos, .07);
    add('kitchen', 'kitchen', 'oil', kPos, { lights: [{ l, I: MOBILE ? 5.2 : 4.6 }], emis: [[b, 5], ...panes.map(m => [m, .6])], autoFn: c => c.lamps > .45 });
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
    const l = new THREE.PointLight(0xFFB25E, 0, MOBILE ? 6.5 : 5.5, MOBILE ? 1.25 : 1.6); l.position.copy(bPos); scene.add(l); pointShadow(l, 5.5);
    housing(bPos); hang(bPos); const panes = claimHousing(bPos);
    const b = bulbMesh(bPos, .065);
    add('bedroom', 'bedroom', 'oil', bPos, { lights: [{ l, I: MOBILE ? 7 : 6.5 }], emis: [[b, 5], ...panes.map(m => [m, .6])],
      autoFn: c => c.lamps > .4 && !(c.task === 'sleep' && c.asleep) });
  }
  if (PL.candle) {
    const cPos = PL.candle.pos.clone();
    let lights = [];
    if (!MOBILE) { const l = new THREE.PointLight(0xFF9C45, 0, 2.6, 2); l.position.copy(cPos).add(V(0, .04, 0)); scene.add(l); lights = [{ l, I: 1.6, sway: .012 }]; }
    add('candle', 'bedroom', 'candle', cPos, { lights, opac: [[PL.candle.mats[0] || pm.candleFlame, .95]], haloSize: .45,
      // lit when he reads in the dark; only the hero puts it out (lights.set('candle', false) at lights.pos('candle'))
      autoFn: () => false });
  }

  // ---------- outside: lantern by the ladder landing (the deck lantern was removed: it read as a lantern on the bedroom roof) ----------
  {
    const p = V(-.62, LC + 1.25, 3.84); const l = new THREE.PointLight(0xFFB25E, 0, 5, 1.6); l.position.copy(p); scene.add(l);
    housing(p); hang(p); const panes = claimHousing(p); const b = bulbMesh(p, .065);
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

  // ---------- the hero's hand lantern (Character attaches it to a hand bone when he goes out at night) ----------
  const hand = { g: new THREE.Group(), attached: null, swing: 0, prev: V() };
  {
    const g = hand.g; g.visible = false; scene.add(g);
    if (P3 && P3.lanternHousing) { const hh = new THREE.Group(); hh.scale.setScalar(.62); hh.position.y = -.17; P3.lanternHousing(hh, .02); g.add(hh); hh.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
    const bm = new THREE.MeshStandardMaterial({ color: 0xFFE0A0, emissive: 0xFF9A30, emissiveIntensity: 0, roughness: .4 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), bm); bulb.position.y = -.17; g.add(bulb);
    const l = new THREE.PointLight(0xFFB25E, 0, 4.5, 1.6); l.position.y = -.17; g.add(l);
    hand.bulbPos = bulb;
    add('hand', 'outside', 'oil', V(), { lights: [{ l, I: 2.6 }], emis: [[bm, 5]], haloSize: .9, autoFn: () => false });
  }
  function updateHand(dt) {
    const g = hand.g, hs = src.get('hand');
    if (!hand.attached) { if (hs && hs.manual) hs.manual = null; return; }     // nothing to light while nobody carries it
    hand.bulbPos.getWorldPosition(hs.pos);
    // hangs from the fingers, stays upright and swings a little with the walk
    const pq = hand.attached.getWorldQuaternion(new THREE.Quaternion()).invert();
    const wp = hand.attached.getWorldPosition(V()); const v = wp.clone().sub(hand.prev).divideScalar(Math.max(dt, 1e-3)); hand.prev.copy(wp);
    hand.swing += (Math.max(-.35, Math.min(.35, v.x * .12)) - hand.swing) * Math.min(1, dt * 4);
    g.quaternion.copy(pq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.max(-.35, Math.min(.35, -v.z * .12)), 0, -hand.swing)));
  }

  // ---------- the glowing door in the trunk ----------
  let doorLight = null;
  if (TREE && TREE.doorAngle !== undefined && TREE.R) {
    const dd = V(Math.cos(TREE.doorAngle), 0, Math.sin(TREE.doorAngle));
    const ax = LV.TAX; const r = TREE.R(LG + .7) - .3;
    doorLight = new THREE.Object3D(); doorLight.position.set(ax[0] + dd.x * r, LG + .75, ax[1] + dd.z * r);
    // the lantern-lit cave inside the hollow: a warm light deep in it lights the carved walls, the one at the mouth spills onto the platform
    const rIn = TREE.R(LG + .7) - 1.0;
    const cave = new THREE.PointLight(0xFFA850, 0, 3.6, 1.3); cave.position.set(ax[0] + dd.x * rIn, LG + .85, ax[1] + dd.z * rIn); scene.add(cave);
    doorLight.position.set(ax[0] + dd.x * (r + .25), LG + .8, ax[1] + dd.z * (r + .25));
    const glow = TREE.bark && TREE.bark.material.userData.doorGlow;
    // the warm wedge that falls out of the doorway onto the landing, the roots and the path below it
    const spill = new THREE.SpotLight(0xFFA650, 0, 9, .75, 1, 1.4);
    spill.position.set(ax[0] + dd.x * (r - .2), LG + 1.25, ax[1] + dd.z * (r - .2));
    spill.target.position.set(ax[0] + dd.x * (r + 2.6), 0, ax[1] + dd.z * (r + 2.6)); scene.add(spill, spill.target);
    add('door', 'outside', 'door', doorLight.position, { lights: [{ l: cave, I: 6.5, sway: .02 }, { l: spill, I: 9 }], haloSize: 2.4,
      extra: (k, f) => { if (glow) glow.value = 1.6 * k * f; }, autoFn: c => c.lamps > .3 });
  }

  // ---------- windows: warm only while their room is lit; otherwise a faint cold sky reflection ----------
  const PANE_DAY = new THREE.Color(0x9CC4E0), PANE_NIGHT = new THREE.Color(0x1C2A3E), SKY_DAY = new THREE.Color(0x5E8CC0), SKY_NIGHT = new THREE.Color(0x24406A);
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
  // the camera, captured as the scene renders: a window's outside halo must not shine into the room through the glass
  let cam = null;
  { const prev = scene.onBeforeRender; scene.onBeforeRender = function (r, sc, c, ...a) { cam = c; if (prev) prev.call(this, r, sc, c, ...a); }; }
  for (const [room, R] of Object.entries(ROOMS)) {
    if (MOBILE && room !== 'workshop') continue;      // phones: the lantern itself has a softer, longer falloff instead (fewer lights)
    // bounce = light thrown back by the lit walls: no falloff inside the room (decay 0, soft cut at the walls), so it
    // never makes a hot spot on whatever stands next to it (the upper bunk sat 10 cm from the old one and burned white)
    const b = new THREE.PointLight(0xFFBE80, 0, 3.6, 0); b.position.copy(R.c); scene.add(b);
    glows.push({ room, l: b, I: R.bounce * .5 });
  }
  for (const w of windows) {
    if (!w.g || !ROOMS[w.room]) continue;
    w.g.updateMatrixWorld(true); const p = w.g.getWorldPosition(V());
    const n = V(0, 0, 1).applyQuaternion(w.g.quaternion); n.y = 0; n.normalize();
    const out = p.clone().sub(ROOMS[w.room].c); out.y = 0; if (out.dot(n) < 0) n.negate();
    const hp = p.clone().addScaledVector(n, .12);
    w.n = n; w.room0 = ROOMS[w.room].c; w.glowAt = p.clone().addScaledVector(n, .5);
    if (ENV && ENV.addHalo) { const h = Object.assign(new THREE.Object3D(), { intensity: 0 }); h.position.copy(hp); scene.add(h); ENV.addHalo(h, 1.25); glows.push({ room: w.room, halo: h, I: 2.6, hp, n }); }
    const back = Math.abs(n.z) > .7;
    // spill: a cone thrown OUT of the window onto the bark and leaves. A spot pointing away from the room, so it can't
    // reach the inside walls through the boards (the old point light lit a hot stripe beside the kitchen window).
    if (back && !MOBILE) {
      const l = new THREE.SpotLight(0xFFA850, 0, 3.6, 1.05, .85, 1.6); l.position.copy(p).addScaledVector(n, .2);
      l.target.position.copy(p).addScaledVector(n, 2).add(V(0, -.5, 0)); scene.add(l, l.target);
      glows.push({ room: w.room, l, I: 3, spill: true });
    }
  }
  const warm = {};

  // ---------- lit windows warm the leaves and branches right next to them (photo) ----------
  // No lights: the oak's bark and leaf shaders (tree.js) get two small uniform arrays, one warm point per window,
  // and add a soft emissive glow that fades out within ~1.8 m. Chained onto Tree's own onBeforeCompile.
  const WG_N = 12, wgP = { value: Array.from({ length: WG_N }, () => new THREE.Vector4(0, -99, 0, 0)) }, wgC = { value: Array.from({ length: WG_N }, () => new THREE.Vector3()) };
  const wgWins = windows.filter(w => w.glowAt).slice(0, WG_N);
  // each entry: a warm point, its reach, and how bright it is now (photo: the bark around the house is warm brown at night,
  // lit by the windows, the lanterns and the open room fronts). Windows reach 3.4 m; the rooms' open fronts and the
  // outdoor lanterns reach further. Lit with a soft wrap toward the source, so the bark keeps its relief.
  const wgSrc = wgWins.map(w => ({ p: w.glowAt, r: 3.4, k: () => Math.min(1, warm[w.room] || 0) * 4.5 }));
  for (const [room, R] of Object.entries(ROOMS)) wgSrc.push({ p: R.c, r: 5.5, k: () => Math.min(1, warm[room] || 0) * 3.2 });
  for (const [n, r, I] of [['landing', 3.6, 6], ['door', 3.2, 5]]) { const s0 = src.get(n); if (s0) wgSrc.push({ p: s0.pos, r, k: () => s0.level * I }); }
  wgSrc.length = Math.min(wgSrc.length, WG_N);
  wgSrc.forEach((w, i) => wgP.value[i].set(w.p.x, w.p.y, w.p.z, w.r));
  let wgOn = true; const wgMats = [];
  function treeGlow(mat) {
    if (!mat || mat.userData.winGlow) return; mat.userData.winGlow = true; wgMats.push(mat);
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      if (!wgOn) return;
      sh.uniforms.wgP = wgP; sh.uniforms.wgC = wgC;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWGp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n{vec4 q=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nq=instanceMatrix*q;\n#endif\nvWGp=(modelMatrix*q).xyz;}');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWGp;uniform vec4 wgP[${WG_N}];uniform vec3 wgC[${WG_N}];`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{vec3 wg=vec3(0.);vec3 nW=normalize((vec4(normal,0.)*viewMatrix).xyz);for(int i=0;i<${WG_N};i++){vec3 dv=wgP[i].xyz-vWGp;float d=length(dv)/max(wgP[i].w,.001);float k=clamp(1.-d,0.,1.);float wr=clamp(dot(nW,dv/max(length(dv),.001))*.6+.4,0.,1.);wg+=wgC[i]*k*k*wr;}
 totalEmissiveRadiance+=wg*diffuseColor.rgb;}`);
    };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    mat.customProgramCacheKey = () => key() + (wgOn ? '|winglow' : '');
    mat.needsUpdate = true;
  }
  if (TREE && wgSrc.length) { if (TREE.bark) treeGlow(TREE.bark.material); if (TREE.leaves) treeGlow(TREE.leaves.material); }

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
    // the scene's directional light swaps from moon to sun at dayK .5: beams only appear well after that, so they never jump
    const dk = Math.max(0, Math.min(1, (dayK - .6) / .3)), dkS = dk * dk * (3 - 2 * dk);
    if (sunL && dkS > 0) { sunV.copy(sunL.position).sub(sunL.target.position).normalize(); on = dkS * Math.min(1, sunL.intensity / 2.2); }
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
  function setOn(s, on) { if (s.on === on) return; s.on = on; if (on) s.flare = 1; else if ((s.kind === 'candle' || s.kind === 'oil') && s.level > .3) wisp(s); fire(s.name, on); }
  // a thin curl of smoke where a flame was just put out
  const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.6, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const wisps = [];
  function wisp(s) {
    const top = s.pos.clone().add(V(0, s.kind === 'candle' ? .02 : .08, 0));
    for (let i = 0; i < 5; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xB8B4AE, transparent: true, opacity: 0, depthWrite: false }));
      sp.position.copy(top); sp.scale.setScalar(.03); scene.add(sp); wisps.push({ sp, age: -i * .25, life: 2.6, x0: top.x, z0: top.z, y0: top.y, ph: Math.random() * 6 }); }
  }
  function updateWisps(dt) {
    for (let i = wisps.length - 1; i >= 0; i--) { const w = wisps[i]; w.age += dt; const a = Math.max(0, w.age) / w.life;
      if (a >= 1) { scene.remove(w.sp); w.sp.material.dispose(); wisps.splice(i, 1); continue; }
      w.sp.position.set(w.x0 + Math.sin(w.age * 2.2 + w.ph) * .03 * a, w.y0 + a * .38, w.z0 + Math.cos(w.age * 1.7 + w.ph) * .02 * a);
      w.sp.scale.setScalar(.03 + a * .12); w.sp.material.opacity = w.age < 0 ? 0 : .35 * Math.sin(Math.PI * a); }
  }
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
      // Pavel: a lamp or candle never goes out by itself. If the hero forgot it, it keeps burning until he puts it out.
      // The candle lights when he sits down to read in the dark and then stays lit (manual) until set('candle', false).
      if (s.name === 'candle' && s.manual === null && ctx.task === 'read' && ctx.state === 'work' && ctx.lamps > .25) s.manual = true;
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
      if (!s.lights.length && s.haloObj) s.haloObj.intensity = (s.kind === 'glow' ? .5 : 4.5) * k * f;
      const share = s.kind === 'glow' ? .04 : s.kind === 'candle' ? .3 : s.kind === 'fire' ? .55 : 1;
      warm[s.room] = Math.min(1.2, (warm[s.room] || 0) + k * f * share);
    }
    wgSrc.forEach((w, i) => { const v = w.k() * (1 - dayK); wgC.value[i].set(1.0 * v, .58 * v, .26 * v); });
    for (const g of glows) {
      let v = g.off ? 0 : (warm[g.room] || 0) * g.I * (1 - dayK * .8);
      if (g.l) g.l.intensity = v;
      if (g.halo) {
        // seen from inside the room (or right at the pane) the window is just glass: no glow sprite in front of your eyes
        if (cam && g.n) { const d = _v.copy(cam.position).sub(g.hp), sd = d.dot(g.n), far = d.length(); v *= smooth(-.05, .5, sd) * smooth(.6, 1.6, far); }
        g.halo.intensity = v;
      }
    }
    updateBeams(dayK, T); updateWisps(dt); updateHand(dt);
    for (const w of windows) {
      // Seen from inside the room a window is dark glass with the night (or the day sky) behind it, never a lamp:
      // no warm self-glow (critic T14). The warm glow of a lit window lives outside: halo + spill light (room glow).
      // Tree owns the panes; if they become real transparent glass, lights.js leaves them alone.
      if (w.mat.transparent || w.mat.userData.ownGlass) continue;
      w.mat.color.copy(PANE_NIGHT).lerp(PANE_DAY, dayK); w.mat.roughness = .06; w.mat.metalness = .1;
      w.mat.emissive.copy(SKY_NIGHT).lerp(SKY_DAY, dayK); w.mat.emissiveIntensity = .1 + dayK * .45;
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
    _dbg: () => ({ scene, cam }),
    get: n => src.has(n) ? view(src.get(n)) : null,
    pos: n => src.has(n) ? src.get(n).pos.clone() : null,
    set: (n, on) => { const s = src.get(n); if (!s) return false; s.manual = !!on; setOn(s, !!on); return true; },
    toggle: n => { const s = src.get(n); if (!s) return false; return api.set(n, !s.on); },
    auto: n => { for (const s of src.values()) if (!n || s.name === n) s.manual = null; },
    room: roomLevel,
    onChange: cb => listeners.push(cb),
    level: n => src.has(n) ? src.get(n).level : 0,
    // hand lantern: attachHand(bone, offset?) shows it in the hero's hand (then set('hand', true) lights it);
    // detachHand() hides it again (and puts it out)
    attachHand: (bone, off = V(0, -.04, .02)) => { if (!bone) return false; const ws = bone.getWorldScale(V()).x || 1; bone.add(hand.g); hand.g.scale.setScalar(1 / ws); hand.g.position.copy(off).multiplyScalar(1 / ws); hand.g.visible = true; hand.attached = bone; bone.getWorldPosition(hand.prev); return true; },
    detachHand: () => { const s = src.get('hand'); if (s) { s.manual = null; setOn(s, false); } scene.add(hand.g); hand.g.visible = false; hand.attached = null; },
    // window glow on the oak can be compiled out (one shader rebuild) by a frame-rate governor
    winGlow: on => { if (on === undefined) return wgOn; on = !!on; if (on === wgOn) return false; wgOn = on; for (const m of wgMats) m.needsUpdate = true; return true; },
    // new sources from other systems (Props' radio dial, a new lamp...): addSource('radio', { room: 'workshop', kind: 'glow',
    //   pos: Vector3, mats: [[material, emissiveIntensityWhenOn]], opac: [[material, opacityWhenOn]], light: { color, I, dist } })
    // kind: oil | electric | candle | glow. A real light is only made on desktop (phones keep the light budget); the switch
    // logic, halo, room warmth and API are the same as for the built-in sources. Starts off; set(name, true) to turn on.
    addSource: (n, o = {}) => {
      if (src.has(n) || !o.pos) return false;
      const lights = [];
      if (o.light && !MOBILE) { const l = new THREE.PointLight(o.light.color ?? 0xFFB25E, 0, o.light.dist ?? 2.5, 1.6); l.position.copy(o.pos); scene.add(l); lights.push({ l, I: o.light.I ?? 1.5 }); }
      add(n, o.room || 'outside', KINDS[o.kind] ? o.kind : 'glow', o.pos, { lights, emis: o.mats || [], opac: o.opac || [], haloSize: o.haloSize ?? .35, autoFn: () => false });
      for (const [m] of o.mats || []) if (m) m.emissiveIntensity = 0;
      api.names = [...src.keys()]; return true;
    },
    update, degrade, upgrade, quality: q => q === undefined ? quality : setQuality(q),
  };
  return api;
}
