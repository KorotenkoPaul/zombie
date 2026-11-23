// Free camera: look at any spot of the tree, on iPhone and on desktop.
//   one finger / left mouse ........ orbit around the focus point
//   two fingers .................... pinch = zoom toward the point between the fingers, move = pan
//   right / middle mouse, shift+drag  pan
//   wheel / trackpad pinch ......... zoom toward the cursor
//   double tap / double click ...... fly smoothly to the tapped spot (on the hero: follow him)
//   single tap ..................... handed back to the game (onTap) for shooting etc.
// Everything is damped; the camera never goes inside the trunk or under the ground.
import * as THREE from 'three';

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
  const MIN_D = 0.7, PMIN = -0.25, PMAX = 1.45;
  const maxD = () => home.dist * 1.25, hardD = () => home.dist * 1.5;

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
    if (point) goal.target.lerp(point, k);
    goal.dist = nd; flyK = 0; atHome = false;
    if (followOn && point && k > 0) { const f = follow(); if (!f || f.distanceTo(point) > 1.5) stopFollow(); }
  }
  function stopFollow() { if (followOn) { followOn = false; o.onFollow && o.onFollow(false); } }
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
  function orbit(dx, dy) {
    rec(dx, dy, 0, 0, 0, null);
    goal.yaw -= dx * 0.0065;
    goal.pitch = clamp(goal.pitch + dy * 0.0045, PMIN, PMAX);
    flyK = 0; atHome = false;
  }
  function flyTo(point, dist, k = 3.2) {
    goal.target.copy(point);
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
    idle = 0; stopInertia(); recording = true;
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
    e.preventDefault(); idle = 0;
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const f = Math.exp(clamp(dy, -200, 200) * (e.ctrlKey ? 0.01 : 0.0016)); // ctrlKey = trackpad pinch
    zoomAt(f, f < 1 ? pick(e.clientX, e.clientY).point : null);
  }, { passive: false });

  // Safari desktop trackpad pinch
  let gs = 1;
  dom.addEventListener('gesturestart', e => { e.preventDefault(); gs = 1; });
  dom.addEventListener('gesturechange', e => { e.preventDefault(); const f = gs / e.scale; gs = e.scale; zoomAt(f, f < 1 ? pick(e.clientX, e.clientY).point : null); });
  dom.addEventListener('gestureend', e => e.preventDefault());

  addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const s = 24;
    if (e.key === 'ArrowLeft') orbit(-s, 0); else if (e.key === 'ArrowRight') orbit(s, 0);
    else if (e.key === 'ArrowUp') orbit(0, -s); else if (e.key === 'ArrowDown') orbit(0, s);
    else if (e.key === '+' || e.key === '=') zoomAt(0.8, null); else if (e.key === '-') zoomAt(1.25, null);
    else if (e.key === 'Home' || e.key === 'h') goHome();
  });

  // ---------- per frame ----------
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
  function keepOut(target, dt, dragging) {
    // never below ground; beyond the soft bounds: spring back once the fingers are off
    target.y = Math.max(target.y, groundY(target.x, target.z) + BOUND.yMin);
    if (!dragging && outside(target) > 0.001) target.lerp(inB, damp(5, dt));
  }
  function update(dt, extra = {}) {
    pickAge += dt; idle += dt;
    if (followOn) { const f = follow(); if (f) goal.target.lerp(f, damp(6, dt)); }
    stepInertia(dt);
    for (const U of fadeU) U.u.value = clamp(cur.dist * U.k, U.min, U.max);
    const dragging = ptrs.size > 0 || inert.on;
    keepOut(goal.target, dt, dragging);
    goal.dist = clamp(goal.dist, MIN_D, hardD());
    if (!dragging && goal.dist > maxD()) goal.dist += (maxD() - goal.dist) * damp(5, dt);
    const k = flyK ? damp(flyK, dt) : damp(14, dt);
    cur.target.lerp(goal.target, k);
    cur.yaw += (goal.yaw - cur.yaw) * k;
    cur.pitch += (goal.pitch - cur.pitch) * k;
    cur.dist = Math.exp(Math.log(cur.dist) + (Math.log(goal.dist) - Math.log(cur.dist)) * k);
    if (flyK && Math.abs(cur.dist - goal.dist) < 0.01 && cur.target.distanceTo(goal.target) < 0.01) flyK = 0;

    const yw = cur.yaw + (extra.drift || 0);
    dir.set(Math.sin(yw) * Math.cos(cur.pitch), Math.sin(cur.pitch), Math.cos(yw) * Math.cos(cur.pitch));
    // march from the focus toward the wanted spot; stop before the trunk or the ground
    // (if the focus itself is inside the trunk, first walk out of it)
    let d = cur.dist;
    const step = 0.08;
    let s0 = 0;
    while (s0 < 4 && solid(cur.target.x + dir.x * s0, cur.target.y + dir.y * s0, cur.target.z + dir.z * s0)) s0 += step;
    for (let s = Math.max(0.25, s0 + step); s <= cur.dist; s += step) {
      p.copy(cur.target).addScaledVector(dir, s);
      if (solid(p.x, p.y, p.z) || p.y < groundY(p.x, p.z) + 0.25) { d = Math.max(0.2, s - step); break; }
    }
    d = Math.max(d, s0 + 0.2);
    camPos.copy(cur.target).addScaledVector(dir, d);
    camPos.y = Math.max(camPos.y, groundY(camPos.x, camPos.z) + 0.25);
    if (extra.shake) camPos.add(extra.shake);
    // occlusion check every few frames (only when close: from far away the cutaway house is meant to be seen whole)
    if (++occN % 6 === 0) holeWant = cur.dist < 12 && occluded() ? 1 : 0;
    holeU.value += (holeWant - holeU.value) * damp(6, dt);
    focusU.value = camPos.distanceTo(cur.target);
    resU.value.set(dom.width || 1, dom.height || 1);
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

  // Dither away foliage (alpha-tested cards) close to the camera, so a free camera never looks
  // through a wall of leaves. Wraps the material's own onBeforeCompile and keeps its cache key apart.
  // The radius follows the zoom (r = clamp(dist*k, min, max)) so that what you zoom close to never dissolves,
  // only things between the camera and it.
  const fadeU = [];
  // see-through hole: when something (a wall, a branch) stands between the camera and the focus,
  // a soft round window around the screen centre dissolves whatever is in front of the focus
  const holeU = { value: 0 }, focusU = { value: 10 }, resU = { value: new THREE.Vector2(1, 1) };
  let holeWant = 0, occN = 0;
  const occRay = new THREE.Raycaster();
  function occluded() {
    if (pickAge > 4) { rebuildPickable(); pickAge = 0; }
    occRay.set(camera.position, tmp.copy(cur.target).sub(camera.position).normalize());
    occRay.far = Math.max(0, camera.position.distanceTo(cur.target) - 0.35);
    if (occRay.far < 0.2) return false;
    const hits = occRay.intersectObjects(pickable, false);
    return hits.some(h => !(h.object.isSkinnedMesh));
  }
  function nearFade(root, r = 2.2, test = mt => mt.alphaTest > 0, k = 0.7, rMin = 0.35) {
    let U = fadeU.find(u => u.max === r && u.k === k);
    if (!U) { U = { max: r, k, min: rMin, u: { value: r } }; fadeU.push(U); }
    const uni = U.u, name = 'uNF' + fadeU.indexOf(U);
    const seen = new Set();
    root.traverse(m => {
      if (!m.isMesh) return;
      for (const mt of (Array.isArray(m.material) ? m.material : [m.material])) {
        if (!mt || seen.has(mt) || !test(mt, m) || mt.userData.nearFade) continue;
        seen.add(mt); mt.userData.nearFade = true;
        const prev = mt.onBeforeCompile, key = prev ? prev.toString() : '';
        mt.onBeforeCompile = (sh, rd) => {
          if (prev) prev.call(mt, sh, rd);
          sh.uniforms[name] = uni; sh.uniforms.uNFHole = holeU; sh.uniforms.uNFFocus = focusU; sh.uniforms.uNFRes = resU;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCamDNF;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDNF=length(mvPosition.xyz);');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCamDNF;uniform float ' + name + ';uniform float uNFHole,uNFFocus;uniform vec2 uNFRes;')
            .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n{float nf=smoothstep(' + name + '*0.3,' + name + ',vCamDNF);if(uNFHole>0.01&&vCamDNF<uNFFocus-0.35){vec2 q=(gl_FragCoord.xy-0.5*uNFRes)/uNFRes.y;nf=min(nf,1.0-(1.0-smoothstep(0.18,0.32,length(q)))*uNFHole);}float hd=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));if(hd>nf)discard;}');
        };
        mt.customProgramCacheKey = () => key + '|' + name;
        mt.needsUpdate = true;
      }
    });
  }

  const api = {
    nearFade,
    update, setHome, goHome, setFollow, flyTo, zoomAt, pan, orbit, pick, set, snap,
    get following() { return followOn; },
    get dist() { return cur.dist; },
    get target() { return cur.target; },
    get state() { return { target: cur.target.toArray().map(v => +v.toFixed(2)), yaw: +cur.yaw.toFixed(3), pitch: +cur.pitch.toFixed(3), dist: +cur.dist.toFixed(2), follow: followOn, cam: camera.position.toArray().map(v => +v.toFixed(2)) }; },
    get homeDist() { return home.dist; },
  };
  return api;
}
