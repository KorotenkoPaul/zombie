# Hero redesign (2026-11-23)

**Status: Pavel rejected the new hero (too adult) the same evening. The ORIGINAL hero is the default again (game/hero-glb.txt); the redesign loads with `?hero=new` (game/hero-new-glb.txt, assets/models/hero-new.glb). File names below that say hero-old now mean the default hero.**

Pavel: the first hero looked too cartoony for the world. New hero = concept 1 "quiet survivor" (rust knitted sweater, scarf, belt with pouch, fingerless gloves, canvas trousers, boots, no quiver/jacket on the body).

## Files
- `game/hero-glb.txt` / `assets/models/hero.glb`: new hero (14.2k tris body + 200 tris eyelids, one material, 2048 webp, quantized).
- `game/hero-old-glb.txt` / `assets/models/hero-old.glb`: the first hero, loaded with `?hero=old` (index.html picks the file). Its original full-res source is in git history (dcfaf5b).
- `assets/refs/hero-ref.png` new concept; `hero-old-ref.png` the old one. Concepts: project files `hero2/`.
- `pipeline/hero2/`: concepts.py (nano-banana-pro/edit) -> mesh.py (Meshy v6 image-to-3D, 22k) -> rig.py (Meshy rigging, mixamo) ->
  `node transplant.mjs hero-old.glb rig.glb new.glb` -> `slim.mjs new.glb slim.glb 0.62 <clip names to keep>` -> `lids.mjs` -> `tex.mjs` -> `quant.mjs`.

## Same skeleton
transplant.mjs keeps the OLD glb as the container: the same nodes, rest pose, inverse bind matrices and Meshy clips. Only the mesh is replaced:
the Meshy-rigged mesh is posed from its own bind pose onto the old skeleton (per bone: swing that aligns bone directions + stretch along the bone),
weights remapped by bone name, normals smoothed by welded position. So hero-moves (hy_*), motion matching DB, IK and collide work unchanged.

## Eyelids (for sleep / blinking)
A separate skinned mesh `eyelids` (bound to Head, same material) with morph targets `blink` (both), `blinkL`, `blinkR`; 0 = open (lids collapsed under the brow, invisible), 1 = closed.
`hero.root.getObjectByName('eyelids')` -> `m.morphTargetInfluences[m.morphTargetDictionary.blink] = v`. The old hero has no eyelids: check for null.
Eye placement for a new face: run `facescan.mjs` (front texture render of the head, face.png) and pass eye centres/size to lids.mjs.

## Eyelids on the original (default) hero
Added the same way: `deq.mjs` (dequantize; mesh space is normalized, y -1..1 = 0..1.6 m) -> facescan (RES=.001 XW=.125 Y0=.75 Y1=1.03) ->
`lids.mjs old-dq.glb out.glb '{"L":[-0.0535,0.7985,0.072,0.036],"R":[0.0515,0.797,0.068,0.037],"skin":[-0.05,0.765],"lash":[-0.06,0.82],"off":0.0028,"ymin":0.7,"pow":0.4,"flat":1}'` -> quant.mjs.
Lid UVs must not be all identical (quantize breaks a zero-range attribute), hence the tiny jitter in flat mode.
