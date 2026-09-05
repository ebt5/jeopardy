import { useEffect, useState } from 'react';
import type { Clue, Player } from '../types';
import { maxDailyDoubleWager } from '../types';
import { PlayersBar } from './PlayersBar';

type DdStep = 'splash' | 'pick' | 'wager' | 'clue';

interface ClueViewProps {
  categoryName: string;
  clue: Clue;
  revealed: boolean;
  onReveal: () => void;
  onClose: () => void;
  players: Player[];
  onAdjustScore: (playerId: string, delta: number) => void;
}

export function ClueView({
  categoryName,
  clue,
  revealed,
  onReveal,
  onClose,
  players,
  onAdjustScore,
}: ClueViewProps) {
  const isDd = Boolean(clue.dailyDouble);
  const [ddStep, setDdStep] = useState<DdStep>(isDd ? 'splash' : 'clue');
  const [wagerPlayerId, setWagerPlayerId] = useState<string | null>(null);
  const [wagerInput, setWagerInput] = useState('5');
  const [confirmedWager, setConfirmedWager] = useState<number | null>(null);

  const wagerPlayer = players.find((p) => p.id === wagerPlayerId) ?? null;
  const maxWager = wagerPlayer
    ? maxDailyDoubleWager(wagerPlayer.score, clue.value)
    : clue.value;
  const scoreAmount = confirmedWager ?? clue.value;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ddStep !== 'clue') {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!revealed) onReveal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, onClose, onReveal, ddStep]);

  const confirmWager = () => {
    if (!wagerPlayerId) return;
    const n = parseInt(wagerInput, 10);
    if (!Number.isFinite(n) || n < 5 || n > maxWager) {
      window.alert(`Enter a wager between $5 and $${maxWager}.`);
      return;
    }
    setConfirmedWager(n);
    setDdStep('clue');
  };

  if (isDd && ddStep === 'splash') {
    return (
      <div className="clue-overlay dd-splash" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-splash-body">
          <p className="dd-splash-label">DAILY DOUBLE</p>
          <p className="dd-splash-category">{categoryName}</p>
          <button type="button" className="btn primary large" onClick={() => setDdStep('pick')}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (isDd && ddStep === 'pick') {
    return (
      <div className="clue-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-panel">
          <p className="dd-badge">DAILY DOUBLE</p>
          <h2 className="dd-heading">Who is wagering?</h2>
          <p className="clue-hint">{categoryName}</p>
          <div className="dd-player-picks">
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn large dd-pick-btn"
                onClick={() => {
                  setWagerPlayerId(p.id);
                  const max = maxDailyDoubleWager(p.score, clue.value);
                  setWagerInput(String(Math.min(Math.max(5, clue.value), max)));
                  setDdStep('wager');
                }}
              >
                {p.name}
                <span className="dd-pick-score">
                  {p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isDd && ddStep === 'wager' && wagerPlayer) {
    return (
      <div className="clue-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-panel">
          <p className="dd-badge">DAILY DOUBLE</p>
          <h2 className="dd-heading">Wager — {wagerPlayer.name}</h2>
          <p className="clue-hint">
            Min $5 · Max ${maxWager}
            {wagerPlayer.score <= 0
              ? ' (score ≤ 0 → max is clue value)'
              : ' (max of score or clue value)'}
          </p>
          <label className="field-label dd-wager-label">
            Wager amount
            <input
              type="number"
              min={5}
              max={maxWager}
              step={5}
              value={wagerInput}
              onChange={(e) => setWagerInput(e.target.value)}
              className="dd-wager-input"
              autoFocus
            />
          </label>
          <div className="dd-wager-actions">
            <button type="button" className="btn" onClick={() => setDdStep('pick')}>
              Back
            </button>
            <button type="button" className="btn primary large" onClick={confirmWager}>
              Confirm wager
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="clue-overlay" role="dialog" aria-modal="true">
      <button type="button" className="clue-close" onClick={onClose} aria-label="Close clue">
        ×
      </button>
      <div className="clue-meta">
        <span>{categoryName}</span>
        <span className="clue-meta-right">
          {isDd && confirmedWager != null && (
            <span className="dd-inline-badge">DAILY DOUBLE · ${confirmedWager}</span>
          )}
          <span>${isDd && confirmedWager != null ? confirmedWager : clue.value}</span>
        </span>
      </div>
      <div className="clue-body" onClick={() => !revealed && onReveal()}>
        <p className="clue-label">{revealed ? 'QUESTION' : 'ANSWER'}</p>
        <p className="clue-text">{revealed ? clue.question : clue.answer}</p>
        {!revealed && (
          <p className="clue-hint">Click or press Space to reveal the question</p>
        )}
      </div>
      <div className="clue-actions">
        {!revealed ? (
          <button type="button" className="btn primary" onClick={onReveal}>
            Reveal Question
          </button>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            Back to Board
          </button>
        )}
      </div>
      <PlayersBar
        players={players}
        clueValue={scoreAmount}
        onAdjust={onAdjustScore}
        showControls
      />
    </div>
  );
}
