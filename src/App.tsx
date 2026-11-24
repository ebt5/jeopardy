import { useCallback, useEffect, useState } from 'react';
import type { AppMode, GameConfig } from './types';
import { clearSession, loadSession, type Session } from './auth';
import { loadGameConfig, presetConfigFromUrl, saveGameConfig } from './storage';
import { Board } from './components/Board';
import { ClueView } from './components/ClueView';
import { FinalJeopardyView } from './components/FinalJeopardy';
import { Login } from './components/Login';
import { PlayersBar } from './components/PlayersBar';
import { Setup } from './components/Setup';
import { BuzzerHost } from './components/BuzzerHost';
import { useBuzzerHost } from './buzzer/useBuzzerHost';
import './App.css';

interface ActiveClue {
  categoryIndex: number;
  clueIndex: number;
}

interface BuzzerWinner {
  gamePlayerId: string | null;
  name: string;
}

interface BuzzerControls {
  rearmAfterWrong: () => void;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [mode, setMode] = useState<AppMode>('setup');
  const [config, setConfig] = useState<GameConfig>(() => {
    const base = loadGameConfig();
    return presetConfigFromUrl(base) ?? base;
  });
  const [active, setActive] = useState<ActiveClue | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [buzzerWinner, setBuzzerWinner] = useState<BuzzerWinner | null>(null);
  const [showBuzzerPanel, setShowBuzzerPanel] = useState(true);
  const [buzzerControls, setBuzzerControls] = useState<BuzzerControls | null>(null);

  const buzzerHost = useBuzzerHost();

  useEffect(() => {
    saveGameConfig(config);
    if (window.location.search.includes('board=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [config]);

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setActive(null);
    setRevealed(false);
    setShowFinal(false);
    setMode('setup');
  };

  const handleConfigChange = (next: GameConfig) => {
    setConfig(next);
  };

  const startGame = () => {
    setConfig({
      ...config,
      categories: config.categories.map((c) => ({
        ...c,
        clues: c.clues.map((cl) => ({ ...cl, played: false })),
      })),
      players: config.players.map((p) => ({ ...p, score: 0 })),
    });
    setActive(null);
    setRevealed(false);
    setShowFinal(false);
    setMode('play');
  };

  const backToSetup = () => {
    const midGame = config.categories.some((c) =>
      c.clues.some((cl) => cl.played),
    );
    if (midGame) {
      const ok = window.confirm(
        'Leave play mode and return to setup? Progress on this board will stay in memory until you Start Game again (which resets scores and played cells).',
      );
      if (!ok) return;
    }
    setActive(null);
    setRevealed(false);
    setShowFinal(false);
    setMode('setup');
  };

  const selectClue = (categoryIndex: number, clueIndex: number) => {
    const clue = config.categories[categoryIndex]?.clues[clueIndex];
    if (!clue || clue.played) return;
    setActive({ categoryIndex, clueIndex });
    setRevealed(false);
  };

  const closeClue = useCallback(() => {
    if (!active) return;
    setConfig((prev) => {
      const categories = prev.categories.map((cat, ci) => {
        if (ci !== active.categoryIndex) return cat;
        return {
          ...cat,
          clues: cat.clues.map((cl, qi) =>
            qi === active.clueIndex ? { ...cl, played: true } : cl,
          ),
        };
      });
      return { ...prev, categories };
    });
    setActive(null);
    setRevealed(false);
    setBuzzerWinner(null);
    setBuzzerControls(null);
  }, [active]);

  const handleBuzzerResult = useCallback(
    (gamePlayerId: string | null, name: string, rearmFn?: () => void) => {
      setBuzzerWinner({ gamePlayerId, name });
      if (rearmFn) {
        setBuzzerControls({ rearmAfterWrong: rearmFn });
      }
    },
    []
  );

  const adjustScore = (playerId: string, delta: number) => {
    setConfig((prev) => ({
      ...prev,
      players: prev.players.map((p) =>
        p.id === playerId ? { ...p, score: p.score + delta } : p,
      ),
    }));
  };

  const handlePlayerCorrect = useCallback((_playerId: string) => {
    setBuzzerWinner(null);
    buzzerHost.reset();
  }, [buzzerHost]);

  const handlePlayerWrong = useCallback((_playerId: string) => {
    if (buzzerWinner && buzzerControls?.rearmAfterWrong) {
      buzzerControls.rearmAfterWrong();
    }
    setBuzzerWinner(null);
  }, [buzzerWinner, buzzerControls]);

  const startFinalJeopardy = () => {
    const unplayed = config.categories.some((c) =>
      c.clues.some((cl) => !cl.played),
    );
    if (unplayed) {
      const ok = window.confirm(
        'Some clues are still unplayed. Start Final Jeopardy anyway?',
      );
      if (!ok) return;
    }
    setActive(null);
    setRevealed(false);
    setShowFinal(true);
  };

  if (!session) {
    return <Login onSuccess={setSession} />;
  }

  if (mode === 'setup') {
    return (
      <Setup
        config={config}
        onChange={handleConfigChange}
        onStart={startGame}
        username={session.username}
        onLogout={handleLogout}
        buzzerHost={buzzerHost}
      />
    );
  }

  const activeClue =
    active != null
      ? config.categories[active.categoryIndex]?.clues[active.clueIndex]
      : null;
  const activeCategoryName =
    active != null ? config.categories[active.categoryIndex]?.name : '';

  return (
    <div className="play">
      <header className="play-header">
        <h1 className="logo small">JEOPARDY!</h1>
        <div className="play-header-actions">
          <span className="session-user" title="Signed in">
            {session.username}
          </span>
          <button type="button" className="btn small" onClick={handleLogout}>
            Log out
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => setShowBuzzerPanel((v) => !v)}
            title="Toggle buzzer panel"
          >
            📱 Buzzer
          </button>
          <button type="button" className="btn small primary" onClick={startFinalJeopardy}>
            Final Jeopardy
          </button>
          <button type="button" className="btn small" onClick={backToSetup}>
            Setup
          </button>
        </div>
      </header>
      <div className="play-main">
        <div className="play-board-area">
          <Board categories={config.categories} onSelectClue={selectClue} />
          <PlayersBar players={config.players} />
        </div>
        {showBuzzerPanel && (
          <aside className="play-buzzer-sidebar">
            <BuzzerHost
              players={config.players}
              onPlayersChange={(players) => setConfig((prev) => ({ ...prev, players }))}
              isClueOpen={active !== null}
              isDailyDouble={activeClue?.dailyDouble === true}
              buzzerHost={buzzerHost}
              onBuzzerResult={handleBuzzerResult}
              isCollapsible
            />
          </aside>
        )}
      </div>
      {active && activeClue && (
        <ClueView
          key={`${active.categoryIndex}-${active.clueIndex}`}
          categoryName={activeCategoryName}
          clue={activeClue}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onClose={closeClue}
          players={config.players}
          onAdjustScore={adjustScore}
          buzzerWinner={buzzerWinner}
          onPlayerCorrect={!activeClue.dailyDouble ? handlePlayerCorrect : undefined}
          onPlayerWrong={!activeClue.dailyDouble ? handlePlayerWrong : undefined}
        />
      )}
      {showFinal && (
        <FinalJeopardyView
          finalJeopardy={config.finalJeopardy}
          players={config.players}
          onAdjustScore={adjustScore}
          onClose={() => setShowFinal(false)}
          onDoneToSetup={() => {
            setShowFinal(false);
            setMode('setup');
          }}
        />
      )}
    </div>
  );
}
