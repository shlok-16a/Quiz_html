/** The injected value is the server root; tolerate a trailing /api/v1 either way. */
function normalizeApiBase(value) {
    if (!value) return null;
    return String(value).trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
}

/** SixteenArena WebAPI base. Override via localStorage.quizApiBase / injected session. */
function resolveApiBaseUrl() {
    try {
        var fromBridge =
            window.ArenaBridge &&
            window.ArenaBridge.get &&
            window.ArenaBridge.get().apiBaseUrl;
        if (fromBridge) return normalizeApiBase(fromBridge);
    } catch (e) { /* ignore */ }

    try {
        var fromFlutter =
            window.ArenaFlutterSession &&
            window.ArenaFlutterSession.get &&
            window.ArenaFlutterSession.get().apiServerUrl;
        if (fromFlutter) return normalizeApiBase(fromFlutter);
    } catch (e) { /* ignore */ }

    return normalizeApiBase(localStorage.getItem("quizApiBase")) || "http://localhost:5006";
}

var API_BASE_URL = resolveApiBaseUrl();
const APP_ID = "16arena";
const ASSET_VERSION = "?v=20260817e";

function refreshApiBaseFromSession() {
    API_BASE_URL = resolveApiBaseUrl();
    return API_BASE_URL;
}

function isPoolPlayMode() {
    if (window.ArenaBridge && window.ArenaBridge.isPoolMode()) {
        return true;
    }
    if (window.ArenaFlutterSession && window.ArenaFlutterSession.isPoolMode()) {
        return true;
    }
    return localStorage.getItem("arenaPoolMode") === "1";
}

function userLogout() {
    if (isPoolPlayMode()) {
        if (window.ArenaBridge) {
            window.ArenaBridge.closeGame();
        } else if (window.ArenaFlutterSession) {
            window.ArenaFlutterSession.closeFlutterWindow();
        }
        return;
    }
    localStorage.removeItem("token");
    localStorage.removeItem("quiz");
    localStorage.removeItem("quizQuestionNumber");
    localStorage.removeItem("quizRunningScore");
    localStorage.removeItem("resultSession");
    localStorage.removeItem("arenaPoolId");
    localStorage.removeItem("arenaPoolSessionId");
    localStorage.removeItem("arenaPoolMode");
    window.location.href = "index.html";
}

function requireAuth() {
    if (window.ArenaBridge) window.ArenaBridge.refresh();
    if (window.ArenaFlutterSession) window.ArenaFlutterSession.init();
    refreshApiBaseFromSession();

    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "index.html";
        return null;
    }
    return token;
}

