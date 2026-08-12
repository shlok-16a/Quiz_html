/** SixteenArena WebAPI base (matches admin panel default). Override via localStorage.quizApiBase / Flutter session. */
function resolveApiBaseUrl() {
    try {
        var fromFlutter =
            window.ArenaFlutterSession &&
            window.ArenaFlutterSession.get &&
            window.ArenaFlutterSession.get().apiServerUrl;
        if (fromFlutter) {
            return String(fromFlutter).replace(/\/$/, "");
        }
    } catch (e) { /* ignore */ }
    return localStorage.getItem("quizApiBase") || "http://localhost:5006";
}

var API_BASE_URL = resolveApiBaseUrl();
const APP_ID = "16arena";

function refreshApiBaseFromSession() {
    API_BASE_URL = resolveApiBaseUrl();
    return API_BASE_URL;
}

function isPoolPlayMode() {
    if (window.ArenaFlutterSession && window.ArenaFlutterSession.isPoolMode()) {
        return true;
    }
    return localStorage.getItem("arenaPoolMode") === "1";
}

function userLogout() {
    if (isPoolPlayMode()) {
        if (window.ArenaFlutterSession) {
            window.ArenaFlutterSession.closeFlutterWindow();
        }
        return;
    }
    localStorage.removeItem("token");
    localStorage.removeItem("quiz");
    localStorage.removeItem("quizQuestionNumber");
    localStorage.removeItem("quizRunningScore");
    localStorage.removeItem("resultSession");
    localStorage.removeItem("otpToken");
    localStorage.removeItem("pendingEmail");
    localStorage.removeItem("arenaPoolId");
    localStorage.removeItem("arenaPoolSessionId");
    localStorage.removeItem("arenaPoolMode");
    window.location.href = "index.html";
}

function requireAuth() {
    if (window.ArenaFlutterSession) {
        window.ArenaFlutterSession.init();
        refreshApiBaseFromSession();
    }
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "index.html";
        return null;
    }
    return token;
}

function authHeaders(extra = {}) {
    if (window.ArenaFlutterSession) {
        window.ArenaFlutterSession.init();
        refreshApiBaseFromSession();
    }
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json", ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

/** Resolve relative media / cover paths against the API host. */
function resolveMediaUrl(url) {
    if (!url) return null;
    const raw = String(url).trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
    const base = API_BASE_URL.replace(/\/$/, "");
    return raw.startsWith("/") ? `${base}${raw}` : `${base}/${raw}`;
}

function extractErrorMessage(json, fallback = "Request failed") {
    if (!json) return fallback;
    if (typeof json === "string") return json;
    const err = json.error;
    if (typeof err === "string" && err) return err;
    if (err && typeof err === "object") {
        return err.detail || err.message || fallback;
    }
    return json.message || json.title || fallback;
}

/**
 * Unwrap SixteenArena ApiResponse envelope: { success, message, data }.
 * Throws Error when HTTP or success === false.
 */
async function parseApiResponse(response) {
    const text = await response.text();
    let json = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch {
            if (!response.ok) throw new Error(text || "Request failed");
            return text;
        }
    }

    if (!response.ok || (json && json.success === false)) {
        throw new Error(extractErrorMessage(json, response.statusText || "Request failed"));
    }

    if (json && Object.prototype.hasOwnProperty.call(json, "data")) {
        return json.data;
    }
    return json;
}

async function apiGet(path) {
    refreshApiBaseFromSession();
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: authHeaders(),
    });
    return parseApiResponse(response);
}

async function apiSend(path, method, body) {
    refreshApiBaseFromSession();
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: authHeaders(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (response.status === 204) return null;
    return parseApiResponse(response);
}

/** Parse API datetime as UTC (EF often omits the Z). */
function parseUtcDate(iso) {
    if (!iso) return null;
    const raw = String(iso).trim();
    const hasZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
    const d = new Date(hasZone ? raw : `${raw}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Format UTC ISO for display in IST. */
function formatIst(iso) {
    const d = parseUtcDate(iso);
    if (!d) return "-";
    const formatted = d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
    return `${formatted} IST`;
}

/**
 * Enter quiz play from Flutter pool start-try payload or by-pool-session API.
 */
async function enterPoolQuizPlay() {
    refreshApiBaseFromSession();
    const snap = window.ArenaFlutterSession
        ? window.ArenaFlutterSession.get()
        : {};

    let quizData = snap.quizPayload;
    const poolSessionId =
        snap.sessionId || localStorage.getItem("arenaPoolSessionId");

    if (!localStorage.getItem("token") && snap.authToken) {
        localStorage.setItem("token", snap.authToken);
    }

    if (!quizData && poolSessionId) {
        quizData = await apiGet(`/api/v1/quiz/by-pool-session/${poolSessionId}`);
    }

    if (!quizData) {
        throw new Error(
            "Quiz session not available. Ensure start-try succeeded and API is running."
        );
    }

    if (quizData.isCompleted || quizData.IsCompleted) {
        const sid = quizData.sessionId || quizData.SessionId;
        localStorage.setItem("resultSession", sid);
        window.location.href = "result.html";
        return true;
    }

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
        localStorage.setItem(
            "quizQuestionNumber",
            String(
                quizData.currentQuestionNumber ||
                    quizData.CurrentQuestionNumber ||
                    1
            )
        );
    }

    window.location.href = "quiz.html";
    return true;
}
