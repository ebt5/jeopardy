import type { FinalJeopardy, GameConfig, SavedBoard } from './types';
import familyThanksgiving from './boards/family-thanksgiving-2026.json';

export const PRESET_BOARDS: (SavedBoard & { slug: string })[] = [
  { id: 'preset-family-thanksgiving-2026', slug: 'thanksgiving', ...(familyThanksgiving as Omit<SavedBoard, 'id'>) },
];
import {
  API_KEY_STORAGE,
  DEFAULT_FINAL_JEOPARDY,
  SAVED_BOARDS_KEY,
  STORAGE_KEY,
} from './types';
import { createBlankGame } from './demo';
import { DEFAULT_API_KEY } from './defaults';

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
    players: parsed.players,
    finalJeopardy: normalizeFinalJeopardy(parsed.finalJeopardy),
    boardName: typeof parsed.boardName === 'string' ? parsed.boardName : undefined,
  };
}

export function loadGameConfig(): GameConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createBlankGame();
    const parsed = JSON.parse(raw) as Partial<GameConfig>;
    return normalizeGameConfig(parsed) ?? createBlankGame();
  } catch {
    return createBlankGame();
  }
}

export function saveGameConfig(config: GameConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function loadApiKey(): string {
  const stored = localStorage.getItem(API_KEY_STORAGE);
  if (stored && stored.trim()) return stored.trim();
  return DEFAULT_API_KEY;
}

export function saveApiKey(key: string): void {
  if (key.trim()) {
    localStorage.setItem(API_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(API_KEY_STORAGE);
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

export function loadSavedBoards(): SavedBoard[] {
  const stored = loadStoredBoards();
  const ids = new Set(stored.map((b) => b.id));
  return [...stored, ...normalizeBoards(PRESET_BOARDS.filter((b) => !ids.has(b.id)))];
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
