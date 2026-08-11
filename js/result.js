window.onload = loadResult;

async function loadResult() {
    if (!requireAuth()) return;

    const sessionId = localStorage.getItem("resultSession");
    if (!sessionId) {
        alert("No result found. Start a quiz first.");
        window.location.href = "categories.html";
        return;
    }

    try {
        const data = await apiGet(`/api/v1/quiz/result/${sessionId}`);

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
    } catch (err) {
        console.error(err);
        alert(err.message || "Unable to load result.");
        window.location.href = "categories.html";
    }
}

function goBack() {
    localStorage.removeItem("quiz");
    localStorage.removeItem("quizQuestionNumber");
    localStorage.removeItem("quizRunningScore");
    localStorage.removeItem("resultSession");
    window.location.href = "categories.html";
}
