import { useEffect, useState } from 'react';
import type { Clue, Player } from '../types';
import { maxDailyDoubleWager } from '../types';
import { PlayersBar } from './PlayersBar';
import { playDailyDoubleSound } from '../sound';

type DdStep = 'splash' | 'pick' | 'wager' | 'clue';

interface BuzzerWinner {
  gamePlayerId: string | null;
  name: string;
}

interface ClueViewProps {
  categoryName: string;
  clue: Clue;
  revealed: boolean;
  onReveal: () => void;
  onClose: () => void;
  players: Player[];
  onAdjustScore: (playerId: string, delta: number) => void;
  buzzerWinner?: BuzzerWinner | null;
  onPlayerCorrect?: (playerId: string) => void;
  onPlayerWrong?: (playerId: string) => void;
}

export function ClueView({
  categoryName,
  clue,
  revealed,
  onReveal,
  onClose,
  players,
  onAdjustScore,
  buzzerWinner,
  onPlayerCorrect,
  onPlayerWrong,
}: ClueViewProps) {
  const isDd = Boolean(clue.dailyDouble);
  const [ddStep, setDdStep] = useState<DdStep>(isDd ? 'splash' : 'clue');
  const [wagerPlayerId, setWagerPlayerId] = useState<string | null>(null);
  const [wagerInput, setWagerInput] = useState('5');
  const [confirmedWager, setConfirmedWager] = useState<number | null>(null);
  const [isPeekingAnswer, setIsPeekingAnswer] = useState(false);
  const [ddGraded, setDdGraded] = useState(false);

  const wagerPlayer = players.find((p) => p.id === wagerPlayerId) ?? null;
  const maxWager = wagerPlayer
    ? maxDailyDoubleWager(wagerPlayer.score, clue.value)
    : clue.value;
  const scoreAmount = confirmedWager ?? clue.value;

  useEffect(() => {
    if (isDd) playDailyDoubleSound();
  }, [isDd]);

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

  const highlightedPlayerId = buzzerWinner?.gamePlayerId ?? wagerPlayerId ?? null;

  const isDdCluePhase = isDd && ddStep === 'clue' && wagerPlayerId && confirmedWager !== null;

  const handleScoreAdjust = (playerId: string, delta: number) => {
    if (isDdCluePhase) {
      if (playerId === wagerPlayerId && !ddGraded) {
        onAdjustScore(playerId, delta > 0 ? confirmedWager! : -confirmedWager!);
        setDdGraded(true);
      } else if (playerId !== wagerPlayerId) {
        onAdjustScore(playerId, delta);
      }
    } else {
      onAdjustScore(playerId, delta);
      if (delta > 0 && onPlayerCorrect) {
        onPlayerCorrect(playerId);
      } else if (delta < 0 && onPlayerWrong) {
        onPlayerWrong(playerId);
      }
    }
  };

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
      {buzzerWinner && (
        <div className="clue-buzzer-winner">
          <span className="clue-buzzer-crown">👑</span>
          <span className="clue-buzzer-name">{buzzerWinner.name}</span>
        </div>
      )}
      {isDdCluePhase && wagerPlayer && !buzzerWinner && (
        <div className="clue-buzzer-winner dd-answering">
          <span className="clue-buzzer-crown">🎯</span>
          <span className="clue-buzzer-name">{wagerPlayer.name}</span>
          {ddGraded && <span className="dd-graded-badge">Graded</span>}
        </div>
      )}
      <div className="clue-body" onClick={() => !revealed && onReveal()}>
        <p className="clue-label">{revealed ? 'QUESTION' : 'ANSWER'}</p>
        <p className="clue-text">{revealed ? clue.question : clue.answer}</p>
        {!revealed && !isDdCluePhase && (
          <p className="clue-hint">
            Use player +/− buttons to grade, or click/Space to reveal
          </p>
        )}
        {!revealed && isDdCluePhase && !ddGraded && (
          <p className="clue-hint">
            Use {wagerPlayer?.name}'s +/− buttons to grade (wager: ${confirmedWager})
          </p>
        )}
        {!revealed && isDdCluePhase && ddGraded && (
          <p className="clue-hint">Click or press Space to reveal the question</p>
        )}
      </div>

      {/* Host peek: hold to see the correct question (answer to the clue) */}
      {!revealed && (
        <div className="clue-peek-container">
          <button
            type="button"
            className="clue-peek-btn"
            onMouseDown={() => setIsPeekingAnswer(true)}
            onMouseUp={() => setIsPeekingAnswer(false)}
            onMouseLeave={() => setIsPeekingAnswer(false)}
            onTouchStart={() => setIsPeekingAnswer(true)}
            onTouchEnd={() => setIsPeekingAnswer(false)}
            aria-label="Hold to peek at the question"
          >
            👁 Hold to Peek
          </button>
          {isPeekingAnswer && (
            <div className="clue-peek-answer">
              <span className="clue-peek-label">QUESTION:</span> {clue.question}
            </div>
          )}
        </div>
      )}

      <div className="clue-actions">
        {!revealed ? (
          <button type="button" className="btn primary" onClick={onReveal}>
            Reveal Answer
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
        onAdjust={handleScoreAdjust}
        showControls
        highlightedPlayerId={highlightedPlayerId}
      />
    </div>
  );
}
