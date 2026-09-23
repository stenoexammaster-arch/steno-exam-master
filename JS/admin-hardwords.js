(function(){
  const PAGE_SIZE = 30;
  let lastDoc = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s){
    return String(s||"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;");
  }

  function setMsg(text, ok=false){
    const el = $("hw-msg");
    if (!el) return;
    el.style.color = ok ? "#bbf7d0" : "#fca5a5";
    el.textContent = text || "";
  }

  function normalizeWords(text){
    return String(text || "")
      .split(/\r?\n|,/g)
      .map(w => w.trim())
      .filter(Boolean);
  }

  async function addWords(){
    setMsg("");

    if (!window.db) return setMsg("Firestore not connected.");
    const lang = $("hw-language")?.value || "english";
    const diff = $("hw-difficulty")?.value || "hard";
    const tagsRaw = ($("hw-tags")?.value || "").trim();
    const tags = tagsRaw ? tagsRaw.split(",").map(t=>t.trim()).filter(Boolean) : [];

    const words = normalizeWords($("hw-words")?.value || "");
    if (!words.length) return setMsg("Please enter at least 1 word.");

    try{
      const now = firebase.firestore.FieldValue.serverTimestamp();
      let batch = window.db.batch();
      let count = 0;

      words.forEach((w) => {
        const ref = window.db.collection("hardWords").doc();
        batch.set(ref, {
          word: w,
          wordLower: w.toLowerCase(),
          language: lang,
          difficulty: diff,
          tags,
          isActive: true,
          createdAt: now,
          updatedAt: now
        });
        count++;
      });

      await batch.commit();
      setMsg(`Added ${count} words.`, true);

      $("hw-words").value = "";
      await loadHardWords(true);

    }catch(e){
      console.error(e);
      setMsg(e.message || "Add failed.");
    }
  }

  function buildItem(doc){
    const d = doc.data() || {};
    const lang = d.language || "-";
    const diff = d.difficulty || "-";
    const tags = Array.isArray(d.tags) ? d.tags.join(", ") : "";

    const item = document.createElement("div");
    item.className = "rt-item"; // reuse compact styles
    item.dataset.id = doc.id;

    item.innerHTML = `
      <div class="rt-item-head" data-hw-toggle="1">
        <div>
          <div class="rt-title">${escapeHtml(d.word || "—")}</div>
          <div class="rt-meta">${escapeHtml(lang)} • ${escapeHtml(diff)} ${tags ? "• " + escapeHtml(tags) : ""}</div>
        </div>
        <div class="rt-chevron">▾</div>
      </div>

      <div class="rt-item-body">
        <div class="rt-textbox">${escapeHtml(d.word || "")}</div>
        <div class="rt-actions">
          <button class="btn small secondary" data-hw-action="delete" data-id="${doc.id}">Delete</button>
          <button class="btn small secondary" data-hw-action="toggle" data-id="${doc.id}">
            ${d.isActive === false ? "Activate" : "Deactivate"}
          </button>
        </div>
      </div>
    `;
    return item;
  }

  async function loadHardWords(reset){
    const list = $("hw-list");
    if (!list || !window.db) return;

    if (reset){
      lastDoc = null;
      list.innerHTML = "<p>Loading…</p>";
    }

    const langFilter = $("hw-filter-lang")?.value || "all";
    const diffFilter = $("hw-filter-diff")?.value || "all";
    const search = ($("hw-search")?.value || "").trim().toLowerCase();

    try{
      let q = window.db.collection("hardWords").orderBy("createdAt", "desc").limit(PAGE_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty){
        if (reset) list.innerHTML = "<p>No hard words yet.</p>";
        return;
      }

      lastDoc = snap.docs[snap.docs.length - 1];
      if (reset) list.innerHTML = "";

      snap.forEach((doc)=>{
        const d = doc.data() || {};
        if (langFilter !== "all" && d.language !== langFilter) return;
        if (diffFilter !== "all" && d.difficulty !== diffFilter) return;
        if (search && !String(d.wordLower || d.word || "").toLowerCase().includes(search)) return;

        list.appendChild(buildItem(doc));
      });

      if (reset && !list.children.length){
        list.innerHTML = "<p>No items match filters.</p>";
      }
    }catch(e){
      console.error(e);
      if (reset) list.innerHTML = "<p>Error loading hard words.</p>";
    }
  }

  async function onListClick(e){
    const list = $("hw-list");
    if (!list) return;

    const head = e.target.closest("[data-hw-toggle='1']");
    if (head){
      const item = head.closest(".rt-item");
      if (!item) return;

      list.querySelectorAll(".rt-item.open").forEach(x => { if (x !== item) x.classList.remove("open"); });
      item.classList.toggle("open");
      return;
    }

    const btn = e.target.closest("button");
    if (!btn) return;

    const action = btn.dataset.hwAction;
    const id = btn.dataset.id;
    if (!action || !id) return;

    const ref = window.db.collection("hardWords").doc(id);

    if (action === "delete"){
      const yes = confirm("Delete this word?");
      if (!yes) return;
      await ref.delete();
      await loadHardWords(true);
    }

    if (action === "toggle"){
      const snap = await ref.get();
      const d = snap.data() || {};
      await ref.update({
        isActive: !(d.isActive === false),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await loadHardWords(true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("hw-add-btn")?.addEventListener("click", addWords);
    $("hw-clear-btn")?.addEventListener("click", () => { $("hw-words").value=""; setMsg(""); });

    $("hw-filter-lang")?.addEventListener("change", () => loadHardWords(true));
    $("hw-filter-diff")?.addEventListener("change", () => loadHardWords(true));
    $("hw-search")?.addEventListener("input", () => loadHardWords(true));

    $("hw-load-more")?.addEventListener("click", () => loadHardWords(false));

    $("hw-list")?.addEventListener("click", onListClick);

    loadHardWords(true);
  });
})();