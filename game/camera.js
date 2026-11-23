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
  const BOUND = o.bound || { x: 22, z: 22, yMin: 0.2, yMax: 24 };

  const home = { target: new THREE.Vector3(0, 7.4, 2.4), yaw: 0.05, pitch: 0.13, dist: 30 };
  // goal (what the input asks for) and cur (what is rendered, damped toward goal)
  const goal = { target: home.target.clone(), yaw: home.yaw, pitch: home.pitch, dist: home.dist };
  const cur = { target: home.target.clone(), yaw: home.yaw, pitch: home.pitch, dist: home.dist };
  let followOn = false, atHome = true, flyK = 0, idle = 0;
  const MIN_D = 0.7, PMIN = -0.25, PMAX = 1.45;
  const maxD = () => home.dist * 1.3;

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
    const nd = clamp(goal.dist * f, MIN_D, maxD());
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
    goal.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    stopFollow(); flyK = 0; atHome = false;
  }
  function orbit(dx, dy) {
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

  // ---------- pointer input ----------
  const ptrs = new Map();
  let mode = null, last = null, down = null, pinch = null, lastTap = null, panBtn = false;
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    onUser(e);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { dom.setPointerCapture(e.pointerId); } catch (_) {}
    idle = 0;
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
      } else if (ptrs.size === 0) mode = null;
      return;
    }
    if (ptrs.size) return;
    mode = null; last = null;
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
  function keepOut(target) {
    // target: inside the world box, above the ground
    target.x = clamp(target.x, -BOUND.x, BOUND.x);
    target.z = clamp(target.z, -BOUND.z, BOUND.z);
    target.y = clamp(target.y, groundY(target.x, target.z) + BOUND.yMin, BOUND.yMax);
  }
  function update(dt, extra = {}) {
    pickAge += dt; idle += dt;
    if (followOn) { const f = follow(); if (f) goal.target.lerp(f, damp(6, dt)); }
    keepOut(goal.target);
    goal.dist = clamp(goal.dist, MIN_D, maxD());
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
  function nearFade(root, r = 2.2, test = mt => mt.alphaTest > 0) {
    const seen = new Set();
    root.traverse(m => {
      if (!m.isMesh) return;
      for (const mt of (Array.isArray(m.material) ? m.material : [m.material])) {
        if (!mt || seen.has(mt) || !test(mt, m) || mt.userData.nearFade) continue;
        seen.add(mt); mt.userData.nearFade = true;
        const prev = mt.onBeforeCompile, key = prev ? prev.toString() : '';
        mt.onBeforeCompile = (sh, rd) => {
          if (prev) prev.call(mt, sh, rd);
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCamDNF;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDNF=length(mvPosition.xyz);');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCamDNF;')
            .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n{float nf=smoothstep(' + (r * 0.3).toFixed(2) + ',' + r.toFixed(2) + ',vCamDNF);float hd=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));if(hd>nf)discard;}');
        };
        mt.customProgramCacheKey = () => key + '|nearFade' + r;
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
