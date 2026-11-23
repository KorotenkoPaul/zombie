# Hero watch (visual review of the hero)

Owner: the "Постоянно следить за движениями героя" thread. Findings: `HERO-WATCH.md` at the repo root.

```
node tests/watch/watch.js --out DIR --tasks pot,hammer,hatch [--view hands] [--every 10] [--calm 45] [--max 45]
python3 tests/watch/judge.py DIR/NN_task [--models gpt-5.5,o3] [--per 12]
```

- `watch.js` replays the game in headless Chromium (tests/anim/lib.js: seeded, virtual clock), asks the brain for each
  task and films the walk there, the work and the exit. The camera picks the clearest angle around the hero by raycasting
  (no walls in front), keeps it steady and re-picks only when blocked. `--view hands` frames the hands (grip checks).
  Fast mode (default) renders without post effects, far plane 18 m, forest canopy hidden: ~2.8 s per frame on SwiftShader.
- `judge.py` builds numbered contact sheets (12 frames, labelled frame / task / clip) and asks several vision models
  for animation defects as JSON (`judge.json`). Fal is the second provider when it has credits.
