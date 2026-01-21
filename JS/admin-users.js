// admin-users.js
// Basic user listing + role change (admin/editor/support/user)
// Backward compatible: missing fields show "-"

(function(){
  const PAGE_SIZE = 25;
  let lastDoc = null;
  let pageStack = [];

  function tsToText(v){
    try {
      if (!v) return "-";
      if (typeof v === "number") return new Date(v).toLocaleDateString();
      if (v.toDate) return v.toDate().toLocaleDateString();
      return String(v);
    } catch { return "-"; }
  }

  function shortUid(uid){
    uid = String(uid||"");
    if (uid.length <= 10) return uid;
    return uid.slice(0,6) + "…" + uid.slice(-4);
  }

  async function loadPage(direction="next"){
    const tbody = document.getElementById("u-tbody");
    const roleFilter = document.getElementById("u-filter-role");
    const search = document.getElementById("u-search");
    if (!tbody || !window.db) return;

    tbody.innerHTML = `<tr><td colspan="5" class="td-muted">Loading…</td></tr>`;

    const roleVal = roleFilter ? roleFilter.value : "all";
    const qText = (search ? search.value.trim().toLowerCase() : "");

    let q = window.db.collection("users");

    // Prefer createdAt desc if present; fallback to docId
    try{
      q = q.orderBy("createdAt", "desc");
    }catch{
      q = q.orderBy(firebase.firestore.FieldPath.documentId(), "asc");
    }

    if (direction === "next" && lastDoc) q = q.startAfter(lastDoc);
    if (direction === "prev" && pageStack.length >= 2) {
      pageStack.pop();
      const prevStart = pageStack[pageStack.length - 1];
      q = q.startAt(prevStart);
    }

    q = q.limit(PAGE_SIZE);

    try{
      const snap = await q.get();
      if (snap.empty){
        tbody.innerHTML = `<tr><td colspan="5" class="td-muted">No users found</td></tr>`;
        return;
      }

      const firstDoc = snap.docs[0];
      lastDoc = snap.docs[snap.docs.length - 1];
      if (direction === "next") pageStack.push(firstDoc);

      tbody.innerHTML = "";
      snap.forEach((doc)=>{
        const u = doc.data() || {};
        const role = String(u.role || "user");
        const plan = String(u.plan || "free");

        if (roleVal !== "all" && role !== roleVal) return;

        const blob = `${doc.id} ${u.name||""} ${u.email||""} ${role} ${plan}`.toLowerCase();
        if (qText && !blob.includes(qText)) return;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td title="${doc.id}">${shortUid(doc.id)}</td>
          <td>
            <select class="test-select" data-act="role" data-id="${doc.id}">
              <option value="admin" ${role==="admin"?"selected":""}>admin</option>
              <option value="editor" ${role==="editor"?"selected":""}>editor</option>
              <option value="support" ${role==="support"?"selected":""}>support</option>
              <option value="user" ${role==="user"?"selected":""}>user</option>
            </select>
          </td>
          <td>${plan}</td>
          <td>${tsToText(u.createdAt)}</td>
          <td>
            <button class="btn small secondary" data-act="copyuid" data-id="${doc.id}">Copy UID</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      if (!tbody.children.length){
        tbody.innerHTML = `<tr><td colspan="5" class="td-muted">No items match your filters</td></tr>`;
      }
    }catch(e){
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="5" class="td-muted">Error loading users</td></tr>`;
      window.ftAdminUI?.toast("Users load failed", "error");
    }
  }

  async function changeRole(uid, newRole){
    const ok = await window.ftAdminUI.confirmBox({
      title: "Change Role",
      message: `Change role of ${uid} to "${newRole}"?`,
      okText: "Change"
    });
    if (!ok) return false;

    try{
      await window.db.collection("users").doc(uid).set({
        role: newRole,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      window.ftAdminUI?.toast("Role updated", "success");
      return true;
    }catch(e){
      console.error(e);
      window.ftAdminUI?.toast("Role update failed", "error");
      return false;
    }
  }

  function bind(){
    document.getElementById("u-next")?.addEventListener("click", ()=> loadPage("next"));
    document.getElementById("u-prev")?.addEventListener("click", ()=> loadPage("prev"));
    document.getElementById("u-filter-role")?.addEventListener("change", ()=> loadPage("next"));
    document.getElementById("u-search")?.addEventListener("input", ()=> loadPage("next"));

    document.getElementById("u-tbody")?.addEventListener("change", async (e)=>{
      const sel = e.target.closest("select[data-act='role']");
      if (!sel) return;
      const uid = sel.dataset.id;
      const newRole = sel.value;
      const ok = await changeRole(uid, newRole);
      if (!ok) {
        // if cancelled, reload page to restore old selection
        loadPage("next");
      }
    });

    document.getElementById("u-tbody")?.addEventListener("click", async (e)=>{
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.act === "copyuid"){
        const uid = btn.dataset.id;
        try{
          await navigator.clipboard.writeText(uid);
          window.ftAdminUI?.toast("UID copied", "success");
        }catch{
          window.ftAdminUI?.toast("Copy failed", "error");
        }
      }
    });
  }

  async function init(){
    bind();
    await loadPage("next");
  }

  window.ftAdminUsers = { init, loadPage };
})();