// node settex.mjs in.glb out.glb material png : replace a material's base colour image
import fs from 'fs';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,i,o,mn,png]=process.argv;const d=await io.read(i);
const m=d.getRoot().listMaterials().find(m=>m.getName()===mn);m.getBaseColorTexture().setImage(new Uint8Array(fs.readFileSync(png))).setMimeType('image/png');await io.write(o,d);
