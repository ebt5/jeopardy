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
  arm: () => void;
  reset: (lockOutWinner?: boolean) => void;
  rearm: () => void;
  kickPlayer: (peerId: string) => void;
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
  const lockedOutIdsRef = useRef<Set<string>>(new Set());

  const broadcast = useCallback((msg: HostMessage, exclude?: string) => {
    for (const [peerId, { conn }] of connectionsRef.current) {
      if (peerId !== exclude && conn.open) {
        conn.send(msg);
      }
    }
  }, []);

  const sendTo = useCallback((peerId: string, msg: HostMessage) => {
    const state = connectionsRef.current.get(peerId);
    if (state?.conn.open) {
      state.conn.send(msg);
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
      if (conn.open) {
        conn.send({ type: 'sync-request', hostSendTime: performance.now() } as HostMessage);
      }
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
    
    conn.on('open', () => {
      connectionsRef.current.set(peerId, { conn, player: null, syncSamples: 0 });
      startSyncWithConnection(peerId, conn);
      // Send current state
      conn.send({ type: 'state-change', state: stateRef.current, armTime: armTimeRef.current } as HostMessage);
    });

    conn.on('data', (data) => {
      const msg = data as PhoneMessage;
      const connState = connectionsRef.current.get(peerId);
      if (!connState) return;

      switch (msg.type) {
        case 'join': {
          connState.player = {
            peerId,
            name: msg.name.slice(0, 20).trim() || 'Player',
            gamePlayerId: msg.gamePlayerId,
          };
          updatePlayerList();
          break;
        }

        case 'sync-ping': {
          const hostReceiveTime = performance.now();
          conn.send({
            type: 'sync-response',
            hostSendTime: performance.now(),
            hostReceiveTime,
            phoneSendTime: msg.phoneSendTime,
          } as HostMessage);
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
      }
    });

    conn.on('close', () => {
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
      connectionsRef.current.delete(peerId);
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
      lockedOutIds: new Set(lockedOutIds),
    };

    setLastResult(result);
    stateRef.current = 'locked';
    setState('locked');
    
    playBuzzerWinnerSound();
    
    broadcast({ type: 'buzz-result', result });
    broadcast({ type: 'state-change', state: 'locked' });

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
  }, [broadcast, sendTo, lockedOutIds]);

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
    setLastResult(null);
    lockedOutIdsRef.current = new Set();
    setLockedOutIds(new Set());
    pendingBuzzesRef.current = [];
  }, []);

  const arm = useCallback(() => {
    if (stateRef.current === 'armed') return;
    
    armTimeRef.current = performance.now();
    stateRef.current = 'armed';
    setState('armed');
    pendingBuzzesRef.current = [];
    
    playBuzzerArmedSound();
    broadcast({ type: 'state-change', state: 'armed', armTime: armTimeRef.current });
  }, [broadcast]);

  const reset = useCallback((lockOutWinner = false) => {
    if (collectionTimerRef.current) {
      clearTimeout(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }

    if (lockOutWinner && lastResult) {
      const newSet = new Set([...lockedOutIdsRef.current, lastResult.winner.peerId]);
      lockedOutIdsRef.current = newSet;
      setLockedOutIds(newSet);
    } else {
      lockedOutIdsRef.current = new Set();
      setLockedOutIds(new Set());
    }

    stateRef.current = 'waiting';
    setState('waiting');
    setLastResult(null);
    pendingBuzzesRef.current = [];
    broadcast({ type: 'state-change', state: 'waiting' });
  }, [lastResult, broadcast]);

  const rearm = useCallback(() => {
    if (lastResult) {
      const newSet = new Set([...lockedOutIdsRef.current, lastResult.winner.peerId]);
      lockedOutIdsRef.current = newSet;
      setLockedOutIds(newSet);
    }
    
    setLastResult(null);
    
    if (collectionTimerRef.current) {
      clearTimeout(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }
    
    pendingBuzzesRef.current = [];
    armTimeRef.current = performance.now();
    stateRef.current = 'armed';
    setState('armed');
    
    playBuzzerArmedSound();
    broadcast({ type: 'state-change', state: 'armed', armTime: armTimeRef.current });
  }, [lastResult, broadcast]);

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
  };
}
