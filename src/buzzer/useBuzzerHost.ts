import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type {
  BuzzerPlayer,
  BuzzerRoundResult,
  BuzzerState,
  HostMessage,
  PhoneMessage,
} from './types';
import {
  BUZZ_COLLECTION_WINDOW_MS,
  EARLY_BUZZ_GRACE_MS,
  ROOM_CODE_LENGTH,
  SYNC_INTERVAL_MS,
  SYNC_SAMPLE_COUNT,
} from './types';
import { playBuzzerArmedSound, playBuzzerWinnerSound } from './sounds';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function makePeerId(code: string): string {
  return `jeopardy-buzz-${code}`;
}

interface PendingBuzz {
  peerId: string;
  name: string;
  gamePlayerId?: string;
  correctedTimestamp: number;
}

interface ConnectionState {
  conn: DataConnection;
  player: BuzzerPlayer | null;
  syncSamples: number;
}

export type PhoneMessageListener = (
  peerId: string,
  player: BuzzerPlayer,
  msg: PhoneMessage,
) => void;

function safeSend(conn: DataConnection, msg: HostMessage): boolean {
  if (!conn.open) return false;
  try {
    conn.send(msg);
    return true;
  } catch {
    return false;
  }
}

export interface UseBuzzerHostResult {
  roomCode: string | null;
  state: BuzzerState;
  players: BuzzerPlayer[];
  lastResult: BuzzerRoundResult | null;
  lockedOutIds: Set<string>;
  error: string | null;
  isConnecting: boolean;
  startRoom: () => void;
  stopRoom: () => void;
  arm: (options?: { freshRound?: boolean }) => void;
  reset: (lockOutWinner?: boolean) => void;
  rearm: () => void;
  kickPlayer: (peerId: string) => void;
  linkPlayerToGame: (peerId: string, gamePlayerId: string) => void;
  sendToPlayer: (peerId: string, msg: HostMessage) => void;
  broadcastMessage: (msg: HostMessage) => void;
  subscribePhoneMessages: (listener: PhoneMessageListener) => () => void;
}

