/** Room state shared between host and phone clients */
export type BuzzerState = 'waiting' | 'armed' | 'resolving' | 'locked';

export interface BuzzerPlayer {
  peerId: string;
  name: string;
  gamePlayerId?: string; // Maps to Player.id from game config
  deviceId?: string; // Persistent device identifier for reconnection
}

export interface BuzzResult {
  peerId: string;
  name: string;
  gamePlayerId?: string;
  hostTimestamp: number;
  deltaMs?: number; // Time gap from winner (0 for winner)
}

export interface BuzzerRoundResult {
  winner: BuzzResult;
  runnerUps: BuzzResult[];
  lockedOutIds: Set<string>; // Player IDs locked out for this clue
}

/** Callback signature for correct/wrong answer handling */
export interface BuzzerAnswerCallbacks {
  onCorrect: () => void;
  onWrong: () => void;
}

/** Final Jeopardy phase communicated from host to phones */
export type FinalJeopardyPhase = 'wager' | 'clue' | 'reveal' | 'done';

/** Personalized Final Jeopardy state sent by host to a single player's phone.
 *  Never contains other players' wagers or responses. */
export interface FinalJeopardyPhoneState {
  phase: FinalJeopardyPhase;
  category: string;
  /** Populated only once the host reveals the clue (phase !== 'wager') */
  clue?: string;
  playerName: string;
  score: number;
  maxWager: number;
  wagerLocked: boolean;
  /** Only this player's own locked wager */
  wager?: number;
  responseLocked: boolean;
  /** Only this player's own locked response */
  response?: string;
  /** Populated once this player's wager is revealed during TV-style reveal */
  revealResult?: 'correct' | 'incorrect';
  newScore?: number;
}

/** Messages from host to phone */
export type HostMessage =
  | { type: 'sync-request'; hostSendTime: number }
  | { type: 'sync-response'; hostSendTime: number; hostReceiveTime: number; phoneSendTime: number }
  | { type: 'state-change'; state: BuzzerState; armTime?: number }
  | { type: 'player-list'; players: BuzzerPlayer[] }
  | { type: 'buzz-result'; result: BuzzerRoundResult }
  | { type: 'your-status'; status: 'winner' | 'runner-up' | 'locked-out'; rank?: number }
  | { type: 'kick'; reason: string }
  | { type: 'fj-state'; state: FinalJeopardyPhoneState | null }
  | { type: 'fj-error'; message: string };

/** Messages from phone to host */
export type PhoneMessage =
  | { type: 'join'; name: string; gamePlayerId?: string; deviceId?: string }
  | { type: 'sync-ping'; phoneSendTime: number }
  | { type: 'sync-pong'; hostSendTime: number; phoneReceiveTime: number }
  | { type: 'buzz'; localTimestamp: number; correctedTimestamp: number }
  | { type: 'fj-wager'; wager: number }
  | { type: 'fj-response'; response: string };

/** Clock sync sample from NTP-style exchange */
export interface ClockSample {
  roundTrip: number;
  offset: number; // phone clock - host clock (add to phone time to get host time)
}

/** Room configuration */
export const ROOM_CODE_LENGTH = 4;
export const BUZZ_COLLECTION_WINDOW_MS = 280; // Wait this long after first buzz before declaring winner
export const EARLY_BUZZ_GRACE_MS = 50; // Allow buzzes this many ms before arm time (network jitter)
export const SYNC_SAMPLE_COUNT = 5;
export const SYNC_INTERVAL_MS = 30000; // Re-sync every 30 seconds
export const LOCKOUT_PENALTY_MS = 0; // No penalty for now, keep it simple
