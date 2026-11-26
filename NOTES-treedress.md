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

## Round 6 (junctions, beams, frost)
- Bark geometry gets a `tdJ` attribute (built once from the mesh): x = crease (concave at ~0.5 m scale: a Laplacian-smoothed copy
  of the surface moves outwards), y = collar ring within 0.65 m of a crease, z = near a beam. Crotches darker, squeezed folds,
  moss packed in; collars get deeper, paler-ridged folds.
- Beam bites: ends of beams/posts (blockers) within 0.35 m of the bark -> up to 72 contacts in `tdBite[]`, looped per pixel only
  where tdJ.z > 0. Crushed dark bark under the end, a callus roll round it (normal), rubbed grey ridges without moss, a water stain below.
- Frost: `__weather.state().temp` (Wind). Target = (5.3 - temp) / 1.1 on dry nights (~1-5 am), forms over 90 s, melts in 60 s.
  A light dusting on root-top ridges near the ground, not snow.

## Round 7 (phone cost after rounds 5-6)
- Bench: scratchpad-style bark-only render timing on the iPhone 13 profile (swiftshader, relative only), old treedress (257c9cd)
  vs new with everything else equal. Rounds 5-6 had made the bark ~1.6x dearer: the beam-bite loop over 72 uniforms (~300 ms of
  ~800 in the bench) and textureGrad (~90 ms).
