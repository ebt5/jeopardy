import type { FinalJeopardy, Player } from '../types';
import { maxFinalJeopardyWager } from '../types';
import type { FinalJeopardyPhase, FinalJeopardyPhoneState } from './types';

export const MAX_FJ_RESPONSE_LENGTH = 200;
export const DEFAULT_FJ_TIMER_SECONDS = 60;

export interface FinalJeopardyTimerSnapshot {
  secondsLeft: number;
  durationSeconds: number;
  running: boolean;
}

export interface FinalJeopardyPlayerEntry {
  playerId: string;
  startingScore: number;
  wager: number | null;
  wagerLocked: boolean;
  wagerSource: 'phone' | 'host' | null;
  response: string;
  responseLocked: boolean;
  responseSource: 'phone' | 'host' | null;
  verdict: 'correct' | 'incorrect' | null;
  wagerRevealed: boolean;
}

export interface FinalJeopardySession {
  phase: FinalJeopardyPhase;
  category: string;
  clue: string;
  correctResponse: string;
  correctResponseShown: boolean;
  /** True once the clue countdown reaches 0 (until reset) */
  submissionsLockedByTimer: boolean;
  /** Host override allowing phones to submit responses even after time is up */
  allowLateResponses: boolean;
  entries: Record<string, FinalJeopardyPlayerEntry>;
  revealOrder: string[];
  revealIndex: number;
}

export interface FinalJeopardyActionResult {
  session: FinalJeopardySession;
  error?: string;
}

export function formatScore(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US');
  return amount < 0 ? `-$${abs}` : `$${abs}`;
}

export function formatTimer(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function isSubmissionsClosed(session: FinalJeopardySession): boolean {
  return (
    session.phase === 'clue' &&
    session.submissionsLockedByTimer &&
    !session.allowLateResponses
  );
}

export function computeRevealOrder(
  players: ReadonlyArray<Pick<Player, 'id' | 'score'>>,
): string[] {
  return players
    .map((p, index) => ({ id: p.id, score: p.score, index }))
    .sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index))
    .map((p) => p.id);
}

function createEmptyEntry(player: Pick<Player, 'id' | 'score'>): FinalJeopardyPlayerEntry {
  return {
    playerId: player.id,
    startingScore: player.score,
    wager: null,
    wagerLocked: false,
    wagerSource: null,
    response: '',
    responseLocked: false,
    responseSource: null,
    verdict: null,
    wagerRevealed: false,
  };
}

export function createFinalJeopardySession(
  finalJeopardy: FinalJeopardy,
  players: ReadonlyArray<Pick<Player, 'id' | 'score'>>,
): FinalJeopardySession {
  const entries: Record<string, FinalJeopardyPlayerEntry> = {};
  for (const p of players) {
    entries[p.id] = createEmptyEntry(p);
  }
  return {
    phase: 'wager',
    category: finalJeopardy.category || 'FINAL JEOPARDY',
    clue: finalJeopardy.answer,
    correctResponse: finalJeopardy.question,
    correctResponseShown: false,
    submissionsLockedByTimer: false,
    allowLateResponses: false,
    entries,
    revealOrder: computeRevealOrder(players),
    revealIndex: 0,
  };
}

/** Ensures any newly added game players are represented in the active session
 *  without overwriting existing player entries (preserving state across reconnects). */
export function syncPlayersIntoSession(
  session: FinalJeopardySession,
  players: ReadonlyArray<Pick<Player, 'id' | 'score'>>,
): FinalJeopardySession {
  let changed = false;
  const nextEntries = { ...session.entries };
  const nextRevealOrder = [...session.revealOrder];

  for (const p of players) {
    if (!nextEntries[p.id]) {
      const entry = createEmptyEntry(p);
      if (session.phase !== 'wager') {
        entry.wager = 0;
        entry.wagerLocked = true;
      }
      if (session.phase === 'reveal' || session.phase === 'done') {
        entry.responseLocked = true;
      }
      nextEntries[p.id] = entry;
      if (!nextRevealOrder.includes(p.id)) {
        nextRevealOrder.push(p.id);
      }
      changed = true;
    }
  }

  if (!changed) return session;
  return {
    ...session,
    entries: nextEntries,
    revealOrder: nextRevealOrder,
  };
}

export function validateWager(wager: number, startingScore: number): string | null {
  const max = maxFinalJeopardyWager(startingScore);
  if (!Number.isFinite(wager) || !Number.isInteger(wager) || wager < 0 || wager > max) {
    return `Wager must be a whole dollar amount between $0 and $${max}.`;
  }
  return null;
}

