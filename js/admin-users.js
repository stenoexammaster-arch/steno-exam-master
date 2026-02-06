// admin-users.js
// View-only user listing
// - No role change from here
// - Shows basic info + copy UID
// - Also computes total users + per-role count and shows in Users section text

(function () {
  "use strict";

  const PAGE_SIZE = 25;
  let lastDoc = null;
  let pageStack = [];

  // for role stats
  let statsLoaded = false;
  let roleStats = null;

  function tsToText(v) {
    try {
      if (!v) return "-";
      if (typeof v === "number") return new Date(v).toLocaleDateString();
      if (v.toDate) return v.toDate().toLocaleDateString();
      return String(v);
    } catch {
      return "-";
    }
  }

  function shortUid(uid) {
    uid = String(uid || "");
    if (uid.length <= 10) return uid;
    return uid.slice(0, 6) + "…" + uid.slice(-4);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function computeRoleStatsOnce() {
    if (!window.db || statsLoaded) return;

    try {
      const snap = await window.db.collection("users").get();
      const stats = { total: snap.size, byRole: {} };

      snap.forEach((doc) => {
        const u = doc.data() || {};
        const role = String(u.role || "user");
        stats.byRole[role] = (stats.byRole[role] || 0) + 1;
      });

      roleStats = stats;
      statsLoaded = true;

      const desc = document.querySelector("#users-section .admin-section-description");
      if (desc) {
        const parts = [`Total: ${stats.total}`];
        Object.keys(stats.byRole)
          .sort()
          .forEach((role) => {
            parts.push(`${role}: ${stats.byRole[role]}`);
          });

        // Example text:
        // Users overview — Total: 120 • admin: 3 • editor: 2 • support: 1 • user: 114
        desc.textContent = `Users overview — ${parts.join(" • ")}`;
      }
    } catch (e) {
      console.error("User role stats load failed:", e);
    }
  }

  async function loadPage(direction = "next") {
    const tbody = document.getElementById("u-tbody");
    const roleFilter = document.getElementById("u-filter-role");
    const search = document.getElementById("u-search");
    if (!tbody || !window.db) return;

    tbody.innerHTML = `<tr><td colspan="5" class="td-muted">Loading…</td></tr>`;

    const roleVal = roleFilter ? roleFilter.value : "all";
    const qText = (search ? search.value.trim().toLowerCase() : "");

    let q = window.db.collection("users");

    // Prefer createdAt desc if present; fallback to docId
    try {
      q = q.orderBy("createdAt", "desc");
    } catch {
      q = q.orderBy(firebase.firestore.FieldPath.documentId(), "asc");
    }

    if (direction === "next" && lastDoc) {
      q = q.startAfter(lastDoc);
    }
    if (direction === "prev" && pageStack.length >= 2) {
      pageStack.pop();
      const prevStart = pageStack[pageStack.length - 1];
      q = q.startAt(prevStart);
    }

    q = q.limit(PAGE_SIZE);

    try {
      const snap = await q.get();
      if (snap.empty) {
        tbody.innerHTML = `<tr><td colspan="5" class="td-muted">No users found</td></tr>`;
        return;
      }

      const firstDoc = snap.docs[0];
      lastDoc = snap.docs[snap.docs.length - 1];
      if (direction === "next") pageStack.push(firstDoc);

      tbody.innerHTML = "";
      snap.forEach((doc) => {
        const u = doc.data() || {};
        const role = String(u.role || "user");
        const plan = String(u.plan || "free");

        // role filter (client-side)
        if (roleVal !== "all" && role !== roleVal) return;

        // search
        const blob = `${doc.id} ${u.name || ""} ${u.email || ""} ${role} ${plan}`.toLowerCase();
        if (qText && !blob.includes(qText)) return;

        const hoverInfo = `Name: ${u.name || "-"} | Email: ${u.email || "-"}`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td title="${escapeHtml(hoverInfo)}">${escapeHtml(shortUid(doc.id))}</td>
          <td>${escapeHtml(role)}</td>
          <td>${escapeHtml(plan)}</td>
          <td>${escapeHtml(tsToText(u.createdAt))}</td>
          <td>
            <button class="btn small secondary" data-act="copyuid" data-id="${doc.id}">Copy UID</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      if (!tbody.children.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="td-muted">No items match your filters</td></tr>`;
      }
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="5" class="td-muted">Error loading users</td></tr>`;
      window.ftAdminUI?.toast("Users load failed", "error");
    }
  }

  function bind() {
    document.getElementById("u-next")?.addEventListener("click", () =>
      loadPage("next")
    );
    document.getElementById("u-prev")?.addEventListener("click", () =>
      loadPage("prev")
    );
    document.getElementById("u-filter-role")?.addEventListener("change", () =>
      loadPage("next")
    );
    document.getElementById("u-search")?.addEventListener("input", () =>
      loadPage("next")
    );

    document.getElementById("u-tbody")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.act === "copyuid") {
        const uid = btn.dataset.id;
        try {
          await navigator.clipboard.writeText(uid);
          window.ftAdminUI?.toast("UID copied", "success");
        } catch {
          window.ftAdminUI?.toast("Copy failed", "error");
        }
      }
    });

    // NOTE: no "change role" listener here anymore – view-only panel.
  }

  async function init() {
    bind();
    // load global stats once (total + per-role)
    computeRoleStatsOnce();
    // then load first page
    await loadPage("next");
  }

  window.ftAdminUsers = { init, loadPage };
})();
