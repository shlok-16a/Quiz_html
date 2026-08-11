let authMode = "login"; // "login" | "register" | "otp"

function setAuthMode(mode) {
    authMode = mode;
    const isRegister = mode === "register";
    const isOtp = mode === "otp";

    document.getElementById("pageTitle").innerText = isOtp
        ? "Verify OTP"
        : isRegister
            ? "Create Account"
            : "Quiz Login";

    document.getElementById("registerFields").style.display = isRegister ? "block" : "none";
    document.getElementById("credentialsFields").style.display = isOtp ? "none" : "block";
    document.getElementById("otpFields").style.display = isOtp ? "block" : "none";

    document.getElementById("primaryBtn").innerText = isOtp
        ? "Verify OTP"
        : isRegister
            ? "Send OTP"
            : "Login";

    document.getElementById("authSwitchLink").innerText = isRegister || isOtp
        ? "Login here"
        : "Register here";
    document.getElementById("authSwitchText").innerText = isRegister || isOtp
        ? "Already have an account?"
        : "New player?";

    const hint = document.getElementById("loginHint");
    if (isOtp) {
        hint.innerText = "Enter the 4-digit OTP sent to your email. Dev wildcard: 9999";
    } else if (isRegister) {
        hint.innerText = "Create a player account (password min 6 chars). We'll send an OTP to verify.";
    } else {
        hint.innerText = "Player: use your registered email and password";
    }
}

function toggleAuthMode(event) {
    event.preventDefault();
    if (authMode === "login") {
        setAuthMode("register");
    } else {
        localStorage.removeItem("otpToken");
        localStorage.removeItem("pendingEmail");
        setAuthMode("login");
    }
}

async function submitAuth() {
    if (authMode === "otp") {
        await verifyOtp();
        return;
    }
    if (authMode === "register") {
        await register();
        return;
    }
    await login();
}

function storeSession(data) {
    const token = data?.accessToken || data?.AccessToken;
    if (!token) {
        throw new Error("No access token in response");
    }
    localStorage.setItem("token", token);
    localStorage.removeItem("otpToken");
    localStorage.removeItem("pendingEmail");
    if (data?.user?.displayName) {
        localStorage.setItem("displayName", data.user.displayName);
    }
}

async function register() {
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!fullName) {
        alert("Full name is required.");
        return;
    }
    if (!email) {
        alert("Email is required.");
        return;
    }
    if (!password || password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    try {
        const data = await apiSend("/api/v1/auth/email-login", "POST", {
            email,
            password,
            appId: APP_ID,
        });

        const otpToken = data?.otpToken || data?.OtpToken;
        if (!otpToken) {
            alert(data?.message || "OTP sent, but no otpToken returned.");
            return;
        }

        localStorage.setItem("otpToken", otpToken);
        localStorage.setItem("pendingEmail", email);
        localStorage.setItem("displayName", fullName);
        document.getElementById("otp").value = "";
        setAuthMode("otp");
    } catch (err) {
        console.error(err);
        alert(err.message || "Unable to register.");
    }
}

async function verifyOtp() {
    const otp = document.getElementById("otp").value.trim();
    const otpToken = localStorage.getItem("otpToken");

    if (!otpToken) {
        alert("OTP session expired. Please register again.");
        setAuthMode("register");
        return;
    }
    if (!/^\d{4}$/.test(otp)) {
        alert("Enter the 4-digit OTP.");
        return;
    }

    try {
        const data = await apiSend("/api/v1/auth/verify-otp", "POST", {
            otpToken,
            otp,
            appId: APP_ID,
        });
        storeSession(data);
        window.location.href = "categories.html";
    } catch (err) {
        console.error(err);
        alert(err.message || "Invalid OTP.");
    }
}

async function login() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email) {
        alert("Email is required.");
        return;
    }
    if (!password || password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    try {
        const data = await apiSend("/api/v1/auth/password-login", "POST", {
            email,
            password,
            appId: APP_ID,
        });
        storeSession(data);
        window.location.href = "categories.html";
    } catch (err) {
        console.error(err);
        alert(err.message || "Invalid email or password");
    }
}

// Redirect if already logged in
if (localStorage.getItem("token")) {
    window.location.href = "categories.html";
} else {
    setAuthMode("login");
}