export function handlePhoneWager(
  session: FinalJeopardySession,
  playerId: string,
  wager: number,
): FinalJeopardyActionResult {
  if (session.phase !== 'wager') {
    return { session, error: 'Wagering is already closed.' };
  }
  const entry = session.entries[playerId];
  if (!entry) {
    return { session, error: 'Player is not in Final Jeopardy.' };
  }
  if (entry.wagerLocked) {
    return { session, error: 'Your wager is already locked.' };
  }
  const validationError = validateWager(wager, entry.startingScore);
  if (validationError) {
    return { session, error: validationError };
  }
  return {
    session: {
      ...session,
      entries: {
        ...session.entries,
        [playerId]: {
          ...entry,
          wager,
          wagerLocked: true,
          wagerSource: 'phone',
        },
      },
    },
  };
}

export function setHostWager(
  session: FinalJeopardySession,
  playerId: string,
  wager: number,
): FinalJeopardyActionResult {
  const entry = session.entries[playerId];
  if (!entry) {
    return { session, error: 'Player is not in Final Jeopardy.' };
  }
  if (entry.wagerRevealed) {
    return { session, error: 'Cannot change wager after it has been revealed.' };
  }
  const validationError = validateWager(wager, entry.startingScore);
  if (validationError) {
    return { session, error: validationError };
  }
  return {
    session: {
      ...session,
      entries: {
        ...session.entries,
        [playerId]: {
          ...entry,
          wager,
          wagerLocked: true,
          wagerSource: 'host',
        },
      },
    },
  };
}

/** Finalizes wagers (applying optional host-entered overrides and defaulting any
 *  unlocked players to $0) and advances the session into the clue phase. */
export function advanceToClue(
  session: FinalJeopardySession,
  hostWagers?: Record<string, number>,
): FinalJeopardyActionResult {
  if (session.phase !== 'wager') {
    return { session, error: 'Session is not in wagering phase.' };
  }
  const nextEntries: Record<string, FinalJeopardyPlayerEntry> = {};
  for (const [playerId, entry] of Object.entries(session.entries)) {
    if (hostWagers && playerId in hostWagers) {
      const value = hostWagers[playerId];
      const err = validateWager(value, entry.startingScore);
      if (err) {
        return { session, error: err };
      }
      nextEntries[playerId] = {
        ...entry,
        wager: value,
        wagerLocked: true,
        wagerSource: 'host',
      };
    } else if (entry.wagerLocked && entry.wager !== null) {
      nextEntries[playerId] = entry;
    } else {
      nextEntries[playerId] = {
        ...entry,
        wager: 0,
        wagerLocked: true,
        wagerSource: entry.wagerSource ?? 'host',
      };
    }
  }
  return {
    session: {
      ...session,
      phase: 'clue',
      submissionsLockedByTimer: false,
      allowLateResponses: false,
      entries: nextEntries,
    },
  };
}

export function setTimerExpired(
  session: FinalJeopardySession,
  expired: boolean,
): FinalJeopardySession {
  if (session.submissionsLockedByTimer === expired) return session;
  return {
    ...session,
    submissionsLockedByTimer: expired,
  };
}

export function setAllowLateResponses(
  session: FinalJeopardySession,
  allow: boolean,
): FinalJeopardySession {
  if (session.allowLateResponses === allow) return session;
  return {
    ...session,
    allowLateResponses: allow,
  };
}

export function handlePhoneResponse(
  session: FinalJeopardySession,
  playerId: string,
  rawResponse: string,
): FinalJeopardyActionResult {
  if (session.phase !== 'clue') {
    return { session, error: 'Response submission is not currently open.' };
  }
  if (isSubmissionsClosed(session)) {
    return {
      session,
      error: 'Time is up! Ask the host to allow late answers if needed.',
    };
  }
  const entry = session.entries[playerId];
  if (!entry) {
    return { session, error: 'Player is not in Final Jeopardy.' };
  }
  if (entry.responseLocked) {
    return { session, error: 'Your response is already locked.' };
  }
  const trimmed = rawResponse.trim().slice(0, MAX_FJ_RESPONSE_LENGTH);
  if (!trimmed) {
    return { session, error: 'Please enter a response before submitting.' };
  }
  return {
    session: {
      ...session,
      entries: {
        ...session.entries,
        [playerId]: {
          ...entry,
          response: trimmed,
          responseLocked: true,
          responseSource: 'phone',
        },
      },
    },
  };
}

export function setHostResponse(
  session: FinalJeopardySession,
  playerId: string,
  rawResponse: string,
): FinalJeopardySession {
  const entry = session.entries[playerId];
  if (!entry) return session;
  const trimmed = rawResponse.trim().slice(0, MAX_FJ_RESPONSE_LENGTH);
  return {
    ...session,
    entries: {
      ...session.entries,
      [playerId]: {
        ...entry,
        response: trimmed,
        responseLocked: true,
        responseSource: 'host',
      },
    },
  };
}

