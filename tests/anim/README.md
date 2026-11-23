# Animation QA (frame-by-frame test of the hero)

Owner: the Animation QA thread. Results and the issue list: `ANIM-QA.md` at the repo root.

```
node tests/anim/run.js --out /tmp/anim-qa          # ~5 min: whole day + every task, exit 1 if any P1/P2 issue
node tests/anim/run.js --out /tmp/anim-qa --max-p 1  # fail only on P1
node tests/anim/shots.js --in /tmp/anim-qa         # ~15 min: storyboards + clips of the worst moments (SwiftShader ~3 s/frame)
```

How it works
- `lib.js` opens `game/index.html` in headless Chromium straight from disk (no server). `Math.random` is seeded, and
  `performance.now` / `requestAnimationFrame` are virtual: the clock stands still while loading, then frames run only in
  `__qa.step(n, 1/60)`. The same seed gives the same day frame for frame, so `shots.js` can replay and photograph it.
- `simulate.js`: from 06:30 the hero lives 25 game hours on his own, then every task he skipped is forced once.
- `sampler.js` (runs in the page) samples every frame: 21 bone positions, pelvis rotation, root, yaw, clip and its
  playback speed, flags (seated, in bed, swing, ladder, path), and about 3,000 skin vertices. Each vertex is tested against the
  world: every box/cylinder/sphere mesh exactly, every other furniture mesh voxelised at ~1.2 cm with a distance transform,
  the trunk with the game's own bark cross-sections. Result: the deepest skin point per body part (head, hands, feet, shins,
  hips, arms, torso), in cm, and what it is inside.
- `analyze.js` turns that into issues. All thresholds are in `LIMITS`:
  penetration, per-frame jumps (second difference), snap turns, joint limits (knee folded or bent the wrong way, foot above the hip,
  foot near the head), foot sliding while planted, jitter (oscillation of 5 Hz or more while still), detours, sharp turns, crab walking, and
  tempo (walking speed, sit/stand duration, ladder speed, clip playback speed).
