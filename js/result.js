window.onload = loadResult;

function setSubmitStatus(message, kind) {
    const el = document.getElementById("submitStatus");
    if (!el) return;
    el.classList.remove("submitting", "complete");
    if (!message) {
        el.style.display = "none";
        el.innerText = "";
        return;
    }
    el.style.display = "block";
    el.innerText = message;
    if (kind) el.classList.add(kind);
}

function setBackVisible(visible) {
    const btn = document.getElementById("backBtn");
    if (!btn) return;
    btn.style.display = visible ? "" : "none";
    btn.disabled = !visible;
}

function renderResult(data) {
    document.getElementById("score").innerText = `Score : ${data.score}`;

    document.getElementById("correct").innerText =
        `Correct Answers : ${data.correctAnswers}`;

    document.getElementById("wrong").innerText =
        `Wrong Answers : ${data.wrongAnswers}`;

    document.getElementById("skipped").innerText =
        `Skipped Questions : ${data.skippedAnswers ?? 0}`;

    const bonusPoints = Number(data.bonusPoints ?? 0);
    const bonusAnswers = Number(data.bonusAnswers ?? 0);
    document.getElementById("bonus").innerText =
        bonusPoints > 0
            ? `Bonus Points : +${bonusPoints} (from ${bonusAnswers} fast correct answer${bonusAnswers === 1 ? "" : "s"})`
            : `Bonus Points : 0`;

    document.getElementById("percentage").innerText =
        `Percentage : ${data.percentage}%`;

    const rank = data.rank;
    const total = data.totalCompletions ?? 0;
    document.getElementById("rank").innerText = rank
        ? `Rank : #${rank} of ${total}`
        : `Rank : -`;

    const durationSeconds = Number(data.durationSeconds ?? 0);
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    const durationLabel =
        mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
    document.getElementById("duration").innerText = `Time Taken : ${durationLabel}`;
}

async function submitArenaFinalScore(score, timeTaken) {
    const flutter = window.ArenaFlutterSession;
    if (!flutter || !flutter.submitScoreToFlutter) {
        return;
    }

    const title = document.getElementById("gameOverTitle");
    if (title) title.innerText = "GAME OVER";

    setSubmitStatus("Submitting score…", "submitting");
    setBackVisible(false);

    try {
        const snap = flutter.get ? flutter.get() : {};
        const hasPoolFields = !!(
            (snap.poolId && snap.sessionId && snap.authToken) ||
            (localStorage.getItem("arenaPoolId") &&
                localStorage.getItem("arenaPoolSessionId") &&
                localStorage.getItem("token"))
        );
        if (!hasPoolFields && flutter.waitForSession) {
            await flutter.waitForSession({
                requirePool: true,
                timeoutMs: 6000,
            }).catch(function () { /* submit with whatever is available */ });
        }
    } catch (e) { /* ignore */ }

    await flutter.submitScoreToFlutter(score, timeTaken);
    setSubmitStatus("GAME OVER", "complete");
}

async function loadResult() {
    if (window.ArenaFlutterSession) {
        window.ArenaFlutterSession.init();
        refreshApiBaseFromSession();
    }

    if (!requireAuth()) return;

    const poolMode = isPoolPlayMode();
    setBackVisible(false);

    if (poolMode) {
        const title = document.getElementById("gameOverTitle");
        if (title) title.innerText = "GAME OVER";
        setSubmitStatus("Submitting score…", "submitting");
    }

    const sessionId = localStorage.getItem("resultSession");
    const storedScore = Number(
        localStorage.getItem("resultScore") ||
            localStorage.getItem("quizRunningScore") ||
            0
    ) || 0;
    const storedTime = Number(localStorage.getItem("quizTimeTaken") || 0) || 0;

    if (!sessionId) {
        if (poolMode) {
            document.getElementById("score").innerText = `Score : ${storedScore}`;
            await submitArenaFinalScore(storedScore, storedTime);
            setBackVisible(true);
            return;
        }
        alert("No result found. Start a quiz first.");
        window.location.href = "categories.html";
        return;
    }

    let score = storedScore;
    let timeTaken = storedTime;

    try {
        const data = await apiGet(`/api/v1/quiz/result/${sessionId}`);
        renderResult(data);
        score = Number(data.score ?? storedScore) || 0;
        if (!timeTaken) {
            timeTaken = Number(data.durationSeconds ?? 0) || 0;
        }
    } catch (err) {
        console.error(err);
        document.getElementById("score").innerText = `Score : ${storedScore}`;
        if (!poolMode) {
            alert(err.message || "Unable to load result.");
            window.location.href = "categories.html";
            return;
        }
        setSubmitStatus(err.message || "Unable to load quiz result.", "complete");
    }

    if (poolMode) {
        await submitArenaFinalScore(score, timeTaken);
    }

    setBackVisible(true);
}

function goBack() {
    const flutter = window.ArenaFlutterSession;
    if (flutter && flutter.isScoreSubmitting && flutter.isScoreSubmitting()) {
        return;
    }

    localStorage.removeItem("quiz");
    localStorage.removeItem("quizQuestionNumber");
    localStorage.removeItem("quizRunningScore");
    localStorage.removeItem("resultSession");
    localStorage.removeItem("resultScore");
    localStorage.removeItem("quizTimeTaken");
    localStorage.removeItem("quizStartTime");
    localStorage.removeItem("arenaRoundStartTime");

    if (isPoolPlayMode()) {
        localStorage.removeItem("arenaPoolId");
        localStorage.removeItem("arenaPoolSessionId");
        localStorage.removeItem("arenaPoolMode");
        userLogout();
        return;
    }
    window.location.href = "categories.html";
}
