# Quiz HTML client — API flow (keep current UI)

Hand this to the HTML quiz game team. **Do not redesign screens.** Keep the existing question, options, timer, feedback, and result UI. Only wire those screens to the APIs below so **tries and scores are correct**.

The server is the source of truth for:

- which questions appear in this try
- the per-question clock
- points / bonus / total score
- when the pool try is complete and lands on the leaderboard

The HTML must **not** invent questions, compute scores, or call pool `submit-score`.

---

## 0. What the HTML receives from the app

The app (Flutter) already:

1. Joins the pool
2. Calls `POST /game-pools/{poolId}/start-try`
3. Opens the quiz HTML in a WebView
4. Injects bootstrap after load (JWT is **not** in the URL)

```js
window.__16ARENA_QUIZ__ = {
  apiBaseUrl: "https://<host>/api/v1",
  accessToken: "<jwt>",
  poolId: "<guid>",
  gamePoolSessionId: "<guid>",   // pool try id
  quizSessionId: "<guid>",       // quiz attempt id
  expiresAt: "2026-08-17T11:05:00Z",
  quiz: { /* StartQuizResponseDto — first paint */ }
};
window.dispatchEvent(new Event("16arena-quiz-ready"));
```

Two IDs — do not mix them:

| ID | Field | Use |
|----|--------|-----|
| Pool try | `gamePoolSessionId` | `GET /quiz/by-pool-session/{id}`, `POST .../abandon` |
| Quiz attempt | `quizSessionId` | `begin-question`, `answer`, `violation`, `result`, session abandon |

`POST /quiz/start` is **not** used in pool play. The try and quiz session already exist after `start-try`.

---

## 1. Auth + envelope

Every quiz call:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Every response:

```json
{ "success": true, "message": "…", "data": { } }
```

Use `data`. If `success === false`, show `message` and **do not** advance the question.

```js
async function api(path, { method = "GET", body } = {}) {
  const { apiBaseUrl, accessToken } = window.__16ARENA_QUIZ__;
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Request failed");
  return json.data;
}
```

Paths below are relative to `apiBaseUrl` (already includes `/api/v1`).

---

## 2. Screen → API map (UI stays the same)

| Existing UI event | Call | Why |
|-------------------|------|-----|
| HTML opens / WebView resumes | `GET /quiz/by-pool-session/{gamePoolSessionId}` | Load **current** question (not a new try) |
| Question + media visible on screen | `POST /quiz/sessions/{quizSessionId}/begin-question` | Starts **server** clock. Required before answer |
| User taps option 1 / 2 / 3 | `POST /quiz/answer` with `selectedOption` 1–3 | Score is calculated on server |
| User taps Skip | `POST /quiz/answer` with `selectedOption` 0 | 0 points |
| Local timer hits 0 | `POST /quiz/answer` with `selectedOption` 0 | Server records `TIMEOUT` if grace passed |
| App goes to background | `POST /quiz/sessions/{quizSessionId}/violation` | First strike skips Q; second ends quiz |
| Last question done / terminated | `GET /quiz/result/{quizSessionId}` | Show existing result screen |
| User taps Exit / Back **before** finishing | `POST /quiz/by-pool-session/{gamePoolSessionId}/abandon` | Remaining Qs skipped, **current score submitted** for this try |
| Result screen Close | Tell the app (`quizFinished` / `close`) | App shows pool leaderboard |

Do **not** call:

- `POST /quiz/start` (that is standalone practice, not a pool try)
- `POST /game-pools/{poolId}/start-try` (app already did this; calling again **burns a try**)
- `POST /game-pools/{poolId}/sessions/{id}/submit-score` (server submits on complete / terminate / abandon)

---

## 3. Boot / resume (do this every time HTML loads)

Always refresh from the server. Injected `quiz.firstQuestion` is only a first-paint hint.

```
GET /quiz/by-pool-session/{gamePoolSessionId}
```

Same shape as `start-try.data.quiz`.

| Field | What the existing UI should show |
|-------|----------------------------------|
| `isCompleted` / `isTerminated` | Skip play → result screen |
| `firstQuestion` | **Current** question (name is historical) |
| `currentQuestionNumber` / `totalQuestions` | “Q 3 / 10” — ignore `question.questionNumber` (it is always 0) |
| `score` | Running score |
| `remainingQuestionSeconds` | `null` = clock not started → call `begin-question`. Number = resume mid-question, use that for the UI timer |
| `questionTimerSeconds` | Full per-question length |
| `interQuestionCountdownSeconds` | Pause between questions (`0` = none). HTML-only; do not start the clock during this |
| `correctPoints` / `wrongPoints` | Rules copy only |

If the user left long enough that the live question timed out, this GET **auto-skips** it (`TIMEOUT`, 0 points) and returns the next question or completed.

---

## 4. Play loop (one question at a time)

Questions for this try were locked at `start-try`. HTML never fetches a bank. Only the **current** question is returned. Options are shuffled; `selectedOption` is **1 / 2 / 3 as shown**.

