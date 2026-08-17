function isArenaAppWebView() {
    const flutter = window.ArenaFlutterSession;
    return !!(
        flutter &&
        flutter.isArenaWebView &&
        flutter.isArenaWebView() &&
        !flutter.wantsStandaloneLogin()
    );
}

function setBootUi(message) {
    const boot = document.getElementById("arenaBoot");
    const form = document.getElementById("authForm");
    const play = document.getElementById("playReady");
    const standaloneLink = document.getElementById("standaloneLoginLink");
    if (boot) {
        boot.style.display = "block";
        const msg = document.getElementById("arenaBootMsg");
        if (msg) msg.innerText = message || "Connecting to Arena…";
        else boot.innerText = message || "Connecting to Arena…";
    }
    if (form) form.style.display = "none";
    if (play) play.style.display = "none";
    stopIntroBufferTimer();
    // Never show browser-only standalone link inside the Arena app WebView.
    if (standaloneLink) {
        standaloneLink.style.display = isArenaAppWebView() ? "none" : "block";
    }
}

function showLoginUi() {
    const boot = document.getElementById("arenaBoot");
    const form = document.getElementById("authForm");
    const play = document.getElementById("playReady");
    const standaloneLink = document.getElementById("standaloneLoginLink");
    if (boot) boot.style.display = "none";
    if (play) play.style.display = "none";
    stopIntroBufferTimer();
    if (form) form.style.display = "block";
    if (standaloneLink) standaloneLink.style.display = "none";
}

async function submitAuth() {
    await login();
}

function storeSession(data) {
    const token = data?.accessToken || data?.AccessToken;
    if (!token) {
        throw new Error("No access token in response");
    }
    localStorage.setItem("token", token);
    if (data?.user?.displayName) {
        localStorage.setItem("displayName", data.user.displayName);
    }
}

async function login() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email) {
        alert("Email is required.");
        return;
    }
    if (!password || password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    try {
        const data = await apiSend("/api/v1/auth/password-login", "POST", {
            email,
            password,
            appId: APP_ID,
        });
        storeSession(data);
        window.location.href = "categories.html";
    } catch (err) {
        console.error(err);
        alert(err.message || "Invalid email or password");
    }
}

function showPlayReadyUi(info) {
    const boot = document.getElementById("arenaBoot");
    const form = document.getElementById("authForm");
    const play = document.getElementById("playReady");
    const err = document.getElementById("playReadyError");
    const btn = document.getElementById("playStartBtn");
    if (boot) boot.style.display = "none";
    if (form) form.style.display = "none";
    if (play) play.style.display = "block";
    if (err) {
        err.style.display = "none";
        err.innerText = "";
    }
    if (btn) {
        btn.disabled = false;
        btn.innerText = "Start";
    }

    const titleEl = document.getElementById("playReadyTitle");
    const scoringEl = document.getElementById("playReadyScoring");
    const rulesBlock = document.getElementById("playReadyRulesBlock");
    const rulesEl = document.getElementById("playReadyRules");
    if (titleEl) titleEl.innerText = "Welcome to " + ((info && info.title) || "Quiz");
    const rules = String((info && (info.RulesText || info.rulesText)) || "").trim();
    if (rulesBlock && rulesEl) {
        if (rules) {
            rulesEl.innerText = rules;
            rulesBlock.style.display = "block";
        } else {
            rulesEl.innerText = "";
            rulesBlock.style.display = "none";
        }
    }
    if (scoringEl) {
        const questions = Number(info && info.totalQuestions) || 0;
        const correct = Number(info && info.correctPoints) || 0;
        const wrong = Math.abs(Number(info && info.wrongPoints) || 0);
        const seconds = Number(info && info.timerSeconds) || 0;
        const qWord = questions === 1 ? "question" : "questions";
        const sWord = seconds === 1 ? "second" : "seconds";
        scoringEl.innerText = [
            questions + " " + qWord + " per quiz.",
            "+" + correct + " points for every correct answer.",
            "-" + wrong + " for every wrong answer.",
            "You have " + seconds + " " + sWord + " per question. Answer fast, leftover seconds convert straight into bonus points."
        ].join("\n");
    }

    introStartInFlight = false;
    startIntroBufferFromSession();
}

