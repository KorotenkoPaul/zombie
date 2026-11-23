import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {dequantize} from '@gltf-transform/functions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const d=await io.read(process.argv[2]);await d.transform(dequantize());
for(const n of d.getRoot().listNodes())if(n.getMesh()){console.log(n.getName(),n.getTranslation(),n.getScale());}
await io.write(process.argv[3],d);