function authHeaders(extra = {}) {
    if (window.ArenaBridge) window.ArenaBridge.refresh();
    if (window.ArenaFlutterSession) window.ArenaFlutterSession.init();
    refreshApiBaseFromSession();

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
        let message = extractErrorMessage(
            json,
            response.statusText || "Request failed"
        );
        if (
            response.status === 404 &&
            (!message ||
                /^not\s*found$/i.test(String(message).trim()) ||
                message === "NOT_FOUND")
        ) {
            message =
                "Quiz session not found for this try. Close and start again.";
        }
        throw new Error(message);
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

function pickQuizField(obj, names) {
    if (!obj) return undefined;
    for (let i = 0; i < names.length; i++) {
        const value = obj[names[i]];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
}

/** Normalized snapshot from the documented injection, with legacy fallback. */
function getArenaSnapshot() {
    if (window.ArenaBridge && window.ArenaBridge.get) {
        const b = window.ArenaBridge.get();
        if (b && (b.gamePoolSessionId || b.poolId || b.token || b.authToken)) {
            const token = b.token || b.authToken || null;
            return {
                poolId: b.poolId || null,
                sessionId: b.gamePoolSessionId || b.poolSessionId || null,
                gamePoolSessionId: b.gamePoolSessionId || b.poolSessionId || null,
                quizSessionId: b.quizSessionId || null,
                authToken: token,
                token: token,
                apiServerUrl: b.apiBaseUrl || null,
                apiBaseUrl: b.apiBaseUrl || null,
                quizPayload: b.quizPayload || null,
                expiresAt: b.expiresAt || null,
                poolMode: !!b.poolMode,
                tryDurationSeconds: b.tryDurationSeconds || 0,
            };
        }
    }

    const flutter =
        window.ArenaFlutterSession && window.ArenaFlutterSession.get
            ? window.ArenaFlutterSession.get()
            : {};
    return {
        poolId: flutter.poolId || null,
        sessionId: flutter.sessionId || null,
        gamePoolSessionId: flutter.sessionId || null,
        quizSessionId: flutter.quizSessionId || null,
        authToken: flutter.authToken || null,
        token: flutter.authToken || null,
        apiServerUrl: flutter.apiServerUrl || null,
        apiBaseUrl: flutter.apiServerUrl || null,
        quizPayload: flutter.quizPayload || null,
        expiresAt: null,
        poolMode: !!flutter.poolMode,
        tryDurationSeconds: flutter.gameTimerDuration || 0,
    };
}

function isFatalQuizError(message) {
    const text = String(message || "");
    return /session expired/i.test(text) || /quiz session not found/i.test(text);
}

function isQuizOver(quizData) {
    if (!quizData) return false;
    return !!(
        pickQuizField(quizData, ["isCompleted", "IsCompleted"]) ||
        pickQuizField(quizData, ["isTerminated", "IsTerminated"])
    );
}

function isQuizTerminated(quizData) {
    return !!(quizData && pickQuizField(quizData, ["isTerminated", "IsTerminated"]));
}

/** True when the server clock is already running or this is not Q1. */
function isQuizResume(quizData) {
    if (!quizData || isQuizOver(quizData)) return false;
    const remaining = pickQuizField(quizData, [
        "remainingQuestionSeconds",
        "RemainingQuestionSeconds",
    ]);
    if (remaining !== undefined && remaining !== null) return true;
    const qn =
        Number(
            pickQuizField(quizData, [
                "currentQuestionNumber",
                "CurrentQuestionNumber",
            ])
        ) || 1;
    return qn > 1;
}

function goToResultPage(sessionId, score, terminated) {
    try {
        if (sessionId) localStorage.setItem("resultSession", String(sessionId));
        localStorage.setItem("resultScore", String(score ?? 0));
        localStorage.setItem("resultTerminated", terminated ? "1" : "0");
    } catch (e) { /* ignore */ }
    window.location.href = "result.html" + ASSET_VERSION;
}

function goToQuizPage() {
    window.location.href = "quiz.html" + ASSET_VERSION;
}

function storePoolQuizState(quizData, extras) {
    extras = extras || {};
    if (window.ArenaFlutterSession && window.ArenaFlutterSession.storeQuizPlayState) {
        window.ArenaFlutterSession.storeQuizPlayState(quizData, extras);
        return;
    }
    try {
        localStorage.setItem("quiz", JSON.stringify(quizData));
        localStorage.setItem(
            "quizQuestionNumber",
            String(
                extras.questionNumber ||
                    pickQuizField(quizData, [
                        "currentQuestionNumber",
                        "CurrentQuestionNumber",
                    ]) ||
                    1
            )
        );
        localStorage.setItem(
            "quizRunningScore",
            String(
                pickQuizField(quizData, ["score", "Score"]) ?? extras.score ?? 0
            )
        );
    } catch (e) { /* ignore */ }
}

async function abandonPoolTry(gamePoolSessionId) {
    if (!gamePoolSessionId) return null;
    return apiSend(
        "/api/v1/quiz/by-pool-session/" +
            encodeURIComponent(gamePoolSessionId) +
            "/abandon",
        "POST"
    );
}

/**
 * Enter quiz play from Flutter pool start-try payload or by-pool-session API.
 */
async function enterPoolQuizPlay(options) {
    options = options || {};
    refreshApiBaseFromSession();
    const snap = getArenaSnapshot();

    let quizData = window.__POOL_QUIZ_PREFETCH__ || snap.quizPayload;
    const poolSessionId =
        snap.gamePoolSessionId || localStorage.getItem("arenaPoolSessionId");

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

    if (isQuizOver(quizData)) {
        goToResultPage(
            pickQuizField(quizData, ["sessionId", "SessionId"]),
            pickQuizField(quizData, ["score", "Score"]) ?? 0,
            isQuizTerminated(quizData)
        );
        return true;
    }

    storePoolQuizState(quizData, {
        poolMode: true,
        poolId: snap.poolId || localStorage.getItem("arenaPoolId"),
        poolSessionId: poolSessionId,
        questionNumber:
            pickQuizField(quizData, [
                "currentQuestionNumber",
                "CurrentQuestionNumber",
            ]) || 1,
        score: pickQuizField(quizData, ["score", "Score"]) || 0,
    });

    const skipCountdown = options.skipCountdown || isQuizResume(quizData);
    if (!skipCountdown && typeof window.runStartPageCountdown === "function") {
        await window.runStartPageCountdown(5);
    }

    goToQuizPage();
    return true;
}
