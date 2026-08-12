# HTML Quiz Game (Player)

Static player frontend for SixteenArena quiz APIs.

## Modes

1. **Standalone** — login → available quizzes → play → result  
2. **Arena pool (Flutter WebView)** — same session pattern as `2048-master`:
   - reads `window.__GAME_SESSION__` / URL / `postMessage`
   - uses app JWT (no login screen)
   - loads the quiz try created by `start-try`
   - on finish, score is already submitted via quiz APIs; UI closes back to the app

## Structure

```
html_quiz_game/
├── index.html
├── categories.html
├── quiz.html
├── result.html
├── css/style.css
└── js/
    ├── flutter_session.js   # Arena / Flutter session bridge
    ├── api.js
    ├── auth.js
    ├── categories.js
    ├── quiz.js
    └── result.js
```

## Flutter `__GAME_SESSION__` (pool play)

Inject the same fields as other HTML5 pool games, plus quiz when available:

```js
window.__GAME_SESSION__ = {
  token: "<jwt>",
  poolId: "<game_pools.id>",
  sessionId: "<game_pool_sessions.id>",   // pool try id from start-try
  apiServerUrl: "http://localhost:5006",  // or prod API
  timerDuration: 180,
  // optional — start-try.quiz payload (skips extra fetch)
  quizSessionId: "<quiz_sessions.id>",
  quiz: { /* StartQuizResponseDto from start-try */ }
};
```

If `quiz` is omitted, the HTML calls  
`GET /api/v1/quiz/by-pool-session/{sessionId}` using the pool session id.

## API

| Flow | Endpoint |
|------|----------|
| Login (standalone) | `POST /api/v1/auth/password-login` |
| List (standalone) | `GET /api/v1/quiz/available` |
| Start (standalone) | `POST /api/v1/quiz/start` |
| Pool resume | `GET /api/v1/quiz/by-pool-session/{gamePoolSessionId}` |
| Answer | `POST /api/v1/quiz/answer` |
| Result | `GET /api/v1/quiz/result/{sessionId}` |

## Run

```bash
cd html_quiz_game
npx --yes serve -p 5500
```

Point the Quiz casual game `redirect_url` at this host (e.g. `http://localhost:5500/index.html`).
