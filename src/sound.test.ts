/**
 * Unit tests for Final Jeopardy think-music scheduling / lifecycle.
 * Run: npx tsx src/sound.test.ts
 */

function createMockAudioContext() {
  let currentTime = 0;
  let oscCount = 0;
  let bufferCount = 0;

  const gainProto = () => ({
    gain: {
      value: 1,
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
    },
    connect(dest: unknown) {
      return dest ?? this;
    },
    disconnect() {},
  });

  return {
    get currentTime() {
      return currentTime;
    },
    sampleRate: 44100,
    state: 'running' as const,
    destination: {},
    resume: async () => {},
    createGain: () => gainProto(),
    createOscillator: () => {
      oscCount += 1;
      return {
        type: 'sine',
        frequency: {
          value: 440,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect(dest: unknown) {
          return dest;
        },
        start() {},
        stop() {},
      };
    },
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      bufferCount += 1;
      return {
        buffer: null as unknown,
        connect(dest: unknown) {
          return dest;
        },
        start() {},
        stop() {},
      };
    },
    createBiquadFilter: () => ({
      type: 'bandpass',
      frequency: { value: 1000 },
      Q: { value: 1 },
      connect(dest: unknown) {
        return dest;
      },
    }),
    advance(seconds: number) {
      currentTime += seconds;
    },
    getOscCount: () => oscCount,
    getBufferCount: () => bufferCount,
  };
}

async function runTests() {
  console.log('Running sound / think-music tests...\n');
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${e}`);
      failed++;
    }
  }

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function assertEquals<T>(actual: T, expected: T, message?: string) {
    if (actual !== expected) {
      throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
    }
  }

  const mockCtx = createMockAudioContext();
  const intervalHandles: ReturnType<typeof setInterval>[] = [];

  // Install browser-like globals before importing sound.ts
  const g = globalThis as unknown as {
    window: Record<string, unknown>;
    AudioContext: new () => unknown;
  };
  g.AudioContext = function AudioContext() {
    return mockCtx;
  } as unknown as new () => unknown;
  g.window = {
    AudioContext: g.AudioContext,
    setInterval: (fn: TimerHandler, ms?: number) => {
      const handle = setInterval(fn, ms);
      intervalHandles.push(handle);
      return handle;
    },
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  };

  const sound = await import('./sound.ts');
  sound.resetThinkMusicDiagnostics();

  await test('think music stays active and keeps scheduling across multiple timer ticks', async () => {
    sound.resetThinkMusicDiagnostics();
    const stop = sound.startFinalJeopardyThinkMusic(0);
    assert(sound.getThinkMusicDiagnostics().active, 'active after start');
    assertEquals(sound.getThinkMusicDiagnostics().startCount, 1);

    const beatsAtStart = sound.getThinkMusicDiagnostics().beatsScheduled;
    assert(beatsAtStart >= 1, 'should schedule an initial lookahead beat');

    for (let i = 0; i < 6; i++) {
      mockCtx.advance(0.5);
      await new Promise((r) => setTimeout(r, 55));
    }

    const diag = sound.getThinkMusicDiagnostics();
    assert(diag.active, 'still active after several ticks');
    assert(
      diag.beatsScheduled > beatsAtStart,
      `beats should increase across ticks (start=${beatsAtStart}, now=${diag.beatsScheduled})`,
    );
    assert(mockCtx.getOscCount() + mockCtx.getBufferCount() > 0, 'audio nodes scheduled');

    stop();
    assert(!sound.getThinkMusicDiagnostics().active, 'inactive after stop');
    assertEquals(sound.getThinkMusicDiagnostics().stopCount, 1);
  });

  await test('stop is idempotent', () => {
    sound.resetThinkMusicDiagnostics();
    const stop = sound.startFinalJeopardyThinkMusic(12);
    stop();
    stop();
    assertEquals(sound.getThinkMusicDiagnostics().stopCount, 1);
    assertEquals(sound.getThinkMusicDiagnostics().lastStartFromSeconds, 12);
    assert(!sound.getThinkMusicDiagnostics().active);
  });

  await test('pause then resume from elapsed continues scheduling', async () => {
    sound.resetThinkMusicDiagnostics();
    const stop1 = sound.startFinalJeopardyThinkMusic(0);
    mockCtx.advance(2);
    await new Promise((r) => setTimeout(r, 55));
    const beatsBeforePause = sound.getThinkMusicDiagnostics().beatsScheduled;
    stop1();
    assert(!sound.getThinkMusicDiagnostics().active);

    const stop2 = sound.startFinalJeopardyThinkMusic(2);
    const beatsRightAfterResumeStart = sound.getThinkMusicDiagnostics().beatsScheduled;
    mockCtx.advance(2);
    await new Promise((r) => setTimeout(r, 55));
    const diag = sound.getThinkMusicDiagnostics();
    assert(diag.active);
    assertEquals(diag.startCount, 2);
    assert(
      beatsRightAfterResumeStart >= beatsBeforePause,
      'cumulative beats should not reset on resume',
    );
    assert(
      diag.beatsScheduled > beatsRightAfterResumeStart,
      'more beats should schedule after resume',
    );
    stop2();
  });

  await test('time-up sting schedules audio without throwing', () => {
    const before = mockCtx.getOscCount();
    sound.playFinalJeopardyTimeUpSound();
    assert(mockCtx.getOscCount() > before, 'time-up should create oscillators');
  });

  await test('window diagnostics hook is available for Playwright E2E', () => {
    const hook = (
      g.window as {
        __JEOPARDY_THINK_MUSIC__?: { getDiagnostics: () => unknown; reset: () => void };
      }
    ).__JEOPARDY_THINK_MUSIC__;
    assert(hook && typeof hook.getDiagnostics === 'function', 'missing __JEOPARDY_THINK_MUSIC__ hook');
    assert(hook && typeof hook.reset === 'function', 'missing reset on hook');
  });

  for (const handle of intervalHandles) {
    clearInterval(handle);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void runTests();
