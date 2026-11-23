# Wind (game/wind.js)

One global wind for the whole scene. Cheap: a few floats per frame on the CPU, all motion in vertex shaders.

- Weather spells: calm (50-140 s), breeze (60-180 s), windy (35-90 s); strength fades between them over ~10-20 s; rain adds wind.
  Direction wanders ±0.5 rad around the prevailing one (from far left-back towards the camera side).
- Gusts: a front travels along the wind direction at 7-11 m/s from 60 m upwind, so far things move first. Rare in calm, every ~20 s in a breeze, ~9 s when windy.
- Created in index.html right after ENV (`window.__wind`), passed to buildTree({wind}) and createGround({wind}); updated after ENV.update. Ambient wind sound follows `level()`.
- Shader API: `W.hook(shader)` in onBeforeCompile, then `windSway(wp,freq)`, `windStrength(wp)`, `windLocal(v)` (InstancedMesh), `windRope(wp,t,len)`.
- JS API: `__wind.sample(pos)`, `level()`, `state()`, `set('calm'|'breeze'|'windy'|'auto')`, `gust(amp)`.
- Consumers (marked [WIND]): leaf cards in tree.js (clump drift + card flutter), grass/bushes/ferns SWAY in ground.js. Rope ladders: Tree & house uses windRope when it rebuilds them hanging.
- Shadows do not sway (depth material untouched) on purpose: cheap, invisible at night.

## Round 2 (2026-11-23, artifact v50)
- Falling leaves: `W.addFallingLeaves({THREE,scene,crown:TREE.leaves,groundH,avoid:LEAF_AVOID,MOBILE})` in index.html. 16/30 instanced leaf cards with a tiny CPU step each; spawn rate 0.04 + 0.7*s² per second (rare in calm, flurries in gusts); they settle, lie 8-16 s, fade. A leaf entering a room box (LEAF_AVOID, + 0.6 m for the roof) is removed.
- Fireflies (env.js) and floating motes (index.html): `#ifdef WIND` blocks, enabled by `W.hookRaw(shaderMaterial)`.
- Oak limbs: `windBranch(p, trunkAxis)` on the bark (tree.js) and added to every leaf card at its centre, so leaves stay on their branch. Zero within 5.5 m of the trunk and below 14 m (house), ~3 cm in a breeze, ~15 cm in a strong gust at the far limbs.
- `uDrift` uniform: metres the air has carried things (world xz). Fog: Environment does its own wind drift in env.js (windU).
- No smoke exists yet (no chimney/oven smoke); no outdoor hanging plants, quilts on railings or lantern chains. Rope ladders: Tree & house (windRope).

## Round 3 (2026-11-23)
- game/smoke.js: thin stove smoke (GPU points, loop per puff). Source = `__props.chimneyTop` (Vector3, pipe opening, world) — Props adds the pipe; hidden until then. Amount follows `LIGHTS.level('oven')` (ramps ~6 s up, ~12 s down); wind bends the plume. Test: `__smoke.force(1)` / `force(null)`.
- Sound events: `__wind.on('gust'|'creak'|'mode', fn)`, `__wind.rustle()` 0..1, `__wind.level()`. Creaks: only when wind > .45, every 5-12 s at most, `{strength, pos}`.

## Round 4: rain (2026-11-23)
- Weather: rare rain spells in wind.js (every ~6-18 min, 2-5 min long, never calm while raining). `__wind.raining()`, `setRain(on)`, `on('rain', e=>e.on)`. index.html: the ☁ button calls setRain; `weather`/rainK follow the event. rainK stays the single 0..1 value others read.
- game/rain.js (`__rain`): GPU streaks (1600/3200 instanced quads) leaning with the wind, stopped by a height map of everything solid under the sky (rays down over a 0.5 m grid, built over ~16 frames ~90 frames after load, TREE.group skipped). Splashes (220/420) on roofs/decks and ground near the tree; drips (26/52) from roof edges found in the map and refined with a few rays. `roofNear(pos)` 0..1 for the rain-on-roof sound, `heightAt(x,z)`.
- Gotcha: the streak quad's side vector decides its winding; with the wrong sign every streak was back-face culled (invisible, no error).
- Environment owns fog, sky and the wet sheen (rainK). Sound owns the rain sound.

## Round 5 (2026-11-23)
- `uWet` uniform / `__wind.wet()` 0..1: soaks within ~10 s of rain, dries over ~2 min. `windRope` sways up to 45 % less when wet.
- `__rain.wetGlass(mats)`: beads running down the window glass in 3 cm lanes + still droplets, strength = uWet. Hooked onto the WINS glass materials in index.html (chains their onBeforeCompile; glass coordinates are world metres, so any pane size works).

## Round 6 (2026-11-23)
- Fix: windSway has a per-position random phase, so it must only get a FIXED point (instance centre). Moving things (fireflies, motes, smoke, rope vertices) use `windSwayS` (smooth) - otherwise the phase jumps every frame (Pavel saw "twitching crickets").
- Cost (code count, phone settings): drops 1 draw / 3.2k tris, splashes 1 / 440, drips 1 / 52, falling leaves 1 / 32, smoke 1 / 24 points, wet glass 0 extra draws (fragment work on 5 panes, skipped when dry), fog bank 1 sheet. JS: < 0.01 ms/frame for all weather. SwiftShader frame times are too noisy to measure GPU cost (±7%).
- __perf steps: wetGlass (25), rainDrops half (35), leafFall half (55), rainSplash half (55).
- Morning fog bank: wind.js rolls one in on ~70% of mornings (4.6-6.4 h start, lifts after 7.6 h), front travels along the wind (`uFogBank`, `__wind.fogBank()`, `fogBankAt(x,z)`, event 'fogbank'); game/fogbank.js draws 1 (phone) / 2 low noise sheets only while it's out. index passes `hour` to WIND.update.

