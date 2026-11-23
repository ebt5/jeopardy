import { useState, useEffect } from 'react';
import { useBuzzerPhone } from '../buzzer/useBuzzerPhone';
import type { Player } from '../types';
import './BuzzerPhone.css';

interface BuzzerPhoneProps {
  roomCode: string;
  gamePlayers?: Player[];
}

export function BuzzerPhone({ roomCode, gamePlayers = [] }: BuzzerPhoneProps) {
  const {
    status,
    buzzStatus,
    players,
    myRank,
    error,
    syncProgress,
    connect,
    disconnect,
    buzz,
  } = useBuzzerPhone();

  const [name, setName] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>();
  const [hasJoined, setHasJoined] = useState(false);

  useEffect(() => {
    if (status === 'disconnected' && error) {
      setHasJoined(false);
    }
  }, [status, error]);

  const handleJoin = () => {
    if (!name.trim()) return;
    
    const gamePlayer = gamePlayers.find((p) => p.id === selectedPlayerId);
    connect(roomCode, name.trim(), gamePlayer?.id);
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
            
            {gamePlayers.length > 0 && (
              <label className="buzzer-field">
                Link to Game Player (optional)
                <select
                  value={selectedPlayerId || ''}
                  onChange={(e) => setSelectedPlayerId(e.target.value || undefined)}
                >
                  <option value="">— Select player —</option>
                  {gamePlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            
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
