const MAX_FRET = 24;

/**
 * Keep the fretboard's physical position intact all the way to the audio engine.
 * stringIndex is the app's existing low-to-high array index (0 = string 6).
 */
export function createGuitarEvent({
  strings,
  tuningName,
  stringIndex,
  fret,
  velocity = 0.78,
  duration = null,
  technique = "picked",
  handPosition = null,
}) {
  if (!Number.isInteger(stringIndex) || stringIndex < 0 || stringIndex >= strings.length) {
    throw new RangeError("A guitar event needs a valid string index.");
  }
  if (!Number.isInteger(fret) || fret < 0 || fret > MAX_FRET) {
    throw new RangeError("A guitar event needs a fret from 0 to 24.");
  }

  const string = 6 - stringIndex;
  const openMidi = strings[stringIndex].midi;
  const normalizedTechnique = technique && typeof technique === "string" ? technique : "picked";

  return {
    string,
    fret,
    pitchMidi: openMidi + fret,
    openMidi,
    tuning: tuningName,
    velocity: Math.max(0, Math.min(1, velocity)),
    duration,
    articulation: normalizedTechnique,
    technique: normalizedTechnique,
    playingPosition: { string, fret, handPosition },
    pickPosition: "bridge",
    openString: fret === 0,
  };
}

function pitchClass(midi) {
  return ((midi % 12) + 12) % 12;
}

function makePosition(stringIndex, fret, midi) {
  return { stringIndex, string: 6 - stringIndex, fret, midi };
}

function chordVoicingCost(positions, intervals, rootPc) {
  const sounding = positions.filter(Boolean);
  if (sounding.length < 3) return Infinity;

  const tones = new Set(sounding.map((note) => pitchClass(note.midi)));
  const missingTones = intervals.filter((interval) => !tones.has((rootPc + interval) % 12)).length;
  const fretted = sounding.filter((note) => note.fret > 0);
  const fretSpan = fretted.length ? Math.max(...fretted.map((note) => note.fret)) - Math.min(...fretted.map((note) => note.fret)) : 0;
  if (fretSpan > 4) return Infinity;

  const lowest = sounding.reduce((a, b) => (a.midi < b.midi ? a : b));
  const duplicateTones = sounding.length - tones.size;
  const distinctFrets = new Set(fretted.map((note) => note.fret)).size;

  // Favor complete, compact guitar grips with the root in the bass. Open notes
  // are useful, and four-to-six sounding strings make strong default voicings.
  return (
    missingTones * 18 +
    (pitchClass(lowest.midi) === rootPc ? 0 : 5) +
    fretSpan * 2.2 +
    fretted.reduce((sum, note) => sum + note.fret * 0.3, 0) +
    duplicateTones * 0.35 +
    distinctFrets * 0.2 +
    (6 - sounding.length) * 5
  );
}

/**
 * Find one playable chord tone per string. A null entry is an intentionally
 * muted string. The default open-position search returns familiar guitar grips.
 */
export function buildChordVoicing({
  strings,
  tuningName,
  rootPc,
  intervals,
  minFret = 0,
  maxFret = 5,
  velocity = 0.72,
  duration = null,
  handPosition = null,
  technique = "picked",
}) {
  if (!Array.isArray(strings) || strings.length !== 6 || !Array.isArray(intervals) || intervals.length === 0) {
    return Array(6).fill(null);
  }

  const normalizedRoot = pitchClass(rootPc);
  const allowedTones = new Set(intervals.map((interval) => (normalizedRoot + interval) % 12));
  const options = strings.map((openString, stringIndex) => {
    const notes = [];
    for (let fret = minFret; fret <= Math.min(maxFret, MAX_FRET); fret++) {
      const midi = openString.midi + fret;
      if (allowedTones.has(pitchClass(midi))) notes.push(makePosition(stringIndex, fret, midi));
    }
    return [null, ...notes];
  });

  let best = null;
  let bestCost = Infinity;
  const candidate = Array(6).fill(null);

  function visit(stringIndex) {
    if (stringIndex === 6) {
      const cost = chordVoicingCost(candidate, intervals, normalizedRoot);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate.slice();
      }
      return;
    }
    for (const note of options[stringIndex]) {
      candidate[stringIndex] = note;
      visit(stringIndex + 1);
    }
  }
  visit(0);

  // A very narrow requested position can omit an entire chord tone. Keep the
  // position if it still gives a playable grip; otherwise choose a low voicing.
  if (!best && (minFret !== 0 || maxFret !== 5)) {
    return buildChordVoicing({ strings, tuningName, rootPc, intervals, velocity, duration, handPosition, technique });
  }
  if (!best) return Array(6).fill(null);

  return best.map((note) =>
    note
      ? createGuitarEvent({
          strings,
          tuningName,
          stringIndex: note.stringIndex,
          fret: note.fret,
          velocity,
          duration,
          technique,
          handPosition,
        })
      : null
  );
}

