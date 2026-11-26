# Interior light: notes (2026-11-23)

Owner: "interior light" thread. File: `game/lights.js`, created in index.html after props (`createLights`), `LIGHTS.update()` each frame.

Rule (Pavel): warm light only comes from a real source. A source that is off emits nothing: no light, no emissive, no halo, no fog glow, no warm window.
The old always-on warm ambient fill (ambL +.12 at night) is gone; ambL is daylight only now. Night rooms with lamps off are lit only by the cold moon/sky (Environment).

Sources (`__lights.names`): kitchen (hanging lantern + small counter lantern), workshop (dome lamp: SpotLight with shadow + faint bounce), bedroom (wall lantern),
candle (bedroom table), landing (ladder lantern), oven (fire, owns oven heat: index passes `heat: LIGHTS.level('oven')` to props.update, `cooking:false`), door (trunk door light + tree doorGlow).
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

## Round 3 (2026-11-23): phones + daytime
- Perf: the workshop's extra bounce light is gone (folded into the room glow); on phones the candle has no light of its own (flame, halo and room warmth stay). Shadow maps are never drawn for a lamp that is off, and while on they are redrawn every 2nd frame (desktop) / 3rd (phone): only the hero moves.
- `__lights.quality(q)` for a frame-rate governor (perf.js): 2 full; 1 no lantern point shadows, shadows redrawn every 4th frame, no window spill lights; 0 no lamp shadows at all. `degrade()` / `upgrade()` step it. Room look (lights, bounce, halos) is unchanged at every level.
- Day: soft sunbeams from each window that faces the sun (real direction of the shadow-casting sun light), longer and stronger when the sun is low, with warm dust drifting in them (GPU-only, no per-frame meshing). Morning: kitchen + bedroom side windows; afternoon: workshop side window.
- (removed in Round 5: lamps never go out by themselves)

- T14 (critic): window panes are dark night glass seen from inside (navy pane + faint sky reflection, sky blue by day), never a warm self-glow; warm window light lives outside (halo + spill). lights.js skips panes that are transparent or have userData.ownGlass (Tree's real glass).

- Candle: see Round 5 (no timeout any more).

## Round 4 (2026-11-23): nothing floats, door spill, hand lantern, phone light budget
- `hang(pos)`: every lantern lights.js places hangs on an iron chain from whatever is above it (raycast up, ignoring leaves/transparent/shader meshes); with nothing above, an iron bracket comes out of the nearest wall/trunk; with nothing near, a small wooden lamp post stands on the floor below. Bedroom and landing lanterns use it.
- Door: the hollow has one light inside (reach 3.6) plus a soft SpotLight that throws a warm wedge out of the doorway onto the landing, roots and path. The old separate mouth light is gone.
- Hand lantern (source 'hand'): `__lights.attachHand(bone, offset?)` shows a small lantern hanging upright from the bone, swinging with the walk; `set('hand', true)` lights it; `detachHand()` hides and puts it out. Character decides when (going down at night).
- Phone light budget (Optimization): ≤8 point lights. Phones: kitchen and bedroom lanterns get a longer, softer falloff instead of separate bounce lights, no candle light, no window spill lights → 7 point + 2 spot lights (measured). Desktop keeps bounce + spill lights.

## Round 5 (2026-11-23)
- Pavel: lamps and candles NEVER go out by themselves. If the hero forgot one, it keeps burning until he switches it off. Removed the 45 s daylight burn-out and the candle's 90 s timeout. The candle lights when he sits down to read in the dark (becomes manual) and only `set('candle', false)` puts it out. Outdoor landing lantern and trunk door still follow dusk/dawn (nobody carries them).
- Window glow on the oak: no lights. lights.js chains onto Tree's bark and leaf onBeforeCompile and adds uniforms wgP[6] (window point + radius 2.6 m) / wgC[6] (warm colour × room warmth × night): a soft emissive warm spot on bark/leaves next to each lit window.

## Light rules gate (2026-11-26)
`node tests/lights/rules.js` (~3.5 min, seeds 3,7 in parallel; `--seeds 3,7,11`, `--grace 45`). Headless, virtual clock, no rendering.
Checks Pavel's rules: night lamps only where the hero is (a room lit without him > 45 s fails), no lamp goes out by itself
(every on->off with him in that room), dark rainy day: a stay of 45 s+ in a room sees its lamp lit, and a stoked oven burns
and lights the kitchen and still burns 3 game hours later. `--self-test` leaves a workshop lamp on at night: the gate must fail.
Run it before pushing changes to lights.js, brain.js, the hero's switch/stoke tasks or the day/weather code.
