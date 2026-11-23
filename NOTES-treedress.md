# Tree dressing: notes (2026-11-23)

Owner: tree dressing thread. Code: `game/treedress.js`, `createTreeDress()` called in index.html right after props (boards exist by then).
Debug: `__treedress.stats()`.

## What it does
- Bark shader: chained onto `TREE.bark.material.onBeforeCompile` (tree.js untouched; cache key `|treedress1`). World-space:
  damp cool dark foot up to ~4.8 m, contact AO at the ground, moss on up/back-facing bark (roots + foot, limb tops above 3 m),
  faint lichen higher up. Moss colours are LINEAR values (bark texture is dark in linear; sRGB-looking values glow).
  Uniforms `__treedress.barkU.mossAmt / footDark` (0..1) to tune live.
- Moss cushions (root tops, limb tops), soil mounds + leaf litter in pockets between roots (uses `GROUND.rootD`), ivy vines on the lower trunk
  (radius map by angle/height, stops at landings/rooms via boards/beams boxes and TREE_AVOID, avoids the hollow), ferns + grass tufts in crevices and on limb tops.
- 7 draw calls, counts ~55% on phones. Wind: ENV.U (t, wind).

## Next ideas
- Hanging moss / roots dangling from the big limbs? (not in the photo, only if Pavel wants more life)
- Ivy higher up between the rooms if Pavel wants more green.
