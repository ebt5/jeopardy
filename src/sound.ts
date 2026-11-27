// Synthesized game-show audio effects & original 60-second Final Jeopardy think music (no audio files needed).
let ctx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Synchronously unlock/resume Web Audio inside a user click gesture to satisfy browser autoplay rules. */
export function unlockAudio(): void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
  } catch {
    /* ignore */
  }
}

export function playDailyDoubleSound(): void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.35;
    master.connect(audioCtx.destination);

    // Rising "laser" sweep
    const sweep = audioCtx.createOscillator();
    const sg = audioCtx.createGain();
    sweep.type = 'sawtooth';
    sweep.frequency.setValueAtTime(180, now);
    sweep.frequency.exponentialRampToValueAtTime(1800, now + 0.7);
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.5, now + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    sweep.connect(sg).connect(master);
    sweep.start(now);
    sweep.stop(now + 0.85);

    // Bright fanfare chord arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = now + 0.75 + i * 0.09;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 1.2);
    });
  } catch {
    /* audio unavailable */
  }
}

// Note frequency helpers for the original 60-second think tune (120 BPM = 120 beats)
const N = {
  A2: 110.0,
  B2: 123.47,
  C3: 130.81,
  Cs3: 138.59,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  Fs3: 185.0,
  G3: 196.0,
  Gs3: 207.65,
  A3: 220.0,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  Fs4: 369.99,
  G4: 392.0,
  Gs4: 415.3,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  Cs5: 554.37,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  Fs5: 739.99,
  G5: 783.99,
  Gs5: 830.61,
  A5: 880.0,
  B5: 987.77,
  C6: 1046.5,
  D6: 1174.66,
} as const;

/**
 * Original quiz-show think tune (NOT the copyrighted Merv Griffin "Think!" melody).
 * 120 beats at 120 BPM = 60 seconds. Built as looping 8-bar phrases with a late build.
 *
 * Sections:
 *  0–16s  (beats 0–31):   bouncy C-major / Am motif + crisp clock ticks
 * 16–32s  (beats 32–63):  answer-phrase variation with warm pads
 * 32–45s  (beats 64–89):  whole-step lift (D major) for second-half energy
 * 45–60s  (beats 90–119): tension climb into the final 15s, resolving into the time-up sting
 */
const THINK_MELODY_120: ReadonlyArray<number | null> = [
  // Phrase A (8 bars / 16 beats) — quirky call
  N.E5, N.G5, null, N.E5,  N.D5, N.E5, N.C5, null,
  N.D5, N.F5, null, N.D5,  N.C5, N.D5, N.A4, null,
  // Phrase A' — answer
  N.E5, N.G5, N.A5, N.G5,  N.E5, N.D5, N.C5, N.E5,
  N.D5, null, N.C5, N.E5,  N.G5, N.E5, N.D5, null,

  // Phrase B (8 bars) — warmer harmonic turn
  N.A5, null, N.G5, N.F5,  N.E5, N.F5, N.A5, null,
  N.G5, null, N.E5, N.D5,  N.C5, N.E5, N.G5, null,
  N.F5, N.A5, N.G5, N.E5,  N.D5, N.F5, N.E5, N.C5,
  N.D5, N.E5, N.G5, null,  N.D5, N.B4, N.C5, null,

  // Phrase C — lifted to D major (second half)
  N.Fs5, N.A5, null, N.Fs5, N.E5, N.Fs5, N.D5, null,
  N.E5, N.G5, null, N.E5,   N.D5, N.E5, N.B4, null,
  N.Fs5, N.A5, N.B5, N.A5,  N.Fs5, N.E5, N.D5, N.Fs5,
  N.E5, null, N.D5, N.Fs5,  N.A5, N.Fs5, N.E5, null,

  // Final 15s tension climb (beats 96–119 = last 12s of melody + lead-in)
  // beats 90–95 continue phrase C cadence, then 96–119 build
  N.G5, N.Fs5, N.E5, N.G5,  N.A5, N.G5, N.Fs5, N.A5,
  N.B5, N.A5, N.G5, N.B5,   N.C6, N.B5, N.A5, N.G5,
  N.A5, N.B5, N.C6, N.D6,   N.C6, N.B5, N.A5, N.G5,
];

