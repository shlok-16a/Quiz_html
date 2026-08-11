# HTML Quiz Game (Player)

Static player frontend for SixteenArena quiz APIs. Mirrors the Quiz-Game player flow (login → available quizzes → play → result).

## Structure

```
html_quiz_game/
├── index.html          # Login / register + OTP
├── categories.html     # Available quizzes
├── quiz.html           # Play session
├── result.html         # Score & rank
├── css/style.css
└── js/
    ├── api.js          # Base URL, auth headers, ApiResponse unwrap
    ├── auth.js
    ├── categories.js
    ├── quiz.js
    └── result.js
```

## API

Default base: `http://localhost:5006`

| Flow | Endpoint |
|------|----------|
| Login | `POST /api/v1/auth/password-login` |
| Register | `POST /api/v1/auth/email-login` → `POST /api/v1/auth/verify-otp` |
| List | `GET /api/v1/quiz/available` |
| Start | `POST /api/v1/quiz/start` |
| Answer | `POST /api/v1/quiz/answer` |
| Result | `GET /api/v1/quiz/result/{sessionId}` |

Override API host in the browser console:

```js
localStorage.setItem("quizApiBase", "http://localhost:5006");
```

Dev OTP wildcard (from API config): `9999`

## Run

1. Start SixteenArena WebAPI (`dotnet run` on port 5006).
2. Serve this folder (needed for CORS / not `file://`):

```bash
cd html_quiz_game
npx --yes serve -p 5500
```

3. Open `http://localhost:5500`
