# SonicStage Pro PWA 0.11.0

Stage-first offline PWA reliability build based on the supplied v0.8.0 project.

## Reliability fixes
- Click scheduler now has a real `scheduleClickVoice` implementation.
- Click no longer depends on the pad mute state.
- Main faders and click subdivision faders use direct Pointer Events with pointer capture.
- Fader changes update the UI and persisted values even before the audio context exists.
- Play starts the click engine immediately with a generated fallback tick; custom click samples warm in the background.
- Bundled click samples from the supplied WAVs are included.
- Bundled count-in guide samples 1-7 are included; 8 falls back to the supplied 7 sample.
- The supplied pad recordings for A, Bb, B, C, Eb and F are bundled in compressed form and can be selected immediately; other keys remain importable.
- Count-in uses a dedicated Guide Track bus with independent volume and pan.
- 4/4 transition count-in is `1, 2, 1, 2, 3, 4`.
- Transition timers are cancellable and switch the target song at the scheduled handoff.
- No song playback is interrupted by view changes inside the SPA.
- No preset demo songs are seeded.

## Run
```powershell
npm install
npm run check
npm run dev
```
Open http://localhost:5173/


## v0.11.0 musical click timing

The click engine now schedules quarter, eighth, sixteenth, 1/32 and eighth-note-triplet layers from exact musical time. BPM is interpreted as quarter-note BPM. Time signatures use their actual bar length and beat grouping, including arbitrary supported numerator/denominator combinations entered through Custom. Triplet phase is continuous across irregular bars such as 5/8 and 7/8.

## v0.10.0 audio/routing fixes
- Meter-aware 32nd-note timing for simple, compound, and irregular signatures.
- Exact bar re-anchoring to prevent loop drift at bar boundaries.
- Performance-page Click/Pad pan controls plus a visible Guide (Count-In) volume/pan bus.
- Count-in guide samples are warmed in the background and scheduled from the same Web Audio clock.


## Audio distribution
This build does not bundle or fetch third-party click, pad, or count-in audio. Users import audio through Settings / Audio Library; imported files are stored locally in IndexedDB and decoded for Web Audio scheduling. If no custom click or count-in sample is assigned, the app uses its built-in synthesized fallback, so the musical sequencer remains functional.
