# AstraBoard guitar sample bank

## Source and license

These are recorded guitar samples from the `Parker Fly` instrument in [ClueSurf's wavebase sample repository](https://github.com/cluesurf/wavebase/tree/0c7183fd66fb68e5343d37f2eeebdf40cc7c570e/base/guitar/parker-fly). The upstream [readme](https://github.com/cluesurf/wavebase/blob/0c7183fd66fb68e5343d37f2eeebdf40cc7c570e/readme.md) says the guitar and bass recordings were made on real electric instruments without effects and declares the sample files public domain. The source was pinned to commit `0c7183fd66fb68e5343d37f2eeebdf40cc7c570e` for reproducible imports.

The recordings are clean electric guitar, not acoustic steel-string guitar. They are redistributed here as compressed MP3 conversions of the upstream WAV files. No commercial library or synth preset is used.

## Included clips

`public/audio/guitar/` contains 72 clips: six sampled fret anchors (`0, 2, 6, 12, 18, 24`) on each of strings 1 through 6, with two recorded takes at every anchor. The complete bank is about 2.9 MiB. Files are fetched and decoded on demand rather than loaded at app startup.

The source recordings use Drop D open pitches: string 6 D2, string 5 A2, string 4 D3, string 3 G3, string 2 B3, and string 1 E4. The engine uses the active AstraBoard tuning to calculate the requested pitch, selects the nearest recorded fret on that same string, and shifts the sample by the small pitch interval required. Thus the selected string remains part of sample choice even when two fretboard positions produce the same pitch.

## File names

Local clips use:

```text
s<string>-f<fret>-r<take>.mp3
```

For example, `s6-f0-r1.mp3` is the first take of the open sixth string. Source WAV names encode the same information as `string-<n>-note-<pitch>-fret-<NN>-<take>.wav`.

## Adding or replacing samples

1. Add clean, properly licensed guitar recordings under `public/audio/guitar/` using the local naming pattern.
2. Add each new sampled fret to `SAMPLED_FRETS` in `guitar-audio-engine.js`, and make sure every added string/fret has each configured round-robin take.
3. For a different source tuning, update the source open MIDI pitches in `guitar-audio-engine.js`. The importer uses the same tuning table.
4. Keep source and license details in this file. For a new upstream library, verify the recording license permits redistribution of the audio files themselves.
5. Run `npm.cmd test` and `npm.cmd run build`.

To regenerate this bank from the pinned source, run `python scripts/import-guitar-samples.py` from the project directory. The importer requires `ffmpeg`; it fetches only the selected WAV recordings and converts them to 44.1 kHz stereo MP3. The original WAV files are not retained in the application.

## Playback behavior and limits

- Implemented articulation: picked notes, including open and fretted positions. Chords preserve muted strings and use the sampled guitar on each sounding string.
- Strums spread the strings over a configurable 45–180 ms span. Optional humanization adds only a few milliseconds of timing movement and a small level change; it is off by default.
- Velocity controls sample level. The bank has two round robins but no velocity layers, palm-muted takes, harmonics, or selectable pick-position recordings. Those articulations are not simulated.
- The source samples have one recorded pick position and one clean electric tone. AstraBoard does not add reverb or amp effects.
- Frets between anchors and tuning changes are pitch-shifted. Each selected fret anchor is at most three semitones away; standard and built-in alternate tunings add at most a small further shift. Custom tunings use the same mapping and may need more shifting.
- Plucked samples naturally decay and are not looped. Scheduled notes can be released early; a held note cannot sustain beyond its recorded decay.
- The engine lazily decodes audio and keeps at most 12 decoded clips in its LRU cache. Repeated notes alternate the two available takes. If a clip cannot load or decode, the app reports the audio error instead of substituting an oscillator.
