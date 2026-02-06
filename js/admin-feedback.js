// admin-feedback.js
// Feedback table with pagination + resolve action
// Backward compatible: old feedback docs without status will be treated as "new".
// Now also shows any attached files when opening a feedback.

(function () {
  "use strict";

  const PAGE_SIZE = 25;
  let lastDoc = null;
  let firstDoc = null;
  let pageStack = []; // for prev

  function tsToText(v) {
    try {
      if (!v) return "-";
      if (typeof v === "number") return new Date(v).toLocaleString();
      if (v.toDate) return v.toDate().toLocaleString();
      return String(v);
    } catch {
      return "-";
    }
  }

  function statusOf(doc) {
    const d = doc || {};
    return String(d.status || "new");
  }

  function short(s, n = 90) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
  }

  // Try to normalize attachments from different possible field names
  function normalizeAttachments(d) {
    const out = [];
    if (!d || typeof d !== "object") return out;

    // attachments: [string] or [{url, name}]
    if (Array.isArray(d.attachments)) {
      d.attachments.forEach((item, idx) => {
        if (!item) return;
        if (typeof item === "string") {
          out.push({ url: item, label: `Attachment ${idx + 1}` });
        } else if (item.url) {
          out.push({
            url: item.url,
            label: item.name || item.fileName || `Attachment ${idx + 1}`,
          });
        }
      });
    }

    // files: [string] or [{url, name}]
    if (Array.isArray(d.files)) {
      d.files.forEach((item, idx) => {
        if (!item) return;
        if (typeof item === "string") {
          out.push({ url: item, label: `File ${idx + 1}` });
        } else if (item.url) {
          out.push({
            url: item.url,
            label: item.name || item.fileName || `File ${idx + 1}`,
          });
        }
      });
    }

    // Single-url fields (most common patterns)
    const singleUrlFields = [
      ["fileUrl", "fileName"],
      ["fileURL", "fileName"],
      ["attachmentUrl", "attachmentName"],
      ["attachmentURL", "attachmentName"],
    ];

    singleUrlFields.forEach(([urlKey, nameKey]) => {
      const url = d[urlKey];
      if (typeof url === "string") {
        out.push({
          url,
          label: d[nameKey] || "Attachment",
        });
      }
    });

    // de-dupe by URL
    const seen = new Set();
    return out.filter((att) => {
      if (!att.url) return false;
      if (seen.has(att.url)) return false;
      seen.add(att.url);
      return true;
    });
  }

  async function loadPage(direction = "next") {
    const tbody = document.getElementById("fb-tbody");
    const filter = document.getElementById("fb-filter-status");
    const search = document.getElementById("fb-search");
    if (!tbody || !window.db) return;

    tbody.innerHTML = `<tr><td colspan="6" class="td-muted">Loading…</td></tr>`;

    const statusVal = filter ? filter.value : "all";
    const qText = (search ? search.value.trim().toLowerCase() : "");

    let q = window.db.collection("feedback");

    // Order: createdAt desc; fallback if mixed types error
    try {
      q = q.orderBy("createdAt", "desc");
    } catch {
      q = q.orderBy(firebase.firestore.FieldPath.documentId(), "desc");
    }

    if (direction === "next" && lastDoc) q = q.startAfter(lastDoc);
    if (direction === "prev" && pageStack.length >= 2) {
      // pop current, then get previous start
      pageStack.pop();
      const prevStart = pageStack[pageStack.length - 1];
      q = q.startAt(prevStart);
    }

    q = q.limit(PAGE_SIZE);

    try {
      const snap = await q.get();
      if (snap.empty) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-muted">No feedback found</td></tr>`;
        return;
      }

      firstDoc = snap.docs[0];
      lastDoc = snap.docs[snap.docs.length - 1];

      // push page start
      if (direction === "next") pageStack.push(firstDoc);

      tbody.innerHTML = "";
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const st = statusOf(d);

        // status filter (client-side to keep compatibility)
        if (statusVal !== "all" && st !== statusVal) return;

        // search (client-side)
        const blob = `${d.email || ""} ${d.message || ""} ${d.page || ""}`.toLowerCase();
        if (qText && !blob.includes(qText)) return;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${tsToText(d.createdAt)}</td>
          <td>${d.email || "-"}</td>
          <td>${d.page || "-"}</td>
          <td>${short(d.message, 120)}</td>
          <td><span>${st}</span></td>
          <td>
            <button class="btn small" data-act="open" data-id="${doc.id}">Open</button>
            <button class="btn small secondary" data-act="resolve" data-id="${doc.id}">Resolve</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      if (!tbody.children.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="td-muted">No items match your filters</td></tr>`;
      }
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="6" class="td-muted">Error loading feedback</td></tr>`;
      window.ftAdminUI?.toast("Feedback load failed", "error");
    }
  }

  async function resolveFeedback(id) {
    const ok = await window.ftAdminUI.confirmBox({
      title: "Resolve Feedback",
      message: "Mark this feedback as resolved?",
      okText: "Resolve",
    });
    if (!ok) return;

    try {
      await window.db
        .collection("feedback")
        .doc(id)
        .update({
          status: "resolved",
          resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      window.ftAdminUI?.toast("Marked resolved", "success");
      await loadPage("next"); // refresh current view
    } catch (e) {
      console.error(e);
      window.ftAdminUI?.toast("Resolve failed", "error");
    }
  }

  async function openFeedback(id) {
    try {
      const snap = await window.db.collection("feedback").doc(id).get();
      const d = snap.data() || {};
      const attachments = normalizeAttachments(d);

      // Try to open a new window with nicely formatted HTML
      const popup = window.open(
        "",
        "_blank",
        "width=720,height=600,scrollbars=yes,resizable=yes"
      );

      const baseInfoText = `Name: ${d.name || "-"}
Email: ${d.email || "-"}
Location: ${d.location || "-"}
Page: ${d.page || "-"}
Status: ${d.status || "new"}
Created: ${tsToText(d.createdAt)}`;

      if (!popup) {
        // Popup blocked – fallback to alert with attachment URLs in plain text
        let msg =
          baseInfoText +
          "\n\nMessage:\n" +
          (d.message || "");

        if (attachments.length) {
          msg += "\n\nAttachments:\n";
          attachments.forEach((att, idx) => {
            msg += `${idx + 1}) ${att.label || "Attachment"}: ${att.url}\n`;
          });
        }
        alert(msg);
        return;
      }

      const doc = popup.document;
      doc.open();
      doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8" />`);
      doc.write(
        `<title>${escapeHtml(
          `Feedback from ${d.email || "-"}`
        )}</title>`
      );
      doc.write(`
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            margin: 16px;
            line-height: 1.5;
            background: #0b1120;
            color: #e5e7eb;
          }
          h1 { font-size: 1.3rem; margin-bottom: 0.5rem; }
          h2 { font-size: 1rem; margin-top: 1.5rem; }
          pre {
            white-space: pre-wrap;
            background: #020617;
            border: 1px solid #1f2937;
            color: #e5e7eb;
            padding: 10px 12px;
            border-radius: 4px;
            font-size: 0.9rem;
          }
          a { color: #3b82f6; }
          ul { padding-left: 1.2rem; }
          li { margin-bottom: 0.75rem; }
          img, video {
            max-width: 100%;
            height: auto;
            margin-top: 4px;
            border-radius: 4px;
            border: 1px solid #1f2937;
          }
        </style>
      </head><body>`);

      doc.write(`<h1>Feedback detail</h1>`);
      doc.write(
        `<p>
          <b>Name:</b> ${escapeHtml(d.name || "-")}<br/>
          <b>Email:</b> ${escapeHtml(d.email || "-")}<br/>
          <b>Location:</b> ${escapeHtml(d.location || "-")}<br/>
          <b>Page:</b> ${escapeHtml(d.page || "-")}<br/>
          <b>Status:</b> ${escapeHtml(d.status || "new")}<br/>
          <b>Created:</b> ${escapeHtml(tsToText(d.createdAt))}
        </p>`
      );

      doc.write(`<h2>Message</h2>`);
      doc.write(`<pre>${escapeHtml(d.message || "")}</pre>`);

      if (attachments.length) {
        doc.write(`<h2>Attachments</h2><ul>`);
        attachments.forEach((att) => {
          const url = att.url || "#";
          const href = escapeAttr(url);
          const label = escapeHtml(att.label || url);
          const lower = url.toLowerCase();

          doc.write("<li>");
          doc.write(
            `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
          );

          // inline preview for common image extensions
          if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(lower)) {
            doc.write(`<br/><img src="${href}" alt="${label}" />`);
          }
          // inline preview for common video extensions
          else if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/.test(lower)) {
            doc.write(
              `<br/><video controls src="${href}">Your browser does not support video.</video>`
            );
          }

          doc.write("</li>");
        });
        doc.write(`</ul>`);
      } else {
        doc.write(`<p><i>No file attachments.</i></p>`);
      }

      doc.write(`</body></html>`);
      doc.close();
    } catch (e) {
      console.error(e);
      window.ftAdminUI?.toast("Open failed", "error");
    }
  }

  function bind() {
    const tbody = document.getElementById("fb-tbody");
    document.getElementById("fb-next")?.addEventListener("click", () =>
      loadPage("next")
    );
    document.getElementById("fb-prev")?.addEventListener("click", () =>
      loadPage("prev")
    );
    document.getElementById("fb-filter-status")?.addEventListener("change", () =>
      loadPage("next")
    );
    document.getElementById("fb-search")?.addEventListener("input", () =>
      loadPage("next")
    );

    tbody?.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!id) return;
      if (act === "resolve") resolveFeedback(id);
      if (act === "open") openFeedback(id);
    });
  }

  async function init() {
    bind();
    await loadPage("next");
  }

  window.ftAdminFeedback = { init, loadPage };
})();
