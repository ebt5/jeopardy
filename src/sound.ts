// Synthesized game-show audio effects & original Final Jeopardy think music (no audio files needed).
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

/**
 * Starts an original synthesized clockwork/marimba "think" music loop for Final Jeopardy.
 * Returns a stop() function that cleanly fades out and halts scheduling.
 */
export function startFinalJeopardyThinkMusic(): () => void {
  const audioCtx = getAudioContext();
  if (!audioCtx) return () => {};

  let stopped = false;
  const master = audioCtx.createGain();
  master.gain.value = 0.24;
  master.connect(audioCtx.destination);

  // Original 16-beat quiz-show contemplation groove in D minor / F major (120 BPM = 0.5s/beat).
  // Distinct warm marimba pulse + subtle walking bass + soft clockwork tick.
  const melodyHz: ReadonlyArray<number | null> = [
    587.33, 659.25, 698.46, 587.33, // D5 E5 F5 D5
    523.25, 587.33, 659.25, null,   // C5 D5 E5 (rest)
    698.46, 783.99, 880.0,  698.46, // F5 G5 A5 F5
    659.25, 587.33, 523.25, null,   // E5 D5 C5 (rest)
  ];

  const bassHz: ReadonlyArray<number> = [
    146.83, 146.83, 174.61, 174.61, // D3, F3
    130.81, 130.81, 164.81, 164.81, // C3, E3
    174.61, 174.61, 220.0,  220.0,  // F3, A3
    164.81, 146.83, 130.81, 164.81, // E3, D3, C3, E3
  ];

  const beatDuration = 0.5;
  let step = 0;
  let nextNoteTime = audioCtx.currentTime + 0.05;

  const scheduleBeat = (time: number, beatIndex: number) => {
    const idx = beatIndex % melodyHz.length;
    const mel = melodyHz[idx];
    const bass = bassHz[idx];

    // Gentle clockwork woodblock tick-tock on every beat
    const tickOsc = audioCtx.createOscillator();
    const tickGain = audioCtx.createGain();
    tickOsc.type = 'sine';
    tickOsc.frequency.value = beatIndex % 2 === 0 ? 1040 : 820;
    tickGain.gain.setValueAtTime(0.0001, time);
    tickGain.gain.exponentialRampToValueAtTime(0.14, time + 0.004);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    tickOsc.connect(tickGain).connect(master);
    tickOsc.start(time);
    tickOsc.stop(time + 0.055);

    // Warm marimba-like melodic note
    if (mel !== null) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = mel;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.45, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
      osc.connect(gain).connect(master);
      osc.start(time);
      osc.stop(time + 0.38);
    }

    // Soft pizzicato bass pulse on even beats
    if (beatIndex % 2 === 0) {
      const bOsc = audioCtx.createOscillator();
      const bGain = audioCtx.createGain();
      bOsc.type = 'sine';
      bOsc.frequency.value = bass;
      bGain.gain.setValueAtTime(0.0001, time);
      bGain.gain.exponentialRampToValueAtTime(0.35, time + 0.015);
      bGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
      bOsc.connect(bGain).connect(master);
      bOsc.start(time);
      bOsc.stop(time + 0.46);
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

/** Gentle resolving double-chime when the Final Jeopardy countdown hits 0. */
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
