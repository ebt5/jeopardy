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
import './FinalJeopardy.css';

type HostStep = 'wagers' | 'clue' | 'reveal' | 'done';

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
  const [step, setStep] = useState<HostStep>('wagers');
  const [session, setSession] = useState<FinalJeopardySession>(() =>
    createFinalJeopardySession(finalJeopardy, players),
  );

  // Collapsible bottom host drawer (kept closed by default so the TV stays clean)
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Masked wager drafts inside the host drawer (never pre-filled with secret phone wagers)
  const [wagerDrafts, setWagerDrafts] = useState<Record<string, string>>({});

  // Masked response drafts inside the host drawer during clue phase
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});

  // Reveal-phase override drafts inside the collapsible drawer
  const [revealResponseDraft, setRevealResponseDraft] = useState('');
  const [revealWagerDraft, setRevealWagerDraft] = useState('');

  // Track which player just had their wager revealed so we animate their score once
  const [justRevealedId, setJustRevealedId] = useState<string | null>(null);

  // 60-second think timer & music (default synthesized or host's local IndexedDB file from Setup)
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
  // useBuzzerHost() returns a new object every render — keep a ref so unmount
  // cleanup does NOT re-run (and kill think music) on every parent re-render.
  const buzzerHostRef = useRef(buzzerHost);
  buzzerHostRef.current = buzzerHost;
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

      // Always (re)start synth from the requested offset after an explicit stop/pause.
      if (musicPlayingRef.current !== 'synth') {
        musicPlayingRef.current = 'synth';
        synthStopRef.current = startFinalJeopardyThinkMusic(elapsedSeconds);
        setAudioBlocked(false);
      }
    },
    [],
  );

  // Load any saved custom music file from IndexedDB (configured in Setup)
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

  // Clear Final Jeopardy screen on phones and stop music ONLY when leaving Final Jeopardy.
  // Must NOT depend on `buzzerHost` identity — useBuzzerHost() returns a new object each
  // render, and depending on it previously stopped think music a few seconds in whenever
  // PeerJS sync / player state caused App to re-render.
  useEffect(() => {
    return () => {
      stopAllThinkMusic(true);
      lastSentStateRef.current.clear();
      const host = buzzerHostRef.current;
      if (host?.roomCode) {
        host.broadcastMessage({ type: 'fj-state', state: null });
      }
    };
  }, [stopAllThinkMusic]);

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

  // Ensure music stops if timer pauses, music is muted, or host leaves clue step.
  // Do NOT depend on `secondsLeft` — that re-runs every tick and previously made it
  // easy to accidentally tear music down. Time-up stop is handled in the interval.
  useEffect(() => {
    if (!timerRunning || !musicEnabled || step !== 'clue') {
      stopAllThinkMusic(false);
    }
  }, [timerRunning, musicEnabled, step, stopAllThinkMusic]);

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
        if (drawerOpen) {
          setDrawerOpen(false);
          return;
        }
        if (step === 'done') onClose();
        else if (window.confirm('Exit Final Jeopardy and return to the board?')) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, drawerOpen, onClose]);

  const hasConnectedPhones = players.some((p) => Boolean(p.buzzerPeerId));
  const hasManualOrUnconnected = players.some((p) => !p.buzzerPeerId);
  const manyPlayers = players.length >= 8;

  const parseWagerDraft = (raw: string, max: number): number | null => {
    if (max === 0) return 0;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
    return n;
  };

  const handleLockSingleHostWager = (playerId: string) => {
    const player = players.find((p) => p.id === playerId);
    const entry = session.entries[playerId];
    if (!player || !entry) return;
    const max = maxFinalJeopardyWager(entry.startingScore);
    const draft = wagerDrafts[playerId] ?? '';
    const parsed = parseWagerDraft(draft, max);
    if (parsed === null) {
      window.alert(`${player.name}: enter a whole dollar amount from $0 up to $${max}.`);
      return;
    }
    const res = setHostWager(session, playerId, parsed);
    if (res.error) {
      window.alert(`${player.name}: ${res.error}`);
      return;
    }
    sessionRef.current = res.session;
    setSession(res.session);
    // Clear draft immediately so the wager amount never lingers in any input DOM value
    setWagerDrafts((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
  };

  const handleConfirmAllWagers = () => {
    // Unlock audio right away inside the host's click gesture
    unlockAudio();

    const hostOverrides: Record<string, number> = {};
    const unlockedConnectedNames: string[] = [];

    for (const p of players) {
      const entry = session.entries[p.id];
      const max = maxFinalJeopardyWager(entry?.startingScore ?? p.score);
      const draft = wagerDrafts[p.id];

      if (draft !== undefined && draft.trim() !== '') {
        const parsed = parseWagerDraft(draft, max);
        if (parsed === null) {
          window.alert(`${p.name}: enter a whole dollar amount from $0 up to $${max}.`);
          return;
        }
        hostOverrides[p.id] = parsed;
        continue;
      }

      if (entry?.wagerLocked) continue;

      if (p.buzzerPeerId) {
        if (max > 0) {
          unlockedConnectedNames.push(p.name);
        } else {
          hostOverrides[p.id] = 0;
        }
      } else {
        hostOverrides[p.id] = 0;
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
    setWagerDrafts({});
    setDrawerOpen(false);
    setSecondsLeft(DEFAULT_FJ_TIMER_SECONDS);
    setTimerRunning(true);
    setStep('clue');

    // Automatically start think music directly from this click gesture so autoplay never blocks it
    if (musicEnabled) {
      startThinkMusicNow(0, true);
    }
  };

  const handleSaveClueHostResponse = (playerId: string) => {
    const draft = responseDrafts[playerId] ?? '';
    const next = setHostResponse(session, playerId, draft);
    sessionRef.current = next;
    setSession(next);
    // Clear draft immediately so the response text never lingers in the DOM
    setResponseDrafts((prev) => {
      const copy = { ...prev };
      delete copy[playerId];
      return copy;
    });
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
    setResponseDrafts({});
    setDrawerOpen(false);
    setRevealResponseDraft('');
    setRevealWagerDraft('');
    const next = advanceToReveal(session, players);
    sessionRef.current = next;
    setSession(next);
    setJustRevealedId(null);
    setStep('reveal');
  };

  const handleSaveRevealOverrides = (playerId: string) => {
    const player = players.find((p) => p.id === playerId);
    const entry = session.entries[playerId];
    if (!player || !entry) return;

    let nextSession = session;

    if (revealResponseDraft.trim() !== '') {
      nextSession = setHostResponse(nextSession, playerId, revealResponseDraft);
    }

    if (revealWagerDraft.trim() !== '' && !entry.wagerRevealed) {
      const max = maxFinalJeopardyWager(entry.startingScore);
      const parsed = parseWagerDraft(revealWagerDraft, max);
      if (parsed === null) {
        window.alert(`${player.name}: enter a whole dollar amount from $0 up to $${max}.`);
        return;
      }
      const res = setHostWager(nextSession, playerId, parsed);
      if (res.error) {
        window.alert(`${player.name}: ${res.error}`);
        return;
      }
      nextSession = res.session;
    }

    sessionRef.current = nextSession;
    setSession(nextSession);
    setRevealResponseDraft('');
    setRevealWagerDraft('');
    setDrawerOpen(false);
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
    setDrawerOpen(false);
    setRevealWagerDraft('');
    if (scoreDelta !== 0) {
      onAdjustScore(playerId, scoreDelta);
    }
  };

  const handleGoToNextPlayer = () => {
    const nextIdx = nextUnrevealedIndex(session);
    setJustRevealedId(null);
    setDrawerOpen(false);
    setRevealResponseDraft('');
    setRevealWagerDraft('');
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

  // ==================== PHASE 1: CATEGORY & WAGERING ====================
  if (step === 'wagers') {
    return (
      <div className="clue-overlay fj-overlay fj-tv-shell" role="dialog" aria-modal="true">
        <button type="button" className="fj-exit-btn" onClick={onClose} aria-label="Close">
          ×
        </button>

        <main className="fj-tv-stage fj-tv-wagers-stage">
          <p className="fj-tv-kicker">FINAL JEOPARDY!</p>
          <div className="fj-tv-category-frame">
            <h1 className="fj-tv-category-title">{session.category}</h1>
          </div>
          <p className="fj-tv-subtitle">Make your wagers</p>

          {/* Contestant Podium Strip — neutral status ONLY, never shows wager amounts */}
          <div
            className={`fj-podium-strip${manyPlayers ? ' many-players' : ''}`}
            aria-label="Contestants"
          >
            {players.map((p) => {
              const entry = session.entries[p.id];
              const startingScore = entry?.startingScore ?? p.score;
              const isLocked = entry?.wagerLocked === true;
              return (
                <div
                  key={p.id}
                  className={`fj-contestant-card${isLocked ? ' is-locked' : ''}`}
                >
                  <div className="fj-contestant-name">{p.name}</div>
                  <div
                    className={`fj-contestant-score${startingScore < 0 ? ' negative' : ''}`}
                  >
                    {formatScore(startingScore)}
                  </div>
                  <div className={`fj-contestant-status${isLocked ? ' locked' : ''}`}>
                    {isLocked ? '✓ Locked in' : 'Wagering…'}
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* Collapsible Host Drawer (masked password inputs — amounts never shown on screen) */}
        {drawerOpen && (
          <section className="fj-host-drawer" aria-label="Host wager entry">
            <div className="fj-host-drawer-header">
              <span>Host Wager Entry &amp; Overrides (hidden from TV)</span>
              <button
                type="button"
                className="fj-host-btn"
                onClick={() => setDrawerOpen(false)}
              >
                Done
              </button>
            </div>
            <div className="fj-host-drawer-list">
              {players.map((p) => {
                const entry = session.entries[p.id];
                const startingScore = entry?.startingScore ?? p.score;
                const max = maxFinalJeopardyWager(startingScore);
                const isLocked = entry?.wagerLocked === true;
                const draft = wagerDrafts[p.id] ?? '';
                return (
                  <div key={p.id} className="fj-host-drawer-row">
                    <span className="fj-host-drawer-name">
                      {p.name}
                      {isLocked && <span className="fj-host-drawer-check"> ✓</span>}
                    </span>
                    <div className="fj-host-drawer-inputs">
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        className="fj-masked-input"
                        aria-label={`${p.name} wager`}
                        placeholder={max === 0 ? '$0 max' : isLocked ? 'Override ($)' : 'Wager ($)'}
                        disabled={max === 0}
                        value={max === 0 ? '' : draft}
                        onChange={(e) =>
                          setWagerDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleLockSingleHostWager(p.id);
                        }}
                      />
                      <button
                        type="button"
                        className="fj-host-btn"
                        disabled={max > 0 && draft.trim() === ''}
                        onClick={() => handleLockSingleHostWager(p.id)}
                      >
                        Lock
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Subtle Host Controls tucked along the bottom edge */}
        <footer className="fj-host-bar">
          <div className="fj-host-bar-group">
            <button
              type="button"
              className={`fj-host-btn${drawerOpen ? ' active' : ''}`}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              {hasManualOrUnconnected ? 'Enter / Override Wagers' : 'Override Wagers'}
            </button>
          </div>
          <div className="fj-host-bar-group">
            <button
              type="button"
              className="fj-host-btn fj-host-btn-primary"
              onClick={handleConfirmAllWagers}
            >
              Lock Wagers &amp; Reveal Clue →
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // ==================== PHASE 2: CLUE & 60s COUNTDOWN ====================
  if (step === 'clue') {
    const progressPct = Math.max(
      0,
      Math.min(100, (secondsLeft / DEFAULT_FJ_TIMER_SECONDS) * 100),
    );
    const isUrgent = timerRunning && secondsLeft <= 10 && secondsLeft > 0;
    const isTimeUp = secondsLeft === 0;
    const submissionsClosed = isSubmissionsClosed(session);

    return (
      <div className="clue-overlay fj-overlay fj-tv-shell" role="dialog" aria-modal="true">
        <button type="button" className="fj-exit-btn" onClick={onClose} aria-label="Close">
          ×
        </button>

        <header className="fj-tv-topbar">
          <span className="fj-tv-topbar-category">{session.category}</span>
        </header>

        <main className="fj-tv-stage fj-tv-clue-stage">
          {/* Iconic Jeopardy Clue Centerpiece */}
          <div className="fj-tv-clue-card">
            <p className="fj-tv-clue-text">{session.clue}</p>
          </div>

          {/* Big Broadcast Countdown Timer */}
          <div
            className={`fj-tv-timer${isUrgent ? ' urgent' : ''}${isTimeUp ? ' time-up' : ''}${
              !timerRunning && !isTimeUp ? ' paused' : ''
            }`}
          >
            <div className="fj-timer-clock" aria-live="polite">
              {isTimeUp ? "TIME'S UP!" : formatTimer(secondsLeft)}
            </div>
            <div className="fj-timer-track">
              <div className="fj-timer-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* Contestant Podium Strip — neutral checkmarks ONLY, no response content */}
          <div
            className={`fj-podium-strip${manyPlayers ? ' many-players' : ''}`}
            aria-label="Contestant status"
          >
            {players.map((p) => {
              const entry = session.entries[p.id];
              const locked = entry?.responseLocked === true;
              return (
                <div
                  key={p.id}
                  className={`fj-contestant-card compact${locked ? ' is-locked' : ''}`}
                >
                  <div className="fj-contestant-name">{p.name}</div>
                  <div className={`fj-contestant-status${locked ? ' locked' : ''}`}>
                    {locked ? '✓ Locked in' : isTimeUp && submissionsClosed ? 'Time up' : 'Writing…'}
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* Collapsible Host Drawer for entering/overriding responses (masked so nothing shows on TV) */}
        {drawerOpen && (
          <section className="fj-host-drawer" aria-label="Host response entry">
            <div className="fj-host-drawer-header">
              <span>Host Response Entry &amp; Overrides (hidden from TV)</span>
              <button
                type="button"
                className="fj-host-btn"
                onClick={() => setDrawerOpen(false)}
              >
                Done
              </button>
            </div>
            <div className="fj-host-drawer-list">
              {players.map((p) => {
                const entry = session.entries[p.id];
                const locked = entry?.responseLocked === true;
                const draft = responseDrafts[p.id] ?? '';
                return (
                  <div key={p.id} className="fj-host-drawer-row">
                    <span className="fj-host-drawer-name">
                      {p.name}
                      {locked && <span className="fj-host-drawer-check"> ✓</span>}
                    </span>
                    <div className="fj-host-drawer-inputs">
                      <input
                        type="password"
                        autoComplete="off"
                        maxLength={MAX_FJ_RESPONSE_LENGTH}
                        className="fj-masked-input wide"
                        aria-label={`${p.name} response`}
                        placeholder={locked ? 'Override response' : 'Enter response'}
                        value={draft}
                        onChange={(e) =>
                          setResponseDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveClueHostResponse(p.id);
                        }}
                      />
                      <button
                        type="button"
                        className="fj-host-btn"
                        disabled={draft.trim() === ''}
                        onClick={() => handleSaveClueHostResponse(p.id)}
                      >
                        Lock
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Subtle Host Controls tucked along the bottom edge */}
        <footer className="fj-host-bar">
          <div className="fj-host-bar-group">
            {!timerRunning ? (
              <button
                type="button"
                className="fj-host-btn"
                onClick={handleStartOrResumeTimer}
              >
                {secondsLeft === 0
                  ? '▶ Restart 1:00'
                  : secondsLeft === DEFAULT_FJ_TIMER_SECONDS
                    ? '▶ Start'
                    : '▶ Resume'}
              </button>
            ) : (
              <button type="button" className="fj-host-btn" onClick={handlePauseTimer}>
                ⏸ Pause
              </button>
            )}
            <button type="button" className="fj-host-btn" onClick={handleResetTimer}>
              ↺ Reset
            </button>
            <button
              type="button"
              className="fj-host-btn"
              onClick={handleToggleMusic}
              title="Toggle think music"
            >
              {musicEnabled ? '🔊 Music On' : '🔇 Music Off'}
            </button>
            {audioBlocked && musicEnabled && timerRunning && (
              <button
                type="button"
                className="fj-host-btn fj-host-btn-primary"
                onClick={() =>
                  startThinkMusicNow(DEFAULT_FJ_TIMER_SECONDS - secondsLeft, false)
                }
              >
                🔊 Play Music
              </button>
            )}
            {isTimeUp && hasConnectedPhones && (
              <button
                type="button"
                className={`fj-host-btn${submissionsClosed ? ' fj-host-btn-primary' : ' active'}`}
                onClick={handleToggleAllowLate}
              >
                {submissionsClosed ? 'Allow Late Answers' : 'Lock Submissions'}
              </button>
            )}
            <button
              type="button"
              className={`fj-host-btn${drawerOpen ? ' active' : ''}`}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              Overrides
            </button>
          </div>

          <div className="fj-host-bar-group">
            <button
              type="button"
              className="fj-host-btn fj-host-btn-primary"
              onClick={handleBeginReveal}
            >
              Begin Reveal →
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // ==================== PHASE 3: TV-STYLE REVEAL ====================
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
      <div
        className="clue-overlay fj-overlay fj-tv-shell fj-reveal-overlay"
        role="dialog"
        aria-modal="true"
      >
        <button type="button" className="fj-exit-btn" onClick={onClose} aria-label="Close">
          ×
        </button>

        <header className="fj-tv-topbar">
          <span className="fj-tv-topbar-category">{session.category}</span>
        </header>

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
        <div
          className={`fj-reveal-queue${manyPlayers ? ' many-players' : ''}`}
          aria-label="Reveal order"
        >
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
                  setDrawerOpen(false);
                  setRevealResponseDraft('');
                  setRevealWagerDraft('');
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
          <main className="fj-podium-stage">
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
              {activeEntry.response ? (
                <p className="fj-response-big-text">{activeEntry.response}</p>
              ) : (
                <p className="fj-response-empty">(No written response)</p>
              )}

              {activeEntry.verdict && (
                <div className={`fj-verdict-stamp ${activeEntry.verdict}`}>
                  {activeEntry.verdict === 'correct' ? '✓ CORRECT' : '✗ INCORRECT'}
                </div>
              )}
            </div>

            {/* Wager Plaque — amount only enters the DOM once Reveal Wager is clicked */}
            {!activeEntry.wagerRevealed ? (
              <div
                className={`fj-wager-card ${activeEntry.verdict ? 'ready' : 'hidden'}`}
              >
                <span className="fj-wager-card-label">WAGER</span>
                <span className="fj-wager-card-value">
                  {activeEntry.verdict ? '$ ???' : '••••'}
                </span>
              </div>
            ) : (
              activeEntry.verdict && (
                <div className={`fj-wager-card revealed ${activeEntry.verdict}`}>
                  <span className="fj-wager-card-label">WAGER</span>
                  <span className="fj-wager-card-value">
                    {activeEntry.verdict === 'correct'
                      ? `+${formatScore(wagerAmount)}`
                      : `−${formatScore(wagerAmount)}`}
                  </span>
                </div>
              )
            )}
          </main>
        )}

        {/* Collapsible Host Override Drawer during Reveal (wager input is masked) */}
        {drawerOpen && activePlayer && activeEntry && !activeEntry.wagerRevealed && (
          <section className="fj-host-drawer" aria-label="Host reveal override">
            <div className="fj-host-drawer-header">
              <span>Host Override — {activePlayer.name}</span>
              <button
                type="button"
                className="fj-host-btn"
                onClick={() => {
                  setDrawerOpen(false);
                  setRevealResponseDraft('');
                  setRevealWagerDraft('');
                }}
              >
                Cancel
              </button>
            </div>
            <div className="fj-host-drawer-row">
              <span className="fj-host-drawer-name">Response</span>
              <div className="fj-host-drawer-inputs">
                <input
                  type="text"
                  maxLength={MAX_FJ_RESPONSE_LENGTH}
                  className="fj-masked-input wide"
                  aria-label="Edit player response"
                  placeholder="Enter player's response…"
                  value={revealResponseDraft}
                  onChange={(e) => setRevealResponseDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRevealOverrides(activePlayer.id);
                  }}
                />
              </div>
            </div>
            <div className="fj-host-drawer-row">
              <span className="fj-host-drawer-name">Wager (hidden)</span>
              <div className="fj-host-drawer-inputs">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  className="fj-masked-input"
                  aria-label="Override player wager"
                  placeholder={
                    maxFinalJeopardyWager(startingScore) === 0 ? '$0 max' : 'Override ($)'
                  }
                  disabled={maxFinalJeopardyWager(startingScore) === 0}
                  value={revealWagerDraft}
                  onChange={(e) => setRevealWagerDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRevealOverrides(activePlayer.id);
                  }}
                />
                <button
                  type="button"
                  className="fj-host-btn fj-host-btn-primary"
                  onClick={() => handleSaveRevealOverrides(activePlayer.id)}
                >
                  Save
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Subtle Host Controls tucked along the bottom edge */}
        {activePlayer && activeEntry && (
          <footer className="fj-host-bar">
            <div className="fj-host-bar-group">
              <button
                type="button"
                className="fj-host-btn"
                onClick={() => {
                  const next = setCorrectResponseShown(
                    session,
                    !session.correctResponseShown,
                  );
                  sessionRef.current = next;
                  setSession(next);
                }}
              >
                {session.correctResponseShown
                  ? 'Hide Correct Response'
                  : 'Reveal Correct Response'}
              </button>
              {!activeEntry.wagerRevealed && (
                <button
                  type="button"
                  className={`fj-host-btn${drawerOpen ? ' active' : ''}`}
                  onClick={() => {
                    setDrawerOpen((open) => {
                      const nextOpen = !open;
                      if (nextOpen) {
                        setRevealResponseDraft(activeEntry.response);
                        setRevealWagerDraft('');
                      }
                      return nextOpen;
                    });
                  }}
                >
                  {activeEntry.response ? 'Edit / Override' : '+ Type Response / Override'}
                </button>
              )}
              {activeEntry.verdict && !activeEntry.wagerRevealed && (
                <button
                  type="button"
                  className="fj-host-btn"
                  onClick={() => handleClearVerdict(activePlayer.id)}
                >
                  Change Ruling
                </button>
              )}
            </div>

            <div className="fj-host-bar-group">
              {!activeEntry.verdict && (
                <>
                  <button
                    type="button"
                    className="fj-host-btn fj-host-btn-success"
                    onClick={() => handleJudge(activePlayer.id, 'correct')}
                  >
                    ✓ Correct
                  </button>
                  <button
                    type="button"
                    className="fj-host-btn fj-host-btn-danger"
                    onClick={() => handleJudge(activePlayer.id, 'incorrect')}
                  >
                    ✗ Incorrect
                  </button>
                </>
              )}

              {activeEntry.verdict && !activeEntry.wagerRevealed && (
                <button
                  type="button"
                  className="fj-host-btn fj-host-btn-primary"
                  onClick={() => handleRevealWager(activePlayer.id)}
                >
                  Reveal Wager
                </button>
              )}

              {activeEntry.wagerRevealed && (
                <button
                  type="button"
                  className="fj-host-btn fj-host-btn-primary"
                  onClick={handleGoToNextPlayer}
                >
                  {allDone
                    ? 'Show Final Scores 🏆'
                    : `Next Player: ${nextPlayer?.name ?? ''} →`}
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    );
  }

  // ==================== PHASE 4: FINAL SCORES ====================
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="clue-overlay fj-overlay fj-tv-shell" role="dialog" aria-modal="true">
      <button type="button" className="fj-exit-btn" onClick={onClose} aria-label="Close">
        ×
      </button>
      <main className="dd-panel fj-panel">
        <p className="fj-tv-kicker">FINAL SCORES</p>
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
      </main>

      <footer className="fj-host-bar">
        <div className="fj-host-bar-group">
          <button type="button" className="fj-host-btn" onClick={onClose}>
            Back to Board
          </button>
        </div>
        <div className="fj-host-bar-group">
          <button
            type="button"
            className="fj-host-btn fj-host-btn-primary"
            onClick={onDoneToSetup}
          >
            Return to Setup
          </button>
        </div>
      </footer>
    </div>
  );
}
