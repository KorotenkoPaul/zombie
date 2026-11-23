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

## Round 12: autumn particles (game/particles.js, window.__particles)
- Leaves: a few are always in the air (0.12/s plus 0.8*s² per second, still capped at 16 on phones / 30 on desktop), plus a burst when a gust reaches the crown.
- Dust in the lamplight: one Points per room (140 on phones / 240 on desktop). The specks fill about 2.8 x 2.2 x 2.8 m around and below the room's main lamp. They glow only near the light sources (up to 3 per room, read from __lights.list()/pos()) and fade with the lamp's on/off. Perf step 'roomDust' (order 60) turns them off first.
- Breath: 10 points, CPU. They show while __weather.state().feels < 6 °C (full at 2 °C). Indoors they show only below 2 °C, and at half strength. A puff comes on each exhale (every ~3.6 s) and drifts with the wind. The mouth is window.__hero.mouth() if Character provides it; otherwise Head bone + 0.07 up + 0.09 forward.

## Round 13: the house answers the wind (game/housewind.js, window.__housewind)
- Landing lantern: lights.js ([WIND] edit) puts its body, bulb, point light and chain under one pivot at the chain's top and registers it in window.__swing. housewind.js swings it as a 2-D pendulum: it leans downwind (~0.09*s*(s+.3) rad), flutters, and swings in gusts; the limit is 0.45 rad.
- Telescope (found by name 'telescope', userData.tube): the tube shivers in gusts (~0.7°) and creeps up to ±0.04 rad around its mount; it is held still while the hero's task is the telescope.
- Rope ladders: they already sway in their shader (windRope). `W.swayAt(p, freq)` is the CPU twin of windSwayS, used to track their free-end swing.
- Events for Sound: `__wind.on('sway', e)` at the end of each swing: {part 'lantern'|'telescope'|'ladder', id, pos, amp 0..1}. `W.emit(k, e)` is now public for wind-thread modules.
- Breath now uses Character's `window.__hero.mouth()`, and falls back to the Head bone.

## Round 15: rain on the phone, glow near camera fix
- The height map now includes InstancedMeshes (count <= 4000): Planks builds the decks as instanced boards, and rain had been falling through them.
- Drips run on `uDK = max(rainK*1.2, wet^1.4*.85)`, so they keep falling after the rain and thin out as things dry. Big drops from the leaf tips (18 on phones / 40 on desktop, sampled from TREE.leaves) share the same single draw.
- Wet boards: every MeshStandardMaterial that is the top surface somewhere under the sky (recorded while building the height map) gets a chained hook. Where the height map says nothing is above it, it darkens by 34% and its roughness drops to .22. On flat boards in a long rain (wet > .55) shallow water films form (roughness .04) in noise patches. Uniform names are uWetB/uHB/uBoxB, because Ground declares uWet. It runs after Planks' roughness (injected after metalnessmap_fragment).
- index.html motes ([WIND] fix): point size capped at 18 px*dpr, and faded out within 2 m of the camera. Before, a mote at the lens became a huge soft green disc at night.

## Round 16: cloth
- Curtains (lights.js exposes window.__curtains, a [WIND] line): the hem stirs in a draught through the window frame on gusty days. Nothing in a calm, a faint breath in a breeze, a stir in a gust. It's done in the vertex shader of each window's curtain material, with one uniform per window.
- `__housewind.addCloth(material, worldPos, {outside})`: the same hem sway for any hanging cloth (laundry, a flag), stronger outside. Hanging things on a rope/chain: register a pivot in window.__swing (see round 13).
- Smoke already bends with gusts: smoke.js uses windStrength at the pipe top, which includes the gust front.

## Round 17: the hero in the wind
- Foot kicks (particles.js): when a foot lands while he walks (hips speed .5-4 m/s, outside the rooms), 2-3 leaf bits hop up on the ground, or 1-2 dust specks on the landings. They flutter down and drift with the wind. Pool of 16 on phones / 24 on desktop, one draw. Perf step 'footKick' (order 58).
- Breath already shows only outdoors, or indoors when it is very cold (feels < 2 °C, at half strength).
- Hair and clothes stirring belongs to Character (hero.js). They can read __wind.sample(headPos) and __rain.covered(pos).

## Round 18: phone cost audit and soft quality steps
- CPU per frame (all wind-thread updates; SwiftShader host, so expect about 5x on a phone): wind .008 ms, rain .001, particles .020, housewind .015, smoke ~0. Total about .045 ms.
- Draws in a night storm on a phone, at most about 11: falling leaves 1 (16 inst, 32 tris), rain streaks 1 (1600 inst, 3200 tris, thin, fill-light), splashes 1 (220 inst), drips 1 (44 inst), room dust 0-3 (Points of 140, only rooms with a lit lamp), breath 0-1 (10 pts, only when cold), foot kicks 0-1 (16 pts, only right after a step), smoke 0-1 (16 pts), fog bank 0-1 (one sheet, half-res inside fogpass). Curtains, lantern, telescope and ladders add no draws: uniforms or transforms on existing meshes.
- Quality steps no longer pop. wetGlass fades over 2.5 s. rainDrops and rainSplash thin out one instance at a time (uKeep, gl_InstanceID) over ~1 s, then cut instanceCount. roomDust fades (uK) over ~2 s. leafFall and footKick only stop spawning, so the ones already in the air live out.

## Round 19: autumn leaf litter (wind.js makeLitter)
- A falling leaf that comes to rest on a built surface (roof, landing, deck: rain height map > ground + .5 m) joins
  the litter after 12–30 s instead of fading. One InstancedMesh (80 phone / 200 desktop), shares the falling leaf's
  geometry and material, brown autumn tints, slight curl and random size. Ring buffer: when full the oldest goes.
- The world starts lived-in: 30–45% of the pool is seeded on top surfaces under the crown once the rain map is ready.
- Strong wind (level > .8) now and then lifts a litter leaf back into the air (most stay).
- The hero: while task matches /clear_roof|clearleaves|sweep/ and he stands still, the nearest leaf within 1.8 m (his
  feet level up to +2.2 m: a roof edge in reach) is flicked off every .35 s; it flies and lands on the ground or pond.
- API `__wind.litter`: level() 0..1 (n / 60% of pool; Brain weights clear_roof by it), count(), near(x,y,z,r),
  sweep(x,y,z,r,max) -> n, clear(), stats(), mesh. Cost: ~0.016 ms/frame CPU, +1 draw call, ≤ 160 tris (phone).
