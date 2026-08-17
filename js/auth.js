function isArenaAppWebView() {
    if (window.ArenaFlutterSession && window.ArenaFlutterSession.wantsStandaloneLogin()) {
        return false;
    }
    if (window.ArenaBridge && window.ArenaBridge.isEmbedded && window.ArenaBridge.isEmbedded()) {
        return true;
    }
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
        btn.innerText = "Start quiz";
    }
    const exitBtn = document.getElementById("playExitBtn");
    if (exitBtn) {
        exitBtn.style.display =
            isPoolPlayMode() || isArenaAppWebView() ? "" : "none";
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
    const snap = getArenaSnapshot();
    let fromStore = 0;
    try {
        fromStore = parseInt(localStorage.getItem("arenaTryDuration"), 10) || 0;
    } catch (e) {
        /* ignore */
    }
    return Number(snap.tryDurationSeconds) || fromStore || 0;
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
    const snap = getArenaSnapshot();
    const poolSessionId =
        snap.gamePoolSessionId || localStorage.getItem("arenaPoolSessionId");

    let quizData = null;
    if (poolSessionId) {
        quizData = await apiGet(`/api/v1/quiz/by-pool-session/${poolSessionId}`);
    }
    if (!quizData) quizData = snap.quizPayload;

    if (!quizData) return { title: "Quiz" };

    window.__POOL_QUIZ_PREFETCH__ = quizData;

    if (isQuizOver(quizData)) {
        goToResultPage(
            pickQuizField(quizData, ["sessionId", "SessionId"]),
            pickQuizField(quizData, ["score", "Score"]) ?? 0,
            isQuizTerminated(quizData)
        );
        return null;
    }

    if (isQuizResume(quizData)) {
        await enterPoolQuizPlay({ skipCountdown: true });
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
        const snap = getArenaSnapshot();
        if (snap.authToken) {
            localStorage.setItem("token", snap.authToken);
        }

        await enterPoolQuizPlay({
            skipCountdown: isQuizResume(window.__POOL_QUIZ_PREFETCH__),
        });
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
            btn.innerText = "Start quiz";
        }
        introStartInFlight = false;
        if (isFatalQuizError(e.message)) {
            if (btn) btn.disabled = true;
            if (window.ArenaBridge) {
                window.ArenaBridge.notifyHost("error", {
                    message: e.message || "Unable to start quiz.",
                });
            }
            return;
        }
        startIntroBufferFromSession();
    }
}

function bindPoolExit() {
    if (!window.ArenaBridge || !window.ArenaBridge.onExit) return;
    window.ArenaBridge.onExit(onPoolPlayExit);
}

async function onPoolPlayExit() {
    if (introStartInFlight) return;
    introStartInFlight = true;
    stopIntroBufferTimer();

    const snap = getArenaSnapshot();
    const quiz = window.__POOL_QUIZ_PREFETCH__;
    if (isQuizOver(quiz)) {
        if (window.ArenaBridge) window.ArenaBridge.closeGame();
        return;
    }

    try {
        if (snap.gamePoolSessionId) {
            const result = await abandonPoolTry(snap.gamePoolSessionId);
            goToResultPage(
                pickQuizField(result, ["sessionId", "SessionId"]) ||
                    snap.quizSessionId,
                pickQuizField(result, ["score", "Score"]) ?? 0,
                false
            );
            return;
        }
    } catch (e) {
        console.error(e);
        if (window.ArenaBridge) {
            window.ArenaBridge.notifyHost("error", {
                message: e.message || "Unable to abandon this try.",
            });
        }
    }

    if (window.ArenaBridge) window.ArenaBridge.closeGame();
}

async function continueWithSession(snap) {
    refreshApiBaseFromSession();

    const token = snap.authToken || snap.token;
    if (token) {
        localStorage.setItem("token", token);
    }

    const hasPool =
        snap.poolMode ||
        !!(snap.gamePoolSessionId && token) ||
        !!(snap.sessionId && token);

    if (hasPool) {
        bindPoolExit();
        if (window.ArenaBridge && window.ArenaBridge.isExpired && window.ArenaBridge.isExpired()) {
            const message = "Session expired. This try can no longer be scored.";
            if (window.ArenaBridge.notifyHost) {
                window.ArenaBridge.notifyHost("error", { message: message });
            }
            showPlayReadyUi({ title: "Quiz" });
            const err = document.getElementById("playReadyError");
            if (err) {
                err.style.display = "block";
                err.innerText = message;
            }
            const btn = document.getElementById("playStartBtn");
            if (btn) btn.disabled = true;
            return;
        }

        setBootUi("Preparing quiz…");
        try {
            const info = await prefetchPoolQuizInfo();
            if (info === null) return;
            showPlayReadyUi(info);
        } catch (e) {
            console.error(e);
            if (isFatalQuizError(e.message) && window.ArenaBridge) {
                window.ArenaBridge.notifyHost("error", {
                    message: e.message || "Quiz session not found.",
                });
            }
            showPlayReadyUi({ title: "Quiz" });
            const err = document.getElementById("playReadyError");
            if (err) {
                err.style.display = "block";
                err.innerText =
                    e.message || "Could not load quiz details. Tap Start to retry.";
            }
            if (isFatalQuizError(e.message)) {
                const btn = document.getElementById("playStartBtn");
                if (btn) btn.disabled = true;
            }
        }
        return;
    }

    if (token || localStorage.getItem("token")) {
        window.location.href = "categories.html";
    }
}

/**
 * Default path = Arena WebView: wait for __16ARENA_QUIZ__, never flash login.
 * Standalone browser login only with ?standalone=1.
 */
async function bootstrapFromArena() {
    const flutter = window.ArenaFlutterSession;
    if (flutter) flutter.init();
    if (window.ArenaBridge) window.ArenaBridge.refresh();
    refreshApiBaseFromSession();

    if (flutter && flutter.wantsStandaloneLogin()) {
        if (localStorage.getItem("token")) {
            window.location.href = "categories.html";
            return;
        }
        showLoginUi();
        return;
    }

    const inArena = isArenaAppWebView();

    if (!inArena) {
        if (localStorage.getItem("token")) {
            window.location.href = "categories.html";
            return;
        }
        showLoginUi();
        return;
    }

    setBootUi("Connecting to Arena session…");

    try {
        const snap = window.ArenaBridge
            ? await window.ArenaBridge.waitForSession({
                requirePool: true,
                allowStored: false,
                timeoutMs: 20000,
            })
            : await flutter.waitForSession({ requirePool: true });
        await continueWithSession(snap);
    } catch (err) {
        console.error(err);
        bindPoolExit();
        showPlayReadyUi({ title: "Quiz" });
        const errEl = document.getElementById("playReadyError");
        if (errEl) {
            errEl.style.display = "block";
            errEl.innerText =
                err.message || "Waiting for Arena session… Close and try again.";
        }
        const btn = document.getElementById("playStartBtn");
        if (btn) btn.disabled = true;
        if (window.ArenaBridge) {
            window.ArenaBridge.notifyHost("error", {
                message: err.message || "No Arena session was injected.",
            });
        }
    }
}

bootstrapFromArena();
