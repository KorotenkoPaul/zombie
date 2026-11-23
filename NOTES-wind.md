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
