// Hand contact (the "Дать герою настоящие касания руками" thread).
// What the hero moves (hatch lid, doors, bolt, oven door, fridge, buckets, tools...) moves only while a hand holds it.
// This module keeps the register of what each hand is holding right now, so other systems treat the grip as a grip:
//  - collide.js does not push a hand out of the very thing it holds (the palm on a ring sits on the lid's boards);
//  - the probe (tests/grab/probe.js) measures palm-to-handle distance while the handle moves.
// API: window.__grab = { hold(side, obj, handleFn), free(side|obj), held(o3d) -> side|null, palm(side, out), dist(side) }
export function createGrab({ THREE, bones }) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const grip = { Left: null, Right: null }; // {obj, handle}
  const PALM = .06;
  function palm(side, out = V()) { const h = bones[side + 'Hand'], f = bones[side + 'ForeArm']; if (!h || !f) return null; h.getWorldPosition(out); const fa = f.getWorldPosition(V()); return out.add(out.clone().sub(fa).setLength(PALM)); }
  const api = {
    hold(side, obj, handle) { grip[side] = obj ? { obj, handle } : null; },
    free(x) { for (const s of ['Left', 'Right']) if (!x || x === s || (grip[s] && grip[s].obj === x)) grip[s] = null; },
    // the side whose hand holds o (or one of its ancestors), else null
    held(o) { if (!grip.Left && !grip.Right) return null; for (let x = o, d = 0; x && d < 8; x = x.parent, d++) { if (grip.Right && grip.Right.obj === x) return 'Right'; if (grip.Left && grip.Left.obj === x) return 'Left'; } return null; },
    palm,
    // how far the palm is from what it holds (m), or null
    dist(side) { const g = grip[side]; if (!g || !g.handle) return null; const h = g.handle(); const p = palm(side); return h && p ? h.distanceTo(p) : null; },
    get grip() { return grip; },
  };
  return api;
}
