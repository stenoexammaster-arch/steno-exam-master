// js/main.js
document.addEventListener("DOMContentLoaded", () => {
  const toolsToggle = document.getElementById("tools-toggle");
  const toolsPanel = document.getElementById("tools-panel");
  const toolsOverlay = document.getElementById("tools-overlay");
  const toolsClose = document.getElementById("tools-close");
  const tabs = document.querySelectorAll(".tools-tab");
  const modules = document.querySelectorAll(".tool-module");

  function openTools() {
    toolsPanel.classList.add("open");
    toolsOverlay.classList.remove("hidden");
  }

  function closeTools() {
    toolsPanel.classList.remove("open");
    toolsOverlay.classList.add("hidden");
  }

  toolsToggle.addEventListener("click", openTools);
  toolsClose.addEventListener("click", closeTools);
  toolsOverlay.addEventListener("click", closeTools);

  // Switch modules (Typing / Date)
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetId = tab.dataset.moduleTarget;

      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      modules.forEach(m => {
        if (m.id === targetId) m.classList.add("active");
        else m.classList.remove("active");
      });
    });
  });

  // Date / Day calculator
  const dateCalcBtn = document.getElementById("date-calc-btn");
  const dateStartEl = document.getElementById("date-start");
  const dateEndEl = document.getElementById("date-end");
  const dateResultEl = document.getElementById("date-result");

  if (dateCalcBtn) {
    dateCalcBtn.addEventListener("click", () => {
      const startVal = dateStartEl.value;
      const endVal = dateEndEl.value;

      if (!startVal || !endVal) {
        dateResultEl.textContent = "Please select both start and end dates.";
        return;
      }

      const start = new Date(startVal);
      const end = new Date(endVal);
      if (end < start) {
        dateResultEl.textContent = "End date must be after start date.";
        return;
      }

      const diffMs = end - start;
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      const diffWeeks = (diffDays / 7).toFixed(1);

      const dayNameStart = start.toLocaleDateString("en-IN", { weekday: "long" });
      const dayNameEnd = end.toLocaleDateString("en-IN", { weekday: "long" });

      dateResultEl.innerHTML = `
        <p>Days between: <strong>${diffDays}</strong></p>
        <p>Approx. weeks: <strong>${diffWeeks}</strong></p>
        <p>Start day: <strong>${dayNameStart}</strong> | End day: <strong>${dayNameEnd}</strong></p>
      `;
    });
  }
});