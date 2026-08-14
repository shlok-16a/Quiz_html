(function () {
    if (window.ArenaFlutterSession) {
        window.ArenaFlutterSession.init();
        refreshApiBaseFromSession();
    }

    if (!requireAuth()) return;

    const quiz = JSON.parse(localStorage.getItem("quiz") || "null");

    if (!quiz) {
        if (isPoolPlayMode()) {
            enterPoolQuizPlay().catch((err) => {
                alert(err.message || "No quiz found.");
                userLogout();
            });
            return;
        }
        alert("No quiz found. Start from Categories.");
        window.location.href = "categories.html";
        return;
    }

    const sessionId = quiz.sessionId ?? quiz.SessionId;
    const totalQuestions = quiz.totalQuestions ?? quiz.TotalQuestions ?? 0;
    const defaultQuestionTimerSeconds = Math.max(
        1,
        Number(
            quiz.questionTimerSeconds ??
                quiz.QuestionTimerSeconds ??
                quiz.durationSeconds ??
                quiz.DurationSeconds
        ) || 10
    );
    const interQuestionCountdownSeconds = Math.max(
        0,
        Number(
            quiz.interQuestionCountdownSeconds ??
                quiz.InterQuestionCountdownSeconds ??
                3
        ) || 0
    );
    let questionNumber = Number(localStorage.getItem("quizQuestionNumber") || "1");
    let currentQuestion =
        quiz.currentQuestion || quiz.firstQuestion || quiz.FirstQuestion;
    let runningScore =
        Number(quiz.score ?? quiz.Score ?? localStorage.getItem("quizRunningScore") ?? 0) || 0;
    let busy = false;
    let questionTimerSeconds = defaultQuestionTimerSeconds;
    let remainingSeconds = questionTimerSeconds;
    let timerId = null;

    function resolveQuestionTimer(question) {
        const fromQuestion = Number(question?.timerSeconds ?? question?.TimerSeconds);
        if (fromQuestion > 0) return fromQuestion;
        return defaultQuestionTimerSeconds;
    }

    document.getElementById("title").innerText = quiz.title || "Quiz";

    const timerEl = document.getElementById("timer");
    const questionEl = document.getElementById("question");
    const mediaEl = document.getElementById("questionMedia");
    const option1El = document.getElementById("option1");
    const option2El = document.getElementById("option2");
    const option3El = document.getElementById("option3");
    const skipEl = document.getElementById("skipBtn");
    const progressEl = document.getElementById("progress");
    const statusEl = document.getElementById("status");
    const bannerEl = document.getElementById("feedbackBanner");
    const scoreEl = document.getElementById("runningScore");
    const nextCountdownOverlay = document.getElementById("nextCountdownOverlay");
    const nextCountdownLabel = document.getElementById("nextCountdownLabel");
    const nextCountdownNumber = document.getElementById("nextCountdownNumber");
    const nextCountdownHint = document.getElementById("nextCountdownHint");

    const optionButtons = [option1El, option2El, option3El];

    function escapeAttr(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function renderQuestionMedia(questionType, mediaUrl) {
        const type = (questionType || "Text").trim();
        const url = resolveMediaUrl(mediaUrl) || "";

        mediaEl.innerHTML = "";
        mediaEl.hidden = true;

        if (!url || type.toLowerCase() === "text") {
            return;
        }

        const safeUrl = escapeAttr(url);

        if (type.toLowerCase() === "image") {
            mediaEl.innerHTML = `<img src="${safeUrl}" alt="Question image" class="quiz-media-image">`;
        } else if (type.toLowerCase() === "audio") {
            mediaEl.innerHTML = `<audio controls controlslist="nodownload noplaybackrate" src="${safeUrl}" class="quiz-media-audio">Your browser does not support audio.</audio>`;
        } else if (type.toLowerCase() === "video") {
            mediaEl.innerHTML = `<video controls controlslist="nodownload noplaybackrate noremoteplayback" disablepictureinpicture src="${safeUrl}" class="quiz-media-video">Your browser does not support video.</video>`;
        } else {
            return;
        }

        mediaEl.hidden = false;
    }

    function updateRunningScore(score) {
        runningScore = Number(score) || 0;
        scoreEl.innerText = `Score: ${runningScore}`;
        scoreEl.classList.remove("score-pop");
        void scoreEl.offsetWidth;
        scoreEl.classList.add("score-pop");

        const saved = JSON.parse(localStorage.getItem("quiz") || "{}");
        saved.score = runningScore;
        localStorage.setItem("quiz", JSON.stringify(saved));
        localStorage.setItem("quizRunningScore", String(runningScore));
    }

    updateRunningScore(runningScore);

    if (window.ArenaFlutterSession && window.ArenaFlutterSession.markRoundStart) {
        window.ArenaFlutterSession.markRoundStart();
    }
    if (!localStorage.getItem("quizStartTime")) {
        localStorage.setItem("quizStartTime", String(Date.now()));
    }

    function setButtonsDisabled(disabled) {
        optionButtons.forEach((btn) => {
            btn.disabled = disabled;
        });
        skipEl.disabled = disabled;
    }

    function clearOptionStyles() {
        optionButtons.forEach((btn) => {
            btn.classList.remove("option-correct", "option-wrong");
        });
    }

    function setStatus(message, color) {
        if (!message) {
            statusEl.style.display = "none";
            statusEl.innerText = "";
            return;
        }
        statusEl.style.display = "block";
        statusEl.style.color = color || "";
        statusEl.innerText = message;
    }

    function hideFeedbackBanner() {
        bannerEl.classList.remove("show", "correct", "incorrect", "neutral");
        bannerEl.innerText = "";
    }

    function showFeedbackBanner(kind, message) {
        bannerEl.classList.remove("correct", "incorrect", "neutral");
        bannerEl.classList.add(kind, "show");
        bannerEl.innerText = message;
        // Feedback lives on the bottom banner only — don't also paint #status.
        setStatus("");
    }

    function formatPoints(points) {
        if (points > 0) return `+${points}`;
        return String(points);
    }

    function showAnswerFeedback(selectedOption, isCorrect, pointsAwarded, bonusAwarded = 0) {
        if (selectedOption < 1 || selectedOption > 3) return;
        const btn = optionButtons[selectedOption - 1];
        btn.classList.add(isCorrect ? "option-correct" : "option-wrong");

        if (isCorrect) {
            const bonus = Math.max(0, Number(bonusAwarded) || 0);
            const basePoints = pointsAwarded - bonus;
            let msg = `Hooray! Correct answer ${formatPoints(basePoints)} points`;
            if (bonus > 0) {
                msg += ` ${formatPoints(bonus)} bonus`;
            }
            showFeedbackBanner("correct", msg);
        } else {
            const msg = `Oops, wrong answer, ${formatPoints(pointsAwarded)} points`;
            showFeedbackBanner("incorrect", msg);
        }
    }

    function showCorrectAnswer(correctOption) {
        const option = Number(correctOption);
        if (option < 1 || option > 3) return;
        clearOptionStyles();
        optionButtons[option - 1].classList.add("option-correct");
        showFeedbackBanner("neutral", "Time up - correct answer highlighted");
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function runInterQuestionCountdown(nextQuestionNumber, seconds = 3) {
        const countdownSeconds = Math.max(0, Number(seconds) || 0);
        if (countdownSeconds <= 0) {
            return;
        }

        if (nextCountdownHint) {
            nextCountdownHint.style.display = "none";
        }
        nextCountdownLabel.innerText = `Question ${nextQuestionNumber} loading in`;
        nextCountdownOverlay.style.display = "flex";

        for (let n = countdownSeconds; n >= 1; n--) {
            nextCountdownNumber.innerText = String(n);
            nextCountdownNumber.classList.remove("countdown-pop");
            void nextCountdownNumber.offsetWidth;
            nextCountdownNumber.classList.add("countdown-pop");
            await wait(1000);
        }

        nextCountdownOverlay.style.display = "none";
    }

    function stopQuestionTimer() {
        if (timerId) {
            clearInterval(timerId);
            timerId = null;
        }
    }

    function updateTimerLabel() {
        timerEl.innerText = `Time left: ${remainingSeconds}s`;
    }

    function startQuestionTimer() {
        stopQuestionTimer();
        remainingSeconds = questionTimerSeconds;
        updateTimerLabel();
        timerId = setInterval(() => {
            remainingSeconds -= 1;
            updateTimerLabel();
            if (remainingSeconds <= 0) {
                stopQuestionTimer();
                submitAnswer(0);
            }
        }, 1000);
    }

    function render(question) {
        if (!question) {
            setStatus("No question available.");
            return;
        }

        questionTimerSeconds = resolveQuestionTimer(question);
        currentQuestion = {
            id: question.id ?? question.Id,
            questionType: question.questionType ?? question.QuestionType ?? "Text",
            questionText: question.questionText ?? question.QuestionText,
            mediaUrl: question.mediaUrl ?? question.MediaUrl ?? null,
            option1: question.option1 ?? question.Option1,
            option2: question.option2 ?? question.Option2,
            option3: question.option3 ?? question.Option3,
            timerSeconds: questionTimerSeconds,
        };

        clearOptionStyles();
        hideFeedbackBanner();
        renderQuestionMedia(currentQuestion.questionType, currentQuestion.mediaUrl);
        questionEl.innerText = currentQuestion.questionText;
        option1El.innerText = currentQuestion.option1;
        option2El.innerText = currentQuestion.option2;
        option3El.innerText = currentQuestion.option3;
        progressEl.innerText =
            `Question ${questionNumber}` + (totalQuestions ? ` of ${totalQuestions}` : "");
        setStatus("");

        const saved = JSON.parse(localStorage.getItem("quiz"));
        saved.currentQuestion = currentQuestion;
        saved.questionTimerSeconds = questionTimerSeconds;
        localStorage.setItem("quiz", JSON.stringify(saved));
        localStorage.setItem("quizQuestionNumber", String(questionNumber));

        setButtonsDisabled(false);
        startQuestionTimer();
    }

    async function submitAnswer(selectedOption) {
        if (busy) return;
        busy = true;
        stopQuestionTimer();
        setButtonsDisabled(true);
        setStatus("");

        try {
            const data = await apiSend("/api/v1/quiz/answer", "POST", {
                sessionId,
                questionId: currentQuestion.id,
                selectedOption,
                timeTakenSeconds: Math.max(0, questionTimerSeconds - remainingSeconds),
            });

            const isCorrect = !!(data.isCorrect ?? data.IsCorrect);
            const correctOption = Number(data.correctOption ?? data.CorrectOption ?? 0);
            const pointsAwarded = Number(data.pointsAwarded ?? data.PointsAwarded ?? 0);
            const bonusAwarded = Number(data.bonusAwarded ?? data.BonusAwarded ?? 0);
            updateRunningScore(data.score ?? data.Score ?? runningScore);

            if (selectedOption > 0) {
                showAnswerFeedback(selectedOption, isCorrect, pointsAwarded, bonusAwarded);
                if (!isCorrect && correctOption >= 1 && correctOption <= 3) {
                    optionButtons[correctOption - 1].classList.add("option-correct");
                }
                await wait(isCorrect ? 1600 : 1800);
            } else {
                showCorrectAnswer(correctOption);
                await wait(1400);
            }

            hideFeedbackBanner();

            if (data.quizCompleted ?? data.QuizCompleted) {
                const start = Number(localStorage.getItem("quizStartTime") || Date.now());
                const elapsed = Math.max(1, Math.ceil((Date.now() - start) / 1000));
                localStorage.setItem("resultSession", sessionId);
                localStorage.setItem("quizTimeTaken", String(elapsed));
                localStorage.setItem("resultScore", String(runningScore));
                localStorage.removeItem("quizQuestionNumber");
                localStorage.removeItem("quizRunningScore");
                localStorage.removeItem("quizStartTime");
                window.location.href = "result.html?v=20260814a";
                return;
            }

            const nextQuestion = data.nextQuestion ?? data.NextQuestion;
            if (!nextQuestion) {
                setStatus("No next question in response", "#dc2626");
                busy = false;
                return;
            }

            const nextNumber = questionNumber + 1;
            await runInterQuestionCountdown(nextNumber, interQuestionCountdownSeconds);
            questionNumber = nextNumber;
            busy = false;
            render(nextQuestion);
        } catch (err) {
            console.error(err);
            hideFeedbackBanner();
            setStatus(err.message || "Network error", "#dc2626");
            setButtonsDisabled(false);
            startQuestionTimer();
            busy = false;
        }
    }

    option1El.onclick = () => submitAnswer(1);
    option2El.onclick = () => submitAnswer(2);
    option3El.onclick = () => submitAnswer(3);
    skipEl.onclick = () => submitAnswer(0);

    (async function bootQuiz() {
        render(currentQuestion);
    })();
})();
