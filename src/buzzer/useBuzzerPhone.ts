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
import {
  clearPhoneIdentity,
  getOrCreateDeviceId,
  getReconnectDelayMs,
  normalizeRoomCode,
  savePhoneIdentity,
  updatePhoneIdentityGamePlayerId,
  type SavedPhoneIdentity,
} from './phone-session';
import { playLockedOutSound, playYouWonSound, vibrate } from './sounds';

const CONNECT_TIMEOUT_MS = 8000;
const SYNC_FALLBACK_TIMEOUT_MS = 2500;
const LIVENESS_PROBE_TIMEOUT_MS = 2000;
const WAKE_DEBOUNCE_MS = 200;

function makePeerId(code: string): string {
  return `jeopardy-buzz-${code}`;
}

type DataConnectionWithPC = DataConnection & {
  peerConnection?: RTCPeerConnection;
};

function isPeerConnectionUnhealthy(conn: DataConnection | null): boolean {
  if (!conn || !conn.open) return true;
  const pc = (conn as DataConnectionWithPC).peerConnection;
  if (!pc) return false;
  const ice = pc.iceConnectionState;
  if (ice === 'failed' || ice === 'closed' || ice === 'disconnected') {
    return true;
  }
  const state = pc.connectionState;
  if (state === 'failed' || state === 'closed' || state === 'disconnected') {
    return true;
  }
  return false;
}

export type PhoneStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'syncing'
  | 'joined';
export type BuzzStatus =
  | 'waiting'
  | 'armed'
  | 'buzzed'
  | 'winner'
  | 'runner-up'
  | 'locked-out';

export interface ConnectOptions {
  gamePlayerId?: string;
  deviceId?: string;
  isAutoRejoin?: boolean;
}

export interface UseBuzzerPhoneResult {
  status: PhoneStatus;
  isReconnecting: boolean;
  buzzStatus: BuzzStatus;
  state: BuzzerState;
  players: BuzzerPlayer[];
  lastResult: BuzzerRoundResult | null;
  myRank: number | null;
  error: string | null;
  syncProgress: number; // 0-1
  finalJeopardy: FinalJeopardyPhoneState | null;
  fjError: string | null;
  connect: (roomCode: string, name: string, options?: ConnectOptions) => void;
  disconnect: (options?: { clearSaved?: boolean }) => void;
  buzz: () => void;
  submitFinalWager: (wager: number) => void;
  submitFinalResponse: (response: string) => void;
}

