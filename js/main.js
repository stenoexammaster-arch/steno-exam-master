// js/main.js
// Shared navbar + auto-logout + basic page guards

(function () {
  const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
  const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

  let inactivityTimer = null;

  function getPageId() {
    const body = document.body;
    return body ? (body.getAttribute("data-page") || "") : "";
  }

  function redirectToLogin(reason) {
    const url = new URL("login.html", window.location.href);
    if (reason) url.searchParams.set("reason", reason);
    window.location.href = url.toString();
  }

  function updateNavForUser(user) {
    const loginLink = document.getElementById("nav-login-link");
    const logoutBtn = document.getElementById("nav-logout-btn");
    const userInfo  = document.getElementById("nav-user-info");

    if (!loginLink && !logoutBtn && !userInfo) return;

    if (user) {
      if (loginLink) loginLink.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");
      if (userInfo) {
        userInfo.classList.remove("hidden");
        userInfo.textContent = user.email
          ? `Logged in: ${user.email}`
          : (user.phoneNumber ? `Logged in: ${user.phoneNumber}` : "Logged in");
      }
    } else {
      if (loginLink) loginLink.classList.remove("hidden");
      if (logoutBtn) logoutBtn.classList.add("hidden");
      if (userInfo) {
        userInfo.classList.add("hidden");
        userInfo.textContent = "";
      }
    }
  }

  function clearInactivityTimer() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function resetInactivityTimer() {
    const user = firebase.auth().currentUser;
    if (!user) {
      clearInactivityTimer();
      return;
    }
    clearInactivityTimer();
    inactivityTimer = setTimeout(async () => {
      try {
        await auth.signOut();
        alert("You were logged out due to 30 minutes of inactivity.");
        redirectToLogin("idle");
      } catch (e) {
        console.error("Auto logout failed", e);
      }
    }, INACTIVITY_LIMIT_MS);
  }

  function setupInactivityTracking() {
    ACTIVITY_EVENTS.forEach((ev) => {
      document.addEventListener(ev, resetInactivityTimer, { passive: true });
    });
    resetInactivityTimer();
  }

  function removeInactivityTracking() {
    ACTIVITY_EVENTS.forEach((ev) => {
      document.removeEventListener(ev, resetInactivityTimer);
    });
    clearInactivityTimer();
  }

  // Simple guards: only check "logged in", email verification ka check yahan se hata diya
  function runPageGuards(user) {
    const page = getPageId();

    if (page === "book") {
      if (!user) {
        redirectToLogin("not_logged_in");
        return;
      }
    } else if (page === "admin") {
      if (!user) {
        redirectToLogin("not_logged_in");
        return;
      }
    } else if (page === "login") {
      // Login page par koi auto-redirect nahi,
      // bas reason query ko auth.js me message ke liye use karenge
    }
  }

  function initNavAndGuards() {
    if (!window.firebase || !window.auth) return;

    const logoutBtn = document.getElementById("nav-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await auth.signOut();
          // Simple: logout ke baad seedha login page dikhao
          redirectToLogin("logged_out");
        } catch (e) {
          console.error("Logout error", e);
        }
      });
    }

    firebase.auth().onAuthStateChanged((user) => {
      updateNavForUser(user);

      if (user) {
        setupInactivityTracking();
      } else {
        removeInactivityTracking();
      }

      runPageGuards(user);
    });
  }

  document.addEventListener("DOMContentLoaded", initNavAndGuards);
})();