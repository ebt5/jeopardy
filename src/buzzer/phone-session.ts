import type { Player } from '../types';
import type { BuzzerPlayer } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedPhoneIdentity {
  roomCode: string;
  name: string;
  deviceId: string;
  gamePlayerId?: string;
}

export const DEVICE_ID_KEY = 'jeopardy-buzzer-device-id';
export const SAVED_NAME_KEY = 'jeopardy-buzzer-player-name';
export const ROOM_SESSION_PREFIX = 'jeopardy-buzzer-session-';

export const RECONNECT_BASE_DELAY_MS = 500;
export const RECONNECT_MAX_DELAY_MS = 5000;

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    /* ignore restricted storage (e.g. private browsing) */
  }
  return null;
}

export function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

export function roomIdentityStorageKey(roomCode: string): string {
  return `${ROOM_SESSION_PREFIX}${normalizeRoomCode(roomCode)}`;
}

function generateDeviceId(): string {
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getOrCreateDeviceId(storage: StorageLike | null = defaultStorage()): string {
  try {
    const existing = storage?.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = generateDeviceId();
    storage?.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return generateDeviceId();
  }
}

export function rotateDeviceId(storage: StorageLike | null = defaultStorage()): string {
  const fresh = generateDeviceId();
  try {
    storage?.setItem(DEVICE_ID_KEY, fresh);
  } catch {
    /* ignore storage errors */
  }
  return fresh;
}

export function loadLastPlayerName(storage: StorageLike | null = defaultStorage()): string {
  try {
    return storage?.getItem(SAVED_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveLastPlayerName(
  name: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(SAVED_NAME_KEY, name);
  } catch {
    /* ignore storage errors */
  }
}

export function loadPhoneIdentity(
  roomCode: string,
  storage: StorageLike | null = defaultStorage(),
): SavedPhoneIdentity | null {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) return null;
  try {
    const raw = storage?.getItem(roomIdentityStorageKey(normalized));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPhoneIdentity>;
    if (
      typeof parsed.name !== 'string' ||
      !parsed.name.trim() ||
      typeof parsed.deviceId !== 'string' ||
      !parsed.deviceId.trim()
    ) {
      return null;
    }
    return {
      roomCode: normalized,
      name: parsed.name.trim(),
      deviceId: parsed.deviceId,
      gamePlayerId:
        typeof parsed.gamePlayerId === 'string' && parsed.gamePlayerId
          ? parsed.gamePlayerId
          : undefined,
    };
  } catch {
    return null;
  }
}

export function savePhoneIdentity(
  identity: SavedPhoneIdentity,
  storage: StorageLike | null = defaultStorage(),
): void {
  const normalized = normalizeRoomCode(identity.roomCode);
  if (!normalized) return;
  const payload: SavedPhoneIdentity = {
    roomCode: normalized,
    name: identity.name.trim(),
    deviceId: identity.deviceId,
    ...(identity.gamePlayerId ? { gamePlayerId: identity.gamePlayerId } : {}),
  };
  try {
    storage?.setItem(roomIdentityStorageKey(normalized), JSON.stringify(payload));
    storage?.setItem(SAVED_NAME_KEY, payload.name);
  } catch {
    /* ignore storage errors */
  }
}

export function updatePhoneIdentityGamePlayerId(
  roomCode: string,
  gamePlayerId: string,
  storage: StorageLike | null = defaultStorage(),
): SavedPhoneIdentity | null {
  const existing = loadPhoneIdentity(roomCode, storage);
  if (!existing) return null;
  if (existing.gamePlayerId === gamePlayerId) return existing;
  const updated: SavedPhoneIdentity = { ...existing, gamePlayerId };
  savePhoneIdentity(updated, storage);
  return updated;
}

export function clearPhoneIdentity(
  roomCode: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) return;
  try {
    storage?.removeItem(roomIdentityStorageKey(normalized));
  } catch {
    /* ignore storage errors */
  }
}

/** Exponential backoff for reconnect attempts: 0.5s, 1s, 2s, 4s, capped at 5s. */
export function getReconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = RECONNECT_BASE_DELAY_MS * Math.pow(2, safeAttempt);
  return Math.min(raw, RECONNECT_MAX_DELAY_MS);
}

export interface ReconcileBuzzerPlayersResult {
  players: Player[];
  changed: boolean;
  toLink: Array<{ peerId: string; gamePlayerId: string }>;
}

