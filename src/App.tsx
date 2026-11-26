import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppMode, GameConfig, Player } from './types';
import type { BuzzerPlayer } from './buzzer/types';
import { loadGameConfig, presetConfigFromUrl, saveGameConfig } from './storage';
import { Board } from './components/Board';
import { ClueView } from './components/ClueView';
import { FinalJeopardyView } from './components/FinalJeopardy';
import { PlayersBar } from './components/PlayersBar';
import { Setup } from './components/Setup';
import { BuzzerHost } from './components/BuzzerHost';
import { useBuzzerHost } from './buzzer/useBuzzerHost';
import { reconcileBuzzerPlayers } from './buzzer/phone-session';
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
  const prevBuzzerPlayersRef = useRef<BuzzerPlayer[]>([]);
  const deviceToPlayerRef = useRef<Map<string, string>>(new Map());
  const playersRef = useRef<Player[]>(config.players);
  playersRef.current = config.players;
  const armedClueKeyRef = useRef<string | null>(null);

  const activeClue =
    active != null
      ? config.categories[active.categoryIndex]?.clues[active.clueIndex]
      : null;
  const activeCategoryName =
    active != null ? config.categories[active.categoryIndex]?.name : '';
  const isActiveDailyDouble = activeClue?.dailyDouble === true;

  // Auto-arm when a non-Daily-Double clue opens and auto-reset when it closes,
  // regardless of whether the BuzzerHost sidebar panel is shown or hidden.
  useEffect(() => {
    const clueKey =
      mode === 'play' && active != null && activeClue && !isActiveDailyDouble && buzzerHost.roomCode
        ? `${buzzerHost.roomCode}:${active.categoryIndex}-${active.clueIndex}`
        : null;

    if (clueKey) {
      if (armedClueKeyRef.current !== clueKey) {
        armedClueKeyRef.current = clueKey;
        buzzerHost.arm({ freshRound: true });
      }
    } else if (armedClueKeyRef.current !== null) {
      armedClueKeyRef.current = null;
      if (buzzerHost.roomCode) {
        buzzerHost.reset();
      }
    }
  }, [
    mode,
    active,
    activeClue,
    isActiveDailyDouble,
    buzzerHost.roomCode,
    buzzerHost.arm,
    buzzerHost.reset,
  ]);

  // Propagate buzzer winner to ClueView even when the buzzer sidebar is hidden
  useEffect(() => {
    if (buzzerHost.lastResult) {
      setBuzzerWinner({
        gamePlayerId: buzzerHost.lastResult.winner.gamePlayerId ?? null,
        name: buzzerHost.lastResult.winner.name,
      });
      setBuzzerControls({ rearmAfterWrong: buzzerHost.rearm });
    }
  }, [buzzerHost.lastResult, buzzerHost.rearm]);

  // Keep phone connections linked to game players across Setup, Play, and Final Jeopardy
  useEffect(() => {
    if (!buzzerHost.roomCode) {
      if (prevBuzzerPlayersRef.current.length > 0) {
        prevBuzzerPlayersRef.current = [];
        setConfig((prev) => {
          const hadLinked = prev.players.some((p) => p.buzzerPeerId !== undefined);
          if (!hadLinked) return prev;
          return {
            ...prev,
            players: prev.players.map((p) => ({ ...p, buzzerPeerId: undefined })),
          };
        });
      }
      return;
    }

    const newBuzzerPlayers = buzzerHost.players;
    const prevBuzzerPlayers = prevBuzzerPlayersRef.current;
    prevBuzzerPlayersRef.current = newBuzzerPlayers;

    const { players: updated, changed, toLink } = reconcileBuzzerPlayers(
      playersRef.current,
      newBuzzerPlayers,
      prevBuzzerPlayers,
      deviceToPlayerRef.current,
    );

    if (changed) {
      setConfig((prev) => ({ ...prev, players: updated }));
    }
    for (const { peerId, gamePlayerId } of toLink) {
      buzzerHost.linkPlayerToGame(peerId, gamePlayerId);
    }
  }, [buzzerHost.players, buzzerHost.roomCode, buzzerHost.linkPlayerToGame]);

  useEffect(() => {
    saveGameConfig(config);
    if (window.location.search.includes('board=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [config]);

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
    setBuzzerWinner(null);
    setBuzzerControls(null);
    armedClueKeyRef.current = null;
    if (buzzerHost.roomCode) {
      buzzerHost.reset();
    }
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
    setBuzzerWinner(null);
    setBuzzerControls(null);
    armedClueKeyRef.current = null;
    if (buzzerHost.roomCode) {
      buzzerHost.reset();
    }
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
    setBuzzerWinner(null);
    setBuzzerControls(null);
    buzzerHost.reset();
    setShowFinal(true);
  };

  if (mode === 'setup') {
    return (
      <Setup
        config={config}
        onChange={handleConfigChange}
        onStart={startGame}
        buzzerHost={buzzerHost}
      />
    );
  }

  return (
    <div className="play">
      <header className="play-header">
        <h1 className="logo small">JEOPARDY!</h1>
        <div className="play-header-actions">
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
              buzzerHost={buzzerHost}
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
          buzzerHost={buzzerHost}
        />
      )}
    </div>
  );
}
