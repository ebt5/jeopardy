import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { UseBuzzerHostResult } from '../buzzer/useBuzzerHost';
import type { Player } from '../types';
import './BuzzerHost.css';

interface BuzzerHostProps {
  players: Player[];
  isClueOpen: boolean;
  isDailyDouble?: boolean;
  buzzerHost: UseBuzzerHostResult;
  onBuzzerResult?: (
    winnerId: string | null,
    winnerName: string,
    rearmFn?: () => void
  ) => void;
  isCollapsible?: boolean;
}

export function BuzzerHost({
  players,
  isClueOpen,
  isDailyDouble = false,
  buzzerHost,
  onBuzzerResult,
  isCollapsible = false,
}: BuzzerHostProps) {
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
  } = buzzerHost;

  const prevIsClueOpenRef = useRef(isClueOpen);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-arm when clue opens (but not for Daily Doubles)
  useEffect(() => {
    if (
      isClueOpen &&
      !prevIsClueOpenRef.current &&
      roomCode &&
      state === 'waiting' &&
      !isDailyDouble
    ) {
      arm();
    }
    // Auto-reset when clue closes
    if (!isClueOpen && prevIsClueOpenRef.current && roomCode) {
      reset();
    }
    prevIsClueOpenRef.current = isClueOpen;
  }, [isClueOpen, roomCode, state, arm, reset, isDailyDouble]);

  // Notify parent of buzz result
  useEffect(() => {
    if (lastResult && onBuzzerResult) {
      onBuzzerResult(
        lastResult.winner.gamePlayerId ?? null,
        lastResult.winner.name,
        rearm
      );
    }
  }, [lastResult, onBuzzerResult, rearm]);

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
    <div className={`buzzer-host-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="buzzer-host-header">
        <h3 className="buzzer-host-title">📱 Phone Buzzer</h3>
        <div className="buzzer-host-header-actions">
          {isCollapsible && (
            <button
              type="button"
              className="btn small"
              onClick={() => setIsCollapsed(!isCollapsed)}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? '▼' : '▲'}
            </button>
          )}
          <button type="button" className="btn small danger" onClick={stopRoom}>
            Stop
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Join section - always visible during gameplay */}
          <div className="buzzer-host-join-section">
            <div className="buzzer-host-join-row">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt={`QR code for room ${roomCode}`}
                  className="buzzer-host-qr"
                />
              )}
              <div className="buzzer-host-join-info">
                <div className="buzzer-host-code">
                  <span className="buzzer-host-code-label">Room Code</span>
                  <span className="buzzer-host-code-value">{roomCode}</span>
                </div>
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
            </div>
            <p className="buzzer-host-join-hint">
              Scan QR or enter code to join mid-game
            </p>
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

          {/* Players section with connection status */}
          <div className="buzzer-host-players">
            <span className="buzzer-host-players-label">
              Players ({players.length}) · Connected: {buzzerPlayers.length}
            </span>
            <div className="buzzer-host-players-list">
              {players.map((player) => {
                const bp = buzzerPlayers.find((b) => b.peerId === player.buzzerPeerId);
                const isConnected = bp !== undefined;
                const isLockedOut = player.buzzerPeerId && lockedOutIds.has(player.buzzerPeerId);
                return (
                  <div
                    key={player.id}
                    className={`buzzer-host-player ${isLockedOut ? 'locked-out' : ''} ${
                      isConnected ? 'connected' : 'disconnected'
                    } ${player.isManual ? 'manual' : ''}`}
                  >
                    <span className="buzzer-host-player-status">
                      {player.isManual ? '🎤' : isConnected ? '📱' : '⏳'}
                    </span>
                    <span className="buzzer-host-player-name">
                      {player.name}
                      {isLockedOut && <span className="buzzer-host-locked-badge">🔒</span>}
                    </span>
                    {isConnected && player.buzzerPeerId && (
                      <button
                        type="button"
                        className="buzzer-host-kick"
                        onClick={() => kickPlayer(player.buzzerPeerId!)}
                        title="Remove player"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {/* Show any buzzer players not yet linked to game players */}
              {buzzerPlayers
                .filter((bp) => !players.some((p) => p.buzzerPeerId === bp.peerId))
                .map((bp) => {
                  const isLockedOut = lockedOutIds.has(bp.peerId);
                  return (
                    <div
                      key={bp.peerId}
                      className={`buzzer-host-player connected unlinked ${isLockedOut ? 'locked-out' : ''}`}
                    >
                      <span className="buzzer-host-player-status">📱</span>
                      <span className="buzzer-host-player-name">
                        {bp.name}
                        <span className="buzzer-host-player-new">NEW</span>
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
              {players.length === 0 && buzzerPlayers.length === 0 && (
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
        </>
      )}

      {isCollapsed && (
        <div className="buzzer-host-collapsed-summary">
          <span className={`buzzer-state-badge state-${state}`}>
            {state.toUpperCase()}
          </span>
          <span className="buzzer-host-collapsed-count">
            {buzzerPlayers.length}/{players.length} connected
          </span>
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
