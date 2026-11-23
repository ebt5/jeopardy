import { useEffect, useMemo, useRef } from 'react';
import qrcode from 'qrcode-generator';
import { useBuzzerHost } from '../buzzer/useBuzzerHost';
import type { Player } from '../types';
import './BuzzerHost.css';

interface BuzzerHostProps {
  players: Player[];
  isClueOpen: boolean;
  onBuzzerResult?: (winnerId: string | null, winnerName: string) => void;
}

export function BuzzerHost({ players, isClueOpen, onBuzzerResult }: BuzzerHostProps) {
  const {
    roomCode,
    state,
    players: buzzerPlayers,
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
  } = useBuzzerHost();

  const prevIsClueOpenRef = useRef(isClueOpen);

  // Auto-arm when clue opens
  useEffect(() => {
    if (isClueOpen && !prevIsClueOpenRef.current && roomCode && state === 'waiting') {
      arm();
    }
    // Auto-reset when clue closes
    if (!isClueOpen && prevIsClueOpenRef.current && roomCode) {
      reset();
    }
    prevIsClueOpenRef.current = isClueOpen;
  }, [isClueOpen, roomCode, state, arm, reset]);

  // Notify parent of buzz result
  useEffect(() => {
    if (lastResult && onBuzzerResult) {
      onBuzzerResult(
        lastResult.winner.gamePlayerId ?? null,
        lastResult.winner.name
      );
    }
  }, [lastResult, onBuzzerResult]);

  // Generate QR code
  const qrDataUrl = useMemo(() => {
    if (!roomCode) return null;
    try {
      const baseUrl = window.location.origin + window.location.pathname;
      const buzzUrl = `${baseUrl}#/buzz?room=${roomCode}`;
      const qr = qrcode(0, 'M');
      qr.addData(buzzUrl);
      qr.make();
      return qr.createDataURL(4, 0);
    } catch {
      return null;
    }
  }, [roomCode]);

  const buzzUrl = roomCode
    ? `${window.location.origin}${window.location.pathname}#/buzz?room=${roomCode}`
    : null;

  if (!roomCode) {
    return (
      <div className="buzzer-host-panel">
        <h3 className="buzzer-host-title">📱 Phone Buzzer</h3>
        {error && <div className="buzzer-host-error">{error}</div>}
        <button
          type="button"
          className="btn primary"
          onClick={startRoom}
          disabled={isConnecting}
        >
          {isConnecting ? 'Starting...' : 'Start Buzzer Room'}
        </button>
        <p className="buzzer-host-hint">
          Players can join from their phones to buzz in
        </p>
      </div>
    );
  }

  return (
    <div className="buzzer-host-panel">
      <div className="buzzer-host-header">
        <h3 className="buzzer-host-title">📱 Phone Buzzer</h3>
        <button type="button" className="btn small danger" onClick={stopRoom}>
          Stop Room
        </button>
      </div>

      <div className="buzzer-host-room">
        <div className="buzzer-host-code">
          <span className="buzzer-host-code-label">Room Code</span>
          <span className="buzzer-host-code-value">{roomCode}</span>
        </div>
        
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt={`QR code for room ${roomCode}`}
            className="buzzer-host-qr"
          />
        )}
        
        {buzzUrl && (
          <a
            href={buzzUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="buzzer-host-link"
          >
            Open buzzer page ↗
          </a>
        )}
      </div>

      <div className="buzzer-host-state">
        <span className={`buzzer-state-badge state-${state}`}>
          {state.toUpperCase()}
        </span>
        <div className="buzzer-host-controls">
          {state === 'waiting' && (
            <button type="button" className="btn small primary" onClick={arm}>
              Arm
            </button>
          )}
          {state === 'armed' && (
            <button type="button" className="btn small" onClick={() => reset()}>
              Disarm
            </button>
          )}
          {state === 'locked' && (
            <>
              <button type="button" className="btn small" onClick={() => reset()}>
                Reset All
              </button>
              <button type="button" className="btn small primary" onClick={rearm}>
                Re-arm (lock out winner)
              </button>
            </>
          )}
        </div>
      </div>

      <div className="buzzer-host-players">
        <span className="buzzer-host-players-label">
          Connected: {buzzerPlayers.length}
        </span>
        <div className="buzzer-host-players-list">
          {buzzerPlayers.map((bp) => {
            const gamePlayer = players.find((p) => p.id === bp.gamePlayerId);
            const isLockedOut = lockedOutIds.has(bp.peerId);
            return (
              <div
                key={bp.peerId}
                className={`buzzer-host-player ${isLockedOut ? 'locked-out' : ''}`}
              >
                <span className="buzzer-host-player-name">
                  {bp.name}
                  {gamePlayer && (
                    <span className="buzzer-host-player-link">
                      → {gamePlayer.name}
                    </span>
                  )}
                  {isLockedOut && <span className="buzzer-host-locked-badge">🔒</span>}
                </span>
                <button
                  type="button"
                  className="buzzer-host-kick"
                  onClick={() => kickPlayer(bp.peerId)}
                  title="Remove player"
                >
                  ×
                </button>
              </div>
            );
          })}
          {buzzerPlayers.length === 0 && (
            <span className="buzzer-host-no-players">
              Waiting for players to join...
            </span>
          )}
        </div>
      </div>

      {lastResult && (
        <div className="buzzer-host-result">
          <div className="buzzer-host-winner">
            🏆 {lastResult.winner.name}
          </div>
          {lastResult.runnerUps.length > 0 && (
            <div className="buzzer-host-runners">
              {lastResult.runnerUps.map((r, i) => (
                <span key={r.peerId} className="buzzer-host-runner">
                  #{i + 2} {r.name} (+{r.deltaMs}ms)
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact inline display for showing in clue overlay */
export function BuzzerResultDisplay({
  winnerName,
  runnerUps,
}: {
  winnerName: string;
  runnerUps: Array<{ name: string; deltaMs?: number }>;
}) {
  return (
    <div className="buzzer-result-display">
      <div className="buzzer-result-winner">
        <span className="buzzer-result-crown">👑</span>
        <span className="buzzer-result-name">{winnerName}</span>
      </div>
      {runnerUps.length > 0 && (
        <div className="buzzer-result-runners">
          {runnerUps.slice(0, 3).map((r, i) => (
            <span key={i} className="buzzer-result-runner">
              #{i + 2} {r.name}
              {r.deltaMs !== undefined && ` +${r.deltaMs}ms`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
