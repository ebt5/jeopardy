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
  // Bass / low octave
  A2: 110.0,
  B2: 123.47,
  C3: 130.81,
  Cs3: 138.59,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  Fs3: 185.0,
  G3: 196.0,
  A3: 220.0,
  B3: 246.94,
  // Mid chord tones
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  Fs4: 369.99,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  // Lead marimba octave
  C5: 523.25,
  Cs5: 554.37,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  Fs5: 739.99,
  G5: 783.99,
  A5: 880.0,
  B5: 987.77,
  C6: 1046.5,
} as const;

// 120-beat (60-second) original 4-part progression at 120 BPM (0.5s/beat):
// - Section 1 (beats 0-31,  0-16s): Warm inquisitive motif in C major / A minor
// - Section 2 (beats 32-63, 16-32s): Expressive answer phrase with gentle chord pads
// - Section 3 (beats 64-95, 32-48s): Bright whole-step lift to D major / B minor
// - Section 4 (beats 96-119, 48-60s): Rising final-12-seconds tension resolving into time-up
const THINK_MELODY_120: ReadonlyArray<number | null> = [
  // Section 1 (32 beats — C / Am / F / G)
  N.E5, N.G5, N.A5, N.G5,  N.E5, N.D5, N.C5, null,
  N.D5, N.E5, N.G5, N.E5,  N.D5, N.C5, N.A4, null,
  N.C5, N.E5, N.F5, N.E5,  N.D5, N.F5, N.A5, N.G5,
  N.E5, N.D5, N.E5, N.G5,  N.D5, null, N.C5, null,

  // Section 2 (32 beats — F / G / Em / Am / Dm / G7 / C)
  N.A5, N.G5, N.F5, N.E5,  N.F5, N.A5, N.G5, null,
  N.G5, N.E5, N.D5, N.C5,  N.E5, N.G5, N.A5, null,
  N.F5, N.E5, N.D5, N.F5,  N.E5, N.D5, N.C5, N.E5,
  N.D5, N.F5, N.G5, N.E5,  N.D5, N.B4, N.C5, null,

  // Section 3 (32 beats — modulates up to D major / B minor for second-half lift)
  N.Fs5, N.A5, N.B5, N.A5,  N.Fs5, N.E5, N.D5, null,
  N.E5, N.Fs5, N.A5, N.Fs5, N.E5, N.D5, N.B4, null,
  N.D5, N.Fs5, N.G5, N.Fs5, N.E5, N.G5, N.B5, N.A5,
  N.Fs5, N.E5, N.Fs5, N.A5, N.E5, null, N.D5, null,

  // Section 4 (24 beats — final 12 seconds rising anticipation -> resolves cleanly at 60s)
  N.G5, N.Fs5, N.E5, N.G5,  N.A5, N.G5, N.Fs5, N.A5,
  N.B5, N.A5, N.G5, N.B5,   N.A5, N.G5, N.Fs5, N.E5,
  N.Fs5, N.G5, N.A5, N.B5,  N.A5, N.G5, N.Fs5, N.E5,
];

const THINK_BASS_120: ReadonlyArray<number> = [
  // Section 1
  N.C3, N.C3, N.G3, N.G3,   N.A2, N.A2, N.E3, N.E3,
  N.F3, N.F3, N.C3, N.C3,   N.G3, N.G3, N.D3, N.G3,
  N.C3, N.C3, N.F3, N.F3,   N.D3, N.D3, N.G3, N.G3,
  N.A2, N.A2, N.F3, N.F3,   N.G3, N.G3, N.C3, N.G3,

  // Section 2
  N.F3, N.F3, N.C3, N.C3,   N.G3, N.G3, N.D3, N.D3,
  N.E3, N.E3, N.B2, N.B2,   N.A2, N.A2, N.E3, N.E3,
  N.D3, N.D3, N.A2, N.A2,   N.G3, N.G3, N.C3, N.E3,
  N.F3, N.F3, N.G3, N.G3,   N.G3, N.B2, N.C3, N.G3,

  // Section 3 (D major)
  N.D3, N.D3, N.A3, N.A3,   N.B2, N.B2, N.Fs3, N.Fs3,
  N.G3, N.G3, N.D3, N.D3,   N.A3, N.A3, N.E3, N.A3,
  N.D3, N.D3, N.G3, N.G3,   N.E3, N.E3, N.A3, N.A3,
  N.B2, N.B2, N.G3, N.G3,   N.A3, N.A3, N.D3, N.A3,

  // Section 4 (Final 12 seconds build)
  N.G3, N.G3, N.E3, N.E3,   N.Fs3, N.Fs3, N.D3, N.D3,
  N.G3, N.G3, N.E3, N.E3,   N.A3, N.A3, N.E3, N.A3,
  N.D3, N.E3, N.Fs3, N.G3,  N.A3, N.A3, N.A3, N.A3,
];

