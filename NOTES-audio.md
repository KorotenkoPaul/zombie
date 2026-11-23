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
