const RECORDING_OPEN_MIDI = { 6: 38, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64 };
export const SAMPLED_FRETS = [0, 2, 6, 12, 18, 24];
const ROUND_ROBINS = [1, 2];
const MAX_DECODED_SAMPLES = 12;
const MAX_ACTIVE_VOICES = 12;
const VOICE_GAIN = 0.2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Select a real recording on the requested string, near its requested fret. */
export function selectGuitarSample(event, roundRobin = 1) {
  if (!event || !Number.isInteger(event.string) || event.string < 1 || event.string > 6) {
    throw new TypeError("Guitar samples are selected from a physical string number (1–6).");
  }
  if (!Number.isInteger(event.fret) || event.fret < 0 || event.fret > 24) {
    throw new TypeError("Guitar samples are selected from a fret number (0–24).");
  }

  const sourceFret = SAMPLED_FRETS.reduce((nearest, fret) =>
    Math.abs(fret - event.fret) < Math.abs(nearest - event.fret) ? fret : nearest
  );
  const selectedRoundRobin = ROUND_ROBINS.includes(roundRobin) ? roundRobin : ROUND_ROBINS[0];
  const sourceMidi = RECORDING_OPEN_MIDI[event.string] + sourceFret;

  return {
    url: `/audio/guitar/s${event.string}-f${sourceFret}-r${selectedRoundRobin}.mp3`,
    sourceString: event.string,
    sourceFret,
    sourceMidi,
    playbackRate: Math.pow(2, (event.pitchMidi - sourceMidi) / 12),
    roundRobin: selectedRoundRobin,
  };
}

/**
 * Web Audio sample player. Buffers are fetched and decoded only when needed;
 * the LRU cache bounds memory use on long sessions and mobile devices.
 */
export class GuitarAudioEngine {
  constructor({ maxDecodedSamples = MAX_DECODED_SAMPLES, maxVoices = MAX_ACTIVE_VOICES, onError = null } = {}) {
    this.maxDecodedSamples = maxDecodedSamples;
    this.maxVoices = maxVoices;
    this.onError = onError;
    this.context = null;
    this.masterGain = null;
    this.volume = 0.72;
    this.decodedSamples = new Map();
    this.pendingSamples = new Map();
    this.roundRobinCounters = new Map();
    this.activeVoices = new Set();
    this.voicesByString = new Map();
    this.disposed = false;
  }

