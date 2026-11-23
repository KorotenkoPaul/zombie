import { NodeIO } from '@gltf-transform/core';import { ALL_EXTENSIONS } from '@gltf-transform/extensions';import { prune, dedup, textureCompress, weld, simplify, quantize, meshopt } from '@gltf-transform/functions';import sharp from 'sharp';import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';import fs from 'fs';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder});const doc=await io.read('tree.glb');
await MeshoptSimplifier.ready;await MeshoptEncoder.ready;
await doc.transform(weld(),simplify({simplifier:MeshoptSimplifier,ratio:0.55,error:0.002}),dedup(),prune(),textureCompress({encoder:sharp,targetFormat:'webp',resize:[2048,2048],quality:84}),meshopt({encoder:MeshoptEncoder,level:'high'}));
await io.write('tree-opt.glb',doc);console.log((fs.statSync('tree-opt.glb').size/1e6).toFixed(2),'MB');
