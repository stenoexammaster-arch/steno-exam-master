// admin-feedback.js
// Feedback table with pagination + resolve action
// Backward compatible: old feedback docs without status will be treated as "new".

(function(){
  const PAGE_SIZE = 25;
  let lastDoc = null;
  let firstDoc = null;
  let pageStack = []; // for prev

  function tsToText(v){
    try {
      if (!v) return "-";
      if (typeof v === "number") return new Date(v).toLocaleString();
      if (v.toDate) return v.toDate().toLocaleString();
      return String(v);
    } catch { return "-"; }
  }

  function statusOf(doc){
    const d = doc || {};
    return String(d.status || "new");
  }

  function short(s, n=90){
    s = String(s || "");
    return s.length > n ? s.slice(0,n) + "…" : s;
  }

  async function loadPage(direction="next"){
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
      snap.forEach((doc)=>{
        const d = doc.data() || {};
        const st = statusOf(d);

        // status filter (client-side to keep compatibility)
        if (statusVal !== "all" && st !== statusVal) return;

        // search (client-side)
        const blob = `${d.email||""} ${d.message||""} ${d.page||""}`.toLowerCase();
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

  async function resolveFeedback(id){
    const ok = await window.ftAdminUI.confirmBox({
      title: "Resolve Feedback",
      message: "Mark this feedback as resolved?",
      okText: "Resolve"
    });
    if (!ok) return;

    try{
      await window.db.collection("feedback").doc(id).update({
        status: "resolved",
        resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      window.ftAdminUI?.toast("Marked resolved", "success");
      await loadPage("next"); // refresh current view
    }catch(e){
      console.error(e);
      window.ftAdminUI?.toast("Resolve failed", "error");
    }
  }

  async function openFeedback(id){
    // simple open: show full message using alert (can upgrade to modal later)
    try{
      const snap = await window.db.collection("feedback").doc(id).get();
      const d = snap.data() || {};
      alert(
        `Email: ${d.email || "-"}\nPage: ${d.page || "-"}\nStatus: ${d.status || "new"}\n\n${d.message || ""}`
      );
    }catch(e){
      window.ftAdminUI?.toast("Open failed", "error");
    }
  }

  function bind(){
    const tbody = document.getElementById("fb-tbody");
    document.getElementById("fb-next")?.addEventListener("click", ()=> loadPage("next"));
    document.getElementById("fb-prev")?.addEventListener("click", ()=> loadPage("prev"));
    document.getElementById("fb-filter-status")?.addEventListener("change", ()=> loadPage("next"));
    document.getElementById("fb-search")?.addEventListener("input", ()=> loadPage("next"));

    tbody?.addEventListener("click", (e)=>{
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!id) return;
      if (act === "resolve") resolveFeedback(id);
      if (act === "open") openFeedback(id);
    });
  }

  async function init(){
    bind();
    await loadPage("next");
  }

  window.ftAdminFeedback = { init, loadPage };
})();