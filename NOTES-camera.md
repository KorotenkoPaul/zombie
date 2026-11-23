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
