# Hero redesign (2026-11-23)

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
