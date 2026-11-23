// glb textures -> KTX2 (KHR_texture_basisu): base colour ETC1S sRGB, normal map UASTC linear. No flip (glTF UVs are top-left).
import sharp from 'sharp';import {encodeToKTX2} from 'ktx2-encoder';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS,KHRTextureBasisu,EXTTextureWebP} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const d=await io.read(process.argv[2]);const S=+(process.argv[4]||2048);
d.createExtension(KHRTextureBasisu).setRequired(true);const NW=+(process.argv[5]||0);if(NW)d.createExtension(EXTTextureWebP).setRequired(true);
const dec=async b=>{const {data,info}=await sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data:new Uint8Array(data),width:info.width,height:info.height};};
for(const m of d.getRoot().listMaterials()){
 for(const [t,kind] of [[m.getBaseColorTexture(),'base'],[m.getNormalTexture(),'normal']]){if(!t)continue;if(kind==='normal'&&NW){const w=await sharp(Buffer.from(t.getImage())).resize(NW,NW).webp({quality:90}).toBuffer();t.setImage(new Uint8Array(w)).setMimeType('image/webp').setURI('');console.log('normal webp',NW,(w.length/1024|0)+' KB');continue;}
  const png=await sharp(Buffer.from(t.getImage())).resize(S,S).png().toBuffer();
  const opt=kind==='base'?{isUASTC:false,qualityLevel:255,compressionLevel:2,isSetKTX2SRGBTransferFunc:true}:{isUASTC:true,isNormalMap:true,enableRDO:true,rdoQualityLevel:1,needSupercompression:true,isSetKTX2SRGBTransferFunc:false};
  const k=await encodeToKTX2(new Uint8Array(png),{generateMipmap:true,isKTX2File:true,needSupercompression:true,imageDecoder:dec,...opt});
  console.log(kind,S,(k.length/1024|0)+' KB');t.setImage(k).setMimeType('image/ktx2').setURI('');}}
await io.write(process.argv[3],d);
