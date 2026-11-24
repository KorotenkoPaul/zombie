set -e
node -e "
import('@gltf-transform/core').then(async({NodeIO})=>{const {ALL_EXTENSIONS}=await import('@gltf-transform/extensions');const d=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('Gt.glb');const t=d.getRoot().listMaterials().find(m=>m.getName()==='Material_0').getBaseColorTexture();require('fs').writeFileSync('tex_body.png',t.getImage());})" 2>&1 | grep -v Warn || true
python3 grade.py tex_body.png tex_body_g.png ${GRADE:-1,1,1}
node settex.mjs Gt.glb Gt.glb Material_0 tex_body_g.png