function scaleRunCost(path) {
  let cost = path[0].midi * 0.012 + path[0].fret * 0.12;
  for (let index = 1; index < path.length; index++) {
    const previous = path[index - 1];
    const current = path[index];
    cost += Math.abs(current.fret - previous.fret) * 0.75;
    cost += Math.abs(current.stringIndex - previous.stringIndex) * 0.22;
    // Ascending runs tend to move toward the thinner strings as pitch rises.
    cost += Math.max(0, previous.stringIndex - current.stringIndex) * 0.45;
  }
  return cost;
}

/**
 * Make one ascending octave from the active scale and the positions currently
 * visible on the neck. Every returned note is an actual string/fret location.
 */
export function buildScaleSequence({
  strings,
  tuningName,
  rootPc,
  intervals,
  minFret = 0,
  maxFret = 24,
  velocity = 0.66,
  duration = 0.34,
  handPosition = null,
  direction = "up",
  technique = "picked",
}) {
  const normalizedRoot = pitchClass(rootPc);
  const scaleSteps = [...new Set(intervals.map((step) => ((step % 12) + 12) % 12))]
    .filter((step) => step !== 0)
    .sort((a, b) => a - b);
  const allPositions = [];

  strings.forEach((openString, stringIndex) => {
    for (let fret = minFret; fret <= Math.min(maxFret, MAX_FRET); fret++) {
      const midi = openString.midi + fret;
      if (pitchClass(midi) === normalizedRoot || scaleSteps.includes((pitchClass(midi) - normalizedRoot + 12) % 12)) {
        allPositions.push(makePosition(stringIndex, fret, midi));
      }
    }
  });

  const roots = allPositions.filter((note) => pitchClass(note.midi) === normalizedRoot);
  let bestPath = null;
  let bestCost = Infinity;
  const offsets = [0, ...scaleSteps, 12];

  for (const root of roots) {
    const positionsByPitch = offsets.map((offset) => allPositions.filter((note) => note.midi === root.midi + offset));
    if (positionsByPitch.some((positions) => positions.length === 0)) continue;

    let paths = positionsByPitch[0].map((note) => ({ path: [note], cost: note.midi * 0.012 + note.fret * 0.12 }));
    for (let step = 1; step < positionsByPitch.length; step++) {
      const nextPaths = [];
      for (const current of positionsByPitch[step]) {
        let bestPrevious = null;
        let transitionCost = Infinity;
        for (const previous of paths) {
          const last = previous.path[previous.path.length - 1];
          const moveCost =
            Math.abs(current.fret - last.fret) * 0.75 +
            Math.abs(current.stringIndex - last.stringIndex) * 0.22 +
            Math.max(0, last.stringIndex - current.stringIndex) * 0.45;
          if (previous.cost + moveCost < transitionCost) {
            transitionCost = previous.cost + moveCost;
            bestPrevious = previous.path;
          }
        }
        if (bestPrevious) nextPaths.push({ path: [...bestPrevious, current], cost: transitionCost });
      }
      paths = nextPaths;
    }

    for (const path of paths) {
      const cost = scaleRunCost(path.path);
      if (cost < bestCost) {
        bestCost = cost;
        bestPath = path.path;
      }
    }
  }

  const orderedPath = direction === "down" ? (bestPath || []).slice().reverse() : bestPath || [];
  return orderedPath.map((note) =>
    createGuitarEvent({
      strings,
      tuningName,
      stringIndex: note.stringIndex,
      fret: note.fret,
      velocity,
      duration,
      technique,
      handPosition,
    })
  );
}
