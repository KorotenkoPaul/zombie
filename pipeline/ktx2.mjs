// Textures -> KTX2 (Basis ETC1S, quality 255, mipmaps, sRGB), stored as base64 .txt like the models
// (the artifact host serves text reliably). On the GPU they stay compressed (ASTC/ETC2 on iPhone):
// ~1 byte per pixel instead of 4. KTX2 is not flipped on upload, so the image is flipped here.
// usage: node pipeline/ktx2.mjs game/bark2.jpg ...   (needs: npm i ktx2-encoder sharp)
import { encodeToKTX2 } from "ktx2-encoder";
import sharp from "sharp"; import fs from "fs";
const dec = async b => { const { data, info } = await sharp(b).flip().ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8Array(data), width: info.width, height: info.height }; };
for (const f of process.argv.slice(2)) {
  const k = await encodeToKTX2(new Uint8Array(fs.readFileSync(f)), { isUASTC: false, qualityLevel: 255, compressionLevel: 2, generateMipmap: true, isKTX2File: true, needSupercompression: true, isSetKTX2SRGBTransferFunc: true, imageDecoder: dec });
  const out = f.replace(/\.(jpg|png)$/, '-ktx2.txt'); fs.writeFileSync(out, Buffer.from(k).toString('base64'));
  console.log(out, (k.length / 1024).toFixed(0) + ' KB ktx2, ' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB source');
}
