# Ground & vegetation: notes (checkpoint 2026-11-23, artifact v42)

Owner: ground & vegetation thread. Code: `game/ground.js` (`createGround()` called once in index.html right after the oak is built).
Took over from env.js: ground mesh, grass, rocks, ferns, mushrooms, edge bushes. `groundH()` stays exported from env.js (forest/fog use it).
`env.shroomGlow` stays in env.js (env.update drives it); ground.js reads it. Wind/time uniforms: `ENV.U`.

## How it works
- Roots map: every oak vertex within 0.9 m of the ground marks a 0.25 m cell over ±16 m; a chamfer distance field gives `rootD(x,z)`
  (metres to the nearest wood). Adapts automatically when tree.js changes the trunk/roots. Debug: `__ground.rootD(x,z)`.
- Ground: ground3.jpg (Fal painted floor) at 2 scales, slightly desaturated, moss mottling, contact shadow + damp-earth ring from the roots map.
- Grass: real curved tapered blades (3 tuft variants, far one cheaper), sky-bent normals, dark root → moonlit tip, wind sway. Dense along root edges, patchy elsewhere.
- Moss cushions at root feet, stones (smooth, moss on top), oak leaves (canvas lobed leaf), twigs, ferns (arched fronds), mushrooms (glow at night), rounded leaf bushes at the forest edge (spherical normals).
- Counts are halved roughly on MOBILE. ~12 draw calls total.

## Checkpoint 2 (v38, v42)
- Moss and stones welded (mergeVertices) so they shade smoothly; grass greener, 6-segment blades on desktop; richer leaf colours; a third close-up ground texture scale.
- Open clearing: fewer, bigger, darker tufts that poke through the fog like the photo; fewer, smaller moss cushions.
- Sway now comes from the Wind thread's game/wind.js (marked [WIND] in ground.js); new plants: W.hook(shader) + windSway/windLocal.
- Publishing rule: push to master first, then publish ONLY changed files (ground.js); use the live page as file_path if index.html is unchanged.

## Next
- Compare with the photo at 19:20: grass colour vs fog, bush size at the sides, moss amount.
- Ground fog interplay with Environment (tufts poking through fog).
- Possibly Fal: a better seamless ground texture without painted bush blobs.
