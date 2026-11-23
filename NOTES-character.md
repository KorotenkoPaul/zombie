# Character thread notes (2026-11-23)

## How the hero moves now
- **Base motions from text (Fal):** `fal-ai/hunyuan-motion` (~$0.08 per clip) turns an English description into a full-body
  human motion (SMPL-H). `pipeline/motion/` retargets it onto the hero's Mixamo skeleton and packs the chosen clips into
  `game/hero-moves.txt` (JSON, ~1.3 MB). index.html fetches it and passes it to `createHero({moves})`; hero.js turns it into
  three.js clips named `hy_*` next to the Meshy ones (walk 30, ladders 437/435, turns).
  - `gen.py prompts.json outDir seeds [names]` -> raw motions (output_format "dict").
  - `retarget.mjs hero.glb raw.json out.json` -> per-bone local quaternions + hips path (keypoints are root-relative: add `transl`).
  - `pack.mjs moves.json clipsDir game/hero-moves.txt` -> selection, trimming, loop-seam blending, 3-decimal quantisation.
  - Prompts and the seeds that were picked: `prompts.json`, `prompts2.json`, `moves.json` (src = name-seed).
  - Text-to-motion is bad at bed transitions (rolls on the floor); those are done in code.
- **Clips in use:** hy_idle, hy_read (reading, leaning in), hy_sitidle (pause, book on lap), hy_sitdown / hy_standup (root motion),
  hy_oven (bend, open the oven), hy_stir, hy_hammer, hy_wash, hy_drink, hy_sleep, hy_stretch (after waking).
  Spare: hy_read2, hy_take, hy_saw, hy_inspect.
- **Seat / bed fit (`H.fit`):** the root is placed so the hip joints sit SEAT_CLEAR (12.5 cm) above the real chair seat or
  LIE_CLEAR above the mattress (props.js `surfaces`), blended by how far the hips have travelled while sitting down / standing up.
  Seated: each ankle is IK-planted at its standing height above the boards, then the toes are lifted out of the floor (`legPlant`, `toeGuard`).
- **Bed:** sit on the front edge (head clear of the upper bunk), hold the first frame of standing up, then a 2.8 s swing
  (pose blend into hy_sleep + root slide/turn) onto the middle of the lower mattress, head on the pillow (+x). Morning: swing back
  to the edge, sit a moment, stand up, usually stretch.
- **Real props (props.js, `window.__props`):** the table book is taken into the hands and held in front of the face; the right hand
  lifts the page corner and carries the page over (`book.turn`), index.html passes `reading:false` so props never auto-turns.
  The bench hammer is picked up (`P3.grab`) and put back. The oven door opens with the hand on `oven.handle()`.
- Checked in headless Chromium (tests/hero_moves.js, plus in-page fast-forward with `HH.update`): max hips jump between frames
  ~1 cm (sit/stand/oven), toes >= 3.5 cm above the boards in every activity, nav paths clear of the stove and basket.

## Known / next
- Lie-down mid-swing pose is a blend, not a captured motion: legs lift a bit stiffly. Could be replaced by a code-posed key frame.
- Book page text faces the reader but small hand/cover overlap is possible when the clip's hands drift.
- Ladder down still uses the pull-up played backwards.
- Headless SwiftShader renders this scene at < 1 fps: fast-forward the hero with `__dbg.HH.update(1/30)` in a loop, then screenshot.

## Hooks from other areas (to use in tasks)
- Lantern fix (Lights): __lights.attachHand(heroBones.RightHand); __lights.set('hand',true) ... when done __lights.set('hand',false); __lights.detachHand().
- Hatch (Tree): __house.hatch {ladder:{top,bottom},grab,isOpen(),open(),close()}; route() blocks the ladder edge while closed. MAKE.hatch({open}).