/**
 * Links active buzzer connections to game players without creating duplicates
 * when a phone reconnects with the same deviceId or gamePlayerId (even if its
 * previous peer connection hasn't timed out yet).
 */
export function reconcileBuzzerPlayers(
  currentPlayers: Player[],
  newBuzzerPlayers: BuzzerPlayer[],
  prevBuzzerPlayers: BuzzerPlayer[],
  deviceToPlayer: Map<string, string>,
  createId: () => string = () =>
    `p${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
): ReconcileBuzzerPlayersResult {
  let updated = [...currentPlayers];
  let changed = false;
  const toLink: Array<{ peerId: string; gamePlayerId: string }> = [];

  for (const bp of newBuzzerPlayers) {
    const existingByPeerId = updated.find((p) => p.buzzerPeerId === bp.peerId);
    if (existingByPeerId) {
      if (bp.deviceId) {
        deviceToPlayer.set(bp.deviceId, existingByPeerId.id);
        if (existingByPeerId.buzzerDeviceId !== bp.deviceId) {
          updated = updated.map((p) =>
            p.id === existingByPeerId.id ? { ...p, buzzerDeviceId: bp.deviceId } : p,
          );
          changed = true;
        }
      }
      if (bp.gamePlayerId !== existingByPeerId.id) {
        toLink.push({ peerId: bp.peerId, gamePlayerId: existingByPeerId.id });
      }
      continue;
    }

    let matchedPlayer: Player | undefined;

    // 1. Match by persistent deviceId (map or persisted on Player), even if old peerId hasn't closed yet
    if (bp.deviceId) {
      const knownPlayerId = deviceToPlayer.get(bp.deviceId);
      if (knownPlayerId) {
        matchedPlayer = updated.find((p) => p.id === knownPlayerId);
      }
      if (!matchedPlayer) {
        matchedPlayer = updated.find((p) => p.buzzerDeviceId === bp.deviceId);
      }
    }

    // 2. Match by persisted gamePlayerId sent by the reconnecting phone
    if (!matchedPlayer && bp.gamePlayerId) {
      matchedPlayer = updated.find((p) => p.id === bp.gamePlayerId);
    }

    // 3. Fallback: match an unconnected player by name
    if (!matchedPlayer) {
      matchedPlayer = updated.find(
        (p) => p.name.toLowerCase() === bp.name.toLowerCase() && !p.buzzerPeerId,
      );
    }

    if (matchedPlayer) {
      const matchedId = matchedPlayer.id;
      updated = updated.map((p) =>
        p.id === matchedId
          ? {
              ...p,
              buzzerPeerId: bp.peerId,
              buzzerDeviceId: bp.deviceId ?? p.buzzerDeviceId,
              isManual: false,
            }
          : p,
      );
      if (bp.gamePlayerId !== matchedId) {
        toLink.push({ peerId: bp.peerId, gamePlayerId: matchedId });
      }
      if (bp.deviceId) {
        deviceToPlayer.set(bp.deviceId, matchedId);
      }
      changed = true;
    } else {
      const wasInPrev = prevBuzzerPlayers.some((prev) => prev.peerId === bp.peerId);
      if (!wasInPrev) {
        const newPlayerId = createId();
        const newPlayer: Player = {
          id: newPlayerId,
          name: bp.name,
          score: 0,
          buzzerPeerId: bp.peerId,
          ...(bp.deviceId ? { buzzerDeviceId: bp.deviceId } : {}),
          isManual: false,
        };
        updated.push(newPlayer);
        toLink.push({ peerId: bp.peerId, gamePlayerId: newPlayerId });
        if (bp.deviceId) {
          deviceToPlayer.set(bp.deviceId, newPlayerId);
        }
        changed = true;
      }
    }
  }

  for (const prevBp of prevBuzzerPlayers) {
    const stillConnected = newBuzzerPlayers.some((bp) => bp.peerId === prevBp.peerId);
    if (!stillConnected) {
      const linkedPlayer = updated.find((p) => p.buzzerPeerId === prevBp.peerId);
      if (linkedPlayer) {
        updated = updated.map((p) =>
          p.id === linkedPlayer.id ? { ...p, buzzerPeerId: undefined } : p,
        );
        changed = true;
      }
    }
  }

  return { players: updated, changed, toLink };
}
