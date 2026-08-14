/**
 * 16Arena quiz WebView bridge.
 *
 * The app injects only five generic fields — pool id, pool session id, token,
 * API url, and (optionally) a timer. Everything quiz-specific (quizSessionId,
 * questions, score, per-question clock) is resolved from the API instead.
 *
 * Injection is per-document and the player walks index -> quiz -> result, so
 * resolved values are mirrored into localStorage to survive navigation. Storage
 * keys match the previous bridge so the existing entry flow keeps working.
 */
(function (global) {
    "use strict";

    var KEYS = {
        token: "token",
        apiBase: "quizApiBase",
        poolId: "arenaPoolId",
        poolSessionId: "arenaPoolSessionId",
        poolMode: "arenaPoolMode",
        tryDuration: "arenaTryDuration"
    };

    var poolId = null;
    var poolSessionId = null;
    var authToken = null;
    var apiBaseUrl = null;
    var tryDurationSeconds = null;

    var listenerRegistered = false;
    var backgroundHandler = null;

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

    // ------------------------------------------------------------------
    // session resolution
    // ------------------------------------------------------------------

    function applySource(source) {
        if (!source || typeof source !== "object") return;

        var pid = firstOf(source, ["poolId", "pool_id", "gamePoolId"]);
        if (pid) poolId = String(pid);

        var sid = firstOf(source, ["gamePoolSessionId", "sessionId", "session_id", "poolSessionId"]);
        if (sid) poolSessionId = String(sid);

        var tok = firstOf(source, ["token", "authToken", "auth_token", "accessToken", "access_token", "jwt"]);
        if (tok) authToken = String(tok);

        var api = firstOf(source, ["apiServerUrl", "apiBaseUrl", "apiServer", "apiUrl"]);
        if (api) apiBaseUrl = normalizeApiBase(api);

        var timer = firstOf(source, ["timerDuration", "timer", "durationSeconds", "gameDurationSeconds"]);
        if (timer) {
            var parsed = parseInt(timer, 10);
            if (parsed > 0) tryDurationSeconds = parsed;
        }
    }

    function persist() {
        writeStore(KEYS.token, authToken);
        writeStore(KEYS.apiBase, apiBaseUrl);
        writeStore(KEYS.poolId, poolId);
        writeStore(KEYS.poolSessionId, poolSessionId);
        writeStore(KEYS.tryDuration, tryDurationSeconds);
        try {
            global.localStorage.setItem(KEYS.poolMode, isPoolMode() ? "1" : "0");
        } catch (e) { /* ignore */ }
    }

    function restoreFromStore() {
        if (!poolId) poolId = readStore(KEYS.poolId);
        if (!poolSessionId) poolSessionId = readStore(KEYS.poolSessionId);
        if (!authToken) authToken = readStore(KEYS.token);
        if (!apiBaseUrl) apiBaseUrl = normalizeApiBase(readStore(KEYS.apiBase));
        if (!tryDurationSeconds) {
            var stored = parseInt(readStore(KEYS.tryDuration), 10);
            if (stored > 0) tryDurationSeconds = stored;
        }
    }

    function refresh() {
        // Preferred: the object the app injects after load.
        applySource(global.__16ARENA_QUIZ__);
        applySource(global.__GAME_SESSION__);

        // Fallback: URL params (local testing / debugger harness).
        if (!poolId || !poolSessionId || !authToken || !apiBaseUrl) {
            applySource({
                poolId: readUrlParam("poolId"),
                sessionId: readUrlParam("sessionId"),
                authToken: readUrlParam("authToken"),
                apiServerUrl: readUrlParam("apiServerUrl") || readUrlParam("apiServer"),
                timer: readUrlParam("timer")
            });
        }

        // Last resort: values persisted by an earlier page in this flow.
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
            token: authToken,
            apiBaseUrl: apiBaseUrl,
            tryDurationSeconds: tryDurationSeconds,
            poolMode: isPoolMode()
        };
    }

    /** Injection can land after first paint — poll until the pool fields arrive. */
    function waitForSession(options) {
        options = options || {};
        var timeoutMs = options.timeoutMs || 8000;
        var requirePool = options.requirePool !== false;

        return new Promise(function (resolve, reject) {
            var started = Date.now();

            function attempt() {
                refresh();

                if (!requirePool || isPoolMode()) {
                    resolve(snapshot());
                    return;
                }

                if (Date.now() - started >= timeoutMs) {
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

    function registerListenerOnce() {
        if (listenerRegistered) return;
        listenerRegistered = true;

        global.addEventListener("message", function (event) {
            var data = event.data;
            if (!data || typeof data !== "object") return;
            if (data.type !== "flutterParams" && data.type !== "gameSession") return;
            applySource(data);
            persist();
        });

        global.addEventListener("16arena-quiz-ready", function () {
            refresh();
        });

        global.addEventListener("gameSessionReady", function () {
            refresh();
        });
    }

    // ------------------------------------------------------------------
    // host messaging
    // ------------------------------------------------------------------

    /**
     * Delivery order matches whatever the app registers: a QuizBridge JS
     * channel first, then the InAppWebView handler, then an iframe parent.
     */
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

    /**
     * Back / exit. Integration Guide phase 6 defines a dedicated path for this
     * rather than the generic message channel: a `closeGame` InAppWebView
     * handler, or { type: 'closeGame' } to an iframe parent.
     *
     * Exactly one channel fires — delivering on two would pop the WebView twice.
     * QuizBridge takes priority when the app registered it, since the quiz pool
     * contract names that channel and uses `close` there.
     */
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

        // Standalone browser / no host: nothing to return to.
        try { global.close(); } catch (e) { /* ignore */ }
        console.log("16Arena closeGame: no host bridge available");
        return false;
    }

    /**
     * The app calls window.__16ARENA_QUIZ_ON_BACKGROUND__() on lifecycle pause.
     * Only the app can tell a real background from a WebView quirk, so the page
     * never infers this itself — a false positive costs the player a question.
     */
    function onBackground(handler) {
        backgroundHandler = handler;
    }

    global.__16ARENA_QUIZ_ON_BACKGROUND__ = function () {
        if (typeof backgroundHandler !== "function") return;
        try {
            return backgroundHandler();
        } catch (e) {
            console.error("Background handler failed", e);
        }
    };

    // ------------------------------------------------------------------

    global.ArenaBridge = {
        refresh: refresh,
        get: snapshot,
        isPoolMode: isPoolMode,
        waitForSession: waitForSession,
        notifyHost: notifyHost,
        closeGame: closeGame,
        onBackground: onBackground,
        getUrlParameter: readUrlParam
    };

    registerListenerOnce();
    refresh();
})(window);
