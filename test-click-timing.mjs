import assert from 'node:assert/strict';
import { getMeterInfo, continuousClickEvents, secondsPerQuarter } from './click-timing.js';

const signatures = [
  '1/1','2/1','4/1','2/2','3/2','4/2',
  '1/4','2/4','3/4','4/4','5/4','6/4','7/4','8/4','12/4',
  '2/8','3/8','5/8','6/8','7/8','8/8','9/8','10/8','11/8','12/8','13/8','15/8','16/8',
  '5/16','6/16','7/16','9/16','12/16',
  '7/32','11/32','13/32','15/32'
];

for (const sig of signatures) {
  const m = getMeterInfo(sig);
  assert(m.barQuarter > 0, `${sig}: bar length`);
  assert(m.beatStartsQuarters[0] === 0, `${sig}: first beat`);
  assert(m.beatStartsQuarters.at(-1) < m.barQuarter, `${sig}: beat inside bar`);
  const ev = continuousClickEvents(0, m.barQuarter, ['quarter','eighth','sixteenth','thirty','triplet']);
  assert(ev.every(e => e.quarterOffset >= 0 && e.quarterOffset < m.barQuarter), `${sig}: event bounds`);
}

assert.equal(secondsPerQuarter(120), 0.5);
assert.equal(secondsPerQuarter(60), 1);
assert.equal(secondsPerQuarter(400), 0.15);
assert.equal(getMeterInfo('7/8').barQuarter, 3.5);
assert.equal(getMeterInfo('12/8').barQuarter, 6);

// The 1/32 and triplet grids must be exact at 120 BPM.
const ev = continuousClickEvents(0, 1, ['thirty','triplet']);
const thirty = ev.filter(e=>e.id==='thirty').map(e=>e.quarterOffset);
const triplet = ev.filter(e=>e.id==='triplet').map(e=>e.quarterOffset);
assert.deepEqual(thirty.slice(0,5), [0,0.125,0.25,0.375,0.5]);
assert.deepEqual(triplet.slice(0,4), [0,1/3,2/3]);

// A 7/8 bar is 3.5 quarter notes; triplets must continue through the bar boundary
// instead of restarting their phase at 3.5 quarters.
const sevenEight = continuousClickEvents(3.4, 4.1, ['triplet']);
assert.deepEqual(sevenEight.map(e=>Number(e.quarterOffset.toFixed(6))), [3.666667,4]);

console.log(`PASS: ${signatures.length} meters + tempo + 1/32 + triplet phase tests`);
