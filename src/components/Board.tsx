import type { Category } from '../types';

interface BoardProps {
  categories: Category[];
  onSelectClue: (categoryIndex: number, clueIndex: number) => void;
}

export function Board({ categories, onSelectClue }: BoardProps) {
  return (
    <div className="board" role="grid" aria-label="Jeopardy board">
      {categories.map((cat, ci) => (
        <div key={ci} className="board-category" role="row">
          <div className="board-header" role="columnheader">
            {cat.name}
          </div>
          {cat.clues.map((clue, qi) => (
            <button
              key={qi}
              type="button"
              className={`board-cell${clue.played ? ' played' : ''}`}
              disabled={clue.played}
              onClick={() => onSelectClue(ci, qi)}
              aria-label={
                clue.played
                  ? `${cat.name} $${clue.value} played`
                  : `${cat.name} $${clue.value}`
              }
            >
              {clue.played ? '' : `$${clue.value}`}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
