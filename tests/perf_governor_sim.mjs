// Simulates the governor: a phone with a 60 Hz screen whose GPU time grows with pixel ratio squared.
// node tests/perf_governor_sim.mjs
let now = 0; globalThis.performance = { now: () => now };
globalThis.document = { hidden: false, getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } };
globalThis.location = { href: '' }; globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.addEventListener = () => {}; globalThis.window = globalThis;
const { createPerf } = await import('../game/perf.js');
let PR = 2.2; const info = { autoReset: true, reset() {}, render: { calls: 0, triangles: 0 }, memory: {} };
const P = createPerf({ renderer: { info, getPixelRatio: () => PR }, MOBILE: true });
const st = (hi, lo, o) => P.addStep('px', () => { if (PR <= lo + .01) return false; PR = lo; }, () => { PR = hi; }, o);
const PX = [st(2.2, 2, 2), st(2, 1.75, 20), st(1.75, 1.5, 55), st(1.5, 1.3, 60)];
let lights = 2; P.addStep('lights', () => lights > 0 ? (lights--, true) : false, () => { lights++; }, 15);
P.addStep('fog', () => true, null, 80);
P.preset([PX[0], PX[1], PX[2]]);
const gpu = () => 3.6 * PR * PR + (2 - lights) * -1;      // ms: 2.0 -> 14.4 ok, 2.2 -> 17.4 misses
let log = '', lastPR = 0;
for (let f = 0; f < 60 * 240; f++) {
  const work = gpu() * (0.95 + Math.random() * .1);
  const frame = Math.ceil(work / 16.667) * 16.667;          // vsync: a frame is 1, 2, ... refresh intervals
  now += frame; P.begin(); P.end();
  if (PR !== lastPR) { log += `t=${(now / 1000).toFixed(0)}s px ${PR} lights ${lights}\n`; lastPR = PR; }
}
console.log(log + 'final', JSON.stringify({ pr: PR, lights, applied: P.stats().applied, hist: P.stats().hist.length }));
