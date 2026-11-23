# Sound / ambience (game/audio.js)

- The old ambience was two looping white-noise generators in index.html ("wind" bandpass 380 Hz and "rain" highpass): that was the constant hiss. Removed. Also removed the synthetic dawn chime (sfx.dawn).
- Now every ambient sound is a short recorded-style clip (ElevenLabs SFX via Fal), packed as base64 mp3 in `game/sounds-mp3.txt` (~2.1 MB, loaded only after the first tap). Sources: `assets/sounds/*.mp3`, prompts `assets/sounds/prompts.json`, regeneration `genall.py` + processing `proc.sh` (trim, highpass, light denoise, peak -1 dB, mono 32 kHz 56 kbps).
- Layers (table `L` in audio.js): crickets, frogs/toad, owl, wolf (very far, some nights only; more likely in winter), fox, nightjar (dusk/dawn), twig snaps; robin, blackbird, thrush, wren, chaffinch, tits, warbler, distant dawn chorus; cuckoo, dove, woodpecker, crows/raven/jay, bee, insects; winter birds (bullfinch, tits) and cold wind in winter.
- Each layer = a few "individuals" at fixed places (trees, pond, far forest), each with its own pitch. Calls come in bouts; a resting creature starts a bout as a Poisson process whose rate follows its activity curve (hour, season, rain), so nothing is a loop. Every night (18:00) and every morning (04:00) the creatures get a new personality (some absent, some lazy) and new places, so no two nights sound the same.
- Morning: songbirds ramp up from ~4:30; they are at 60% while the hero sleeps and get a burst (kick) when the hero gets out of bed.
- Wind: listens to `__wind.on('gust')` (crown rustle, strength = amp) and `__wind.on('creak')` (branch creaks at e.pos). No continuous leaf bed on purpose (it read as noise).
- Rain: `rain_a` (leaves) + `rain_b` (roof) beds by rainK; roof level uses `__rain.roofNear(cameraPos)` if it exists; drips after the rain.
- Interior: oven fire crackle at `__lights.pos('oven')` by `__lights.level('oven')`; plank creaks when the hero walks in the house.
- Season: `__audio.setSeason('winter')`, or `window.__season` (string or function). Default summer.
- 3D: PannerNode (equalpower) per voice at its world position, listener = camera; distance lowpass + shared soft reverb. Max 14 voices. AudioContext suspends when the tab is hidden.
- UI: 🔊/🔇 button (#bS) in the tools column; mute is remembered in localStorage.
- Debug: `__audio.state()`, `__audio.log()` (recent clip starts), `__audio.play('owl')`.
- Test: record the mix in headless Chromium (`--autoplay-policy=no-user-gesture-required`, MediaRecorder on `__audio.node()`); silence between calls must be true digital silence (no hiss).
