import type { FinalJeopardy, GameConfig, SavedBoard } from './types';
import familyThanksgiving from './boards/family-thanksgiving-2026.json';
import reynoldsFamilyTg from './boards/reynolds-family-tg.json';
import {
  API_KEY_STORAGE,
  DEFAULT_FINAL_JEOPARDY,
  SAVED_BOARDS_KEY,
  STORAGE_KEY,
} from './types';
import { createBlankGame } from './demo';

export const PRESET_BOARDS: (SavedBoard & { slug: string })[] = [
  { id: 'preset-family-thanksgiving-2026', slug: 'thanksgiving', ...(familyThanksgiving as Omit<SavedBoard, 'id'>) },
  { id: 'preset-reynolds-family-tg', slug: 'reynolds', ...(reynoldsFamilyTg as Omit<SavedBoard, 'id'>) },
];

function normalizeFinalJeopardy(raw: unknown): FinalJeopardy {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FINAL_JEOPARDY };
  const fj = raw as Partial<FinalJeopardy>;
  return {
    category: typeof fj.category === 'string' ? fj.category : DEFAULT_FINAL_JEOPARDY.category,
    answer: typeof fj.answer === 'string' ? fj.answer : '',
    question: typeof fj.question === 'string' ? fj.question : '',
  };
}

export function normalizeGameConfig(parsed: Partial<GameConfig>): GameConfig | null {
  if (!parsed.categories?.length || !parsed.players?.length) return null;
  return {
    categories: parsed.categories.map((cat) => ({
      ...cat,
      clues: (cat.clues ?? []).map((cl) => ({
        ...cl,
        dailyDouble: Boolean(cl.dailyDouble),
        played: Boolean(cl.played),
      })),
    })),
    players: parsed.players.map((p) => ({
      ...p,
      // PeerJS IDs are ephemeral per host session; strip stale ones loaded from localStorage
      buzzerPeerId: undefined,
    })),
    finalJeopardy: normalizeFinalJeopardy(parsed.finalJeopardy),
    boardName: typeof parsed.boardName === 'string' ? parsed.boardName : undefined,
  };
}

export function loadGameConfig(): GameConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createBlankGame();
    const parsed = JSON.parse(raw) as Partial<GameConfig>;
    const config = normalizeGameConfig(parsed) ?? createBlankGame();
    // Built-in boards always refresh from the bundle so clue updates land on reload
    return refreshGameConfigFromPresets(config);
  } catch {
    return createBlankGame();
  }
}

export function saveGameConfig(config: GameConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadApiKey(): string {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE);
    return stored?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(API_KEY_STORAGE, key.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE);
    }
  } catch {
    /* ignore storage errors */
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
    // Also clean up any legacy key slot if present from earlier versions
    localStorage.removeItem('jeopardy-openai-api-key');
  } catch {
    /* ignore storage errors */
  }
}

export function presetConfigFromUrl(base: GameConfig): GameConfig | null {
  const slug = new URLSearchParams(window.location.search).get('board');
  if (!slug) return null;
  const preset = PRESET_BOARDS.find((b) => b.slug === slug.toLowerCase());
  if (!preset) return null;
  const [board] = normalizeBoards([preset]);
  return {
    ...base,
    categories: board.categories,
    finalJeopardy: board.finalJeopardy,
    boardName: board.name,
    players: base.players.map((p) => ({ ...p, score: 0 })),
  };
}

/** True when bundled preset.savedAt is strictly newer than the stored copy's savedAt. */
export function isPresetNewerThanStored(
  presetSavedAt: string,
  storedSavedAt: string | undefined,
): boolean {
  if (!storedSavedAt) return true;
  const presetMs = Date.parse(presetSavedAt);
  const storedMs = Date.parse(storedSavedAt);
  if (Number.isNaN(presetMs)) return false;
  if (Number.isNaN(storedMs)) return true;
  return presetMs > storedMs;
}

/**
 * Replace localStorage copies of built-in presets when the bundled board is newer.
 * Matches by preset id only — never deletes or rewrites user-created boards
 * (ids that are not in PRESET_BOARDS).
 */
export function refreshStalePresetBoards(stored: SavedBoard[]): {
  boards: SavedBoard[];
  didChange: boolean;
} {
  const presetById = new Map(PRESET_BOARDS.map((p) => [p.id, p]));
  let didChange = false;
  const boards = stored.map((board) => {
    const preset = presetById.get(board.id);
    if (!preset) return board;
    if (!isPresetNewerThanStored(preset.savedAt, board.savedAt)) return board;
    didChange = true;
    return normalizeBoards([preset as SavedBoard])[0];
  });
  return { boards, didChange };
}

/**
 * If the active game is a built-in preset board (matched by boardName), overlay the
 * latest bundled categories + Final Jeopardy so a refresh picks up clue updates even
 * when jeopardy-game-config still holds an older snapshot.
 */
export function refreshGameConfigFromPresets(config: GameConfig): GameConfig {
  if (!config.boardName) return config;
  const preset = PRESET_BOARDS.find((p) => p.name === config.boardName);
  if (!preset) return config;
  const [board] = normalizeBoards([preset as SavedBoard]);
  return {
    ...config,
    categories: board.categories,
    finalJeopardy: board.finalJeopardy,
    boardName: board.name,
  };
}

export function loadSavedBoards(): SavedBoard[] {
  const stored = loadStoredBoards();
  const { boards: refreshed, didChange } = refreshStalePresetBoards(stored);
  if (didChange) {
    // Persist refreshed presets so subsequent loads stay in sync without wiping user boards
    saveSavedBoards(refreshed);
  }
  const ids = new Set(refreshed.map((b) => b.id));
  return [
    ...refreshed,
    ...normalizeBoards(
      PRESET_BOARDS.filter((b) => !ids.has(b.id)).map((b) => b as SavedBoard),
    ),
  ];
}

function loadStoredBoards(): SavedBoard[] {
  try {
    const raw = localStorage.getItem(SAVED_BOARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedBoard[];
    if (!Array.isArray(parsed)) return [];
    return normalizeBoards(parsed);
  } catch {
    return [];
  }
}

function normalizeBoards(parsed: SavedBoard[]): SavedBoard[] {
  {
    return parsed.map((b) => ({
      ...b,
      finalJeopardy: normalizeFinalJeopardy(b.finalJeopardy),
      categories: (b.categories ?? []).map((cat) => ({
        ...cat,
        clues: (cat.clues ?? []).map((cl) => ({
          ...cl,
          dailyDouble: Boolean(cl.dailyDouble),
          played: false,
        })),
      })),
    }));
  }
}

export function saveSavedBoards(boards: SavedBoard[]): void {
  localStorage.setItem(SAVED_BOARDS_KEY, JSON.stringify(boards));
}

export function upsertSavedBoard(board: SavedBoard): SavedBoard[] {
  const boards = loadStoredBoards().filter((b) => b.id !== board.id);
  boards.unshift(board);
  saveSavedBoards(boards);
  return boards;
}

export function deleteSavedBoard(id: string): SavedBoard[] {
  const boards = loadStoredBoards().filter((b) => b.id !== id);
  saveSavedBoards(boards);
  return loadSavedBoards();
}

/** Strip played flags for export / saved boards */
export function boardSnapshot(
  categories: GameConfig['categories'],
  finalJeopardy: FinalJeopardy,
): { categories: GameConfig['categories']; finalJeopardy: FinalJeopardy } {
  return {
    categories: categories.map((c) => ({
      ...c,
      clues: c.clues.map((cl) => ({ ...cl, played: false })),
    })),
    finalJeopardy: { ...finalJeopardy },
  };
}
