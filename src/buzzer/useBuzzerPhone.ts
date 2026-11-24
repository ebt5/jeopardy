import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type {
  BuzzerPlayer,
  BuzzerRoundResult,
  BuzzerState,
  FinalJeopardyPhoneState,
  HostMessage,
  PhoneMessage,
} from './types';
import { SYNC_SAMPLE_COUNT } from './types';
import { PhoneClockSync, calculateSyncSample } from './clock-sync';
import { playLockedOutSound, playYouWonSound, vibrate } from './sounds';

function makePeerId(code: string): string {
  return `jeopardy-buzz-${code}`;
}

function getOrCreateDeviceId(): string {
  const key = 'jeopardy-buzzer-device-id';
  let deviceId = localStorage.getItem(key);
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, deviceId);
  }
  return deviceId;
}

export type PhoneStatus = 'disconnected' | 'connecting' | 'joined' | 'syncing';
export type BuzzStatus = 'waiting' | 'armed' | 'buzzed' | 'winner' | 'runner-up' | 'locked-out';

export interface UseBuzzerPhoneResult {
  status: PhoneStatus;
  buzzStatus: BuzzStatus;
  state: BuzzerState;
  players: BuzzerPlayer[];
  lastResult: BuzzerRoundResult | null;
  myRank: number | null;
  error: string | null;
  syncProgress: number; // 0-1
  finalJeopardy: FinalJeopardyPhoneState | null;
  fjError: string | null;
  connect: (roomCode: string, name: string, gamePlayerId?: string) => void;
  disconnect: () => void;
  buzz: () => void;
  submitFinalWager: (wager: number) => void;
  submitFinalResponse: (response: string) => void;
}

