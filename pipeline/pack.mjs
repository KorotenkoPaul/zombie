// Merge one rigged character + many animation files into one compact GLB
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, textureCompress, weld, simplify } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'fs';
const [,, out, base, ...anims] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(base);
const root = doc.getRoot();
const byName = new Map(root.listNodes().map(n => [n.getName(), n]));
// rename the base clip
root.listAnimations().forEach(a => a.setName(base.match(/-(\d+)\.glb$/)?.[1] || 'base'));
for (const f of anims) {
  const src = await io.read(f);
  const id = f.match(/-(\d+)\.glb$/)[1];
  for (const a of src.getRoot().listAnimations()) {
    const na = doc.createAnimation(id);
    for (const ch of a.listChannels()) {
      const tn = ch.getTargetNode(); if (!tn) continue; const dst = byName.get(tn.getName()); if (!dst) continue;
      const s = ch.getSampler();
      const inA = doc.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR');
      const outA = doc.createAccessor().setArray(s.getOutput().getArray().slice()).setType(s.getOutput().getType());
      const ns = doc.createAnimationSampler().setInput(inA).setOutput(outA).setInterpolation(s.getInterpolation());
      na.addSampler(ns).addChannel(doc.createAnimationChannel().setTargetNode(dst).setTargetPath(ch.getTargetPath()).setSampler(ns));
    }
  }
}
const buf = root.listBuffers()[0]; root.listAccessors().forEach(a => a.setBuffer(buf));
await doc.transform(resample(), dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }));
await io.write(out, doc);
console.log(out, (fs.statSync(out).size / 1e6).toFixed(2), 'MB', root.listAnimations().map(a => a.getName()).join(','));