- Fixes: the two nearest bites are baked per vertex (attributes tdB1/tdB2, flat varyings), no uniform array or loop over all;
  phones use one. Phones read with plain texture2D and pick the angle coordinate whose wrap is not in this pixel quad
  (Tarini's trick, one turn = whole tiles), so no textureGrad and no seam. Phones blend trunk/root coordinates in a narrower band.
- Result: back to the lite-pass level within bench noise (roots ~595 vs 598, trunk ~480 vs 482, frame ~555 vs 550).

## Round 9 (house grown into the tree)
- From the beam contacts (D.bites, now with the beam axis, length and cross-section): moss cushions on the wood right at the bark
  and a fringe on the bark above (moss mesh, +110*MUL capacity), and ivy sprigs round the joint on the bark that creep 0.2-0.7 m
  along the wood (ivy mesh; stems on desktop only). Horizontal wood: ivy only on a side face, never on the walked top;
  none near the door. Same draw calls.

## Round 10 (moss and ivy weather)
- Moss (bark moss and the cushion mesh) follows barkU.damp: deeper and greener when soaked, back as it dries. Soil lumps in the
  same mesh are skipped (only green instances react).
- Frost (barkU.frost, from __weather temp, < ~5 °C on dry nights) also dusts the tops of the moss cushions, grainy, not white.
- Ivy flutter now uses Wind's windSway (real gusts) instead of the legacy U.wind scalar; falls back if Wind is missing.

## Round 12 (phone overdraw / draw calls)
- Per-mesh fragment coverage on the iPhone 13 profile (full-screen layers, no depth): litter .011-.023, ivy .017-.032,
  ferns .007-.025, hanging .001-.005, moss/soil .003-.006 (opaque), fungi .002, board leaves .001-.002, tufts ~.001.
  All treedress together ~.05 of ~3.6 alpha-tested layers in the scene.
- Cut: grass tufts on phones (1 draw call, ~0.1% of the screen; Ground's grass is right there). Phones: 7 draw calls.
- Phone bark fixes found on the way: the lite "big" noise read was planar (x+z, y), constant along flat root tops -> pinkish
  stripes; now a skewed read that varies on every face. Lite lichen without fract() bands. Lite mutes the model's painted map
  like desktop (.85).

## Round 13 (closest zoom, 1.43 m)
- Desktop held up (micro octave + micro normal already). Phones were soft up close and one root showed long streaks: the lite
  path mixed the trunk and root *coordinates* across the blend band, which makes a huge gradient there. Phones now take the two
  reads only inside a narrow band (2.8-3.4 m), like desktop.
- Phones, only while the camera is within 9 m of the trunk (uniform tdNear from the bark's onBeforeRender camera): the fine
  octave read, and a screen-space micro bump from its height (dFdx/dFdy, no normal-map read). Bench within noise.

## Round 14 (on the new trunk forms, d015ff1)
- Pavel wants the bark smooth like the photo, character from the forms: bark relief default 1 -> 0.45 (plates, cavities, micro
  octave and normals all scale with it). Moss, ivy, creases and bites rebuilt fine on the new geometry (712 creases, 72 bites).

## Round 15: the earth humps at the ladder foot (2026-11-25)
- The "black speckled ellipse / faceted blob" reported by Env and Ground at the ground-ladder foot was a soil hump (the 0.3-0.6 m humps between the roots share the moss cushion InstancedMesh). Normally buried; where the floor shader sinks the floor it stood out near-black, with the pixel-size stem bump drawing black speckles and the cut into the floor a hard rim.
- Fix (key now 'tdMossCushion4'): per-instance attribute tdSoil marks the humps. On them: mossy colour (hash-picked, no extra R() so placements stay), browner low down, no stem bump, soft mottling from arithmetic noise faded by fwidth, and a frayed rim (discard by normalised height vs noise; no texture reads).
- Test: raise one hump 7 cm on purpose (scratchpad soil6.json) to see the worst case.

## Round 16: bark dressing under the clump crown, phone close-up (2026-11-26)
- SHADERS rule: swayMat (ivy, ferns, tufts) had no key: its default key is the hook's source text, the same for all three, so the ivy and the ferns could share one program. Keys now: 'tdSway|amp|chunk', tufts +'|tdTufts1', fungi 'tdFungi1', hanging 'tdHanging1', the unused soil material 'tdSoilMat1'.
- Apple rule: on phones the bark reads (tdTex) were plain texture2D inside the per-pixel weight branches (w>0, tdLf). Now textureLod with an explicit LOD from gradients taken in uniform flow (tdDx/tdDy/tdUd also on TD_LITE). tdBias (normal reads +1.2) softens the single-texel pits.
- Black "pepper" on roots and limbs up close: pores/fine octave toned down (cav .74 floor, fine octave .93+.14).
- Moss cushion stems: the bump is a screen derivative (constant per 2x2 quad), so stems under ~3 px drew a blocky camouflage. They now fade much earlier (aF k=3, aM k=1.2).
- Hanging strands: pale grey-green beard lichen, not bright green ribbons.

## Round 17: ivy and moss on the house (2026-11-26)
- Phones: the join-ivy sprigs on beams and posts had no stem (only desktop got one): their leaves floated loose. Stems on phones too.
- Night: the moonlit rim drew long blue painted streaks on the faceted roots by the door. Rim is now pow 4, weaker low down (y<1.5..4.5) and broken by the bark ridges (tdH).
- Door: moss in the threshold corners beside the jambs (DOORP passed in from index.html as C.door; own rng(7071), sampler/pointOn take an rng so the main stream and every later placement are unchanged). 10 desktop / 6 phone slots reserved in the moss mesh.
- Root cushions: taller domes (y*1.35, sunk less). The coarse stem bump drew dark worm stripes, so it is weaker now (aM*.4) and soft mottling (td_f 41) is added on every cushion.
- Budget (tests/perf/budget.js): origin/master was already OVER on "day home" (alpha 1.51) and "night yaw limit" (454k). This round adds about 1k tris on the phone.

## Round 19: draw calls and wet moss and ivy
- **Phones, one draw fewer.** The root-pocket leaves are baked into Ground's litter mesh at runtime instead of being their own instanced mesh.
  - Ground's atlas grows from 3 cells to 4: its own cells keep their texels, because every u on its litter and skitter leaves is scaled by 3/4.
  - The new cell is painted from `leaf2-128.png`, because the phone's `leaf2` is a KTX2 that can't be drawn into a canvas. The image loads after start; until then the old mesh draws.
  - Guarded: the bake runs only if the atlas is 384×128 and the litter has exactly Ground's 6 attributes, otherwise nothing changes. `__treedress.litterMerged` reports the result.
  - Desktop keeps its own mesh.
- **Phones now get ivy stems** (`ivyStemsBaked`). They are baked into the same litter mesh on the white atlas cell, so they cost no draw; before this, the vines' leaves on phones floated without stems.
- **Rain.**
  - Moss: the cushions get a wet sheen while it rains (the tips more than the hollows) and the earth humps soak darker. Key: `tdMossCushion5`.
  - Ivy and ferns: they darken a little when soaked and glisten in rain, using the same `barkU.wet`/`damp` uniforms as the bark. Key suffix: `|tdWet1`.

## Round 20: wind
- **Ferns** now sway with Wind's shared `windSway` (freq 1.5), so the same gust front that moves the crown reaches them too.
  - Calm: about 1 cm at the frond tip. Breeze: about 3 cm. Gust: about 13 cm.
  - On top of that, a faint leaflet shiver that grows with the gust.
- **Grass tufts** now read Wind as well (`windSway` freq 1.7, like Ground's grass), via `mat.userData.wind`, which makes swayMat call `W.hook`.
- **Ivy** (FLUTTER, windSway 2.6) and the **hanging lichen** (windRope + windBranch) already used Wind; they are unchanged.
- The old sine sway stays as a `#else` fallback for when Wind is missing. No new draws.

## Round 21: autumn touches on the trunk
- **Drip lines under the landings** (bark shader, `tdDrip[8]`, key `|treedress6`).
  - Sources: bark faces right under a board or beam, clustered and ranked by bark area. The side facing the home view counts 3x.
  - Excluded: the door lintel and anything above y=11. See `__treedress.drips`.
  - Look: dark, water-stained vertical runs. Faint when dry, stronger and glossy when wet or in rain.
  - Cost: arithmetic noise only, an 8-iteration loop, no texture reads.
- **Fold leaves**: about 16 more leaves (9 on phones) in the trunk's bark folds between the landings (y 4.5–8.5, near the axis).
  - They use their own rng (7073), so nothing else moves. They sit in the litter mesh's extra capacity.
- **Board leaves** (the piles on the landings): now baked into Ground's litter mesh (atlas cell 0, Ground's own leaf) on phone and desktop.
  - Saves one draw. Falls back to their own mesh if the atlas or attributes don't match.
- Budget: 286/282/285 calls, tris up to 447k (yaw limit).

## Round 22: deterministic placement
- **Cause.** The house build in index.html (boards, cutRun splits, wall planks, shingles) used Math.random. The blockers therefore shifted by millimetres between loads.
  - One flipped sample then shifted the single shared rng stream and every draw after it. On the same build the ivy count ranged 356–422, and moss on boards and roofs varied too.
- **Fix 1 (index.html).** Math.random is seeded for the synchronous house build, from just after the slate/moss texture await up to just before createTreeDress, and restored after.
  - The house is now the same on every load and still irregular.
- **Fix 2 (treedress).** `RSEED(key)` reseeds each candidate loop per iteration, each vine, and each beam bite (keyed by position). Each section also starts from its own seed.
  - A future difference in the blockers now changes only that one candidate.
  - This changes the current layout once; the look is statistically the same.
- **Verified.** Instance positions are identical across loads: phone 3 loads, desktop 2 loads. That covers moss, ivy, litter, ferns, hanging and the board leaves.

## Round 23: bark close-up (1.4 m zoom)
- **Moss cushions.** The stem bump now uses the noise's analytic gradient (`td_nd`) instead of screen derivatives, so it is no longer blocky pixel camouflage up close. Key: `tdMossCushion6`.
- **Phone bark when the camera is near the trunk** (tdNear, a uniform branch). Key: `|treedress7`.
  - The fine octave's normal map replaces the screen-derivative micro bump, which drew sandpaper grain on sunlit roots.
  - A second macro read at 15/11 scale breaks the roughly 1.8 m repeat, as on desktop.
  - Cost: 2 extra triplanar reads, only while zoomed near.
- **Desktop lichen** sits on the bark ridges (tdH), so the furrows break its rim; it no longer reads as a sticker.

## Round 24: the cork speckle on the sunlit roots
- **Cause.** Found by layer debugging (an albedo capture at each stage).
  - It was not the bark map's colour. It came from tree.js's limb-groove shading, which reached the roots (dT > 3.3 m, at any height) and took its phase from the shading normal.
  - That normal already carries treedress's bark normal map, so its pores turned the grooves into a cork speckle.
- **Fix (tree.js, one factor).** The limb grooves now start above y 1.8–3 m. Roots keep treedress's own triplanar furrows.
  - The home view loses the dark painted groove lines on the front roots; they read smoother, like the photo.
- **treedress.**
  - Root relief eases back towards the trunk's within about 5 m of the camera (spkN).
  - The phone moss breakup uses a world noise instead of the map's cork channel within 6 m.
  - Key: `|treedress8`.
- **Night and rain walk** (door, door side and ladder root): nothing painted-looking found in treedress.
  - One thing for Env: a straight horizontal seam crosses the ladder root at about 1 m. It is the low fog sheet, not the bark.

## Round 25: photo folds on the trunk and roots
- **Flutes.** Long smooth flutes run down the trunk and on out along every root. In the photo they are the trunk's main character.
  - One phase by angle round the axis (17 per turn) does both, because the roots radiate from the axis.
  - The phase wanders with height and distance (`tdFl`, `tdFlK`, `tdFlD`).
  - Grooves are narrow and dark, ridges broad and a little lighter, and the normal tilts across them.
  - They stay below the house (fade out at y 4.2–5.6, where Tree's limb grooves take over) and off the crotches. They fade before a flute gets under about 2 px.
- **Night moon fill.** A cool grey-blue fill on the trunk and roots (below 5–9 m) at night: the ridges and root tops catch it, the grooves stay dark.
  - Before, the lower trunk and roots sank into one dark brown mass; in the photo they read in cool moonlight.
- Key: `|treedress9`. Arithmetic only, no reads, no draws.
- **Still off versus the photo (geometry, not shader).** The roots are faceted low-poly planes. The photo's roots are long, round and sinuous and spread wider.

## Round 26: autumn greenery (ivy, ferns)
- Photo check: the photo trunk is clean bark with only grass at the foot; ours keeps the sparse sprigs (no count change), but now in autumn colours.
- Ivy: 32% of leaves low down rising to 52% at 7 m turn wine red / rust / butter yellow, picked by `tdHash` of the leaf position (no R() draw, layout unchanged: 373 phone / 602 desktop).
- Ferns: 30% copper, 20% straw, the rest a tired green.
- Shader (`mat.userData.autumn`, key `|tdAut1`): instance colour red > 1.5 marks a turned leaf and holds 4x the target colour; the green map only supplies luminance, so turned leaves are clean colours with lighter veins, not muddy tinted green.

## Round 27: oak limbs close up
- The limbs showed a camouflage blotch up close. Cause: tree.js's limb grooves took their phase from the shading normal, which carries treedress's bark normal map (same bug as the root cork speckle in R24).
- Fix in tree.js (key `oakBark-grooves2-fold`): the phase now comes from the position (angle round the trunk x90, height x13 on the limbs fading to 0 up the trunk, plus smooth wander), so the grooves run along each limb and are noise-free. Home view unchanged.
