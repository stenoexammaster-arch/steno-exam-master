// js/nav-auth.js
// Navbar login/logout display + 30-minute inactivity auto-logout

window.addEventListener("DOMContentLoaded", () => {
  if (!window.firebase || !window.auth) return;

  const loginLink = document.getElementById("nav-login-link");
  const logoutBtn = document.getElementById("nav-logout-btn");
  const userInfo = document.getElementById("nav-user-info");

  const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
  let inactivityTimer = null;
  const activityEvents = ["mousemove", "keydown", "click", "scroll", "touchstart"];

  function resetInactivityTimer() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
      try {
        await auth.signOut();
        alert("You were logged out due to 30 minutes of inactivity.");
        window.location.href = "login.html";
      } catch (e) {
        console.error("Auto logout failed", e);
      }
    }, INACTIVITY_LIMIT_MS);
  }

  function setupInactivityTracking() {
    activityEvents.forEach((ev) => {
      document.addEventListener(ev, resetInactivityTimer);
    });
    resetInactivityTimer();
  }

  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      if (loginLink) loginLink.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");
      if (userInfo) {
        userInfo.classList.remove("hidden");
        userInfo.textContent = user.email
          ? `Logged in: ${user.email}`
          : "Logged in";
      }
      setupInactivityTracking();
    } else {
      if (loginLink) loginLink.classList.remove("hidden");
      if (logoutBtn) logoutBtn.classList.add("hidden");
      if (userInfo) {
        userInfo.classList.add("hidden");
        userInfo.textContent = "";
      }
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await auth.signOut();
        window.location.href = "login.html";
      } catch (e) {
        console.error("Logout error", e);
      }
    });
  }
});