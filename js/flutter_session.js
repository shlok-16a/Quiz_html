/**
 * Flutter / Arena WebView session bridge (same pattern as 2048-master).
 * Flutter injects window.__GAME_SESSION__ AFTER onLoadStop — keep polling; never assume standalone.
 *
 * Expected injection (from pool_game_play_page.dart):
 *   { sessionId, token, poolId, timerDuration, apiServerUrl, expiresAt }
 */
(function (global) {
    var poolId = null;
    var sessionId = null; // game_pool_sessions.id
    var quizSessionId = null;
    var authToken = null;
    var apiServerUrl = null;
    var gameTimerDuration = null;
    var quizPayload = null;
    var sessionReady = false;
    var messageListenerBound = false;
    var propertyTrapInstalled = false;
    var pollTimer = null;
    var onReadyCallbacks = [];

    function getUrlParameter(name) {
        name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
        var regex = new RegExp("[\\?&]" + name + "=([^&#]*)");
        var results = regex.exec(global.location.search);
        return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
    }

    /** True when opened from Arena app WebView or with pool/session hints. */
    function isArenaWebView() {
        var ua = String(global.navigator && global.navigator.userAgent || "");
        return !!(
            global.flutter_inappwebview ||
            (global.parent && global.parent !== global) ||
            global.__GAME_SESSION__ ||
            getUrlParameter("poolId") ||
            getUrlParameter("sessionId") ||
            getUrlParameter("authToken") ||
            getUrlParameter("token") ||
            /Flutter|InAppWebView|wv\)/i.test(ua)
        );
    }

    function wantsStandaloneLogin() {
        return getUrlParameter("standalone") === "1" || getUrlParameter("login") === "1";
    }

    function pickQuizPayload(source) {
        if (!source || typeof source !== "object") return null;
        return (
            source.quiz ||
            source.Quiz ||
            source.quizStart ||
            source.startQuiz ||
            (source.data && (source.data.quiz || source.data.Quiz)) ||
            (source.startTry && (source.startTry.quiz || source.startTry.Quiz)) ||
            null
        );
    }

    function applySessionFields(source) {
        if (!source || typeof source !== "object") return;

        if (source.poolId) poolId = String(source.poolId);
        if (source.sessionId) sessionId = String(source.sessionId);
        if (source.quizSessionId || source.QuizSessionId) {
            quizSessionId = String(source.quizSessionId || source.QuizSessionId);
        }

        var token =
            source.token ||
            source.authToken ||
            source.accessToken ||
            source.access_token ||
            source.jwt;
        if (token) authToken = String(token);

        if (source.apiServerUrl || source.apiServer) {
            apiServerUrl = String(source.apiServerUrl || source.apiServer).replace(/\/$/, "");
        }
        if (source.timerDuration !== undefined && source.timerDuration !== null) {
            gameTimerDuration = parseInt(source.timerDuration, 10) || gameTimerDuration;
        } else if (source.timer !== undefined && source.timer !== null) {
            gameTimerDuration = parseInt(source.timer, 10) || gameTimerDuration;
        }

        var quiz = pickQuizPayload(source);
        if (quiz) {
            quizPayload = quiz;
            if (quiz.sessionId || quiz.SessionId) {
                quizSessionId = String(quiz.sessionId || quiz.SessionId);
            }
            if (quiz.gamePoolSessionId || quiz.GamePoolSessionId) {
                sessionId = String(
                    quiz.gamePoolSessionId || quiz.GamePoolSessionId || sessionId
                );
            }
        }
    }

    function isExpired(source) {
        if (!source || source.expiresAt == null) return false;
        var exp = Number(source.expiresAt);
        if (!exp || Number.isNaN(exp)) return false;
        // Flutter may set expiresAt = Date.now() when durationSeconds is 0 — ignore that.
        if (exp <= Date.now() + 2000) return false;
        return Date.now() > exp;
    }

    function persistAuthToStorage() {
        try {
            if (authToken) localStorage.setItem("token", authToken);
            if (apiServerUrl) localStorage.setItem("quizApiBase", apiServerUrl);
            if (poolId) localStorage.setItem("arenaPoolId", poolId);
            if (sessionId) localStorage.setItem("arenaPoolSessionId", sessionId);
            localStorage.setItem("arenaPoolMode", isPoolMode() ? "1" : "0");
        } catch (e) {
            console.warn("Unable to persist Arena session", e);
        }
    }

    function isPoolMode() {
        return !!(poolId && sessionId && authToken);
    }

    function getSnapshot() {
        return {
            poolId: poolId,
            sessionId: sessionId,
            quizSessionId: quizSessionId,
            authToken: authToken,
            apiServerUrl: apiServerUrl,
            gameTimerDuration: gameTimerDuration,
            quizPayload: quizPayload,
            sessionReady: sessionReady,
            poolMode: isPoolMode(),
            embedded: isArenaWebView(),
        };
    }

    function notifyReady() {
        var snap = getSnapshot();
        var cbs = onReadyCallbacks.slice();
        for (var i = 0; i < cbs.length; i++) {
            try {
                cbs[i](snap);
            } catch (e) {
                console.error(e);
            }
        }
    }

    function finalizeSession() {
        persistAuthToStorage();
        var wasReady = sessionReady;
        sessionReady = !!authToken;
        if (sessionReady) {
            console.log("Flutter/Arena session ready", getSnapshot());
            if (!wasReady) notifyReady();
        }
        return getSnapshot();
    }

    function requestSessionFromFlutter() {
        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage({ type: "requestSessionParams" }, "*");
            }
        } catch (e) { /* ignore */ }
        try {
            if (global.flutter_inappwebview && global.flutter_inappwebview.callHandler) {
                global.flutter_inappwebview.callHandler("requestSessionParams");
            }
        } catch (e) { /* ignore */ }
    }

    function bindMessageListener() {
        if (messageListenerBound) return;
        messageListenerBound = true;
        global.addEventListener("message", function (event) {
            if (!event.data) return;
            if (event.data.type === "flutterParams" || event.data.type === "gameSession") {
                applySessionFields(event.data);
                if (event.data.data) applySessionFields(event.data.data);
                finalizeSession();
            }
        });
    }

    /** Catch late assignment: window.__GAME_SESSION__ = { ... } from Flutter. */
    function installPropertyTrap() {
        if (propertyTrapInstalled) return;
        propertyTrapInstalled = true;
        try {
            var current = global.__GAME_SESSION__;
            Object.defineProperty(global, "__GAME_SESSION__", {
                configurable: true,
                enumerable: true,
                get: function () {
                    return current;
                },
                set: function (value) {
                    current = value;
                    console.log("Flutter __GAME_SESSION__ assigned");
                    if (value && !isExpired(value)) {
                        applySessionFields(value);
                        finalizeSession();
                    }
                },
            });
            if (current) {
                applySessionFields(current);
            }
        } catch (e) {
            console.warn("Unable to trap __GAME_SESSION__", e);
        }
    }

    function readFromUrl() {
        poolId = getUrlParameter("poolId") || poolId;
        sessionId = getUrlParameter("sessionId") || sessionId;
        quizSessionId = getUrlParameter("quizSessionId") || quizSessionId;
        authToken =
            getUrlParameter("authToken") ||
            getUrlParameter("token") ||
            authToken;
        var urlTimer = getUrlParameter("timer");
        if (urlTimer) gameTimerDuration = parseInt(urlTimer, 10) || gameTimerDuration;
        var urlApi = getUrlParameter("apiServerUrl") || getUrlParameter("apiServer");
        if (urlApi) apiServerUrl = String(urlApi).replace(/\/$/, "");
    }

    function initFlutterParams() {
        installPropertyTrap();
        bindMessageListener();
        requestSessionFromFlutter();

        if (global.__GAME_SESSION__ && !isExpired(global.__GAME_SESSION__)) {
            applySessionFields(global.__GAME_SESSION__);
        } else {
            readFromUrl();
        }

        // Token / API base may persist across loads. In Arena WebView never reuse a
        // stale pool sessionId from localStorage — wait for fresh __GAME_SESSION__.
        try {
            if (!authToken) {
                authToken = localStorage.getItem("token") || authToken;
            }
            if (!apiServerUrl) {
                var storedApi = localStorage.getItem("quizApiBase");
                if (storedApi) apiServerUrl = String(storedApi).replace(/\/$/, "");
            }
            var allowStoredPool =
                !isArenaWebView() || wantsStandaloneLogin();
            if (allowStoredPool) {
                poolId = poolId || localStorage.getItem("arenaPoolId");
                sessionId = sessionId || localStorage.getItem("arenaPoolSessionId");
            }
        } catch (e) { /* ignore */ }

        return finalizeSession();
    }

    function startPolling(intervalMs) {
        if (pollTimer) return;
        intervalMs = intervalMs || 400;
        pollTimer = setInterval(function () {
            requestSessionFromFlutter();
            if (global.__GAME_SESSION__ && !isExpired(global.__GAME_SESSION__)) {
                applySessionFields(global.__GAME_SESSION__);
                finalizeSession();
            }
            if (sessionReady && isPoolMode()) {
                // keep polling lightly in case quiz payload arrives later
            }
        }, intervalMs);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    /**
     * Resolve when auth token is available (and pool fields if requirePool).
     * Keeps waiting — Flutter injects after page load.
     */
    function waitForSession(options) {
        options = options || {};
        var timeoutMs = options.timeoutMs; // undefined = wait forever (pool WebView)
        var requirePool = !!options.requirePool;
        var started = Date.now();

        return new Promise(function (resolve, reject) {
            var settled = false;

            function sessionOk(snap) {
                if (!snap || !snap.authToken) return false;
                if (!requirePool) return true;
                // Pool play: need the current try id from Flutter (not a stale token alone).
                return !!(snap.sessionId && (snap.poolId || snap.poolMode));
            }

            function done(snap) {
                if (settled) return;
                settled = true;
                resolve(snap);
            }

            function tick() {
                initFlutterParams();
                var snap = getSnapshot();
                if (sessionOk(snap)) {
                    done(snap);
                    return;
                }
                if (timeoutMs != null && Date.now() - started >= timeoutMs) {
                    reject(new Error("Timed out waiting for Arena session"));
                    return;
                }
                setTimeout(tick, 350);
            }

            onReadyCallbacks.push(function (snap) {
                if (sessionOk(snap)) done(snap);
            });

            startPolling(400);
            tick();
        });
    }

    function sendMessageToFlutter(type, data) {
        var message = { type: type, data: data };
        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage(message, "*");
            }
        } catch (e) { /* ignore */ }
        try {
            if (global.flutter_inappwebview && global.flutter_inappwebview.callHandler) {
                global.flutter_inappwebview.callHandler("onMessage", message);
            }
        } catch (e) { /* ignore */ }
        console.log("Flutter message:", message);
    }

    function closeFlutterWindow() {
        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage({ type: "closeGame" }, "*");
                return;
            }
        } catch (e) { /* ignore */ }
        try {
            if (global.flutter_inappwebview && global.flutter_inappwebview.callHandler) {
                global.flutter_inappwebview.callHandler("closeGame");
                return;
            }
        } catch (e) { /* ignore */ }
        try {
            global.close();
        } catch (e) {
            console.log("closeGame fallback");
        }
    }

    function storeQuizPlayState(quizData, extras) {
        extras = extras || {};
        var payload = Object.assign({}, quizData, {
            score: quizData.score ?? quizData.Score ?? extras.score ?? 0,
            poolMode: extras.poolMode ?? isPoolMode(),
            poolId: extras.poolId || poolId,
            poolSessionId: extras.poolSessionId || sessionId,
            gamePoolSessionId:
                quizData.gamePoolSessionId ||
                quizData.GamePoolSessionId ||
                extras.poolSessionId ||
                sessionId,
        });
        localStorage.setItem("quiz", JSON.stringify(payload));
        var qNum =
            extras.questionNumber ||
            quizData.currentQuestionNumber ||
            quizData.CurrentQuestionNumber ||
            1;
        localStorage.setItem("quizQuestionNumber", String(qNum));
        localStorage.setItem("quizRunningScore", String(payload.score ?? 0));
        return payload;
    }

    global.ArenaFlutterSession = {
        init: initFlutterParams,
        get: getSnapshot,
        waitForSession: waitForSession,
        startPolling: startPolling,
        stopPolling: stopPolling,
        isPoolMode: isPoolMode,
        isArenaWebView: isArenaWebView,
        wantsStandaloneLogin: wantsStandaloneLogin,
        sendMessageToFlutter: sendMessageToFlutter,
        closeFlutterWindow: closeFlutterWindow,
        storeQuizPlayState: storeQuizPlayState,
        getUrlParameter: getUrlParameter,
    };

    installPropertyTrap();
    initFlutterParams();
    startPolling(400);
})(window);