// Gentle chord pad root every 4 beats in sections 2-4 to keep the 60s track warm & evolving
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
  68: [N.B4, N.D5, N.Fs5],
  72: [N.G4, N.B4, N.D5],
  76: [N.A4, N.Cs5, N.E5],
  80: [N.D4, N.Fs4, N.A4],
  84: [N.E4, N.G4, N.B4],
  88: [N.B4, N.D5, N.Fs5],
  92: [N.A4, N.Cs5, N.E5],
  96: [N.G4, N.B4, N.D5],
  100: [N.Fs4, N.A4, N.D5],
  104: [N.G4, N.B4, N.E5],
  108: [N.A4, N.Cs5, N.E5],
  112: [N.D4, N.Fs4, N.A4],
  116: [N.A4, N.Cs5, N.E5],
};

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
  master.gain.value = 0.24;
  master.connect(audioCtx.destination);

  const beatDuration = 0.5; // 120 BPM -> 120 beats = 60 seconds
  let step = Math.max(0, Math.floor(startFromSeconds / beatDuration)) % THINK_MELODY_120.length;
  let nextNoteTime = audioCtx.currentTime + 0.04;

  const scheduleTick = (time: number, freq: number, peak: number) => {
    const tickOsc = audioCtx.createOscillator();
    const tickGain = audioCtx.createGain();
    tickOsc.type = 'sine';
    tickOsc.frequency.value = freq;
    tickGain.gain.setValueAtTime(0.0001, time);
    tickGain.gain.exponentialRampToValueAtTime(peak, time + 0.004);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.042);
    tickOsc.connect(tickGain).connect(master);
    tickOsc.start(time);
    tickOsc.stop(time + 0.05);
  };

  const scheduleBeat = (time: number, beatIndex: number) => {
    const idx = beatIndex % THINK_MELODY_120.length;
    const mel = THINK_MELODY_120[idx];
    const bass = THINK_BASS_120[idx];
    const inFinalStretch = idx >= 100; // Final 10 seconds

    // Gentle clockwork woodblock tick-tock on every beat
    scheduleTick(time, beatIndex % 2 === 0 ? 1040 : 820, inFinalStretch ? 0.17 : 0.12);

    // Subtle off-beat pulse in the last 10 seconds for crisp game-show energy
    if (inFinalStretch) {
      scheduleTick(time + beatDuration * 0.5, 1320, 0.08);
    }

    // Warm marimba-like melodic note
    if (mel !== null) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = mel;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.42, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.36);
      osc.connect(gain).connect(master);
      osc.start(time);
      osc.stop(time + 0.4);
    }

    // Soft pizzicato bass pulse on even beats (and every beat in final 4s)
    if (beatIndex % 2 === 0 || idx >= 112) {
      const bOsc = audioCtx.createOscillator();
      const bGain = audioCtx.createGain();
      bOsc.type = 'sine';
      bOsc.frequency.value = bass;
      bGain.gain.setValueAtTime(0.0001, time);
      bGain.gain.exponentialRampToValueAtTime(0.32, time + 0.014);
      bGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.4);
      bOsc.connect(bGain).connect(master);
      bOsc.start(time);
      bOsc.stop(time + 0.44);
    }

    // Subtle warm chord pad swell every 4 beats in sections 2–4
    const pad = PAD_CHORDS[idx];
    if (pad) {
      const padDur = beatDuration * 3.8;
      for (const freq of pad) {
        const pOsc = audioCtx.createOscillator();
        const pGain = audioCtx.createGain();
        pOsc.type = 'sine';
        pOsc.frequency.value = freq;
        pGain.gain.setValueAtTime(0.0001, time);
        pGain.gain.exponentialRampToValueAtTime(0.065, time + 0.18);
        pGain.gain.exponentialRampToValueAtTime(0.0001, time + padDur);
        pOsc.connect(pGain).connect(master);
        pOsc.start(time);
        pOsc.stop(time + padDur + 0.05);
      }
    }
  };

  const scheduler = () => {
    if (stopped) return;
    const lookahead = audioCtx.currentTime + 0.2;
    while (nextNoteTime < lookahead) {
      scheduleBeat(nextNoteTime, step);
      nextNoteTime += beatDuration;
      step++;
    }
  };

  scheduler();
  const intervalId = window.setInterval(scheduler, 80);

  return () => {
    if (stopped) return;
    stopped = true;
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

/** Gentle resolving chime when the Final Jeopardy countdown hits 0. */
export function playFinalJeopardyTimeUpSound(): void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.35;
    master.connect(audioCtx.destination);

    const tones = [587.33, 440.0, 587.33]; // D5 -> A4 -> D5
    tones.forEach((freq, i) => {
      const t = now + i * 0.14;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.55, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.5);
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
