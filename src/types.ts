export interface Clue {
  value: number;
  answer: string;
  question: string;
  played: boolean;
  dailyDouble?: boolean;
}

export interface Category {
  name: string;
  clues: Clue[];
}

export interface Player {
  id: string;
  name: string;
  score: number;
}

export interface FinalJeopardy {
  category: string;
  answer: string;
  question: string;
}

export interface GameConfig {
  categories: Category[];
  players: Player[];
  finalJeopardy: FinalJeopardy;
  /** Display name of the currently loaded saved board, if any */
  boardName?: string;
}

export interface SavedBoard {
  id: string;
  name: string;
  savedAt: string;
  categories: Category[];
  finalJeopardy: FinalJeopardy;
}

export type AppMode = 'setup' | 'play';

export const CLUE_VALUES = [200, 400, 600, 800, 1000] as const;

export const STORAGE_KEY = 'jeopardy-game-config';
export const SAVED_BOARDS_KEY = 'jeopardy-saved-boards';
export const API_KEY_STORAGE = 'jeopardy-openai-api-key';

export const DEFAULT_FINAL_JEOPARDY: FinalJeopardy = {
  category: 'FINAL JEOPARDY',
  answer: '',
  question: '',
};

export function maxDailyDoubleWager(score: number, clueValue: number): number {
  return score > 0 ? Math.max(score, clueValue) : clueValue;
}

export function maxFinalJeopardyWager(score: number): number {
  return Math.max(score, 0);
}
