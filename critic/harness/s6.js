// Multi-angle check: the player's orbit limits (yaw ±0.75, pitch up to 0.6) and views outside them
// (back, top-down, sides), plus close-ups of foliage edges, roots and ground vegetation.
// Usage: node s6.js <outdir> [hour]
const {open}=require('./lib');const O=process.argv[2];const HOUR=+(process.argv[3]||19.6);
const HY=1.0,KT=5.0+HY,BD=7.4+HY,WS=3.6+HY,DK=9.0+HY;
// [name, cam override [x,y,dist,z] or null for the default framing, [yaw,pitch,zoom]]
const shots=[
 ['orbit_left_max',null,[-.75,.15,1]],['orbit_right_max',null,[.75,.15,1]],['orbit_top_max',null,[0,.6,1]],['orbit_low',null,[0,.02,1]],
 ['zoom_in_start',null,[0,.15,.55]],
 ['back',[0,7,26,0],[3.1,.2,1]],['side_left',[0,7,26,0],[1.57,.15,1]],['side_right',[0,7,26,0],[-1.57,.15,1]],['top_down',[0,8,26,0],[0,1.35,1]],
 ['crown_edge',[3,13,9,0],[.5,.1,1]],['crown_top',[0,15,10,0],[.2,.6,1]],
 ['roots_close',[0,1,7,2],[.3,.15,1]],['ground_far',[0,.8,14,4],[-.4,.08,1]],['ground_left',[-5,.8,7,3],[.6,.12,1]],
 ['bedroom_room',[-2.1,BD+.9,6.5,1.9],[0,.15,1]],['kitchen_room',[-2.6,KT+.8,6.5,1.9],[0,.15,1]],['workshop_room',[2.9,WS+.9,6.5,2.1],[0,.15,1]],
 ['deck',[2.6,DK+.6,7,1.2],[0,.2,1]],['trunk_base',[.8,2.7,8,2],[0,.12,1]],
];
(async()=>{const {b,p,errs}=await open({});await p.evaluate(h=>{window.__H0=h;__th.setHour(h);},HOUR);await p.waitForTimeout(3000);
for(const [n,c,v] of shots){await p.evaluate(([c,v])=>{if(c)__th.cam(...c);else __th.cam();__th.view(v[0],v[1],v[2]);__th.setHour(window.__H0);},[c,v]);
 await p.waitForTimeout(2500);await p.screenshot({path:O+'/'+n+'.png'});console.log(n);}
console.log(errs.filter(e=>!/Sprite/.test(e)).join('\n'));await b.close();})();