export function advanceToReveal(
  session: FinalJeopardySession,
  players: ReadonlyArray<Pick<Player, 'id' | 'score'>>,
): FinalJeopardySession {
  const nextEntries: Record<string, FinalJeopardyPlayerEntry> = {};
  for (const [playerId, entry] of Object.entries(session.entries)) {
    nextEntries[playerId] = {
      ...entry,
      wager: entry.wager ?? 0,
      wagerLocked: true,
      responseLocked: true,
    };
  }
  const ordered = computeRevealOrder(
    players.map((p) => ({
      id: p.id,
      score: nextEntries[p.id]?.startingScore ?? p.score,
    })),
  );
  return {
    ...session,
    phase: 'reveal',
    entries: nextEntries,
    revealOrder: ordered,
    revealIndex: 0,
  };
}

export function judgePlayer(
  session: FinalJeopardySession,
  playerId: string,
  verdict: 'correct' | 'incorrect',
): FinalJeopardySession {
  const entry = session.entries[playerId];
  if (!entry || entry.wagerRevealed) return session;
  return {
    ...session,
    entries: {
      ...session.entries,
      [playerId]: {
        ...entry,
        verdict,
      },
    },
  };
}

export function clearPlayerVerdict(
  session: FinalJeopardySession,
  playerId: string,
): FinalJeopardySession {
  const entry = session.entries[playerId];
  if (!entry || entry.wagerRevealed) return session;
  return {
    ...session,
    entries: {
      ...session.entries,
      [playerId]: {
        ...entry,
        verdict: null,
      },
    },
  };
}

export function revealPlayerWager(
  session: FinalJeopardySession,
  playerId: string,
): { session: FinalJeopardySession; scoreDelta: number } {
  const entry = session.entries[playerId];
  if (!entry || entry.wagerRevealed || !entry.verdict) {
    return { session, scoreDelta: 0 };
  }
  const wager = entry.wager ?? 0;
  const scoreDelta = entry.verdict === 'correct' ? wager : -wager;
  return {
    session: {
      ...session,
      entries: {
        ...session.entries,
        [playerId]: {
          ...entry,
          wagerRevealed: true,
        },
      },
    },
    scoreDelta,
  };
}

export function setCorrectResponseShown(
  session: FinalJeopardySession,
  shown: boolean,
): FinalJeopardySession {
  return {
    ...session,
    correctResponseShown: shown,
  };
}

export function setRevealIndex(
  session: FinalJeopardySession,
  index: number,
): FinalJeopardySession {
  if (index < 0 || index >= session.revealOrder.length) return session;
  return {
    ...session,
    revealIndex: index,
  };
}

export function nextUnrevealedIndex(session: FinalJeopardySession): number | null {
  const total = session.revealOrder.length;
  for (let offset = 1; offset <= total; offset++) {
    const idx = (session.revealIndex + offset) % total;
    const pid = session.revealOrder[idx];
    if (pid && !session.entries[pid]?.wagerRevealed) {
      return idx;
    }
  }
  return null;
}

export function areAllPlayersRevealed(session: FinalJeopardySession): boolean {
  return session.revealOrder.every((pid) => session.entries[pid]?.wagerRevealed === true);
}

export function advanceToDone(session: FinalJeopardySession): FinalJeopardySession {
  return {
    ...session,
    phase: 'done',
  };
}

/** Builds a strictly isolated phone payload for a single player.
 *  Never includes other players' wagers, responses, or the correct answer. */
export function getPhoneStateForPlayer(
  session: FinalJeopardySession,
  player: Pick<Player, 'id' | 'name' | 'score'>,
  timer?: FinalJeopardyTimerSnapshot,
): FinalJeopardyPhoneState {
  const entry = session.entries[player.id] ?? createEmptyEntry(player);
  const maxWager = maxFinalJeopardyWager(entry.startingScore);
  const wager = entry.wagerLocked ? (entry.wager ?? 0) : undefined;
  const revealDelta =
    entry.wagerRevealed && entry.verdict
      ? entry.verdict === 'correct'
        ? (entry.wager ?? 0)
        : -(entry.wager ?? 0)
      : undefined;

  const isClue = session.phase === 'clue';

  return {
    phase: session.phase,
    category: session.category,
    clue: session.phase !== 'wager' ? session.clue : undefined,
    playerName: player.name,
    score: entry.wagerRevealed ? entry.startingScore + (revealDelta ?? 0) : entry.startingScore,
    maxWager,
    wagerLocked: entry.wagerLocked,
    wager,
    responseLocked: entry.responseLocked,
    response: entry.responseLocked ? entry.response : undefined,
    revealResult: entry.wagerRevealed && entry.verdict ? entry.verdict : undefined,
    newScore:
      revealDelta !== undefined ? entry.startingScore + revealDelta : undefined,
    timerSecondsLeft: isClue && timer ? timer.secondsLeft : undefined,
    timerDurationSeconds: isClue && timer ? timer.durationSeconds : undefined,
    timerRunning: isClue && timer ? timer.running : undefined,
    submissionsClosed: isClue ? isSubmissionsClosed(session) : undefined,
  };
}
