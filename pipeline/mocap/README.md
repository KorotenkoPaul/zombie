# pipeline/mocap: FBX mocap (Rokoko, Mixamo) -> hero clips

Licences and sources: /mnt/project-files/mocap/REPORT.md (project files). Only commercial-OK sources go into the game.
Raw packs and the full retargeted libraries stay in project files (clips/rk/), NOT in this public repo: the Rokoko packs
(Anderson Rohr) and Mixamo forbid redistributing the raw files. Only clips the game actually plays go into game/hero-moves.txt.

1. `node fbx2hero.js OUTDIR a.fbx b.fbx ...` converts each FBX (first animation) to the hero clip format
   `{fps:30,frames,tracks:{Bone:[x,y,z,w..]},hips:[x,y,z..]}` by copying world rotations onto the hero's Mixamo bones
   (rest offsets aligned per bone direction). Rokoko_Default skeletons use frame 0 (their T-pose) as the rest pose;
   Mixamo files use the node rest pose. Needs /tmp/w/hero.glb and /tmp/w/node_modules (three) like pipeline/clips/render.js.
2. `node ../clips/norm.mjs in.json out.json 0.034` drops the Rokoko T-pose frame, faces +Z, hips at x=z=0.
3. `node floorfit.mjs hero.glb out.json out.json` sets the hips height so the lowest foot point touches y=0.
4. QA and renders: `../clips/fk.mjs`, `../clips/render.js`.