function pickQuizField(obj, names) {
    if (!obj) return undefined;
    for (let i = 0; i < names.length; i++) {
        const value = obj[names[i]];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
}

const QUIZ_START_COUNTDOWN_SECONDS = 5;
let introBufferTimerId = null;
let introStartInFlight = false;

function quizPlayDurationSecondsFromQuiz(quiz) {
    if (!quiz) return 0;
    const questions = Number(
        pickQuizField(quiz, [
            "questionCount",
            "QuestionCount",
            "totalQuestions",
            "TotalQuestions"
        ])
    ) || 0;
    if (questions < 1) return 0;
    const perQuestion = Math.max(
        1,
        Number(
            pickQuizField(quiz, [
                "questionTimerSeconds",
                "QuestionTimerSeconds",
                "durationSeconds",
                "DurationSeconds"
            ])
        ) || 1
    );
    const between = Math.max(
        0,
        Number(
            pickQuizField(quiz, [
                "interQuestionCountdownSeconds",
                "InterQuestionCountdownSeconds"
            ])
        ) || 0
    );
    return (
        QUIZ_START_COUNTDOWN_SECONDS +
        questions * perQuestion +
        Math.max(0, questions - 1) * between
    );
}

function resolveTryDurationSeconds() {
    const flutter =
        window.ArenaFlutterSession && window.ArenaFlutterSession.get
            ? window.ArenaFlutterSession.get()
            : {};
    const bridge =
        window.ArenaBridge && window.ArenaBridge.get
            ? window.ArenaBridge.get()
            : {};
    const fromFlutter = Number(flutter.gameTimerDuration) || 0;
    const fromBridge = Number(bridge.tryDurationSeconds) || 0;
    let fromStore = 0;
    try {
        fromStore = parseInt(localStorage.getItem("arenaTryDuration"), 10) || 0;
    } catch (e) {
        /* ignore */
    }
    return fromFlutter || fromBridge || fromStore || 0;
}

function stopIntroBufferTimer() {
    if (introBufferTimerId) {
        clearInterval(introBufferTimerId);
        introBufferTimerId = null;
    }
}

function startIntroBufferTimer(seconds) {
    stopIntroBufferTimer();
    const wrap = document.getElementById("playReadyBuffer");
    const timeEl = document.getElementById("playReadyBufferTime");
    const count = Math.max(0, Math.floor(Number(seconds) || 0));
    if (!wrap || !timeEl || count <= 0) {
        if (wrap) wrap.style.display = "none";
        return;
    }

    let remaining = count;
    wrap.style.display = "block";
    timeEl.innerText = remaining + "s";
    introBufferTimerId = setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
            stopIntroBufferTimer();
            timeEl.innerText = "0s";
            if (!introStartInFlight) onPoolPlayStart();
            return;
        }
        timeEl.innerText = remaining + "s";
    }, 1000);
}

function startIntroBufferFromSession() {
    const tryDuration = resolveTryDurationSeconds();
    const play = quizPlayDurationSecondsFromQuiz(window.__POOL_QUIZ_PREFETCH__);
    const buffer =
        tryDuration > 0 && play > 0 ? Math.max(0, tryDuration - play) : 0;
    startIntroBufferTimer(buffer);
}

function playReadyInfoFromSession(quizData) {
    return {
        title: pickQuizField(quizData, ["title", "Title"]) || "Quiz",
        totalQuestions:
            Number(
                pickQuizField(quizData, [
                    "totalQuestions",
                    "TotalQuestions",
                    "questionCount",
                    "QuestionCount"
                ])
            ) || 0,
        correctPoints: pickQuizField(quizData, ["correctPoints", "CorrectPoints"]) ?? 0,
        wrongPoints: pickQuizField(quizData, ["wrongPoints", "WrongPoints"]) ?? 0,
        timerSeconds:
            Number(
                pickQuizField(quizData, [
                    "questionTimerSeconds",
                    "QuestionTimerSeconds",
                    "durationSeconds",
                    "DurationSeconds"
                ])
            ) || 0,
        rulesText: String(
            pickQuizField(quizData, ["RulesText", "rulesText"]) || ""
        ).trim()
    };
}

async function prefetchPoolQuizInfo() {
    refreshApiBaseFromSession();
    const snap = window.ArenaFlutterSession
        ? window.ArenaFlutterSession.get()
        : {};
    const poolSessionId =
        snap.sessionId || localStorage.getItem("arenaPoolSessionId");

    let quizData = null;
    if (poolSessionId) {
        quizData = await apiGet(`/api/v1/quiz/by-pool-session/${poolSessionId}`);
    }
    if (!quizData) quizData = snap.quizPayload;

    if (!quizData) return { title: "Quiz" };

    window.__POOL_QUIZ_PREFETCH__ = quizData;

    if (quizData.isCompleted || quizData.IsCompleted) {
        const sid = quizData.sessionId || quizData.SessionId;
        localStorage.setItem("resultSession", sid);
        localStorage.setItem(
            "resultScore",
            String(quizData.score ?? quizData.Score ?? 0)
        );
        window.location.href = "result.html?v=20260814c";
        return null;
    }

    return playReadyInfoFromSession(quizData);
}

