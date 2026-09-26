import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildChordVoicing, buildScaleSequence, createGuitarEvent } from "./guitar-music.js";
import { GuitarAudioEngine, SAMPLED_FRETS, selectGuitarSample } from "./guitar-audio-engine.js";

const standardStrings = [40, 45, 50, 55, 59, 64].map((midi) => ({ midi }));
const dropDStrings = [38, 45, 50, 55, 59, 64].map((midi) => ({ midi }));

function fretboardEvent(stringIndex, fret, strings = standardStrings, tuningName = "Standard") {
  return createGuitarEvent({ strings, tuningName, stringIndex, fret });
}

test("a note event retains string, fret, pitch, tuning, velocity, articulation, and position", () => {
  const note = fretboardEvent(0, 3);

  assert.equal(note.string, 6);
  assert.equal(note.fret, 3);
  assert.equal(note.pitchMidi, 43);
  assert.equal(note.openMidi, 40);
  assert.equal(note.tuning, "Standard");
  assert.equal(note.velocity, 0.78);
  assert.equal(note.articulation, "picked");
  assert.deepEqual(note.playingPosition, { string: 6, fret: 3, handPosition: null });
  assert.equal(note.openString, false);
});

test("open strings and active tunings change the event pitch without losing the string", () => {
  const standardOpenE = fretboardEvent(0, 0);
  const dropDOpen = fretboardEvent(0, 0, dropDStrings, "Drop D");

  assert.equal(standardOpenE.pitchMidi, 40);
  assert.equal(standardOpenE.openString, true);
  assert.equal(dropDOpen.pitchMidi, 38);
  assert.equal(dropDOpen.tuning, "Drop D");
});

test("the same pitch on two guitar positions selects different recorded strings", () => {
  const highE = fretboardEvent(5, 0);
  const lowE = fretboardEvent(0, 24);
  const highSample = selectGuitarSample(highE, 1);
  const lowSample = selectGuitarSample(lowE, 1);

  assert.equal(highE.pitchMidi, lowE.pitchMidi);
  assert.equal(highSample.sourceString, 1);
  assert.equal(lowSample.sourceString, 6);
  assert.notEqual(highSample.url, lowSample.url);
});

test("neighboring fret samples interpolate pitch and round robins alternate", () => {
  const engine = new GuitarAudioEngine();
  const note = fretboardEvent(0, 4);
  const sample = selectGuitarSample(note, 1);

  assert.equal(sample.sourceFret, 2);
  // The selected anchor is two frets away and Standard's sixth string is a
  // whole tone above this Drop-D source set, for a four-semitone sample shift.
  assert.ok(Math.abs(sample.playbackRate - 2 ** (4 / 12)) < 1e-10);
  assert.equal(engine.nextRoundRobin(note), 1);
  assert.equal(engine.nextRoundRobin(note), 2);
  assert.equal(engine.nextRoundRobin(note), 1);
});

test("the packaged sample set contains every configured string, fret anchor, and take", () => {
  for (let string = 1; string <= 6; string++) {
    for (const fret of SAMPLED_FRETS) {
      for (const roundRobin of [1, 2]) {
        const path = join("public", "audio", "guitar", `s${string}-f${fret}-r${roundRobin}.mp3`);
        assert.ok(existsSync(path), `Missing sample ${path}`);
        assert.ok(statSync(path).size > 1024, `Sample is unexpectedly small: ${path}`);
      }
    }
  }
});

test("a C major chord maps to one playable note per string and mutes non-chord bass strings", () => {
  const voicing = buildChordVoicing({
    strings: standardStrings,
    tuningName: "Standard",
    rootPc: 0,
    intervals: [0, 4, 7],
  });
  const sounding = voicing.filter(Boolean);

  assert.equal(voicing.length, 6);
  assert.equal(voicing[0], null);
  assert.ok(sounding.length >= 4);
  assert.deepEqual(sounding.map((note) => note.string), [5, 4, 3, 2, 1]);
  assert.ok(sounding.every((note) => [0, 4, 7].includes(note.pitchMidi % 12)));
  assert.ok(sounding.some((note) => note.fret === 0));
});

test("chord voicings stay in the requested position and never require an over-four-fret stretch", () => {
  const voicing = buildChordVoicing({
    strings: standardStrings,
    tuningName: "Standard",
    rootPc: 5,
    intervals: [0, 4, 7],
    minFret: 1,
    maxFret: 4,
  });
  const fretted = voicing.filter(Boolean).map((note) => note.fret);

  assert.ok(voicing.filter(Boolean).length >= 3);
  assert.ok(fretted.every((fret) => fret >= 1 && fret <= 4));
  assert.ok(Math.max(...fretted) - Math.min(...fretted) <= 4);
});

test("scale playback follows the selected tuning and supports ascending and descending runs", () => {
  const options = {
    strings: standardStrings,
    tuningName: "Standard",
    rootPc: 0,
    intervals: [0, 2, 4, 5, 7, 9, 11],
  };
  const ascending = buildScaleSequence(options);
  const descending = buildScaleSequence({ ...options, direction: "down" });

  assert.equal(ascending.length, 8);
  assert.equal(ascending.at(-1).pitchMidi - ascending[0].pitchMidi, 12);
  assert.deepEqual(descending.map((note) => note.pitchMidi), ascending.slice().reverse().map((note) => note.pitchMidi));
  assert.ok(ascending.every((note) => note.pitchMidi === note.openMidi + note.fret));
  assert.ok(ascending.every((note) => [0, 2, 4, 5, 7, 9, 11].includes((note.pitchMidi - ascending[0].pitchMidi + 12) % 12)));
});
