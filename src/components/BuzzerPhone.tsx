import { useState, useEffect } from 'react';
import { useBuzzerPhone } from '../buzzer/useBuzzerPhone';
import type { FinalJeopardyPhoneState } from '../buzzer/types';
import { formatScore, MAX_FJ_RESPONSE_LENGTH } from '../buzzer/final-jeopardy';
import './BuzzerPhone.css';

const SAVED_NAME_KEY = 'jeopardy-buzzer-player-name';

interface BuzzerPhoneProps {
  roomCode: string;
}

interface FinalJeopardyPhoneScreenProps {
  fj: FinalJeopardyPhoneState;
  fjError: string | null;
  playerName: string;
  onSubmitWager: (wager: number) => void;
  onSubmitResponse: (response: string) => void;
  onLeave: () => void;
}

function FinalJeopardyPhoneScreen({
  fj,
  fjError,
  playerName,
  onSubmitWager,
  onSubmitResponse,
  onLeave,
}: FinalJeopardyPhoneScreenProps) {
  const [wagerInput, setWagerInput] = useState<string>(() =>
    fj.maxWager === 0 ? '0' : '',
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [responseInput, setResponseInput] = useState<string>('');
  const [hideWager, setHideWager] = useState(false);
  const [hideResponse, setHideResponse] = useState(false);

  // Keep wager input synced to '0' if maxWager is 0
  useEffect(() => {
    if (fj.maxWager === 0) {
      setWagerInput('0');
    }
  }, [fj.maxWager]);

  // Clear local error when phase or lock status changes
  useEffect(() => {
    setLocalError(null);
  }, [fj.phase, fj.wagerLocked, fj.responseLocked]);

  const displayedError = localError ?? fjError;

  const handleLockWager = () => {
    const raw = fj.maxWager === 0 ? 0 : parseInt(wagerInput.trim() || '0', 10);
    if (
      !Number.isFinite(raw) ||
      !Number.isInteger(raw) ||
      raw < 0 ||
      raw > fj.maxWager
    ) {
      setLocalError(
        `Enter a whole dollar amount between $0 and $${fj.maxWager.toLocaleString('en-US')}.`,
      );
      return;
    }
    setLocalError(null);
    onSubmitWager(raw);
  };

  const handleLockResponse = () => {
    const trimmed = responseInput.trim();
    if (!trimmed) {
      setLocalError('Please enter your response before submitting.');
      return;
    }
    setLocalError(null);
    onSubmitResponse(trimmed);
  };

  const scoreClass = fj.score < 0 ? 'negative' : '';

  return (
    <div className="buzzer-phone fj-phone">
      <header className="buzzer-header">
        <div className="fj-phone-identity">
          <span className="buzzer-player-name">{fj.playerName || playerName}</span>
          <span className={`fj-phone-score-pill ${scoreClass}`}>
            {formatScore(fj.score)}
          </span>
        </div>
        <button type="button" className="btn small" onClick={onLeave}>
          Leave
        </button>
      </header>

      <div className="fj-phone-body">
        <div className="fj-phone-banner">
          <span className="fj-phone-badge">FINAL JEOPARDY</span>
          <h2 className="fj-phone-category">{fj.category}</h2>
        </div>

        {fj.phase === 'wager' && !fj.wagerLocked && (
          <div className="fj-phone-card">
            <div className="fj-phone-score-summary">
              <span className="fj-phone-label">YOUR CURRENT SCORE</span>
              <span className={`fj-phone-big-score ${scoreClass}`}>
                {formatScore(fj.score)}
              </span>
              <span className="fj-phone-sub">
                {fj.maxWager > 0
                  ? `Wager $0 up to ${formatScore(fj.maxWager)}`
                  : 'Score is $0 or below — maximum wager is $0'}
              </span>
            </div>

            <label className="fj-phone-input-label">
              Your Wager ($)
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={fj.maxWager}
                step={1}
                value={fj.maxWager === 0 ? '0' : wagerInput}
                disabled={fj.maxWager === 0}
                placeholder="0"
                className="fj-phone-wager-input"
                onChange={(e) => {
                  setWagerInput(e.target.value);
                  setLocalError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLockWager();
                }}
              />
            </label>

            {fj.maxWager > 0 && (
              <div className="fj-phone-quick-wagers">
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setWagerInput('0');
                    setLocalError(null);
                  }}
                >
                  $0
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setWagerInput(String(Math.floor(fj.maxWager / 2)));
                    setLocalError(null);
                  }}
                >
                  Half ({formatScore(Math.floor(fj.maxWager / 2))})
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setWagerInput(String(fj.maxWager));
                    setLocalError(null);
                  }}
                >
                  All In ({formatScore(fj.maxWager)})
                </button>
              </div>
            )}

            {displayedError && <div className="buzzer-error">{displayedError}</div>}

            <button
              type="button"
              className="btn primary large fj-phone-submit-btn"
              onClick={handleLockWager}
            >
              {fj.maxWager === 0 ? 'Lock $0 Wager' : 'Lock Wager'}
            </button>
            <p className="fj-phone-privacy-note">
              Your wager stays hidden from other players.
            </p>
          </div>
        )}

        {fj.phase === 'wager' && fj.wagerLocked && (
          <div className="fj-phone-card fj-phone-locked-card">
            <div className="fj-phone-check-circle">✓</div>
            <h3 className="fj-phone-locked-title">Wager Locked!</h3>
            <div className="fj-phone-secret-box">
              <span className="fj-phone-secret-value">
                {hideWager ? '••••' : formatScore(fj.wager ?? 0)}
              </span>
              <button
                type="button"
                className="btn small fj-phone-toggle-btn"
                onClick={() => setHideWager((v) => !v)}
              >
                {hideWager ? 'Show' : 'Hide'}
              </button>
            </div>
            <p className="fj-phone-waiting-text">
              Waiting for the host to reveal the clue…
            </p>
          </div>
        )}

        {fj.phase === 'clue' && !fj.responseLocked && (
          <div className="fj-phone-card">
            {fj.clue && (
              <div className="fj-phone-clue-box">
                <span className="fj-phone-label">CLUE</span>
                <p className="fj-phone-clue-text">{fj.clue}</p>
              </div>
            )}

            <div className="fj-phone-locked-wager-chip">
              <span>Wager locked</span>
              <button
                type="button"
                className="fj-phone-inline-toggle"
                onClick={() => setHideWager((v) => !v)}
              >
                {hideWager ? 'Show' : formatScore(fj.wager ?? 0)}
              </button>
            </div>

            <label className="fj-phone-input-label">
              Your Response
              <textarea
                rows={3}
                maxLength={MAX_FJ_RESPONSE_LENGTH}
                value={responseInput}
                placeholder="What is ...?"
                className="fj-phone-response-input"
                autoFocus
                onChange={(e) => {
                  setResponseInput(e.target.value);
                  setLocalError(null);
                }}
              />
            </label>

            {displayedError && <div className="buzzer-error">{displayedError}</div>}

            <button
              type="button"
              className="btn primary large fj-phone-submit-btn"
              onClick={handleLockResponse}
              disabled={!responseInput.trim()}
            >
              Submit &amp; Lock Response
            </button>
            <p className="fj-phone-privacy-note">
              Your response stays hidden until the host reveals it.
            </p>
          </div>
        )}

        {fj.phase === 'clue' && fj.responseLocked && (
          <div className="fj-phone-card fj-phone-locked-card">
            <div className="fj-phone-check-circle">✓</div>
            <h3 className="fj-phone-locked-title">Response Locked!</h3>
            <div className="fj-phone-secret-box">
              <span className="fj-phone-secret-response">
                {hideResponse ? '••••••••' : fj.response || '(No response)'}
              </span>
              <button
                type="button"
                className="btn small fj-phone-toggle-btn"
                onClick={() => setHideResponse((v) => !v)}
              >
                {hideResponse ? 'Show' : 'Hide'}
              </button>
            </div>
            <p className="fj-phone-waiting-text">
              Waiting for the other players and the host reveal…
            </p>
          </div>
        )}

        {(fj.phase === 'reveal' || fj.phase === 'done') && (
          <div className="fj-phone-card fj-phone-locked-card">
            {fj.revealResult ? (
              <>
                <div
                  className={`fj-phone-result-badge ${fj.revealResult}`}
                >
                  {fj.revealResult === 'correct' ? '✓ CORRECT!' : '✗ INCORRECT'}
                </div>
                <p className="fj-phone-result-delta">
                  {fj.revealResult === 'correct'
                    ? `+${formatScore(fj.wager ?? 0)}`
                    : `−${formatScore(fj.wager ?? 0)}`}
                </p>
                <div className="fj-phone-score-summary">
                  <span className="fj-phone-label">FINAL SCORE</span>
                  <span
                    className={`fj-phone-big-score ${
                      (fj.newScore ?? fj.score) < 0 ? 'negative' : ''
                    }`}
                  >
                    {formatScore(fj.newScore ?? fj.score)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="fj-phone-tv-icon">📺</div>
                <h3 className="fj-phone-locked-title">
                  {fj.phase === 'done' ? 'Final Jeopardy Complete!' : 'Reveal in Progress'}
                </h3>
                <p className="fj-phone-waiting-text">
                  {fj.phase === 'done'
                    ? `Final score: ${formatScore(fj.score)}`
                    : 'Watch the host screen for the reveal!'}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function BuzzerPhone({ roomCode }: BuzzerPhoneProps) {
  const {
    status,
    buzzStatus,
    players,
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
  } = useBuzzerPhone();

  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(SAVED_NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [hasJoined, setHasJoined] = useState(false);

  useEffect(() => {
    if (status === 'disconnected' && error) {
      setHasJoined(false);
    }
  }, [status, error]);

  const handleJoin = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem(SAVED_NAME_KEY, trimmed);
    } catch {
      /* ignore storage errors */
    }
    connect(roomCode, trimmed);
    setHasJoined(true);
  };

  const handleDisconnect = () => {
    disconnect();
    setHasJoined(false);
  };

  // Not joined yet - show name entry
  if (!hasJoined || status === 'disconnected') {
    return (
      <div className="buzzer-phone">
        <div className="buzzer-phone-join">
          <h1 className="buzzer-logo">JEOPARDY!</h1>
          <p className="buzzer-subtitle">Buzzer</p>

          {error && <div className="buzzer-error">{error}</div>}

          <div className="buzzer-room-code">
            Room: <span>{roomCode}</span>
          </div>

          <div className="buzzer-join-form">
            <label className="buzzer-field">
              Your Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                maxLength={20}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
            </label>

            <p className="buzzer-hint">
              Your name will be linked to your score automatically
            </p>

            <button
              type="button"
              className="btn primary large buzzer-join-btn"
              onClick={handleJoin}
              disabled={!name.trim()}
            >
              Join Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Connecting/syncing
  if (status === 'connecting' || status === 'syncing') {
    return (
      <div className="buzzer-phone">
        <div className="buzzer-phone-status">
          <h1 className="buzzer-logo small">JEOPARDY!</h1>
          <div className="buzzer-connecting">
            <div className="buzzer-spinner" />
            <p>{status === 'connecting' ? 'Connecting...' : 'Syncing clocks...'}</p>
            {status === 'syncing' && (
              <div className="buzzer-sync-bar">
                <div
                  className="buzzer-sync-fill"
                  style={{ width: `${syncProgress * 100}%` }}
                />
              </div>
            )}
          </div>
          <button type="button" className="btn small" onClick={handleDisconnect}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Joined and Final Jeopardy is active -> render Final Jeopardy phone screen
  if (finalJeopardy) {
    return (
      <FinalJeopardyPhoneScreen
        fj={finalJeopardy}
        fjError={fjError}
        playerName={name}
        onSubmitWager={submitFinalWager}
        onSubmitResponse={submitFinalResponse}
        onLeave={handleDisconnect}
      />
    );
  }

  // Joined - main buzzer UI
  const statusText = {
    waiting: 'Wait for the host to open a clue',
    armed: 'BUZZ NOW!',
    buzzed: 'Waiting for results...',
    winner: `YOU'RE FIRST! (#${myRank})`,
    'runner-up': `#${myRank} — Too slow!`,
    'locked-out': 'Locked out',
  }[buzzStatus];

  const statusClass = {
    waiting: 'status-waiting',
    armed: 'status-armed',
    buzzed: 'status-buzzed',
    winner: 'status-winner',
    'runner-up': 'status-runner-up',
    'locked-out': 'status-locked',
  }[buzzStatus];

  const canBuzz = buzzStatus === 'armed';

  return (
    <div className={`buzzer-phone ${statusClass}`}>
      <header className="buzzer-header">
        <span className="buzzer-player-name">{name}</span>
        <button type="button" className="btn small" onClick={handleDisconnect}>
          Leave
        </button>
      </header>

      <div className="buzzer-status-text">{statusText}</div>

      <button
        type="button"
        className={`buzzer-button ${canBuzz ? 'active' : 'inactive'}`}
        onClick={buzz}
        disabled={!canBuzz}
        aria-label="Buzz"
      >
        <span className="buzzer-button-icon">🔔</span>
      </button>

      <div className="buzzer-players-list">
        <p className="buzzer-players-label">Connected ({players.length})</p>
        <div className="buzzer-players">
          {players.map((p) => (
            <span key={p.peerId} className="buzzer-player-chip">
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
