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

/** Sound for the winning buzzer - triumphant "ding-ding" */
export function playBuzzerWinnerSound(): void {
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
}

/** Sound for buzzer armed - short "beep" */
export function playBuzzerArmedSound(): void {
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
}

/** Sound for phone when you win - celebratory ping */
export function playYouWonSound(): void {
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
}

/** Sound for phone when locked out - low "bonk" */
export function playLockedOutSound(): void {
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
