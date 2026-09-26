# AstraBoard

Interactive guitar fretboard built with React 19 and Vite.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

## Verify

```powershell
npm.cmd test
npm.cmd run build
```

## Guitar audio

Fretboard events retain their string, fret, tuning, and pitch. The Web Audio sample engine selects real clean electric guitar recordings by string and nearby fret, including round-robin takes. Chords use one playable note per string with muted strings preserved; scale runs use the visible scale positions. Audio samples load only when first used and the engine retains a bounded decoded-sample cache.

Sample source, license, conversion, file naming, supported articulations, and instructions for adding more recordings are documented in [public/audio/guitar/README.md](public/audio/guitar/README.md).
