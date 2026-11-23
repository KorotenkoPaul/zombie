// keep only clips the game uses, weld + simplify the body mesh
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {weld,simplify,prune,dedup} from '@gltf-transform/functions';import {MeshoptSimplifier} from 'meshoptimizer';
const [,,inP,outP,ratio,keep]=process.argv;const K=new Set(keep.split(','));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const d=await io.read(inP);
for(const a of d.getRoot().listAnimations())if(!K.has(a.getName()))a.dispose();
await MeshoptSimplifier.ready;
await d.transform(weld(),simplify({simplifier:MeshoptSimplifier,ratio:+ratio,error:0.0015}),prune(),dedup());
const p=d.getRoot().listMeshes()[0].listPrimitives()[0];console.log('tris',p.getIndices().getCount()/3);
await io.write(outP,d);