  getContext() {
    if (this.disposed) throw new Error("The guitar audio engine has been disposed.");
    if (!this.context) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Web Audio is not available in this browser.");
      this.context = new AudioContextConstructor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.context.destination);
    }
    return this.context;
  }

  resume() {
    const context = this.getContext();
    return context.state === "suspended" ? context.resume() : Promise.resolve();
  }

  setVolume(volume) {
    this.volume = clamp(volume, 0, 1);
    if (this.masterGain && this.context) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
    }
  }

  nextRoundRobin(event) {
    const nearestFret = SAMPLED_FRETS.reduce((nearest, fret) =>
      Math.abs(fret - event.fret) < Math.abs(nearest - event.fret) ? fret : nearest
    );
    const key = `${event.string}:${nearestFret}`;
    const next = this.roundRobinCounters.get(key) || 0;
    this.roundRobinCounters.set(key, next + 1);
    return ROUND_ROBINS[next % ROUND_ROBINS.length];
  }

  async loadSample(url) {
    const context = this.getContext();
    if (this.decodedSamples.has(url)) {
      const buffer = this.decodedSamples.get(url);
      this.decodedSamples.delete(url);
      this.decodedSamples.set(url, buffer);
      return buffer;
    }
    if (this.pendingSamples.has(url)) return this.pendingSamples.get(url);

    const pending = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Guitar sample request failed (${response.status}): ${url}`);
      const audioData = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(audioData);
      if (this.disposed) return buffer;

      this.decodedSamples.set(url, buffer);
      while (this.decodedSamples.size > this.maxDecodedSamples) {
        const leastRecentlyUsedUrl = this.decodedSamples.keys().next().value;
        this.decodedSamples.delete(leastRecentlyUsedUrl);
      }
      return buffer;
    })();

    this.pendingSamples.set(url, pending);
    try {
      return await pending;
    } catch (error) {
      this.onError?.(error);
      throw error;
    } finally {
      this.pendingSamples.delete(url);
    }
  }

  prepareEvent(event) {
    const sample = selectGuitarSample(event, this.nextRoundRobin(event));
    return this.loadSample(sample.url).then((buffer) => ({ event, sample, buffer }));
  }

  async playNote(event, { when = null, humanize = false, duration = event.duration } = {}) {
    const context = this.getContext();
    const resumePromise = this.resume();
    const prepared = await this.prepareEvent(event);
    await resumePromise;
    if (this.disposed) return;
    const time = when == null ? context.currentTime + 0.005 : Math.max(context.currentTime + 0.003, when);
    this.schedulePrepared(prepared, time, { humanize, duration });
  }

  async playChord(events, { humanize = false, duration = null } = {}) {
    const picked = events.filter(Boolean).map((event) => ({ ...event, technique: "picked" }));
    return this.playScheduledEvents(picked, { spacingMs: 0, humanize, duration });
  }

  async playStrum(events, direction = "down", { spanMs = 90, humanize = false, duration = null } = {}) {
    const sounding = events
      .filter(Boolean)
      .map((event) => ({ ...event, technique: "strummed" }))
      .sort((a, b) => a.string - b.string);
    if (direction === "down") sounding.reverse();
    return this.playScheduledEvents(sounding, { spacingMs: spanMs, humanize, duration });
  }

  async playSequence(events, { spacingMs = 240, humanize = false, duration = null } = {}) {
    return this.playScheduledEvents(events.filter(Boolean), { spacingMs, humanize, duration });
  }

  async playScheduledEvents(events, { spacingMs = 0, humanize = false, duration = null } = {}) {
    if (!events.length) return;
    const context = this.getContext();
    const resumePromise = this.resume();
    const prepared = await Promise.all(events.map((event) => this.prepareEvent(event)));
    await resumePromise;
    if (this.disposed) return;

    const startAt = context.currentTime + 0.012;
    const stepSeconds = events.length > 1 ? Math.max(0, spacingMs / (events.length - 1) / 1000) : 0;
    prepared.forEach((note, index) => {
      this.schedulePrepared(note, startAt + index * stepSeconds, { humanize, duration: duration ?? note.event.duration });
    });
    return startAt + Math.max(0, events.length - 1) * stepSeconds;
  }

  schedulePrepared({ event, sample, buffer }, when, { humanize, duration }) {
    const context = this.context;
    if (!context || this.disposed) return;

    const previousVoice = this.voicesByString.get(event.string);
    if (previousVoice) this.releaseVoice(previousVoice, when, 0.022);
    while (this.activeVoices.size >= this.maxVoices) {
      const oldestVoice = this.activeVoices.values().next().value;
      this.releaseVoice(oldestVoice, when, 0.012);
    }

    const jitter = humanize ? (Math.random() - 0.5) * 0.006 : 0;
    const time = Math.max(context.currentTime + 0.002, when + jitter);
    const velocityVariation = humanize ? 0.97 + Math.random() * 0.06 : 1;
    const velocity = clamp(event.velocity, 0, 1) * velocityVariation;
    const voiceGain = context.createGain();
    voiceGain.gain.setValueAtTime(Math.max(0.0001, VOICE_GAIN * velocity), time);
    voiceGain.connect(this.masterGain);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(sample.playbackRate, time);
    source.connect(voiceGain);

    const voice = { source, gain: voiceGain, string: event.string, ended: false };
    this.activeVoices.add(voice);
    this.voicesByString.set(event.string, voice);
    source.onended = () => this.finishVoice(voice);

    const noteDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
    if (noteDuration != null && noteDuration < buffer.duration) {
      const releaseAt = time + noteDuration;
      voiceGain.gain.setValueAtTime(Math.max(0.0001, VOICE_GAIN * velocity), releaseAt);
      voiceGain.gain.setTargetAtTime(0.0001, releaseAt, 0.025);
      source.start(time);
      source.stop(releaseAt + 0.09);
    } else {
      source.start(time);
    }
  }

  releaseVoice(voice, when, releaseSeconds) {
    if (!voice || voice.ended) return;
    const now = this.context?.currentTime || 0;
    const releaseAt = Math.max(now + 0.002, when || now + 0.002);
    try {
      voice.gain.gain.cancelScheduledValues(releaseAt);
      voice.gain.gain.setTargetAtTime(0.0001, releaseAt, releaseSeconds);
      voice.source.stop(releaseAt + releaseSeconds * 5);
    } catch {
      this.finishVoice(voice);
    }
  }

  finishVoice(voice) {
    if (!voice || voice.ended) return;
    voice.ended = true;
    this.activeVoices.delete(voice);
    if (this.voicesByString.get(voice.string) === voice) this.voicesByString.delete(voice.string);
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      // Nodes may already be disconnected by the browser.
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.activeVoices) {
      try {
        voice.source.stop();
      } catch {
        // A voice that already ended needs no further cleanup.
      }
      this.finishVoice(voice);
    }
    this.decodedSamples.clear();
    this.pendingSamples.clear();
    this.roundRobinCounters.clear();
    this.voicesByString.clear();
    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }
  }
}
