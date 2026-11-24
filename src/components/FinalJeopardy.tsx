import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinalJeopardy as FJ, Player } from '../types';
import { maxFinalJeopardyWager } from '../types';
import type { UseBuzzerHostResult } from '../buzzer/useBuzzerHost';
import type { BuzzerPlayer, PhoneMessage } from '../buzzer/types';
import {
  advanceToClue,
  advanceToDone,
  advanceToReveal,
  areAllPlayersRevealed,
  clearPlayerVerdict,
  createFinalJeopardySession,
  DEFAULT_FJ_TIMER_SECONDS,
  formatScore,
  formatTimer,
  getPhoneStateForPlayer,
  handlePhoneResponse,
  handlePhoneWager,
  isSubmissionsClosed,
  judgePlayer,
  MAX_FJ_RESPONSE_LENGTH,
  nextUnrevealedIndex,
  revealPlayerWager,
  setAllowLateResponses,
  setCorrectResponseShown,
  setHostResponse,
  setHostWager,
  setRevealIndex,
  setTimerExpired,
  syncPlayersIntoSession,
  type FinalJeopardySession,
  type FinalJeopardyTimerSnapshot,
} from '../buzzer/final-jeopardy';
import {
  playFinalJeopardyTimeUpSound,
  playFinalJeopardyVerdictSound,
  playFinalJeopardyWagerRevealSound,
  startFinalJeopardyThinkMusic,
  unlockAudio,
} from '../sound';
import {
  loadCustomThinkMusic,
  subscribeCustomThinkMusicChange,
  type CustomThinkMusicRecord,
} from '../musicStorage';
import { ThinkMusicSetting } from './ThinkMusicSetting';
import './FinalJeopardy.css';

type HostStep = 'category' | 'wagers' | 'clue' | 'reveal' | 'done';

interface FinalJeopardyProps {
  finalJeopardy: FJ;
  players: Player[];
  onAdjustScore: (playerId: string, delta: number) => void;
  onClose: () => void;
  onDoneToSetup: () => void;
  buzzerHost?: UseBuzzerHostResult;
}

interface AnimatedScoreProps {
  fromScore: number;
  toScore: number;
  animate: boolean;
  className?: string;
}

