# Interior light: notes (2026-11-23)

Owner: "interior light" thread. File: `game/lights.js`, created in index.html after props (`createLights`), `LIGHTS.update()` each frame.

Rule (Pavel): warm light only comes from a real source. A source that is off emits nothing: no light, no emissive, no halo, no fog glow, no warm window.
The old always-on warm ambient fill (ambL +.12 at night) is gone; ambL is daylight only now. Night rooms with lamps off are lit only by the cold moon/sky (Environment).

Sources (`__lights.names`): kitchen (hanging lantern + small counter lantern), workshop (dome lamp: SpotLight with shadow + faint bounce), bedroom (wall lantern),
candle (bedroom table), landing (ladder lantern), deck (emissive only), oven (fire, owns oven heat: index passes `heat: LIGHTS.level('oven')` to props.update, `cooking:false`), door (trunk door light + tree doorGlow).
Windows: each window has its own glass material tagged with its room; warm while the room is lit, faint cold reflection otherwise.

API `window.__lights`: list(), set(name,on) (manual until auto(name)), toggle, auto(name?), get, pos (where to reach to switch), room(name) 0..1, onChange(cb), level(name).
Auto logic (until the hero switches things himself): lamps follow evening/night (staggered thresholds), bedroom lamp off when the hero sleeps in bed, candle on while reading in the evening, oven burns while cooking and 40 s after; fire takes ~4.5 s to catch, embers die over ~14 s.

Shadows: workshop spot always (1024 desktop / 512 phone); kitchen + bedroom lantern point shadows on desktop only (512, tiny frusta). Shadow maps update only while a lamp is on. `__lights.degrade()` drops point shadows.
Lamp housings near a source get castShadow=false and their own pane material (glows per lamp).

## Round 2 (2026-11-23)
- Room glow: per room one soft unshadowed bounce light (kitchen/bedroom/workshop), intensity = the room's live source warmth (with flicker), so a lit room is warm in the corners too, like the photo. Off room = 0.
- Light leaves through windows: halo proxies just outside every window (fog glow), and on desktop a small spill light outside each back window that warms the trunk.
- Flicker: smooth value noise (oil lanterns steady with a slow breath and rare gutter dips; candle livelier; oven fire strongest). Candle and oven lights sway a few cm so their shadows move.
- Lantern colour moved from orange 0xFFA14A to warmer amber 0xFFB25E (photo).