const THINK_BASS_120: ReadonlyArray<number> = [
  // Phrase A — C / Am / F / G
  N.C3, N.C3, N.G3, N.G3,   N.A2, N.A2, N.E3, N.E3,
  N.F3, N.F3, N.C3, N.C3,   N.G3, N.G3, N.D3, N.G3,
  N.C3, N.C3, N.G3, N.G3,   N.A2, N.A2, N.E3, N.E3,
  N.F3, N.F3, N.G3, N.G3,   N.C3, N.G3, N.C3, N.G3,

  // Phrase B — F / G / Em / Am / Dm / G / C
  N.F3, N.F3, N.C3, N.C3,   N.G3, N.G3, N.D3, N.D3,
  N.E3, N.E3, N.B2, N.B2,   N.A2, N.A2, N.E3, N.E3,
  N.D3, N.D3, N.A2, N.A2,   N.G3, N.G3, N.C3, N.E3,
  N.F3, N.F3, N.G3, N.G3,   N.G3, N.B2, N.C3, N.G3,

  // Phrase C — D major lift
  N.D3, N.D3, N.A3, N.A3,   N.B2, N.B2, N.Fs3, N.Fs3,
  N.G3, N.G3, N.D3, N.D3,   N.A3, N.A3, N.E3, N.A3,
  N.D3, N.D3, N.A3, N.A3,   N.B2, N.B2, N.Fs3, N.Fs3,
  N.G3, N.G3, N.A3, N.A3,   N.D3, N.A3, N.D3, N.A3,

  // Final climb — rising bass root motion
  N.G3, N.G3, N.E3, N.E3,   N.Fs3, N.Fs3, N.D3, N.D3,
  N.G3, N.G3, N.E3, N.E3,   N.A3, N.A3, N.E3, N.A3,
  N.D3, N.E3, N.Fs3, N.G3,  N.A3, N.A3, N.A3, N.A3,
];

// Warm chord pads every 4 beats from phrase B onward
const PAD_CHORDS: Record<number, ReadonlyArray<number>> = {
  32: [N.F4, N.A4, N.C5],
  36: [N.G4, N.B4, N.D5],
  40: [N.E4, N.G4, N.B4],
  44: [N.A4, N.C5, N.E5],
  48: [N.D4, N.F4, N.A4],
  52: [N.G4, N.B4, N.D5],
  56: [N.F4, N.A4, N.C5],
  60: [N.G4, N.B4, N.D5],
  64: [N.D4, N.Fs4, N.A4],
  68: [N.B3, N.D4, N.Fs4],
  72: [N.G4, N.B4, N.D5],
  76: [N.A4, N.Cs5, N.E5],
  80: [N.D4, N.Fs4, N.A4],
  84: [N.B3, N.D4, N.Fs4],
  88: [N.G4, N.B4, N.D5],
  92: [N.A4, N.Cs5, N.E5],
  96: [N.G4, N.B4, N.D5],
  100: [N.E4, N.G4, N.B4],
  104: [N.Fs4, N.A4, N.D5],
  108: [N.G4, N.B4, N.E5],
  112: [N.A4, N.Cs5, N.E5],
  116: [N.A4, N.D5, N.Fs5],
};

export interface ThinkMusicDiagnostics {
  active: boolean;
  startCount: number;
  stopCount: number;
  beatsScheduled: number;
  lastStartFromSeconds: number | null;
  startedAtMs: number | null;
}

const thinkMusicDiagnostics: ThinkMusicDiagnostics = {
  active: false,
  startCount: 0,
  stopCount: 0,
  beatsScheduled: 0,
  lastStartFromSeconds: null,
  startedAtMs: null,
};

export function getThinkMusicDiagnostics(): ThinkMusicDiagnostics {
  return { ...thinkMusicDiagnostics };
}

export function resetThinkMusicDiagnostics(): void {
  thinkMusicDiagnostics.active = false;
  thinkMusicDiagnostics.startCount = 0;
  thinkMusicDiagnostics.stopCount = 0;
  thinkMusicDiagnostics.beatsScheduled = 0;
  thinkMusicDiagnostics.lastStartFromSeconds = null;
  thinkMusicDiagnostics.startedAtMs = null;
}

function attachThinkMusicTestHook(): void {
  if (typeof window === 'undefined') return;
  (
    window as unknown as {
      __JEOPARDY_THINK_MUSIC__?: {
        getDiagnostics: typeof getThinkMusicDiagnostics;
        reset: typeof resetThinkMusicDiagnostics;
      };
    }
  ).__JEOPARDY_THINK_MUSIC__ = {
    getDiagnostics: getThinkMusicDiagnostics,
    reset: resetThinkMusicDiagnostics,
  };
}