export function useBuzzerHost(): UseBuzzerHostResult {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [state, setState] = useState<BuzzerState>('waiting');
  const [players, setPlayers] = useState<BuzzerPlayer[]>([]);
  const [lastResult, setLastResult] = useState<BuzzerRoundResult | null>(null);
  const [lockedOutIds, setLockedOutIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, ConnectionState>>(new Map());
  const armTimeRef = useRef<number>(0);
  const pendingBuzzesRef = useRef<PendingBuzz[]>([]);
  const collectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const stateRef = useRef<BuzzerState>('waiting');
  const lastResultRef = useRef<BuzzerRoundResult | null>(null);
  const lockedOutIdsRef = useRef<Set<string>>(new Set());
  const phoneMessageListenersRef = useRef<Set<PhoneMessageListener>>(new Set());

  const subscribePhoneMessages = useCallback((listener: PhoneMessageListener) => {
    phoneMessageListenersRef.current.add(listener);
    return () => {
      phoneMessageListenersRef.current.delete(listener);
    };
  }, []);

  const broadcast = useCallback((msg: HostMessage, exclude?: string) => {
    for (const [peerId, { conn }] of connectionsRef.current) {
      if (peerId !== exclude) {
        safeSend(conn, msg);
      }
    }
  }, []);

  const sendTo = useCallback((peerId: string, msg: HostMessage) => {
    const connState = connectionsRef.current.get(peerId);
    if (connState) {
      safeSend(connState.conn, msg);
    }
  }, []);

  const updatePlayerList = useCallback(() => {
    const list = Array.from(connectionsRef.current.values())
      .map((s) => s.player)
      .filter((p): p is BuzzerPlayer => p !== null);
    setPlayers(list);
    broadcast({ type: 'player-list', players: list });
  }, [broadcast]);

  const startSyncWithConnection = useCallback((peerId: string, conn: DataConnection) => {
    // Clear any existing interval
    const existing = syncIntervalsRef.current.get(peerId);
    if (existing) clearInterval(existing);

    const doSync = () => {
      safeSend(conn, { type: 'sync-request', hostSendTime: performance.now() });
    };

    // Initial sync burst
    for (let i = 0; i < SYNC_SAMPLE_COUNT; i++) {
      setTimeout(doSync, i * 100);
    }

    // Periodic re-sync
    const interval = setInterval(doSync, SYNC_INTERVAL_MS);
    syncIntervalsRef.current.set(peerId, interval);
  }, []);

  const handleConnection = useCallback((conn: DataConnection) => {
    const peerId = conn.peer;
    let opened = false;

    const onOpen = () => {
      if (opened) return;
      opened = true;
      connectionsRef.current.set(peerId, { conn, player: null, syncSamples: 0 });
      startSyncWithConnection(peerId, conn);
      // Send current state
      safeSend(conn, {
        type: 'state-change',
        state: stateRef.current,
        armTime: armTimeRef.current,
        lockedOutIds: Array.from(lockedOutIdsRef.current),
      });
    };

    if (conn.open) {
      onOpen();
    } else {
      conn.on('open', onOpen);
    }

    conn.on('data', (data) => {
      if (!opened && conn.open) {
        onOpen();
      }
      const msg = data as PhoneMessage;
      const connState = connectionsRef.current.get(peerId);
      if (!connState) return;

      switch (msg.type) {
        case 'join': {
          // If the same device or linked game player reconnected before the old WebRTC channel
          // timed out, close and replace the stale connection immediately with no duplicates.
          let inheritedGamePlayerId: string | undefined;
          let transferredLockout = false;
          for (const [oldPeerId, oldState] of connectionsRef.current) {
            if (oldPeerId === peerId) continue;
            const sameDevice =
              Boolean(msg.deviceId) && oldState.player?.deviceId === msg.deviceId;
            const sameGamePlayer =
              Boolean(msg.gamePlayerId) &&
              oldState.player?.gamePlayerId === msg.gamePlayerId;
            if (sameDevice || sameGamePlayer) {
              if (!inheritedGamePlayerId && oldState.player?.gamePlayerId) {
                inheritedGamePlayerId = oldState.player.gamePlayerId;
              }
              if (lockedOutIdsRef.current.has(oldPeerId)) {
                lockedOutIdsRef.current.delete(oldPeerId);
                transferredLockout = true;
              }
              const oldInterval = syncIntervalsRef.current.get(oldPeerId);
              if (oldInterval) {
                clearInterval(oldInterval);
                syncIntervalsRef.current.delete(oldPeerId);
              }
              connectionsRef.current.delete(oldPeerId);
              try {
                oldState.conn.close();
              } catch {
                /* ignore close errors on stale connection */
              }
            }
          }

          if (transferredLockout) {
            const nextLocked = new Set(lockedOutIdsRef.current);
            nextLocked.add(peerId);
            lockedOutIdsRef.current = nextLocked;
            setLockedOutIds(nextLocked);
          }

          connState.player = {
            peerId,
            name: msg.name.slice(0, 20).trim() || 'Player',
            gamePlayerId: msg.gamePlayerId ?? inheritedGamePlayerId,
            deviceId: msg.deviceId,
          };
          updatePlayerList();

          // Always re-sync authoritative buzzer state after join/reconnect so the phone
          // reflects armed/locked/waiting status accurately even after sleep/wake.
          safeSend(conn, {
            type: 'state-change',
            state: stateRef.current,
            armTime: armTimeRef.current,
            lockedOutIds: Array.from(lockedOutIdsRef.current),
          });
          if (lockedOutIdsRef.current.has(peerId)) {
            safeSend(conn, { type: 'your-status', status: 'locked-out' });
          }
          break;
        }

        case 'sync-ping': {
          const hostReceiveTime = performance.now();
          safeSend(conn, {
            type: 'sync-response',
            hostSendTime: performance.now(),
            hostReceiveTime,
            phoneSendTime: msg.phoneSendTime,
          });
          connState.syncSamples++;
          break;
        }

        case 'sync-pong': {
          // Phone acknowledged our sync, we can track the offset on host side if needed
          break;
        }

        case 'buzz': {
          if (stateRef.current !== 'armed') return;
          if (!connState.player) return;
          
          // Check if player is locked out
          if (lockedOutIdsRef.current.has(connState.player.peerId)) return;

          // Check for early buzz
          if (msg.correctedTimestamp < armTimeRef.current - EARLY_BUZZ_GRACE_MS) {
            // Too early - could add penalty here
            return;
          }

          pendingBuzzesRef.current.push({
            peerId,
            name: connState.player.name,
            gamePlayerId: connState.player.gamePlayerId,
            correctedTimestamp: msg.correctedTimestamp,
          });

          // Start collection window on first buzz
          if (collectionTimerRef.current === null) {
            stateRef.current = 'resolving';
            setState('resolving');
            broadcast({ type: 'state-change', state: 'resolving' });
            
            collectionTimerRef.current = setTimeout(() => {
              resolveBuzzes();
            }, BUZZ_COLLECTION_WINDOW_MS);
          }
          break;
        }

        case 'fj-wager':
        case 'fj-response': {
          if (!connState.player) return;
          for (const listener of phoneMessageListenersRef.current) {
            listener(peerId, connState.player, msg);
          }
          break;
        }
      }
    });

    conn.on('close', () => {
      if (connectionsRef.current.get(peerId)?.conn !== conn) return;
      connectionsRef.current.delete(peerId);
      const interval = syncIntervalsRef.current.get(peerId);
      if (interval) {
        clearInterval(interval);
        syncIntervalsRef.current.delete(peerId);
      }
      updatePlayerList();
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      if (connectionsRef.current.get(peerId)?.conn !== conn) return;
      connectionsRef.current.delete(peerId);
      const interval = syncIntervalsRef.current.get(peerId);
      if (interval) {
        clearInterval(interval);
        syncIntervalsRef.current.delete(peerId);
      }
      updatePlayerList();
    });
  }, [broadcast, updatePlayerList, startSyncWithConnection]);

  const resolveBuzzes = useCallback(() => {
    collectionTimerRef.current = null;
    
    const buzzes = [...pendingBuzzesRef.current].sort(
      (a, b) => a.correctedTimestamp - b.correctedTimestamp
    );
    pendingBuzzesRef.current = [];

    if (buzzes.length === 0) {
      stateRef.current = 'armed';
      setState('armed');
      broadcast({ type: 'state-change', state: 'armed', armTime: armTimeRef.current });
      return;
    }

    const winner = buzzes[0];
    const winnerTime = winner.correctedTimestamp;

    const result: BuzzerRoundResult = {
      winner: {
        peerId: winner.peerId,
        name: winner.name,
        gamePlayerId: winner.gamePlayerId,
        hostTimestamp: winnerTime,
        deltaMs: 0,
      },
      runnerUps: buzzes.slice(1).map((b) => ({
        peerId: b.peerId,
        name: b.name,
        gamePlayerId: b.gamePlayerId,
        hostTimestamp: b.correctedTimestamp,
        deltaMs: Math.round(b.correctedTimestamp - winnerTime),
      })),
      lockedOutIds: Array.from(lockedOutIdsRef.current),
    };

    lastResultRef.current = result;
    setLastResult(result);
    stateRef.current = 'locked';
    setState('locked');

    broadcast({ type: 'buzz-result', result });
    broadcast({
      type: 'state-change',
      state: 'locked',
      lockedOutIds: Array.from(lockedOutIdsRef.current),
    });

    // Send individual status to each player
    sendTo(winner.peerId, { type: 'your-status', status: 'winner' });
    result.runnerUps.forEach((r, i) => {
      sendTo(r.peerId, { type: 'your-status', status: 'runner-up', rank: i + 2 });
    });

    // Send locked out status to players who didn't buzz
    for (const [peerId, connState] of connectionsRef.current) {
      if (connState.player && !buzzes.find((b) => b.peerId === peerId)) {
        sendTo(peerId, { type: 'your-status', status: 'locked-out' });
      }
    }

    playBuzzerWinnerSound();
  }, [broadcast, sendTo]);

  const startRoom = useCallback(() => {
    if (peerRef.current) return;

    setIsConnecting(true);
    setError(null);

    const code = generateRoomCode();
    const peerId = makePeerId(code);
    
    const peer = new Peer(peerId, {
      debug: 0,
    });

    peer.on('open', () => {
      setRoomCode(code);
      setIsConnecting(false);
      stateRef.current = 'waiting';
      setState('waiting');
    });

    peer.on('connection', handleConnection);

    peer.on('disconnected', () => {
      // Keep the host signaling channel alive so phones waking from sleep can always reconnect
      if (!peer.destroyed) {
        try {
          peer.reconnect();
        } catch {
          /* ignore reconnect errors */
        }
      }
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'unavailable-id') {
        // Room code collision, try again
        peer.destroy();
        peerRef.current = null;
        setTimeout(startRoom, 100);
      } else {
        setError(`Connection error: ${err.message}`);
        setIsConnecting(false);
      }
    });

    peerRef.current = peer;
  }, [handleConnection]);

  const stopRoom = useCallback(() => {
    if (collectionTimerRef.current) {
      clearTimeout(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }

    for (const interval of syncIntervalsRef.current.values()) {
      clearInterval(interval);
    }
    syncIntervalsRef.current.clear();

    for (const { conn } of connectionsRef.current.values()) {
      conn.close();
    }
    connectionsRef.current.clear();

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    setRoomCode(null);
    stateRef.current = 'waiting';
    setState('waiting');
    setPlayers([]);
    lastResultRef.current = null;
    setLastResult(null);
    lockedOutIdsRef.current = new Set();
    setLockedOutIds(new Set());
    pendingBuzzesRef.current = [];
  }, []);

  const arm = useCallback((options?: { freshRound?: boolean }) => {
    const freshRound = options?.freshRound === true;

    if (collectionTimerRef.current) {
      clearTimeout(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }

    if (freshRound) {
      lockedOutIdsRef.current = new Set();
      setLockedOutIds(new Set());
      lastResultRef.current = null;
      setLastResult(null);
    }

    armTimeRef.current = performance.now();
    stateRef.current = 'armed';
    setState('armed');
    pendingBuzzesRef.current = [];

    broadcast({
      type: 'state-change',
      state: 'armed',
      armTime: armTimeRef.current,
      lockedOutIds: Array.from(lockedOutIdsRef.current),
    });
    playBuzzerArmedSound();
  }, [broadcast]);

  const reset = useCallback((lockOutWinner = false) => {
    if (collectionTimerRef.current) {
      clearTimeout(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }

    const currentLast = lastResultRef.current;
    if (lockOutWinner && currentLast) {
      const newSet = new Set([...lockedOutIdsRef.current, currentLast.winner.peerId]);
      lockedOutIdsRef.current = newSet;
      setLockedOutIds(newSet);
    } else {
      lockedOutIdsRef.current = new Set();
      setLockedOutIds(new Set());
    }

    stateRef.current = 'waiting';
    setState('waiting');
    lastResultRef.current = null;
    setLastResult(null);
    pendingBuzzesRef.current = [];
    broadcast({
      type: 'state-change',
      state: 'waiting',
      lockedOutIds: Array.from(lockedOutIdsRef.current),
    });
  }, [broadcast]);

  const rearm = useCallback(() => {
    const currentLast = lastResultRef.current;
    if (currentLast) {
      const newSet = new Set([...lockedOutIdsRef.current, currentLast.winner.peerId]);
      lockedOutIdsRef.current = newSet;
      setLockedOutIds(newSet);
    }

    lastResultRef.current = null;
    setLastResult(null);

    if (collectionTimerRef.current) {
      clearTimeout(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }

    pendingBuzzesRef.current = [];
    armTimeRef.current = performance.now();
    stateRef.current = 'armed';
    setState('armed');

    broadcast({
      type: 'state-change',
      state: 'armed',
      armTime: armTimeRef.current,
      lockedOutIds: Array.from(lockedOutIdsRef.current),
    });
    playBuzzerArmedSound();
  }, [broadcast]);

  const kickPlayer = useCallback((peerId: string) => {
    const connState = connectionsRef.current.get(peerId);
    if (connState) {
      sendTo(peerId, { type: 'kick', reason: 'Removed by host' });
      connState.conn.close();
      connectionsRef.current.delete(peerId);
      
      const interval = syncIntervalsRef.current.get(peerId);
      if (interval) {
        clearInterval(interval);
        syncIntervalsRef.current.delete(peerId);
      }
      
      updatePlayerList();
    }
  }, [sendTo, updatePlayerList]);

  const linkPlayerToGame = useCallback((peerId: string, gamePlayerId: string) => {
    const connState = connectionsRef.current.get(peerId);
    if (connState?.player && connState.player.gamePlayerId !== gamePlayerId) {
      connState.player.gamePlayerId = gamePlayerId;
      updatePlayerList();
    }
  }, [updatePlayerList]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRoom();
    };
  }, [stopRoom]);

  return {
    roomCode,
    state,
    players,
    lastResult,
    lockedOutIds,
    error,
    isConnecting,
    startRoom,
    stopRoom,
    arm,
    reset,
    rearm,
    kickPlayer,
    linkPlayerToGame,
    sendToPlayer: sendTo,
    broadcastMessage: broadcast,
    subscribePhoneMessages,
  };
}
