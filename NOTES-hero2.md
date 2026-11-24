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

## Phone cost of the default hero (2026-11-23)
`optim.mjs in.glb out.glb 0.66`: the metal/roughness map is gone (roughness was 0.66 ± 0.07 and metal 0 everywhere, so now it is a constant factor),
and skin joints no vertex uses are dropped (body 28 -> 23: HeadTop_End, HandMiddle4 x2, Toe_End x2; eyelids 28 -> 1: Head). The bone NODES stay, so clips and hero.js lookups are unchanged.
Before/after render diff: mean 0.1-0.4 of 255. Textures 3 -> 2 (base colour + normal map, 1024 webp).

## Detailed version of the original hero (?hero=detail, 2026-11-23)
Pavel: keep the original look but more detailed, less "anime". Concept: detail.py (same character, more detail, no quiver) -> dface.py (less anime face, strand hair) -> dmesh.py multi (Meshy v6 multi-image-to-3d, front + back, PBR) -> rig.py ->
`KEEP_NORMAL=1 ROUGH=.65 node transplant.mjs old-dq.glb rig.glb out.glb` (keeps Meshy's normals + its normal map; smoothing normals breaks the normal map) -> slim 0.72 (18k tris) -> lids (L -0.0505/.8175, R .0475/.8175 in normalized space) ->
`ktxtex.mjs in out 2048 1024` (base colour KTX2 ETC1S 2048, normal map webp 1024) -> quant -> optim. index.html now gives the GLTFLoader the KTX2 loader.
GPU texture memory ~8.4 MB (vs 11.2 MB for the current default), download 2.79 MB (same as default). Body 18k tris (default 12.5k).
Vest and boots are separate skinned meshes (`split.mjs`, after slim, before lids): nodes `vest` and `boots` (same skin + material) toggle with `.visible`.
The body underneath has a knitted sweater layer (vest triangles inset 1.4 cm along welded normals, sweater texels) and wool socks (boot triangles pulled 36% toward the foot bones); both taper to zero where they meet the body, so no cracks.
Classification: per-triangle texel colour + dominant bone (torso & not sweater/skin/green -> vest; feet, or shin & leather -> boots), majority smoothing over welded adjacency.
Tris: body 18k (incl. layers), vest 2.8k, boots 3.1k.

## Concept 6 hero (?hero=v6, 2026-11-24)
Pavel picked concept 6 ("нынешний, обновлённый": same palette as the original hero, more charming stylised proportions and richer clothes) from project files `hero-concepts/`.
Only the look changes: same skeleton, rest pose, IBMs and clips (transplanted onto the pre-optim default, git 39ba715), so hero.js, moves, IK, collide and the gate work unchanged.
Pipeline (same as ?hero=detail): concept sheet -> nano-banana-pro/edit clean A-pose front (no quiver/strap; the bow lives on the wall) + back view (`assets/refs/hero-v6-ref.jpg`) ->
Meshy v6 image-to-3d (front only gave the better face than front+back; 30k, PBR) -> Meshy rigging -> `KEEP_NORMAL=1 ROUGH=.65 transplant.mjs old-dq.glb rig.glb` ->
`slim.mjs 0.62` -> remove the old eyelids node -> `BT=.015 CAP=.03 CR=0 split-v6.mjs` (vest, boots; thin dark wool socks: the boots have deep creases down to the bone, so the old inset socks showed through as yellow patches) -> facescan (RES=.0008 XW=.13 Y0=.68 Y1=1.0) ->
`lids.mjs '{"L":[-0.064,0.769,0.062,0.034],"R":[0.062,0.768,0.06,0.033],"skin":[-0.064,0.744],"lash":[-0.07,0.808],"off":0.0028,"ymin":0.7,"pow":0.4,"flat":1}'` ->
`shrink.mjs in out 0.9 0.9` (head and hands 10% smaller around their centres, weight-blended: the first gate run had the big hair 2.6 cm deeper into ceilings/frames and hands 1-2 cm deeper into props) -> `ktxtex.mjs 2048 1024` -> quant -> `optim.mjs 0.65`.
Result `assets/models/hero-v6.glb` / `game/hero-v6-glb.txt`: body 19.3k tris (incl. sweater/sock layers), vest 2.7k, boots 2.0k, eyelids 200; KTX2 base colour 2048 + webp normal 1024; 2.99 MB.
Gate: run with Q.old='?hero=v6' (a temp copy of gate.js) next to a plain run on the same master and compare regression counts.

v6 head fit (2026-11-24, integrator's full gate: head P1 into ladder openings/beam/bunks 92 -> 140): the concept head + hair was 35% wider and 45% deeper than the previous hero's.
Now after split: `shrink.mjs 0.9 0.9` -> `headfit.mjs in out '[0.76,0.86,0.6]' '[0,0.66,0.05]' '[-0.01,0.85]' (the face relief in front of z=-0.01 keeps 0.85 depth so nose and chin keep their profile)` (x/y/z scale about the face front at skull base, weight-blended) so the head's 1-99% box is inside the previous hero's
(x -0.131..0.132 vs -0.127..0.126, z -0.148..0.090 vs -0.160..0.112 (face pulled back: the first fit still had the face 2.5 cm into the hatch-ladder rungs), top 0.94 vs 1.0 in old-dq space) -> facescan (RES=.0006 XW=.1 Y0=.66 Y1=.9) ->
lids '{"L":[-0.0454,0.7575,0.039,0.025],"R":[0.0386,0.7554,0.039,0.025],"skin":[-0.045,0.732],"lash":[-0.043,0.786],"off":0.0022,"ymin":0.68,"pow":0.4,"flat":1}' -> ktxtex -> quant -> optim.
Measure heads in the transplant (old-dq) space, not after quant: quantize renormalises each mesh to its own box.

v6 face v2 (2026-11-24, integrator: face not at concept quality: asymmetric, bumpy, orange, thin angry brows):
new Meshy v6 image-to-3d with `symmetry_mode:"on"` and a texture_prompt (smooth light peachy skin, round cheeks, thick straight brows) -> same chain
(rig, transplant, slim, rmlids, `UMIN=.3 BT=.015 CAP=.03 CR=0 split-v6.mjs`, shrink 0.9/0.9, headfit, lids '{"L":[-0.0466,0.759,0.042,0.026],"R":[0.0365,0.7566,0.042,0.026],"skin":[-0.0466,0.732],"lash":[-0.046,0.792],...}')
-> `facesmooth.mjs in out 0 0.06` (face skin: smooth normals, flat normal map, softened and lightened base colour; position smoothing (iters>0) erased the nose, so 0) -> ktx/quant/optim.
Comparisons: project files hero-v6/.

### v6 face v3: separate high-res head grafted at the neck (2026-11-24)
- Head: Meshy image-to-3d from a bust render of concept 6 (soft smile, normal eyes with lids, smooth skin); unrigged, y-up, face +z, 23k verts.
- `graft.mjs body.glb head.glb out.glb '{"s":0.205,"chinIn":-0.5,"chinOut":0.625,"zc":-0.024,"cut":0.6,"ycut":-0.7}'`
  - cuts the body's Head/Neck-weighted triangles above y=cut and compacts the vertex buffers (orphan verts would count as probes in the gate sampler);
  - scales the head uniformly (s), puts raw chin y=chinIn at y=chinOut, drops the bust shoulders below raw y=ycut;
  - skins it Head 1 above the chin, smooth blend to Neck below;
  - adds it to Mesh_0 as TWO primitives (x<0 / x>=0) with a material "head": hero.js picks the body as the LARGEST skinned mesh (sock/vest shader), so each head part must stay smaller than the body primitive (15.2k verts). Simplifying the head instead broke the face shading and the neck.
- v3.1 (after the integrator's review): graft params cut 0.58, ycut -0.76, so the head's own neck reaches into the sweater collar and covers the body's neck stub (no light seam strip). cut 0.55 opened a see-through gap at the front of the collar.
- `F=0.5 node skintone.mjs G.glb Gt.glb`: the body's hand/neck skin pixels (UV islands of Hand/Neck/Head-weighted triangles, skin-coloured only) get a per-channel gain halfway toward the head's cheek colour, so hands and neck match the face. REF=neck uses the head's neck instead.
- Body input: split-v6 output with hands 0.9 (`shrink.mjs sp13.glb sh13.glb 1.0 0.9`).
- Lids: `PRIM=1,2 node lids.mjs G.glb GL.glb '{"L":[-0.0388,0.7415,0.047,0.031],"R":[0.0412,0.7415,0.047,0.031],"skin":[-0.06,0.735],"lash":[-0.0388,0.7535],"off":0.0016,"ymin":0.68,"pow":0.33,"flat":1}'` (PRIM = comma list of primitives to ray-cast; facescan.mjs takes PRIM too).
- `HEADS=1024 node ktxtex.mjs GL.glb K.glb 2048 1024` (head base colour 1024), then quant + optim 0.65. Asset 5.3 MB base64.
- Head box (pre-quant): x ±0.137, y 0.61..0.92, z -0.156..0.107 (old hero 99%: x ±0.127, top 0.99, z -0.160..0.112).

### v6 face v4: head 1.5x (concept proportions) (2026-11-24 17:30 UTC)
- Pavel saw no difference in the game: at the game camera the hero is ~65 px tall (home view) / ~190 px (closest zoom), the face only 8-30 px, and the body palette and proportions were the same as the old hero. Concept 6 reads by its big head (~22% of the height, ours was 14%).
- The head is now 1.5x the boxed head: `bash pipeline/hero2/build-v6-head.sh 1.5 out.glb 0.60 -0.05` (run in the work dir with sh13.glb / hd-single.glb; lids are scaled with K). Pre-quant head box x ±0.206, y 0.60..1.045, z -0.248..0.147.
- Gate on the same stand (master 827fed4 vs the same + this asset): P1 225 -> 214, head penetrations 11 -> 13 with the same max 3.1 cm, no new HARD.
