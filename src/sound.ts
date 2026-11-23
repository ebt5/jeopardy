// Synthesized Daily Double fanfare (no audio files needed).
let ctx: AudioContext | null = null;

export function playDailyDoubleSound(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);

    // Rising "laser" sweep
    const sweep = ctx.createOscillator();
    const sg = ctx.createGain();
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
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
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
