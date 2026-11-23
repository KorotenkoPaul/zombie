// search cost of motion matching in the real page: node tests/mm/bench.js
const {open}=require('../anim/lib.js');
(async()=>{const {b,p}=await open({seed:1});await p.evaluate(()=>__qa.start());
 const r=await p.evaluate(()=>{const m=window.__motion;m.bench(50);return {frames:m.frames,...m.bench(600)};});console.log(JSON.stringify(r));await b.close();})();
