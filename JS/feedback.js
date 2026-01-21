// js/feedback.js
// Floating feedback / suggestion widget (bottom-right).
// Feedback Firestore collection: "feedback"

(function () {
  function createWidget() {
    // FAB button
    const fab = document.createElement("button");
    fab.className = "feedback-fab";
    fab.type = "button";
    fab.innerHTML = "💬<span class='feedback-fab-label'>Feedback</span>";

    // Panel
    const panel = document.createElement("div");
    panel.className = "feedback-panel feedback-hidden";
    panel.innerHTML = `
      <div class="feedback-header">
        <span>Feedback / Suggestion</span>
        <button type="button" class="feedback-close-btn">×</button>
      </div>
      <div class="feedback-body">
        <label>
          <span>Name</span>
          <input type="text" id="fb-name" placeholder="Your name (optional)" />
        </label>
        <label>
          <span>Location / City</span>
          <input type="text" id="fb-location" placeholder="Your city / state" />
        </label>
        <label>
          <span>Email (required)</span>
          <input type="email" id="fb-email" placeholder="you@example.com" required />
        </label>
        <label>
          <span>Feedback / Suggestion</span>
          <textarea
            id="fb-message"
            rows="4"
            placeholder="Write your feedback to improve Steno Master..."
          ></textarea>
        </label>
        <button type="button" id="fb-submit" class="btn primary full">
          Send feedback
        </button>
        <p id="fb-status" class="feedback-status"></p>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const closeBtn   = panel.querySelector(".feedback-close-btn");
    const submitBtn  = panel.querySelector("#fb-submit");
    const statusEl   = panel.querySelector("#fb-status");
    const nameEl     = panel.querySelector("#fb-name");
    const locationEl = panel.querySelector("#fb-location");
    const emailEl    = panel.querySelector("#fb-email");
    const msgEl      = panel.querySelector("#fb-message");

    // Try to prefill email from a saved user (optional)
    try {
      const u = JSON.parse(localStorage.getItem("sm_user") || "null");
      if (u?.email && !emailEl.value) emailEl.value = String(u.email);
      if (u?.name  && !nameEl.value)  nameEl.value  = String(u.name);
    } catch {}

    function openPanel() {
      panel.classList.remove("feedback-hidden");
    }
    function closePanel() {
      panel.classList.add("feedback-hidden");
    }

    fab.addEventListener("click", () => {
      if (panel.classList.contains("feedback-hidden")) openPanel();
      else closePanel();
    });
    closeBtn.addEventListener("click", closePanel);

    // Simple email validator
    function isValidEmail(v) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
    }

    // Optional: live validate
    function showEmailValidity() {
      if (!emailEl.value.trim()) {
        emailEl.setCustomValidity("Email is required");
      } else if (!isValidEmail(emailEl.value)) {
        emailEl.setCustomValidity("Please enter a valid email");
      } else {
        emailEl.setCustomValidity("");
      }
      emailEl.reportValidity?.();
    }
    emailEl.addEventListener("input", showEmailValidity);
    emailEl.addEventListener("blur", showEmailValidity);

    submitBtn.addEventListener("click", async () => {
      const name = nameEl.value.trim();
      const location = locationEl.value.trim();
      const email = emailEl.value.trim();
      const message = msgEl.value.trim();

      statusEl.textContent = "";
      statusEl.style.color = "#fca5a5";

      if (!email) {
        statusEl.textContent = "Email is required so we can reply.";
        emailEl.focus();
        return;
      }
      if (!isValidEmail(email)) {
        statusEl.textContent = "Please enter a valid email address.";
        emailEl.focus();
        return;
      }
      if (!message) {
        statusEl.textContent = "Please write some feedback.";
        msgEl.focus();
        return;
      }

      const payload = {
        name: name || null,
        location: location || null,
        email,                 // store email for reply
        message,
        page: window.location.pathname,
        createdAt: Date.now(),
      };

      if (window.db && window.firebase && firebase.firestore) {
        try {
          const ts =
            firebase.firestore.FieldValue &&
            firebase.firestore.FieldValue.serverTimestamp();
          if (ts) payload.createdAt = ts;

          await window.db.collection("feedback").add(payload);
          statusEl.style.color = "#bbf7d0";
          statusEl.textContent = "Thanks! Your feedback has been sent.";
          msgEl.value = "";
          setTimeout(() => {
            statusEl.textContent = "";
            closePanel();
          }, 1500);
        } catch (e) {
          console.error("Feedback save error:", e);
          statusEl.textContent =
            "Could not send to server. Please try again later.";
        }
      } else {
        // fallback: localStorage
        try {
          const key = "steno-feedback-local";
          const existing = JSON.parse(localStorage.getItem(key) || "[]");
          existing.push(payload);
          localStorage.setItem(key, JSON.stringify(existing));
          statusEl.style.color = "#bbf7d0";
          statusEl.textContent =
            "Saved locally (no server). Admin will not see this online.";
        } catch (e) {
          statusEl.textContent = "Could not save feedback.";
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createWidget);
  } else {
    createWidget();
  }
})();