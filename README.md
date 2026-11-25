# Jeopardy!

Local host-run game show board with phone buzzers, Daily Doubles, and Final Jeopardy. Built with Vite + React + TypeScript — no backend required.

## Live site

Public URL: https://ebt5.github.io/jeopardy/

Deployed automatically to GitHub Pages on push to `main` via GitHub Actions.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/jeopardy/`).

Production build:

```bash
npm run build
npm run preview
```

## How to use

1. **Setup** — edit category names, each clue answer (shown first) and question (revealed later), and players (or start the Phone Buzzer lobby so players can join from their phones).
2. **Daily Double** — check Daily Double on any clue(s) in Setup. Demo and AI boards place one by default. On the play board, Daily Double cells look identical until opened.
3. **Final Jeopardy** — edit category, clue, and response in Setup (and optionally choose a custom local think-music file). In play mode, click the **Final Jeopardy** header button.
4. **Saved boards** — Save / Load / Delete boards (categories + Final Jeopardy only), or Download JSON / Import JSON. Players are kept when loading.
5. **Load demo game** — sample board (with Daily Double + Final Jeopardy) for offline play with no API key required.
6. **Start Game** — enter play mode (resets scores and played cells).
7. **Play** — click a dollar cell; `Space` flips the clue to the correct response; `+`/`-` adjusts scores by the clue value (or Daily Double wager); `Esc` closes and marks the clue played.

Game config and saved boards persist in `localStorage` (`jeopardy-game-config`, `jeopardy-saved-boards`).

## Using AI board generation

AI board generation is completely optional — everything else in the game works without an API key.

To generate custom boards with Grok (`grok-3-mini`):

1. Create an API key at [console.x.ai](https://console.x.ai) (recommended: set a spending limit on the key).
2. In **Setup → AI Seed (optional)**, paste your key into the **xAI API key** field.
3. Write a prompt or category hints and click **Generate game**.

Privacy & safety notes:
- Your key is stored **only** in your browser's `localStorage` (`jeopardy_xai_api_key`) and is sent only directly to `https://api.x.ai` when you click **Generate game**.
- The key is never included in exported/saved boards, share URLs, PeerJS messages to player phones, or logs.
- Click **Forget key** at any time to clear it from `localStorage`. Don't save an API key on shared computers.

## Run your own copy

1. **Fork** this repository on GitHub.
2. In your fork, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. If your repository name is not `jeopardy`, update `base` in `vite.config.ts` to `'/<your-repo-name>/'` (or `'/'` for a custom domain / user site).
4. Push to `main` (or trigger the **Deploy to GitHub Pages** workflow manually under the **Actions** tab).

No backend, database, login setup, or repository secrets are required.