## Round 7 (2026-11-23)
- Falling leaves land on whatever is under them (`surfaceH` = `__rain.heightAt`, decks/landings/roofs) instead of falling through; leaves on decks lie 25-45 s; a gust (s > .7) picks a lying leaf up and skitters it along the boards. Horizontal drag 1.4 (was 2.2: windy spells blew every leaf 50 m away).
- `__rain.covered(pos)`: something solid above the point (for Character: clothes/hair react to `__wind.sample(pos)` only outside).
- Close-up pass in a forced gust (rope ladder, deck, crown): ropes smooth, rungs on their knots, nothing detached.

## Round 8: phone GPU (2026-11-23)
- windLocal: transpose/scale² instead of inverse() per vertex (every grass/bush/fern/leaf vertex runs it).
- Shared baked noise: `__wind.noiseTexture(THREE)` 128² RGBA tiling fbm (R and an inverted variant in G). fogbank.js reads it twice instead of 3 octaves of procedural noise. Offered to Environment for its fog sheets/puffs/mist bands.
- Smoke: 16 puffs on phones, point size capped (48 px × pixel ratio on phones) so a close camera can't fill the screen with smoke quads.
- Overdraw (estimates from geometry, phone): rain streaks ~4 % of the screen, splashes/drips < 1 %, wet glass = window pixels only, fog bank 1 sheet ≈ 0.5 screen (dawn only, discards ahead of the front), smoke ≤ 16 × 72² px. None of it is on in a normal clear day/night.

## Round 9: shared half-res fog pass (game/fogpass.js, `__fogpass`)
- Fog meshes (ENV.sheets, ENV.puffs, ENV.mist, FOGBANK.sheets) move to layer 5; a pass right after the RenderPass draws them into a half-res target (no depth buffer) and blends it over the frame once (One / OneMinusSrcAlpha, premultiplied), with no swap so the frame keeps its depth for DOF.
- Occlusion: each fog ShaderMaterial is patched (main renamed fpMain) to fade by the composer's depth texture (DOF already attaches depth textures). Environment's own softK is fed the same depth (tDepth/uRes/cNear/cFar) where soft=1; where soft=0 (phones) the patch does it.
- On by default on phones only; `__fogpass.setEnabled(on)`, `scale` (0.5). Optimization registers the governor step.
- Phone emulation before/after: same picture, the far haze a touch softer. Frame time in SwiftShader is noise (16.9 s vs 17.6 s per frame), so the gain must be measured on the real iPhone. On desktop Env's soft edge hides most puffs (soft=1 with its pre-pass depth); with fogpass the puffs show as on phones - one reason desktop stays on the old path.

## Round 10: water, leaves on the pond, fog pass fix
- `W.rippleStandard(mat, THREE)`: makes a flat MeshStandard/Physical material ripple like water. The normal follows wind ripples (calm = nearly a mirror, gusts roughen it in travelling patches) plus rain-drop rings while it rains (uRain).
- `W.hookWater(shader, THREE)`: for custom shaders. Adds `waterSlope(wp)` / `waterNormal(wp)` to the fragment shader, e.g. a Reflector puddle can offset its uv by `waterSlope(vW)*.02*uv.w`.
- `W.addWater(f)`: f(x,z) -> surface height or null. Falling leaves land on it, float 50-90 s drifting slowly downwind, bob, turn, then soak and sink. `W.waterAt(x,z)`.
- A gust reaching the crown shakes a handful of leaves loose at once. Horizontal drag is lowered from 1.4 to 1.0 so leaves land nearer the clearing.
- fogpass.js: Environment's shared soft-edge uniforms get their own depth texture back right after the fog render. Before, a material sharing them sampled the composer depth while that target was drawn, which caused the WebGL "Feedback loop" errors on phones (26 errors in 15 s, now 0).

## Round 11: weather over the day (window.__weather)
- Three kinds of rain: drizzle (amount .35; slower, shorter, fainter streaks; 3-7 min), rain (.75, livens the wind), and a rare storm (1, windy). index.html eases rainK towards `WIND.rainAmt()`.
- Storm: a lightning strike every 15-50 s, 1.5-7 km away, as 1-3 flickers. `W.applyFlash({hemi, fog, sky, fogMats})` lights the fog colour, the sky horizon, the hemisphere light and Environment's fog layers (`col`) for a moment. No extra lights or passes. Plain rain sometimes has a far rumble with no flash (a lightning event with `unseen`).
- Events: 'lightning' {dist m, distKm, strength, dir} fires on the flash frame (Sound plays the thunder dist/343 s later); 'thunder' {dist m, loud} fires when the sound would arrive; 'state' {state, prev}.
- Calm evenings: from 18:12 to 23:30 without rain, the spell gives way soon after sunset, 75% of the time to calm. A calm evening runs at half strength with half as many gusts.
- Morning mist (the fog bank) shows on 60% of mornings, and nearly always after a wet night. It still burns off by 9:00.
- `__weather.state()`: {state 'clear'|'calm'|'drizzle'|'rain'|'storm'|'mist', intensity, wind, windLevel, gust, rain, rainAmt, wet, mist, storm, stillEvening, sinceThunder, temp °C, feels °C, cold}. Temperature is an autumn curve, about 4 °C at dawn and 13 °C mid-afternoon, minus up to 2.5 °C in rain. 'feels' takes off up to 3.5 for wind and 1.5 for wet; cold = feels < 6.
- fogpass: narrower soft-edge range (.15 + z*.012 m), so puffs sitting close to roots and ground stay visible.
