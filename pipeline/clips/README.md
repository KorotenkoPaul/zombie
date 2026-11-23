# pipeline/clips: hero clip supply (CMU mocap first, Fal Hunyuan only where no mocap exists)
1. Download ASF/AMC from mocap.cs.cmu.edu/subjects/<s>/ into /tmp/w/cmu.
2. `node cmu2hero.mjs --srcfps 120|60 hero.glb s.asf ret/ s_xx.amc ...` (this copy takes the capture rate: subjects 62, 77, 79, 80 are 60 fps).
3. `node norm.mjs ret/s_xx.json n_s_xx.json` (face +Z at frame 0, hips at x=z=0).
4. `node build.mjs recipes.json out/` builds the delivered clips (trims, mirror, layered legs+upper body that keeps the chest upright).
5. `node fk.mjs hero.glb out/x.json fk.json` QA metrics; `python3 sheet.py fk.json x.png 10` contact sheet.
Paths inside the scripts assume /tmp/w as the work dir. Delivered clips: assets/clips/ and /mnt/project-files/clips/ (CLIPS.md).
