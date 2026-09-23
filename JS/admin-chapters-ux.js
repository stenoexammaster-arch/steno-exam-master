(function(){
  const $ = (id) => document.getElementById(id);

  function open(id){ $(id)?.classList.remove("hidden"); }
  function close(id){ $(id)?.classList.add("hidden"); }

  function padNum(n, len){
    const s = String(n);
    return s.length >= len ? s : ("0".repeat(len - s.length) + s);
  }

  function resolveTextField(obj){
    return String(obj?.content ?? obj?.text ?? obj?.body ?? obj?.chapterText ?? obj?.passage ?? "").trim();
  }

  // ---------- PARSERS ----------
  function parseBlocks(text){
    const blocks = String(text || "")
      .replace(/\r\n/g, "\n")
      .split(/\n\s*---\s*\n/g)
      .map(b => b.trim())
      .filter(Boolean);

    return blocks.map((blk) => {
      const lines = blk.split("\n");
      const header = (lines.shift() || "").trim();

      let code = "";
      let name = "";

      if (header.includes("|")) {
        const parts = header.split("|").map(s => s.trim());
        code = parts[0] || "";
        name = parts.slice(1).join(" | ").trim();
      } else {
        name = header;
      }

      const content = lines.join("\n").trim();
      return { code, name, content };
    });
  }

  function parseJSON(text){
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => ({
      code: String(x.code || "").trim(),
      name: String(x.name || "").trim(),
      content: resolveTextField(x),
      order: x.order != null ? Number(x.order) : null,
      volumeId: String(x.volumeId || "").trim(),
      volumeTitle: String(x.volumeTitle || "").trim(),
    }));
  }

  // CSV rule (simple):
  // header: code,name,order,content,volumeId,volumeTitle
  // content can contain \n as \\n
  function parseCSV(text){
    const lines = String(text || "").replace(/\r\n/g,"\n").split("\n").filter(l=>l.trim()!=="");
    if (!lines.length) return [];
    const header = lines.shift().toLowerCase();
    const cols = header.split(",").map(s=>s.trim());

    const idx = (name) => cols.indexOf(name);
    const iCode = idx("code");
    const iName = idx("name");
    const iOrder = idx("order");
    const iContent = idx("content");
    const iVolId = idx("volumeid");
    const iVolTitle = idx("volumetitle");

    return lines.map((ln) => {
      // naive CSV split (works if you avoid commas inside fields)
      const parts = ln.split(",").map(s=>s.trim());
      const rawContent = (iContent >=0 ? (parts[iContent] || "") : "");
      return {
        code: iCode>=0 ? (parts[iCode] || "") : "",
        name: iName>=0 ? (parts[iName] || "") : "",
        order: iOrder>=0 ? Number(parts[iOrder] || "") : null,
        content: rawContent.replace(/\\n/g, "\n").trim(),
        volumeId: iVolId>=0 ? (parts[iVolId] || "") : "",
        volumeTitle: iVolTitle>=0 ? (parts[iVolTitle] || "") : "",
      };
    }).filter(x => x.content);
  }

  function detectMode(text){
    const t = String(text || "").trim();
    if (!t) return "empty";
    if (t.startsWith("[")) return "json";
    const firstLine = t.split("\n")[0].toLowerCase();
    if (firstLine.includes("code") && firstLine.includes("content") && firstLine.includes(",")) return "csv";
    return "blocks";
  }

  // ---------- BULK IMPORT ----------
  async function bulkImport(){
    const msg = $("bulk-import-msg");
    if (msg) { msg.textContent = ""; msg.style.color = "#fca5a5"; }

    const st = window.ftAdminState?.getCurrentBook?.();
    if (!st) { if(msg) msg.textContent = "Select a book first."; return; }

    const startOrder = parseInt($("bulk-start-order")?.value || "1", 10) || 1;
    const padLen = parseInt($("bulk-code-pad")?.value || "0", 10) || 0;

    const defaultVolumeId = ($("bulk-volume-id")?.value || "").trim();
    const defaultVolumeTitle = ($("bulk-volume-title")?.value || "").trim();

    const raw = $("bulk-textarea")?.value || "";
    const mode = detectMode(raw);

    let items = [];
    try{
      if (mode === "json") items = parseJSON(raw);
      else if (mode === "csv") items = parseCSV(raw);
      else if (mode === "blocks") items = parseBlocks(raw);
      else items = [];
    }catch(e){
      if (msg) msg.textContent = "Parse error: " + e.message;
      return;
    }

    if (!items.length) { if(msg) msg.textContent = "No chapters found in pasted data."; return; }

    // validate
    for (const it of items){
      if (!it.content) { if(msg) msg.textContent = "Each chapter must have content."; return; }
    }

    const colRef = window.db.collection("books").doc(st.id).collection("chapters");
    const nowTs = firebase.firestore.FieldValue.serverTimestamp();

    try{
      let batch = window.db.batch();
      let countInBatch = 0;

      for (let i=0; i<items.length; i++){
        const it = items[i];

        const order = (it.order != null && Number.isFinite(it.order)) ? it.order : (startOrder + i);
        const code = it.code || (padLen > 0 ? padNum(order, padLen) : "");
        const name = it.name || null;

        const volumeId = (it.volumeId || defaultVolumeId || "").trim() || null;
        const volumeTitle = (it.volumeTitle || defaultVolumeTitle || "").trim() || null;

        const payload = {
          code: code || null,
          name,
          order,
          content: it.content,
          volumeId,
          volumeTitle,
          createdAt: nowTs,
          updatedAt: nowTs
        };

        const docRef = colRef.doc();
        batch.set(docRef, payload);
        countInBatch++;

        if (countInBatch >= 450) {
          await batch.commit();
          batch = window.db.batch();
          countInBatch = 0;
        }
      }

      if (countInBatch > 0) await batch.commit();

      if (msg) { msg.style.color = "#bbf7d0"; msg.textContent = `Imported ${items.length} chapters (${mode.toUpperCase()} mode).`; }
      await window.ftAdminState.reloadChapters();
      setTimeout(()=> close("bulk-modal"), 900);
    }catch(e){
      console.error(e);
      if (msg) msg.textContent = e.message;
    }
  }

  // ---------- ORDER MANAGER ----------
  function openOrderManager(){
    const st = window.ftAdminState?.getCurrentBook?.();
    const chapters = window.ftAdminState?.getCurrentChapters?.() || [];
    const msg = $("order-msg");
    if (msg) msg.textContent = "";
    if (!st) { if(msg) msg.textContent = "Select a book first."; return; }

    const list = $("order-list");
    if (!list) return;

    const work = chapters
      .map(c => ({ id: c.id, ...c.data }))
      .sort((a,b)=> (a.order||0) - (b.order||0));

    list.innerHTML = "";
    work.forEach((ch) => {
      const row = document.createElement("div");
      row.className = "order-item";
      row.dataset.id = ch.id;
      row.innerHTML = `
        <div class="order-left">
          <div class="order-name">${(ch.code||"")} ${(ch.name||"")}</div>
          <div class="order-meta">order: ${ch.order ?? "-"}</div>
        </div>
        <div class="order-actions">
          <button class="btn small secondary" data-move="up">↑</button>
          <button class="btn small secondary" data-move="down">↓</button>
        </div>
      `;
      list.appendChild(row);
    });

    list.onclick = (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const move = btn.dataset.move;
      const item = e.target.closest(".order-item");
      if (!item) return;

      const nodes = Array.from(list.querySelectorAll(".order-item"));
      const index = nodes.indexOf(item);

      if (move === "up" && index > 0) list.insertBefore(item, nodes[index - 1]);
      if (move === "down" && index < nodes.length - 1) list.insertBefore(nodes[index + 1], item);
    };

    $("order-save-btn").onclick = async () => {
      const msg2 = $("order-msg");
      if (msg2) { msg2.textContent = ""; msg2.style.color="#fca5a5"; }

      const nodes = Array.from(list.querySelectorAll(".order-item"));
      if (!nodes.length) return;

      try{
        const colRef = window.db.collection("books").doc(st.id).collection("chapters");
        const batch = window.db.batch();

        nodes.forEach((node, i) => {
          const id = node.dataset.id;
          batch.update(colRef.doc(id), {
            order: i + 1,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        });

        await batch.commit();
        if (msg2) { msg2.style.color="#bbf7d0"; msg2.textContent = "Order saved."; }
        await window.ftAdminState.reloadChapters();
        setTimeout(()=> close("order-modal"), 900);
      }catch(e){
        console.error(e);
        if (msg2) msg2.textContent = e.message;
      }
    };

    open("order-modal");
  }

  async function autoNumber(){
    const st = window.ftAdminState?.getCurrentBook?.();
    const chapters = window.ftAdminState?.getCurrentChapters?.() || [];
    if (!st) return alert("Select a book first.");
    if (!chapters.length) return alert("No chapters to number.");

    const ok = confirm("Auto Number will set order = 1..N. Continue?");
    if (!ok) return;

    const sorted = chapters
      .map(c => ({ id: c.id, ...c.data }))
      .sort((a,b)=> (a.order||0) - (b.order||0));

    try{
      const colRef = window.db.collection("books").doc(st.id).collection("chapters");
      const batch = window.db.batch();

      sorted.forEach((ch, i) => {
        batch.update(colRef.doc(ch.id), {
          order: i + 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      await batch.commit();
      await window.ftAdminState.reloadChapters();
      window.ftAdminUI?.toast?.("Auto numbering done", "success");
    }catch(e){
      console.error(e);
      window.ftAdminUI?.toast?.("Auto numbering failed", "error");
    }
  }

  function bindSearch(){
    const inp = $("chapter-search");
    if (!inp) return;

    inp.addEventListener("input", () => {
      const q = inp.value.trim().toLowerCase();
      document.querySelectorAll(".chapter-list-item").forEach((el) => {
        const txt = el.textContent.toLowerCase();
        el.style.display = (!q || txt.includes(q)) ? "" : "none";
      });
    });
  }

  function init(){
    $("chapter-bulk-import-btn")?.addEventListener("click", () => open("bulk-modal"));
    $("bulk-close-btn")?.addEventListener("click", () => close("bulk-modal"));
    $("bulk-import-clear-btn")?.addEventListener("click", () => { const t=$("bulk-textarea"); if(t) t.value=""; });
    $("bulk-import-run-btn")?.addEventListener("click", bulkImport);

    $("chapter-order-manager-btn")?.addEventListener("click", openOrderManager);
    $("order-close-btn")?.addEventListener("click", () => close("order-modal"));

    $("chapter-auto-number-btn")?.addEventListener("click", autoNumber);

    bindSearch();
  }

  document.addEventListener("DOMContentLoaded", init);
})();