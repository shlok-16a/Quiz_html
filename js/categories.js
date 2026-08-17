window.onload = async function () {
    if (window.ArenaFlutterSession) {
        window.ArenaFlutterSession.init();
        refreshApiBaseFromSession();
        if (window.ArenaFlutterSession.isPoolMode() || localStorage.getItem("arenaPoolSessionId")) {
            // Pool play uses the Start screen on index.html
            window.location.href = "index.html";
            return;
        }
    }

    if (isPoolPlayMode()) {
        const btn = document.getElementById("logoutBtn");
        if (btn) btn.innerText = "Close";
    }

    await loadQuizzes();
};

let quizzesById = {};
let pendingQuizId = null;

async function loadQuizzes() {
    if (!requireAuth()) return;

    const container = document.getElementById("quizzes");

    try {
        const quizzes = await apiGet("/api/v1/quiz/available");
        const list = Array.isArray(quizzes) ? quizzes : [];

        quizzesById = {};
        list.forEach((q) => {
            quizzesById[q.id] = q;
        });

        container.innerHTML = "";

        if (!list.length) {
            container.innerHTML =
                `<div class="panel" style="text-align:center; padding:34px 20px;">
                    <p class="muted">No active quizzes right now.</p>
                    <p class="faint" style="font-size:12.5px; margin-top:6px;">Check back once an admin publishes one.</p>
                </div>`;
            return;
        }

        // Build once, then write once — innerHTML += in a loop reparses the
        // whole list on every iteration.
        const markup = list.map((quiz) => {
            const timerSec = Math.max(
                1,
                Number(quiz.questionTimerSeconds ?? quiz.durationSeconds) || 10
            );
            const until = formatQuizIst(quiz.endDate);
            const quizId = String(quiz.id);
            const action = quiz.hasAttempted
                ? `<button type="button" class="secondary" disabled>Already attempted</button>`
                : `<button type="button" class="primary" onclick="openStartModal('${quizId}')">Start quiz</button>`;

            return `
            <div class="quiz-card">
                <div class="quiz-card-title">${escapeHtml(quiz.title)}</div>
                <div class="chip-row" style="margin-bottom:14px;">
                    <span class="chip">${escapeHtml(quiz.categoryName)}</span>
                    <span class="chip">${quiz.questionCount} questions</span>
                    <span class="chip">${escapeHtml(quiz.difficulty || "Mixed")}</span>
                    <span class="chip hot">${timerSec}s / question</span>
                </div>
                ${until ? `<p class="faint" style="font-size:12px; margin-bottom:12px;">Open until ${until}</p>` : ""}
                ${action}
            </div>`;
        }).join("");

        container.innerHTML = markup;
    } catch (err) {
        console.error(err);
        alert(err.message || "Unable to load quizzes. Please login again.");
        userLogout();
    }
}

function formatQuizIst(iso) {
    if (!iso) return null;
    const text = formatIst(iso);
    return text === "-" ? null : text;
}

function escapeHtml(text) {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function openStartModal(quizId) {
    const quiz = quizzesById[quizId];
    if (!quiz) {
        alert("Quiz not found. Refresh and try again.");
        return;
    }

    if (quiz.hasAttempted) {
        alert("You have already attempted this quiz.");
        return;
    }

    pendingQuizId = quizId;

    const timerSec = Math.max(
        1,
        Number(quiz.questionTimerSeconds ?? quiz.durationSeconds) || 10
    );
    const totalQuestions = quiz.questionCount || 0;
    const rules = String(quiz.RulesText || quiz.rulesText || "").trim();

    document.getElementById("modalTitle").innerText = quiz.title || "Quiz";
    document.getElementById("modalQuestions").innerText = String(totalQuestions);
    document.getElementById("modalCorrect").innerText = String(quiz.correctPoints ?? 0);
    document.getElementById("modalWrong").innerText = String(quiz.wrongPoints ?? 0);
    document.getElementById("modalTimer").innerText = timerSec + "s";

    // Tile values are single-line; the explanation lives in the eyebrow label.
    const bonusRow = document.getElementById("modalBonusRow");
    document.getElementById("modalBonus").innerText =
        "+1 per second left on a correct answer";
    bonusRow.style.display = "block";

    const rulesBlock = document.getElementById("modalRulesBlock");
    const rulesEl = document.getElementById("modalRules");
    if (rules) {
        rulesEl.innerText = rules;
        rulesBlock.style.display = "block";
    } else {
        rulesEl.innerText = "";
        rulesBlock.style.display = "none";
    }

    document.getElementById("quizStartModal").style.display = "flex";
    document.getElementById("modalOkBtn").focus();
}

function closeStartModal() {
    pendingQuizId = null;
    document.getElementById("quizStartModal").style.display = "none";
    document.getElementById("countdownOverlay").style.display = "none";
    const okBtn = document.getElementById("modalOkBtn");
    const cancelBtn = document.getElementById("modalCancelBtn");
    okBtn.disabled = false;
    okBtn.innerText = "Start quiz";
    cancelBtn.disabled = false;
}

function onModalBackdrop(event) {
    if (event.target === document.getElementById("quizStartModal")) {
        closeStartModal();
    }
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStartCountdown(seconds = 5) {
    const overlay = document.getElementById("countdownOverlay");
    const numberEl = document.getElementById("countdownNumber");
    overlay.style.display = "flex";

    for (let n = seconds; n >= 1; n--) {
        numberEl.innerText = String(n);
        numberEl.classList.remove("countdown-pop");
        void numberEl.offsetWidth;
        numberEl.classList.add("countdown-pop");
        await wait(1000);
    }

    numberEl.innerText = "Go!";
    await wait(400);
}

async function confirmStartQuiz() {
    if (!pendingQuizId) return;

    const quizId = pendingQuizId;
    const okBtn = document.getElementById("modalOkBtn");
    const cancelBtn = document.getElementById("modalCancelBtn");
    okBtn.disabled = true;
    cancelBtn.disabled = true;
    okBtn.innerText = "Get ready...";

    try {
        document.getElementById("quizStartModal").style.display = "none";
        await runStartCountdown(5);
        await beginQuiz(quizId);
    } catch (err) {
        document.getElementById("countdownOverlay").style.display = "none";
        document.getElementById("quizStartModal").style.display = "flex";
        alert(err.message || "Unable to start quiz");
        okBtn.disabled = false;
        cancelBtn.disabled = false;
        okBtn.innerText = "Start quiz";
    }
}

async function beginQuiz(quizId) {
    const data = await apiSend("/api/v1/quiz/start", "POST", { quizId });

    localStorage.setItem("quiz", JSON.stringify({ ...data, score: 0 }));
    localStorage.setItem("quizQuestionNumber", "1");
    localStorage.setItem("quizRunningScore", "0");
    window.location.href = "quiz.html" + ASSET_VERSION;
}
