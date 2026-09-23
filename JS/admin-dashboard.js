// admin-dashboard.js
// Loads KPIs safely without heavy full-collection scans.
// Uses optional doc: metrics/global for scalable counts.

(function(){
  async function loadKpis(){
    const kUsers = document.getElementById("kpi-users");
    const kBooks = document.getElementById("kpi-books");
    const kRandom = document.getElementById("kpi-random");
    const kFeedback = document.getElementById("kpi-feedback");

    if (!window.db) return;

    // 1) Small collections: ok to count via .get().size
    try {
      const booksSnap = await window.db.collection("books").get();
      if (kBooks) kBooks.textContent = booksSnap.size || "0";
    } catch {}

    try {
      const rndSnap = await window.db.collection("randomTexts").get();
      if (kRandom) kRandom.textContent = rndSnap.size || "0";
    } catch {}

    // 2) Big collections: prefer metrics/global (optional)
    try {
      const mSnap = await window.db.collection("metrics").doc("global").get();
      if (mSnap.exists) {
        const m = mSnap.data() || {};
        if (kUsers) kUsers.textContent = (m.usersCount ?? "—");
        if (kFeedback) kFeedback.textContent = (m.feedbackCount ?? "—");
      } else {
        if (kUsers) kUsers.textContent = "—";
        if (kFeedback) kFeedback.textContent = "—";
      }
    } catch (e) {
      if (kUsers) kUsers.textContent = "—";
      if (kFeedback) kFeedback.textContent = "—";
    }
  }

  window.ftAdminDashboard = { loadKpis };
})();