# Environment / colour / light: notes (checkpoint 2026-11-23)

## Done
- All environment code moved to `game/env.js` (`createEnv()` once, `env.update()` every frame). index.html only has small hooks:
  `const ENV=...createEnv(...)` (where the old ground & pine forest was), `ENV.update(...)` in the frame (replaces old fogMat line),
  `ENV.addHalo(...)` after the lanterns, `composer.addPass(ENV.gradePass)` after OutputPass. Keep env work in env.js to avoid conflicts.
- Removed: cone "pine" forest, the 3 heavy clones of the main tree model (perf win), 6 old vertical fog billboards.
- Ground: 260 m mesh, flat near the house (r<16), hills into forest; vertex colours (moss / teal hollows / earth near roots); ground2.jpg sampled at 2 scales blended by noise (no tiling).
- Grass: ~1300 (mobile 700) star-tufts with canvas-painted blades, wind sway in vertex shader, in clumps.
- Rocks: small mossy instanced stones around roots and in the forest.
- Forest: 4 procedural trunk variants (lean, root flare, branches, bark texture) instanced at 28 (mobile 18) spots, canopies of leaf2.png cards tinted bluer with distance; bushes; 3 far painted silhouette rings tinted by fog colour.
- Fog: 3 horizontal domain-warped noise sheets + 80 (mobile 46) camera-facing swirling puffs that churn and orbit the oak. Density follows evening/night (`eve`), morning and rain.
- Light: blue night fill + rim directional + hemisphere (no shadows) so bark and leaves get the reference's moonlit blue; K palette for 19.3/20.5/night made lighter blue like the photo; additive halos on lamps (works on phones without bloom).
- Grading pass: saturation, contrast, teal shadows / warm highlights, vignette.

## Checkpoint 2 (2026-11-23, v20)
- Fal works from this cloud (queue.fal.run + v3*.fal.media). `pipeline/fal.py` + nano-banana-pro/edit with the reference photo.
- `game/forest-bg.jpg`: painted far forest (gnarled oaks in blue fog) on a 96 m cylinder, mirrored 5x; night shows the night painting; by day a daytime painting of the same forest (forest-bg-day.jpg, Fal edit of the night one) tinted toward the sky colour. Replaced the crude silhouette rings. Source: assets/textures-src/forest-bg-src.jpg.
- `game/ground3.jpg`: painted forest floor (grass, moss, teal ferns, oak leaves), seamless; swapped into the ground material after load.
- Height fog: env.js patches THREE.ShaderChunk fog_* globally. Every fog:true material gets an analytic exponential ground fog (H=1.7 m) with static world noise. Strength comes from index.html's (fogFar-fogNear), so night/morning/rain are thicker. Clears within ~5-13 m of the trunk so the roots read dark (Tree thread ask).
- Puffs: lit warm by the 6 lowest lamp/door halos (uniform lp[6]); fade near ground (no hard cut lines); fade in front of the trunk.
- Ferns (canvas fronds, sway) and mushroom clusters (caps glow warm at night, uniform env.shroomGlow) at r 3.4-9 around the trunk.
- Sheets fade when seen edge-on (no water look). `window.__env` exposes sheets/puffs for debugging.

## Testing in this cloud
jsdelivr was blocked earlier (it works now); if blocked: `npm i three@0.160.0 @dimforge/rapier3d-compat@0.12.0` in a scratch dir and route `cdn.jsdelivr.net/npm/**` to node_modules in Playwright (`page.route`). Swiftshader gives ~1 fps; use `__th.view(yaw,pitch,zoom)` and `__th.setHour(h)` for stills.

## Next steps
- Compare side by side with the reference at 19:20 more: canopy still darker than the photo (leaf material is in the tree code), sky between branches should be lighter blue.
- Soft fog edges where puffs cut the trunk/roots (depth-texture soft particles, desktop only).
- Fog/forest colour pass for day and morning; check day isn't washed out.
- Fireflies, light shafts from windows into fog, moss/ferns on roots, mushrooms (Little Nightmares-like cosy-eerie mood, per Pavel).
- Measure real FPS on iPhone; fog puff overdraw is the main cost (reduce PN if needed).
