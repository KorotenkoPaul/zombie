# Sound / ambience (game/audio.js)

- The old ambience was two looping white-noise generators in index.html ("wind" bandpass 380 Hz and "rain" highpass): that was the constant hiss. Removed. Also removed the synthetic dawn chime (sfx.dawn).
- Now every ambient sound is a short recorded-style clip (ElevenLabs SFX via Fal), packed as base64 mp3 in `game/sounds-mp3.txt` (~2.1 MB, loaded only after the first tap). Sources: `assets/sounds/*.mp3`, prompts `assets/sounds/prompts.json`, regeneration `genall.py` + processing `proc.sh` (trim, highpass, light denoise, peak -1 dB, mono 32 kHz 56 kbps).
- Layers (table `L` in audio.js): crickets, frogs/toad, owl, wolf (very far, some nights only; more likely in winter), fox, nightjar (dusk/dawn), twig snaps; robin, blackbird, thrush, wren, chaffinch, tits, warbler, distant dawn chorus; cuckoo, dove, woodpecker, crows/raven/jay, bee, insects; winter birds (bullfinch, tits) and cold wind in winter.
- Each layer = a few "individuals" at fixed places (trees, pond, far forest), each with its own pitch. Calls come in bouts; a resting creature starts a bout as a Poisson process whose rate follows its activity curve (hour, season, rain), so nothing is a loop. Every night (18:00) and every morning (04:00) the creatures get a new personality (some absent, some lazy) and new places, so no two nights sound the same.
- Morning: songbirds ramp up from ~4:30; they are at 60% while the hero sleeps and get a burst (kick) when the hero gets out of bed.
- Wind: listens to `__wind.on('gust')` (crown rustle, strength = amp) and `__wind.on('creak')` (branch creaks at e.pos). No continuous leaf bed on purpose (it read as noise).
- Rain: `rain_a` (leaves) + `rain_b` (roof) beds by rainK; roof level uses `__rain.roofNear(cameraPos)` if it exists; drips after the rain.
- Interior: oven fire crackle at `__lights.pos('oven')` by `__lights.level('oven')`; plank creaks when the hero walks in the house.
- Season: `__audio.setSeason('winter')`, or `window.__season` (string or function). Default **autumn** (the reference photo is autumn): fewer insects, dry-leaf rustle on gusts, geese/cranes flying over (moving source), rare deer/elk at night, damp drips.
- 3D: PannerNode (equalpower) per voice at its world position, listener = camera; distance lowpass + shared soft reverb. Max 14 voices. AudioContext suspends when the tab is hidden.
- UI: 🔊/🔇 button (#bS) in the tools column; mute is remembered in localStorage.
- Debug: `__audio.state()`, `__audio.log()` (recent clip starts), `__audio.play('owl')`.
- Test: record the mix in headless Chromium (`--autoplay-policy=no-user-gesture-required`, MediaRecorder on `__audio.node()`); silence between calls must be true digital silence (no hiss).

## Hero actions (foley), round 2
- Packs: `sounds-mp3.txt` (forest, loaded first) and `sounds-act-mp3.txt` (hero foley, loaded second; `__audio.actionsReady()`).
- `__audio.play(name, pos?, {gain, rate, delay})` -> {stop(fade)}: one sound at pos (Vector3, [x,y,z] or {x,y,z}; default = hero chest). Random variant, pitch and level every call.
- `__audio.loop(name, pos?)` -> {stop(fade), move(pos), set(gain)}: long actions crossfaded from random parts (radio_music, sizzle, sweep, wash...).
- Names (`__audio.actions()`): kettle, tea_pour, cup, sip, chop_veg, stir, firewood_oven, oven_open, oven_close, wash, saw, hammer, sharpen, lantern_fix, match, lamp_light, stretch, yawn, write, sweep, water, bucket, window, shutter, bolt, bolt_lock, bolt_open, supplies, drawer, chest, radio_on, radio_off, radio_tune, radio_music, telescope, edge_sit, firewood_carry, firewood_drop, logs_stack, axe, step, ladder, rope_ladder, sit, stand, bed, blanket, page, book_close, tool, plank, sizzle, creak, footsteps. Aliases for the 20 approved actions: tea, chopping, stir_pot, stove_wood, dishes, sawing, nail, sharpening, fix_lantern, diary, sweeping, water_plant, door_bolt, count_supplies, radio, ledge_sit, carry_firewood, listen.
- Sync: call play() on the animation's contact frame (hammer hit, axe hit, foot down); for continuous work use loop() and stop() when the action ends.
- index.html routes `sfx.hammer` (hero.js) to the real hammer sound.

## Round 3: economy sounds, room acoustics, memory
- New foley: bow_draw, bow_release (alias bow/shoot), arrow, jacket, backpack, fridge_open/close (alias fridge), meat_pan (alias meat/fry), eat, plate, forest_steps (alias forest), door_open/close (trunk door), woodpile. `out: 1` actions (bow, forest steps) go through the outdoor bus.
- Acoustics: forest/weather sounds go through `outBus` (low-pass + gain); hero/fire/creak sounds through `inBus` with a short wooden-room reverb. `indoorK(camera)` (room centres from lights.js ROOMS, radius ~2.7 m; zoomed close counts as inside) muffles the forest to 1.5 kHz and -55%, rings the room more, and makes the roof rain louder. `__audio.state().indoor`.
- Memory/CPU: packs stay compressed in RAM (~2.4 MB); clips decode on first use and LRU-evict beyond 140 s of PCM (~18 MB at 32 kHz instead of ~70 MB). AudioContext runs at 32 kHz (index.html ac()). mp3 at 48 kbps: packs 2.2 MB + 1.1 MB.
- A first call of a not-yet-decoded action plays a few ms late (decode), then it is cached.

## Round 4: footsteps by surface, night unease
- Footsteps: boards (step_wood_*), dirt, wet (rain or <1 min after), leaves (autumn ground, 65%), ladder rungs, rope rungs (if `ctx.ropeAt(p)` is given). Surface from height (y > 0.6 = boards) + weather + season.
- Auto mode (default): watches the toe bones (`bones` passed from index.html); a foot that lifts > 5 cm above its planted height and comes back is a step, at the toe position. On slow frames (>80 ms real) it switches to cadence (0.62 s/m in game time). Climbing (|vy| > 0.25, little horizontal motion) = a rung every ~0.45 s.
- `__audio.footstep(side, pos?, {surface, gain})`: Character can drive exact contacts; the first call turns auto mode off.
- Footstep clips are decoded as soon as the foley pack arrives (they must never be late).
- Night unease layer `unease`: distant branch crack, unclear cry, metal clank, thud, wail, bushes; night only, ~0.3-1 per night, rate x (0.2 + 1.1 * __brain.need.safety). Never the same one twice in a row. `__audio.on('unease', e => …)` with {name, pos, anx}: Brain can make the hero stop and listen.

## Round 5: water, hatch, repair, sleep
- New foley (names / aliases): bucket_fill (pond, fill_bucket), slosh (carry_water; call on each step while carrying), tap (water_tap; use loop()), drip_bucket (drain_drip), bucket_dump (dump_water), hatch_open / hatch_close (hatch, trapdoor), nails (repair_nail, roof_nail), saw_shingle (shingle), bed_turn (turn_over), snore (snoring).
- Automatic while `hero.inBed`: a soft snore every 7-16 s and turning over every 35-90 s at the bed. `__audio.autoSleep(false)` hands it to Character/Brain.
- Live build: master auto-deploys to Railway (https://game-production-8358051a.up.railway.app/); the claude.ai artifact has a 200 publishes/day limit.

## Round 6: interior mix, phone cost, iOS unlock
- Roof rain is slate now (rain_slate_a/b): routed through the house bus (not muffled with the forest); level rain × max(__rain.roofNear(camera), indoorK).
- Stove crackle (fire bed) and old fridge hum (fridge_hum at ctx.fridge or (-1.43, KT+0.8, 1.38)) are steep-rolloff positional beds that are not played at all when the camera is further than 14 m / 7 m. Fridge cycles on 40-90 s / off 25-60 s.
- Phones (`mobile: MOBILE` from index.html): max 9 voices, 1.7 s forest reverb; 32 kHz context; lazy decode with LRU.
- iOS unlock: document-level touchend/click/pointerup/keydown (capture) start or resume the context and play a 1-sample silent buffer the first time; re-armed after an 'interrupted' state (calls, Siri). Works the same in Safari and home-screen (standalone) mode. The ring/silent switch still mutes Web Audio on iOS (system behaviour).

## Round 7: the hero's body (all quiet)
- Names: breath_climb, breath_heavy (breath), grunt (lift, effort), cloth (rustle), zip_up (zip), zip_down (unzip, jacket_off), sigh.
- Body sounds (breath, grunt, sigh) never overlap (1.6 s lock) and are not priority: on a full phone voice cap they are the first to be skipped.
- Automatic: breath while climbing up (every 2.2-3.4 s), cloth rustle when he sets off and every 4-9 s while walking.
- `__audio.carry(true|false)`: Character calls it when he picks up / puts down logs or a bucket; it grunts on pick-up and breathes heavier while walking with the load.
- Sigh at the telescope / ledge: Character calls `__audio.play('sigh')` when he settles.

## Round 8: the score (procedural, no samples)
- A sparse music box in A natural minor (8 hand-written lullaby motifs, rubato, octave sparkles) over a dark two-note triangle pad, through its own long reverb (3.8 s, 2.6 s on phones). All Web Audio oscillators, created per note and stopped after their decay.
- Off most of the time: a 60-120 s session may start at dusk (18:20-20:35, 70% once a day) or in a quiet moment (hero in bed / reading / sitting / at the telescope, no actions for 20 s; about once per 90 s of quiet). Then it rests 2.5-5 min.
- Ducks to 30% for 3 s under every hero sound (priority voices: actions, footsteps).
- UI: ♫ button (#bM) next to 🔊; dimmed = off, remembered in localStorage (`th_music`). API: `__audio.music(on?)`, `__audio.musicNow()` (debug).

## Round 9: phone perf and clicks
- Measured (iPhone 13 profile, rain + stove + music + footsteps + indoor camera): audio.js update() = 0.02 ms per frame on the test CPU (~0.1 ms on a phone), 7 live voices, 25 decoded clips (~70 s PCM).
- Per-frame JS trimmed: creatures decide at 10 Hz (not every frame); the listener is updated only when the camera moved (max 30 Hz; each update queues 9 automation events); music ducking only on change (it used to queue an event every frame).
- Click-free: every gain change starts from the current value (`holdGain`: cancelAndHoldAtTime or cancel + setValueAtTime) instead of cancelScheduledValues alone; mute stops voices only after the master fade. Test: second-difference spike detector on a recording (tests in /tmp; method: 2 ms windows, >18 dB above the local median) shows no spikes at mute/unmute, music on/off or camera in/out.

## Round 10: the pond
- Pond geometry: `window.__ground.pond` = {x, z, r} or {center|pos: Vector3, radius|r} (read every 0.1 s; if it appears or moves, the pond creatures re-seat). Until Ground adds it: a spot ~20 m back-left.
- Layers (all reuse existing clips, no new generation): frogs (around the pond edge, now also at dusk 18:50-20:35), `lap` (slosh clips pitched down, density follows the wind), `fish` (deep plop: drip clip at half speed, rare, mostly by day), `dragonfly` (fly clip sped up, little flights with a moving source, summer/autumn days).
- Cost: lap/fish/dragonfly are not played at all while the camera is > 45 m from the pond.

## Round 11: weather
- `weatherState()` reads `window.__weather.state()` (string or `{state}`): clear | calm | drizzle | rain | storm | mist. Until Wind ships it, the state is derived: rain level picks drizzle/rain/storm (storm also needs wind > .65), 4:48–8:30 with little wind is mist, 17:30–21:30 with little wind is calm.
- Drizzle: rain bed ×.55 and slightly higher pitch. Storm: ×1.35, lower pitch; gusts follow the wind level.
- Thunder is procedural (`thunder(dist, strength)`, also `__audio.thunder()` for testing): it arrives dist/343 s after the flash (max 12 s), a close strike (<1 km) has a crack, and a far one is a low rolling rumble of 4–9 s. It hooks `__weather.on('lightning', {pos|dist, strength})`; without those events a storm rumbles far away every 25–60 s.
- Mist: forest bus −30 % and low-passed to 4.5 kHz, songbirds ×.55. Calm evenings: only strong gusts make a sound.

## Round 12: whole-day mix review (phone profile)
Method: iPhone 13 emulation, a 12 s slice of every game hour plus rain at 22, 13 and 2, recorded from `__audio.node()`. Each voice is logged to `window.__audioTrace` (QA only) so loud and quiet stretches can be attributed to clips. `state().quiet` shows the seconds since the last creature call.
Mix targets (mix bus RMS, camera at the default orbit):
- Ambience day and night: −45 to −35 dB RMS; short-term (400 ms) peaks no higher than about −20 dB. Night sits a few dB above day, so it feels alive but tense.
- Hero foley near the camera is the foreground: up to −20 dB short-term, never clipping.
- Music is an underscore and stays below the forest: bus level .2 (was .5, which put it about 15 dB over the dusk forest).
- Silence: no stretch longer than about 7 s by day and 6 s at night without a creature (the lull guard). A rest of 3–8 s is fine: quiet is part of the mood.
- Texture layers should never read as a constant wash: pond lapping now plays every 3–8 s (it was every 1–3 s), and dew drips now come mostly at night and in the morning, not all day.
Found and fixed: music too loud at dusk; pond lapping almost constant; autumn middays and the 17:00 hand-over went 10–15 s with no life; drips in dry afternoons. Pond voices sit on the real pond from `__ground.pond` (x −8.4, z 9.2, r 2.3) and move there automatically if the pond moves.

## Round 13: house sway
- `__wind.on('sway', {part, id, pos, amp, hit?})` (Wind, fc33e5b) fires when a part turns back at the end of a swing. Parts: 'landing lantern' (a hook squeak: creak_a pitched up, short), the telescope (a pivot creak, gusts only), 'ladder-ground' and 'ladder-deck' (rope strain: fs_rope_a/b slowed). `hit` gives a knock (shutter / trunk_door_close) for future shutters. The door is Props' own (it plays 'shutter').
- Cost and taste: each id sounds at most once every 1.3–2.4 s, there are at most ~3 sway sounds a second overall, and swings below .12 are skipped. Larger swings are more likely to creak. Amp is scaled by the wind level, so a breeze creaks softly and a storm creaks hard.
- Positional on the forest bus, so the room muffling (−55 % and a 1.5 kHz low-pass indoors) applies by itself. `__audio.sway(e)` plays one by hand for tests.

## Round 14: daytime critters
- There are no clips: Fal was not available. Synthesized buffers made in code (`synth(kind, variant)`): peck (2–4 band-passed taps), hop (soft thuds with a leaf tick), flutter (band-passed noise gated by slowing wingbeats, 24→14 Hz), claws (grouped scratch ticks on bark), chitter (chucks sweeping 4.3→2.5 kHz with breath noise, speeding up at the end). Each is low-passed at 6.5 kHz so nothing is bright or beepy. There are 2–3 variants per kind; they are made on first use and kept in `SYN`, about 0.8 MB, and are never evicted.
- Event: `__ground.on('critter', {kind:'bird'|'squirrel'|'butterfly', act:'hop'|'peck'|'chitter'|'climb'|'flee'|'land', pos, id, dur})`, or `__audio.critter(e)`. When a squirrel flees you hear claws, not wings. Butterflies are silent. Per-critter limits: a hop every .12 s, a peck every .1 s, a chitter every 3 s, a climb every .9 s, a flee every .8 s. Anything over 30 m from the camera is dropped. Positional on the forest bus, ref 2.5 m.
- QA (gpt-audio, blind): it heard peck, flutter, chitter and claws as intended. It rated hop and peck as partly matching.

## Round 15: rooms and surfaces
- Room centres had been 1 m too low because the index.html levels include HY = 1.0. They are now KT 6.0, BD 8.4 and WS 4.6.
- `roomOf(pos)` picks the room a sound is in, and each room has its own colour (ROOMC). The kitchen rings brightest (room send ×1.3). The bedroom is soft: send ×.5 and a 4.8 kHz low-pass for the quilts and bunks. The workshop sits between (×1, 9 kHz). An "indoor" sound that is in no room (deck, landings, ladders, the roof) is moved to the forest bus with forest reverb, so it sounds like open air.
- Footstep surfaces are boards, dirt, leaves, wet, ladder, rope, and now roof. Standing on either roof (the ROOFS rects from buildTree) gives a lighter, higher wooden step, and 45 % of steps add a loose-shingle tick (the synth peck). Water already split before: the pond bucket is outdoors with forest reverb, and the sink tap is in the kitchen, which now rings.
- Critters (Ground 35336db): verified in game, bird hops arrive and play. The cut-off went from 30 m to 45 m (ref 4 m) because the default orbit camera is about 38 m from the critters. They stay faint there and get clear when zoomed in.
- CPU (iPhone 13 profile, headless): update() takes 0.008–0.010 ms per frame. The synth buffers are built once on first use and are about 0.8 MB.

## Round 16: house actions and night critters
- `houseWatch()` reads the real state every frame, so a sound is right whoever moves the thing:
  - Hatch: `__house.hatch.isOpen()` flips → hatch_open or hatch_close at the ring. The hero's own 'hatch_open' call counts too, and the two are de-duplicated within 1.5 s.
  - Door bolt: `__props.door.bolt` crosses .5 → bolt_lock or bolt_open at the bolt knob. `play('bolt')` is now a no-op, because it used to pick lock or unlock at random.
  - Dishes: plates leaving the rack (`dishes.state().rack` drops) → staggered plate and cup clacks at the sink.
- Task foley while the hero works at a job (task set, standing still, 1.5 s in), from the TASKF table:
  - dishes: tap and wash loops, plus plate and cup clacks
  - fix_rope: rope creaks
  - fix_hinge: a squeak that fades as the oil works
  - fix_window: window and plank sounds
  - clear_roof: leaves and sweeping
  - fix_chimney: stones (logs_stack pitched up) and a grunt
  - fix_shingle: plank and saw_shingle
  - board, wall and railing: plank
  The existing hero.js nails every 1.3 s still play on top of this. For tests, `__audio._task(name)` forces a task.
- Night critters (Ground): hedgehog step, sniff, curl, uncurl, appear and leave; mouse step, flee, dash, appear and leave. The mouse squeaks half the times it flees. Two synth sounds were added: sniff (snuffling puffs) and squeak (a short 3.8–4.7 kHz chirp). The blind QA heard both as intended.
- Sway: each object now creaks at most once every 2.5–5 s. At 1.3–2.4 s the ladders creaked too often in a normal breeze.

## Round 17: curtains, lockdown boards and sleep
- New actions for Tree, Props and Brain to call with `__audio.play(name, pos)`:
  - `curtain`, `curtain_close`, `curtain_open`: cloth, plus a synth "rings" run of metallic ticks along the rod.
  - `shutter_close` (the shutter clip) and `shutter_open` (window_open).
  - `board_up`: a plank, then three nails.
- When Tree adds lockdown shutters or boards, call these at the moment each one moves.
- Sleep: each night has its own sleeper. On 55 % of nights he snores, in spells of 1.5–5 minutes with quiet stretches of 2–7 minutes between. Outside the snoring spells he takes a slow synth breath every 4–5.5 s (in 1.4 s, a pause, out 2 s, band-passed around 520 Hz, very quiet), and only when the camera is within 8 m of the bed. He still turns over every 35–90 s.
- Awake: when he stands still and the camera is within 3.5 m of him, he breathes softly, a faster version of the same breath every 3–4 s.
- The blind QA heard the rings as curtain rings on a rod and the breath as slow, soft breathing.

## Round 18: sleep check and a second full-day pass
- Sleep was checked live by reloading until the random start put the hero in bed (2:00). With the camera by the bed, the slow synth breaths play every 4–5 s. Snoring spells follow the per-night draw.
- Full day on the phone profile, after rounds 11–17:
  - Every hour falls between −52 and −31 dB RMS, with short-term peaks at −26 dB or below.
  - The longest silence is 8.6 s.
  - The one point over target was the owl at 25 m: −18.8 dB short-term. Owl volume went from .5 to .32 (−4 dB).
  - 1–2 a.m. sat at about −51 dB. Autumn crickets went from .3 to .4 so the deep night is quiet but never empty.
- The curtains are animated by lights.js (dusk half-drawn, lockdown shut). Lights has the `curtain_*` names to call.

## Round 19: footstep sync with the new hero, rung contacts, hand contacts
- The new hero lifts the heel only 4–6 cm, so contact by toe height missed steps. A step is now detected when the swinging foot comes to a stop: its world speed falls from over max(1.1, 1.5×walk) to under max(.3, .3×walk). In swing the foot moves at 2–3 m/s; planted, it is still. The strike is predicted from the deceleration, so the sound is scheduled inside the frame (`step(..., delay)`) rather than a frame late. Each foot can strike at most once per .3 s. Frames where the pose did not advance (the foot only rode along with the root) are skipped. The pre-roll for slow frames below 12.5 fps is unchanged.
- Ladder and rope rungs: a rung sound plays when a foot that was travelling vertically faster than .55 m/s settles below .12 m/s. If the bones give no signal for 1.2 s, it falls back to the old cadence.
- QA: `node tests/audio/feet_sync.js`, then `python3 tests/audio/feet_sync_report.py /tmp/feet_30.json`. This runs on the virtual clock at 30 fps with the route cook, wash, craft, look, window, read, telescope.
  - Result: median offset of −8 ms against the moment the foot stops (heel strike), with 90 % of steps within roughly −60..+10 ms.
  - About 7 % of contacts are missed. About 18 % of steps are "extra"; these are mostly real small re-plants when he starts, stops or turns.
- Hand contacts are read from state:
  - the oven door (`__props.oven.open` crossing .15 or .08) plays oven_open or oven_close at the handle;
  - a hand taking a tool or item (`hero.hold[hand]` changes) plays tool_pickup, and putting it back plays it softer and lower;
  - the hatch ring and the door bolt were already wired in round 16.

## Round 20: footstep sync on the original hero, plus shuffles
- The original hero is the default again; the new hero loads with `?hero=new`. Same detector, re-verified with `tests/audio/feet_sync.js` (30 fps, virtual clock).
- Small re-plants (turning, starting, stopping) now play a soft scuff instead of a full step: 30 % of the gain, 0.1–0.16 s long, and they don't duck the music. A step counts as a re-plant when the foot's peak swing speed (median of 3 frames, so a one-frame foot snap doesn't count) stays under max(1.6, 1.9×walk).
- Feet are now tracked down to walking speed .12 instead of .25, which catches the first and last steps of a walk.
- `feet_sync_report.py` now counts full hits, soft hits, misses and extra full steps separately. Result on the original hero, both feet:
  - 90 strikes, 70 hit by a full step and 15 by a shuffle, 5 missed (5.5 %).
  - 9 extra full steps out of 79 (11 %, previously 13–18 %).
  - Timing: median −6 to −23 ms, p10 −53 / −39 ms, p90 +6 / +10 ms.
