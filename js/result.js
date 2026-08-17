/**
 * Quiz result screen.
 *
 * The pool score is submitted by the API when the quiz completes or terminates.
 * This page must never call /game-pools/{poolId}/sessions/{id}/submit-score —
 * doing so double-submits and the API rejects it.
 */
(function () {
    "use strict";

    var VERSION = "?v=20260814c";

    function pick(obj, name) {
        if (!obj) return undefined;
        if (obj[name] !== undefined && obj[name] !== null) return obj[name];
        var pascal = name.charAt(0).toUpperCase() + name.slice(1);
        if (obj[pascal] !== undefined && obj[pascal] !== null) return obj[pascal];
        return undefined;
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    /** Stat tiles carry an eyebrow label, so only the value node is written. */
    function setValue(id, value) {
        var el = document.querySelector("#" + id + " .hud-value");
        if (el) el.innerText = String(value);
    }

    function setStatus(message, kind) {
        var el = document.getElementById("submitStatus");
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
        var btn = document.getElementById("backBtn");
        if (!btn) return;
        btn.style.display = visible ? "" : "none";
        btn.disabled = !visible;
    }

    function describeTermination(reason) {
        if (reason === "MULTIPLE_ANTI_CHEAT_VIOLATIONS") {
            return "Quiz ended early — you left the app too many times.";
        }
        return reason ? "Quiz ended early (" + reason + ")." : "Quiz ended early.";
    }

    function formatDuration(seconds) {
        var total = Number(seconds) || 0;
        var mins = Math.floor(total / 60);
        var secs = total % 60;
        return mins > 0 ? mins + "m " + String(secs).padStart(2, "0") + "s" : secs + "s";
    }

    function renderResult(data) {
        setText("score", String(pick(data, "score") ?? 0));

        setValue("correct", pick(data, "correctAnswers") ?? 0);
        setValue("wrong", pick(data, "wrongAnswers") ?? 0);
        setValue("skipped", pick(data, "skippedAnswers") ?? 0);
        setValue("percentage", (pick(data, "percentage") ?? 0) + "%");
        setValue("duration", formatDuration(pick(data, "durationSeconds")));

        var bonusPoints = Number(pick(data, "bonusPoints")) || 0;
        var bonusAnswers = Number(pick(data, "bonusAnswers")) || 0;
        setValue("bonus", bonusPoints > 0
            ? "+" + bonusPoints + "  (" + bonusAnswers + " fast)"
            : "0");

        var violations = Number(pick(data, "violationCount")) || 0;
        var violationEl = document.getElementById("violations");
        if (violationEl) {
            violationEl.style.display = violations > 0 ? "block" : "none";
            violationEl.innerText = violations === 1
                ? "1 anti-cheat warning was recorded this attempt."
                : violations + " anti-cheat warnings were recorded this attempt.";
        }
    }

    function notifyHost(result, terminated) {
        if (!window.ArenaBridge) return;

        var snap = window.ArenaBridge.get();
        window.ArenaBridge.notifyHost(terminated ? "quizTerminated" : "quizFinished", {
            score: Number(pick(result, "score")) || 0,
            quizSessionId: pick(result, "sessionId") || null,
            poolId: snap.poolId || null,
            isTerminated: !!terminated,
            terminationReason: pick(result, "terminationReason") || null
        });
    }

    async function loadResult() {
        if (window.ArenaBridge) window.ArenaBridge.refresh();
        refreshApiBaseFromSession();

        var poolMode = !!(window.ArenaBridge && window.ArenaBridge.isPoolMode());
        setBackVisible(false);

        var quizSessionId = localStorage.getItem("resultSession");
        var storedScore = Number(localStorage.getItem("resultScore") || 0) || 0;
        var storedTerminated = localStorage.getItem("resultTerminated") === "1";

        if (!localStorage.getItem("token")) {
            window.location.href = "index.html" + VERSION;
            return;
        }

        if (!quizSessionId) {
            if (poolMode) {
                setText("score", String(storedScore));
                setStatus("GAME OVER", "complete");
                setBackVisible(true);
                return;
            }
            alert("No result found. Start a quiz first.");
            window.location.href = "categories.html" + VERSION;
            return;
        }

        setStatus("Loading result…", "submitting");

        try {
            var data = await apiGet("/api/v1/quiz/result/" + encodeURIComponent(quizSessionId));
            renderResult(data);

            var terminated = !!pick(data, "isTerminated") || storedTerminated;
            var titleEl = document.getElementById("gameOverTitle");

            if (terminated) {
                if (titleEl) titleEl.innerText = "Attempt ended early";
                setStatus(describeTermination(pick(data, "terminationReason")), "complete");
            } else {
                if (titleEl) titleEl.innerText = "Quiz Complete";
                setStatus("", null);
            }

            // The pool score is already on the leaderboard at this point.
            notifyHost(data, terminated);
        } catch (err) {
            console.error(err);
            setText("score", String(storedScore));
            setStatus(err.message || "Unable to load result.", "complete");

            if (window.ArenaBridge && poolMode) {
                window.ArenaBridge.notifyHost("error", {
                    message: err.message || "Unable to load result."
                });
            } else if (!poolMode) {
                alert(err.message || "Unable to load result.");
                window.location.href = "categories.html" + VERSION;
                return;
            }
        }

        setBackVisible(true);
    }

    function goBack() {
        try {
            localStorage.removeItem("quiz");
            localStorage.removeItem("quizQuestionNumber");
            localStorage.removeItem("quizRunningScore");
            localStorage.removeItem("resultSession");
            localStorage.removeItem("resultScore");
            localStorage.removeItem("resultTerminated");
            localStorage.removeItem("quizStartTime");
        } catch (e) { /* ignore */ }

        if (window.ArenaBridge && window.ArenaBridge.isPoolMode()) {
            try {
                localStorage.removeItem("arenaPoolId");
                localStorage.removeItem("arenaPoolSessionId");
                localStorage.removeItem("arenaPoolMode");
            } catch (e) { /* ignore */ }
            window.ArenaBridge.closeGame();
            return;
        }

        window.location.href = "categories.html" + VERSION;
    }

    window.goBack = goBack;
    window.addEventListener("load", loadResult);
})();
