import { useRef, useState } from 'react';
import type { Category, GameConfig, Player, SavedBoard } from '../types';
import { CLUE_VALUES, DEFAULT_FINAL_JEOPARDY } from '../types';
import { createBlankGame, createDemoGame, createEmptyClues } from '../demo';
import { generateGame } from '../ai';
import {
  boardSnapshot,
  deleteSavedBoard,
  loadApiKey,
  loadSavedBoards,
  saveApiKey,
  upsertSavedBoard,
} from '../storage';

interface SetupProps {
  config: GameConfig;
  onChange: (config: GameConfig) => void;
  onStart: () => void;
  username: string;
  onLogout: () => void;
}

export function Setup({ config, onChange, onStart, username, onLogout }: SetupProps) {
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [prompt, setPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [savedBoards, setSavedBoards] = useState<SavedBoard[]>(() => loadSavedBoards());
  const importRef = useRef<HTMLInputElement>(null);

  const updateCategoryName = (ci: number, name: string) => {
    const categories = config.categories.map((c, i) =>
      i === ci ? { ...c, name } : c,
    );
    onChange({ ...config, categories, boardName: undefined });
  };

  const updateClue = (
    ci: number,
    qi: number,
    field: 'answer' | 'question' | 'value',
    value: string,
  ) => {
    const categories = config.categories.map((cat, i) => {
      if (i !== ci) return cat;
      const clues = cat.clues.map((clue, j) => {
        if (j !== qi) return clue;
        if (field === 'value') {
          const n = parseInt(value, 10);
          return { ...clue, value: Number.isFinite(n) ? n : clue.value };
        }
        return { ...clue, [field]: value };
      });
      return { ...cat, clues };
    });
    onChange({ ...config, categories, boardName: undefined });
  };

  const toggleDailyDouble = (ci: number, qi: number) => {
    const categories = config.categories.map((cat, i) => {
      if (i !== ci) return cat;
      return {
        ...cat,
        clues: cat.clues.map((clue, j) =>
          j === qi ? { ...clue, dailyDouble: !clue.dailyDouble } : clue,
        ),
      };
    });
    onChange({ ...config, categories, boardName: undefined });
  };

  const updateFinalJeopardy = (field: 'category' | 'answer' | 'question', value: string) => {
    onChange({
      ...config,
      finalJeopardy: { ...config.finalJeopardy, [field]: value },
      boardName: undefined,
    });
  };

  const updatePlayerName = (id: string, name: string) => {
    const players = config.players.map((p) =>
      p.id === id ? { ...p, name } : p,
    );
    onChange({ ...config, players });
  };

  const addPlayer = () => {
    const n = config.players.length + 1;
    const players: Player[] = [
      ...config.players,
      { id: `p${Date.now()}`, name: `Player ${n}`, score: 0 },
    ];
    onChange({ ...config, players });
  };

  const removePlayer = (id: string) => {
    if (config.players.length <= 1) return;
    onChange({
      ...config,
      players: config.players.filter((p) => p.id !== id),
    });
  };

  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    saveApiKey(key);
  };

  const handleGenerate = async () => {
    setAiError(null);
    if (!apiKey.trim()) {
      setAiError(
        'Add an xAI API key above to use AI Generate. Or use “Load demo game” / edit clues manually.',
      );
      return;
    }
    setAiBusy(true);
    try {
      const result = await generateGame(apiKey.trim(), prompt);
      onChange({
        ...config,
        categories: result.categories,
        finalJeopardy: result.finalJeopardy,
        players: config.players.map((p) => ({ ...p, score: 0 })),
        boardName: undefined,
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setAiBusy(false);
    }
  };

  const loadDemo = () => {
    const demo = createDemoGame();
    onChange({
      ...demo,
      players:
        config.players.length > 0
          ? config.players.map((p, i) => ({
              ...p,
              score: 0,
              name: demo.players[i]?.name ?? p.name,
            }))
          : demo.players,
      boardName: 'Demo board',
    });
    setAiError(null);
  };

  const resetBlank = () => {
    const blank = createBlankGame(config.players.length);
    onChange({
      ...blank,
      players: config.players.map((p) => ({ ...p, score: 0 })),
      boardName: undefined,
    });
    setAiError(null);
  };

  const saveBoard = () => {
    const suggested = config.boardName ?? 'My Jeopardy Board';
    const name = window.prompt('Name for this board:', suggested);
    if (!name?.trim()) return;
    const snap = boardSnapshot(config.categories, config.finalJeopardy);
    const existing = savedBoards.find((b) => b.name === name.trim());
    const board: SavedBoard = {
      id: existing?.id ?? `board-${Date.now()}`,
      name: name.trim(),
      savedAt: new Date().toISOString(),
      categories: snap.categories,
      finalJeopardy: snap.finalJeopardy,
    };
    const next = upsertSavedBoard(board);
    setSavedBoards(next);
    onChange({ ...config, boardName: board.name });
  };

  const loadBoard = (board: SavedBoard) => {
    const snap = boardSnapshot(board.categories, board.finalJeopardy);
    onChange({
      ...config,
      categories: snap.categories,
      finalJeopardy: snap.finalJeopardy,
      boardName: board.name,
      players: config.players.map((p) => ({ ...p, score: 0 })),
    });
  };

  const removeBoard = (id: string) => {
    if (!window.confirm('Delete this saved board?')) return;
    setSavedBoards(deleteSavedBoard(id));
  };

  const downloadJson = () => {
    const snap = boardSnapshot(config.categories, config.finalJeopardy);
    const payload = {
      name: config.boardName ?? 'Jeopardy Board',
      savedAt: new Date().toISOString(),
      ...snap,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(config.boardName ?? 'jeopardy-board').replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        name?: string;
        categories?: Category[];
        finalJeopardy?: GameConfig['finalJeopardy'];
      };
      if (!data.categories?.length) {
        window.alert('Invalid board JSON: missing categories.');
        return;
      }
      const snap = boardSnapshot(
        data.categories,
        data.finalJeopardy ?? { ...DEFAULT_FINAL_JEOPARDY },
      );
      onChange({
        ...config,
        categories: snap.categories,
        finalJeopardy: snap.finalJeopardy,
        boardName: data.name ?? 'Imported board',
        players: config.players.map((p) => ({ ...p, score: 0 })),
      });
    } catch {
      window.alert('Could not parse JSON file.');
    }
  };

  const ddCount = config.categories.reduce(
    (n, c) => n + c.clues.filter((cl) => cl.dailyDouble).length,
    0,
  );

  return (
    <div className="setup">
      <header className="setup-header">
        <div className="setup-header-top">
          <span className="session-user" title="Signed in">
            {username}
          </span>
          <button type="button" className="btn small" onClick={onLogout}>
            Log out
          </button>
        </div>
        <h1 className="logo">JEOPARDY!</h1>
        <p className="setup-subtitle">Host setup — edit the board, then Start Game</p>
        {config.boardName && (
          <p className="board-name-banner">Current board: <strong>{config.boardName}</strong></p>
        )}
      </header>

      <section className="setup-section">
        <h2>Players</h2>
        <div className="setup-players">
          {config.players.map((p) => (
            <div key={p.id} className="setup-player-row">
              <input
                type="text"
                value={p.name}
                onChange={(e) => updatePlayerName(p.id, e.target.value)}
                aria-label="Player name"
              />
              <button
                type="button"
                className="btn danger small"
                onClick={() => removePlayer(p.id)}
                disabled={config.players.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={addPlayer}>
            + Add player
          </button>
        </div>
      </section>

      <section className="setup-section">
        <h2>Saved boards</h2>
        <div className="saved-boards-actions">
          <button type="button" className="btn primary small" onClick={saveBoard}>
            Save board
          </button>
          <button type="button" className="btn small" onClick={downloadJson}>
            Download JSON
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => importRef.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </div>
        {savedBoards.length === 0 ? (
          <p className="setup-hint">No saved boards yet. Save the current categories + Final Jeopardy to reuse later.</p>
        ) : (
          <ul className="saved-boards-list">
            {savedBoards.map((b) => (
              <li key={b.id} className="saved-board-row">
                <div className="saved-board-info">
                  <strong>{b.name}</strong>
                  <span className="saved-board-date">
                    {new Date(b.savedAt).toLocaleString()}
                  </span>
                </div>
                <div className="saved-board-btns">
                  <button type="button" className="btn small" onClick={() => loadBoard(b)}>
                    Load
                  </button>
                  <button
                    type="button"
                    className="btn danger small"
                    onClick={() => removeBoard(b.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="setup-section">
        <h2>AI Seed (optional)</h2>
        <div className="ai-panel">
          <label className="field-label">
            xAI API key
            <div className="api-key-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="sk-... (stored only in this browser)"
                autoComplete="off"
              />
              <button
                type="button"
                className="btn small"
                onClick={() => setShowKey((s) => !s)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <label className="field-label">
            Prompt / category hints
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder='e.g. "Categories about 90s music, space, and world history"'
            />
          </label>
          <div className="ai-actions">
            <button
              type="button"
              className="btn primary"
              onClick={handleGenerate}
              disabled={aiBusy}
            >
              {aiBusy ? 'Generating…' : 'Generate game'}
            </button>
            <button type="button" className="btn" onClick={loadDemo}>
              Load demo game
            </button>
            <button type="button" className="btn" onClick={resetBlank}>
              Clear board
            </button>
          </div>
          {aiError && <p className="ai-error">{aiError}</p>}
          {!apiKey.trim() && (
            <p className="ai-note">
              No API key needed for manual editing or the demo game. Key is saved in
              Pre-filled for hosts; stored in localStorage and sent only to xAI when you generate.
            </p>
          )}
        </div>
      </section>

      <section className="setup-section">
        <h2>Categories &amp; Clues</h2>
        <p className="setup-hint">
          Daily Doubles marked: {ddCount}. Toggle DD per clue (board cells stay identical until opened).
        </p>
        <div className="setup-categories">
          {config.categories.map((cat, ci) => (
            <div key={ci} className="setup-category">
              <input
                className="category-name-input"
                type="text"
                value={cat.name}
                onChange={(e) => updateCategoryName(ci, e.target.value)}
                aria-label={`Category ${ci + 1} name`}
              />
              {cat.clues.map((clue, qi) => (
                <div key={qi} className={`setup-clue${clue.dailyDouble ? ' is-dd' : ''}`}>
                  <label className="value-label">
                    $
                    <input
                      type="number"
                      className="value-input"
                      value={clue.value}
                      step={100}
                      min={100}
                      onChange={(e) =>
                        updateClue(ci, qi, 'value', e.target.value)
                      }
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="Answer (shown first)"
                    value={clue.answer}
                    onChange={(e) =>
                      updateClue(ci, qi, 'answer', e.target.value)
                    }
                  />
                  <input
                    type="text"
                    placeholder="Question (What/Who is…?)"
                    value={clue.question}
                    onChange={(e) =>
                      updateClue(ci, qi, 'question', e.target.value)
                    }
                  />
                  <label className="dd-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(clue.dailyDouble)}
                      onChange={() => toggleDailyDouble(ci, qi)}
                    />
                    Daily Double
                  </label>
                </div>
              ))}
              {cat.clues.length === 0 && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    const categories = config.categories.map((c, i) =>
                      i === ci ? { ...c, clues: createEmptyClues() } : c,
                    );
                    onChange({ ...config, categories });
                  }}
                >
                  Add default clues
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="setup-hint">
          Default values: {CLUE_VALUES.map((v) => `$${v}`).join(', ')}. You can tweak
          values per clue if desired.
        </p>
      </section>

      <section className="setup-section">
        <h2>Final Jeopardy</h2>
        <div className="fj-setup">
          <label className="field-label">
            Category
            <input
              type="text"
              value={config.finalJeopardy.category}
              onChange={(e) => updateFinalJeopardy('category', e.target.value)}
              placeholder="FINAL JEOPARDY category"
            />
          </label>
          <label className="field-label">
            Answer (shown first)
            <input
              type="text"
              value={config.finalJeopardy.answer}
              onChange={(e) => updateFinalJeopardy('answer', e.target.value)}
              placeholder="Clue statement"
            />
          </label>
          <label className="field-label">
            Question (What/Who is…?)
            <input
              type="text"
              value={config.finalJeopardy.question}
              onChange={(e) => updateFinalJeopardy('question', e.target.value)}
              placeholder="Correct response"
            />
          </label>
        </div>
      </section>

      <footer className="setup-footer">
        <button type="button" className="btn primary large" onClick={onStart}>
          Start Game
        </button>
      </footer>
    </div>
  );
}
