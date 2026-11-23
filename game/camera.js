// Free camera: look at any spot of the tree, on iPhone and on desktop.
//   one finger / left mouse ........ orbit around the focus point
//   two fingers .................... pinch = zoom toward the point between the fingers, move = pan
//   right / middle mouse, shift+drag  pan
//   wheel / trackpad pinch ......... zoom toward the cursor
//   double tap / double click ...... fly smoothly to the tapped spot (on the hero: follow him)
//   single tap ..................... handed back to the game (onTap) for shooting etc.
// Everything is damped; the camera never goes inside the trunk or under the ground.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export function createCameraRig(o) {
  const { camera, dom, scene } = o;
  const solid = o.solid || (() => false);      // (x,y,z) -> true inside trunk/rock
  const groundY = o.groundY || (() => 0);
  const isHero = o.isHero || (() => false);    // (object3D) -> true if it belongs to the hero
  const follow = o.follow || (() => null);     // () -> Vector3 of the hero
  const onTap = o.onTap || (() => {});
  const onUser = o.onUser || (() => {});       // any user gesture (audio unlock etc.)
  // soft bounds for the focus point: a cylinder around the oak; beyond it the camera is pulled back like a rubber band
  const BOUND = o.bound || { cx: 0, cz: 1, r: 10, yMin: 0.2, yMax: 19 };

  const home = { target: new THREE.Vector3(0, 7.4, 2.4), yaw: 0.05, pitch: 0.13, dist: 30 };
  // goal (what the input asks for) and cur (what is rendered, damped toward goal)
  const goal = { target: home.target.clone(), yaw: home.yaw, pitch: home.pitch, dist: home.dist };
  const cur = { target: home.target.clone(), yaw: home.yaw, pitch: home.pitch, dist: home.dist };
  let followOn = false, atHome = true, flyK = 0, idle = 0;
  const MIN_D = 1.0, PMIN = 0.02, PMAX = 0.6, YAW_LIM = 0.75;
  const AXIS = o.axis || [0, -0.6];
  const maxD = () => home.dist * 1.0, hardD = () => home.dist * 1.2;   // Pavel: max zoom-out 20 % less far (was 1.25 / 1.5)

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickable = [];
  function rebuildPickable() {
    pickable.length = 0;
    scene.traverse(m => {
      if (!(m.isMesh || m.isSkinnedMesh) || m.isPoints || m.isSprite || m.isLine) return;
      if (!m.visible || m.userData.noPick) return;
      const mt = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mt || mt.depthWrite === false || mt.side === THREE.BackSide) return;   // sky, fog puffs, light rays
      if (mt.transparent && mt.opacity < 0.5) return;
      const g = m.geometry; if (g && !g.boundingSphere) g.computeBoundingSphere();
      if (g && g.boundingSphere && g.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis() > 120) return;
      pickable.push(m);
    });
  }
  let pickAge = 1e9;
  function pick(x, y) {
    if (pickAge > 4) { rebuildPickable(); pickAge = 0; }   // scene changes slowly (zombies, arrows)
    const r = dom.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    ray.far = 200;
    const hits = ray.intersectObjects(pickable, false);
    for (const h of hits) {
      if (h.object.isSkinnedMesh && !isHero(h.object)) continue;  // skinned raycast is approximate; zombies are tapped by the game
      return h;
    }
    // nothing hit (sky): a point at the current focus distance along the ray
    return { point: ray.ray.at(cur.dist, new THREE.Vector3()), object: null, sky: true };
  }

  // ---------- helpers ----------
  const tmp = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  function zoomAt(f, point) {          // f<1 zooms in; the picked point stays under the finger
    const over = goal.dist > maxD() && f > 1 ? 0.35 : 1;           // resistance past the far limit
    const nd = clamp(goal.dist * Math.pow(f, over), MIN_D, hardD());
    rec(0, 0, 0, 0, Math.log(nd / goal.dist), point);
    const k = 1 - nd / goal.dist;
    if (point) {
      tmp.copy(goal.target).lerp(point, k);
      // like pan: the focus may leave the soft bounds a little (rubber band), never far (sky / far ground picks)
      limitOut(tmp);
      goal.target.copy(tmp);
    }
    goal.dist = nd; flyK = 0; atHome = false;
    if (followOn && point && k > 0) { const f = follow(); if (!f || f.distanceTo(point) > 1.5) stopFollow(); }
  }
  function stopFollow() { fHave = false; if (followOn) { followOn = false; o.onFollow && o.onFollow(false); } }
  function pan(dx, dy) {               // screen pixels
    const h = dom.clientHeight || innerHeight;
    const s = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * goal.dist / h;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    tmp.copy(goal.target).addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    // rubber band: moving further out of bounds gets harder
    const o0 = outside(goal.target), o1 = outside(tmp);
    if (o1 > o0 && o1 > 0) tmp.lerp(goal.target, clamp(o1 / 3, 0, 0.85));
    if (outside(tmp) < 3.5) goal.target.copy(tmp);
    rec(0, 0, dx, dy, 0, null);
    stopFollow(); flyK = 0; atHome = false;
  }
  // Orbit always turns around the oak's trunk (vertical axis through AXIS), within the same limits as the
  // original camera (±0.75 rad from the front view, pitch 0.02..0.6). When zoomed in somewhere, the whole view
  // swings around the trunk with it, so the rotation never pivots on an arbitrary spot.
  function orbit(dx, dy) {
    rec(dx, dy, 0, 0, 0, null);
    const ny = clamp(goal.yaw - dx * 0.006, home.yaw - YAW_LIM, home.yaw + YAW_LIM);
    const a = ny - goal.yaw;
    if (a) {
      const x = goal.target.x - AXIS[0], z = goal.target.z - AXIS[1], c = Math.cos(a), sn = Math.sin(a);
      goal.target.x = AXIS[0] + x * c + z * sn; goal.target.z = AXIS[1] - x * sn + z * c;
      goal.yaw = ny;
      limitOut(goal.target);
    }
    goal.pitch = clamp(goal.pitch + dy * 0.004, PMIN, PMAX);
    flyK = 0; atHome = false;
  }
  function flyTo(point, dist, k = 3.2) {
    goal.target.copy(point); limitOut(goal.target);
    goal.dist = clamp(dist, MIN_D, maxD());
    flyK = k; atHome = false;
  }
  function goHome() {
    stopFollow(); atHome = true;
    goal.target.copy(home.target); goal.dist = home.dist; goal.pitch = home.pitch;
    // shortest way back around
    goal.yaw = home.yaw + Math.round((goal.yaw - home.yaw) / (Math.PI * 2)) * Math.PI * 2;
    flyK = 2.2;
  }
  function setFollow(on) {
    followOn = on; atHome = false;
    if (on) {   // look at him from the open (front) side of the house
      goal.dist = clamp(Math.min(goal.dist, 4.2), MIN_D, maxD()); flyK = 3;
      goal.yaw = home.yaw + Math.round((goal.yaw - home.yaw) / (Math.PI * 2)) * Math.PI * 2;
      goal.pitch = clamp(goal.pitch, 0.1, 0.45);
    }
    o.onFollow && o.onFollow(on);
  }

  // ---------- inertia: what the fingers did in the last ~120 ms keeps going after release ----------
  const hist = [];          // {t, ox, oy, px, py, lz, p}
  let recording = false;
  const inert = { ox: 0, oy: 0, px: 0, py: 0, lz: 0, p: null, on: false };
  function rec(ox, oy, px, py, lz, point) {
    if (!recording) return;
    hist.push({ t: performance.now(), ox, oy, px, py, lz, p: point });
    while (hist.length > 40) hist.shift();
  }
  function startInertia() {
    const now = performance.now();
    const recent = hist.filter(h => now - h.t < 120);
    hist.length = 0; recording = false;
    if (!recent.length || now - recent[recent.length - 1].t > 60) return;   // finger stopped before lifting
    const span = Math.max(0.03, (now - recent[0].t) / 1000);
    const sum = recent.reduce((a, h) => { a.ox += h.ox; a.oy += h.oy; a.px += h.px; a.py += h.py; a.lz += h.lz; if (h.p) a.p = h.p; return a; }, { ox: 0, oy: 0, px: 0, py: 0, lz: 0, p: null });
    const cap = (v, m) => clamp(v, -m, m);
    sum.ox = cap(sum.ox / span, 700) * span; sum.oy = cap(sum.oy / span, 500) * span; sum.px = cap(sum.px / span, 1500) * span; sum.py = cap(sum.py / span, 1500) * span;
    Object.assign(inert, { ox: sum.ox / span, oy: sum.oy / span, px: sum.px / span, py: sum.py / span, lz: sum.lz / span, p: sum.p, on: true });
  }
  function stopInertia() { inert.on = false; hist.length = 0; }
  function stepInertia(dt) {
    if (!inert.on) return;
    const was = recording; recording = false;
    if (Math.abs(inert.ox) + Math.abs(inert.oy) > 1) orbit(inert.ox * dt, inert.oy * dt);
    if (Math.abs(inert.px) + Math.abs(inert.py) > 1) pan(inert.px * dt, inert.py * dt);
    if (Math.abs(inert.lz) > 0.01) zoomAt(Math.exp(inert.lz * dt), inert.lz < 0 ? inert.p : null);
    recording = was;
    const k = Math.exp(-4.2 * dt);   // glide ~0.5 s
    inert.ox *= k; inert.oy *= k; inert.px *= k; inert.py *= k; inert.lz *= Math.exp(-6 * dt);
    if (Math.abs(inert.ox) + Math.abs(inert.oy) + Math.abs(inert.px) + Math.abs(inert.py) < 4 && Math.abs(inert.lz) < 0.03) inert.on = false;
  }

  // ---------- pointer input ----------
  const ptrs = new Map();
  let mode = null, last = null, down = null, pinch = null, lastTap = null, panBtn = false;
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    onUser(e);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { dom.setPointerCapture(e.pointerId); } catch (_) {}
    idle = 0; stopCine(); stopInertia(); recording = true;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx, my, p: pick(mx, my).point };
      api.lastPick = [mx, my, pinch.p.toArray().map(v => +v.toFixed(2))];
      mode = 'pinch'; down = null; return;
    }
    if (ptrs.size > 2) return;
    panBtn = e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey;
    mode = panBtn ? 'pan' : 'orbit';
    last = { x: e.clientX, y: e.clientY };
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  dom.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      pinch.mv = (pinch.mv || 0) + Math.hypot(mx - pinch.mx, my - pinch.my);
      if (!followOn || pinch.mv > 40) pan(mx - pinch.mx, my - pinch.my);
      zoomAt(pinch.d / d, pinch.p);
      pinch.d = d; pinch.mx = mx; pinch.my = my;
      return;
    }
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return; // tap jitter
    if (mode === 'orbit') orbit(dx, dy);
    else if (mode === 'pan') pan(dx, dy);
  });
  function endPtr(e) {
    ptrs.delete(e.pointerId);
    if (mode === 'pinch') {
      if (ptrs.size === 1) {               // one finger left: continue as orbit without a jump
        const p = [...ptrs.values()][0]; last = { x: p.x, y: p.y }; mode = 'orbit'; down = null;
      } else if (ptrs.size === 0) { mode = null; startInertia(); }
      return;
    }
    if (ptrs.size) return;
    mode = null; last = null;
    if (e.type === 'pointerup') startInertia(); else stopInertia();
    if (down && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && performance.now() - down.t < 350) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 420 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap = null; doubleTap(e.clientX, e.clientY);
      } else {
        lastTap = { x: e.clientX, y: e.clientY, t: now };
        onTap(e.clientX, e.clientY);
      }
    }
    down = null;
  }
  dom.addEventListener('pointerup', endPtr);
  dom.addEventListener('pointercancel', endPtr);
  dom.addEventListener('lostpointercapture', e => { if (ptrs.has(e.pointerId)) endPtr(e); });

  function doubleTap(x, y) {
    const h = pick(x, y);
    if (h.object && isHero(h.object)) { setFollow(true); return; }
    if (h.sky) { zoomAt(0.55, h.point); return; }
    stopFollow();
    // close enough to see the spot with some context; closer each double tap
    flyTo(h.point, Math.max(1.6, Math.min(goal.dist * 0.45, 6)));
  }

  dom.addEventListener('wheel', e => {
    e.preventDefault(); idle = 0; stopCine();
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const f = Math.exp(clamp(dy * (e.ctrlKey ? 0.01 : 0.0016), -0.35, 0.35)); // ctrlKey = trackpad pinch; one notch at most ±35 %
    zoomAt(f, f < 1 ? pick(e.clientX, e.clientY).point : null);
  }, { passive: false });

  // Safari desktop trackpad pinch
  let gs = 1;
  dom.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
  dom.addEventListener('gesturechange', e => { e.preventDefault(); const f = gs / e.scale; gs = e.scale; zoomAt(f, f < 1 ? pick(e.clientX, e.clientY).point : null); });
  dom.addEventListener('gestureend', e => e.preventDefault());

  addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    idle = 0; stopCine();
    const s = 24;
    if (e.key === 'ArrowLeft') orbit(-s, 0); else if (e.key === 'ArrowRight') orbit(s, 0);
    else if (e.key === 'ArrowUp') orbit(0, -s); else if (e.key === 'ArrowDown') orbit(0, s);
    else if (e.key === '+' || e.key === '=') zoomAt(0.8, null); else if (e.key === '-') zoomAt(1.25, null);
    else if (e.key === 'Home' || e.key === 'h') goHome();
  });

  // ---------- cinematic idle mode ----------
  // After CINE_IDLE s without a touch the camera drifts on its own between calm shots (windows, the hero,
  // the roots, the crown), slow push-ins and arcs; any touch hands control straight back from where it is.
  const CINE_IDLE = o.cineIdle || 30;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const SHOTS = o.shots || [
    { name: 'bedroom',  t: V3(-2.0, 9.4, 1.6), yaw: 0.25, pitch: 0.10, dist: 5.6, arc: -0.025, push: 0.012 },
    { name: 'hero',     hero: true, yaw: 0.15, pitch: 0.16, dist: 3.4, arc: 0.03, push: 0.01 },
    { name: 'roots',    t: V3(0.9, 0.6, 2.2), yaw: 0.5, pitch: 0.32, dist: 8, arc: 0.03, push: 0.015 },
    { name: 'kitchen',  t: V3(-2.1, 6.9, 1.3), yaw: -0.2, pitch: 0.08, dist: 3.8, arc: 0.025, push: 0.012 },
    { name: 'crown',    t: V3(0, 14.5, 0), yaw: 0.35, pitch: 0.06, dist: 16, arc: -0.02, push: 0.008 },
    { name: 'workshop', t: V3(2.4, 6.2, 1.6), yaw: 0.35, pitch: 0.12, dist: 4, arc: -0.03, push: 0.012 },
    { name: 'telescope',t: V3(2.9, 10.8, 2.4), yaw: -0.4, pitch: 0.18, dist: 4, arc: 0.03, push: 0.01 },
    { name: 'house',    t: V3(0, 7.4, 2.4), yaw: -0.3, pitch: 0.08, dist: 18, arc: 0.012, push: 0.006 },
  ];
  const cine = { on: false, i: -1, t: 0, hold: 11, shot: null };
  function stopCine() {
    if (!cine.on) return;
    cine.on = false; flyK = 0;
    goal.target.copy(cur.target); goal.yaw = cur.yaw; goal.pitch = cur.pitch; goal.dist = cur.dist;  // freeze where it is
    o.onCine && o.onCine(false);
  }
  // every other shot shows what the hero is doing, framed by the room he is in
  // (cooking -> kitchen, reading or sleeping -> bedroom, crafting -> workshop, telescope -> deck)
  const SCENIC = SHOTS.filter(s => !s.hero), ROOMS = SCENIC.filter(s => s.dist < 7 && s.t.y > 3);
  let scenicI = -1, heroTurn = false;
  function heroShot() {
    const f = follow(); if (!f) return null;
    let best = null, bd = 1e9;
    for (const r of ROOMS) { const d = r.t.distanceTo(f); if (d < bd) { bd = d; best = r; } }
    if (best && bd < 3.2)    // in a room: room framing, focus between the room and the hero
      return { name: 'hero@' + best.name, hero: true, mix: 0.55, room: best.t, yaw: best.yaw, pitch: best.pitch, dist: Math.max(3.2, best.dist * 0.85), arc: best.arc, push: best.push };
    return SHOTS.find(s => s.hero) || null;
  }
  function shotTarget(sh) {
    if (!sh.hero) return sh.t;
    const f = follow(); if (!f) return sh.room || home.target;
    return sh.room ? tmp.copy(sh.room).lerp(f, sh.mix) : f;
  }
  function nextShot() {
    heroTurn = !heroTurn;
    let sh = heroTurn ? heroShot() : null;
    if (!sh) { scenicI = (scenicI + 1) % SCENIC.length; sh = SCENIC[scenicI]; }
    cine.shot = sh; cine.t = 0; cine.i++;
    const tg = shotTarget(sh);
    goal.target.copy(tg);
    goal.yaw = cine.shot.yaw + Math.round((cur.yaw - cine.shot.yaw) / (Math.PI * 2)) * Math.PI * 2;
    goal.pitch = cine.shot.pitch; goal.dist = cine.shot.dist;
    flyK = 0.55;                                    // a slow, floating move between shots
  }
  function stepCine(dt) {
    if (!cine.on) {
      if (idle > CINE_IDLE && !ptrs.size && !inert.on && !followOn) { cine.on = true; stopFollowSilent(); o.onCine && o.onCine(true); nextShot(); }
      return;
    }
    cine.t += dt;
    const sh = cine.shot;
    if (sh.hero) goal.target.lerp(shotTarget(sh), damp(1.5, dt));
    goal.yaw = clamp(goal.yaw + sh.arc * dt, home.yaw - YAW_LIM, home.yaw + YAW_LIM);   // slow arc, same limits as the hand
    goal.dist *= 1 - sh.push * dt;                  // slow push-in
    if (cine.t > cine.hold) nextShot();
  }
  function stopFollowSilent() { if (followOn) stopFollow(); }

  // ---------- soft hero follow ----------
  // The hero's position is smoothed into a velocity; the focus leads a little in the direction he walks and
  // trails softly, slower vertically, so ladders and room changes glide instead of jerking.
  const fPrev = new THREE.Vector3(), fVel = new THREE.Vector3(), fLead = new THREE.Vector3(), fWant = new THREE.Vector3();
  let fHave = false;
  function followStep(dt) {
    const f = follow(); if (!f) return;
    if (!fHave || dt <= 0) { fPrev.copy(f); fVel.set(0, 0, 0); fHave = true; }
    else {
      tmp.copy(f).sub(fPrev).divideScalar(Math.max(dt, 1e-3));
      if (tmp.length() > 8) tmp.set(0, 0, 0);            // teleport / snap: no lead spike
      fVel.lerp(tmp, damp(3, dt));
      fPrev.copy(f);
    }
    fLead.set(fVel.x * 0.55, fVel.y * 0.25, fVel.z * 0.55);
    const L = Math.hypot(fLead.x, fLead.z); if (L > 0.9) { fLead.x *= 0.9 / L; fLead.z *= 0.9 / L; }
    fLead.y = clamp(fLead.y, -0.4, 0.4);
    fWant.copy(f).add(fLead);
    const kh = damp(2.6, dt), kv = damp(1.6, dt);
    goal.target.x += (fWant.x - goal.target.x) * kh;
    goal.target.z += (fWant.z - goal.target.z) * kh;
    goal.target.y += (fWant.y - goal.target.y) * kv;
  }

  // ---------- per frame ----------
  let hitWhy = null, collK = 1;
  const gL = new THREE.Vector3(), cL = new THREE.Vector3();
  function toLocal(t, yaw, out) {     // inverse of the orbit rotation around AXIS by yaw
    const x = t.x - AXIS[0], z = t.z - AXIS[1], c = Math.cos(-yaw), sn = Math.sin(-yaw);
    return out.set(x * c + z * sn, t.y, -x * sn + z * c);
  }
  function fromLocal(l, yaw, out) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return out.set(AXIS[0] + l.x * c + l.z * sn, l.y, AXIS[1] - l.x * sn + l.z * c);
  }
  const camPos = new THREE.Vector3(), dir = new THREE.Vector3(), p = new THREE.Vector3();
  function inside(t, out) {      // nearest point inside the bounds
    out.copy(t);
    const dx = t.x - BOUND.cx, dz = t.z - BOUND.cz, r = Math.hypot(dx, dz);
    if (r > BOUND.r) { out.x = BOUND.cx + dx / r * BOUND.r; out.z = BOUND.cz + dz / r * BOUND.r; }
    out.y = clamp(out.y, groundY(out.x, out.z) + BOUND.yMin, BOUND.yMax);
    return out;
  }
  const inB = new THREE.Vector3();
  function outside(t) { return inside(t, inB).distanceTo(t); }
  function limitOut(t) {             // the focus may leave the soft bounds a little (rubber band), never far
    const o1 = outside(t);
    if (o1 > 3.5) { inside(t, inB); t.sub(inB).multiplyScalar(3.5 / o1).add(inB); }
  }
  function outOfTrunk(t) {           // a focus inside the trunk (double tap on bark, zoom into it) moves out radially
    for (let n = 0; n < 60 && solid(t.x, t.y, t.z); n++) {
      let dx = t.x - AXIS[0], dz = t.z - AXIS[1]; const r = Math.hypot(dx, dz) || 1;
      if (r < 1e-3) { dx = 0; dz = 1; }
      t.x += dx / r * 0.08; t.z += dz / r * 0.08;
    }
  }
  function keepOut(target, dt, dragging) {
    // never below ground; beyond the soft bounds: spring back once the fingers are off
    target.y = Math.max(target.y, groundY(target.x, target.z) + BOUND.yMin);
    outOfTrunk(target);
    if (!dragging && outside(target) > 0.001) target.lerp(inB, damp(5, dt));
  }
  function update(dt, extra = {}) {
    pickAge += dt; idle += dt;
    if (followOn) followStep(dt);
    stepInertia(dt);
    stepCine(dt);
    for (const U of fadeU) U.u.value = clamp(cur.dist * U.k, U.min, U.max);
    const dragging = ptrs.size > 0 || inert.on;
    keepOut(goal.target, dt, dragging);
    goal.dist = clamp(goal.dist, MIN_D, hardD());
    if (!dragging && goal.dist > maxD()) goal.dist += (maxD() - goal.dist) * damp(5, dt);
    const k = flyK ? damp(flyK, dt) : damp(14, dt);
    // The focus is damped in the frame that turns with the view around the trunk axis: an orbit is then a pure rotation
    // around the trunk (no chord cutting toward the tree, no distance wobble), and flights between views swing around
    // the trunk instead of passing through it.
    toLocal(goal.target, goal.yaw, gL); toLocal(cur.target, cur.yaw, cL);
    cL.lerp(gL, k);
    cur.yaw += (goal.yaw - cur.yaw) * k;
    fromLocal(cL, cur.yaw, cur.target);
    outOfTrunk(cur.target);
    cur.pitch += (goal.pitch - cur.pitch) * k;
    cur.dist = Math.exp(Math.log(cur.dist) + (Math.log(goal.dist) - Math.log(cur.dist)) * k);
    if (flyK && !cine.on && Math.abs(cur.dist - goal.dist) < 0.01 && cur.target.distanceTo(goal.target) < 0.01) flyK = 0;

    const yw = cur.yaw + (extra.drift || 0);
    dir.set(Math.sin(yw) * Math.cos(cur.pitch), Math.sin(cur.pitch), Math.cos(yw) * Math.cos(cur.pitch));
    // march from the focus toward the wanted spot; stop before the trunk or the ground
    // (if the focus itself is inside the trunk, first walk out of it)
    let d = cur.dist;
    hitWhy = null;
    const step = 0.08;
    let s0 = 0;
    while (s0 < 4 && solid(cur.target.x + dir.x * s0, cur.target.y + dir.y * s0, cur.target.z + dir.z * s0)) s0 += step;
    for (let s = Math.max(0.25, s0 + step); s <= cur.dist; s += step) {
      p.copy(cur.target).addScaledVector(dir, s);
      if (solid(p.x, p.y, p.z)) { d = Math.max(0.2, s - step); hitWhy = 'solid'; break; }
    }
    d = Math.max(d, s0 + 0.2);
    // smooth the collision: the camera slides in and out instead of snapping, but never stops inside the trunk
    const want = d / cur.dist;
    collK = !isFinite(collK) || dt <= 0 ? want : collK + (want - collK) * damp(want < collK ? 10 : 4, dt);
    collK = Math.min(collK, 1);
    let ds = cur.dist * collK;
    if (ds > d + 1e-3) {
      p.copy(cur.target).addScaledVector(dir, ds);
      if (solid(p.x, p.y, p.z)) { ds = d; collK = want; }
    }
    d = ds;
    camPos.copy(cur.target).addScaledVector(dir, d);
    // the ground does not push the camera in (that would read as a zoom): over a hill the camera rises instead
    const gy = groundY(camPos.x, camPos.z) + 0.3;
    if (camPos.y < gy) { camPos.y = gy; hitWhy = hitWhy || 'ground'; }
    // last guard: never inside the trunk (e.g. half way through a flight around it)
    if (solid(camPos.x, camPos.y, camPos.z)) { outOfTrunk(camPos); hitWhy = 'solid'; }
    if (extra.shake) camPos.add(extra.shake);
    focusU.value = camPos.distanceTo(cur.target);
    // leaves in front of the focus melt away when zoomed in (through the crown), fully gone below ~9 m, none from afar
    cutU.value += ((1 - THREE.MathUtils.smoothstep(focusU.value, 9, 15)) - cutU.value) * damp(4, dt);
    camera.position.copy(camPos);
    camera.lookAt(cur.target);
  }

  function setHome(h) {
    if (h.target) home.target.copy(h.target);
    if (h.yaw !== undefined) home.yaw = h.yaw;
    if (h.pitch !== undefined) home.pitch = h.pitch;
    if (h.dist !== undefined) home.dist = h.dist;
    if (atHome) { goal.target.copy(home.target); goal.dist = home.dist; goal.yaw = home.yaw; goal.pitch = home.pitch; }
  }
  function snap() { cur.target.copy(goal.target); cur.yaw = goal.yaw; cur.pitch = goal.pitch; cur.dist = goal.dist; flyK = 0; }
  function set(v) {          // for tests: {target,yaw,pitch,dist,snap}
    if (v.target) goal.target.copy(v.target);
    if (v.yaw !== undefined) goal.yaw = v.yaw;
    if (v.pitch !== undefined) goal.pitch = v.pitch;
    if (v.dist !== undefined) goal.dist = v.dist;
    atHome = !!v.home; stopFollow();
    if (v.snap) snap();
  }

  // Foliage fade (tree leaves only: the house, bark, grass and ferns never fade).
  // Each leaf card melts by eroding its own alpha mask, staggered per card by a random value, so the crown thins out
  // smoothly leaf by leaf instead of a pixel noise pattern:
  //   near:  cards within r of the camera (r = clamp(dist*k, min, max)) fade,
  //   cut:   when zoomed in, every card in front of the focus fades (zooming through the crown clears the view).
  const fadeU = [];
  const focusU = { value: 10 }, cutU = { value: 0 };
  function nearFade(root, r = 2.2, test = mt => mt.alphaTest > 0, k = 0.7, rMin = 0.35) {
    let U = fadeU.find(u => u.max === r && u.k === k);
    if (!U) { U = { max: r, k, min: rMin, u: { value: r } }; fadeU.push(U); }
    const uni = U.u, name = 'uNF' + fadeU.indexOf(U);
    const seen = new Set();
    root.traverse(m => {
      if (!m.isMesh) return;
      for (const mt of (Array.isArray(m.material) ? m.material : [m.material])) {
        if (!mt || seen.has(mt) || !test(mt, m) || mt.userData.nearFade || !(mt.alphaTest > 0)) continue;
        seen.add(mt); mt.userData.nearFade = true;
        const prev = mt.onBeforeCompile, key = prev ? prev.toString() : '';
        mt.onBeforeCompile = (sh, rd) => {
          if (prev) prev.call(mt, sh, rd);
          sh.uniforms[name] = uni; sh.uniforms.uNFFocus = focusU; sh.uniforms.uNFCut = cutU;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCamDNF;varying float vRndNF;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDNF=length(mvPosition.xyz);\n#ifdef USE_INSTANCING\nvec3 nfp=instanceMatrix[3].xyz;\n#else\nvec3 nfp=floor(position*3.0);\n#endif\nvRndNF=fract(sin(dot(nfp,vec3(12.9898,78.233,37.719)))*43758.5453);');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCamDNF;varying float vRndNF;uniform float ' + name + ';uniform float uNFFocus,uNFCut;')
            .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n{float nf=smoothstep(' + name + '*0.25,' + name + ',vCamDNF);' +
              'nf=min(nf,mix(1.0,smoothstep(uNFFocus-2.6,uNFFocus-0.9,vCamDNF),uNFCut));' +
              'float gone=clamp((1.0-nf)*1.7-vRndNF*0.7,0.0,1.0);' +
              'if(gone>0.0&&diffuseColor.a<mix(alphaTest,1.001,gone))discard;}');
        };
        mt.customProgramCacheKey = () => key + '|' + name;
        mt.needsUpdate = true;
      }
    });
  }

  const api = {
    nearFade, camera,
    update, setHome, goHome, setFollow, flyTo, zoomAt, pan, orbit, pick, set, snap,
    get following() { return followOn; },
    get cinematic() { return cine.on ? (cine.shot && cine.shot.name) : null; },
    cine: (on) => { if (on) { idle = CINE_IDLE + 1; } else { idle = 0; stopCine(); } },
    get dist() { return cur.dist; },
    get focusDist() { return focusU.value; },
    get target() { return cur.target; },
    get state() { return { target: cur.target.toArray().map(v => +v.toFixed(2)), yaw: +cur.yaw.toFixed(3), pitch: +cur.pitch.toFixed(3), dist: +cur.dist.toFixed(2), follow: followOn, cam: camera.position.toArray().map(v => +v.toFixed(2)) }; },
    get homeDist() { return home.dist; },
    // for tests (tests/camera): internal state of the last update
    get debug() { return { gd: goal.dist, gt: goal.target.toArray(), gy: goal.yaw, gp: goal.pitch, cd: cur.dist, cy: cur.yaw, cp: cur.pitch, ct: cur.target.toArray(), hit: hitWhy, collK, flyK, inert: inert.on, cine: cine.on, follow: followOn, ptrs: ptrs.size, maxD: maxD(), hardD: hardD(), home: { yaw: home.yaw, dist: home.dist }, YAW_LIM, PMIN, PMAX, BOUND }; },
  };
  return api;
}


