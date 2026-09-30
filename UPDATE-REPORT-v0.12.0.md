# SonicStage Pro PWA v0.12.1 — Stage Workflow Update

## Implemented
- Play now automatically arms/starts the selected song's pad when PAD is enabled; switching songs while playing also starts the new song's key pad.
- Pad assets are pre-decoded during startup so the first Play/pad action is not waiting for an audio decode in the foreground.
- Performance console now has separate CLICK and GUIDE faders, plus a PAD fader integrated beside the 12-key inline Pad Player and a MASTER fader.
- Inline 12-key Pad Player is positioned directly beside the Master fader; the existing full Pad Player overlay remains available through OPEN.
- Removed the top-level EDIT button. Each Performance song card now has a three-dot edit control.
- Setlist screen remains in place; its song list layout is preserved.
- Settings now contains the performance controls, output, pad mode, count-in, guide bus, click sequence, fader colors, sound assignments, chord-sheet import, and storage/per-song mix information.
- Fader colors can be assigned independently for Click, Guide, Pad, and Master and are persisted locally.
- Click, Guide, and Pad fader levels are stored per song and restored when a song is selected.
- Chord sheets can be attached per song and viewed from the CHORDS control. TXT/MD/HTML are supported; DOCX is parsed offline using the browser's ZIP/decompression APIs. Legacy .doc is not parsed.
- Service-worker cache version updated and built-in pad assets added to the offline shell.

## Timing regression check
`node test-click-timing.mjs`

Result: `PASS: 37 meters + tempo + 1/32 + triplet phase tests`

## Audio timing design
The click scheduler continues to use the Web Audio clock (`AudioContext.currentTime`) and schedules sources ahead of playback. UI timers are not used as the musical clock.


## v0.12.1 local-audio distribution update
- Removed bundled third-party audio assets from the deployable package.
- Removed service-worker pre-cache entries for click/pad/count-in audio.
- Audio assignments remain persistent via IndexedDB.
- Click sequencing, 1/32 timing, meters, routing, and pad controls are unchanged.
- If no custom sound is assigned, the engine uses its existing synthesized fallback; sequencing therefore does not depend on bundled samples.
