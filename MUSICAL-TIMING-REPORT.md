# SonicStage Pro PWA v0.11.0 — Musical Click Timing Report

## Completed

The click engine was changed from a fixed 1/32-step scheduler to a musical-time scheduler.

### Rhythmic layers

- 1/4 quarter note
- 1/8 eighth note
- 1/16 sixteenth note
- 1/32 thirty-second note
- TRIPLET eighth-note triplet

Each layer keeps its own mixer level and can be enabled independently.

## Timing model

BPM is treated as quarter-note BPM throughout the engine.

At 120 BPM:

- 1/4 = 500 ms
- 1/8 = 250 ms
- 1/16 = 125 ms
- 1/32 = 62.5 ms
- 1/8 triplet = 166.666... ms

The scheduler calculates absolute Web Audio times instead of relying on JavaScript timer intervals for musical timing.

## Time signatures

The meter engine calculates actual bar length from numerator/denominator and calculates beat/accent positions separately from subdivision timing.

The editor supports common meters directly and Custom supports numerators 1–64 with denominators 1, 2, 4, 8, 16, 32 or 64.

Examples tested include 4/4, 5/4, 7/4, 5/8, 6/8, 7/8, 9/8, 11/8, 13/8, 5/16, 7/16 and 15/32.

## Irregular-meter triplets

Triplet phase is continuous across bar boundaries. This is important for meters such as 5/8 and 7/8 where an eighth-note triplet does not divide evenly into a bar. The triplet layer is therefore not incorrectly restarted at every bar line.

## Count-in

Count-in timing now follows the meter's actual beat grouping rather than using a fixed numerator-based interval.

## Responsiveness

Click scheduling is performed from the AudioContext clock with look-ahead scheduling. The UI timer only wakes the scheduler and does not define the musical event time.

The existing persistent audio architecture, setlists, pad system, mixer, routing and local storage were left intact.

## Asset note

The existing PWA did not contain a dedicated triplet WAV. Until the user uploads one, the triplet layer falls back to the existing eighth-note click sample. The triplet timing itself is independent and exact.

## Verification

Passed:

- JavaScript syntax checks for app.js, click-timing.js and sw.js
- 37 time-signature/meter combinations
- BPM timing checks
- 1/32 spacing checks
- triplet spacing checks
- continuous triplet phase across a 7/8 bar boundary
- local dev server HTTP checks for `/` and `/click-timing.js`
- ZIP integrity check

Note: automated verification cannot physically audition the click through a real audio device, so final listening verification should still be performed on the target Windows/iPad browser/audio setup.