// ---------- depth of field (close-ups only) ----------
// One full-screen pass right after the scene render: 12-tap golden-spiral blur whose radius grows with the distance
// from the focus plane. Works at half the blur cost on phones (fewer taps). It is a quality level: off by default
// on phones, turned off automatically when the frame rate has no headroom, and switchable via window.__camera.dof(on).
export function createDOF(o) {
  const { renderer, composer, camera } = o;
  const taps = o.mobile ? 8 : 12;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (!rt.depthTexture) { rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height); rt.depthTexture.type = THREE.UnsignedIntType; }
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, near: { value: 0.1 }, far: { value: 300 }, focus: { value: 3 }, amount: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `#include <packing>
uniform sampler2D tDiffuse,tDepth;uniform float near,far,focus,amount;uniform vec2 res;varying vec2 vUv;
float vz(vec2 uv){return -perspectiveDepthToViewZ(texture2D(tDepth,uv).x,near,far);}
float coc(float z){return clamp(abs(z-focus)/max(z,0.05)*1.6,0.0,1.0);}
void main(){vec4 c0=texture2D(tDiffuse,vUv);float z0=vz(vUv);float r=coc(z0)*amount*7.0;
 if(r<0.4){gl_FragColor=c0;return;}
 vec3 acc=c0.rgb;float w=1.0;
 for(int i=1;i<=${taps};i++){float fi=float(i);float a=fi*2.39996;float rr=sqrt(fi/${taps}.0)*r;vec2 uv=vUv+vec2(cos(a),sin(a))*rr/res;
  float zi=vz(uv);float wi=zi<z0-0.05?coc(zi):1.0; /* sharp foreground must not bleed */
  acc+=texture2D(tDiffuse,uv).rgb*wi;w+=wi;}
 gl_FragColor=vec4(acc/w,c0.a);}`,
  });
  class DOFPass extends Pass {
    constructor() { super(); this.fsq = new FullScreenQuad(mat); }
    render(rd, write, read) {
      mat.uniforms.tDiffuse.value = read.texture; mat.uniforms.tDepth.value = read.depthTexture;
      mat.uniforms.near.value = camera.near; mat.uniforms.far.value = camera.far;
      mat.uniforms.res.value.set(read.width, read.height);
      rd.setRenderTarget(this.renderToScreen ? null : write); this.fsq.render(rd);
    }
    setSize() {}
  }
  const pass = new DOFPass();
  pass.enabled = false;
  let want = o.enabled !== undefined ? o.enabled : !o.mobile, amount = 0, fpsAvg = 60, coolT = 0;
  const api = {
    pass,
    // call each frame: focus distance and camera distance (m)
    update(dt, focusDist) {
      fpsAvg += ((1 / Math.max(dt, 1e-3)) - fpsAvg) * Math.min(1, dt * 2);
      coolT = Math.max(0, coolT - dt);
      if (pass.enabled && fpsAvg < 50 && !api.force) coolT = 15;          // no headroom: back off for a while
      const close = 1 - THREE.MathUtils.smoothstep(focusDist, 3, 5);
      const target = want && (coolT === 0 || api.force) ? close : 0;
      amount += (target - amount) * Math.min(1, dt * 3);
      mat.uniforms.amount.value = amount; mat.uniforms.focus.value = focusDist;
      pass.enabled = amount > 0.02;
    },
    set enabled(v) { want = !!v; }, get enabled() { return want; },
    get active() { return pass.enabled; }, get fps() { return Math.round(fpsAvg); },
  };
  return api;
}
