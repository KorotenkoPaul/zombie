# NOTES — camera (game/camera.js)

## How it works
- `createCameraRig(o)` → `rig` (index.html). State: `goal` (what input asks) and `cur` (rendered, damped toward goal). Camera = `cur.target + dir(yaw,pitch) * dist`.
- **Orbit only around the trunk** (Pavel's rule, 2026-11-23): `orbit()` rotates `goal.target` around the vertical axis `AXIS` (= TREE_AXIS [0,-0.6]) and changes yaw by the same angle. Limits: yaw = home ±0.75 rad (`YAW_LIM`), pitch 0.02..0.6. Never make it 360° or pivot on arbitrary points.
- Zoom (pinch / wheel / Safari gesture): `zoomAt(f, point)` moves the target toward the picked point under the fingers. Pan (two fingers, right/middle mouse, shift-drag): moves target in the screen plane. Double tap: fly to the picked point (on the hero → follow).
- Inertia after release (capped), soft rubber-band bounds (cylinder r=10 around (0,1), y 0.2..19; dist soft max 1.25× home, hard 1.5×).
- Collision: in `update()` the camera marches from the focus toward the wanted position in 8 cm steps; it stops before `o.solid(x,y,z)` (index.html passes `inTrunk(x,y,z,.3)` for 0<y<16) or the ground (`ENVM.groundH`).
- Near fade + see-through hole: `nearFade()` patches materials (dither discard near the camera, radius follows zoom); a raycast every 6 frames opens a round window when something hides the focus (dist < 12).
- Cinematic idle (30 s): `SHOTS` list, alternates hero-in-room shots. Follow: `followStep()` smoothed velocity + lead.
- DOF: `createDOF()` pass after RenderPass, only < 5 m, off on phones; perf.js step `dof` (order 5); `window.__camera.dof(on)`.
- Test hooks: `__th.rig` (state, set, pick, cine), `__th.view(yaw,pitch,zoomFrac)`, `__th.cam(x,y,d,z)` (override, bypasses the rig), `__camera`.

## Bug: "rotating to the limit, the camera zooms onto the workshop by itself" (Pavel, 2026-11-23)
Most likely cause: the **collision march**, not zoom input.
1. `inTrunk()` is built from slices (`SL`) of **all** bark triangles, branches included, not only the trunk. When the view is rotated toward +0.75 rad, the line from the focus to the camera crosses the big right-hand limbs (tree.js branches from [0.5,5.4]→[9.6,7.6] and [0.5,9.4]→[9.8,12.2]). The march stops there, so the camera distance collapses from ~30 m to a few metres = looks like an automatic zoom. The rotation also moves the focus toward the workshop (the focus rotates around the trunk), so it zooms "onto the workshop".
2. `inTrunk` clamps the slice index to y ≤ 13 m (`SL` has 131 slices, 0.1 m each), while `solid` is active up to y 16, so between 13 and 16 m it tests the wrong (13 m) slice.
Suggested fix: make `solid` test the trunk only (e.g. distance to the axis < `TREE.R(y)` + margin, or `nearAxis` only), limit it to y ≤ 13, and let branches be handled by the near-fade / see-through hole instead of pushing the camera. Also smooth any collision shortening (damp the collided distance, never jump), so a thin obstacle can't snap the camera.
3. Less likely, check too: inertia pushing against the yaw limit (the target keeps rotating with yaw, fine), and the soft-bounds spring (focus r>10 from (0,1) pulls the focus back, which can look like a pan).

## Fixed 2026-11-23 (stress-test thread)
- Root cause of the auto-zoom confirmed by `tests/camera/stress.js`: the collision march hit branches (24 m → 5 m in one frame at yaw ~0.6).
- Collision is now trunk-only: `trunkSolid()` in index.html (per-slice radius by angle, branch roots trimmed, ≤11.5 m), smoothed (`collK`), the ground lifts the camera instead of pushing it in, a final guard pushes the camera out of the trunk.
- The focus is damped in the frame that rotates with yaw around the trunk axis (`toLocal/fromLocal`): orbit = pure rotation, flights go around the trunk. The focus is kept in front of the trunk as seen from the camera (local z ≥ 0.7), never inside it, and ≤3.5 m outside the soft bounds (zoom, orbit, double tap).
- Touch during a flight stops it where it is (`cancelFly`); home/follow/fly stop inertia; wheel ≤ ±35 % per notch; far picks can't drag the focus more than 3× the distance change.
- See-through circle removed. `nearFade` only on the oak's leaf cards (alpha-test, not transparent): per-card alpha erosion (no pixel dither), near the camera and, when zoomed in (<9-15 m), everything in front of the focus. House, bark, grass, ferns never fade.
- Zoom limits (Pavel): MIN_D 1.0 m, soft max = home, hard max 1.2× home.
- Tests: `node tests/camera/stress.js [N] [seed]` (desktop + iPhone, invariants per frame; 3000+3000 sequences clean), `node tests/camera/renders.js [outDir]` (close-zoom screenshots, K1).
- Round 5: flights are eased (smootherstep, 0.6–1.6 s, cinematic 4 s) via `startFly/endFly`; idle breathing fades in 3 s after the last touch. House: `o.rooms` (index ROOMS inner boxes, front z1 open) — zoomed into a room (<8 m, blended from 4 m) the camera stays inside it (`roomExit`), and a camera in a wall/floor/roof slab is pushed out to the focus's side (`outOfWalls`, repeated for stacked floors). Stress test adds `inside-wall`; renders.js adds K3 repros. update() guards dt and NaN state.
- Round 6: cinematic idle is opt-in (`?cine=1`, or `rig.cine(true)` in tests) — Pavel: the camera never moves by itself apart from the tiny breathing. Follow (◎) flies to the hero and ends on any touch/wheel/key. iOS gesture events are ignored while a two-finger pointer pinch is active (they used to double the zoom on iPhone). `tests/camera/ui_taps.js`: real touch taps/double taps on every HUD button leave the camera untouched; a drag from the canvas onto a button orbits and doesn't press it; 40 s idle doesn't move the camera.
- Round 7: crown limbs above 11.5 m have a camera proxy: `LIMB` in index.html (bark voxelised at 0.3 m, shells flood-filled, built once at load, O(1) query) passed as `o.limb`. Close views (<8 m, blended from 4 m) stop in front of a limb (`limbHit`), the focus steps out of a limb toward the camera (`outOfLimb`), and a camera inside a limb slides toward the focus. Far views are unaffected (no auto-zoom). Bark never fades. Zoom is back to the original (1.25x / 1.5x home, original wheel/pinch) with MIN_D 1.43 m (Pavel 20:52). Limits ease in over the last 0.15 rad. `tests/camera/smooth.js` measures jitter at 30/60 FPS.

## Pick cost (2026-11-23, perf round)
- Zoom pick skips meshes under `forest*` / `litter*` and gives meshes with 1500+ triangles a three-mesh-bvh tree (CDN 0.7.8, dynamic import, built one mesh per frame after load; edited geometry falls back to the plain raycast). Phone profile: pick 14.4 -> 1.5 ms, first pick of a pinch 23 -> 4.6 ms. Anchors are identical to the plain raycast (tests/camera/profile.js compares both in the same frame: max diff 0).
- The composer depth textures created by createDOF are also read by fogpass.js (soft fog edges on phones), so they stay even when DOF is off.

## Classic camera (Pavel, 2026-11-23 22:00) - DEFAULT
Pavel asked for the camera as it was before the free camera: zoom only toward the hero, less freedom. camera.js `CLASSIC`
(default; the free camera stays behind `?cam=free`): one finger turns the view (yaw ±0.75, pitch 0.02..0.6), pinch / wheel
zoom 0.32..1 of the home distance (closest ≈10.7 m on an iPhone portrait screen, hero ≈1/4 of the screen height), focus
slides from the whole house (0,7.4,2.4) to the hero as you zoom in (lerp dt*2.5, as the original), no pan, no pick,
no double tap, no inertia, ◎ zooms in on the hero, ⌂ back to the whole house. Safety kept: trunk / wall / limb guards,
ground lift, no auto-movement except the breathing drift, iOS double pinch fix. BVH library is not loaded in classic.