function AnimatedScore({ fromScore, toScore, animate, className = '' }: AnimatedScoreProps) {
  const [displayed, setDisplayed] = useState(animate ? fromScore : toScore);

  useEffect(() => {
    if (!animate || fromScore === toScore) {
      setDisplayed(toScore);
      return;
    }

    const durationMs = 850;
    const start = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / durationMs, 1);
      // Cubic ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(fromScore + (toScore - fromScore) * eased));
      if (t < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    setDisplayed(fromScore);
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [fromScore, toScore, animate]);

  return (
    <span className={`${className}${displayed < 0 ? ' negative' : ''}`}>
      {formatScore(displayed)}
    </span>
  );
}

export function FinalJeopardyView({
  finalJeopardy,
  players,
  onAdjustScore,
  onClose,
  onDoneToSetup,
  buzzerHost,
}: FinalJeopardyProps) {
  const [step, setStep] = useState<HostStep>('category');
  const [session, setSession] = useState<FinalJeopardySession>(() =>
    createFinalJeopardySession(finalJeopardy, players),
  );

  // Manual wager inputs for players without locked phone wagers or when host overrides
  const [manualWagers, setManualWagers] = useState<Record<string, string>>(() =>
    Object.fromEntries(players.map((p) => [p.id, '0'])),
  );
  const [overridingWagerId, setOverridingWagerId] = useState<string | null>(null);
  const [overrideWagerInput, setOverrideWagerInput] = useState<string>('0');

  // Optional host response editing (during clue or reveal)
  const [editingResponseId, setEditingResponseId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState<string>('');

  // Track which player just had their wager revealed so we animate their score once
  const [justRevealedId, setJustRevealedId] = useState<string | null>(null);

  // 60-second think timer & music (default synthesized or host's local IndexedDB file)
  const [secondsLeft, setSecondsLeft] = useState<number>(DEFAULT_FJ_TIMER_SECONDS);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [musicEnabled, setMusicEnabled] = useState<boolean>(true);
  const [audioBlocked, setAudioBlocked] = useState<boolean>(false);
  const [customMusicRecord, setCustomMusicRecord] = useState<CustomThinkMusicRecord | null>(
    null,
  );

  const synthStopRef = useRef<(() => void) | null>(null);
  const customAudioRef = useRef<HTMLAudioElement | null>(null);
  const customAudioUrlRef = useRef<string | null>(null);
  const musicPlayingRef = useRef<'custom' | 'synth' | null>(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const playersRef = useRef(players);
  playersRef.current = players;
  const stepRef = useRef(step);
  stepRef.current = step;
  const timerRunningRef = useRef(timerRunning);
  timerRunningRef.current = timerRunning;
  const secondsLeftRef = useRef(secondsLeft);
  secondsLeftRef.current = secondsLeft;
  const musicEnabledRef = useRef(musicEnabled);
  musicEnabledRef.current = musicEnabled;
  const lastSentStateRef = useRef<Map<string, string>>(new Map());

  const stopAllThinkMusic = useCallback((resetPosition = false) => {
    if (synthStopRef.current) {
      synthStopRef.current();
      synthStopRef.current = null;
    }
    if (customAudioRef.current) {
      try {
        customAudioRef.current.pause();
        if (resetPosition) {
          customAudioRef.current.currentTime = 0;
        }
      } catch {
        /* ignore audio errors */
      }
    }
    musicPlayingRef.current = null;
  }, []);

  const startThinkMusicNow = useCallback(
    (elapsedSeconds: number, resetCustom = false) => {
      unlockAudio();
      const customAudio = customAudioRef.current;
      if (customAudio) {
        if (synthStopRef.current) {
          synthStopRef.current();
          synthStopRef.current = null;
        }
        try {
          if (resetCustom) {
            customAudio.currentTime = 0;
          }
          musicPlayingRef.current = 'custom';
          const playPromise = customAudio.play();
          if (playPromise && typeof playPromise.then === 'function') {
            playPromise
              .then(() => {
                setAudioBlocked(false);
              })
              .catch(() => {
                musicPlayingRef.current = null;
                setAudioBlocked(true);
              });
          } else {
            setAudioBlocked(false);
          }
        } catch {
          musicPlayingRef.current = null;
          setAudioBlocked(true);
        }
        return;
      }

      if (musicPlayingRef.current !== 'synth') {
        musicPlayingRef.current = 'synth';
        synthStopRef.current = startFinalJeopardyThinkMusic(elapsedSeconds);
        setAudioBlocked(false);
      }
    },
    [],
  );

  // Load any saved custom music file from IndexedDB & stay in sync with changes
  useEffect(() => {
    let active = true;
    void loadCustomThinkMusic().then((rec) => {
      if (active) setCustomMusicRecord(rec);
    });
    const unsub = subscribeCustomThinkMusicChange((next) => {
      setCustomMusicRecord(next);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  // Preload custom audio element whenever the saved file changes
  useEffect(() => {
    const wasPlaying =
      stepRef.current === 'clue' &&
      timerRunningRef.current &&
      musicEnabledRef.current &&
      secondsLeftRef.current > 0;

    stopAllThinkMusic(true);

    if (customAudioUrlRef.current) {
      URL.revokeObjectURL(customAudioUrlRef.current);
      customAudioUrlRef.current = null;
    }
    customAudioRef.current = null;

    if (customMusicRecord) {
      const url = URL.createObjectURL(customMusicRecord.blob);
      const audio = new Audio(url);
      audio.loop = true;
      audio.preload = 'auto';
      customAudioUrlRef.current = url;
      customAudioRef.current = audio;
    }

    if (wasPlaying) {
      startThinkMusicNow(DEFAULT_FJ_TIMER_SECONDS - secondsLeftRef.current, true);
    }

    return () => {
      if (customAudioRef.current) {
        try {
          customAudioRef.current.pause();
          customAudioRef.current.src = '';
        } catch {
          /* ignore */
        }
        customAudioRef.current = null;
      }
      if (customAudioUrlRef.current) {
        URL.revokeObjectURL(customAudioUrlRef.current);
        customAudioUrlRef.current = null;
      }
    };
  }, [customMusicRecord, stopAllThinkMusic, startThinkMusicNow]);

  // Keep session entries synced if a new player connects mid-Final
  useEffect(() => {
    setSession((prev) => syncPlayersIntoSession(prev, players));
    setManualWagers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of players) {
        if (!(p.id in next)) {
          next[p.id] = '0';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [players]);

  const currentTimerSnapshot = useCallback(
    (): FinalJeopardyTimerSnapshot => ({
      secondsLeft: secondsLeftRef.current,
      durationSeconds: DEFAULT_FJ_TIMER_SECONDS,
      running: timerRunningRef.current,
    }),
    [],
  );

  // Push personalized Final Jeopardy state + synced countdown to every connected phone
  useEffect(() => {
    if (!buzzerHost?.roomCode) {
      lastSentStateRef.current.clear();
      return;
    }

    const timerSnapshot: FinalJeopardyTimerSnapshot = {
      secondsLeft,
      durationSeconds: DEFAULT_FJ_TIMER_SECONDS,
      running: timerRunning,
    };

    const activePeerIds = new Set<string>();
    for (const player of players) {
      if (!player.buzzerPeerId) continue;
      activePeerIds.add(player.buzzerPeerId);
      const phoneState = getPhoneStateForPlayer(session, player, timerSnapshot);
      const serialized = JSON.stringify(phoneState);
      if (lastSentStateRef.current.get(player.buzzerPeerId) !== serialized) {
        lastSentStateRef.current.set(player.buzzerPeerId, serialized);
        buzzerHost.sendToPlayer(player.buzzerPeerId, {
          type: 'fj-state',
          state: phoneState,
        });
      }
    }

    for (const peerId of Array.from(lastSentStateRef.current.keys())) {
      if (!activePeerIds.has(peerId)) {
        lastSentStateRef.current.delete(peerId);
      }
    }
  }, [session, players, buzzerHost, secondsLeft, timerRunning]);

  // Clear Final Jeopardy screen on phones and stop music when leaving Final Jeopardy
  useEffect(() => {
    return () => {
      stopAllThinkMusic(true);
      lastSentStateRef.current.clear();
      if (buzzerHost?.roomCode) {
        buzzerHost.broadcastMessage({ type: 'fj-state', state: null });
      }
    };
  }, [buzzerHost, stopAllThinkMusic]);

  // Listen for phone fj-wager and fj-response messages
  useEffect(() => {
    if (!buzzerHost) return;

    const resolvePlayerId = (peerId: string, bp: BuzzerPlayer): string | null => {
      if (bp.gamePlayerId && sessionRef.current.entries[bp.gamePlayerId]) {
        return bp.gamePlayerId;
      }
      const byPeer = playersRef.current.find((p) => p.buzzerPeerId === peerId);
      if (byPeer) return byPeer.id;
      const byName = playersRef.current.find(
        (p) => p.name.toLowerCase() === bp.name.toLowerCase(),
      );
      return byName?.id ?? null;
    };

    const unsubscribe = buzzerHost.subscribePhoneMessages(
      (peerId: string, bp: BuzzerPlayer, msg: PhoneMessage) => {
        if (msg.type !== 'fj-wager' && msg.type !== 'fj-response') return;

        const playerId = resolvePlayerId(peerId, bp);
        if (!playerId) {
          buzzerHost.sendToPlayer(peerId, {
            type: 'fj-error',
            message: 'Could not match your phone to a player.',
          });
          return;
        }

        const current = sessionRef.current;
        const result =
          msg.type === 'fj-wager'
            ? handlePhoneWager(current, playerId, msg.wager)
            : handlePhoneResponse(current, playerId, msg.response);

        if (result.error) {
          buzzerHost.sendToPlayer(peerId, {
            type: 'fj-error',
            message: result.error,
          });
          const player = playersRef.current.find((p) => p.id === playerId);
          if (player) {
            buzzerHost.sendToPlayer(peerId, {
              type: 'fj-state',
              state: getPhoneStateForPlayer(current, player, currentTimerSnapshot()),
            });
          }
          return;
        }

        sessionRef.current = result.session;
        setSession(result.session);
      },
    );

    return unsubscribe;
  }, [buzzerHost, currentTimerSnapshot]);

  // Manage 60-second countdown interval
  useEffect(() => {
    if (!timerRunning || step !== 'clue') return;

    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          stopAllThinkMusic(false);
          playFinalJeopardyTimeUpSound();
          const expired = setTimerExpired(sessionRef.current, true);
          sessionRef.current = expired;
          setSession(expired);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [timerRunning, step, stopAllThinkMusic]);

  // Ensure music stops if timer pauses, finishes, or host leaves clue step
  useEffect(() => {
    if (!timerRunning || !musicEnabled || step !== 'clue' || secondsLeft <= 0) {
      stopAllThinkMusic(false);
    }
  }, [timerRunning, musicEnabled, step, secondsLeft, stopAllThinkMusic]);

  // Escape shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'done') onClose();
        else if (window.confirm('Exit Final Jeopardy and return to the board?')) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  const hasConnectedPhones = players.some((p) => Boolean(p.buzzerPeerId));
  const wagersLockedCount = players.filter(
    (p) => session.entries[p.id]?.wagerLocked,
  ).length;
  const responsesLockedCount = players.filter(
    (p) => session.entries[p.id]?.responseLocked,
  ).length;

  const handleSaveWagerOverride = (playerId: string) => {
    const player = players.find((p) => p.id === playerId);
    const entry = session.entries[playerId];
    if (!player || !entry) return;
    const max = maxFinalJeopardyWager(entry.startingScore);
    const parsed = max === 0 ? 0 : parseInt(overrideWagerInput.trim() || '0', 10);
    const res = setHostWager(session, playerId, parsed);
    if (res.error) {
      window.alert(`${player.name}: ${res.error}`);
      return;
    }
    sessionRef.current = res.session;
    setSession(res.session);
    setOverridingWagerId(null);
  };

  const handleConfirmAllWagers = () => {
    // Unlock audio right away inside the host's click gesture
    unlockAudio();

    const hostOverrides: Record<string, number> = {};
    const unlockedConnectedNames: string[] = [];

    for (const p of players) {
      const entry = session.entries[p.id];
      const max = maxFinalJeopardyWager(entry?.startingScore ?? p.score);
      if (entry?.wagerLocked) continue;

      if (p.buzzerPeerId) {
        if (max > 0) {
          unlockedConnectedNames.push(p.name);
        } else {
          hostOverrides[p.id] = 0;
        }
      } else {
        const raw = max === 0 ? 0 : parseInt((manualWagers[p.id] ?? '0').trim() || '0', 10);
        if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0 || raw > max) {
          window.alert(`${p.name}: wager must be between $0 and $${max}.`);
          return;
        }
        hostOverrides[p.id] = raw;
      }
    }

    if (unlockedConnectedNames.length > 0) {
      const ok = window.confirm(
        `${unlockedConnectedNames.join(', ')} ${
          unlockedConnectedNames.length === 1 ? 'has' : 'have'
        } not locked a wager yet. Lock them in at $0 and reveal the clue?`,
      );
      if (!ok) return;
    }

    const res = advanceToClue(session, hostOverrides);
    if (res.error) {
      window.alert(res.error);
      return;
    }
    sessionRef.current = res.session;
    setSession(res.session);
    setOverridingWagerId(null);
    setSecondsLeft(DEFAULT_FJ_TIMER_SECONDS);
    setTimerRunning(true);
    setStep('clue');

    // Automatically start think music directly from this click gesture so autoplay never blocks it
    if (musicEnabled) {
      startThinkMusicNow(0, true);
    }
  };

  const handlePauseTimer = () => {
    setTimerRunning(false);
    stopAllThinkMusic(false);
  };

  const handleStartOrResumeTimer = () => {
    unlockAudio();
    const restarting = secondsLeft === 0;
    if (restarting) {
      setSecondsLeft(DEFAULT_FJ_TIMER_SECONDS);
      const reopened = setTimerExpired(sessionRef.current, false);
      sessionRef.current = reopened;
      setSession(reopened);
    }
    setTimerRunning(true);
    if (musicEnabled) {
      const elapsed = restarting ? 0 : DEFAULT_FJ_TIMER_SECONDS - secondsLeft;
      startThinkMusicNow(elapsed, restarting);
    }
  };

  const handleResetTimer = () => {
    setTimerRunning(false);
    setSecondsLeft(DEFAULT_FJ_TIMER_SECONDS);
    stopAllThinkMusic(true);
    const reopened = setTimerExpired(sessionRef.current, false);
    sessionRef.current = reopened;
    setSession(reopened);
  };

  const handleToggleMusic = () => {
    const nextEnabled = !musicEnabled;
    setMusicEnabled(nextEnabled);
    if (!nextEnabled) {
      stopAllThinkMusic(false);
      setAudioBlocked(false);
    } else if (step === 'clue' && timerRunning && secondsLeft > 0) {
      startThinkMusicNow(DEFAULT_FJ_TIMER_SECONDS - secondsLeft, false);
    }
  };

  const handleToggleAllowLate = () => {
    const next = setAllowLateResponses(sessionRef.current, !session.allowLateResponses);
    sessionRef.current = next;
    setSession(next);
  };

  const handleBeginReveal = () => {
    const missingPhones = players.filter(
      (p) => p.buzzerPeerId && !session.entries[p.id]?.responseLocked,
    );
    if (missingPhones.length > 0) {
      const names = missingPhones.map((p) => p.name).join(', ');
      const ok = window.confirm(
        `${names} ${
          missingPhones.length === 1 ? 'has' : 'have'
        } not submitted a response yet. Begin the reveal anyway?`,
      );
      if (!ok) return;
    }
    setTimerRunning(false);
    stopAllThinkMusic(true);
    setEditingResponseId(null);
    const next = advanceToReveal(session, players);
    sessionRef.current = next;
    setSession(next);
    setJustRevealedId(null);
    setStep('reveal');
  };

  const handleSaveHostResponse = (playerId: string) => {
    const next = setHostResponse(session, playerId, responseDraft);
    sessionRef.current = next;
    setSession(next);
    setEditingResponseId(null);
    setResponseDraft('');
  };

  const handleJudge = (playerId: string, verdict: 'correct' | 'incorrect') => {
    playFinalJeopardyVerdictSound(verdict === 'correct');
    const next = judgePlayer(session, playerId, verdict);
    sessionRef.current = next;
    setSession(next);
  };

  const handleClearVerdict = (playerId: string) => {
    const next = clearPlayerVerdict(session, playerId);
    sessionRef.current = next;
    setSession(next);
  };

  const handleRevealWager = (playerId: string) => {
    const { session: next, scoreDelta } = revealPlayerWager(session, playerId);
    if (next === session) return;
    playFinalJeopardyWagerRevealSound();
    sessionRef.current = next;
    setSession(next);
    setJustRevealedId(playerId);
    if (scoreDelta !== 0) {
      onAdjustScore(playerId, scoreDelta);
    }
  };

  const handleGoToNextPlayer = () => {
    const nextIdx = nextUnrevealedIndex(session);
    setJustRevealedId(null);
    setEditingResponseId(null);
    setOverridingWagerId(null);
    if (nextIdx !== null) {
      const next = setRevealIndex(session, nextIdx);
      sessionRef.current = next;
      setSession(next);
    } else {
      const next = advanceToDone(session);
      sessionRef.current = next;
      setSession(next);
      setStep('done');
    }
  };

  // ==================== STEP 1: CATEGORY ====================
  if (step === 'category') {
    return (
      <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-splash-body">
          <p className="dd-splash-label">FINAL JEOPARDY</p>
          <p className="dd-splash-category">{session.category}</p>

          {hasConnectedPhones && (
            <div className="fj-status-strip">
              <p className="fj-status-summary">
                Phone wagers locked: {wagersLockedCount} / {players.length}
              </p>
              <div className="fj-status-pills">
                {players.map((p) => {
                  const locked = session.entries[p.id]?.wagerLocked === true;
                  return (
                    <span
                      key={p.id}
                      className={`fj-status-pill ${locked ? 'is-ready' : 'is-waiting'}`}
                    >
                      <span className="fj-pill-icon">
                        {p.buzzerPeerId ? '📱' : p.isManual ? '🎤' : '⏳'}
                      </span>
                      <span>{p.name}</span>
                      <span className="fj-pill-check" aria-label={locked ? 'Locked' : 'Waiting'}>
                        {locked ? '✓' : '…'}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn primary large"
            onClick={() => {
              unlockAudio();
              setStep('wagers');
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ==================== STEP 2: WAGERS ====================
  if (step === 'wagers') {
    return (
      <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-panel fj-panel">
          <p className="dd-badge">FINAL JEOPARDY</p>
          <h2 className="dd-heading">Wagers</h2>
          <p className="clue-hint">
            Category: {session.category}
            {hasConnectedPhones && ` · ${wagersLockedCount}/${players.length} locked`}
          </p>

          <div className="fj-wager-list">
            {players.map((p) => {
              const entry = session.entries[p.id];
              const startingScore = entry?.startingScore ?? p.score;
              const max = maxFinalJeopardyWager(startingScore);
              const isPhoneConnected = Boolean(p.buzzerPeerId);
              const isLocked = entry?.wagerLocked === true;
              const isOverriding = overridingWagerId === p.id;

              return (
                <div key={p.id} className="fj-wager-row">
                  <div className="fj-wager-player">
                    <span
                      className="fj-wager-icon"
                      title={
                        isPhoneConnected
                          ? 'Phone connected'
                          : p.isManual
                            ? 'Manual player'
                            : 'Phone disconnected'
                      }
                    >
                      {isPhoneConnected ? '📱' : p.isManual ? '🎤' : '⏳'}
                    </span>
                    <div>
                      <div className="fj-wager-name">{p.name}</div>
                      <div className="fj-wager-score">
                        {formatScore(startingScore)} · max {formatScore(max)}
                        {!isPhoneConnected && !p.isManual && buzzerHost?.roomCode && (
                          <span className="fj-disconnected-tag"> · disconnected</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="fj-wager-control">
                    {isOverriding ? (
                      <div className="fj-override-editor">
                        <input
                          type="number"
                          min={0}
                          max={max}
                          step={1}
                          value={max === 0 ? '0' : overrideWagerInput}
                          disabled={max === 0}
                          aria-label={`${p.name} wager override`}
                          onChange={(e) => setOverrideWagerInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveWagerOverride(p.id);
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn small primary"
                          onClick={() => handleSaveWagerOverride(p.id)}
                        >
                          Lock
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => setOverridingWagerId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : isLocked ? (
                      <div className="fj-locked-indicator">
                        <span className="fj-check-badge">✓ Wager locked</span>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            setOverridingWagerId(p.id);
                            setOverrideWagerInput(String(entry?.wager ?? 0));
                          }}
                        >
                          Override
                        </button>
                      </div>
                    ) : isPhoneConnected ? (
                      <div className="fj-locked-indicator">
                        <span className="fj-waiting-badge">⏳ Waiting on phone…</span>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            setOverridingWagerId(p.id);
                            setOverrideWagerInput('0');
                          }}
                        >
                          Enter manually
                        </button>
                      </div>
                    ) : (
                      <div className="fj-manual-input-wrap">
                        <input
                          type="number"
                          min={0}
                          max={max}
                          step={1}
                          aria-label={`${p.name} wager`}
                          value={max === 0 ? '0' : (manualWagers[p.id] ?? '0')}
                          disabled={max === 0}
                          onChange={(e) =>
                            setManualWagers((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <ThinkMusicSetting compact />

          <div className="dd-wager-actions">
            <button type="button" className="btn" onClick={() => setStep('category')}>
              Back
            </button>
            <button type="button" className="btn primary large" onClick={handleConfirmAllWagers}>
              Lock wagers &amp; reveal clue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== STEP 3: CLUE & 60s THINK TIMER ====================
  if (step === 'clue') {
    const progressPct = Math.max(
      0,
      Math.min(100, (secondsLeft / DEFAULT_FJ_TIMER_SECONDS) * 100),
    );
    const isUrgent = timerRunning && secondsLeft <= 10 && secondsLeft > 0;
    const isTimeUp = secondsLeft === 0;
    const submissionsClosed = isSubmissionsClosed(session);

    return (
      <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="clue-meta">
          <span>{session.category}</span>
          <span className="dd-inline-badge">FINAL JEOPARDY</span>
        </div>

        <div className="fj-clue-stage">
          {/* Prominent 60-second Countdown Timer & Music Controls */}
          <div
            className={`fj-timer-bar prominent${isUrgent ? ' urgent' : ''}${
              isTimeUp ? ' time-up' : ''
            }`}
          >
            <div className="fj-timer-top">
              <div className="fj-timer-clock-wrap">
                <div className="fj-timer-clock" aria-live="polite">
                  {isTimeUp ? "TIME'S UP!" : formatTimer(secondsLeft)}
                </div>
                <span className="fj-timer-sublabel">
                  {isTimeUp
                    ? submissionsClosed
                      ? 'Submissions locked'
                      : 'Late answers allowed'
                    : timerRunning
                      ? customMusicRecord
                        ? `Playing: ${customMusicRecord.name}`
                        : musicEnabled
                          ? 'Think music playing'
                          : 'Timer running (muted)'
                      : 'Paused'}
                </span>
              </div>

              <div className="fj-timer-controls">
                {!timerRunning ? (
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={handleStartOrResumeTimer}
                  >
                    {secondsLeft === 0
                      ? '▶ Restart 1:00'
                      : secondsLeft === DEFAULT_FJ_TIMER_SECONDS
                        ? '▶ Start 1:00 Timer'
                        : '▶ Resume'}
                  </button>
                ) : (
                  <button type="button" className="btn small" onClick={handlePauseTimer}>
                    ⏸ Pause
                  </button>
                )}
                <button type="button" className="btn small" onClick={handleResetTimer}>
                  ↺ Reset
                </button>
                <button
                  type="button"
                  className={`btn small${musicEnabled ? ' fj-music-on' : ''}`}
                  onClick={handleToggleMusic}
                  title="Toggle think music"
                >
                  {musicEnabled ? '🔊 Music On' : '🔇 Music Off'}
                </button>
              </div>
            </div>

            <div className="fj-timer-track">
              <div className="fj-timer-fill" style={{ width: `${progressPct}%` }} />
            </div>

            {audioBlocked && musicEnabled && timerRunning && (
              <div className="fj-audio-blocked-row">
                <span>Browser paused audio autoplay.</span>
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() =>
                    startThinkMusicNow(DEFAULT_FJ_TIMER_SECONDS - secondsLeft, false)
                  }
                >
                  🔊 Play Music
                </button>
              </div>
            )}

            {isTimeUp && hasConnectedPhones && (
              <div className="fj-late-answers-row">
                <span className="fj-late-status">
                  {submissionsClosed
                    ? '🔒 Phone submissions locked at 0:00.'
                    : '🔓 Late answers are currently allowed.'}
                </span>
                <button
                  type="button"
                  className={`btn small ${submissionsClosed ? 'primary' : ''}`}
                  onClick={handleToggleAllowLate}
                >
                  {submissionsClosed ? '🔓 Allow Late Answers' : '🔒 Lock Submissions'}
                </button>
              </div>
            )}
          </div>

          <div className="fj-clue-main">
            <p className="clue-label">CLUE</p>
            <p className="clue-text">{session.clue}</p>
          </div>

          {/* Player Response Checkmarks (no response content shown!) */}
          <div className="fj-status-strip">
            <p className="fj-status-summary">
              Responses submitted: {responsesLockedCount} / {players.length}
            </p>
            <div className="fj-status-pills">
              {players.map((p) => {
                const entry = session.entries[p.id];
                const locked = entry?.responseLocked === true;
                const isConnected = Boolean(p.buzzerPeerId);
                return (
                  <div
                    key={p.id}
                    className={`fj-status-pill ${locked ? 'is-ready' : 'is-waiting'}`}
                  >
                    <span className="fj-pill-icon">
                      {isConnected ? '📱' : p.isManual ? '🎤' : '⏳'}
                    </span>
                    <span>{p.name}</span>
                    <span
                      className="fj-pill-check"
                      aria-label={locked ? 'Submitted' : 'Waiting'}
                    >
                      {locked ? '✓' : '…'}
                    </span>
                    {!isConnected && (
                      <button
                        type="button"
                        className="fj-pill-edit-btn"
                        title={`Enter or edit response for ${p.name}`}
                        onClick={() => {
                          setEditingResponseId(p.id);
                          setResponseDraft(entry?.response ?? '');
                        }}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {editingResponseId && (
              <div className="fj-manual-response-box">
                <span className="fj-manual-response-label">
                  Manual response for{' '}
                  <strong>
                    {players.find((p) => p.id === editingResponseId)?.name}
                  </strong>
                  :
                </span>
                <div className="fj-manual-response-row">
                  <input
                    type="text"
                    maxLength={MAX_FJ_RESPONSE_LENGTH}
                    value={responseDraft}
                    placeholder="What is ...?"
                    autoFocus
                    onChange={(e) => setResponseDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveHostResponse(editingResponseId);
                    }}
                  />
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => handleSaveHostResponse(editingResponseId)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      setEditingResponseId(null);
                      setResponseDraft('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <ThinkMusicSetting compact />
        </div>

        <div className="clue-actions">
          <button type="button" className="btn primary large" onClick={handleBeginReveal}>
            Begin Reveal →
          </button>
        </div>
      </div>
    );
  }

  // ==================== STEP 4: TV-STYLE REVEAL ====================
  if (step === 'reveal') {
    const activePlayerId = session.revealOrder[session.revealIndex];
    const activePlayer = players.find((p) => p.id === activePlayerId);
    const activeEntry = activePlayerId ? session.entries[activePlayerId] : undefined;
    const allDone = areAllPlayersRevealed(session);
    const nextIdx = nextUnrevealedIndex(session);
    const nextPlayer =
      nextIdx !== null
        ? players.find((p) => p.id === session.revealOrder[nextIdx])
        : null;

    const wagerAmount = activeEntry?.wager ?? 0;
    const startingScore = activeEntry?.startingScore ?? activePlayer?.score ?? 0;
    const finalScoreForActive =
      activeEntry?.wagerRevealed && activeEntry.verdict
        ? startingScore + (activeEntry.verdict === 'correct' ? wagerAmount : -wagerAmount)
        : startingScore;

    return (
      <div className="clue-overlay fj-overlay fj-reveal-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="clue-meta">
          <span>{session.category}</span>
          <span className="clue-meta-right">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const next = setCorrectResponseShown(session, !session.correctResponseShown);
                sessionRef.current = next;
                setSession(next);
              }}
            >
              {session.correctResponseShown
                ? 'Hide Correct Response'
                : 'Reveal Correct Response'}
            </button>
            <span className="dd-inline-badge">FINAL JEOPARDY · REVEAL</span>
          </span>
        </div>

        <div className="fj-reveal-header-clues">
          <p className="fj-reveal-clue-reminder">{session.clue}</p>
          {session.correctResponseShown && (
            <div className="fj-correct-response-banner">
              <span className="fj-correct-response-label">CORRECT RESPONSE</span>
              <span className="fj-correct-response-text">{session.correctResponse}</span>
            </div>
          )}
        </div>

        {/* Reveal order progress bar (lowest score first) */}
        <div className="fj-reveal-queue" aria-label="Reveal order">
          {session.revealOrder.map((pid, idx) => {
            const p = players.find((pl) => pl.id === pid);
            const e = session.entries[pid];
            if (!p || !e) return null;
            const isCurrent = idx === session.revealIndex;
            const revealedDelta =
              e.wagerRevealed && e.verdict
                ? e.verdict === 'correct'
                  ? `+$${(e.wager ?? 0).toLocaleString('en-US')}`
                  : `−$${(e.wager ?? 0).toLocaleString('en-US')}`
                : null;
            return (
              <button
                key={pid}
                type="button"
                className={`fj-queue-pill${isCurrent ? ' active' : ''}${
                  e.wagerRevealed ? ` done ${e.verdict ?? ''}` : ''
                }`}
                onClick={() => {
                  setJustRevealedId(null);
                  setEditingResponseId(null);
                  setOverridingWagerId(null);
                  const next = setRevealIndex(session, idx);
                  sessionRef.current = next;
                  setSession(next);
                }}
              >
                <span className="fj-queue-rank">{idx + 1}.</span>
                <span className="fj-queue-name">{p.name}</span>
                {revealedDelta ? (
                  <span className={`fj-queue-delta ${e.verdict ?? ''}`}>
                    {revealedDelta}
                  </span>
                ) : (
                  <span className="fj-queue-score">{formatScore(e.startingScore)}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main TV-style podium stage for the focused player */}
        {activePlayer && activeEntry && (
          <div className="fj-podium-stage">
            <div className="fj-podium-header">
              <h2 className="fj-podium-name">{activePlayer.name}</h2>
              <div
                className={`fj-podium-score${
                  activeEntry.wagerRevealed && justRevealedId === activePlayer.id
                    ? ' score-animating'
                    : ''
                }`}
              >
                <AnimatedScore
                  key={`${activePlayer.id}-${activeEntry.wagerRevealed ? 'rev' : 'pre'}`}
                  fromScore={startingScore}
                  toScore={finalScoreForActive}
                  animate={activeEntry.wagerRevealed && justRevealedId === activePlayer.id}
                />
              </div>
            </div>

            {/* Big Written Response Screen */}
            <div
              className={`fj-response-screen${
                activeEntry.verdict ? ` verdict-${activeEntry.verdict}` : ''
              }`}
            >
              <div className="fj-response-screen-top">
                <span className="fj-response-screen-label">PLAYER RESPONSE</span>
                {!activeEntry.wagerRevealed && editingResponseId !== activePlayer.id && (
                  <button
                    type="button"
                    className="fj-response-edit-btn"
                    onClick={() => {
                      setEditingResponseId(activePlayer.id);
                      setResponseDraft(activeEntry.response);
                    }}
                  >
                    {activeEntry.response ? '✎ Edit' : '+ Type response'}
                  </button>
                )}
              </div>

              {editingResponseId === activePlayer.id ? (
                <div className="fj-response-inline-edit">
                  <input
                    type="text"
                    maxLength={MAX_FJ_RESPONSE_LENGTH}
                    value={responseDraft}
                    placeholder="Enter player's response..."
                    autoFocus
                    onChange={(e) => setResponseDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveHostResponse(activePlayer.id);
                    }}
                  />
                  <div className="fj-response-inline-actions">
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => handleSaveHostResponse(activePlayer.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setEditingResponseId(null);
                        setResponseDraft('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : activeEntry.response ? (
                <p className="fj-response-big-text">{activeEntry.response}</p>
              ) : (
                <p className="fj-response-empty">(No written response — verbal)</p>
              )}

              {activeEntry.verdict && (
                <div className={`fj-verdict-stamp ${activeEntry.verdict}`}>
                  {activeEntry.verdict === 'correct' ? '✓ CORRECT' : '✗ INCORRECT'}
                </div>
              )}
            </div>

            {/* Wager Box + Step Actions */}
            <div className="fj-podium-lower">
              {!activeEntry.verdict && (
                <>
                  <div className="fj-wager-card hidden">
                    <span className="fj-wager-card-label">WAGER</span>
                    <span className="fj-wager-card-value">HIDDEN</span>
                  </div>
                  <div className="fj-judge-actions">
                    <button
                      type="button"
                      className="btn success large"
                      onClick={() => handleJudge(activePlayer.id, 'correct')}
                    >
                      ✓ Correct
                    </button>
                    <button
                      type="button"
                      className="btn danger large"
                      onClick={() => handleJudge(activePlayer.id, 'incorrect')}
                    >
                      ✗ Incorrect
                    </button>
                  </div>
                </>
              )}

              {activeEntry.verdict && !activeEntry.wagerRevealed && (
                <>
                  {overridingWagerId === activePlayer.id ? (
                    <div className="fj-wager-card editing">
                      <span className="fj-wager-card-label">
                        OVERRIDE WAGER (max {formatScore(maxFinalJeopardyWager(startingScore))})
                      </span>
                      <div className="fj-override-editor">
                        <input
                          type="number"
                          min={0}
                          max={maxFinalJeopardyWager(startingScore)}
                          step={1}
                          value={
                            maxFinalJeopardyWager(startingScore) === 0
                              ? '0'
                              : overrideWagerInput
                          }
                          disabled={maxFinalJeopardyWager(startingScore) === 0}
                          onChange={(e) => setOverrideWagerInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveWagerOverride(activePlayer.id);
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn small primary"
                          onClick={() => handleSaveWagerOverride(activePlayer.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => setOverridingWagerId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="fj-wager-card ready">
                      <span className="fj-wager-card-label">WAGER</span>
                      <span className="fj-wager-card-value">$ ???</span>
                    </div>
                  )}

                  <div className="fj-judge-actions">
                    <button
                      type="button"
                      className="btn primary large"
                      onClick={() => handleRevealWager(activePlayer.id)}
                    >
                      Reveal Wager
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => handleClearVerdict(activePlayer.id)}
                    >
                      Change ruling
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setOverridingWagerId(activePlayer.id);
                        setOverrideWagerInput(String(activeEntry.wager ?? 0));
                      }}
                    >
                      Override wager
                    </button>
                  </div>
                </>
              )}

              {activeEntry.wagerRevealed && activeEntry.verdict && (
                <>
                  <div className={`fj-wager-card revealed ${activeEntry.verdict}`}>
                    <span className="fj-wager-card-label">WAGER REVEALED</span>
                    <span className="fj-wager-card-value">
                      {activeEntry.verdict === 'correct'
                        ? `+${formatScore(wagerAmount)}`
                        : `−${formatScore(wagerAmount)}`}
                    </span>
                  </div>

                  <div className="fj-judge-actions">
                    <button
                      type="button"
                      className="btn primary large"
                      onClick={handleGoToNextPlayer}
                    >
                      {allDone
                        ? 'Show Final Scores 🏆'
                        : `Next Player: ${nextPlayer?.name ?? ''} →`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==================== STEP 5: DONE (FINAL SCORES) ====================
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
      <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="dd-panel fj-panel">
        <p className="dd-badge">FINAL SCORES</p>
        <h2 className="dd-heading">Congratulations!</h2>

        {session.correctResponse && (
          <p className="fj-done-answer">
            Correct response: <strong>{session.correctResponse}</strong>
          </p>
        )}

        <ol className="fj-final-list fj-final-list-wide">
          {ranked.map((p, i) => {
            const entry = session.entries[p.id];
            const wager = entry?.wager ?? 0;
            const verdict = entry?.verdict;
            return (
              <li key={p.id} className={i === 0 ? 'winner' : ''}>
                <div className="fj-final-player-info">
                  <span className="fj-final-name">
                    {i === 0 ? '🏆 ' : `${i + 1}. `}
                    {p.name}
                  </span>
                  {entry?.response && (
                    <span className="fj-final-response">“{entry.response}”</span>
                  )}
                </div>
                <div className="fj-final-score-col">
                  <span className={p.score < 0 ? 'negative' : ''}>
                    {formatScore(p.score)}
                  </span>
                  {verdict && (
                    <span className={`fj-final-delta ${verdict}`}>
                      {verdict === 'correct'
                        ? `+${formatScore(wager)}`
                        : `−${formatScore(wager)}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="dd-wager-actions">
          <button type="button" className="btn" onClick={onClose}>
            Back to board
          </button>
          <button type="button" className="btn primary" onClick={onDoneToSetup}>
            Return to Setup
          </button>
        </div>
      </div>
    </div>
  );
}
