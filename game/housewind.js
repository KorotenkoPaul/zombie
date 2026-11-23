// Wind thread — the house answers the wind (game/housewind.js).
//
// A few hanging or loose things outside move with __wind.sample, each on a small damped spring (a handful of objects,
// a few multiplications per frame, no shaders):
//  - the lantern by the landing swings on its chain (a pendulum: it leans away from the wind and sways in a gust)
//  - the telescope on the deck: the tube shivers on its loose mount in a gust and creeps a degree or two around;
//    it is held still while the hero is using it
//  - the rope ladders sway in their vertex shader (wind.js windRope); here only their swing is tracked on the CPU
//    (wind.swayAt, the twin of the shader) so Sound can creak the ropes at the end of each swing
// Props' door swings in the wind on its own (props.js) and plays its own knock.
//
// Hanging things register in window.__swing = [{name, piv (Object3D whose origin is the hanging point), len (m)}]
// (Lights does this for the landing lantern).
// Sound: __wind.on('sway', e) at the end of each swing (when the part turns back):
//   e = {part: 'lantern' | 'telescope' | 'ladder', id, pos: [x,y,z], amp 0..1}
// createHouseWind({wind, scene, ladders: [{id, x, z, y0, y1}]}) -> {update(dt)}

export function createHouseWind({ wind, scene, ladders = [] }) {
  const swings = new Map();   // piv -> state
  let tele = null, teleT = 0;
  const sway = (part, id, p, amp) => { if (wind && wind.emit && amp > 0.03) wind.emit('sway', { part, id, pos: [p.x, p.y, p.z], amp: Math.min(1, amp) }); };
  const busy = () => { try { const s = window.__th && window.__th.state ? window.__th.state() : null; return !!(s && /telescope/.test(s.task || '')); } catch (e) { return false; } };
  // a swing "turns back" when its velocity flips sign along the direction it was moving
  const turned = (st, vx, vz) => { const d = vx * st.lvx + vz * st.lvz; st.lvx = vx; st.lvz = vz; return d < 0; };
  const LAD = ladders.map(l => ({ ...l, p: { x: l.x, y: l.y0 + 0.4, z: l.z }, lx: 0, lz: 0, lvx: 0, lvz: 0, peak: 0 }));

  return {
    update(dt) {
      if (!wind || !wind.sample) return; dt = Math.min(0.05, dt); if (dt <= 0) return;
      const now = performance.now() * 0.001;
      // ---- hanging lanterns: a 2-D pendulum on the chain ----
      for (const it of window.__swing || []) {
        let st = swings.get(it.piv); if (!st) { st = { x: 0, z: 0, vx: 0, vz: 0, lvx: 0, lvz: 0, peak: 0, px: it.piv.position }; swings.set(it.piv, st); }
        const w = wind.sample(st.px), s = w.s || 0;
        // the wind pushes the lamp downwind (drag ~ speed²), with a flutter so a breeze is not a frozen lean
        const fl = Math.sin(now * 2.3 + st.px.x) * 0.25 + Math.sin(now * 3.7) * 0.15;
        const k = 0.09 * s * (s + 0.3) * (1 + fl * Math.min(1, s));
        const fx = (w.x / (s || 1)) * k, fz = (w.z / (s || 1)) * k;
        const om2 = 9.81 / Math.max(0.2, it.len || 0.5);   // pendulum stiffness
        st.vx += (fx * om2 - st.x * om2 - st.vx * 1.1) * dt; st.vz += (fz * om2 - st.z * om2 - st.vz * 1.1) * dt;
        st.x += st.vx * dt; st.z += st.vz * dt;
        const lim = 0.45; st.x = Math.max(-lim, Math.min(lim, st.x)); st.z = Math.max(-lim, Math.min(lim, st.z));
        it.piv.rotation.set(-st.z, 0, st.x);   // bottom moves +x for +x, +z for +z
        st.peak = Math.max(st.peak, Math.hypot(st.vx, st.vz));
        if (turned(st, st.vx, st.vz)) { sway('lantern', it.name || 'lantern', st.px, st.peak / 0.8); st.peak = 0; }
      }
      // ---- telescope: shiver in the gusts, creep a little on its mount ----
      if (!tele && scene && (teleT -= dt) <= 0) { teleT = 2; const t = scene.getObjectByName('telescope'); const tube = t && t.userData.tube;
        if (tube) tele = { tube, rz: tube.rotation.z, ry: tube.rotation.y, a: 0, v: 0, b: 0, w: 0, lvx: 0, lvz: 0, peak: 0, pos: t.getWorldPosition(t.position.clone()).setY(t.position.y + 1.2) }; }
      if (tele) {
        const w = wind.sample(tele.pos), s = w.s || 0, g = w.gust || 0, hold = busy();
        const f = hold ? 0 : (Math.sin(now * 19) * 0.5 + Math.sin(now * 31) * 0.5) * g * 0.012 + s * s * 0.004;
        tele.v += (f * 60 - tele.a * 60 - tele.v * 4) * dt; tele.a += tele.v * dt;       // the tube's tilt (quick, small)
        tele.w += ((hold ? -tele.b * 3 : g * 0.6 * Math.sin(now * 0.7)) - tele.w * 1.5) * dt; tele.b += tele.w * dt * 0.05; // slow creep around
        tele.b = Math.max(-0.04, Math.min(0.04, tele.b));
        tele.tube.rotation.z = tele.rz + tele.a; tele.tube.rotation.y = tele.ry + tele.b;
        tele.peak = Math.max(tele.peak, Math.abs(tele.w));
        if (turned(tele, tele.w, 0)) { if (!hold && g > 0.3) sway('telescope', 'telescope', tele.pos, tele.peak * 1.5); tele.peak = 0; }
      }
      // ---- rope ladders: follow the shader's sway at the free end, report the turns ----
      for (const L of LAD) {
        const o = wind.swayAt(L.p, 1.1), len = L.y1 - L.y0, k = 0.05 * len;
        const vx = (o.x * k - L.lx) / dt, vz = (o.z * k - L.lz) / dt; L.lx = o.x * k; L.lz = o.z * k;
        L.peak = Math.max(L.peak, Math.hypot(vx, vz));
        if (turned(L, vx, vz)) { sway('ladder', L.id, L.p, L.peak / 0.6); L.peak = 0; }
      }
    }
  };
}
