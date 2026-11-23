// Heavy phone: even at px 1.3 a frame needs ~22 ms of GPU. Expect: steps down, then a steady 30 FPS cap (no thrash).
let now = 0; globalThis.performance = { now: () => now };
globalThis.document = { hidden: false, getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } };
globalThis.location = { href: '' }; globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.addEventListener = () => {}; globalThis.window = globalThis;
const { createPerf } = await import('../game/perf.js');
let PR = 2.2; const info = { autoReset: true, reset() {}, render: { calls: 0, triangles: 0 }, memory: {} };
const P = createPerf({ renderer: { info, getPixelRatio: () => PR }, MOBILE: true });
const st = (hi, lo, o) => P.addStep('px', () => { if (PR <= lo + .01) return false; PR = lo; }, () => { PR = hi; }, o);
const PX = [st(2.2, 2, 2), st(2, 1.75, 20), st(1.75, 1.5, 55), st(1.5, 1.3, 60), st(1.3, 1.1, 65)];
P.addStep('fps30', () => { if (P.cap > 1) return false; P.cap = 2; }, () => { P.cap = 1; }, 56);
P.preset([PX[0], PX[1], PX[2]]);
const gpu = () => 14 + 4 * PR * PR;   // 1.5 -> 23 ms, 1.3 -> 20.8 ms: never 60, always fits 30
let log = '', last = '', frames = 0, t30 = 0;
while (now < 240000) {
  if (P.skip()) { now += 16.667; continue; }
  const work = gpu() * (0.95 + Math.random() * .1); now += Math.ceil(work / 16.667) * 16.667; P.begin(); P.end(); frames++;
  const k = `px ${PR} cap ${P.cap}`; if (k !== last) { log += `t=${(now / 1000).toFixed(0)}s ${k}\n`; last = k; }
}
console.log(log + 'final ' + last + ' changes=' + log.split('\n').length);
