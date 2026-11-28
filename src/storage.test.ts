/**
 * Unit tests for preset refresh / saved-board merge.
 * Run: npx tsx src/storage.test.ts
 */

async function runTests() {
  console.log('Running storage / preset-refresh tests...\n');
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
      throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: () => null,
    length: 0,
  };
  (globalThis as unknown as { window: { location: { search: string }; history: { replaceState: () => void } } }).window = {
    location: { search: '' },
    history: { replaceState() {} },
  };

  const storage = await import('./storage.ts');
  const { SAVED_BOARDS_KEY, STORAGE_KEY } = await import('./types.ts');

  const reynolds = storage.PRESET_BOARDS.find((b) => b.slug === 'reynolds');
  assert(reynolds, 'reynolds preset must exist');
  assertEquals(reynolds.name, 'Reynolds Family TG');

  const parade800 = reynolds.categories
    .find((c) => c.name === 'PARADES & PIGSKIN')
    ?.clues.find((c) => c.value === 800);
  assert(parade800?.dailyDouble === true, 'PARADES $800 must be Daily Double');
  assertEquals(parade800?.question, 'Who is John Madden?');
  assertEquals(reynolds.finalJeopardy.category, 'THANKSGIVING HISTORY');

  await test('isPresetNewerThanStored compares timestamps correctly', () => {
    assert(
      storage.isPresetNewerThanStored('2026-11-27T17:30:00-07:00', '2026-11-27T10:00:00-07:00'),
      'newer bundled should win',
    );
    assert(
      !storage.isPresetNewerThanStored('2026-11-27T10:00:00-07:00', '2026-11-27T17:30:00-07:00'),
      'older bundled should not win',
    );
    assert(
      storage.isPresetNewerThanStored('2026-11-27T17:30:00-07:00', undefined),
      'missing stored savedAt should refresh',
    );
  });

  await test('refreshStalePresetBoards replaces old Reynolds by id and leaves user boards alone', () => {
    const userBoard = {
      id: 'board-user-123',
      name: 'My Custom Board',
      savedAt: '2020-01-01T00:00:00.000Z',
      categories: [],
      finalJeopardy: { category: 'X', answer: 'a', question: 'q' },
    };
    const staleReynolds = {
      id: 'preset-reynolds-family-tg',
      name: 'Reynolds Family TG',
      savedAt: '2026-11-27T10:00:00-07:00',
      categories: [
        {
          name: 'PARADES & PIGSKIN',
          clues: [
            {
              value: 800,
              answer: 'OLD',
              question: 'What is Miracle on 34th Street?',
              played: false,
              dailyDouble: true,
            },
          ],
        },
      ],
      finalJeopardy: {
        category: 'PRESIDENTS',
        answer: 'old',
        question: 'Who is Franklin D. Roosevelt?',
      },
    };

    const { boards, didChange } = storage.refreshStalePresetBoards([
      staleReynolds,
      userBoard,
    ]);
    assert(didChange, 'should report change');
    assertEquals(boards.length, 2);
    assertEquals(boards[1].id, 'board-user-123', 'user board preserved');
    assertEquals(boards[1].name, 'My Custom Board');
    const refreshed = boards[0];
    assertEquals(refreshed.id, 'preset-reynolds-family-tg');
    assertEquals(refreshed.savedAt, reynolds.savedAt);
    const q = refreshed.categories
      .find((c) => c.name === 'PARADES & PIGSKIN')
      ?.clues.find((c) => c.value === 800)?.question;
    assertEquals(q, 'Who is John Madden?');
    assertEquals(refreshed.finalJeopardy.category, 'THANKSGIVING HISTORY');
  });

  await test('loadSavedBoards refreshes stale Reynolds in localStorage and persists it', () => {
    store[SAVED_BOARDS_KEY] = JSON.stringify([
      {
        id: 'preset-reynolds-family-tg',
        name: 'Reynolds Family TG',
        savedAt: '2026-11-27T10:00:00-07:00',
        categories: [
          {
            name: 'PARADES & PIGSKIN',
            clues: [
              {
                value: 800,
                answer: 'OLD CLUE',
                question: 'What is Miracle on 34th Street?',
                played: false,
                dailyDouble: true,
              },
            ],
          },
        ],
        finalJeopardy: {
          category: 'PRESIDENTS',
          answer: 'old',
          question: 'Who is Franklin D. Roosevelt?',
        },
      },
      {
        id: 'board-keep-me',
        name: 'Erik Custom',
        savedAt: '2026-01-01T00:00:00.000Z',
        categories: [],
        finalJeopardy: { category: 'C', answer: 'a', question: 'q' },
      },
    ]);

    const boards = storage.loadSavedBoards();
    const reynoldsLoaded = boards.find((b) => b.id === 'preset-reynolds-family-tg');
    assert(reynoldsLoaded, 'reynolds present');
    assertEquals(
      reynoldsLoaded.categories
        .find((c) => c.name === 'PARADES & PIGSKIN')
        ?.clues.find((c) => c.value === 800)?.question,
      'Who is John Madden?',
    );
    assertEquals(reynoldsLoaded.finalJeopardy.category, 'THANKSGIVING HISTORY');
    assert(
      boards.some((b) => b.id === 'board-keep-me' && b.name === 'Erik Custom'),
      'user board must remain',
    );

    // Persisted back to localStorage
    const persisted = JSON.parse(store[SAVED_BOARDS_KEY]) as Array<{
      id: string;
      savedAt: string;
      finalJeopardy: { category: string };
    }>;
    const persistedReynolds = persisted.find((b) => b.id === 'preset-reynolds-family-tg');
    assertEquals(persistedReynolds?.savedAt, reynolds.savedAt);
    assertEquals(persistedReynolds?.finalJeopardy.category, 'THANKSGIVING HISTORY');
    assert(
      persisted.some((b) => b.id === 'board-keep-me'),
      'user board still in localStorage',
    );
  });

  await test('loadGameConfig overlays latest preset when boardName matches Reynolds', () => {
    store[STORAGE_KEY] = JSON.stringify({
      boardName: 'Reynolds Family TG',
      players: [{ id: 'p1', name: 'Erik', score: 0 }],
      categories: [
        {
          name: 'PARADES & PIGSKIN',
          clues: [
            {
              value: 800,
              answer: 'stale',
              question: 'What is Miracle on 34th Street?',
              played: false,
              dailyDouble: true,
            },
          ],
        },
      ],
      finalJeopardy: {
        category: 'PRESIDENTS',
        answer: 'stale',
        question: 'Who is Franklin D. Roosevelt?',
      },
    });

    const config = storage.loadGameConfig();
    assertEquals(config.boardName, 'Reynolds Family TG');
    assertEquals(config.finalJeopardy.category, 'THANKSGIVING HISTORY');
    const q = config.categories
      .find((c) => c.name === 'PARADES & PIGSKIN')
      ?.clues.find((c) => c.value === 800)?.question;
    assertEquals(q, 'Who is John Madden?');
  });

  await test('presetConfigFromUrl(?board=reynolds) returns new clues', () => {
    (
      globalThis as unknown as { window: { location: { search: string } } }
    ).window.location.search = '?board=reynolds';
    const base = storage.loadGameConfig();
    const fromUrl = storage.presetConfigFromUrl(base);
    assert(fromUrl, 'should resolve reynolds slug');
    assertEquals(fromUrl.boardName, 'Reynolds Family TG');
    assertEquals(fromUrl.finalJeopardy.category, 'THANKSGIVING HISTORY');
    assertEquals(
      fromUrl.categories
        .find((c) => c.name === 'PARADES & PIGSKIN')
        ?.clues.find((c) => c.value === 800)?.question,
      'Who is John Madden?',
    );
  });

  await test('Family Thanksgiving 2026 preset remains unchanged', () => {
    const family = storage.PRESET_BOARDS.find((b) => b.slug === 'thanksgiving');
    assert(family, 'family preset');
    assertEquals(family.name, 'Family Thanksgiving 2026');
    assertEquals(family.finalJeopardy.category, 'PRESIDENTS');
    assertEquals(family.finalJeopardy.question, 'Who is Franklin D. Roosevelt?');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void runTests();
