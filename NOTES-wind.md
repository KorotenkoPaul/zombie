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
