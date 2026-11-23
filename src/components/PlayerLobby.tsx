import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { UseBuzzerHostResult } from '../buzzer/useBuzzerHost';
import type { Player } from '../types';
import type { BuzzerPlayer } from '../buzzer/types';
import './PlayerLobby.css';

interface PlayerLobbyProps {
  players: Player[];
  onPlayersChange: (players: Player[]) => void;
  onStartGame: () => void;
  buzzerHost: UseBuzzerHostResult;
}

export function PlayerLobby({
  players,
  onPlayersChange,
  onStartGame,
  buzzerHost,
}: PlayerLobbyProps) {
  const {
    roomCode,
    players: buzzerPlayers,
    error,
    isConnecting,
    startRoom,
    stopRoom,
    kickPlayer,
    linkPlayerToGame,
  } = buzzerHost;

  const [manualNameInput, setManualNameInput] = useState('');
  const prevBuzzerPlayersRef = useRef<BuzzerPlayer[]>([]);

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

  const deviceToPlayerRef = useRef<Map<string, string>>(new Map());

  const syncBuzzerPlayersToGamePlayers = useCallback(
    (newBuzzerPlayers: BuzzerPlayer[]) => {
      const prevBuzzerPlayers = prevBuzzerPlayersRef.current;
      prevBuzzerPlayersRef.current = newBuzzerPlayers;

      let updated = [...players];
      let changed = false;

      for (const bp of newBuzzerPlayers) {
        const existingByPeerId = updated.find((p) => p.buzzerPeerId === bp.peerId);
        if (existingByPeerId) continue;

        let matchedPlayer: Player | undefined;
        
        if (bp.deviceId) {
          const knownPlayerId = deviceToPlayerRef.current.get(bp.deviceId);
          if (knownPlayerId) {
            matchedPlayer = updated.find(
              (p) => p.id === knownPlayerId && !p.buzzerPeerId
            );
          }
        }
        
        if (!matchedPlayer) {
          matchedPlayer = updated.find(
            (p) => p.name.toLowerCase() === bp.name.toLowerCase() && !p.buzzerPeerId
          );
        }

        if (matchedPlayer) {
          updated = updated.map((p) =>
            p.id === matchedPlayer!.id
              ? { ...p, buzzerPeerId: bp.peerId, isManual: false }
              : p
          );
          linkPlayerToGame(bp.peerId, matchedPlayer.id);
          if (bp.deviceId) {
            deviceToPlayerRef.current.set(bp.deviceId, matchedPlayer.id);
          }
          changed = true;
        } else {
          const wasInPrev = prevBuzzerPlayers.some((prev) => prev.peerId === bp.peerId);
          if (!wasInPrev) {
            const newPlayerId = `p${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const newPlayer: Player = {
              id: newPlayerId,
              name: bp.name,
              score: 0,
              buzzerPeerId: bp.peerId,
              isManual: false,
            };
            updated.push(newPlayer);
            linkPlayerToGame(bp.peerId, newPlayerId);
            if (bp.deviceId) {
              deviceToPlayerRef.current.set(bp.deviceId, newPlayerId);
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
              p.id === linkedPlayer.id ? { ...p, buzzerPeerId: undefined } : p
            );
            changed = true;
          }
        }
      }

      if (changed) {
        onPlayersChange(updated);
      }
    },
    [players, onPlayersChange, linkPlayerToGame]
  );

  useEffect(() => {
    if (roomCode) {
      syncBuzzerPlayersToGamePlayers(buzzerPlayers);
    }
  }, [buzzerPlayers, roomCode, syncBuzzerPlayersToGamePlayers]);

  const addManualPlayer = () => {
    const name = manualNameInput.trim();
    if (!name) return;

    const existing = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      alert('A player with this name already exists');
      return;
    }

    const newPlayer: Player = {
      id: `p${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      score: 0,
      isManual: true,
    };
    onPlayersChange([...players, newPlayer]);
    setManualNameInput('');
  };

  const removePlayer = (playerId: string) => {
    const player = players.find((p) => p.id === playerId);
    if (player?.buzzerPeerId) {
      kickPlayer(player.buzzerPeerId);
    }
    onPlayersChange(players.filter((p) => p.id !== playerId));
  };

  const renamePlayer = (playerId: string) => {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;

    const newName = prompt('Enter new name:', player.name);
    if (!newName?.trim()) return;

    const duplicate = players.find(
      (p) => p.id !== playerId && p.name.toLowerCase() === newName.trim().toLowerCase()
    );
    if (duplicate) {
      alert('A player with this name already exists');
      return;
    }

    onPlayersChange(
      players.map((p) => (p.id === playerId ? { ...p, name: newName.trim() } : p))
    );
  };

  const handleStartGame = () => {
    if (players.length === 0) {
      alert('Add at least one player to start the game');
      return;
    }
    onStartGame();
  };

  return (
    <div className="player-lobby">
      <div className="lobby-header">
        <h2>Player Lobby</h2>
        <p className="lobby-subtitle">
          Players connect from their phones to join the game
        </p>
      </div>

      {!roomCode ? (
        <div className="lobby-start-room">
          {error && <div className="lobby-error">{error}</div>}
          <button
            type="button"
            className="btn primary large"
            onClick={startRoom}
            disabled={isConnecting}
          >
            {isConnecting ? 'Starting...' : '📱 Start Buzzer Lobby'}
          </button>
          <p className="lobby-hint">
            Start the buzzer room so players can join from their phones
          </p>
        </div>
      ) : (
        <div className="lobby-room-active">
          <div className="lobby-room-info">
            <div className="lobby-code-section">
              <div className="lobby-code">
                <span className="lobby-code-label">Room Code</span>
                <span className="lobby-code-value">{roomCode}</span>
              </div>
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt={`QR code for room ${roomCode}`}
                  className="lobby-qr"
                />
              )}
              {buzzUrl && (
                <a
                  href={buzzUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lobby-link"
                >
                  Open buzzer page ↗
                </a>
              )}
            </div>
            <button type="button" className="btn small danger" onClick={stopRoom}>
              Stop Room
            </button>
          </div>
        </div>
      )}

      <div className="lobby-players-section">
        <h3>Players ({players.length})</h3>
        
        {players.length === 0 ? (
          <div className="lobby-no-players">
            {roomCode
              ? 'Waiting for players to connect from their phones...'
              : 'Start the buzzer room or add players manually below'}
          </div>
        ) : (
          <div className="lobby-players-list">
            {players.map((player) => {
              const isConnected = buzzerPlayers.some(
                (bp) => bp.peerId === player.buzzerPeerId
              );
              return (
                <div
                  key={player.id}
                  className={`lobby-player ${isConnected ? 'connected' : ''} ${
                    player.isManual ? 'manual' : ''
                  }`}
                >
                  <div className="lobby-player-info">
                    <span className="lobby-player-name">{player.name}</span>
                    <span className="lobby-player-status">
                      {player.isManual ? (
                        <span className="status-manual">🎤 Verbal</span>
                      ) : isConnected ? (
                        <span className="status-connected">📱 Connected</span>
                      ) : (
                        <span className="status-disconnected">⏳ Waiting...</span>
                      )}
                    </span>
                  </div>
                  <div className="lobby-player-actions">
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => renamePlayer(player.id)}
                      title="Rename player"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => removePlayer(player.id)}
                      title="Remove player"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="lobby-add-manual">
          <input
            type="text"
            value={manualNameInput}
            onChange={(e) => setManualNameInput(e.target.value)}
            placeholder="Add player without phone..."
            maxLength={20}
            onKeyDown={(e) => e.key === 'Enter' && addManualPlayer()}
          />
          <button
            type="button"
            className="btn"
            onClick={addManualPlayer}
            disabled={!manualNameInput.trim()}
          >
            + Add
          </button>
        </div>
      </div>

      <div className="lobby-actions">
        <button
          type="button"
          className="btn primary large"
          onClick={handleStartGame}
          disabled={players.length === 0}
        >
          Start Game →
        </button>
      </div>
    </div>
  );
}