export function useBuzzerPhone(): UseBuzzerPhoneResult {
  const [status, setStatus] = useState<PhoneStatus>('disconnected');
  const [buzzStatus, setBuzzStatus] = useState<BuzzStatus>('waiting');
  const [state, setState] = useState<BuzzerState>('waiting');
  const [players, setPlayers] = useState<BuzzerPlayer[]>([]);
  const [lastResult, setLastResult] = useState<BuzzerRoundResult | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);
  const [finalJeopardy, setFinalJeopardy] = useState<FinalJeopardyPhoneState | null>(null);
  const [fjError, setFjError] = useState<string | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const clockSyncRef = useRef(new PhoneClockSync());
  const nameRef = useRef<string>('');
  const gamePlayerIdRef = useRef<string | undefined>(undefined);
  const hasBuzzedRef = useRef(false);
  const armTimeRef = useRef<number>(0);
  const pendingSyncRef = useRef<{ phoneSendTime: number } | null>(null);
  const statusRef = useRef<PhoneStatus>('disconnected');

  const sendMessage = useCallback((msg: PhoneMessage) => {
    if (connRef.current?.open) {
      connRef.current.send(msg);
    }
  }, []);

  const startSyncPing = useCallback(() => {
    if (!connRef.current?.open) return;
    const phoneSendTime = performance.now();
    pendingSyncRef.current = { phoneSendTime };
    sendMessage({ type: 'sync-ping', phoneSendTime });
  }, [sendMessage]);

  const handleMessage = useCallback((data: unknown) => {
    const msg = data as HostMessage;

    switch (msg.type) {
      case 'sync-request': {
        // Host initiated sync, respond with pong
        sendMessage({
          type: 'sync-pong',
          hostSendTime: msg.hostSendTime,
          phoneReceiveTime: performance.now(),
        });
        // Also send our own ping for the reverse direction
        startSyncPing();
        break;
      }

      case 'sync-response': {
        const phoneReceiveTime = performance.now();
        if (pendingSyncRef.current) {
          const sample = calculateSyncSample(
            pendingSyncRef.current.phoneSendTime,
            msg.hostReceiveTime,
            msg.hostSendTime,
            phoneReceiveTime
          );
          clockSyncRef.current.addSample(sample);
          pendingSyncRef.current = null;
          
          const progress = Math.min(clockSyncRef.current.sampleCount / SYNC_SAMPLE_COUNT, 1);
          setSyncProgress(progress);
          
          if (progress >= 1 && statusRef.current === 'syncing') {
            statusRef.current = 'joined';
            setStatus('joined');
          }
        }
        break;
      }

      case 'state-change': {
        setState(msg.state);
        if (msg.armTime !== undefined) {
          armTimeRef.current = msg.armTime;
        }
        
        if (msg.state === 'armed') {
          hasBuzzedRef.current = false;
          setBuzzStatus('armed');
          vibrate(30);
        } else if (msg.state === 'waiting') {
          hasBuzzedRef.current = false;
          setBuzzStatus('waiting');
          setMyRank(null);
        } else if (msg.state === 'resolving') {
          if (hasBuzzedRef.current) {
            setBuzzStatus('buzzed');
          }
        } else if (msg.state === 'locked') {
          if (!hasBuzzedRef.current) {
            setBuzzStatus('locked-out');
          }
        }
        break;
      }

      case 'player-list': {
        setPlayers(msg.players);
        break;
      }

      case 'buzz-result': {
        setLastResult(msg.result);
        break;
      }

      case 'your-status': {
        if (msg.status === 'winner') {
          setBuzzStatus('winner');
          setMyRank(1);
          playYouWonSound();
          vibrate([100, 50, 100]);
        } else if (msg.status === 'runner-up') {
          setBuzzStatus('runner-up');
          setMyRank(msg.rank ?? 2);
          vibrate(50);
        } else if (msg.status === 'locked-out') {
          setBuzzStatus('locked-out');
          playLockedOutSound();
          vibrate(200);
        }
        break;
      }

      case 'kick': {
        setError(msg.reason);
        // Close connection inline since disconnect is defined later
        if (connRef.current) {
          connRef.current.close();
          connRef.current = null;
        }
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
        statusRef.current = 'disconnected';
        setStatus('disconnected');
        setFinalJeopardy(null);
        setFjError(null);
        break;
      }

      case 'fj-state': {
        setFinalJeopardy(msg.state);
        setFjError(null);
        if (msg.state && msg.state.phase === 'clue' && !msg.state.responseLocked) {
          vibrate(40);
        }
        break;
      }

      case 'fj-error': {
        setFjError(msg.message);
        break;
      }
    }
  }, [sendMessage, startSyncPing]);

  const connect = useCallback((roomCode: string, name: string, gamePlayerId?: string) => {
    if (peerRef.current) {
      disconnect();
    }

    statusRef.current = 'connecting';
    setStatus('connecting');
    setError(null);
    nameRef.current = name;
    gamePlayerIdRef.current = gamePlayerId;
    clockSyncRef.current.reset();
    setSyncProgress(0);

    const hostPeerId = makePeerId(roomCode.toUpperCase());
    const peer = new Peer({
      debug: 0,
    });

    peer.on('open', () => {
      const conn = peer.connect(hostPeerId, { reliable: true });
      
      conn.on('open', () => {
        connRef.current = conn;
        statusRef.current = 'syncing';
        setStatus('syncing');
        
        // Send join message with device ID for reconnection support
        const deviceId = getOrCreateDeviceId();
        sendMessage({
          type: 'join',
          name: nameRef.current,
          gamePlayerId: gamePlayerIdRef.current,
          deviceId,
        });
        
        // Start initial sync
        for (let i = 0; i < SYNC_SAMPLE_COUNT; i++) {
          setTimeout(startSyncPing, i * 100);
        }
      });

      conn.on('data', handleMessage);

      conn.on('close', () => {
        statusRef.current = 'disconnected';
        setStatus('disconnected');
        setError('Connection closed');
        setFinalJeopardy(null);
        setFjError(null);
        connRef.current = null;
      });

      conn.on('error', (err) => {
        console.error('Connection error:', err);
        setError(`Connection error: ${err.message || err.type}`);
        statusRef.current = 'disconnected';
        setStatus('disconnected');
        setFinalJeopardy(null);
        setFjError(null);
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'peer-unavailable') {
        setError('Room not found. Check the room code and try again.');
      } else {
        setError(`Connection error: ${err.message}`);
      }
      statusRef.current = 'disconnected';
      setStatus('disconnected');
    });

    peerRef.current = peer;
  }, [handleMessage, sendMessage, startSyncPing]);

  const disconnect = useCallback(() => {
    if (connRef.current) {
      connRef.current.close();
      connRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    statusRef.current = 'disconnected';
    setStatus('disconnected');
    setState('waiting');
    setBuzzStatus('waiting');
    setPlayers([]);
    setLastResult(null);
    setMyRank(null);
    setSyncProgress(0);
    setFinalJeopardy(null);
    setFjError(null);
    hasBuzzedRef.current = false;
  }, []);

  const buzz = useCallback(() => {
    if (state !== 'armed' || hasBuzzedRef.current) return;
    
    hasBuzzedRef.current = true;
    const localTimestamp = performance.now();
    const correctedTimestamp = clockSyncRef.current.toHostTime(localTimestamp);
    
    sendMessage({
      type: 'buzz',
      localTimestamp,
      correctedTimestamp,
    });
    
    setBuzzStatus('buzzed');
    vibrate(50);
  }, [state, sendMessage]);

  const submitFinalWager = useCallback((wager: number) => {
    setFjError(null);
    sendMessage({ type: 'fj-wager', wager });
    vibrate(30);
  }, [sendMessage]);

  const submitFinalResponse = useCallback((response: string) => {
    setFjError(null);
    sendMessage({ type: 'fj-response', response });
    vibrate(30);
  }, [sendMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    buzzStatus,
    state,
    players,
    lastResult,
    myRank,
    error,
    syncProgress,
    finalJeopardy,
    fjError,
    connect,
    disconnect,
    buzz,
    submitFinalWager,
    submitFinalResponse,
  };
}
