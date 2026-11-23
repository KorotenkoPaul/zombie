import { NodeIO } from '@gltf-transform/core';import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
for(const f of process.argv.slice(2)){const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);const doc=await io.read(f);const r=doc.getRoot();
 for(const a of r.listAnimations()){for(const ch of a.listChannels()){const n=ch.getTargetNode().getName();if(ch.getTargetPath()==='translation'&&/Hips/i.test(n)){const o=ch.getSampler().getOutput().getArray(),inp=ch.getSampler().getInput().getArray();const L=o.length;
  const s=[o[0],o[1],o[2]].map(v=>v.toFixed(2)),e=[o[L-3],o[L-2],o[L-1]].map(v=>v.toFixed(2));let mn=1e9,mx=-1e9;for(let i=1;i<L;i+=3){mn=Math.min(mn,o[i]);mx=Math.max(mx,o[i]);}
  // scale: node parent scale may be .01; print raw
  console.log(f,'dur',inp[inp.length-1].toFixed(2),'start',s.join(','),'end',e.join(','),'ymin',mn.toFixed(2),'ymax',mx.toFixed(2));}}}}
