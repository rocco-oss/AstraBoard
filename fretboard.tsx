import { useState, useMemo, useRef, useEffect } from "react";

// Chromatic scale starting at C, aligned with standard MIDI % 12 (MIDI 60 = C4)
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const TUNINGS = {
  Standard: [40, 45, 50, 55, 59, 64],
  "Drop D": [38, 45, 50, 55, 59, 64],
  "Half Step Down": [39, 44, 49, 54, 58, 63],
  "Drop C": [36, 43, 48, 53, 57, 62],
  "Open G": [38, 43, 50, 55, 59, 62],
  "Open D": [38, 45, 50, 54, 57, 62],
  DADGAD: [38, 45, 50, 55, 57, 62],
};
const TUNING_NAMES = [...Object.keys(TUNINGS), "Custom"];

const FRET_COUNT = 24;
const QUIZ_FRET_COUNT = 15;
const INLAY_FRETS = { 3: 1, 5: 1, 7: 1, 9: 1, 12: 2, 15: 1, 17: 1, 19: 1, 21: 1, 24: 2 };
const GAUGE = [3.4, 2.8, 2.2, 1.8, 1.3, 1.0];
const CURVE_MAX = 0; // px of simulated fretboard-radius curvature at the outer strings

function curveOffset(colPos) {
  const norm = (colPos - 2.5) / 2.5; // -1..1 across 6 columns
  return CURVE_MAX * norm * norm;
}

const POSITIONS = [
  { label: "Full neck", range: null },
  { label: "Pos 1 (1–4)", range: [1, 4] },
  { label: "Pos 2 (4–7)", range: [4, 7] },
  { label: "Pos 3 (7–10)", range: [7, 10] },
  { label: "Pos 4 (10–13)", range: [10, 13] },
  { label: "Pos 5 (13–16)", range: [13, 16] },
  { label: "Pos 6 (16–19)", range: [16, 19] },
  { label: "Pos 7 (19–22)", range: [19, 22] },
];

const SCALES = {
  "Major (Ionian)": [0, 2, 4, 5, 7, 9, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "Natural Minor (Aeolian)": [0, 2, 3, 5, 7, 8, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
  "Major Pentatonic": [0, 2, 4, 7, 9],
  "Minor Pentatonic": [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10],
  "Harmonic Minor": [0, 2, 3, 5, 7, 8, 11],
};

const CHORDS = {
  Major: [0, 4, 7],
  Minor: [0, 3, 7],
  "Dominant 7": [0, 4, 7, 10],
  "Major 7": [0, 4, 7, 11],
  "Minor 7": [0, 3, 7, 10],
  Diminished: [0, 3, 6],
  Augmented: [0, 4, 8],
  Sus2: [0, 2, 7],
  Sus4: [0, 5, 7],
};

const CHORD_SUFFIX = {
  Major: "",
  Minor: "m",
  "Dominant 7": "7",
  "Major 7": "maj7",
  "Minor 7": "m7",
  Diminished: "dim",
  Augmented: "aug",
  Sus2: "sus2",
  Sus4: "sus4",
};

const DEGREE_LABELS = {
  0: "R", 1: "\u266d2", 2: "2", 3: "\u266d3", 4: "3", 5: "4",
  6: "\u266d5", 7: "5", 8: "\u266f5", 9: "6", 10: "\u266d7", 11: "7",
};

const DEGREE_COLORS = {
  0: { bg: "#e0b13a", hi: "#f7dd8f", fg: "#20140c" },
  4: { bg: "#c65f45", hi: "#e79176", fg: "#fbf3e6" },
  3: { bg: "#c65f45", hi: "#e79176", fg: "#fbf3e6" },
  7: { bg: "#3f8a7c", hi: "#6fb8a9", fg: "#fbf3e6" },
  6: { bg: "#3f8a7c", hi: "#6fb8a9", fg: "#fbf3e6" },
  8: { bg: "#3f8a7c", hi: "#6fb8a9", fg: "#fbf3e6" },
  10: { bg: "#7a63ad", hi: "#a48fd6", fg: "#fbf3e6" },
  11: { bg: "#7a63ad", hi: "#a48fd6", fg: "#fbf3e6" },
  default: { bg: "#9a9082", hi: "#c3baab", fg: "#20140c" },
};

const NEUTRAL_NOTE_COLOR = { bg: "#5a4634", hi: "#7d6650", fg: "#e6d8c3" };
const GREEN = { bg: "#4a9c6a", hi: "#7ecb98", fg: "#0c2016" };
const RED = { bg: "#c0453a", hi: "#e37a6f", fg: "#fbf3e6" };

function degreeColor(interval) {
  return DEGREE_COLORS[interval] || DEGREE_COLORS.default;
}
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function nearestMidiForPitchClass(anchorMidi, pitchClass) {
  let diff = ((pitchClass - (anchorMidi % 12)) + 12) % 12;
  if (diff > 6) diff -= 12;
  return anchorMidi + diff;
}

// Physically-modeled plucked string (Karplus-Strong): a noise burst decayed through
// a short feedback delay line. No external audio files are loaded — this runs
// entirely in Web Audio, which is what makes it work reliably inside the artifact.
function makeKarplusStrongBuffer(ctx, freq, duration = 1.6) {
  const sampleRate = ctx.sampleRate;
  const N = Math.max(2, Math.round(sampleRate / freq));
  const totalSamples = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);
  const ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  let prevSample = 0;
  const decay = 0.994;
  for (let i = 0; i < totalSamples; i++) {
    const idx = i % N;
    const current = ring[idx];
    const next = decay * 0.5 * (current + prevSample);
    ring[idx] = next;
    data[i] = current;
    prevSample = current;
  }
  return buffer;
}

const SYNTH_VOICES = ["Pad", "Keys", "Pluck"];

// Oscillator-based "MIDI synth" voices for the chord progression builder — plain
// OscillatorNodes shaped with gain envelopes and filters, like simple General-MIDI-
// style patches. Deliberately distinct from the Karplus-Strong guitar pluck above,
// since this instrument isn't tied to a fretboard.
function playSynthVoiceNote(ctx, midi, startTime, duration, voice) {
  const freq = midiToFreq(midi);
  const stopTime = startTime + duration + 0.4;

  if (voice === "Keys") {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(0.2, startTime + 0.012);
    env.gain.exponentialRampToValueAtTime(0.06, startTime + 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, stopTime);
    env.connect(ctx.destination);
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.value = freq;
    body.connect(env);
    body.start(startTime);
    body.stop(stopTime);

    const bellGain = ctx.createGain();
    bellGain.gain.value = 0.03;
    bellGain.connect(ctx.destination);
    const bell = ctx.createOscillator();
    bell.type = "sine";
    bell.frequency.value = freq * 2;
    bell.connect(bellGain);
    bell.start(startTime);
    bell.stop(stopTime);
  } else if (voice === "Pluck") {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3200, startTime);
    filter.frequency.exponentialRampToValueAtTime(500, startTime + Math.min(duration, 0.6));
    filter.connect(ctx.destination);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.18, startTime);
    env.gain.exponentialRampToValueAtTime(0.0006, stopTime);
    env.connect(filter);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    osc.connect(env);
    osc.start(startTime);
    osc.stop(stopTime);
  } else {
    // Pad
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2000;
    filter.Q.value = 0.6;
    filter.connect(ctx.destination);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(0.09, startTime + 0.4);
    env.gain.linearRampToValueAtTime(0.07, stopTime - 0.4);
    env.gain.linearRampToValueAtTime(0.0001, stopTime);
    env.connect(filter);
    [-5, 5].forEach((detune) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(env);
      osc.start(startTime);
      osc.stop(stopTime);
    });
  }
}

// Close-position chord voicing for synth playback (not tied to guitar strings):
// chord tones stacked above a root near C3, plus a bass note an octave below.
function voicedChordNotes(rootPC, quality) {
  const rootMidi = 48 + rootPC;
  const upper = (CHORDS[quality] || CHORDS.Major).map((iv) => rootMidi + iv);
  return [rootMidi - 12, ...upper];
}

function chordName(rootPC, quality) {
  return NOTE_NAMES[rootPC] + (CHORD_SUFFIX[quality] || "");
}

const MODES = ["Notes", "Scale", "Chord", "Arpeggio"];
const NAV = ["Fretboard", "Practice", "Theory"];
const FAVORITES_KEY = "fretboard-favorites";

const INTERVAL_NAMES = ["m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7", "P8"];

