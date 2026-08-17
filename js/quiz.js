/**
 * Quiz play loop — server-authoritative clock.
 *
 * The server owns the timer: POST begin-question starts it, and elapsed time is
 * derived from that call. The countdown drawn here is display only, and
 * timeTakenSeconds is always sent as 0 because the API ignores it.
 */
(function () {
    "use strict";

    var VERSION = "?v=20260814c";

    var els = {
        title: document.getElementById("title"),
        score: document.getElementById("runningScore"),
        scoreValue: document.querySelector("#runningScore .hud-value"),
        timer: document.getElementById("timer"),
        timerWrap: document.getElementById("timerWrap"),
        timerFill: document.getElementById("timerFill"),
        progress: document.getElementById("progress"),
        progressValue: document.querySelector("#progress .hud-value"),
        progressFill: document.getElementById("progressFill"),
        media: document.getElementById("questionMedia"),
        question: document.getElementById("question"),
        option1: document.getElementById("option1"),
        option2: document.getElementById("option2"),
        option3: document.getElementById("option3"),
        skip: document.getElementById("skipBtn"),
        status: document.getElementById("status"),
        banner: document.getElementById("feedbackBanner"),
        violation: document.getElementById("violationNotice"),
        overlay: document.getElementById("nextCountdownOverlay"),
        overlayLabel: document.getElementById("nextCountdownLabel"),
        overlayNumber: document.getElementById("nextCountdownNumber"),
        overlayHint: document.getElementById("nextCountdownHint")
    };

    var optionButtons = [els.option1, els.option2, els.option3];

    var state = {
        quizSessionId: null,
        gamePoolSessionId: null,
        poolMode: false,
        question: null,
        questionNumber: 1,
        totalQuestions: 0,
        score: 0,
        questionTimerSeconds: 15,
        interCountdownSeconds: 3,
        violationCount: 0,
        maxViolations: 2,
        busy: false,
        clockId: null,
        clockRunning: false,
        remaining: 0,
        finished: false
    };

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    /** API DTOs are camelCase; tolerate PascalCase in case a serializer differs. */
    function pick(obj, name) {
        if (!obj) return undefined;
        if (obj[name] !== undefined && obj[name] !== null) return obj[name];
        var pascal = name.charAt(0).toUpperCase() + name.slice(1);
        if (obj[pascal] !== undefined && obj[pascal] !== null) return obj[pascal];
        return undefined;
    }

    function wait(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function escapeAttr(value) {
        return String(value === undefined || value === null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function setStatus(message, color) {
        if (!message) {
            els.status.style.display = "none";
            els.status.innerText = "";
            return;
        }
        els.status.style.display = "block";
        els.status.style.color = color || "";
        els.status.innerText = message;
    }

    function setButtonsDisabled(disabled) {
        optionButtons.forEach(function (btn) { btn.disabled = disabled; });
        els.skip.disabled = disabled;
    }

    function clearOptionStyles() {
        optionButtons.forEach(function (btn) {
            btn.classList.remove("option-correct", "option-wrong");
            btn.classList.add("option-idle");
            if (btn.blur) btn.blur();
        });
    }

    function hideBanner() {
        els.banner.classList.remove("show", "correct", "incorrect", "neutral");
        els.banner.innerText = "";
    }

    function showBanner(kind, message) {
        els.banner.classList.remove("correct", "incorrect", "neutral");
        els.banner.classList.add(kind, "show");
        els.banner.innerText = message;
        setStatus("");
    }

    function formatPoints(points) {
        var n = Number(points) || 0;
        return n > 0 ? "+" + n : String(n);
    }

    function updateScore(value) {
        state.score = Number(value) || 0;
        els.scoreValue.innerText = String(state.score);
        els.score.classList.remove("score-pop");
        void els.score.offsetWidth;
        els.score.classList.add("score-pop");
    }

    function updateViolationNotice() {
        if (!els.violation) return;
        if (!state.violationCount) {
            els.violation.style.display = "none";
            els.violation.innerText = "";
            return;
        }
        els.violation.style.display = "block";
        els.violation.innerText =
            "Warning " + state.violationCount + " of " + state.maxViolations +
            " — leaving the app skips the question.";
    }

    // ------------------------------------------------------------------
    // rendering
    // ------------------------------------------------------------------

    function renderMedia(questionType, mediaUrl) {
        var type = String(questionType || "Text").trim().toLowerCase();
        var url = resolveMediaUrl(mediaUrl) || "";

        els.media.innerHTML = "";
        els.media.hidden = true;

        if (!url || type === "text") return;

        var safeUrl = escapeAttr(url);

        if (type === "image") {
            els.media.innerHTML = '<img src="' + safeUrl + '" alt="Question image" class="quiz-media-image">';
        } else if (type === "audio") {
            els.media.innerHTML = '<audio controls controlslist="nodownload noplaybackrate" src="' + safeUrl + '" class="quiz-media-audio">Your browser does not support audio.</audio>';
        } else if (type === "video") {
            els.media.innerHTML = '<video controls controlslist="nodownload noplaybackrate noremoteplayback" disablepictureinpicture src="' + safeUrl + '" class="quiz-media-video">Your browser does not support video.</video>';
        } else {
            return;
        }

        els.media.hidden = false;
    }

    function renderQuestion() {
        var q = state.question;
        if (!q) {
            setStatus("No question available.", "#dc2626");
            return;
        }

        clearOptionStyles();
        hideBanner();
        renderMedia(pick(q, "questionType"), pick(q, "mediaUrl"));

        els.question.innerText = pick(q, "questionText") || "";
        els.option1.innerText = pick(q, "option1") || "";
        els.option2.innerText = pick(q, "option2") || "";
        els.option3.innerText = pick(q, "option3") || "";

        els.progressValue.innerText = state.totalQuestions
            ? state.questionNumber + " / " + state.totalQuestions
            : String(state.questionNumber);

        if (state.totalQuestions > 0) {
            var pct = Math.min(100, (state.questionNumber / state.totalQuestions) * 100);
            els.progressFill.style.width = pct + "%";
        }

        setStatus("");
        updateViolationNotice();
    }

    // ------------------------------------------------------------------
    // display-only clock
    // ------------------------------------------------------------------

    function stopClock() {
        if (state.clockId) {
            clearInterval(state.clockId);
            state.clockId = null;
        }
        state.clockRunning = false;
    }

    function paintClock() {
        var secs = Math.max(0, state.remaining);
        var total = state.questionTimerSeconds || 1;

        els.timer.innerText = secs + "s";
        els.timerFill.style.transform = "scaleX(" + Math.max(0, Math.min(1, secs / total)) + ")";
        els.timerWrap.classList.toggle("critical", secs > 0 && secs <= 5);
    }

    function startClock(seconds) {
        stopClock();
        state.remaining = Math.max(0, Number(seconds) || 0);
        state.clockRunning = true;

        // Refill instantly, then let the per-second transition drain it —
        // otherwise the bar visibly animates backwards on each new question.
        els.timerFill.style.transition = "none";
        paintClock();
        void els.timerFill.offsetWidth;
        els.timerFill.style.transition = "";

        state.clockId = setInterval(function () {
            state.remaining -= 1;
            paintClock();
            if (state.remaining <= 0) {
                stopClock();
                // The server may still record this as TIMEOUT via its own clock.
                submitAnswer(0);
            }
        }, 1000);
    }

    async function runInterQuestionCountdown(nextNumber) {
        var seconds = Math.max(0, Number(state.interCountdownSeconds) || 0);
        if (seconds <= 0) return;

        if (els.overlayHint) els.overlayHint.style.display = "none";
        els.overlayLabel.innerText = "Question " + nextNumber + " loading in";
        els.overlay.style.display = "flex";

        for (var n = seconds; n >= 1; n--) {
            els.overlayNumber.innerText = String(n);
            els.overlayNumber.classList.remove("countdown-pop");
            void els.overlayNumber.offsetWidth;
            els.overlayNumber.classList.add("countdown-pop");
            await wait(1000);
        }

        els.overlay.style.display = "none";
    }

    // ------------------------------------------------------------------
    // session load / resync
    // ------------------------------------------------------------------

    async function fetchPoolSession() {
        return apiGet("/api/v1/quiz/by-pool-session/" + encodeURIComponent(state.gamePoolSessionId));
    }

    function applySession(data) {
        state.quizSessionId = pick(data, "sessionId");
        state.totalQuestions = Number(pick(data, "totalQuestions")) || 0;

        var timer = Number(pick(data, "questionTimerSeconds") || pick(data, "durationSeconds"));
        if (timer > 0) state.questionTimerSeconds = timer;

        var inter = pick(data, "interQuestionCountdownSeconds");
        if (inter !== undefined) state.interCountdownSeconds = Math.max(0, Number(inter) || 0);

        state.questionNumber = Number(pick(data, "currentQuestionNumber")) || 1;
        state.violationCount = Number(pick(data, "violationCount")) || 0;
        state.question = pick(data, "firstQuestion") || pick(data, "currentQuestion") || null;

        var title = pick(data, "title");
        if (title) els.title.innerText = title;

        updateScore(pick(data, "score") || 0);
        updateViolationNotice();

        return {
            completed: !!pick(data, "isCompleted"),
            terminated: !!pick(data, "isTerminated")
        };
    }

    /** Recover from a stale questionId or an unexpected server state. */
    async function resync(reason) {
        stopClock();

        if (!state.gamePoolSessionId) {
            fail(reason || "Lost track of this question. Close and start again.");
            return false;
        }

        try {
            var data = await fetchPoolSession();
            var flags = applySession(data);

            if (flags.completed || flags.terminated) {
                await finish(flags.terminated);
                return false;
            }

            renderQuestion();
            await beginQuestion();
            return true;
        } catch (err) {
            fail(err.message || "Unable to resynchronise with the quiz.");
            return false;
        }
    }

    // ------------------------------------------------------------------
    // play loop
    // ------------------------------------------------------------------

    async function beginQuestion() {
        var q = state.question;
        if (!q || !state.quizSessionId) return false;

        var questionId = pick(q, "id");

        try {
            // Idempotent: on resume this returns the remaining time, not a fresh clock.
            var begun = await apiSend(
                "/api/v1/quiz/sessions/" + encodeURIComponent(state.quizSessionId) + "/begin-question",
                "POST",
                { questionId: questionId }
            );

            var remaining = Number(pick(begun, "remainingSeconds"));
            var full = Number(pick(begun, "questionTimerSeconds"));
            if (full > 0) state.questionTimerSeconds = full;

            setButtonsDisabled(false);
            state.busy = false;
            startClock(remaining >= 0 ? remaining : state.questionTimerSeconds);
            return true;
        } catch (err) {
            if (/not currently active|already answered/i.test(err.message || "")) {
                return resync();
            }
            setStatus(err.message || "Unable to start this question.", "#dc2626");
            setButtonsDisabled(false);
            state.busy = false;
            return false;
        }
    }

    async function showQuestion() {
        renderQuestion();
        await beginQuestion();
    }

    function describeSkip(skipReason) {
        if (skipReason === "ANTI_CHEAT") return "Question skipped — you left the app";
        if (skipReason === "TIMEOUT") return "Time up — correct answer highlighted";
        if (skipReason === "USER") return "Skipped — correct answer highlighted";
        return "Correct answer highlighted";
    }

    function showFeedback(result, selectedOption) {
        var isCorrect = !!pick(result, "isCorrect");
        var correctOption = Number(pick(result, "correctOption")) || 0;
        var pointsAwarded = Number(pick(result, "pointsAwarded")) || 0;
        var bonusAwarded = Number(pick(result, "bonusAwarded")) || 0;
        var skipReason = pick(result, "skipReason") || null;

        clearOptionStyles();

        if (correctOption >= 1 && correctOption <= 3) {
            optionButtons[correctOption - 1].classList.add("option-correct");
        }

        // A tap can still be forced to a timeout skip by the server clock.
        if (skipReason) {
            showBanner(skipReason === "ANTI_CHEAT" ? "incorrect" : "neutral", describeSkip(skipReason));
            return;
        }

        if (selectedOption >= 1 && selectedOption <= 3 && !isCorrect) {
            optionButtons[selectedOption - 1].classList.add("option-wrong");
        }

        if (isCorrect) {
            var base = pointsAwarded - bonusAwarded;
            var msg = "Hooray! Correct answer " + formatPoints(base) + " points";
            if (bonusAwarded > 0) msg += " " + formatPoints(bonusAwarded) + " bonus";
            showBanner("correct", msg);
        } else {
            showBanner("incorrect", "Oops, wrong answer, " + formatPoints(pointsAwarded) + " points");
        }
    }

    async function advanceTo(nextQuestion, nextNumber) {
        hideBanner();
        await runInterQuestionCountdown(nextNumber);
        state.question = nextQuestion;
        state.questionNumber = nextNumber;
        await showQuestion();
    }

    async function submitAnswer(selectedOption) {
        if (state.busy || state.finished) return;
        state.busy = true;
        stopClock();
        setButtonsDisabled(true);
        setStatus("");

        var q = state.question;

        try {
            var result = await apiSend("/api/v1/quiz/answer", "POST", {
                sessionId: state.quizSessionId,
                questionId: pick(q, "id"),
                selectedOption: selectedOption,
                timeTakenSeconds: 0
            });

            updateScore(pick(result, "score"));
            showFeedback(result, selectedOption);

            await wait(selectedOption > 0 ? 1600 : 1400);

            if (pick(result, "quizCompleted")) {
                await finish(false);
                return;
            }

            var next = pick(result, "nextQuestion");
            if (!next) {
                await resync();
                return;
            }

            await advanceTo(next, state.questionNumber + 1);
        } catch (err) {
            console.error(err);
            hideBanner();
            await handlePlayError(err);
        }
    }

    async function handlePlayError(err) {
        var message = err.message || "Network error";

        if (/already been completed|has been terminated/i.test(message)) {
            await finish(/terminated/i.test(message));
            return;
        }

        if (/timer has not started/i.test(message)) {
            state.busy = false;
            await beginQuestion();
            return;
        }

        if (/not currently active|already answered/i.test(message)) {
            state.busy = false;
            await resync();
            return;
        }

        // Recoverable (network/5xx): let the player retry on the same question.
        setStatus(message, "#dc2626");
        setButtonsDisabled(false);
        state.busy = false;
    }

    // ------------------------------------------------------------------
    // anti-cheat — the app tells us it backgrounded; we never guess
    // ------------------------------------------------------------------

    async function reportBackground() {
        if (state.finished || state.busy) return;
        if (!state.quizSessionId || !state.question) return;
        if (!state.clockRunning) return; // no live clock -> server would not skip anyway

        state.busy = true;
        stopClock();
        setButtonsDisabled(true);

        try {
            var v = await apiSend(
                "/api/v1/quiz/sessions/" + encodeURIComponent(state.quizSessionId) + "/violation",
                "POST",
                { questionId: pick(state.question, "id"), violationType: "APP_BACKGROUND" }
            );

            state.violationCount = Number(pick(v, "violationCount")) || state.violationCount;
            state.maxViolations = Number(pick(v, "maxViolations")) || state.maxViolations;
            updateScore(pick(v, "score"));
            updateViolationNotice();

            if (pick(v, "quizTerminated")) {
                showBanner("incorrect", "Quiz ended — too many app switches");
                await wait(1400);
                await finish(true);
                return;
            }

            if (pick(v, "questionSkipped")) {
                showBanner("incorrect", "Question skipped — you left the app");
                await wait(1400);

                var next = pick(v, "nextQuestion");
                if (!next) {
                    state.busy = false;
                    await resync();
                    return;
                }

                var nextNumber = Number(pick(v, "currentQuestionNumber")) || state.questionNumber + 1;
                await advanceTo(next, nextNumber);
                return;
            }

            // Warning only, clock was not running server-side — resume this question.
            state.busy = false;
            await beginQuestion();
        } catch (err) {
            console.error(err);
            state.busy = false;
            await handlePlayError(err);
        }
    }

    // ------------------------------------------------------------------
    // finish
    // ------------------------------------------------------------------

    async function finish(terminated) {
        if (state.finished) return;
        state.finished = true;

        stopClock();
        setButtonsDisabled(true);
        els.overlay.style.display = "none";

        try {
            localStorage.setItem("resultSession", state.quizSessionId || "");
            localStorage.setItem("resultScore", String(state.score));
            localStorage.setItem("resultTerminated", terminated ? "1" : "0");
            localStorage.removeItem("quiz");
            localStorage.removeItem("quizQuestionNumber");
            localStorage.removeItem("quizRunningScore");
            localStorage.removeItem("quizStartTime");
        } catch (e) { /* ignore */ }

        window.location.href = "result.html" + VERSION;
    }

    function fail(message) {
        stopClock();
        setButtonsDisabled(true);
        setStatus(message, "#dc2626");

        if (window.ArenaBridge) {
            window.ArenaBridge.notifyHost("error", { message: message });
        }
    }

    // ------------------------------------------------------------------
    // boot
    // ------------------------------------------------------------------

    async function boot() {
        setButtonsDisabled(true);
        setStatus("Loading quiz…");

        var snap = window.ArenaBridge ? window.ArenaBridge.refresh() : {};
        refreshApiBaseFromSession();

        state.poolMode = !!(window.ArenaBridge && window.ArenaBridge.isPoolMode());

        if (state.poolMode) {
            try {
                snap = await window.ArenaBridge.waitForSession({ requirePool: true, timeoutMs: 8000 });
            } catch (err) {
                fail(err.message);
                return;
            }
            refreshApiBaseFromSession();
            state.gamePoolSessionId = snap.gamePoolSessionId;
        }

        if (!localStorage.getItem("token")) {
            fail("Not signed in. Close the game and start again.");
            return;
        }

        var data = null;

        if (state.poolMode) {
            // Always resolve from the API: the app injects no quiz payload, and a
            // reopened WebView must resume the live question, not a cached one.
            try {
                data = await fetchPoolSession();
            } catch (err) {
                fail(err.message || "Quiz session not found for this try. Close and start again.");
                return;
            }
        } else {
            try {
                data = JSON.parse(localStorage.getItem("quiz") || "null");
            } catch (e) {
                data = null;
            }
            if (!data) {
                alert("No quiz found. Start from Categories.");
                window.location.href = "categories.html" + VERSION;
                return;
            }
        }

        var flags = applySession(data);

        if (!state.quizSessionId) {
            fail("Quiz session id missing from the API response.");
            return;
        }

        if (flags.completed || flags.terminated) {
            await finish(flags.terminated);
            return;
        }

        if (!state.question) {
            fail("No live question in this quiz session.");
            return;
        }

        setStatus("");
        await showQuestion();
    }

    // ------------------------------------------------------------------
    // wiring
    // ------------------------------------------------------------------

    els.option1.onclick = function () { submitAnswer(1); };
    els.option2.onclick = function () { submitAnswer(2); };
    els.option3.onclick = function () { submitAnswer(3); };
    els.skip.onclick = function () { submitAnswer(0); };

    optionButtons.forEach(function (btn) {
        btn.addEventListener("pointerleave", function () {
            btn.classList.remove("option-idle");
        });
    });

    if (window.ArenaBridge) {
        window.ArenaBridge.onBackground(reportBackground);
    }

    boot();
})();