```
show question (existing UI)
POST begin-question          ← when visible, after inter-question countdown
run local countdown from remainingSeconds (display only)
user taps / skip / local 0
POST answer
show feedback from response (existing UI)
if quizCompleted → GET result
else wait interQuestionCountdownSeconds → next question
```

### 4.1 Begin question (required)

```
POST /quiz/sessions/{quizSessionId}/begin-question
{ "questionId": "<current question id>" }
```

```json
{
  "questionId": "…",
  "remainingSeconds": 15,
  "questionTimerSeconds": 15
}
```

Drive the existing timer from `remainingSeconds`, not a fresh `questionTimerSeconds`. Calling again on the same live question is safe (returns time left).

Answering **before** this call fails: `Question timer has not started.`

### 4.2 Answer / skip / timeout

```
POST /quiz/answer
{
  "sessionId": "<quizSessionId>",
  "questionId": "<current question id>",
  "selectedOption": 1,
  "timeTakenSeconds": 0
}
```

| `selectedOption` | UI |
|------------------|----|
| `1` `2` `3` | Option the user tapped **on screen** |
| `0` | Skip button **or** local timer ended |

`timeTakenSeconds` is **ignored**. Send `0`. Server uses `begin-question` elapsed time.

If the server clock already expired (`timer + 2s` grace), the answer is forced to a timeout skip even if the client sent 1–3.

Response (bind to existing feedback UI):

| Field | UI |
|-------|----|
| `isCorrect` | Right / wrong |
| `correctOption` | Which **displayed** button was correct (`0` if skip) |
| `pointsAwarded` | Delta this question |
| `bonusAwarded` | Speed bonus (correct only) |
| `score` | New total — **use this**, do not add locally |
| `skipReason` | `null` \| `USER` \| `TIMEOUT` \| `ANTI_CHEAT` \| `ABANDON` |
| `nextQuestion` | Next question, or `null` if done |
| `quizCompleted` | Go to result |

Lock options until this returns (prevent double submit).

On the **last** question, the server **auto-submits this try’s score** to the pool leaderboard. HTML does not submit score.

### 4.3 Result screen

```
GET /quiz/result/{quizSessionId}
```

Use `score`, `correctAnswers`, `wrongAnswers`, `skippedAnswers`, `bonusPoints`, `rank`, `isTerminated`. Then notify the app:

```js
QuizBridge.postMessage(JSON.stringify({
  type: result.isTerminated ? "quizTerminated" : "quizFinished",
  score: result.score,
  quizSessionId: result.sessionId,
  poolId: window.__16ARENA_QUIZ__.poolId,
  isTerminated: result.isTerminated,
  terminationReason: result.terminationReason,
}));
```

---

## 5. Exit / back (tries + scoring)

If the user leaves **without** finishing, this try still counts toward `maxTries`. To keep scoring fair, **abandon** before closing.

```
POST /quiz/by-pool-session/{gamePoolSessionId}/abandon
```

(or `POST /quiz/sessions/{quizSessionId}/abandon`)

What the server does:

1. Skips every remaining unanswered question (`ABANDON`, 0 points)
2. Completes the quiz
3. Submits **current** score to the pool (same as finishing)
4. Returns the result payload

Then show the existing result screen (or close) and message the app `quizFinished`.

If HTML just kills the WebView with no abandon:

- The try is still consumed
- Score is **not** on the leaderboard until something completes the quiz
- The next `start-try` will auto-abandon the leftover try (score then submits), **and** start a **new** try

So: **always abandon on Exit/Back** if `!isCompleted && !isTerminated`.

Idempotent: abandoning an already finished quiz just returns the result.

---

## 6. App background (anti-cheat) — keep current overlay if you have one

The app calls:

```js
window.__16ARENA_QUIZ_ON_BACKGROUND__ && window.__16ARENA_QUIZ_ON_BACKGROUND__();
```

HTML:

```
POST /quiz/sessions/{quizSessionId}/violation
{ "questionId": "<live question id>", "violationType": "APP_BACKGROUND" }
```

Only while a question clock is running (after `begin-question`, before `answer`). If the clock has not started, the API warns and **does not** skip.

| `status` | Existing UI |
|----------|-------------|
| `WARNING` | First strike. If `questionSkipped`, treat as skip and show `nextQuestion` |
| `TERMINATED` | Second strike. Quiz over. Score still submitted. Result screen. `terminationReason`: `MULTIPLE_ANTI_CHEAT_VIOLATIONS` |

`maxViolations` is 2. Do not send other `violationType` values.

---

## 7. Scoring (display only — do not recompute)

After `begin-question`:

| Outcome | Points |
|---------|--------|
| Correct | `correctPoints + max(0, timer − elapsed)` |
| Wrong | `wrongPoints` (often 0) |
| Skip / timeout / anti-cheat / abandon | 0 |

