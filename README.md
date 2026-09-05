# Jeopardy!

Local admin-run game show board. Vite + React + TypeScript.

## Live site

Public URL: https://ebt5.github.io/jeopardy/

Deployed automatically to GitHub Pages on push to `main` (Actions workflow).

## Login

A simple client-side login gate is required before Setup or Play. Two host accounts are configured (Erik and Jon). Session is kept in `sessionStorage` for the browser tab until you log out.

## Run

```bash
cd jeopardy
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

Production build:

```bash
npm run build
npm run preview
```

## How to use

1. **Sign in** -- use one of the two configured host accounts (Erik or Jon). Session lasts for the browser tab.
2. **Setup** -- edit category names, each clue answer (shown first) and question (revealed later), and player names.
3. **Daily Double** -- check Daily Double on any clue(s) in Setup. Demo/AI place exactly one by default. On the play board, DD cells look identical until opened.
4. **Final Jeopardy** -- edit category / answer / question in Setup. In play mode, use the Final Jeopardy header button.
5. **Saved boards** -- Save / Load / Delete boards (categories + Final Jeopardy only). Also Download JSON / Import JSON. Players are kept when loading.
6. **Load demo game** -- sample board (one DD + Final Jeopardy) for offline play.
7. **AI Seed (optional)** -- paste an xAI API key (browser localStorage only), write a prompt, click Generate game (model grok-3-mini). Parses one Daily Double + Final Jeopardy (with fallbacks).
8. **Start Game** -- enter play mode (resets scores and played cells).
9. **Play** -- click a dollar cell; Space flips answer to question; +/- adjusts by clue value (or DD wager); Esc closes and marks played.

Game config and saved boards persist in localStorage (jeopardy-game-config, jeopardy-saved-boards).

### Daily Double (host)

1. Open a DD cell → splash with category → pick wagering player → enter wager (min $5
; max = max(score, clue.value) if score > 0, else clue value).
2. Confirm → show answer; Space/button reveals question.
3. +/- buttons use the wager for all players. Badge shows DAILY DOUBLE and wager.

### Final Jeopardy (host)

1. Header button (confirms if unplayed clues remain).
2. Show category → Continue → enter each player wager (0..max(score, 0); score <= 0 → only $0).
3. Reveal answer → question → Correct/Incorrect per player (+/- their wager).
4. Final scores → back to board or Setup.

## Notes

- xAI API key is optional and only needed for AI generate.
- Key never leaves the browser except when generating.
- No backend required.
