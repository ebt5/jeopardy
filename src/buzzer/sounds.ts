let ctx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Sound for the winning buzzer on PHONE - triumphant "ding-ding" */
export function playBuzzerWinnerSound(): void {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.4;
    master.connect(audioCtx.destination);

    // Bright bell-like tones
    const notes = [880, 1108.73, 1318.51]; // A5, C#6, E6 (A major triad)
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = now + i * 0.06;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);

      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  } catch {
    /* ignore audio errors so buzzer state transitions never abort */
  }
}

/** Sound for HOST when someone buzzes in - punchy electronic "DING!" */
export function playHostBuzzInSound(): void {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.5;
    master.connect(audioCtx.destination);

    // Main bell strike - bright and punchy
    const bell = audioCtx.createOscillator();
    const bellGain = audioCtx.createGain();
    bell.type = 'sine';
    bell.frequency.value = 1200; // High bright tone
    bellGain.gain.setValueAtTime(0.8, now);
    bellGain.gain.exponentialRampToValueAtTime(0.3, now + 0.05);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    bell.connect(bellGain).connect(master);
    bell.start(now);
    bell.stop(now + 0.4);

    // Harmonic overtone for richness
    const overtone = audioCtx.createOscillator();
    const overtoneGain = audioCtx.createGain();
    overtone.type = 'sine';
    overtone.frequency.value = 2400; // Octave above
    overtoneGain.gain.setValueAtTime(0.3, now);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    overtone.connect(overtoneGain).connect(master);
    overtone.start(now);
    overtone.stop(now + 0.25);

    // Low "thump" for impact
    const thump = audioCtx.createOscillator();
    const thumpGain = audioCtx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(80, now + 0.08);
    thumpGain.gain.setValueAtTime(0.5, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    thump.connect(thumpGain).connect(master);
    thump.start(now);
    thump.stop(now + 0.15);
  } catch {
    /* ignore audio errors */
  }
}

/** Sound for buzzer armed - short "beep" */
export function playBuzzerArmedSound(): void {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 660; // E5

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    /* ignore audio errors */
  }
}

/** Sound for phone when you win - celebratory ping */
export function playYouWonSound(): void {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.5;
    master.connect(audioCtx.destination);

    // Rising arpeggio
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const start = now + i * 0.08;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.6, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);

      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    /* ignore audio errors */
  }
}

/** Sound for phone when locked out - low "bonk" */
export function playLockedOutSound(): void {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    /* ignore audio errors */
  }
}

/** Trigger haptic feedback if supported */
export function vibrate(pattern: number | number[] = 50): void {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration not supported
  }
}
