/**
 * 16Arena quiz WebView bridge.
 *
 * Flutter injects window.__16ARENA_QUIZ__ after load, then dispatches
 * "16arena-quiz-ready". Legacy window.__GAME_SESSION__ is still accepted.
 *
 * Injection is per-document. index -> quiz -> result copies resolved values
 * into localStorage so internal navigation still has the current try.
 */
(function (global) {
    "use strict";

    var KEYS = {
        token: "token",
        apiBase: "quizApiBase",
        poolId: "arenaPoolId",
        poolSessionId: "arenaPoolSessionId",
        quizSessionId: "arenaQuizSessionId",
        poolMode: "arenaPoolMode",
        tryDuration: "arenaTryDuration",
        expiresAt: "arenaExpiresAt"
    };

    var poolId = null;
    var poolSessionId = null;
    var quizSessionId = null;
    var authToken = null;
    var apiBaseUrl = null;
    var tryDurationSeconds = null;
    var expiresAt = null;
    var quizPayload = null;
    var liveInjected = false;

    var listenerRegistered = false;
    var quizTrapInstalled = false;
    var popBound = false;
    var backgroundHandler = null;
    var exitHandler = null;

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function readUrlParam(name) {
        try {
            var key = name.replace(/[[]/, "\\[").replace(/[\]]/, "\\]");
            var match = new RegExp("[\\?&]" + key + "=([^&#]*)").exec(global.location.search);
            return match === null ? "" : decodeURIComponent(match[1].replace(/\+/g, " "));
        } catch (e) {
            return "";
        }
    }

    function readStore(key) {
        try {
            return global.localStorage.getItem(key) || null;
        } catch (e) {
            return null;
        }
    }

    function writeStore(key, value) {
        try {
            if (value === null || value === undefined || value === "") return;
            global.localStorage.setItem(key, String(value));
        } catch (e) { /* private mode / quota */ }
    }

    /** The API base is the server root; strip a trailing /api/v1 if one slips in. */
    function normalizeApiBase(value) {
        if (!value) return null;
        return String(value).trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
    }

    function firstOf(source, names) {
        for (var i = 0; i < names.length; i++) {
            var v = source[names[i]];
            if (v !== undefined && v !== null && v !== "") return v;
        }
        return null;
    }

    function hasLiveObject() {
        var q = global.__16ARENA_QUIZ__;
        var g = global.__GAME_SESSION__;
        if (q && typeof q === "object") {
            if (firstOf(q, ["gamePoolSessionId", "poolId", "accessToken", "token"])) return true;
        }
        if (g && typeof g === "object") {
            if (firstOf(g, ["sessionId", "gamePoolSessionId", "poolId", "token", "authToken"])) return true;
        }
        return false;
    }

    function isEmbedded() {
        try {
            if (hasLiveObject()) return true;
            if (global.flutter_inappwebview || global.QuizBridge) return true;
            if (global.parent && global.parent !== global) return true;
            if (/Flutter|InAppWebView|wv\)/i.test(String(global.navigator.userAgent || ""))) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    /**
     * ISO string from the quiz contract, or epoch ms from older Flutter games.
     * Ignore "now" placeholders (durationSeconds = 0 → Date.now()).
     */
    function parseExpiryMs(value) {
        if (value == null || value === "") return null;
        if (typeof value === "number") {
            if (value > 1e12) return value;
            if (value > 1e9) return value * 1000;
            return null;
        }
        var raw = String(value).trim();
        var asNum = Number(raw);
        if (!Number.isNaN(asNum) && asNum > 1e9) {
            return asNum > 1e12 ? asNum : asNum * 1000;
        }
        var hasZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
        var d = new Date(hasZone ? raw : raw + "Z");
        return Number.isNaN(d.getTime()) ? null : d.getTime();
    }

    function isPlaceholderExpiry(ms) {
        return ms != null && Math.abs(ms - Date.now()) <= 2000;
    }

    function isExpired() {
        var ms = parseExpiryMs(expiresAt);
        if (ms == null || isPlaceholderExpiry(ms)) return false;
        return Date.now() > ms;
    }

    function msUntilExpiry() {
        var ms = parseExpiryMs(expiresAt);
        if (ms == null || isPlaceholderExpiry(ms)) return null;
        return ms - Date.now();
    }

    // ------------------------------------------------------------------
    // session resolution
    // ------------------------------------------------------------------

    function applySource(source, markLive) {
        if (!source || typeof source !== "object") return;

        var pid = firstOf(source, ["poolId", "pool_id", "gamePoolId"]);
        if (pid) poolId = String(pid);

        var sid = firstOf(source, ["gamePoolSessionId", "poolSessionId", "sessionId", "session_id"]);
        if (sid) poolSessionId = String(sid);

        var qid = firstOf(source, ["quizSessionId", "QuizSessionId"]);
        if (qid) quizSessionId = String(qid);

        var tok = firstOf(source, ["token", "authToken", "auth_token", "accessToken", "access_token", "jwt"]);
        if (tok) authToken = String(tok);

        var api = firstOf(source, ["apiServerUrl", "apiBaseUrl", "apiServer", "apiUrl"]);
        if (api) apiBaseUrl = normalizeApiBase(api);

        var timer = firstOf(source, ["timerDuration", "timer", "durationSeconds", "gameDurationSeconds"]);
        if (timer) {
            var parsed = parseInt(timer, 10);
            if (parsed > 0) tryDurationSeconds = parsed;
        }

        var exp = firstOf(source, ["expiresAt", "ExpiresAt"]);
        if (exp != null && exp !== "") expiresAt = exp;

        var quiz = source.quiz || source.Quiz;
        if (quiz && typeof quiz === "object") {
            quizPayload = quiz;
            var quizSid = firstOf(quiz, ["sessionId", "SessionId"]);
            if (quizSid) quizSessionId = String(quizSid);
            var quizPool = firstOf(quiz, ["gamePoolSessionId", "GamePoolSessionId"]);
            if (quizPool) poolSessionId = String(quizPool);
        }

        if (markLive && poolId && poolSessionId && authToken) {
            liveInjected = true;
        }
    }

    function applyLiveSources() {
        liveInjected = false;
        poolId = null;
        poolSessionId = null;
        quizSessionId = null;
        authToken = null;
        apiBaseUrl = null;
        tryDurationSeconds = null;
        expiresAt = null;
        quizPayload = null;

        applySource(global.__16ARENA_QUIZ__, true);
        applySource(global.__GAME_SESSION__, true);

        var urlPool = readUrlParam("poolId");
        var urlSession = readUrlParam("gamePoolSessionId") || readUrlParam("sessionId");
        var urlToken = readUrlParam("accessToken") || readUrlParam("authToken") || readUrlParam("token");
        var urlApi = readUrlParam("apiBaseUrl") || readUrlParam("apiServerUrl") || readUrlParam("apiServer");
        if (urlPool || urlSession || urlToken || urlApi) {
            applySource({
                poolId: urlPool,
                gamePoolSessionId: urlSession,
                quizSessionId: readUrlParam("quizSessionId"),
                accessToken: urlToken,
                apiBaseUrl: urlApi,
                timerDuration: readUrlParam("timer"),
                expiresAt: readUrlParam("expiresAt")
            }, true);
        }
    }

    function persist() {
        writeStore(KEYS.token, authToken);
        writeStore(KEYS.apiBase, apiBaseUrl);
        writeStore(KEYS.poolId, poolId);
        writeStore(KEYS.poolSessionId, poolSessionId);
        writeStore(KEYS.quizSessionId, quizSessionId);
        writeStore(KEYS.tryDuration, tryDurationSeconds);
        writeStore(KEYS.expiresAt, expiresAt);
        try {
            global.localStorage.setItem(KEYS.poolMode, isPoolMode() ? "1" : "0");
        } catch (e) { /* ignore */ }
    }

    function restoreFromStore() {
        if (!poolId) poolId = readStore(KEYS.poolId);
        if (!poolSessionId) poolSessionId = readStore(KEYS.poolSessionId);
        if (!quizSessionId) quizSessionId = readStore(KEYS.quizSessionId);
        if (!authToken) authToken = readStore(KEYS.token);
        if (!apiBaseUrl) apiBaseUrl = normalizeApiBase(readStore(KEYS.apiBase));
        if (!expiresAt) expiresAt = readStore(KEYS.expiresAt);
        if (!tryDurationSeconds) {
            var stored = parseInt(readStore(KEYS.tryDuration), 10);
            if (stored > 0) tryDurationSeconds = stored;
        }
    }

    function refresh() {
        applyLiveSources();
        restoreFromStore();
        persist();
        return snapshot();
    }

    function isPoolMode() {
        return !!(poolId && poolSessionId && authToken);
    }

    function snapshot() {
        return {
            poolId: poolId,
            poolSessionId: poolSessionId,
            gamePoolSessionId: poolSessionId,
            quizSessionId: quizSessionId,
            token: authToken,
            authToken: authToken,
            apiBaseUrl: apiBaseUrl,
            tryDurationSeconds: tryDurationSeconds,
            expiresAt: expiresAt,
            quizPayload: quizPayload,
            poolMode: isPoolMode(),
            liveInjected: liveInjected,
            embedded: isEmbedded()
        };
    }

    /**
     * Wait for the injected try.
     * allowStored: false on index.html so a new WebView does not reuse the last try.
     * allowStored: true on quiz/result after internal navigation (no re-inject).
     */
    function waitForSession(options) {
        options = options || {};
        var timeoutMs = options.timeoutMs != null ? options.timeoutMs : 8000;
        var requirePool = options.requirePool !== false;
        var allowStored = options.allowStored !== false;

        return new Promise(function (resolve, reject) {
            var started = Date.now();

            function done() {
                persist();
                resolve(snapshot());
            }

            function attempt() {
                applyLiveSources();

                if (!requirePool) {
                    restoreFromStore();
                    if (authToken) {
                        done();
                        return;
                    }
                } else if (isPoolMode() && liveInjected) {
                    done();
                    return;
                } else if (allowStored) {
                    restoreFromStore();
                    if (isPoolMode() && !hasLiveObject()) {
                        done();
                        return;
                    }
                }

                if (Date.now() - started >= timeoutMs) {
                    if (allowStored) {
                        restoreFromStore();
                        if (!requirePool || isPoolMode()) {
                            done();
                            return;
                        }
                    }
                    reject(new Error("No Arena session was injected. Close the game and start again."));
                    return;
                }

                requestSession();
                setTimeout(attempt, 250);
            }

            attempt();
        });
    }

    function requestSession() {
        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage({ type: "requestSessionParams" }, "*");
            } else if (global.flutter_inappwebview) {
                global.flutter_inappwebview.callHandler("requestSessionParams");
            }
        } catch (e) { /* ignore */ }
    }

    function installQuizTrap() {
        if (quizTrapInstalled) return;
        quizTrapInstalled = true;
        try {
            var current = global.__16ARENA_QUIZ__;
            Object.defineProperty(global, "__16ARENA_QUIZ__", {
                configurable: true,
                enumerable: true,
                get: function () { return current; },
                set: function (value) {
                    current = value;
                    if (value && typeof value === "object") {
                        applySource(value, true);
                        persist();
                    }
                }
            });
            if (current && typeof current === "object") {
                applySource(current, true);
            }
        } catch (e) { /* already defined */ }
    }

    function registerListenerOnce() {
        if (listenerRegistered) return;
        listenerRegistered = true;

        global.addEventListener("message", function (event) {
            var data = event.data;
            if (!data || typeof data !== "object") return;
            if (data.type !== "flutterParams" && data.type !== "gameSession") return;
            applySource(data, true);
            if (data.data) applySource(data.data, true);
            persist();
        });

        global.addEventListener("16arena-quiz-ready", function () {
            applyLiveSources();
            persist();
        });

        global.addEventListener("gameSessionReady", function () {
            applyLiveSources();
            persist();
        });
    }

    // ------------------------------------------------------------------
    // host messaging
    // ------------------------------------------------------------------

    function notifyHost(type, payload) {
        var message = Object.assign({ type: type }, payload || {});
        var json;
        try {
            json = JSON.stringify(message);
        } catch (e) {
            json = JSON.stringify({ type: type });
        }

        try {
            if (global.QuizBridge && typeof global.QuizBridge.postMessage === "function") {
                global.QuizBridge.postMessage(json);
                return true;
            }
        } catch (e) { /* fall through */ }

        try {
            if (global.flutter_inappwebview && typeof global.flutter_inappwebview.callHandler === "function") {
                global.flutter_inappwebview.callHandler("onMessage", message);
                return true;
            }
        } catch (e) { /* fall through */ }

        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage(message, "*");
                return true;
            }
        } catch (e) { /* fall through */ }

        console.log("16Arena host message (no bridge):", message);
        return false;
    }

    function closeGame() {
        try {
            if (global.QuizBridge && typeof global.QuizBridge.postMessage === "function") {
                global.QuizBridge.postMessage(JSON.stringify({ type: "close" }));
                return true;
            }
        } catch (e) { /* fall through */ }

        try {
            if (global.flutter_inappwebview && typeof global.flutter_inappwebview.callHandler === "function") {
                global.flutter_inappwebview.callHandler("closeGame");
                return true;
            }
        } catch (e) { /* fall through */ }

        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage({ type: "closeGame" }, "*");
                return true;
            }
        } catch (e) { /* fall through */ }

        try { global.close(); } catch (e) { /* ignore */ }
        console.log("16Arena closeGame: no host bridge available");
        return false;
    }

    function onBackground(handler) {
        backgroundHandler = handler;
    }

    function onExit(handler) {
        exitHandler = handler;
        try {
            if (!global.history.state || !global.history.state.arenaQuizGuard) {
                global.history.pushState({ arenaQuizGuard: 1 }, "", global.location.href);
            }
        } catch (e) { /* ignore */ }
        if (!popBound) {
            popBound = true;
            global.addEventListener("popstate", function () {
                if (typeof exitHandler === "function") {
                    try { exitHandler(); } catch (e) {
                        console.error("Exit handler failed", e);
                    }
                }
            });
        }
    }

    global.__16ARENA_QUIZ_ON_BACKGROUND__ = function () {
        if (typeof backgroundHandler !== "function") return;
        try {
            return backgroundHandler();
        } catch (e) {
            console.error("Background handler failed", e);
        }
    };

    global.__16ARENA_QUIZ_ON_EXIT__ = function () {
        if (typeof exitHandler !== "function") return;
        try {
            return exitHandler();
        } catch (e) {
            console.error("Exit handler failed", e);
        }
    };

    // ------------------------------------------------------------------

    global.ArenaBridge = {
        refresh: refresh,
        get: snapshot,
        isPoolMode: isPoolMode,
        isEmbedded: isEmbedded,
        isExpired: isExpired,
        msUntilExpiry: msUntilExpiry,
        waitForSession: waitForSession,
        notifyHost: notifyHost,
        closeGame: closeGame,
        onBackground: onBackground,
        onExit: onExit,
        getUrlParameter: readUrlParam
    };

    installQuizTrap();
    registerListenerOnce();
    refresh();
})(window);
