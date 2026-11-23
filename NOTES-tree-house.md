# Tree & house: notes (checkpoint 2026-11-23)

## Findings
- The old main oak was a Meshy GLB with messy triangles. Triplanar bark smeared on it, and its bulges poked through the room walls (the old code only deleted bark triangles inside room boxes, which left holes).
- Planks: `floor-atlas.jpg` is mapped per board as a strip of the atlas, so one box board shows several painted planks with seams in the middle. Floor planks run left-right; in the photo they run front-to-back with ragged, rounded front ends, thick edges and dark gaps. Curved landings in the photo have planks radiating around the trunk.
- Roofs in the photo are thick slabs of chunky, staggered dark slate-blue shingles. Ours are thin boxes with a texture.
- Photo has no stilts under rooms. We still have `post(-4.2,0,KT-.1,…)` and `post(4.4,0,WS-.1,…)`; replace them with knee braces to the trunk.
- In this container jsDelivr was blocked by the network policy. `tests/shots_localcdn.js` serves three/rapier from a local `npm i three@0.160.0 @dimforge/rapier3d-compat@0.12.0` (expects `cdn/node_modules` next to it) and takes a JSON list of `[file, js, wait]` shots.

## Done (WIP, runs without page errors)
- `game/tree.js`: the main oak is now built in code. It has a fluted trunk with winding ridges, root buttresses, 8 big roots sinking into the ground, 11 branches (all leave from the back half, so they pass behind the rooms), and oak-leaf card clumps (900 on mobile, 1500 on desktop).
- Any bark vertex inside a room or roof volume (`TREE_AVOID` in index.html) is pushed out through the nearest side, never through the open front. This fixes the bark clipping through walls.
- Bark uses UVs along the wood with `bark2.jpg` as both map and bump, desaturated and cooler, and darker near the ground.
- The physics trimesh, plank cutting (`SL`/`inTrunk`) and `frontZ` all use the new tree (`TREE.tris`, `TREE.bark`).
- Hollow at the trunk base: triangles inside the arched opening are removed (`hole`), and there is a raised bark lip with warm emissive driven by `doorGlow` (set in the main loop next to `doorLight`). The old flat glowing arch was removed.
- Background trees still use `tree-glb.txt` via `placeTree` (Environment's area).

## Next steps
1. Hollow: add the cave behind the opening. Extrude the same arch about 0.9 m deep with the front cap removed, warm wood plus emissive, and a plank floor. It is currently just a hole.
2. Crown is far too dense and low. The photo shows the upper trunk and branches against the sky, with leaves only at the top and the branch tips. Cut the filler clumps (`for i<16`), keep clumps at the branch ends only, raise the dome, and leave gaps.
3. Planks: a per-board procedural painted-wood shader (grain, knots, bevelled light/dark edges, per-board hue #a9663a–#c98a50, darker gaps) instead of atlas strips. Floors run along z with ragged rounded front ends and a thick dark edge. Disc landings get radial planks. Walls: vertical lighter honey planks with gaps. Floor top heights must stay the same (the hero raycasts floors and seats).
4. Roofs: InstancedMesh of chunky shingles (about 0.3×0.25×0.04, slightly rotated and staggered, dark slate blue) on a thick roof slab with a big overhang.
5. Remove the stilts and add knee braces to the trunk. Rope ladders: twisted rope sides.
6. Then merge to master, republish the artifact https://claude.ai/artifact/Ro32b6Sg7VRcXuuKDEq85d with `files` = all game/*.txt/jpg/png **plus `tree.js`** (and the character thread's `hero.js`).

## Checkpoint 2 (2026-11-23, artifact v15)
- Crown: leaves only at branch tips + 7 high clumps (tree.js); trunk and limbs now read against the sky.
- Cave: elliptical warm room behind the hollow (tree.js), glow driven by the same doorGlow uniform.
- Planks: procedural shader `PLANK_GLSL`/`plankShader()` in index.html (floor-atlas.jpg no longer used by boards). aRow = per-board seed.
- Floors run front-to-back (z) with ragged front ends and a 0.28 m dark fascia; landings LG/LL/LC use `radial:` planks + dark rim. Top heights unchanged.
- Roofs: thick slab + InstancedMesh `SHING` of slate-blue shingles, big overhang, gable trim.
- Stilts replaced by knee braces; `BARRICADES=false` removes the plank fences and their posts (combat is off).
- Next: T1 proportions (trunk bigger, rooms hugging it), cave interior detail, twisted rope ladders.

## Checkpoint 3 (artifact v19)
- Levels raised by HY=1.0 (index.html) to match the photo's heights; LG 2.3, LL 2.45 decorative. Horizontal layout already matches the photo, so no left/right offsets.
- Trunk bark: game/bark3.jpg (Fal nano-banana-pro/edit from the photo trunk crop), tint 0xF0B080, view-angle shading for roundness, small moonlight fill.
- Branches in tree.js BR traced from the photo; trunk to 14.6 m, forks into two limbs.
- Next: warm window bounce light on the trunk, more contrast; roots visibility depends on Environment's fog.