attachThinkMusicTestHook();

/**
 * Starts an original 60-second synthesized clockwork/marimba "think" tune for Final Jeopardy.
 * Accepts an optional elapsed offset in seconds so pause/resume continues smoothly.
 * Returns a stop() function that cleanly fades out and halts scheduling.
 */
export function startFinalJeopardyThinkMusic(startFromSeconds = 0): () => void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return () => {};

  let stopped = false;
  const master = audioCtx.createGain();
  // Living-room TV friendly level — present but not overpowering dialogue
  master.gain.value = 0.22;
  master.connect(audioCtx.destination);

  const beatDuration = 0.5; // 120 BPM -> 120 beats = 60 seconds
  const totalBeats = THINK_MELODY_120.length;
  let step = Math.max(0, Math.floor(startFromSeconds / beatDuration)) % totalBeats;
  let nextNoteTime = audioCtx.currentTime + 0.03;

  thinkMusicDiagnostics.active = true;
  thinkMusicDiagnostics.startCount += 1;
  thinkMusicDiagnostics.lastStartFromSeconds = startFromSeconds;
  thinkMusicDiagnostics.startedAtMs = Date.now();
  // beatsScheduled is cumulative across pause/resume within a diagnostics session
  // (reset only via resetThinkMusicDiagnostics) so E2E can assert continued scheduling.

  const scheduleNoiseTick = (time: number, peak: number, dur: number) => {
    // Short filtered-noise burst ≈ woodblock / brushed snare tip
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 4;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(time);
    src.stop(time + dur + 0.01);
  };

  const scheduleToneTick = (time: number, freq: number, peak: number) => {
    const tickOsc = audioCtx.createOscillator();
    const tickGain = audioCtx.createGain();
    tickOsc.type = 'sine';
    tickOsc.frequency.value = freq;
    tickGain.gain.setValueAtTime(0.0001, time);
    tickGain.gain.exponentialRampToValueAtTime(peak, time + 0.003);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.038);
    tickOsc.connect(tickGain).connect(master);
    tickOsc.start(time);
    tickOsc.stop(time + 0.045);
  };

  const scheduleBeat = (time: number, beatIndex: number) => {
    const idx = beatIndex % totalBeats;
    const mel = THINK_MELODY_120[idx];
    const bass = THINK_BASS_120[idx];
    const inBuild = idx >= 90; // last ~15 seconds
    const inFinalStretch = idx >= 100; // last ~10 seconds

    // Crisp clock-tick: woodblock-ish noise on every beat + pitched tick-tock
    scheduleNoiseTick(time, inFinalStretch ? 0.11 : 0.075, inFinalStretch ? 0.045 : 0.035);
    scheduleToneTick(time, beatIndex % 2 === 0 ? 1180 : 880, inFinalStretch ? 0.14 : 0.1);

    // Subtle off-beat brushed pulse in the final stretch
    if (inFinalStretch) {
      scheduleNoiseTick(time + beatDuration * 0.5, 0.055, 0.03);
      scheduleToneTick(time + beatDuration * 0.5, 1480, 0.06);
    } else if (beatIndex % 2 === 1) {
      // Soft backbeat tick for quiz-show pulse
      scheduleToneTick(time + beatDuration * 0.5, 720, 0.035);
    }

    // Warm marimba / electric-piano lead (triangle + light sine shimmer)
    if (mel !== null) {
      const osc = audioCtx.createOscillator();
      const shimmer = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const shimmerGain = audioCtx.createGain();
      osc.type = 'triangle';
      shimmer.type = 'sine';
      osc.frequency.value = mel;
      shimmer.frequency.value = mel * 2;
      const peak = inBuild ? 0.4 : 0.36;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(peak, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);
      shimmerGain.gain.setValueAtTime(0.0001, time);
      shimmerGain.gain.exponentialRampToValueAtTime(peak * 0.18, time + 0.012);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
      osc.connect(gain).connect(master);
      shimmer.connect(shimmerGain).connect(master);
      osc.start(time);
      osc.stop(time + 0.42);
      shimmer.start(time);
      shimmer.stop(time + 0.32);
    }

    // Soft pizzicato bass — every beat in build, even beats otherwise
    if (beatIndex % 2 === 0 || inBuild) {
      const bOsc = audioCtx.createOscillator();
      const bGain = audioCtx.createGain();
      bOsc.type = 'sine';
      bOsc.frequency.value = bass;
      bGain.gain.setValueAtTime(0.0001, time);
      bGain.gain.exponentialRampToValueAtTime(inBuild ? 0.3 : 0.26, time + 0.012);
      bGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
      bOsc.connect(bGain).connect(master);
      bOsc.start(time);
      bOsc.stop(time + 0.46);
    }

    // Subtle warm chord pad swell every 4 beats
    const pad = PAD_CHORDS[idx];
    if (pad) {
      const padDur = beatDuration * 3.85;
      const padPeak = inBuild ? 0.08 : 0.055;
      for (const freq of pad) {
        const pOsc = audioCtx.createOscillator();
        const pGain = audioCtx.createGain();
        pOsc.type = 'sine';
        pOsc.frequency.value = freq;
        pGain.gain.setValueAtTime(0.0001, time);
        pGain.gain.exponentialRampToValueAtTime(padPeak, time + 0.16);
        pGain.gain.exponentialRampToValueAtTime(0.0001, time + padDur);
        pOsc.connect(pGain).connect(master);
        pOsc.start(time);
        pOsc.stop(time + padDur + 0.04);
      }
    }

    thinkMusicDiagnostics.beatsScheduled += 1;
  };

  const scheduler = () => {
    if (stopped) return;
    // Look ahead far enough for smooth gapless scheduling across timer ticks / re-renders
    const lookahead = audioCtx.currentTime + 0.25;
    while (nextNoteTime < lookahead) {
      scheduleBeat(nextNoteTime, step);
      nextNoteTime += beatDuration;
      step += 1;
    }
  };

  scheduler();
  const intervalId = window.setInterval(scheduler, 50);

  return () => {
    if (stopped) return;
    stopped = true;
    thinkMusicDiagnostics.active = false;
    thinkMusicDiagnostics.stopCount += 1;
    window.clearInterval(intervalId);
    try {
      const now = audioCtx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      window.setTimeout(() => {
        try {
          master.disconnect();
        } catch {
          /* already disconnected */
        }
      }, 180);
    } catch {
      /* audio unavailable */
    }
  };
}

