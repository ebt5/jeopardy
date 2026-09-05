import type { Player } from '../types';

interface PlayersBarProps {
  players: Player[];
  clueValue?: number | null;
  onAdjust?: (playerId: string, delta: number) => void;
  showControls?: boolean;
}

export function PlayersBar({
  players,
  clueValue,
  onAdjust,
  showControls = false,
}: PlayersBarProps) {
  const value = clueValue ?? 0;
  return (
    <div className="players-bar">
      {players.map((p) => (
        <div key={p.id} className="player-box">
          <div className="player-name">{p.name}</div>
          <div className={`player-score${p.score < 0 ? ' negative' : ''}`}>
            {p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`}
          </div>
          {showControls && onAdjust && value > 0 && (
            <div className="player-controls">
              <button
                type="button"
                className="score-btn plus"
                onClick={() => onAdjust(p.id, value)}
                title={`Add $${value}`}
              >
                +${value}
              </button>
              <button
                type="button"
                className="score-btn minus"
                onClick={() => onAdjust(p.id, -value)}
                title={`Subtract $${value}`}
              >
                −${value}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
