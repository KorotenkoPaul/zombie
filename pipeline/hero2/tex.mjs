import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS,EXTTextureWebP} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const d=await io.read(process.argv[2]);const S=+process.argv[4]||2048;
d.createExtension(EXTTextureWebP).setRequired(true);
for(const t of d.getRoot().listTextures()){const m=await sharp(Buffer.from(t.getImage())).metadata();const b=await sharp(Buffer.from(t.getImage())).resize(Math.min(S,m.width)).webp({quality:86}).toBuffer();console.log(t.getName(),m.width,'->',b.length);t.setImage(new Uint8Array(b)).setMimeType('image/webp').setURI('');}
await io.write(process.argv[3],d);
