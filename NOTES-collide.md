# Collision notes (owner: Collision thread) — game/collide.js

Goal (Pavel, 2026-11-23): the hero's body and the things in the house have clear boundaries; he must not walk or reach through them,
and his feet never go below the floor.

## How it works
- `createCollide({scene, HH, P3, trunk:{SL,TAX}})` is called at the end of index.html (after `window.__dbg`). It wraps `HH.update`:
  the root correction is taken off before hero.js runs and put back after, so hero.js logic (walking, nav, fit) never sees it.
  hero.js itself is untouched.
- World colliders (built once at load, only around the walk graph): instanced boards/beams and any Box/Cylinder/Sphere mesh are exact
  oriented shapes; other meshes (props.js bakes furniture per material) are voxelised at 2 cm into an inside-distance grid (same method
  as tests/anim/sampler.js), in the background nearest-first (1.5 ms/frame budget) or on first touch. Trunk: bark cross-sections (SL).
  Spatial hash, 0.4 m cells. A shape re-reads its object's matrix when the hero is near (oven door, hatch lid, book); anything under the
  hero's root (held book/tools) or hidden is ignored. Planes/rugs have no volume and are skipped.
- Body: ~1100 skin vertices skinned on the CPU (same formula as the GPU), grouped by main bone like the QA test.
- Response per chain: torso/hips/upper arms -> root offset (sideways; also up while seated/lying); head -> spine+neck bend; forearm/hand ->
  arm IK; shin/foot -> leg IK (foot orientation kept). Up to 4 iterations per frame.
- Smoothness: a correction may grow at most 1.6–2.5 cm/frame and accelerate 0.6–1.4 cm/frame²; it is held 0.35 s after the last contact,
  then released exponentially (~0.4 s). So no pops and no push/release jitter; contact building up slowly is resolved fully.
- Allowed depth (below the QA limits): hard 0.4 cm, feet 0.6 cm, seat 1.1 cm (hips/thighs on chair/stool/bench), bed 1.7 cm, pillow 4 cm while lying.
- Floor guard: when the hero stands (not on a ladder, not seated/lying) and the top of a flat house board under his root is above the
  root, the root is lifted onto it (persistent, ~20/s, and hero.floorY updated). Rungs/rails (narrower than 12 cm) are not floor.
  Cause on the hero side: hero.js post() only snaps up to the floor when it is < 12 cm above the root.
- On ladders only hands and feet are corrected (the climb passes the body through the hatch by design).
- Nav: walk-graph nodes (not ladder ends, seats or tight approach spots) that stand within 20 cm of something solid are moved to the
  nearest free spot at load (`__collide.navMoved`). `__collide.navReport()` lists edges without room for the body.

## API
`window.__collide = { stats(), enable(on), shapes, depthAt(x,y,z), clearance(x,y,z,r), navReport(), navMoved, buildAll() }`
`stats()`: ms (avg JS time per frame), msMax, pushes, worst (cm, before correction), floorFix (frames), vox/pending.

## Results (tests/anim/run.js, seed 1, 25 h + tour)
Same master (eb8f800) with and without collide.js: penetrations P1 (>= 4 cm) 89 -> 57, P2 (2-4 cm) 182 -> 138; walking feet in boards P2 30 -> ~13. Jumps P1 189 -> 184 (unchanged). Cost ~0.35 ms/frame on a desktop CPU (headless), all ~1100 points, 1-4 iterations. Left: mostly ladder climbs (hatch rim, rungs) and a too-low slab over the deck (Tree).

## Known / next
- Ladder climb itself (body through the hatch rim, hands in rungs) needs the ladder placement from hero.js / tree.js.
- Box depth uses the nearest face, so near an edge the push can switch direction; budgets keep it smooth.
