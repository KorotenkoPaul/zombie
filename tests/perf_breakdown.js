// Per-group breakdown of the scene: meshes, triangles (x instances), shadow casters, materials.
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const {devices}=require('playwright');const p=await b.newPage(process.env.DESK?{viewport:{width:390,height:844},deviceScaleFactor:1}:{...devices['iPhone 13']});p.on('pageerror',e=>console.log('PE',e.message));
await p.goto(process.argv[2]||'http://localhost:8126/index.html');
await p.waitForFunction(()=>window.__th&&document.getElementById('load').classList.contains('hide'),null,{timeout:180000});
await p.evaluate(()=>window.__th.setHour(22));await p.waitForTimeout(4000);
console.log(await p.evaluate(()=>{let s=window.__dbg.hero.root;while(s.parent)s=s.parent;const rows=[];const lights=[];
 s.traverse(o=>{if(o.isLight)lights.push([o.type,o.name,o.castShadow,o.visible,+(o.intensity||0).toFixed(2),o.shadow&&o.castShadow?o.shadow.mapSize.x:0]);});
 for(const c of s.children){const r={name:(c.name||c.type)+(c.userData&&c.userData.tag?':'+c.userData.tag:''),meshes:0,tris:0,cast:0,castTris:0,transp:0,inst:0,vis:c.visible,mats:new Set()};
  c.traverse(o=>{if(!o.isMesh&&!o.isPoints&&!o.isLine)return;let v=true;let q=o;while(q){if(!q.visible){v=false;break;}q=q.parent;}if(!v)return;const g=o.geometry;const n=g.index?g.index.count:(g.attributes.position?g.attributes.position.count:0);const ic=o.isInstancedMesh?o.count:(g.isInstancedBufferGeometry?g.instanceCount:1);const t=n/3*ic;r.meshes++;r.tris+=t;if(o.isInstancedMesh)r.inst++;const m=Array.isArray(o.material)?o.material[0]:o.material;if(m&&m.transparent)r.transp++;if(o.castShadow){r.cast++;r.castTris+=t;}r.mats.add(m&&m.uuid);});
  r.mats=r.mats.size;r.tris=Math.round(r.tris);r.castTris=Math.round(r.castTris);if(r.meshes)rows.push(r);}
 rows.sort((a,b)=>b.tris-a.tris);
 return JSON.stringify({total:{meshes:rows.reduce((a,r)=>a+r.meshes,0),tris:rows.reduce((a,r)=>a+r.tris,0),cast:rows.reduce((a,r)=>a+r.cast,0),castTris:rows.reduce((a,r)=>a+r.castTris,0)},rows:rows.slice(0,40),lights},null,0).replace(/\},\{/g,'},\n{');}));
await b.close();})();