async function runStartPageCountdown(seconds = 5) {
    const overlay = document.getElementById("startCountdownOverlay");
    const numberEl = document.getElementById("startCountdownNumber");
    if (!overlay || !numberEl) return;

    const countdownSeconds = Math.max(1, Number(seconds) || 5);
    overlay.style.display = "flex";

    for (let n = countdownSeconds; n >= 1; n--) {
        numberEl.innerText = String(n);
        numberEl.classList.remove("countdown-pop");
        void numberEl.offsetWidth;
        numberEl.classList.add("countdown-pop");
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    numberEl.innerText = "Go!";
    await new Promise((resolve) => setTimeout(resolve, 400));
}

window.runStartPageCountdown = runStartPageCountdown;

async function onPoolPlayStart() {
    if (introStartInFlight) return;
    introStartInFlight = true;
    stopIntroBufferTimer();

    const btn = document.getElementById("playStartBtn");
    const err = document.getElementById("playReadyError");
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Starting…";
    }
    if (err) {
        err.style.display = "none";
        err.innerText = "";
    }

    try {
        const snap = window.ArenaFlutterSession
            ? window.ArenaFlutterSession.get()
            : {};
        if (snap.authToken) {
            localStorage.setItem("token", snap.authToken);
        }

        let quizData = window.__POOL_QUIZ_PREFETCH__;
        if (!quizData) {
            await enterPoolQuizPlay();
            return;
        }

        if (quizData.isCompleted || quizData.IsCompleted) {
            const sid = quizData.sessionId || quizData.SessionId;
            localStorage.setItem("resultSession", sid);
            localStorage.setItem(
                "resultScore",
                String(quizData.score ?? quizData.Score ?? 0)
            );
            window.location.href = "result.html?v=20260814c";
            return;
        }

        const poolSessionId =
            snap.sessionId || localStorage.getItem("arenaPoolSessionId");

        if (window.ArenaFlutterSession) {
            window.ArenaFlutterSession.storeQuizPlayState(quizData, {
                poolMode: true,
                poolId: snap.poolId || localStorage.getItem("arenaPoolId"),
                poolSessionId: poolSessionId,
                questionNumber:
                    quizData.currentQuestionNumber ||
                    quizData.CurrentQuestionNumber ||
                    1,
                score: quizData.score || quizData.Score || 0,
            });
        } else {
            localStorage.setItem("quiz", JSON.stringify(quizData));
        }

        await runStartPageCountdown(5);
        window.location.href = "quiz.html?v=20260814c";
    } catch (e) {
        console.error(e);
        window.__POOL_QUIZ_PREFETCH__ = null;
        const overlay = document.getElementById("startCountdownOverlay");
        if (overlay) overlay.style.display = "none";
        if (err) {
            err.style.display = "block";
            err.innerText = e.message || "Unable to start quiz.";
        }
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Start";
        }
        introStartInFlight = false;
        startIntroBufferFromSession();
    }
}

async function continueWithSession(snap) {
    refreshApiBaseFromSession();

    if (snap.authToken) {
        localStorage.setItem("token", snap.authToken);
    }

    const hasPool =
        snap.poolMode ||
        !!(snap.sessionId && snap.authToken);

    if (hasPool) {
        setBootUi("Preparing quiz…");
        try {
            const info = await prefetchPoolQuizInfo();
            if (info === null) return;
            showPlayReadyUi(info);
        } catch (e) {
            console.error(e);
            // Always land on Start screen — never leave users stuck on boot/"Not Found".
            showPlayReadyUi({ title: "Quiz" });
            const err = document.getElementById("playReadyError");
            if (err) {
                err.style.display = "block";
                err.innerText =
                    e.message || "Could not load quiz details. Tap Start to retry.";
            }
        }
        return;
    }

    if (snap.authToken || localStorage.getItem("token")) {
        window.location.href = "categories.html";
    }
}

/**
 * Default path = Arena WebView (like 2048): wait for injected session, never flash login.
 * Standalone browser login only with ?standalone=1.
 */
async function bootstrapFromArena() {
    const flutter = window.ArenaFlutterSession;
    if (!flutter) {
        showLoginUi();
        return;
    }

    flutter.init();
    refreshApiBaseFromSession();

    if (flutter.wantsStandaloneLogin()) {
        if (localStorage.getItem("token")) {
            window.location.href = "categories.html";
            return;
        }
        showLoginUi();
        return;
    }

    const inArena = isArenaAppWebView();

    // Drop stale try id so we don't call by-pool-session with a previous attempt.
    if (inArena) {
        try {
            localStorage.removeItem("arenaPoolSessionId");
        } catch (e) { /* ignore */ }
    }

    // Connecting UI first (hides login). Flutter injects AFTER page load.
    setBootUi("Connecting to Arena session…");

    try {
        // In the app WebView, wait for the live pool try (sessionId + poolId + token).
        const snap = await flutter.waitForSession({
            requirePool: inArena,
        });
        await continueWithSession(snap);
    } catch (err) {
        console.error(err);
        if (inArena) {
            showPlayReadyUi({ title: "Quiz" });
            const errEl = document.getElementById("playReadyError");
            if (errEl) {
                errEl.style.display = "block";
                errEl.innerText =
                    err.message || "Waiting for Arena session… Close and try again.";
            }
            return;
        }
        setBootUi(err.message || "Waiting for Arena session…");
    }
}

bootstrapFromArena();
