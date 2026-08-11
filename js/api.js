/** SixteenArena WebAPI base (matches admin panel default). Override via localStorage.quizApiBase */
const API_BASE_URL =
    localStorage.getItem("quizApiBase") ||
    "http://localhost:5006";

const APP_ID = "16arena";

function userLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("quiz");
    localStorage.removeItem("quizQuestionNumber");
    localStorage.removeItem("quizRunningScore");
    localStorage.removeItem("resultSession");
    localStorage.removeItem("otpToken");
    localStorage.removeItem("pendingEmail");
    window.location.href = "index.html";
}

function requireAuth() {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "index.html";
        return null;
    }
    return token;
}

function authHeaders(extra = {}) {
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
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: authHeaders(),
    });
    return parseApiResponse(response);
}

async function apiSend(path, method, body) {
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
