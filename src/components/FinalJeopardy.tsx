import { useEffect, useState } from 'react';
import type { FinalJeopardy as FJ, Player } from '../types';
import { maxFinalJeopardyWager } from '../types';

type FjStep = 'category' | 'wagers' | 'answer' | 'question' | 'scoring' | 'done';

interface FinalJeopardyProps {
  finalJeopardy: FJ;
  players: Player[];
  onAdjustScore: (playerId: string, delta: number) => void;
  onClose: () => void;
  onDoneToSetup: () => void;
}

export function FinalJeopardyView({
  finalJeopardy,
  players,
  onAdjustScore,
  onClose,
  onDoneToSetup,
}: FinalJeopardyProps) {
  const [step, setStep] = useState<FjStep>('category');
  const [wagers, setWagers] = useState<Record<string, string>>(() =>
    Object.fromEntries(players.map((p) => [p.id, '0'])),
  );
  const [confirmed, setConfirmed] = useState<Record<string, number>>({});
  const [resolved, setResolved] = useState<Record<string, 'correct' | 'incorrect' | null>>(
    () => Object.fromEntries(players.map((p) => [p.id, null])),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'done') onClose();
        else if (window.confirm('Exit Final Jeopardy and return to the board?')) onClose();
      } else if ((e.key === ' ' || e.code === 'Space') && (step === 'answer' || step === 'question')) {
        e.preventDefault();
        if (step === 'answer') setStep('question');
        else if (step === 'question') setStep('scoring');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  const confirmWagers = () => {
    const next: Record<string, number> = {};
    for (const p of players) {
      const max = maxFinalJeopardyWager(p.score);
      const n = parseInt(wagers[p.id] ?? '0', 10);
      if (!Number.isFinite(n) || n < 0 || n > max) {
        window.alert(`${p.name}: wager must be between $0 and $${max}.`);
        return;
      }
      next[p.id] = n;
    }
    setConfirmed(next);
    setStep('answer');
  };

  const markPlayer = (playerId: string, result: 'correct' | 'incorrect') => {
    if (resolved[playerId]) return;
    const wager = confirmed[playerId] ?? 0;
    onAdjustScore(playerId, result === 'correct' ? wager : -wager);
    setResolved((prev) => ({ ...prev, [playerId]: result }));
  };

  const allResolved = players.every((p) => resolved[p.id] != null);

  if (step === 'category') {
    return (
      <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-splash-body">
          <p className="dd-splash-label">FINAL JEOPARDY</p>
          <p className="dd-splash-category">{finalJeopardy.category || 'FINAL JEOPARDY'}</p>
          <button type="button" className="btn primary large" onClick={() => setStep('wagers')}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (step === 'wagers') {
    return (
      <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-panel fj-panel">
          <p className="dd-badge">FINAL JEOPARDY</p>
          <h2 className="dd-heading">Enter wagers</h2>
          <p className="clue-hint">Category: {finalJeopardy.category}</p>
          <div className="fj-wager-list">
            {players.map((p) => {
              const max = maxFinalJeopardyWager(p.score);
              return (
                <label key={p.id} className="fj-wager-row">
                  <span className="fj-wager-name">
                    {p.name}{' '}
                    <span className="fj-wager-score">
                      ({p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`} · max ${max})
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={max}
                    step={1}
                    value={wagers[p.id] ?? '0'}
                    disabled={max === 0}
                    onChange={(e) =>
                      setWagers((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                  />
                </label>
              );
            })}
          </div>
          <div className="dd-wager-actions">
            <button type="button" className="btn" onClick={() => setStep('category')}>
              Back
            </button>
            <button type="button" className="btn primary large" onClick={confirmWagers}>
              Lock wagers &amp; reveal answer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'answer' || step === 'question') {
    const showingQ = step === 'question';
    return (
      <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="clue-meta">
          <span>{finalJeopardy.category}</span>
          <span className="dd-inline-badge">FINAL JEOPARDY</span>
        </div>
        <div
          className="clue-body"
          onClick={() => {
            if (step === 'answer') setStep('question');
            else setStep('scoring');
          }}
        >
          <p className="clue-label">{showingQ ? 'QUESTION' : 'ANSWER'}</p>
          <p className="clue-text">
            {showingQ ? finalJeopardy.question : finalJeopardy.answer}
          </p>
          {!showingQ && (
            <p className="clue-hint">Click or press Space to reveal the question</p>
          )}
          {showingQ && (
            <p className="clue-hint">Click or press Space to score players</p>
          )}
        </div>
        <div className="clue-actions">
          {!showingQ ? (
            <button type="button" className="btn primary" onClick={() => setStep('question')}>
              Reveal Question
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => setStep('scoring')}>
              Score players
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step === 'scoring') {
    return (
      <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
        <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dd-panel fj-panel">
          <p className="dd-badge">FINAL JEOPARDY</p>
          <h2 className="dd-heading">Correct or incorrect?</h2>
          <p className="fj-reveal-q">{finalJeopardy.question}</p>
          <div className="fj-score-list">
            {players.map((p) => {
              const wager = confirmed[p.id] ?? 0;
              const result = resolved[p.id];
              return (
                <div key={p.id} className="fj-score-row">
                  <div className="fj-score-info">
                    <strong>{p.name}</strong>
                    <span>wager ${wager}</span>
                    <span className={p.score < 0 ? 'negative' : ''}>
                      {p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`}
                    </span>
                  </div>
                  <div className="fj-score-btns">
                    {result ? (
                      <span className={`fj-result ${result}`}>
                        {result === 'correct' ? `+$${wager}` : `−$${wager}`}
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="score-btn plus"
                          onClick={() => markPlayer(p.id, 'correct')}
                        >
                          Correct
                        </button>
                        <button
                          type="button"
                          className="score-btn minus"
                          onClick={() => markPlayer(p.id, 'incorrect')}
                        >
                          Incorrect
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="dd-wager-actions">
            <button
              type="button"
              className="btn primary large"
              disabled={!allResolved}
              onClick={() => setStep('done')}
            >
              Show final scores
            </button>
          </div>
        </div>
      </div>
    );
  }

  // done
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="clue-overlay fj-overlay" role="dialog" aria-modal="true">
      <button type="button" className="clue-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="dd-panel fj-panel">
        <p className="dd-badge">FINAL SCORES</p>
        <h2 className="dd-heading">Congratulations!</h2>
        <ol className="fj-final-list">
          {ranked.map((p, i) => (
            <li key={p.id} className={i === 0 ? 'winner' : ''}>
              <span>{p.name}</span>
              <span className={p.score < 0 ? 'negative' : ''}>
                {p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`}
              </span>
            </li>
          ))}
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
