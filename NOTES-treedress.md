# Tree dressing: notes (2026-11-23)

Owner: tree dressing thread. Code: `game/treedress.js`, `createTreeDress()` called in index.html right after props (boards exist by then).
Debug: `__treedress.stats()`.

## What it does
- Bark shader: chained onto `TREE.bark.material.onBeforeCompile` (tree.js untouched; cache key `|treedress1`). World-space:
  damp cool dark foot up to ~4.8 m, contact AO at the ground, moss on up/back-facing bark (roots + foot, limb tops above 3 m),
  faint lichen higher up. Moss colours are LINEAR values (bark texture is dark in linear; sRGB-looking values glow).
  Uniforms `__treedress.barkU.mossAmt / footDark` (0..1) to tune live.
- Moss cushions (root tops, limb tops), soil mounds + leaf litter in pockets between roots (uses `GROUND.rootD`), ivy vines on the lower trunk
  (radius map by angle/height, stops at landings/rooms via boards/beams boxes and TREE_AVOID, avoids the hollow), ferns + grass tufts in crevices and on limb tops.
- 7 draw calls, counts ~55% on phones. Wind: ENV.U (t, wind).

## Round 2 (artifact after v54)
- Moon rim on the bark from env.moonRim (color/strength/dir), scaled by bark brightness, less on moss. `barkU.rimK` scales it.
- Wet bark: `barkU.wet` = max(night*0.35, rain); rain is read back from ENV.U.wind (wind = 1 + rain*1.5). Lower roughness in streaks, slightly darker, moss stays matte.
  Updated from TREE.bark.onBeforeRender (no main-loop change).
- Mushrooms: small glowing caps in clusters on root tops (same env.shroomGlow as Ground's), bracket fungi shelves on the lower trunk sides.
- Note: `__th.cam(1,2,9)` gives a half-black frame (camera inside something); not related to treedress.

## Round 3
- Upper ivy: short vines on the trunk between the rooms (seeded in free gaps, mostly the front half, stop at the next floor/wall). `__treedress.upperAt`.
- Hanging ivy strands from beams under landings and room floors (beams = blockers[1]). `__treedress.strandAt`.
- Moss patches on roof shingles (index.html passes `roofs:SHING`) and on landing/deck board ends (back side), same moss InstancedMesh.
- Ferns in high forks (limb tops where wood rises again within 0.45 m on 2+ sides), same fern InstancedMesh. Draw calls unchanged (9).

## Round 4: real bark relief (Pavel: "too smooth, like a sculpture")
- Fal photo of oak bark (assets/textures-src/oak-bark-fal.jpg, nano-banana-pro) -> pipeline/bark_maps.py -> game/barkN.jpg (normal) + game/barkH.jpg (R height, G cavity, B fine detail), seamless 1024.
- Triplanar in world space in the bark chain (no stretching on the Meshy model), furrows run up y (y*0.42), macro scale `barkU.scale` 0.55, micro octave x4 fades out past ~16 m.
  Albedo: dark furrows / light greyish worn crust on ridges; normal: UDN triplanar blend replaces the shading normal; moss settles in furrows first.
  `__treedress.barkU.relief.value` 0..1 to compare on/off.
- Also: hanging moss strands (windRope), leaf piles on landings (Ground's leaf/palette, kept off the hero's walk graph).

## Next ideas
- Hanging moss / roots dangling from the big limbs? (not in the photo, only if Pavel wants more life)
- Ivy higher up between the rooms if Pavel wants more green.

## Round 5 (trunk and roots vs the photo, weather marks)
- Roots/limbs: the bark mapping's "across" coordinate was dot(p, tangent), constant along every radial line, so the plates were
  smeared into wood-grain rings across the roots. Now it is the arc length around the trunk (angle * TDR, explicit gradients,
  one turn = whole tiles at every octave), with bigger plates on roots (TDRS .68). End-on projection runs furrows along B.
- Foot darkening .9 -> .62 so the base and the roots read at night like the photo (still darker than the trunk).
- Rain now comes from Wind (`__wind.raining()`); the old `U.wind` scalar is wind strength, which made the bark glossy in strong wind.
- Soaked bark (`barkU.damp`): soaks in ~25 s of rain, dries over ~4 min; dark runs down the bark that shrink as it dries
  (furrows, streaks, foot hold water longest). Gloss only while it rains. One extra texture read, only while damp.
- Frost on root tops: not done, Environment exposes no temperature.
