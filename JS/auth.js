// js/auth.js
// Email/password signup + login + email verification + trialStart + forgot password
// + Phone OTP login (Firebase Phone Auth)

(function () {
  // -------- Helper: read ?reason=... and show message on login panel --------
  function showLoginReasonMessage() {
    const msgLogin = document.getElementById("auth-message-login");
    if (!msgLogin) return;

    const url = new URL(window.location.href);
    const reason = url.searchParams.get("reason");
    if (!reason) return;

    msgLogin.style.color = "#fca5a5";
    if (reason === "not_logged_in") {
      msgLogin.textContent = "Please log in to continue.";
    } else if (reason === "verify_email") {
      msgLogin.textContent =
        "Please verify your email first. Check your inbox and spam folder.";
    } else if (reason === "idle") {
      msgLogin.textContent =
        "You were logged out because of inactivity. Please log in again.";
    } else if (reason === "logged_out") {
      msgLogin.textContent = "You have been logged out.";
    }
  }

  // -------- Simple captcha helper (signup) --------
  function getCaptchaTokenOrNull() {
    if (window.grecaptcha && typeof grecaptcha.getResponse === "function") {
      return grecaptcha.getResponse();
    }
    return null;
  }

  function resetCaptchaIfPresent() {
    if (window.grecaptcha && typeof grecaptcha.reset === "function") {
      grecaptcha.reset();
    }
  }

  // -------- Phone Auth (OTP) helpers --------
  let phoneRecaptchaVerifier = null;
  let phoneConfirmationResult = null;

  function setupPhoneRecaptcha() {
    if (phoneRecaptchaVerifier) return;
    if (!window.firebase || !firebase.auth) return;

    phoneRecaptchaVerifier = new firebase.auth.RecaptchaVerifier(
      "phone-recaptcha-container",
      {
        size: "invisible",
        callback: function () {
          // auto-resolve
        }
      }
    );
  }

  async function sendPhoneOtp() {
    const phoneInput = document.getElementById("phone-login-number");
    const msgPhone = document.getElementById("auth-message-phone");
    if (!phoneInput || !msgPhone) return;

    const phone = phoneInput.value.trim();
    msgPhone.textContent = "";
    msgPhone.style.color = "#fca5a5";

    if (!phone) {
      msgPhone.textContent =
        "Enter your mobile number with country code, e.g. +91XXXXXXXXXX";
    return;
    }

    try {
      setupPhoneRecaptcha();
      if (!phoneRecaptchaVerifier) {
        msgPhone.textContent =
          "reCAPTCHA is not ready. Please reload the page.";
        return;
      }

      phoneConfirmationResult = await auth.signInWithPhoneNumber(
        phone,
        phoneRecaptchaVerifier
      );

      msgPhone.style.color = "#bbf7d0";
      msgPhone.textContent = "OTP sent to your mobile. Please check SMS.";
    } catch (err) {
      console.error("Phone OTP send error:", err);
      msgPhone.textContent =
        err.message || "Failed to send OTP. Check Firebase Phone Auth setup.";
      try {
        if (phoneRecaptchaVerifier) phoneRecaptchaVerifier.clear();
        phoneRecaptchaVerifier = null;
      } catch (e) {}
    }
  }

  async function verifyPhoneOtp() {
    const codeInput = document.getElementById("phone-otp-code");
    const msgPhone = document.getElementById("auth-message-phone");
    if (!codeInput || !msgPhone) return;

    const code = codeInput.value.trim();
    msgPhone.textContent = "";
    msgPhone.style.color = "#fca5a5";

    if (!code) {
      msgPhone.textContent = "Enter the OTP sent to your phone.";
      return;
    }

    if (!phoneConfirmationResult) {
      msgPhone.textContent = "Please click 'Send OTP' first.";
      return;
    }

    try {
      const result = await phoneConfirmationResult.confirm(code);
      const user = result.user;

      await window.db
        .collection("users")
        .doc(user.uid)
        .set(
          {
            phone: user.phoneNumber || null,
            email: user.email || null,
            role: "user",
            trialStart: firebase.firestore.FieldValue.serverTimestamp(),
            subscribed: false,
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );

      msgPhone.style.color = "#bbf7d0";
      msgPhone.textContent = "Phone login successful. Redirecting...";
      window.location.href = "book.html";
    } catch (err) {
      console.error("Phone OTP verify error:", err);
      msgPhone.textContent =
        err.message || "OTP verification failed. Please try again.";
    }
  }

  // -------- DOM Ready: setup events --------
  window.addEventListener("DOMContentLoaded", () => {
    // Tabs
    const tabs = document.querySelectorAll(".auth-tab");
    const signinPanel = document.getElementById("signin-panel");
    const signupPanel = document.getElementById("signup-panel");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        const target = tab.dataset.target;
        if (target === "signin-panel") {
          signinPanel.classList.remove("hidden");
          signupPanel.classList.add("hidden");
        } else {
          signupPanel.classList.remove("hidden");
          signinPanel.classList.add("hidden");
        }
      });
    });

    // Buttons
    const loginBtn = document.getElementById("email-login-btn");
    const signupBtn = document.getElementById("email-signup-btn");
    const forgotBtn = document.getElementById("forgot-password-btn");
    const resendBtn = document.getElementById("resend-verification-btn");
    const checkBtn = document.getElementById("check-verification-btn");
    const phoneSendBtn = document.getElementById("phone-send-otp-btn");
    const phoneVerifyBtn = document.getElementById("phone-verify-otp-btn");

    loginBtn?.addEventListener("click", emailLogin);
    signupBtn?.addEventListener("click", emailSignup);
    forgotBtn?.addEventListener("click", sendPasswordReset);
    resendBtn?.addEventListener("click", resendVerificationEmail);
    checkBtn?.addEventListener("click", checkVerificationAndRedirect);
    phoneSendBtn?.addEventListener("click", sendPhoneOtp);
    phoneVerifyBtn?.addEventListener("click", verifyPhoneOtp);

    // Email/Phone toggle in Sign In
    const emailBlock = document.getElementById("email-login-block");
    const phoneBlock = document.getElementById("phone-login-block");
    const showPhoneBtn = document.getElementById("show-phone-login-btn");
    const backToEmailBtn = document.getElementById("back-to-email-login-btn");

    showPhoneBtn?.addEventListener("click", () => {
      if (emailBlock) emailBlock.classList.add("hidden");
      if (phoneBlock) phoneBlock.classList.remove("hidden");
    });

    backToEmailBtn?.addEventListener("click", () => {
      if (phoneBlock) phoneBlock.classList.add("hidden");
      if (emailBlock) emailBlock.classList.remove("hidden");
    });

    // Password show/hide
    document.querySelectorAll(".password-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        const input = document.getElementById(targetId);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        btn.textContent = isPassword ? "🙈" : "👁";
      });
    });

    showLoginReasonMessage();
  });

  // -------- SIGN IN (Email) --------

  async function emailLogin() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();
    const msg = document.getElementById("auth-message-login");
    const unverifiedBlock = document.getElementById("login-unverified-actions");

    msg.textContent = "";
    msg.style.color = "#fca5a5";
    if (unverifiedBlock) unverifiedBlock.classList.add("hidden");

    if (!email || !password) {
      msg.textContent = "Please enter email and password.";
      return;
    }

    try {
      const cred = await window.auth.signInWithEmailAndPassword(
        email,
        password
      );
      const user = cred.user;

      if (!user.emailVerified) {
        msg.textContent =
          "Logged in, but your email is not verified. Please check your inbox or use the options below.";
        if (unverifiedBlock) unverifiedBlock.classList.remove("hidden");
        return;
      }

      msg.style.color = "#bbf7d0";
      msg.textContent = "Login successful. Redirecting...";
      window.location.href = "book.html";
    } catch (err) {
      console.error("Login error", err);
      msg.textContent = err.message || "Login failed. Please try again.";
    }
  }

  // -------- RESEND VERIFICATION EMAIL --------

  async function resendVerificationEmail() {
    const msg = document.getElementById("auth-message-login");
    msg.textContent = "";
    msg.style.color = "#fca5a5";

    const user = auth.currentUser;
    if (!user) {
      msg.textContent = "Please log in first, then click 'Resend verification'.";
      return;
    }

    try {
      await user.sendEmailVerification();
      msg.style.color = "#bbf7d0";
      msg.textContent =
        "Verification email sent again. Please check your inbox and spam.";
    } catch (err) {
      console.error("Resend verification error", err);
      msg.textContent = err.message || "Could not resend verification email.";
    }
  }

  // -------- CHECK VERIFICATION & REDIRECT --------

  async function checkVerificationAndRedirect() {
    const msg = document.getElementById("auth-message-login");
    msg.textContent = "";
    msg.style.color = "#fca5a5";

    const user = auth.currentUser;
    if (!user) {
      msg.textContent =
        "You are not logged in. Please log in again and then check verification.";
      return;
    }

    try {
      await user.reload();
      const freshUser = auth.currentUser;
      if (freshUser && freshUser.emailVerified) {
        msg.style.color = "#bbf7d0";
        msg.textContent = "Email verified. Redirecting...";
        window.location.href = "book.html";
      } else {
        msg.textContent =
          "Email still not verified. Please click the verification link in your inbox first.";
      }
    } catch (err) {
      console.error("Check verification error", err);
      msg.textContent = err.message || "Could not check verification status.";
    }
  }

  // -------- FORGOT PASSWORD --------

  async function sendPasswordReset() {
    const email = document.getElementById("login-email").value.trim();
    const msg = document.getElementById("auth-message-login");

    msg.textContent = "";
    msg.style.color = "#fca5a5";

    if (!email) {
      msg.textContent =
        "Enter your email above, then click Forgot password.";
      return;
    }

    try {
      await window.auth.sendPasswordResetEmail(email);
      msg.style.color = "#bbf7d0";
      msg.textContent = "Password reset link sent to your email.";
    } catch (err) {
      console.error("Reset error", err);
      msg.textContent = err.message || "Failed to send reset email.";
    }
  }

  // -------- SIGN UP / CREATE ACCOUNT (Email) --------

  async function emailSignup() {
    const name = document.getElementById("signup-name").value.trim();
    const phone = document.getElementById("signup-phone").value.trim();
    const address = document.getElementById("signup-address").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value.trim();
    const msg = document.getElementById("auth-message-signup");

    msg.textContent = "";
    msg.style.color = "#fca5a5";

    if (!name || !email || !password) {
      msg.textContent = "Name, email, and password are required.";
      return;
    }

    // Captcha OPTIONAL: if not configured, just continue
    const token = getCaptchaTokenOrNull();
    if (!token) {
      console.warn(
        "reCAPTCHA token missing/invalid on signup. Continuing without CAPTCHA. " +
          "Configure YOUR_RECAPTCHA_SITE_KEY or remove the widget."
      );
    }

    try {
      const result = await window.auth.createUserWithEmailAndPassword(
        email,
        password
      );
      const user = result.user;

      try {
        await user.updateProfile({ displayName: name });
      } catch (e) {
        console.warn("updateProfile failed:", e);
      }

      await window.db
        .collection("users")
        .doc(user.uid)
        .set({
          name,
          phone: phone || null,
          address: address || null,
          email,
          role: "user",
          trialStart: firebase.firestore.FieldValue.serverTimestamp(),
          subscribed: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      try {
        await user.sendEmailVerification();
      } catch (e) {
        console.error("Verification email error:", e);
      }

      resetCaptchaIfPresent();

      msg.style.color = "#bbf7d0";
      msg.textContent =
        "Account created and verification email sent. Please verify from your inbox, then sign in from the Sign In tab.";
    } catch (err) {
      console.error("Signup error", err);
      msg.textContent =
        err.message || "Could not create account. Please try again.";
      resetCaptchaIfPresent();
    }
  }

  // Expose for debug if needed
  window.ftAuth = {
    emailLogin,
    emailSignup,
    sendPasswordReset,
    resendVerificationEmail,
    checkVerificationAndRedirect,
    sendPhoneOtp,
    verifyPhoneOtp
  };
})();