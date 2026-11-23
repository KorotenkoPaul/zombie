# Character thread notes (WIP checkpoint, 2026-11-23)

Status: **work in progress, not merged to master.** Branch `wip/character`.

## Findings (measured in headless Chromium)
- **Feet sink into the floor:** floor boards are 7 cm thick and centred on the level height (BD, KT, ...),
  so the walkable top is level + 0.035 m, but the hero's root walked at the level itself. Feet sank ~3.5 cm everywhere.
- **Sinking into the chair:** chair seat top is BD+0.434 (raycast). Clip 33 puts the hip joint 0.55 m above the soles;
  the old fit put the hip joint only ~8 cm above the seat and the root 3.6 cm below the floor.
  Hip joint should be ~0.11 m above the seat; feet then need leg IK (the chair is lower than the clip expects).
- **Lying on the bed edge:** old code hard-coded `N.bed.p = bb.min.x + .38` and used clip 371 paused at 60 %.
  Lower mattress top is BD+0.555 (raycast). Clip 267 is a proper flat lying pose (hips 0.15 above root, head toward local -z).
- **Jerks:** root-motion clips were snapped at their end (`p.add(...)` + `snapPlay` = hard cut, no blend);
  turn-in-place clips 576/586 rotate the hips while code also rotates the root (double turn);
  `stop()` before play in snapPlay = pose pop.
- Clip analysis (hips/toes/hands per clip) is reproducible with an in-browser sampler; key numbers:
  idle 0 hips .83; walk 30 in place; sit 33 hips (0.19,.55,-0.28); 57 stand->sit root travel (0.03,-,-0.35);
  53 sit->stand travel forward ~0.4; 435 pull-up travel y +1.40 (with hips glide .98->.87), z +1.06.
- Skeleton has no finger bones: page turning must be arm IK + an animated page mesh.
- Network: this session could not reach fal (queue.fal.run, fal.media), cdn.jsdelivr.net or api.meshy.ai (proxy 403).
  For headless tests, three@0.160.0 and rapier 0.12.0 were served from local node_modules via Playwright page.route.

## What is in this branch
- `game/hero.js`: all hero code moved out of index.html (`createHero(ctx)`), index.html calls `HH.update(dt)`.
  - Root-motion extraction: hips XZ removed from every clip; RM clips (57, 53, 435, 184) feed their travel to the root
    every frame, so crossfades never jump.
  - Root stands on real board tops (Rapier ray down), leg IK keeps feet on the floor when sitting.
  - Chair/bed spots derived from raycasts on the real props (survives furniture moves).
  - Walk speed measured from the walk clip stride (no foot sliding), curved corners, turning steps instead of 576/586.
  - Needs-based routine (energy, hunger, fun, tidy) with lingering/stretch/look-around between activities.
  - Activities with held items: read (book with turning page, hands IK), craft (take hammer from pegboard, hammer, put back),
    cook (bend + oven door via `window.__props.ovenDoor.setOpen(k)` if Props provides it, then stir with spoon),
    tea (mug from counter, sip clip 342), wash (plate + scrubbing hands), look (deck), window, sleep (sit on edge -> swing into 267).
  - Head look-at toward what the hero is busy with.
- **Not yet verified.** First smoke test loads without JS errors, but at start the hero re-plays sit-down (57)
  from standing instead of starting seated: the initial-state block at the end of createHero calls MAKE.read(),
  whose goTo() fires sitDown immediately. Fix: build the read activity without goTo for the start state.

## Next steps
1. Fix the start state, then verify each activity with close-up screenshots (sit, bed, feet, ladders).
2. Check IK poles (elbows/knees direction), book position vs table, mattress lying spot / pillow side (bedHead).
3. Ladder down still uses the pull-up played backwards: get a real "climb down over edge" clip from fal (Meshy library).
4. With fal working: fetch reading/cooking/crafting/sleeping/wake-up base clips (Meshy rigging, `animation_action_id`),
   add to hero.glb with pipeline/pack.mjs, refine with the IK layer already in hero.js.
5. Merge to master, republish the artifact https://claude.ai/artifact/Ro32b6Sg7VRcXuuKDEq85d (files: game/*.txt, *.jpg, *.png, hero.js).