Pool leaderboard uses **best try** per user. Each start-try is one try. HTML never writes the leaderboard.

`expiresAt` is the **pool try** deadline (try duration + buffer), not the question timer. If it passes before the quiz is completed/abandoned, the pool session expires and that try’s score cannot be submitted. Prefer finishing or abandoning before `expiresAt`.

---

## 8. Minimal state machine (drop into existing screens)

```js
let boot, session, question, answering;

async function start() {
  boot = await waitBootstrap();
  session = await api(`/quiz/by-pool-session/${boot.gamePoolSessionId}`);
  if (session.isCompleted || session.isTerminated) return finish();
  question = session.firstQuestion;
  await showQuestion();
}

async function showQuestion() {
  renderQuestion(question, session); // existing UI
  const begun = await api(`/quiz/sessions/${boot.quizSessionId}/begin-question`, {
    method: "POST",
    body: { questionId: question.id },
  });
  runLocalClock(begun.remainingSeconds); // display only
}

async function submit(selectedOption) {
  if (answering) return;
  answering = true;
  stopLocalClock();
  const result = await api("/quiz/answer", {
    method: "POST",
    body: {
      sessionId: boot.quizSessionId,
      questionId: question.id,
      selectedOption, // 1 | 2 | 3 | 0
      timeTakenSeconds: 0,
    },
  });
  session.score = result.score;
  showFeedback(result); // existing UI
  if (result.quizCompleted) return finish();
  await sleep((session.interQuestionCountdownSeconds || 0) * 1000);
  question = result.nextQuestion;
  session.currentQuestionNumber = (session.currentQuestionNumber || 1) + 1;
  answering = false;
  await showQuestion();
}

async function onExit() {
  if (session?.isCompleted || session?.isTerminated) return finish();
  await api(`/quiz/by-pool-session/${boot.gamePoolSessionId}/abandon`, { method: "POST" });
  return finish();
}

window.__16ARENA_QUIZ_ON_BACKGROUND__ = async () => {
  if (!question || answering) return;
  const v = await api(`/quiz/sessions/${boot.quizSessionId}/violation`, {
    method: "POST",
    body: { questionId: question.id, violationType: "APP_BACKGROUND" },
  });
  if (v.quizTerminated || v.quizCompleted) return finish();
  if (v.questionSkipped && v.nextQuestion) {
    stopLocalClock();
    question = v.nextQuestion;
    session.currentQuestionNumber = v.currentQuestionNumber;
    session.score = v.score;
    await sleep((session.interQuestionCountdownSeconds || 0) * 1000);
    await showQuestion();
  }
};

async function finish() {
  const result = await api(`/quiz/result/${boot.quizSessionId}`);
  renderResult(result); // existing UI
  QuizBridge.postMessage(JSON.stringify({
    type: result.isTerminated ? "quizTerminated" : "quizFinished",
    score: result.score,
    quizSessionId: result.sessionId,
    poolId: boot.poolId,
    isTerminated: result.isTerminated,
    terminationReason: result.terminationReason,
  }));
}

function waitBootstrap() {
  return new Promise((resolve) => {
    if (window.__16ARENA_QUIZ__) return resolve(window.__16ARENA_QUIZ__);
    window.addEventListener("16arena-quiz-ready", () => resolve(window.__16ARENA_QUIZ__), { once: true });
  });
}

// existing option buttons → submit(1|2|3)
// existing skip          → submit(0)
// existing local timer 0 → submit(0)
// existing exit/back     → onExit()
```

---

## 9. Errors the current UI should absorb

| Message | What to do |
|---------|------------|
| `Question timer has not started.` | Call `begin-question`, then allow taps |
| `Question is not currently active.` | `GET by-pool-session` and resync |
| `Question already answered.` | Ignore; resync |
| `Quiz has already been completed.` / `Quiz has been terminated.` | Result screen |
| `Quiz session not found.` | `error` to the app |
| `Session expired…` | Try window ended; tell the app, do not keep playing |

One in-flight answer/violation/abandon at a time.

---

## 10. HTML checklist

- [ ] Wait for `__16ARENA_QUIZ__` (do not start play on `DOMContentLoaded` alone)
- [ ] Boot with `GET /quiz/by-pool-session/{gamePoolSessionId}` every open
- [ ] Keep current question UI; fill it from `firstQuestion` / `nextQuestion`
- [ ] Call `begin-question` only when the question is **visible**
- [ ] UI timer from `remainingSeconds` only
- [ ] Submit `selectedOption` 1–3 or `0`; `timeTakenSeconds: 0`
- [ ] Show `score` / `pointsAwarded` / `correctOption` from the API
- [ ] Exit/Back → `abandon` if not finished
- [ ] Background → `violation` `APP_BACKGROUND`
- [ ] Complete / terminate / abandon → `GET /quiz/result` → message the app
- [ ] Never `POST /quiz/start`
- [ ] Never pool `start-try` or `submit-score`
- [ ] Never start a new try to “resume”
