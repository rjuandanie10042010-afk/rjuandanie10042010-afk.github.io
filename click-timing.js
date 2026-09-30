// SonicStage Pro musical timing core.
// All song BPM values are interpreted as quarter-note BPM.

export const TICKS_PER_QUARTER = 96;

export function parseMeter(sig) {
  const match = String(sig || '4/4').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  const num = match ? Number(match[1]) : 4;
  const den = match ? Number(match[2]) : 4;
  return {
    num: Number.isFinite(num) && num > 0 ? Math.min(64, Math.round(num)) : 4,
    den: Number.isFinite(den) && den > 0 ? Math.min(64, Math.round(den)) : 4,
  };
}

function defaultGrouping(num, den) {
  // Compound meters are grouped in 3 written units when that is a
  // conventional compound meter. Otherwise each written unit is a beat.
  if ((den === 8 || den === 16) && num >= 6 && num % 3 === 0) {
    return Array.from({ length: num / 3 }, () => 3);
  }
  if (den === 8) {
    const common = {
      5: [2, 3],
      7: [2, 2, 3],
      8: [4, 4],
      10: [3, 3, 2, 2],
      11: [3, 3, 3, 2],
      13: [3, 3, 2, 2, 3],
      15: [3, 3, 3, 3, 3],
      16: [4, 4, 4, 4],
    };
    if (common[num]) return common[num];
  }
  return Array.from({ length: num }, () => 1);
}

export function getMeterInfo(sig) {
  const { num, den } = parseMeter(sig);
  const unitQuarter = 4 / den;
  const barQuarter = num * unitQuarter;
  const grouping = defaultGrouping(num, den);
  const beatStartsQuarters = [];
  let cursor = 0;
  for (const group of grouping) {
    beatStartsQuarters.push(cursor);
    cursor += group * unitQuarter;
  }

  return {
    num,
    den,
    unitQuarter,
    barQuarter,
    grouping,
    beatStartsQuarters,
    beatStartsTicks: beatStartsQuarters.map(q => Math.round(q * TICKS_PER_QUARTER)),
    barTicks: Math.round(barQuarter * TICKS_PER_QUARTER),
  };
}

export const CLICK_LAYERS = {
  quarter: { label: '1/4', quarterInterval: 1 },
  eighth: { label: '1/8', quarterInterval: 0.5 },
  sixteenth: { label: '1/16', quarterInterval: 0.25 },
  thirty: { label: '1/32', quarterInterval: 0.125 },
  triplet: { label: 'TRIPLET', quarterInterval: 1 / 3 },
};

export function layerIntervalQuarters(id) {
  return CLICK_LAYERS[id]?.quarterInterval ?? 1;
}

export function barEventTimes(meter, enabledLayers) {
  // Kept for callers that need one bar of binary subdivisions. Triplets are
  // intentionally not phase-reset here when a bar is not an integer number
  // of triplet pulses; the live scheduler below uses a continuous phase.
  const events = [];
  const barTicks = meter.barTicks;
  for (const id of enabledLayers) {
    const intervalTicks = Math.round(layerIntervalQuarters(id) * TICKS_PER_QUARTER);
    if (!intervalTicks) continue;
    for (let tick = 0; tick < barTicks; tick += intervalTicks) {
      events.push({ id, tick, quarterOffset: tick / TICKS_PER_QUARTER });
    }
  }
  events.sort((a, b) => a.tick - b.tick || layerPriority(a.id) - layerPriority(b.id));
  return events;
}

function layerPriority(id) {
  return { quarter: 0, eighth: 1, triplet: 2, sixteenth: 3, thirty: 4 }[id] ?? 99;
}

export function isBeatStart(meter, quarterOffset) {
  const tick = Math.round(quarterOffset * TICKS_PER_QUARTER);
  return meter.beatStartsTicks.includes(tick);
}

export function secondsPerQuarter(bpm) {
  return 60 / Math.max(20, Math.min(400, Number(bpm) || 120));
}


export function continuousClickEvents(startQuarter, endQuarter, enabledLayers) {
  const events = [];
  for (const id of enabledLayers) {
    const interval = layerIntervalQuarters(id);
    const first = Math.max(0, Math.ceil((startQuarter - 1e-9) / interval));
    const last = Math.floor((endQuarter - 1e-9) / interval);
    for (let n = first; n <= last; n++) {
      const quarterOffset = n * interval;
      events.push({ id, quarterOffset });
    }
  }
  events.sort((a,b) => a.quarterOffset - b.quarterOffset || layerPriority(a.id) - layerPriority(b.id));
  return events;
}