const MODE_ORDER = ["Major (Ionian)", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Natural Minor (Aeolian)", "Locrian"];

const MAJOR_QUALITIES = ["Major", "Minor", "Minor", "Major", "Major", "Minor", "Diminished"];
const MINOR_QUALITIES = ["Minor", "Diminished", "Major", "Minor", "Minor", "Major", "Major"];
const ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii\u00b0"];
const ROMAN_MINOR = ["i", "ii\u00b0", "III", "iv", "v", "VI", "VII"];

// Theme definitions
const frutigerAeroTheme = {
  // Page background - light gradient sky
  pageBackground: "linear-gradient(180deg, #87ceeb 0%, #ffffff 100%)",
  // Page text color - dark for contrast on light background
  pageTextColor: "#20140c",

  // Header gradients - glossy look
  titleBackground: "linear-gradient(90deg, #ffffff, #e0f7ff, #ffffff)",

  // Interactive elements - glassy/glossy
  navBg: "rgba(255, 255, 255, 0.8)",
  navBgActive: "linear-gradient(180deg, #ffffff, #f0f8ff)",
  navBorder: "1px solid rgba(200, 200, 255, 0.3)",

  // Chips and buttons - translucent with glow
  chipBg: "rgba(255, 255, 255, 0.7)",
  chipBgActive: "rgba(200, 230, 255, 0.8)",
  chipBorder: "1px solid rgba(200, 200, 255, 0.4)",

  // Board - lighter wood with glass overlay
  boardBackground: "linear-gradient(180deg, #8b4513, #a0522d)",
  boardBorder: "1px solid #8b4513",
  boardBoxShadow: "0 30px 50px -18px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -20px 40px rgba(0,0,0,0.2)",

  // Strings - subtle shine
  stringBackground: "linear-gradient(90deg, #c0c0c0, #e0e0e0 45%, #c0c0c0)",
  stringBoxShadow: "0 0 2px rgba(255,255,255,0.5)",

  // Frets - metallic
  fretBorder: "2px solid #c0c0c0",
  fretBoxShadow: "0 1px 0 rgba(255,255,255,0.3)",

  // Inlay dots - mother of pearl
  inlayBackground: "radial-gradient(circle at 50% 50%, #f0f8ff, #e6e6fa)",

  // Note dots - glossy
  noteDotShadow: "0 3px 5px rgba(0,0,0,0.2), 0 1px 0 rgba(255,255,255,0.3) inset, 0 -2px 4px rgba(0,0,0,0.1) inset",
};

const spaceGalaxyTheme = {
  // Page background - deep space
  pageBackground: "radial-gradient(ellipse at 50% 0%, #0a0a1a 0%, #01000f 100%)",
  // Page text color - light for contrast on dark background
  pageTextColor: "#f3e9d8",

  // Header gradients - cosmic glow
  titleBackground: "linear-gradient(90deg, #4b0082, #9400d3, #4b0082)",

  // Interactive elements - dark with cosmic accents
  navBg: "rgba(10, 10, 26, 0.8)",
  navBgActive: "rgba(25, 25, 112, 0.6)",
  navBorder: "1px solid rgba(75, 0, 130, 0.3)",

  // Chips and buttons - dark with neon accents
  chipBg: "rgba(25, 25, 112, 0.5)",
  chipBgActive: "rgba(75, 0, 130, 0.4)",
  chipBorder: "1px solid rgba(138, 43, 226, 0.3)",

  // Board - dark cosmic material
  boardBackground: "linear-gradient(180deg, #0f0a1f, #1a0a2e)",
  boardBorder: "1px solid #4b0082",
  boardBoxShadow: "0 30px 50px -18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(75,0,130,0.1), inset 0 -20px 40px rgba(0,0,0,0.4)",

  // Strings - faintly glowing
  stringBackground: "linear-gradient(90deg, #2f0a47, #4b0082 45%, #2f0a47)",
  stringBoxShadow: "0 0 3px rgba(138, 43, 226, 0.4)",

  // Frets - dark metal with glow
  fretBorder: "2px solid #4b0082",
  fretBoxShadow: "0 1px 0 rgba(75,0,130,0.2), 0 -1px 1px rgba(138,43,226,0.1)",

  // Inlay dots - glowing gems
  inlayBackground: "radial-gradient(circle at 50% 50%, #e6e6fa, #9370db)",

  // Note dots - cosmic glow
  noteDotShadow: "0 3px 5px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.1) inset, 0 -2px 4px rgba(138,43,226,0.2) inset",
};

// Function to get theme-aware styles
const MAJOR_PROGRESSIONS = {
  "I – IV – V": [0, 3, 4],
  "I – V – vi – IV": [0, 4, 5, 3],
  "ii – V – I": [1, 4, 0],
  "I – vi – IV – V": [0, 5, 3, 4],
  "vi – IV – I – V": [5, 3, 0, 4],
};
const MINOR_PROGRESSIONS = {
  "i – iv – v": [0, 3, 4],
  "i – VI – III – VII": [0, 5, 2, 6],
  "i – iv – VII – III": [0, 3, 6, 2],
  "i – VI – VII": [0, 5, 6],
  "i – v – iv": [0, 4, 3],
};

// CAGED: pitch class each open shape is named after. Barring the whole shape up
// N frets transposes it up N semitones, regardless of that shape's own internal
// fingering — so the anchor fret for a target root is just the transposition distance.
const CAGED_SHAPES = ["C", "A", "G", "E", "D"];
const SHAPE_ROOT_PC = { C: 0, A: 9, G: 7, E: 4, D: 2 };
const CAPO_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function Fretboard() {
  const [view, setView] = useState("Fretboard");
  const [theme, setTheme] = useState("default");
  const styles = getStyles(theme);

  // --- shared fretboard config ---
  const [root, setRoot] = useState(NOTE_NAMES.indexOf("E"));
  const [mode, setMode] = useState("Scale");
  const [scaleType, setScaleType] = useState("Minor Pentatonic");
  const [chordType, setChordType] = useState("Minor");
  const [tuningName, setTuningName] = useState("Standard");
  const [customPC, setCustomPC] = useState(TUNINGS.Standard.map((m) => m % 12));
  const [leftHanded, setLeftHanded] = useState(false);
  const [labelMode, setLabelMode] = useState("degree");
  const [positionIdx, setPositionIdx] = useState(0);
  const [cagedShape, setCagedShape] = useState(null);
  const [capoFret, setCapoFret] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [favName, setFavName] = useState("");
  const [favOpen, setFavOpen] = useState(false);
  const audioCtxRef = useRef(null);
  const bufferCacheRef = useRef(new Map());

  // --- metronome ---
  const [bpm, setBpm] = useState(100);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [metroOpen, setMetroOpen] = useState(false);
  const [beatPulse, setBeatPulse] = useState(false);
  const bpmRef = useRef(100);
  const metronomeOnRef = useRef(false);
  const nextNoteTimeRef = useRef(0);
  const schedulerIdRef = useRef(null);
  const beatCountRef = useRef(0);

  // --- practice: note quiz ---
  const [quizTarget, setQuizTarget] = useState(() => Math.floor(Math.random() * 12));
  const [quizFeedback, setQuizFeedback] = useState(null);
  const [quizCorrect, setQuizCorrect] = useState(0);
  const [quizWrong, setQuizWrong] = useState(0);

  // --- practice: ear trainer ---
  const [practiceTab, setPracticeTab] = useState("Note Quiz");
  const [etSubMode, setEtSubMode] = useState("Note ID");
  const [etNoteTarget, setEtNoteTarget] = useState(() => Math.floor(Math.random() * 12));
  const [etIntervalSemi, setEtIntervalSemi] = useState(() => 1 + Math.floor(Math.random() * 12));
  const [etFeedback, setEtFeedback] = useState(null);
  const [etCorrect, setEtCorrect] = useState(0);
  const [etWrong, setEtWrong] = useState(0);

  // --- theory ---
  const [theoryTab, setTheoryTab] = useState("Chord Progressions");
  const [theoryKeyRoot, setTheoryKeyRoot] = useState(NOTE_NAMES.indexOf("C"));
  const [theoryQuality, setTheoryQuality] = useState("Major");
  const [progName, setProgName] = useState("I – IV – V");
  const [progPlaying, setProgPlaying] = useState(false);
  const [progression, setProgression] = useState(() => {
    const degrees = MAJOR_PROGRESSIONS["I – IV – V"];
    return degrees.map((d, i) => ({
      rootPC: (NOTE_NAMES.indexOf("C") + SCALES["Major (Ionian)"][d]) % 12,
      quality: MAJOR_QUALITIES[d],
      id: i + 1,
    }));
  });
  const [playingChordIdx, setPlayingChordIdx] = useState(-1);
  const [synthVoice, setSynthVoice] = useState("Pad");
  const [progTempo, setProgTempo] = useState(90);
  const [addChordRoot, setAddChordRoot] = useState(NOTE_NAMES.indexOf("C"));
  const [addChordQuality, setAddChordQuality] = useState("Major");
  const chordIdRef = useRef(3);
  const [theoryModeRoot, setTheoryModeRoot] = useState(NOTE_NAMES.indexOf("C"));

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FAVORITES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setFavorites(parsed);
      }
    } catch (e) {
      // no favorites saved yet, or browser storage is unavailable
    }
  }, []);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    if (!metronomeOn) return;
    const ms = 60000 / bpm;
    const id = setInterval(() => setBeatPulse((p) => !p), ms);
    return () => clearInterval(id);
  }, [metronomeOn, bpm]);

  useEffect(() => {
    return () => {
      if (schedulerIdRef.current) clearTimeout(schedulerIdRef.current);
    };
  }, []);

  const STRINGS = useMemo(() => {
    if (tuningName === "Custom") {
      return customPC.map((pc, i) => {
        const midi = nearestMidiForPitchClass(TUNINGS.Standard[i], pc);
        return { name: NOTE_NAMES[pc], midi };
      });
    }
    return TUNINGS[tuningName].map((midi) => ({ name: NOTE_NAMES[midi % 12], midi }));
  }, [tuningName, customPC]);

  const activeType = mode === "Scale" ? scaleType : chordType;
  const intervals =
    mode === "Notes"
      ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      : mode === "Scale"
      ? SCALES[scaleType]
      : CHORDS[chordType];

  const cagedActive = cagedShape && (mode === "Chord" || mode === "Arpeggio");
  const cagedAnchor = cagedShape ? (((root - SHAPE_ROOT_PC[cagedShape]) % 12) + 12) % 12 : null;
  const cagedWindow = cagedShape ? [Math.max(1, cagedAnchor), Math.max(1, cagedAnchor) + 4] : null;
  const posRange = mode === "Notes" ? null : cagedActive ? cagedWindow : POSITIONS[positionIdx].range;

  const board = useMemo(() => {
    return STRINGS.map((str) => {
      const cells = [];
      for (let fret = 1; fret <= FRET_COUNT; fret++) {
        const midi = str.midi + fret;
        const noteIndex = midi % 12;
        const interval = (noteIndex - root + 12) % 12;
        let active = intervals.includes(interval);
        if (posRange) active = active && fret >= posRange[0] && fret <= posRange[1];
        cells.push({ fret, midi, noteIndex, interval, active });
      }
      return cells;
    });
  }, [root, intervals, STRINGS, posRange]);

  function getCtx() {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AC();
    }
    return audioCtxRef.current;
  }

  function getPluckBuffer(ctx, midi) {
    if (bufferCacheRef.current.has(midi)) return bufferCacheRef.current.get(midi);
    const buf = makeKarplusStrongBuffer(ctx, midiToFreq(midi));
    bufferCacheRef.current.set(midi, buf);
    return buf;
  }

  function pluckNote(midi, delaySec = 0) {
    try {
      const ctx = getCtx();
      if (ctx.state === "suspended") ctx.resume();
      const buffer = getPluckBuffer(ctx, midi);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(ctx.currentTime + delaySec);
    } catch (e) {
      // audio not available; fail silently
    }
  }

  function metronomeClick(time, accent) {
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = accent ? 1400 : 900;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    } catch (e) {
      // ignore
    }
  }

  function schedulerLoop() {
    const ctx = getCtx();
    while (nextNoteTimeRef.current < ctx.currentTime + 0.12) {
      const accent = beatCountRef.current % 4 === 0;
      metronomeClick(nextNoteTimeRef.current, accent);
      beatCountRef.current += 1;
      nextNoteTimeRef.current += 60 / bpmRef.current;
    }
    schedulerIdRef.current = setTimeout(schedulerLoop, 25);
  }

  function startMetronome() {
    if (metronomeOnRef.current) return;
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
    metronomeOnRef.current = true;
    setMetronomeOn(true);
    beatCountRef.current = 0;
    nextNoteTimeRef.current = ctx.currentTime + 0.05;
    schedulerLoop();
  }
  function stopMetronome() {
    metronomeOnRef.current = false;
    setMetronomeOn(false);
    if (schedulerIdRef.current) {
      clearTimeout(schedulerIdRef.current);
      schedulerIdRef.current = null;
    }
  }

  function collectLowChordTones() {
    const notesToPlay = [];
    board.forEach((cells, sIdx) => {
      cells.forEach((c) => {
        if (c.active && c.fret <= 5) notesToPlay.push({ ...c, sIdx });
      });
    });
    notesToPlay.sort((a, b) => a.midi - b.midi);
    return notesToPlay;
  }

  async function playArpeggio() {
    if (playing) return;
    setPlaying(true);
    const notesToPlay = collectLowChordTones();
    for (let i = 0; i < notesToPlay.length; i++) {
      pluckNote(notesToPlay[i].midi);
      await new Promise((res) => setTimeout(res, 260));
    }
    setPlaying(false);
  }

  function strumChord() {
    const notesToPlay = collectLowChordTones();
    notesToPlay.forEach((n, i) => pluckNote(n.midi, i * 0.02));
  }

  function saveFavorite() {
    const label =
      favName.trim() ||
      (mode === "Notes" ? `${NOTE_NAMES[root]} notes` : `${NOTE_NAMES[root]} ${activeType}`);
    const fav = {
      id: Date.now().toString(),
      label,
      root,
      mode,
      scaleType,
      chordType,
      tuningName,
      customPC,
      leftHanded,
    };
    const next = [...favorites, fav];
    setFavorites(next);
    setFavName("");
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch (e) {
      // save failed silently
    }
  }

  function loadFavorite(fav) {
    setRoot(fav.root);
    setMode(fav.mode);
    setScaleType(fav.scaleType);
    setChordType(fav.chordType);
    setTuningName(fav.tuningName);
    if (fav.customPC) setCustomPC(fav.customPC);
    setLeftHanded(!!fav.leftHanded);
    setView("Fretboard");
  }

  function deleteFavorite(id) {
    const next = favorites.filter((f) => f.id !== id);
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch (e) {
      // ignore
    }
  }

  function handleQuizTap(sIdx, fret, noteIndex) {
    if (quizFeedback) return;
    if (noteIndex === quizTarget) {
      setQuizFeedback({ sIdx, fret, correct: true });
      setQuizCorrect((c) => c + 1);
      setTimeout(() => {
        setQuizFeedback(null);
        setQuizTarget(Math.floor(Math.random() * 12));
      }, 550);
    } else {
      setQuizFeedback({ sIdx, fret, correct: false });
      setQuizWrong((w) => w + 1);
      setTimeout(() => setQuizFeedback(null), 500);
    }
  }

  function playEtPrompt() {
    if (etSubMode === "Note ID") {
      pluckNote(60 + etNoteTarget);
    } else {
      pluckNote(60);
      pluckNote(60 + etIntervalSemi, 0.6);
    }
  }
  function newEtPrompt(sub) {
    if (sub === "Note ID") setEtNoteTarget(Math.floor(Math.random() * 12));
    else setEtIntervalSemi(1 + Math.floor(Math.random() * 12));
    setEtFeedback(null);
  }
  function answerNote(pc) {
    if (etFeedback) return;
    const correct = pc === etNoteTarget;
    setEtFeedback(correct ? "correct" : "wrong");
    if (correct) setEtCorrect((c) => c + 1);
    else setEtWrong((w) => w + 1);
    setTimeout(() => {
      if (correct) newEtPrompt("Note ID");
      else setEtFeedback(null);
    }, 700);
  }
  function answerInterval(semi) {
    if (etFeedback) return;
    const correct = semi === etIntervalSemi;
    setEtFeedback(correct ? "correct" : "wrong");
    if (correct) setEtCorrect((c) => c + 1);
    else setEtWrong((w) => w + 1);
    setTimeout(() => {
      if (correct) newEtPrompt("Interval ID");
      else setEtFeedback(null);
    }, 700);
  }

  const scaleIntervalsForKey = theoryQuality === "Major" ? SCALES["Major (Ionian)"] : SCALES["Natural Minor (Aeolian)"];
  const qualityPattern = theoryQuality === "Major" ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const romanNumerals = theoryQuality === "Major" ? ROMAN_MAJOR : ROMAN_MINOR;
  const progressionSet = theoryQuality === "Major" ? MAJOR_PROGRESSIONS : MINOR_PROGRESSIONS;
  const diatonicChords = romanNumerals.map((roman, d) => ({
    roman,
    rootPC: (theoryKeyRoot + scaleIntervalsForKey[d]) % 12,
    quality: qualityPattern[d],
  }));

  function romanForChord(rootPC, quality) {
    const hit = diatonicChords.find((c) => c.rootPC === rootPC && c.quality === quality);
    return hit ? hit.roman : null;
  }

  function loadChordToFretboard(rootPC, quality) {
    setRoot(rootPC);
    setChordType(quality);
    setMode("Chord");
    setView("Fretboard");
  }

  // Changing the key transposes whatever progression is already built, rather than
  // just relabeling it — this is what makes "change the key" useful on a progression
  // you've already put together, not only on freshly-loaded presets. Blocked during
  // playback so it can't desync from the chord sequence already scheduled to sound.
  function changeKey(newRoot) {
    if (progPlaying) return;
    const diff = (((newRoot - theoryKeyRoot) % 12) + 12) % 12;
    if (diff !== 0) {
      setProgression((prev) => prev.map((c) => ({ ...c, rootPC: (c.rootPC + diff) % 12 })));
    }
    setTheoryKeyRoot(newRoot);
  }

  function addChordToProgression(rootPC, quality) {
    if (progPlaying) return;
    chordIdRef.current += 1;
    const id = chordIdRef.current;
    setProgression((prev) => [...prev, { rootPC, quality, id }]);
  }

  function removeChordFromProgression(id) {
    if (progPlaying) return;
    setProgression((prev) => prev.filter((c) => c.id !== id));
  }

  function moveChordInProgression(id, dir) {
    if (progPlaying) return;
    setProgression((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function clearProgression() {
    if (progPlaying) return;
    setProgression([]);
  }

  function loadPresetProgression(name) {
    if (progPlaying) return;
    setProgName(name);
    const degrees = progressionSet[name];
    setProgression(
      degrees.map((d) => {
        chordIdRef.current += 1;
        return {
          rootPC: (theoryKeyRoot + scaleIntervalsForKey[d]) % 12,
          quality: qualityPattern[d],
          id: chordIdRef.current,
        };
      })
    );
  }

  async function playProgression() {
    if (progPlaying || progression.length === 0) return;
    setProgPlaying(true);
    try {
      const ctx = getCtx();
      if (ctx.state === "suspended") ctx.resume();
      const safeTempo = Math.min(240, Math.max(40, progTempo));
      const chordDuration = (4 * 60) / safeTempo; // 1 bar of 4 beats per chord
      for (let i = 0; i < progression.length; i++) {
        setPlayingChordIdx(i);
        const chord = progression[i];
        const notes = voicedChordNotes(chord.rootPC, chord.quality);
        const startTime = ctx.currentTime + 0.03;
        notes.forEach((m, ni) => playSynthVoiceNote(ctx, m, startTime + ni * 0.012, chordDuration * 0.92, synthVoice));
        await new Promise((res) => setTimeout(res, chordDuration * 1000));
      }
    } catch (e) {
      // audio not available; fail silently, same as the rest of the app's audio calls
    } finally {
      setPlayingChordIdx(-1);
      setProgPlaying(false);
    }
  }

  const majorIntervals = SCALES["Major (Ionian)"];
  const modeCards = MODE_ORDER.map((name, i) => {
    const rootPC = (theoryModeRoot + majorIntervals[i]) % 12;
    const ints = SCALES[name];
    const extended = [...ints, 12];
    const steps = extended.slice(1).map((v, idx) => v - extended[idx]);
    const formula = steps.map((s) => (s === 1 ? "H" : "W")).join("-");
    return { name, rootPC, formula };
  });

  function loadModeToFretboard(rootPC, name) {
    setRoot(rootPC);
    setScaleType(name);
    setMode("Scale");
    setView("Fretboard");
  }

  const columnOrder = leftHanded ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Fretboard</h1>
        <p style={styles.subtitle}>tap a fret to hear it</p>
        <div role="group" aria-label="Fretboard style" style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8 }}>
          {[["default", "Default"], ["frutiger-aero", "Frutiger Aero"], ["space-galaxy", "Space"]].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)} style={{ ...styles.themePickerBtn, ...(theme === value ? styles.themePickerBtnActive : {}) }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={styles.navRow}>
        {NAV.map((n) => (
          <button
            key={n}
            onClick={() => setView(n)}
            style={{ ...styles.navBtn, ...(view === n ? styles.navBtnActive : {}) }}
          >
            {n}
          </button>
        ))}
      </div>

      {/* ================= FRETBOARD VIEW ================= */}
      {view === "Fretboard" && (
        <>
          <div style={styles.rootRow}>
            {NOTE_NAMES.map((n, i) => (
              <button
                key={n}
                onClick={() => setRoot(i)}
                style={{ ...styles.rootChip, ...(root === i ? styles.rootChipActive : {}) }}
              >
                {n}
              </button>
            ))}
          </div>

          <div style={styles.tuningRow}>
            <span style={styles.tuningLabel}>Tuning</span>
            <select value={tuningName} onChange={(e) => setTuningName(e.target.value)} style={styles.select}>
              {TUNING_NAMES.map((t) => (
                <option key={t} value={t}>
                  {t === "Custom" ? "Custom…" : `${t} (${TUNINGS[t].map((m) => NOTE_NAMES[m % 12]).join(" ")})`}
                </option>
              ))}
            </select>
            <button
              style={{ ...styles.flipBtn, ...(leftHanded ? styles.flipBtnActive : {}) }}
              onClick={() => setLeftHanded((v) => !v)}
              title="Left-handed mode"
            >
              ⇄
            </button>
          </div>

          {tuningName === "Custom" && (
            <div style={styles.customRow}>
              {customPC.map((pc, i) => (
                <select
                  key={i}
                  value={pc}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setCustomPC((prev) => prev.map((p, idx) => (idx === i ? v : p)));
                  }}
                  style={styles.customSelect}
                >
                  {NOTE_NAMES.map((n, ni) => (
                    <option key={n} value={ni}>
                      {n}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          )}

          <div style={styles.tuningRow}>
            <span style={styles.tuningLabel}>Capo</span>
            <div style={styles.capoRow}>
              {CAPO_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCapoFret(c)}
                  style={{ ...styles.capoChip, ...(capoFret === c ? styles.capoChipActive : {}) }}
                >
                  {c === 0 ? "—" : c}
                </button>
              ))}
            </div>
          </div>
          {capoFret > 0 && (
            <p style={styles.hintText}>
              Capo {capoFret} {"\u00b7"} open-position shapes sound {capoFret} semitone{capoFret > 1 ? "s" : ""} higher
            </p>
          )}

          <div style={styles.tabRow}>
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{ ...styles.tab, ...(mode === m ? styles.tabActive : {}) }}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === "Notes" && (
            <div style={{ ...styles.typeRow, justifyContent: "flex-end" }}>
              <div style={styles.labelToggle} role="group" aria-label="Note label format">
                <button
                  type="button"
                  aria-pressed={labelMode === "degree"}
                  onClick={() => setLabelMode("degree")}
                  style={{ ...styles.labelToggleBtn, ...(labelMode === "degree" ? styles.labelToggleActive : {}) }}
                >
                  Degrees
                </button>
                <button
                  type="button"
                  aria-pressed={labelMode === "note"}
                  onClick={() => setLabelMode("note")}
                  style={{ ...styles.labelToggleBtn, ...(labelMode === "note" ? styles.labelToggleActive : {}) }}
                >
                  Notes
                </button>
              </div>
            </div>
          )}

          {mode !== "Notes" && (
            <>
              <div style={styles.typeRow}>
                <select
                  value={mode === "Scale" ? scaleType : chordType}
                  onChange={(e) => (mode === "Scale" ? setScaleType(e.target.value) : setChordType(e.target.value))}
                  style={styles.select}
                >
                  {Object.keys(mode === "Scale" ? SCALES : CHORDS).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>

                {mode === "Arpeggio" && (
                  <button style={styles.playBtn} onClick={playArpeggio} disabled={playing}>
                    {playing ? "Playing…" : "▶ Play"}
                  </button>
                )}
                {mode === "Chord" && (
                  <button style={styles.playBtn} onClick={strumChord}>
                    ▶ Strum
                  </button>
                )}
              </div>

              {(mode === "Chord" || mode === "Arpeggio") && (
                <div style={styles.cagedRow}>
                  {CAGED_SHAPES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setCagedShape((prev) => (prev === s ? null : s))}
                      style={{ ...styles.cagedBtn, ...(cagedShape === s ? styles.cagedBtnActive : {}) }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {cagedActive ? (
                <p style={styles.hintText}>
                  {cagedShape}-shape barre for {NOTE_NAMES[root]} major {"\u00b7"} anchor fret {cagedAnchor === 0 ? "open" : cagedAnchor}
                </p>
              ) : (
                <div style={styles.typeRow}>
                  <select value={positionIdx} onChange={(e) => setPositionIdx(parseInt(e.target.value, 10))} style={styles.select}>
                    {POSITIONS.map((p, i) => (
                      <option key={p.label} value={i}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <div style={styles.labelToggle}>
                    <button
                      onClick={() => setLabelMode("degree")}
                      style={{ ...styles.labelToggleBtn, ...(labelMode === "degree" ? styles.labelToggleActive : {}) }}
                    >
                      Degrees
                    </button>
                    <button
                      onClick={() => setLabelMode("note")}
                      style={{ ...styles.labelToggleBtn, ...(labelMode === "note" ? styles.labelToggleActive : {}) }}
                    >
                      Notes
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <div style={styles.rootLabel}>
            {mode === "Notes" ? `All notes \u00b7 root ${NOTE_NAMES[root]}` : `${NOTE_NAMES[root]} ${activeType}`}
          </div>

          <div style={styles.favSection}>
            <button style={styles.favToggleBtn} onClick={() => setFavOpen((v) => !v)}>
              ☆ Favorites {favorites.length ? `(${favorites.length})` : ""} {favOpen ? "▲" : "▼"}
            </button>
            {favOpen && (
              <div style={styles.favPanel}>
                <div style={styles.favSaveRow}>
                  <input
                    value={favName}
                    onChange={(e) => setFavName(e.target.value)}
                    placeholder="Name this setup…"
                    style={styles.favInput}
                  />
                  <button style={styles.favSaveBtn} onClick={saveFavorite}>
                    Save
                  </button>
                </div>
                {favorites.length > 0 && (
                  <div style={styles.favList}>
                    {favorites.map((f) => (
                      <div key={f.id} style={styles.favChip}>
                        <span onClick={() => loadFavorite(f)} style={styles.favChipLabel}>
                          {f.label}
                        </span>
                        <span onClick={() => deleteFavorite(f.id)} style={styles.favChipDelete}>
                          ×
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={styles.favSection}>
            <button style={styles.favToggleBtn} onClick={() => setMetroOpen((v) => !v)}>
              🎵 Metronome {metronomeOn ? `\u00b7 ${bpm} BPM` : ""} {metroOpen ? "▲" : "▼"}
            </button>
            {metroOpen && (
              <div style={styles.favPanel}>
                <div style={styles.metroRow}>
                  <button style={styles.metroStepBtn} onClick={() => setBpm((b) => Math.max(40, b - 5))}>
                    −
                  </button>
                  <div style={styles.metroBpm}>
                    {bpm}
                    <span style={styles.metroBpmLabel}> BPM</span>
                  </div>
                  <button style={styles.metroStepBtn} onClick={() => setBpm((b) => Math.min(240, b + 5))}>
                    +
                  </button>
                  <div style={{ ...styles.metroPulse, ...(beatPulse ? styles.metroPulseActive : {}) }} />
                </div>
                <button style={styles.playBtnBig} onClick={metronomeOn ? stopMetronome : startMetronome}>
                  {metronomeOn ? "■ Stop" : "▶ Start"}
                </button>
              </div>
            )}
          </div>

          <div style={styles.stage}>
            <div style={styles.tilt}>
              <div style={{ ...styles.board, width: 6 * CELL_W }}>
                <div style={styles.vignette} />
                <div style={styles.headerRow}>
                  {columnOrder.map((sIdx) => (
                    <div key={sIdx} style={styles.stringHeader}>
                      {STRINGS[sIdx].name}
                    </div>
                  ))}
                </div>

                {Array.from({ length: FRET_COUNT }).map((_, i) => {
                  const fret = i + 1;
                  const isCapoBar = capoFret > 0 && fret === capoFret + 1;
                  return (
                    <div
                      key={fret}
                      style={{
                        ...styles.fretRow,
                        ...(isCapoBar ? styles.capoBarRow : {}),
                      }}
                    >
                      {INLAY_FRETS[fret] === 1 && <div style={styles.inlayDotCenter} />}
                      {INLAY_FRETS[fret] === 2 && (
                        <>
                          <div style={{ ...styles.inlayDotCenter, left: "35%" }} />
                          <div style={{ ...styles.inlayDotCenter, left: "65%" }} />
                        </>
                      )}
                      {columnOrder.map((sIdx, colPos) => {
                        const cell = board[sIdx][i];
                        const isRoot = mode === "Notes" && cell.interval === 0;
                        const color =
                          mode === "Notes"
                            ? isRoot
                              ? degreeColor(0)
                              : NEUTRAL_NOTE_COLOR
                            : cell.active
                            ? degreeColor(cell.interval)
                            : null;
                        const label = labelMode === "note" ? NOTE_NAMES[cell.noteIndex] : DEGREE_LABELS[cell.interval];
                        const show = mode === "Notes" ? true : cell.active;
                        const muted = capoFret > 0 && fret <= capoFret;

                        return (
                          <div
                            key={sIdx}
                            style={{
                              ...styles.cell,
                              transform: `translateY(${curveOffset(colPos)}px)`,
                              opacity: muted ? 0.3 : 1,
                              zIndex: show ? 5 : undefined,
                            }}
                            onClick={() => pluckNote(cell.midi)}
                          >
                            {show && (
                              <div
                                style={{
                                  ...styles.noteDot,
                                  background: `radial-gradient(circle at 32% 28%, ${color.hi}, ${color.bg} 70%)`,
                                  color: color.fg,
                                }}
                              >
                                {label}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                <div style={styles.stringLayer}>
                  {columnOrder.map((sIdx, colPos) => (
                    <div
                      key={sIdx}
                      style={{
                        ...styles.stringLine,
                        width: `${GAUGE[sIdx]}px`,
                        left: `${colPos * CELL_W + CELL_W / 2}px`,
                        top: `${curveOffset(colPos)}px`,
                        bottom: `-${curveOffset(colPos)}px`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div style={styles.stageShadow} />
          </div>

          <div style={styles.legend}>
            {mode === "Notes" ? (
              <>
                <LegendItem styles={styles} color="#e0b13a" label="Root" />
                <LegendItem styles={styles} color="#5a4634" label="Note" outline />
              </>
            ) : (
              <>
                <LegendItem styles={styles} color="#e0b13a" label="Root" />
                <LegendItem styles={styles} color="#c65f45" label="3rd" />
                <LegendItem styles={styles} color="#3f8a7c" label="5th" />
                <LegendItem styles={styles} color="#7a63ad" label="7th" />
                <LegendItem styles={styles} color="#9a9082" label="other" />
              </>
            )}
          </div>
        </>
      )}

      {/* ================= PRACTICE VIEW ================= */}
      {view === "Practice" && (
        <>
          <div style={styles.tabRow}>
            {["Note Quiz", "Ear Trainer"].map((t) => (
              <button
                key={t}
                onClick={() => setPracticeTab(t)}
                style={{ ...styles.tab, ...(practiceTab === t ? styles.tabActive : {}) }}
              >
                {t}
              </button>
            ))}
          </div>

          {practiceTab === "Note Quiz" && (
            <>
              <div style={styles.promptCard}>
                <div style={styles.promptLabel}>Find on the neck</div>
                <div style={styles.promptNote}>{NOTE_NAMES[quizTarget]}</div>
                <div style={styles.scoreRow}>
                  <span style={styles.scoreCorrect}>✓ {quizCorrect}</span>
                  <span style={styles.scoreWrong}>✕ {quizWrong}</span>
                  <button
                    style={styles.skipBtn}
                    onClick={() => {
                      setQuizFeedback(null);
                      setQuizTarget(Math.floor(Math.random() * 12));
                    }}
                  >
                    Skip ↻
                  </button>
                </div>
              </div>

              <div style={styles.stage}>
                <div style={styles.tilt}>
                  <div style={{ ...styles.board, width: 6 * CELL_W }}>
                    <div style={styles.vignette} />
                    <div style={styles.headerRow}>
                      {[0, 1, 2, 3, 4, 5].map((sIdx) => (
                        <div key={sIdx} style={styles.stringHeader}>
                          {STRINGS[sIdx].name}
                        </div>
                      ))}
                    </div>
                    {Array.from({ length: QUIZ_FRET_COUNT }).map((_, i) => {
                      const fret = i + 1;
                      return (
                        <div key={fret} style={styles.fretRow}>
                          {INLAY_FRETS[fret] === 1 && <div style={styles.inlayDotCenter} />}
                          {INLAY_FRETS[fret] === 2 && (
                            <>
                              <div style={{ ...styles.inlayDotCenter, left: "35%" }} />
                              <div style={{ ...styles.inlayDotCenter, left: "65%" }} />
                            </>
                          )}
                          {[0, 1, 2, 3, 4, 5].map((sIdx, colPos) => {
                            const midi = STRINGS[sIdx].midi + fret;
                            const noteIndex = midi % 12;
                            const isFlash = quizFeedback && quizFeedback.sIdx === sIdx && quizFeedback.fret === fret;
                            const color = isFlash ? (quizFeedback.correct ? GREEN : RED) : null;
                            return (
                              <div
                                key={sIdx}
                                style={{
                                  ...styles.cell,
                                  transform: `translateY(${curveOffset(colPos)}px)`,
                                  zIndex: isFlash ? 5 : undefined,
                                }}
                                onClick={() => handleQuizTap(sIdx, fret, noteIndex)}
                              >
                                {isFlash && (
                                  <div
                                    style={{
                                      ...styles.noteDot,
                                      background: `radial-gradient(circle at 32% 28%, ${color.hi}, ${color.bg} 70%)`,
                                      color: color.fg,
                                    }}
                                  >
                                    {NOTE_NAMES[noteIndex]}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    <div style={styles.stringLayer}>
                      {[0, 1, 2, 3, 4, 5].map((sIdx, colPos) => (
                        <div
                          key={sIdx}
                          style={{
                            ...styles.stringLine,
                            width: `${GAUGE[sIdx]}px`,
                            left: `${colPos * CELL_W + CELL_W / 2}px`,
                            top: `${curveOffset(colPos)}px`,
                            bottom: `-${curveOffset(colPos)}px`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div style={styles.stageShadow} />
              </div>
            </>
          )}

          {practiceTab === "Ear Trainer" && (
            <>
              <div style={styles.tabRow}>
                {["Note ID", "Interval ID"].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setEtSubMode(s);
                      setEtFeedback(null);
                    }}
                    style={{ ...styles.tab, ...(etSubMode === s ? styles.tabActive : {}) }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div style={styles.promptCard}>
                <div style={styles.promptLabel}>{etSubMode === "Note ID" ? "Listen and identify the note" : "Listen and identify the interval"}</div>
                <button style={styles.playBtnBig} onClick={playEtPrompt}>
                  ▶ Play {etFeedback ? "again" : ""}
                </button>
                {etFeedback && (
                  <div style={etFeedback === "correct" ? styles.feedbackCorrect : styles.feedbackWrong}>
                    {etFeedback === "correct" ? "Correct!" : "Try again"}
                  </div>
                )}
                <div style={styles.scoreRow}>
                  <span style={styles.scoreCorrect}>✓ {etCorrect}</span>
                  <span style={styles.scoreWrong}>✕ {etWrong}</span>
                  <button style={styles.skipBtn} onClick={() => newEtPrompt(etSubMode)}>
                    Skip ↻
                  </button>
                </div>
              </div>

              <div style={styles.answerGrid}>
                {etSubMode === "Note ID"
                  ? NOTE_NAMES.map((n, i) => (
                      <button key={n} style={styles.answerBtn} onClick={() => answerNote(i)}>
                        {n}
                      </button>
                    ))
                  : INTERVAL_NAMES.map((n, i) => (
                      <button key={n} style={styles.answerBtn} onClick={() => answerInterval(i + 1)}>
                        {n}
                      </button>
                    ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ================= THEORY VIEW ================= */}
      {view === "Theory" && (
        <>
          <div style={styles.tabRow}>
            {["Chord Progressions", "Modes Explorer"].map((t) => (
              <button
                key={t}
                onClick={() => setTheoryTab(t)}
                style={{ ...styles.tab, ...(theoryTab === t ? styles.tabActive : {}) }}
              >
                {t}
              </button>
            ))}
          </div>

          {theoryTab === "Chord Progressions" && (
            <>
              <div style={styles.rootRow}>
                {NOTE_NAMES.map((n, i) => (
                  <button
                    key={n}
                    onClick={() => changeKey(i)}
                    disabled={progPlaying}
                    style={{
                      ...styles.rootChip,
                      ...(theoryKeyRoot === i ? styles.rootChipActive : {}),
                      opacity: progPlaying ? 0.5 : 1,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div style={styles.labelToggle}>
                <button
                  onClick={() => {
                    setTheoryQuality("Major");
                    setProgName(Object.keys(MAJOR_PROGRESSIONS)[0]);
                  }}
                  style={{ ...styles.labelToggleBtn, ...(theoryQuality === "Major" ? styles.labelToggleActive : {}) }}
                >
                  Major key
                </button>
                <button
                  onClick={() => {
                    setTheoryQuality("Minor");
                    setProgName(Object.keys(MINOR_PROGRESSIONS)[0]);
                  }}
                  style={{ ...styles.labelToggleBtn, ...(theoryQuality === "Minor" ? styles.labelToggleActive : {}) }}
                >
                  Minor key
                </button>
              </div>

              <p style={styles.sectionLabel}>Tap to add a chord from the key</p>
              <div style={styles.chordChipRow}>
                {diatonicChords.map((c) => (
                  <div
                    key={c.roman}
                    style={{
                      ...styles.paletteChip,
                      opacity: progPlaying ? 0.5 : 1,
                      cursor: progPlaying ? "default" : "pointer",
                    }}
                    onClick={() => addChordToProgression(c.rootPC, c.quality)}
                  >
                    <div style={styles.chordChipRoman}>{c.roman}</div>
                    <div style={styles.chordChipName}>{chordName(c.rootPC, c.quality)}</div>
                  </div>
                ))}
              </div>

              <p style={styles.sectionLabel}>Or add any chord</p>
              <div style={styles.typeRow}>
                <select
                  value={addChordRoot}
                  onChange={(e) => setAddChordRoot(parseInt(e.target.value, 10))}
                  style={styles.select}
                >
                  {NOTE_NAMES.map((n, i) => (
                    <option key={n} value={i}>
                      {n}
                    </option>
                  ))}
                </select>
                <select value={addChordQuality} onChange={(e) => setAddChordQuality(e.target.value)} style={styles.select}>
                  {Object.keys(CHORDS).map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
                <button
                  style={styles.playBtn}
                  disabled={progPlaying}
                  onClick={() => addChordToProgression(addChordRoot, addChordQuality)}
                >
                  + Add
                </button>
              </div>

              <p style={styles.sectionLabel}>Or start from a preset</p>
              <div style={styles.progList}>
                {Object.keys(progressionSet).map((name) => (
                  <button
                    key={name}
                    onClick={() => loadPresetProgression(name)}
                    disabled={progPlaying}
                    style={{ ...styles.progBtn, opacity: progPlaying ? 0.5 : 1 }}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <p style={styles.sectionLabel}>Sound</p>
              <div style={styles.tabRow}>
                {SYNTH_VOICES.map((v) => (
                  <button
                    key={v}
                    onClick={() => setSynthVoice(v)}
                    style={{ ...styles.tab, ...(synthVoice === v ? styles.tabActive : {}) }}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div style={styles.metroRow}>
                <button style={styles.metroStepBtn} onClick={() => setProgTempo((t) => Math.max(40, t - 5))}>
                  −
                </button>
                <div style={styles.metroBpm}>
                  {progTempo}
                  <span style={styles.metroBpmLabel}> BPM</span>
                </div>
                <button style={styles.metroStepBtn} onClick={() => setProgTempo((t) => Math.min(240, t + 5))}>
                  +
                </button>
              </div>

              <div style={styles.progHeaderRow}>
                <p style={styles.sectionLabel}>Your progression</p>
                {progression.length > 0 && (
                  <button style={styles.clearLink} onClick={clearProgression} disabled={progPlaying}>
                    Clear
                  </button>
                )}
              </div>

              {progression.length === 0 ? (
                <p style={styles.hintText}>Add some chords above to build a progression.</p>
              ) : (
                <div style={styles.chordChipRow}>
                  {progression.map((c, i) => (
                    <div
                      key={c.id}
                      style={{ ...styles.chordChip, ...(playingChordIdx === i ? styles.chordChipPlaying : {}) }}
                      onClick={() => loadChordToFretboard(c.rootPC, c.quality)}
                    >
                      <div style={styles.chordChipRoman}>{romanForChord(c.rootPC, c.quality) || "\u2013"}</div>
                      <div style={styles.chordChipName}>{chordName(c.rootPC, c.quality)}</div>
                      <div style={styles.chordChipControls}>
                        <button
                          style={{ ...styles.chordChipCtrlBtn, opacity: i === 0 || progPlaying ? 0.35 : 1 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveChordInProgression(c.id, -1);
                          }}
                          disabled={i === 0 || progPlaying}
                        >
                          ‹
                        </button>
                        <button
                          style={{
                            ...styles.chordChipCtrlBtn,
                            ...styles.chordChipDeleteBtn,
                            opacity: progPlaying ? 0.35 : 1,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeChordFromProgression(c.id);
                          }}
                          disabled={progPlaying}
                        >
                          ×
                        </button>
                        <button
                          style={{
                            ...styles.chordChipCtrlBtn,
                            opacity: i === progression.length - 1 || progPlaying ? 0.35 : 1,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveChordInProgression(c.id, 1);
                          }}
                          disabled={i === progression.length - 1 || progPlaying}
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                style={styles.playBtnBig}
                onClick={playProgression}
                disabled={progPlaying || progression.length === 0}
              >
                {progPlaying ? "Playing…" : "▶ Play progression"}
              </button>
              <p style={styles.hintText}>Tap a built chord to open it on the fretboard.</p>
            </>
          )}

          {theoryTab === "Modes Explorer" && (
            <>
              <div style={styles.rootRow}>
                {NOTE_NAMES.map((n, i) => (
                  <button
                    key={n}
                    onClick={() => setTheoryModeRoot(i)}
                    style={{ ...styles.rootChip, ...(theoryModeRoot === i ? styles.rootChipActive : {}) }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p style={styles.hintText}>The 7 modes of {NOTE_NAMES[theoryModeRoot]} major. Tap one to load it.</p>

              <div style={styles.modeList}>
                {modeCards.map((m) => (
                  <div key={m.name} style={styles.modeCard} onClick={() => loadModeToFretboard(m.rootPC, m.name)}>
                    <div style={styles.modeCardName}>{m.name}</div>
                    <div style={styles.modeCardRoot}>{NOTE_NAMES[m.rootPC]}</div>
                    <div style={styles.modeCardFormula}>{m.formula}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function LegendItem({ styles, color, label, outline }) {
  return (
    <div style={styles.legendItem}>
      <div style={{ ...styles.legendDot, background: color, border: outline ? "1px solid #8a7860" : "none" }} />
      <span>{label}</span>
    </div>
  );
}

const CELL_W = 44;

function getStyles(themeName) {
  const isDefault = themeName === "default";
  const isFrutigerAero = themeName === "frutiger-aero";
  const isSpaceGalaxy = themeName === "space-galaxy";

  // Select theme values
  const theme = isFrutigerAero ? frutigerAeroTheme : isSpaceGalaxy ? spaceGalaxyTheme : {};
  const ui = isDefault
    ? {
        text: "#f3e9d8",
        muted: "#a9977f",
        soft: "#c9bda6",
        emphasis: "#f7dd8f",
        surface: "#241810",
        surfaceAlt: "#2a1d14",
        surfaceDeep: "#211710",
        surfaceBackdrop: "#1c130d",
        surfaceSelected: "#3a2a1c",
        border: "#4a3826",
        borderStrong: "#3a2a1c",
        accent: "#e0b13a",
        accentCool: "#3f8a7c",
        accentAlt: "#7a63ad",
        accentText: "#20140c",
        accentSoft: "#3a2a1c",
        navActive: "linear-gradient(180deg, #f0c363, #c9962e)",
      }
    : isFrutigerAero
    ? {
        text: "#143b50",
        muted: "#356c80",
        soft: "#285c70",
        emphasis: "#07546f",
        surface: "rgba(255,255,255,0.6)",
        surfaceAlt: "rgba(255,255,255,0.78)",
        surfaceDeep: "rgba(224,246,252,0.84)",
        surfaceBackdrop: "rgba(197,232,243,0.86)",
        surfaceSelected: "rgba(190,233,248,0.9)",
        border: "rgba(36,132,164,0.34)",
        borderStrong: "rgba(18,117,151,0.52)",
        accent: "#0c9bc5",
        accentCool: "#37aa9d",
        accentAlt: "#227da0",
        accentText: "#073a4c",
        accentSoft: "rgba(83,190,220,0.34)",
        navActive: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(190,233,248,0.9))",
      }
    : {
        text: "#f0e9ff",
        muted: "#bbabd9",
        soft: "#d0c1e8",
        emphasis: "#dfc9ff",
        surface: "rgba(12,10,30,0.84)",
        surfaceAlt: "rgba(23,15,46,0.92)",
        surfaceDeep: "rgba(8,6,22,0.9)",
        surfaceBackdrop: "rgba(10,10,26,0.88)",
        surfaceSelected: "rgba(73,41,127,0.78)",
        border: "rgba(124,58,237,0.42)",
        borderStrong: "rgba(167,139,250,0.56)",
        accent: "#9b6cff",
        accentCool: "#36c8ff",
        accentAlt: "#7c3aed",
        accentText: "#ffffff",
        accentSoft: "rgba(124,58,237,0.34)",
        navActive: "linear-gradient(135deg, rgba(124,58,237,0.8), rgba(14,165,233,0.34))",
      };

  return {
    page: {
      minHeight: "100vh",
      background: isDefault
        ? "radial-gradient(ellipse at 50% 0%, #2a1c12 0%, #17100a 70%)"
        : theme.pageBackground || "radial-gradient(ellipse at 50% 0%, #2a1c12 0%, #17100a 70%)",
      color: ui.text,
      fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
      padding: "20px 12px 40px",
      boxSizing: "border-box",
    },
    header: { marginBottom: 14, textAlign: "center" },
    title: {
      fontFamily: "ui-serif, Georgia, 'Times New Roman', serif",
      fontSize: 30,
      letterSpacing: 1,
      margin: 0,
      color: ui.emphasis,
    },
    themePickerBtn: { padding: "6px 12px", borderRadius: 6, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 12, fontWeight: 600 },
    themePickerBtnActive: { border: `1px solid ${ui.accent}`, background: ui.accent, color: ui.accentText, boxShadow: isDefault ? "none" : `0 2px 10px ${ui.accentSoft}` },
    subtitle: { fontSize: 12, color: ui.muted, marginTop: 4, letterSpacing: 0.3 },

    navRow: { display: "flex", gap: 6, marginBottom: 16, background: isDefault ? ui.surfaceBackdrop : theme.navBg, borderRadius: 12, padding: 5, border: `1px solid ${ui.border}` },
    navBtn: { flex: 1, padding: "10px 0", borderRadius: 9, border: "none", background: "transparent", color: ui.muted, fontSize: 13, fontWeight: 700 },
    navBtnActive: { background: ui.navActive, color: ui.accentText, boxShadow: isDefault ? "none" : `0 2px 10px ${ui.accentSoft}` },

    rootRow: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 8 },
    rootChip: {
      flex: "0 0 auto",
      minWidth: 40,
      padding: "8px 0",
      borderRadius: 999,
      border: `1px solid ${ui.border}`,
      background: ui.surfaceAlt,
      color: ui.text,
      fontSize: 13,
      fontWeight: 600,
    },
    rootChipActive: { background: ui.accent, color: ui.accentText, border: `1px solid ${ui.accent}`, boxShadow: isDefault ? "none" : `0 0 10px ${ui.accentSoft}` },
    tuningRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
    tuningLabel: { fontSize: 12, color: ui.muted, fontWeight: 600, flex: "0 0 auto" },
    flipBtn: { flex: "0 0 auto", width: 38, height: 38, borderRadius: 8, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 16 },
    flipBtnActive: { background: ui.accentCool, color: ui.accentText, border: `1px solid ${ui.accentCool}` },
    customRow: { display: "flex", gap: 4, marginBottom: 10 },
    customSelect: { flex: 1, padding: "8px 2px", borderRadius: 6, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 12, textAlign: "center" },
    capoRow: { display: "flex", gap: 4, overflowX: "auto", flex: 1 },
    capoChip: { flex: "0 0 auto", minWidth: 30, padding: "8px 0", borderRadius: 999, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 12, fontWeight: 600 },
    capoChipActive: { background: ui.accentAlt, color: ui.accentText, border: `1px solid ${ui.accentAlt}` },
    cagedRow: { display: "flex", gap: 6, marginBottom: 6 },
    cagedBtn: { flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 13, fontWeight: 700 },
    cagedBtnActive: { background: ui.accent, color: ui.accentText, border: `1px solid ${ui.accent}` },
    tabRow: { display: "flex", gap: 4, background: ui.surface, border: `1px solid ${ui.border}`, borderRadius: 10, padding: 4, marginBottom: 10 },
    tab: { flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: "transparent", color: ui.muted, fontSize: 12, fontWeight: 600 },
    tabActive: { background: ui.accentCool, color: ui.accentText },
    typeRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 },
    select: { flex: 1, padding: "10px 8px", borderRadius: 8, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 13 },
    playBtn: { padding: "10px 14px", borderRadius: 8, border: `1px solid ${ui.accent}`, background: ui.accent, color: ui.accentText, fontWeight: 700, fontSize: 13, flex: "0 0 auto" },
    playBtnSmall: { padding: "8px 10px", borderRadius: 8, border: `1px solid ${ui.borderStrong}`, background: ui.accent, color: ui.accentText, fontWeight: 700, fontSize: 12, flex: "0 0 auto" },
    playBtnBig: { width: "100%", padding: "13px 0", borderRadius: 10, border: `1px solid ${ui.accent}`, background: ui.accent, color: ui.accentText, fontWeight: 700, fontSize: 14, marginBottom: 8, boxShadow: isDefault ? "none" : `0 3px 12px ${ui.accentSoft}` },
    labelToggle: { display: "flex", border: `1px solid ${ui.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 10 },
    labelToggleBtn: { flex: 1, padding: "10px 10px", border: "none", background: ui.surfaceAlt, color: ui.muted, fontSize: 12, fontWeight: 600 },
    labelToggleActive: { background: ui.accentAlt, color: ui.accentText },
    rootLabel: { textAlign: "center", fontSize: 13, color: ui.emphasis, letterSpacing: 0.5, margin: "10px 0 10px", fontWeight: 600 },

    favSection: { marginBottom: 12 },
    favToggleBtn: { width: "100%", padding: "9px 0", borderRadius: 8, border: `1px solid ${ui.border}`, background: ui.surface, color: ui.soft, fontSize: 12, fontWeight: 600 },
    favPanel: { marginTop: 8, padding: 10, borderRadius: 8, background: ui.surfaceDeep, border: `1px solid ${ui.border}` },
    audioInfo: { margin: "0 0 10px", color: ui.muted, fontSize: 11, lineHeight: 1.5 },
    audioControl: { display: "flex", flexDirection: "column", gap: 4, margin: "8px 0", color: ui.text, fontSize: 12 },
    humanizeControl: { display: "flex", alignItems: "center", gap: 7, marginTop: 10, color: ui.text, fontSize: 12 },
    accentControl: { accentColor: ui.accent },
    audioError: { color: "#e37a6f", fontSize: 12, margin: "-4px 0 10px" },
    favSaveRow: { display: "flex", gap: 6, marginBottom: 8 },
    favInput: { flex: 1, padding: "8px 10px", borderRadius: 6, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 13 },
    favSaveBtn: { padding: "8px 14px", borderRadius: 6, border: `1px solid ${ui.accent}`, background: ui.accent, color: ui.accentText, fontWeight: 700, fontSize: 12 },
    favList: { display: "flex", flexWrap: "wrap", gap: 6 },
    favChip: { display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: ui.surfaceSelected, fontSize: 12, border: `1px solid ${ui.borderStrong}` },
    favChipLabel: { cursor: "pointer", color: ui.text },
    favChipDelete: { cursor: "pointer", color: isDefault ? "#c65f45" : ui.accentAlt, fontWeight: 700 },

    metroRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
    metroStepBtn: { width: 36, height: 36, borderRadius: 8, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 18, fontWeight: 700 },
    metroBpm: { flex: 1, textAlign: "center", fontSize: 20, fontWeight: 700, color: ui.emphasis },
    metroBpmLabel: { fontSize: 11, color: ui.muted, fontWeight: 600 },
    metroPulse: { width: 14, height: 14, borderRadius: "50%", background: ui.borderStrong, transition: "transform 0.1s, background 0.1s" },
    metroPulseActive: { background: ui.accent, transform: "scale(1.4)" },

    stage: { perspective: "2200px", perspectiveOrigin: "50% 50%", padding: "10px 8px 34px" },
    tilt: { transform: "rotateX(11deg)", transformOrigin: "center center", transformStyle: "preserve-3d", margin: "0 auto" },
    stageShadow: { height: 18, margin: "-14px auto 0", width: "70%", background: "radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)", filter: "blur(2px)" },
    board: {
      background: isDefault
        ? "linear-gradient(180deg, #4a3524 0%, #3a2a1c 40%, #2f2216 100%)"
        : theme.boardBackground || "linear-gradient(180deg, #4a3524 0%, #3a2a1c 40%, #2f2216 100%)",
      borderRadius: 10,
      border: isDefault ? "1px solid #5a4230" : theme.boardBorder || "1px solid #5a4230",
      boxShadow: isDefault
        ? "0 30px 50px -18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -20px 40px rgba(0,0,0,0.35)"
        : theme.boardBoxShadow || "0 30px 50px -18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -20px 40px rgba(0,0,0,0.35)",
      overflow: "hidden",
      position: "relative",
      margin: "0 auto",
    },
    vignette: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      background: "linear-gradient(90deg, rgba(0,0,0,0.4), rgba(0,0,0,0) 16%, rgba(0,0,0,0) 84%, rgba(0,0,0,0.4))",
      zIndex: 3,
    },
    headerRow: {
      display: "flex",
      height: 24,
      background: isDefault ? "linear-gradient(180deg, #5a4230, #4a3524)" : "transparent",
      borderBottom: isDefault ? "1px solid #6b5138" : theme.boardBorder || "1px solid #6b5138",
    },
    stringHeader: { width: CELL_W, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: ui.emphasis, textShadow: isFrutigerAero ? "0 1px 2px rgba(255,255,255,0.85)" : "0 1px 1px rgba(0,0,0,0.5)" },
    openRow: {
      display: "flex",
      height: 42,
      background: isDefault ? "linear-gradient(180deg, #4a3524, #3a2a1c)" : "transparent",
      borderBottom: "4px solid #c7b69b",
      boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
    },
    openCell: { height: 42 },
    openNoteDot: { width: 25, height: 25, fontSize: 10, zIndex: 5 },
    stringLayer: { position: "absolute", top: 26, right: 0, bottom: 0, left: 0, zIndex: 4, pointerEvents: "none" },
    fretRow: {
      display: "flex",
      height: 38,
      position: "relative",
      boxSizing: "border-box",
      borderBottom: isDefault ? "2px solid #aeb4bb" : theme.fretBorder || "2px solid #aeb4bb",
      boxShadow: isDefault ? "0 1px 0 rgba(255,255,255,0.22)" : theme.fretBoxShadow || "0 1px 0 rgba(255,255,255,0.22)",
    },
    capoBarRow: { borderTop: "6px solid #8a8172", boxShadow: "0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)" },
    cell: { width: CELL_W, flex: "0 0 auto", height: "100%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
    stringLine: { position: "absolute", top: 0, bottom: 0, left: "50%", transform: "translateX(-50%)", background: isDefault ? "linear-gradient(90deg, #6b6255, #f0e6d2 45%, #6b6255)" : theme.stringBackground, boxShadow: isDefault ? "0 0 3px rgba(0,0,0,0.6)" : theme.stringBoxShadow, borderRadius: 2 },
    inlayDotCenter: {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: 9,
      height: 9,
      borderRadius: "50%",
      background: isDefault
        ? "radial-gradient(circle at 50% 50%, #cabb98 0%, #b4a37c 60%, #8d7a54 100%)"
        : theme.inlayBackground || "radial-gradient(circle at 50% 50%, #cabb98 0%, #b4a37c 60%, #8d7a54 100%)",
      boxShadow: "inset 0 0 0 1px rgba(30,19,9,0.6), inset 0 2px 3px rgba(0,0,0,0.55), inset 0 -1px 1px rgba(0,0,0,0.25)",
      zIndex: 1,
    },
    noteDot: {
      position: "relative",
      width: 26,
      height: 26,
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      fontWeight: 700,
      boxShadow: isDefault
        ? "0 3px 5px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.25) inset, 0 -2px 4px rgba(0,0,0,0.25) inset"
        : theme.noteDotShadow || "0 3px 5px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.25) inset, 0 -2px 4px rgba(0,0,0,0.25) inset",
      zIndex: 5
    },
    legend: { display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginTop: 16, fontSize: 11, color: ui.soft },
    legendItem: { display: "flex", alignItems: "center", gap: 5 },
    legendDot: { width: 10, height: 10, borderRadius: "50%" },

    promptCard: { background: ui.surface, border: `1px solid ${ui.border}`, borderRadius: 12, padding: "18px 16px", textAlign: "center", marginBottom: 14, boxShadow: isDefault ? "none" : `0 8px 24px ${ui.accentSoft}` },
    promptLabel: { fontSize: 12, color: ui.muted, marginBottom: 6, fontWeight: 600 },
    promptNote: { fontSize: 40, fontWeight: 700, color: ui.emphasis, fontFamily: "ui-serif, Georgia, serif", marginBottom: 10 },
    scoreRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 14, fontSize: 13, marginTop: 8 },
    scoreCorrect: { color: "#7ecb98", fontWeight: 700 },
    scoreWrong: { color: "#e37a6f", fontWeight: 700 },
    skipBtn: { padding: "6px 12px", borderRadius: 999, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.soft, fontSize: 12 },
    feedbackCorrect: { color: "#7ecb98", fontWeight: 700, marginTop: 8 },
    feedbackWrong: { color: "#e37a6f", fontWeight: 700, marginTop: 8 },
    answerGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 4 },
    answerBtn: { padding: "12px 0", borderRadius: 8, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 13, fontWeight: 600 },

    progList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
    progBtn: { padding: "11px 12px", borderRadius: 8, border: `1px solid ${ui.border}`, background: ui.surfaceAlt, color: ui.text, fontSize: 13, textAlign: "left", fontWeight: 600 },
    chordChipRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, justifyContent: "center" },
    chordChip: { background: ui.surfaceAlt, border: `1px solid ${ui.border}`, borderRadius: 10, padding: "10px 14px", textAlign: "center", cursor: "pointer", minWidth: 60 },
    chordChipRoman: { fontSize: 11, color: ui.muted, marginBottom: 4 },
    chordChipName: { fontSize: 16, fontWeight: 700, color: ui.emphasis },
    hintText: { fontSize: 12, color: ui.muted, textAlign: "center", marginTop: 6, marginBottom: 10 },

    sectionLabel: { fontSize: 12, color: ui.muted, fontWeight: 600, margin: "2px 0 8px" },
    paletteChip: { background: ui.surface, border: `1px dashed ${ui.border}`, borderRadius: 10, padding: "10px 14px", textAlign: "center", cursor: "pointer", minWidth: 60 },
    progHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
    clearLink: { border: "none", background: "transparent", color: isDefault ? "#c65f45" : ui.accentCool, fontSize: 12, fontWeight: 600, padding: "2px 4px", cursor: "pointer" },
    chordChipControls: { display: "flex", justifyContent: "center", gap: 4, marginTop: 8 },
    chordChipCtrlBtn: { fontSize: 12, lineHeight: 1, color: ui.soft, padding: "3px 7px", border: `1px solid ${ui.border}`, borderRadius: 6, background: ui.surfaceAlt, fontWeight: 700 },
    chordChipDeleteBtn: { color: isDefault ? "#e37a6f" : ui.accentCool, borderColor: ui.borderStrong },
    chordChipPlaying: { border: `1px solid ${ui.accent}`, boxShadow: `0 0 0 3px ${ui.accentSoft}` },

    modeList: { display: "flex", flexDirection: "column", gap: 8 },
    modeCard: { display: "flex", alignItems: "center", justifyContent: "space-between", background: ui.surfaceAlt, border: `1px solid ${ui.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer" },
    modeCardName: { fontSize: 13, fontWeight: 700, color: ui.text, flex: 1 },
    modeCardRoot: { fontSize: 15, fontWeight: 700, color: ui.emphasis, width: 34, textAlign: "center" },
    modeCardFormula: { fontSize: 11, color: ui.muted, fontFamily: "ui-monospace, monospace" },
  };
}