export function useBuzzerPhone(): UseBuzzerPhoneResult {
  const [status, setStatus] = useState<PhoneStatus>('disconnected');
  const [isReconnecting, setIsReconnecting] = useState(false);
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
  const desiredSessionRef = useRef<SavedPhoneIdentity | null>(null);
  const hasEverJoinedRef = useRef(false);
  const hasBuzzedRef = useRef(false);
  const armTimeRef = useRef<number>(0);
  const pendingSyncRef = useRef<{ phoneSendTime: number } | null>(null);
  const statusRef = useRef<PhoneStatus>('disconnected');
  const isReconnectingRef = useRef(false);

  // Generation counter prevents stale close/error events from old peers clobbering new attempts
  const attemptGenRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const needsReconnectOnVisibleRef = useRef(false);
  const isOpeningRef = useRef(false);
  const lastWakeCheckRef = useRef(0);
  const lastOpenStartedRef = useRef(0);

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livenessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncPingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearAllTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (connectTimeoutRef.current !== null) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (syncFallbackTimerRef.current !== null) {
      clearTimeout(syncFallbackTimerRef.current);
      syncFallbackTimerRef.current = null;
    }
    if (livenessTimerRef.current !== null) {
      clearTimeout(livenessTimerRef.current);
      livenessTimerRef.current = null;
    }
    for (const timer of syncPingTimersRef.current) {
      clearTimeout(timer);
    }
    syncPingTimersRef.current = [];
  }, []);

  const destroyPeerAndConn = useCallback(() => {
    const conn = connRef.current;
    connRef.current = null;
    if (conn) {
      try {
        conn.close();
      } catch {
        /* ignore close errors */
      }
    }
    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* ignore destroy errors */
      }
    }
  }, []);

  const sendMessage = useCallback((msg: PhoneMessage) => {
    if (connRef.current?.open) {
      try {
        connRef.current.send(msg);
      } catch {
        /* ignore send errors on closing channel */
      }
    }
  }, []);

  const startSyncPing = useCallback(() => {
    if (!connRef.current?.open) return;
    const phoneSendTime = performance.now();
    pendingSyncRef.current = { phoneSendTime };
    sendMessage({ type: 'sync-ping', phoneSendTime });
  }, [sendMessage]);

  const finishSyncToJoined = useCallback(() => {
    if (syncFallbackTimerRef.current !== null) {
      clearTimeout(syncFallbackTimerRef.current);
      syncFallbackTimerRef.current = null;
    }
    hasEverJoinedRef.current = true;
    isReconnectingRef.current = false;
    setIsReconnecting(false);
    statusRef.current = 'joined';
    setStatus('joined');
    setError(null);
  }, []);

  const handleMessage = useCallback(
    (data: unknown) => {
      // Any message from host confirms the channel is alive
      if (livenessTimerRef.current !== null) {
        clearTimeout(livenessTimerRef.current);
        livenessTimerRef.current = null;
      }

      const msg = data as HostMessage;

      switch (msg.type) {
        case 'sync-request': {
          sendMessage({
            type: 'sync-pong',
            hostSendTime: msg.hostSendTime,
            phoneReceiveTime: performance.now(),
          });
          startSyncPing();
          break;
        }

        case 'sync-response': {
          const phoneReceiveTime = performance.now();
          const sentTime = msg.phoneSendTime ?? pendingSyncRef.current?.phoneSendTime;
          if (sentTime !== undefined) {
            const sample = calculateSyncSample(
              sentTime,
              msg.hostReceiveTime,
              msg.hostSendTime,
              phoneReceiveTime,
            );
            clockSyncRef.current.addSample(sample);
            pendingSyncRef.current = null;

            const progress = Math.min(clockSyncRef.current.sampleCount / SYNC_SAMPLE_COUNT, 1);
            setSyncProgress(progress);

            if (progress >= 1 && statusRef.current === 'syncing') {
              finishSyncToJoined();
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
          // Persist the host-assigned gamePlayerId for seamless future reconnections
          const desired = desiredSessionRef.current;
          if (desired) {
            const myPeerId = peerRef.current?.id;
            const me = msg.players.find(
              (p) =>
                (myPeerId && p.peerId === myPeerId) ||
                (desired.deviceId && p.deviceId === desired.deviceId),
            );
            if (me?.gamePlayerId && me.gamePlayerId !== desired.gamePlayerId) {
              desiredSessionRef.current = { ...desired, gamePlayerId: me.gamePlayerId };
              updatePhoneIdentityGamePlayerId(desired.roomCode, me.gamePlayerId);
            }
          }
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
          const kickedRoom = desiredSessionRef.current?.roomCode;
          desiredSessionRef.current = null;
          if (kickedRoom) {
            clearPhoneIdentity(kickedRoom);
          }
          attemptGenRef.current += 1;
          clearAllTimers();
          destroyPeerAndConn();
          isReconnectingRef.current = false;
          setIsReconnecting(false);
          statusRef.current = 'disconnected';
          setStatus('disconnected');
          setError(msg.reason);
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
    },
    [clearAllTimers, destroyPeerAndConn, finishSyncToJoined, sendMessage, startSyncPing],
  );

  // Forward ref so scheduleReconnect and openConnection can call each other cleanly
  const openConnectionRef = useRef<(asReconnect: boolean) => void>(() => {});

  const scheduleReconnect = useCallback(
    (gen: number) => {
      if (gen !== attemptGenRef.current) return;
      if (!desiredSessionRef.current) return;

      // Advance generation so any subsequent close/error events from the dying peer are ignored
      attemptGenRef.current += 1;
      isOpeningRef.current = false;
      clearAllTimers();
      destroyPeerAndConn();

      isReconnectingRef.current = true;
      setIsReconnecting(true);
      statusRef.current = 'reconnecting';
      setStatus('reconnecting');

      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        needsReconnectOnVisibleRef.current = true;
        return;
      }

      const delay = getReconnectDelayMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!desiredSessionRef.current) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          needsReconnectOnVisibleRef.current = true;
          return;
        }
        openConnectionRef.current(true);
      }, delay);
    },
    [clearAllTimers, destroyPeerAndConn],
  );

  const openConnection = useCallback(
    (asReconnect: boolean) => {
      const session = desiredSessionRef.current;
      if (!session) return;

      attemptGenRef.current += 1;
      const gen = attemptGenRef.current;
      isOpeningRef.current = true;
      lastOpenStartedRef.current = Date.now();

      clearAllTimers();
      destroyPeerAndConn();

      isReconnectingRef.current = asReconnect;
      setIsReconnecting(asReconnect);
      const nextStatus: PhoneStatus = asReconnect ? 'reconnecting' : 'connecting';
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      if (!asReconnect) {
        setError(null);
      }
      clockSyncRef.current.reset();
      pendingSyncRef.current = null;
      setSyncProgress(0);

      const hostPeerId = makePeerId(session.roomCode);
      const peer = new Peer({
        debug: 0,
      });
      peerRef.current = peer;

      connectTimeoutRef.current = setTimeout(() => {
        if (gen !== attemptGenRef.current) return;
        if (!connRef.current?.open) {
          scheduleReconnect(gen);
        }
      }, CONNECT_TIMEOUT_MS);

      peer.on('open', () => {
        if (gen !== attemptGenRef.current) return;
        const conn = peer.connect(hostPeerId, { reliable: true });
        connRef.current = conn;

        const pc = (conn as DataConnectionWithPC).peerConnection;
        if (pc) {
          pc.addEventListener('iceconnectionstatechange', () => {
            if (gen !== attemptGenRef.current) return;
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
              scheduleReconnect(gen);
            }
          });
        }

        conn.on('open', () => {
          if (gen !== attemptGenRef.current) return;
          isOpeningRef.current = false;
          if (connectTimeoutRef.current !== null) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          connRef.current = conn;
          reconnectAttemptRef.current = 0;
          needsReconnectOnVisibleRef.current = false;
          setError(null);

          statusRef.current = 'syncing';
          setStatus('syncing');

          const activeSession = desiredSessionRef.current ?? session;
          sendMessage({
            type: 'join',
            name: activeSession.name,
            gamePlayerId: activeSession.gamePlayerId,
            deviceId: activeSession.deviceId,
          });

          // Re-run clock sync after every connect/reconnect
          for (let i = 0; i < SYNC_SAMPLE_COUNT; i++) {
            const t = setTimeout(() => {
              if (gen !== attemptGenRef.current) return;
              startSyncPing();
            }, i * 100);
            syncPingTimersRef.current.push(t);
          }

          // Fallback so a single dropped ping never stalls the UI on Syncing
          syncFallbackTimerRef.current = setTimeout(() => {
            if (gen !== attemptGenRef.current) return;
            if (statusRef.current === 'syncing' && connRef.current?.open) {
              finishSyncToJoined();
            }
          }, SYNC_FALLBACK_TIMEOUT_MS);
        });

        conn.on('data', (data) => {
          if (gen !== attemptGenRef.current) return;
          handleMessage(data);
        });

        conn.on('close', () => {
          if (gen !== attemptGenRef.current) return;
          connRef.current = null;
          scheduleReconnect(gen);
        });

        conn.on('error', () => {
          if (gen !== attemptGenRef.current) return;
          connRef.current = null;
          scheduleReconnect(gen);
        });
      });

      peer.on('disconnected', () => {
        if (gen !== attemptGenRef.current) return;
        // If our WebRTC channel is already closed/unhealthy, recreate the Peer cleanly
        if (isPeerConnectionUnhealthy(connRef.current)) {
          scheduleReconnect(gen);
          return;
        }
        // Otherwise try silent signaling reconnect without disrupting the live buzzer
        try {
          if (!peer.destroyed) {
            peer.reconnect();
          }
        } catch {
          /* ignore */
        }
      });

      peer.on('close', () => {
        if (gen !== attemptGenRef.current) return;
        scheduleReconnect(gen);
      });

      peer.on('error', (err) => {
        if (gen !== attemptGenRef.current) return;
        // On a brand-new manual join with an invalid room code, show error immediately
        if (err.type === 'peer-unavailable' && !asReconnect && !hasEverJoinedRef.current) {
          const badRoom = desiredSessionRef.current?.roomCode;
          desiredSessionRef.current = null;
          if (badRoom) {
            clearPhoneIdentity(badRoom);
          }
          attemptGenRef.current += 1;
          clearAllTimers();
          destroyPeerAndConn();
          isReconnectingRef.current = false;
          setIsReconnecting(false);
          statusRef.current = 'disconnected';
          setStatus('disconnected');
          setError('Room not found. Check the room code and try again.');
          return;
        }
        scheduleReconnect(gen);
      });
    },
    [
      clearAllTimers,
      destroyPeerAndConn,
      finishSyncToJoined,
      handleMessage,
      scheduleReconnect,
      sendMessage,
      startSyncPing,
    ],
  );

  openConnectionRef.current = openConnection;

  const connect = useCallback(
    (roomCode: string, name: string, options?: ConnectOptions) => {
      const normalized = normalizeRoomCode(roomCode);
      const trimmedName = name.trim();
      if (!normalized || !trimmedName) return;

      const deviceId = options?.deviceId || getOrCreateDeviceId();
      const session: SavedPhoneIdentity = {
        roomCode: normalized,
        name: trimmedName,
        deviceId,
        ...(options?.gamePlayerId ? { gamePlayerId: options.gamePlayerId } : {}),
      };

      desiredSessionRef.current = session;
      savePhoneIdentity(session);

      reconnectAttemptRef.current = 0;
      needsReconnectOnVisibleRef.current = false;
      if (!options?.isAutoRejoin) {
        hasEverJoinedRef.current = false;
      }

      openConnection(Boolean(options?.isAutoRejoin));
    },
    [openConnection],
  );

  const disconnect = useCallback(
    (options?: { clearSaved?: boolean }) => {
      const shouldClearSaved = options?.clearSaved !== false;
      const prevRoom = desiredSessionRef.current?.roomCode;
      desiredSessionRef.current = null;
      if (shouldClearSaved && prevRoom) {
        clearPhoneIdentity(prevRoom);
      }

      attemptGenRef.current += 1;
      reconnectAttemptRef.current = 0;
      needsReconnectOnVisibleRef.current = false;
      isOpeningRef.current = false;
      hasEverJoinedRef.current = false;

      clearAllTimers();
      destroyPeerAndConn();

      isReconnectingRef.current = false;
      setIsReconnecting(false);
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
      setError(null);
      hasBuzzedRef.current = false;
    },
    [clearAllTimers, destroyPeerAndConn],
  );

  // Detect phone wake / resume / network return and verify or recreate connection
  useEffect(() => {
    const triggerResumeCheck = (forceImmediateReconnect = false) => {
      if (!desiredSessionRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      const now = Date.now();
      if (now - lastOpenStartedRef.current < WAKE_DEBOUNCE_MS) {
        return;
      }
      if (!forceImmediateReconnect && now - lastWakeCheckRef.current < WAKE_DEBOUNCE_MS) {
        return;
      }
      lastWakeCheckRef.current = now;

      const peer = peerRef.current;
      const conn = connRef.current;

      // If a fresh connection attempt is already in flight and PeerJS is healthy,
      // don't interrupt it on incidental focus events (e.g. mobile keyboard dismissing).
      if (
        !forceImmediateReconnect &&
        isOpeningRef.current &&
        peer &&
        !peer.destroyed &&
        !peer.disconnected &&
        reconnectTimerRef.current === null &&
        !needsReconnectOnVisibleRef.current
      ) {
        return;
      }

      const isDead =
        !peer ||
        peer.destroyed ||
        peer.disconnected ||
        isPeerConnectionUnhealthy(conn) ||
        needsReconnectOnVisibleRef.current ||
        reconnectTimerRef.current !== null ||
        statusRef.current === 'reconnecting';

      if (forceImmediateReconnect || isDead) {
        reconnectAttemptRef.current = 0;
        needsReconnectOnVisibleRef.current = false;
        openConnectionRef.current(true);
        return;
      }

      // Connection claims to be open — send a liveness ping so silently frozen mobile sockets
      // are detected quickly and recreated cleanly.
      const gen = attemptGenRef.current;
      if (livenessTimerRef.current !== null) {
        clearTimeout(livenessTimerRef.current);
      }
      startSyncPing();
      livenessTimerRef.current = setTimeout(() => {
        livenessTimerRef.current = null;
        if (gen !== attemptGenRef.current) return;
        if (!desiredSessionRef.current) return;
        reconnectAttemptRef.current = 0;
        openConnectionRef.current(true);
      }, LIVENESS_PROBE_TIMEOUT_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerResumeCheck(false);
      }
    };
    const onPageShow = () => triggerResumeCheck(false);
    const onFocus = () => triggerResumeCheck(false);
    const onOnline = () => triggerResumeCheck(true);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [startSyncPing]);

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

  const submitFinalWager = useCallback(
    (wager: number) => {
      setFjError(null);
      sendMessage({ type: 'fj-wager', wager });
      vibrate(30);
    },
    [sendMessage],
  );

  const submitFinalResponse = useCallback(
    (response: string) => {
      setFjError(null);
      sendMessage({ type: 'fj-response', response });
      vibrate(30);
    },
    [sendMessage],
  );

  // Teardown Peer/timers on unmount WITHOUT clearing saved localStorage identity
  useEffect(() => {
    return () => {
      desiredSessionRef.current = null;
      attemptGenRef.current += 1;
      clearAllTimers();
      destroyPeerAndConn();
    };
  }, [clearAllTimers, destroyPeerAndConn]);

  return {
    status,
    isReconnecting,
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