/** Bright resolving sting when the Final Jeopardy countdown hits 0. */
export function playFinalJeopardyTimeUpSound(): void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.38;
    master.connect(audioCtx.destination);

    // Clean quiz-show resolution: rising bell arpeggio into a held tonic
    const tones = [
      { freq: 523.25, at: 0, dur: 0.35 }, // C5
      { freq: 659.25, at: 0.09, dur: 0.35 }, // E5
      { freq: 783.99, at: 0.18, dur: 0.45 }, // G5
      { freq: 1046.5, at: 0.28, dur: 0.7 }, // C6
    ];
    tones.forEach(({ freq, at, dur }) => {
      const t = now + at;
      const osc = audioCtx.createOscillator();
      const shimmer = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const sGain = audioCtx.createGain();
      osc.type = 'triangle';
      shimmer.type = 'sine';
      osc.frequency.value = freq;
      shimmer.frequency.value = freq * 2;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.55, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      sGain.gain.setValueAtTime(0.0001, t);
      sGain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      sGain.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.7);
      osc.connect(gain).connect(master);
      shimmer.connect(sGain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      shimmer.start(t);
      shimmer.stop(t + dur * 0.75);
    });
  } catch {
    /* audio unavailable */
  }
}

/** Plays a quick cue when the host rules a Final Jeopardy response right or wrong. */
export function playFinalJeopardyVerdictSound(correct: boolean): void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.3;
    master.connect(audioCtx.destination);

    const notes = correct ? [523.25, 659.25, 783.99] : [330, 261.63];
    notes.forEach((freq, i) => {
      const t = now + i * (correct ? 0.07 : 0.12);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = correct ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.55, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (correct ? 0.35 : 0.3));
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    /* audio unavailable */
  }
}

/** Plays a crisp chime when revealing a player's Final Jeopardy wager. */
export function playFinalJeopardyWagerRevealSound(): void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.28;
    master.connect(audioCtx.destination);

    const notes = [659.25, 987.77]; // E5 -> B5
    notes.forEach((freq, i) => {
      const t = now + i * 0.07;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  } catch {
    /* audio unavailable */
  }
}
