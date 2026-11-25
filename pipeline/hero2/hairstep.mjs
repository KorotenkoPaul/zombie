import sharp from 'sharp';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import {execFileSync} from 'child_process';import fs from 'fs';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const [,,iP,oP,cS]=process.argv;const d=await io.read(iP);const m=d.getRoot().listMaterials().find(m=>m.getName()==='head');const t=m.getBaseColorTexture();
await sharp(Buffer.from(t.getImage())).png().toFile('/tmp/hg_in.png');console.log(execFileSync('python3',['hairgrade.py','/tmp/hg_in.png','/tmp/hg_out.png',cS||'{}']).toString().trim());
t.setImage(new Uint8Array(fs.readFileSync('/tmp/hg_out.png'))).setMimeType('image/png');await io.write(oP,d);
