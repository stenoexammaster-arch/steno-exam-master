/* =========================
   Admin Panel (Advanced + Safe)
   - Books + Chapters + Volumes
   - Random Texts (filters + paging)
   - Chapter-level gating: isFree + isVisible
   - Apply Free Lessons Count (first N free)
   - KPIs: users/books/random/hardwords/feedback
   Firebase v8 compatible
   ========================= */

(() => {
  "use strict";

  // -------------------- State --------------------
  let currentBook = null;            // { id, data }
  let currentChapters = [];          // [{id, data}]
  let editingRandomTextId = null;

  // volumes
  let currentVolumes = [];           // [{id, data}]
  let currentVolumeMode = "__all__"; // "__all__" | "__none__" | volumeDocId
  let editingVolumeId = null;

  // random texts paging
  let rtLastDoc = null;
  const RT_PAGE_SIZE = 20;

  // -------------------- DOM helpers --------------------
  const $ = (id) => document.getElementById(id);

  function safeText(el, text) { if (el) el.textContent = text; }
  function show(el) { el && el.classList.remove("hidden"); }
  function hide(el) { el && el.classList.add("hidden"); }
  function isHidden(el) { return !!el && el.classList.contains("hidden"); }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function formatLanguage(lang) {
    if (lang === "hindi-mangal") return "Hindi (Mangal)";
    if (lang === "hindi-kruti") return "Hindi (Kruti Dev)";
    return "English";
  }

  function nowServerTs() {
    return firebase?.firestore?.FieldValue?.serverTimestamp?.() || Date.now();
  }

  function requireDb() {
    if (!window.db) throw new Error("Firestore not connected. Check firebase-config.js");
    return window.db;
  }

  // -------------------- Auth + init --------------------
  window.addEventListener("DOMContentLoaded", () => {
    const warningEl = $("admin-warning");
    const contentEl = $("admin-content");

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        safeText(warningEl, "You are not logged in. Please log in first.");
        show(warningEl);
        hide(contentEl);
        return;
      }

      try {
        const db = requireDb();
        const userDoc = await db.collection("users").doc(user.uid).get();
        const data = userDoc.data();

        if (!data || data.role !== "admin") {
          safeText(warningEl, "Access denied. You are not an admin.");
          show(warningEl);
          hide(contentEl);
          return;
        }

        hide(warningEl);
        show(contentEl);

        // admin pill
        safeText($("admin-user-pill"), user.email || "Admin");

        // setup
        setupGlobalSearch();
        setupRefreshButton();

        setupBooksUI();
        setupVolumesUI();

        setupRandomTextsUI();
        setupRandomFiltersUI();
        setupRandomListUI();

        // initial load
        await loadBooksSidebar();
        await loadRandomTextsList(true);

        // KPIs
        await loadKpisAndStats();

        // ✅ NEW: init feedback + users tables (so data dikh sake)
        if (window.ftAdminFeedback && typeof window.ftAdminFeedback.init === "function") {
          await window.ftAdminFeedback.init();
        }
        if (window.ftAdminUsers && typeof window.ftAdminUsers.init === "function") {
          await window.ftAdminUsers.init();
        }

        // expose for other modules
        window.ftAdminState = {
          getCurrentBook: () => currentBook,
          getCurrentChapters: () => currentChapters,
          getCurrentVolumes: () => currentVolumes,
          getCurrentVolumeMode: () => currentVolumeMode,
          reloadChapters: async () => {
            if (!currentBook) return;
            await loadChapters(currentBook.id);
          }
        };

      } catch (e) {
        console.error(e);
        safeText(warningEl, "Error checking admin access: " + (e.message || e));
        show(warningEl);
        hide(contentEl);
      }
    });
  });

  // -------------------- Global search --------------------
  function setupGlobalSearch() {
    const inp = $("admin-global-search");
    if (!inp) return;

    inp.addEventListener("input", () => {
      const q = String(inp.value || "").toLowerCase().trim();

      // books
      document.querySelectorAll(".admin-book-item").forEach((it) => {
        it.style.display = (!q || it.textContent.toLowerCase().includes(q)) ? "" : "none";
      });

      // chapters
      document.querySelectorAll(".chapter-list-item").forEach((it) => {
        it.style.display = (!q || it.textContent.toLowerCase().includes(q)) ? "" : "none";
      });

      // random texts
      document.querySelectorAll("#rt-list .rt-item").forEach((it) => {
        it.style.display = (!q || it.textContent.toLowerCase().includes(q)) ? "" : "none";
      });

      // hard words (if present)
      document.querySelectorAll("#hw-list .rt-item").forEach((it) => {
        it.style.display = (!q || it.textContent.toLowerCase().includes(q)) ? "" : "none";
      });
    });
  }

  function setupRefreshButton() {
    $("acs-refresh-btn")?.addEventListener("click", async () => {
      await loadBooksSidebar();
      await loadRandomTextsList(true);
      await loadKpisAndStats();
      if (currentBook) await loadChapters(currentBook.id);
    });
  }

  // -------------------- KPIs + Stats --------------------
  async function loadKpisAndStats() {
    try {
      const db = requireDb();

      // small stats (existing)
      const statBooksEl = $("stat-books");
      const statRandomEl = $("stat-random");
      const statChaptersEl = $("stat-chapters");

      // KPIs
      const kUsers = $("kpi-users");
      const kBooks = $("kpi-books");
      const kRandom = $("kpi-random");
      const kHard = $("kpi-hardwords");
      const kFb = $("kpi-feedback");

      // counts
      const [usersSnap, booksSnap, randomSnap, hardSnap, fbSnap] = await Promise.all([
        db.collection("users").get().catch(() => null),
        db.collection("books").get().catch(() => null),
        db.collection("randomTexts").get().catch(() => null),
        db.collection("hardWords").get().catch(() => null),
        db.collection("feedback").get().catch(() => null),
      ]);

      const usersCount = usersSnap ? usersSnap.size : "—";
      const booksCount = booksSnap ? booksSnap.size : "—";
      const randomCount = randomSnap ? randomSnap.size : "—";
      const hardCount = hardSnap ? hardSnap.size : "—";
      const fbCount = fbSnap ? fbSnap.size : "—";

      safeText(kUsers, String(usersCount));
      safeText(kBooks, String(booksCount));
      safeText(kRandom, String(randomCount));
      safeText(kHard, String(hardCount));
      safeText(kFb, String(fbCount));

      safeText(statBooksEl, String(booksCount));
      safeText(statRandomEl, String(randomCount));
      safeText(statChaptersEl, currentChapters.length ? String(currentChapters.length) : (statChaptersEl?.textContent || "0"));

    } catch (e) {
      console.error("KPI load failed:", e);
    }
  }

  // -------------------- Volumes --------------------
  function setupVolumesUI() {
    const volumeSelect = $("volume-select");
    const volumeNewBtn = $("volume-new-btn");
    const volumeEditBtn = $("volume-edit-btn");

    const editor = $("volume-editor");
    const titleInput = $("volume-title-input");
    const codeInput = $("volume-code-input");
    const orderInput = $("volume-order-input");

    const saveBtn = $("volume-save-btn");
    const cancelBtn = $("volume-cancel-btn");
    const deleteBtn = $("volume-delete-btn");
    const msg = $("volume-msg");

    if (!volumeSelect) return;

    const setMsg = (text, ok=false) => {
      if (!msg) return;
      msg.style.color = ok ? "#bbf7d0" : "#fca5a5";
      msg.textContent = text || "";
    };

    const showEditor = (showIt) => editor && editor.classList.toggle("hidden", !showIt);

    const clearEditor = () => {
      editingVolumeId = null;
      if (titleInput) titleInput.value = "";
      if (codeInput) codeInput.value = "";
      if (orderInput) orderInput.value = "";
      setMsg("");
      showEditor(false);
    };

    volumeSelect.addEventListener("change", () => {
      currentVolumeMode = volumeSelect.value || "__all__";
      fillChaptersUI();
    });

    volumeNewBtn?.addEventListener("click", () => {
      if (!currentBook) return alert("Select a book first.");
      editingVolumeId = null;
      if (titleInput) titleInput.value = "";
      if (codeInput) codeInput.value = "";
      if (orderInput) orderInput.value = "";
      setMsg("");
      showEditor(true);
    });

    volumeEditBtn?.addEventListener("click", () => {
      if (!currentBook) return alert("Select a book first.");
      const vid = volumeSelect.value;
      if (!vid || vid === "__all__" || vid === "__none__") return alert("Select a volume first.");

      const v = currentVolumes.find(x => x.id === vid);
      if (!v) return alert("Volume not found.");

      editingVolumeId = v.id;
      if (titleInput) titleInput.value = v.data.title || "";
      if (codeInput) codeInput.value = v.data.code || "";
      if (orderInput) orderInput.value = (v.data.order != null ? v.data.order : "");
      setMsg("");
      showEditor(true);
    });

    cancelBtn?.addEventListener("click", clearEditor);

    saveBtn?.addEventListener("click", async () => {
      if (!currentBook) return;

      const title = (titleInput?.value || "").trim();
      const code = (codeInput?.value || "").trim();
      const order = parseInt((orderInput?.value || "1"), 10) || 1;

      if (!title) return setMsg("Volume title required.");

      const payload = {
        title,
        code: code || null,
        order,
        updatedAt: nowServerTs(),
      };

      try {
        const db = requireDb();
        const colRef = db.collection("books").doc(currentBook.id).collection("volumes");

        if (editingVolumeId) {
          await colRef.doc(editingVolumeId).set(payload, { merge: true });
        } else {
          const docRef = await colRef.add({
            ...payload,
            createdAt: nowServerTs(),
            isVisible: true,
          });
          editingVolumeId = docRef.id;
        }

        setMsg("Volume saved.", true);
        await loadVolumes(currentBook.id);

        if (editingVolumeId) {
          currentVolumeMode = editingVolumeId;
          volumeSelect.value = editingVolumeId;
        }

        fillChaptersUI();
        setTimeout(clearEditor, 600);

      } catch (e) {
        console.error(e);
        setMsg(e.message || "Save failed.");
      }
    });

    deleteBtn?.addEventListener("click", async () => {
      if (!currentBook) return;
      if (!editingVolumeId) return alert("Open volume editor first.");

      const yes = confirm("Delete this volume? Chapters under this volume will move to 'No volume'.");
      if (!yes) return;

      try {
        const db = requireDb();
        const bookRef = db.collection("books").doc(currentBook.id);
        await bookRef.collection("volumes").doc(editingVolumeId).delete();

        // detach chapters
        const chSnap = await bookRef.collection("chapters").where("volumeId", "==", editingVolumeId).get();
        if (!chSnap.empty) {
          const batch = db.batch();
          chSnap.forEach((d) => {
            batch.update(d.ref, {
              volumeId: null,
              volumeTitle: null,
              updatedAt: nowServerTs(),
            });
          });
          await batch.commit();
        }

        editingVolumeId = null;
        currentVolumeMode = "__none__";
        volumeSelect.value = "__none__";
        clearEditor();

        await loadVolumes(currentBook.id);
        await loadChapters(currentBook.id);
        fillChaptersUI();

      } catch (e) {
        console.error(e);
        alert("Delete failed: " + e.message);
      }
    });
  }

  async function loadVolumes(bookId) {
    currentVolumes = [];
    const sel = $("volume-select");
    if (!sel) return;

    sel.innerHTML = `
      <option value="__all__">All volumes (show all chapters)</option>
      <option value="__none__">No volume (standalone chapters)</option>
    `;

    if (!bookId) return;

    try {
      const db = requireDb();
      const snap = await db.collection("books").doc(bookId).collection("volumes").orderBy("order", "asc").get();

      snap.forEach((doc) => {
        const v = doc.data() || {};
        currentVolumes.push({ id: doc.id, data: v });

        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = `${v.title || "Untitled volume"}${v.code ? " (" + v.code + ")" : ""}`;
        sel.appendChild(opt);
      });

      sel.value = currentVolumeMode || "__all__";
    } catch (e) {
      console.error("loadVolumes error:", e);
    }
  }

  function getActiveVolumeMeta() {
    if (currentVolumeMode === "__none__") return { volumeId: null, volumeTitle: null };
    if (currentVolumeMode === "__all__") return { volumeId: null, volumeTitle: null };
    const v = currentVolumes.find(x => x.id === currentVolumeMode);
    if (!v) return { volumeId: null, volumeTitle: null };
    return { volumeId: v.id, volumeTitle: v.data.title || null };
  }

  function chapterMatchesVolume(ch) {
    const vid = ch?.data?.volumeId || null;
    if (currentVolumeMode === "__all__") return true;
    if (currentVolumeMode === "__none__") return !vid;
    return vid === currentVolumeMode;
  }

  // -------------------- Books + Chapters --------------------
  function setupBooksUI() {
    const newBookBtn = $("new-book-btn");
    const togglePaidBtn = $("book-toggle-paid-btn");
    const toggleVisibleBtn = $("book-toggle-visible-btn");
    const editModeBtn = $("book-edit-mode-btn");
    const deleteBookBtn = $("book-delete-btn");

    const bookSaveBtn = $("book-save-btn");
    const bookCancelBtn = $("book-cancel-btn");

    const applyFreeBtn = $("book-apply-free-lessons-btn");
    const freeCountInput = $("book-free-lessons-count");

    const chapterFontSize = $("chapter-font-size");
    const chapterSaveBtn = $("chapter-save-btn");
    const chapterNewBtn = $("chapter-new-btn");
    const chapterDeleteBtn = $("chapter-delete-btn");
    const chapterSelect = $("chapter-select");
    const chapterFile = $("chapter-file");

    // NEW: chapter gating checkboxes
    const chVisible = $("chapter-visible-input");
    const chFree = $("chapter-free-input");

    // new book
    newBookBtn?.addEventListener("click", async () => {
      currentBook = null;
      currentChapters = [];
      currentVolumes = [];
      currentVolumeMode = "__all__";
      editingVolumeId = null;

      hide($("book-none"));
      show($("book-editor"));

      fillBookMeta(null);
      fillBookEditForm(null);

      await loadVolumes(null);
      fillChaptersUI();
      updateChaptersStat();
    });

    // book paid toggle
    togglePaidBtn?.addEventListener("click", async () => {
      if (!currentBook) return;
      const db = requireDb();
      const ref = db.collection("books").doc(currentBook.id);

      const newPaid = !currentBook.data.isPaid;
      await ref.update({ isPaid: newPaid, updatedAt: nowServerTs() });
      currentBook.data.isPaid = newPaid;

      fillBookMeta(currentBook);
      await loadBooksSidebar();
      await loadKpisAndStats();
    });

    // book visible toggle
    toggleVisibleBtn?.addEventListener("click", async () => {
      if (!currentBook) return;
      const db = requireDb();
      const ref = db.collection("books").doc(currentBook.id);

      const newVisible = currentBook.data.isVisible === false ? true : false;
      await ref.update({ isVisible: newVisible, updatedAt: nowServerTs() });
      currentBook.data.isVisible = newVisible;

      fillBookMeta(currentBook);
      await loadBooksSidebar();
    });

    // edit mode
    editModeBtn?.addEventListener("click", () => {
      const form = $("book-edit-form");
      if (!form) return;
      fillBookEditForm(currentBook);
      form.classList.toggle("hidden");
    });

    bookCancelBtn?.addEventListener("click", () => hide($("book-edit-form")));

    // save book
    bookSaveBtn?.addEventListener("click", async () => {
      const db = requireDb();

      const title = ($("book-title-input")?.value || "").trim();
      const language = $("book-language-input")?.value || "english";
      const description = ($("book-description-input")?.value || "").trim();
      const content = ($("book-content-input")?.value || "").trim();
      const isPaid = !!$("book-paid-input")?.checked;

      // optional helper stored
      const freeCount = parseInt(($("book-free-lessons-count")?.value || "").trim(), 10);
      const freeLessonsCount = Number.isFinite(freeCount) ? Math.max(0, freeCount) : null;

      if (!title) return alert("Book title required.");

      const payload = {
        title,
        language,
        description,
        content,
        isPaid,
        freeLessonsCount: freeLessonsCount, // optional
        updatedAt: nowServerTs(),
      };

      if (currentBook) {
        await db.collection("books").doc(currentBook.id).update(payload);
        currentBook.data = { ...currentBook.data, ...payload };
      } else {
        const docRef = await db.collection("books").add({
          ...payload,
          isVisible: true,
          createdAt: nowServerTs(),
        });
        currentBook = { id: docRef.id, data: { ...payload, isVisible: true } };
      }

      hide($("book-edit-form"));
      fillBookMeta(currentBook);

      await loadBooksSidebar();
      await loadKpisAndStats();
    });

    // delete book
    deleteBookBtn?.addEventListener("click", async () => {
      if (!currentBook) return;
      const yes = confirm("Delete this book? (Volumes/Chapters will not be auto-deleted)");
      if (!yes) return;

      const db = requireDb();
      await db.collection("books").doc(currentBook.id).delete();

      currentBook = null;
      currentChapters = [];
      currentVolumes = [];
      currentVolumeMode = "__all__";

      hide($("book-editor"));
      show($("book-none"));

      await loadBooksSidebar();
      await loadKpisAndStats();
    });

    // Apply free lessons count to chapters (first N free)
    applyFreeBtn?.addEventListener("click", async () => {
      if (!currentBook) return alert("Select a book first.");
      const n = parseInt((freeCountInput?.value || "").trim(), 10);
      if (!Number.isFinite(n) || n < 0) return alert("Enter a valid free lessons count (e.g. 25).");

      const yes = confirm(`Apply: First ${n} ordered chapters will be FREE, remaining will be LOCKED. Continue?`);
      if (!yes) return;

      await applyFreeLessonsToChapters(currentBook.id, n);
      await loadChapters(currentBook.id);
      alert("Applied free/locked settings to chapters.");
    });

    // font size slider
    chapterFontSize?.addEventListener("input", () => {
      const size = parseInt(chapterFontSize.value, 10) || 18;
      const c = $("chapter-content");
      if (c) c.style.fontSize = size + "px";
    });

    // file upload .txt
    chapterFile?.addEventListener("change", () => {
      const file = chapterFile.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const c = $("chapter-content");
        if (c) c.value = reader.result || "";
      };
      reader.readAsText(file, "utf-8");
    });

    // chapter actions
    chapterSaveBtn?.addEventListener("click", async () => {
      await saveChapter();
    });
    chapterNewBtn?.addEventListener("click", () => selectChapter(null));
    chapterDeleteBtn?.addEventListener("click", async () => deleteCurrentChapter());
    chapterSelect?.addEventListener("change", () => selectChapter(chapterSelect.value || null));

    // chapter search in list
    $("chapter-search")?.addEventListener("input", (e) => {
      const q = String(e.target.value || "").toLowerCase().trim();
      document.querySelectorAll(".chapter-list-item").forEach((el) => {
        el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? "" : "none";
      });
    });

    // default states for gating checkboxes
    if (chVisible) chVisible.checked = true;
    if (chFree) chFree.checked = true;
  }

  async function loadBooksSidebar() {
    const listEl = $("books-sidebar-list");
    if (!listEl) return;

    listEl.innerHTML = "<p style='font-size:0.85rem;color:#9ca3af;'>Loading books...</p>";

    const db = requireDb();
    const snap = await db.collection("books").orderBy("title", "asc").get();
    listEl.innerHTML = "";

    if (snap.empty) {
      listEl.innerHTML = "<p style='font-size:0.85rem;color:#9ca3af;'>No books yet. Click “New Book”.</p>";
      return;
    }

    snap.forEach((doc) => {
      const b = doc.data() || {};
      const item = document.createElement("div");
      item.className = "admin-book-item";
      item.dataset.id = doc.id;

      const vis = b.isVisible === false ? "Hidden" : "Visible";
      const paid = b.isPaid ? "Paid" : "Free";

      item.innerHTML = `
        <div>
          <div>${escapeHtml(b.title || "Untitled book")}</div>
          <div class="label">${escapeHtml(formatLanguage(b.language))} • ${paid} • ${vis}</div>
        </div>
      `;

      if (currentBook && currentBook.id === doc.id) item.classList.add("active");
      listEl.appendChild(item);
    });

    listEl.onclick = async (e) => {
      const item = e.target.closest(".admin-book-item");
      if (!item) return;
      await selectBook(item.dataset.id);
    };
  }

  async function selectBook(bookId) {
    const db = requireDb();
    const docRef = db.collection("books").doc(bookId);
    const snap = await docRef.get();
    if (!snap.exists) return;

    currentBook = { id: bookId, data: snap.data() };
    currentVolumeMode = "__all__";
    editingVolumeId = null;

    hide($("book-none"));
    show($("book-editor"));

    fillBookMeta(currentBook);
    fillBookEditForm(currentBook);

    document.querySelectorAll(".admin-book-item").forEach((el) => el.classList.remove("active"));
    document.querySelector(`.admin-book-item[data-id="${bookId}"]`)?.classList.add("active");

    await loadVolumes(bookId);
    await loadChapters(bookId);
  }

  function fillBookMeta(book) {
    const titleEl = $("book-meta-title");
    const subEl = $("book-meta-subtitle");
    const togglePaidBtn = $("book-toggle-paid-btn");
    const toggleVisibleBtn = $("book-toggle-visible-btn");

    if (!book) {
      safeText(titleEl, "New Book");
      safeText(subEl, "");
      if (togglePaidBtn) togglePaidBtn.textContent = "Mark as Paid";
      if (toggleVisibleBtn) toggleVisibleBtn.textContent = "Hide from tests";
      return;
    }

    const { title, language, isPaid, isVisible, freeLessonsCount } = book.data || {};
    const langLabel = formatLanguage(language);
    const paidLabel = isPaid ? "Paid" : "Free";
    const visLabel = isVisible === false ? "Hidden from tests" : "Visible in tests";

    const freeHint = (Number.isFinite(freeLessonsCount) && freeLessonsCount != null)
      ? ` • Free lessons: ${freeLessonsCount}`
      : "";

    safeText(titleEl, title || "Untitled book");
    safeText(subEl, `${langLabel} • ${paidLabel} • ${visLabel}${freeHint}`);

    if (togglePaidBtn) togglePaidBtn.textContent = `Mark as ${isPaid ? "Free" : "Paid"}`;
    if (toggleVisibleBtn) toggleVisibleBtn.textContent = isVisible === false ? "Show in tests" : "Hide from tests";
  }

  function fillBookEditForm(book) {
    $("book-title-input") && ($("book-title-input").value = (book && book.data.title) || "");
    $("book-language-input") && ($("book-language-input").value = (book && book.data.language) || "english");
    $("book-description-input") && ($("book-description-input").value = (book && book.data.description) || "");
    $("book-content-input") && ($("book-content-input").value = (book && book.data.content) || "");
    $("book-paid-input") && ($("book-paid-input").checked = !!(book && book.data.isPaid));

    // optional helper
    const freeCount = book?.data?.freeLessonsCount;
    if ($("book-free-lessons-count")) {
      $("book-free-lessons-count").value = (freeCount != null) ? String(freeCount) : "";
    }
  }

  async function loadChapters(bookId) {
    const db = requireDb();
    const snap = await db.collection("books").doc(bookId).collection("chapters").orderBy("order", "asc").get();

    currentChapters = [];
    snap.forEach((doc) => currentChapters.push({ id: doc.id, data: doc.data() || {} }));

    fillChaptersUI();
    updateChaptersStat();
    await loadKpisAndStats();
  }

  function updateChaptersStat() {
    safeText($("stat-chapters"), String(currentChapters.length || 0));
  }

  function fillChaptersUI() {
    const selectEl = $("chapter-select");
    const listEl = $("chapter-list");
    if (!selectEl || !listEl) return;

    const filtered = currentChapters.filter(chapterMatchesVolume);

    selectEl.innerHTML = `<option value="">New chapter...</option>`;
    filtered.forEach((ch) => {
      const opt = document.createElement("option");
      opt.value = ch.id;

      const vis = (ch.data.isVisible === false) ? "Hidden" : "Visible";
      const free = (ch.data.isFree === false) ? "Locked" : "Free";

      opt.textContent = ((ch.data.code || "") + " " + (ch.data.name || "")).trim() || ch.id;
      opt.textContent += ` • ${free} • ${vis}`;
      selectEl.appendChild(opt);
    });

    listEl.innerHTML = "";
    filtered.forEach((ch) => {
      const div = document.createElement("div");
      div.className = "chapter-list-item";
      div.dataset.id = ch.id;

      const v = ch.data.volumeTitle ? ` • ${ch.data.volumeTitle}` : "";

      const vis = (ch.data.isVisible === false) ? "Hidden" : "Visible";
      const free = (ch.data.isFree === false) ? "Locked" : "Free";

      div.innerHTML = `
        <div>${escapeHtml((ch.data.code || ""))} ${escapeHtml((ch.data.name || ""))}</div>
        <span class="label">#${escapeHtml(String(ch.data.order || 0))}${escapeHtml(v)} • ${free} • ${vis}</span>
      `;
      listEl.appendChild(div);
    });

    listEl.onclick = (e) => {
      const item = e.target.closest(".chapter-list-item");
      if (!item) return;
      selectEl.value = item.dataset.id;
      selectChapter(item.dataset.id);
    };
  }

  function selectChapter(id) {
    const contentEl = $("chapter-content");
    if (!contentEl) return;

    const chVisible = $("chapter-visible-input");
    const chFree = $("chapter-free-input");

    if (!id) {
      $("chapter-select") && ($("chapter-select").value = "");
      $("chapter-code") && ($("chapter-code").value = "");
      $("chapter-name") && ($("chapter-name").value = "");
      $("chapter-order") && ($("chapter-order").value = "");
      contentEl.value = "";

      if (chVisible) chVisible.checked = true;
      if (chFree) chFree.checked = true;
      return;
    }

    const ch = currentChapters.find(c => c.id === id);
    if (!ch) return;

    $("chapter-code") && ($("chapter-code").value = ch.data.code || "");
    $("chapter-name") && ($("chapter-name").value = ch.data.name || "");
    $("chapter-order") && ($("chapter-order").value = (ch.data.order != null ? ch.data.order : ""));
    contentEl.value = ch.data.content || "";

    // load gating
    if (chVisible) chVisible.checked = (ch.data.isVisible !== false);
    if (chFree) chFree.checked = (ch.data.isFree !== false);
  }

  async function saveChapter() {
    if (!currentBook) return alert("Select or create a book first.");

    const code = ($("chapter-code")?.value || "").trim();
    const name = ($("chapter-name")?.value || "").trim();
    const order = parseInt(($("chapter-order")?.value || "1").trim(), 10) || 1;
    const content = ($("chapter-content")?.value || "").trim();

    const msgEl = $("chapters-message");
    if (msgEl) { msgEl.textContent = ""; msgEl.style.color = "#fca5a5"; }

    if (!code && !name) { if (msgEl) msgEl.textContent = "At least chapter code or name required."; return; }
    if (!content) { if (msgEl) msgEl.textContent = "Content is required."; return; }

    const selectedId = $("chapter-select")?.value || null;

    // volume mapping
    let volId = null, volTitle = null;
    if (currentVolumeMode === "__none__") {
      volId = null; volTitle = null;
    } else if (currentVolumeMode === "__all__") {
      if (selectedId) {
        const old = currentChapters.find(c => c.id === selectedId)?.data || {};
        volId = old.volumeId || null;
        volTitle = old.volumeTitle || null;
      }
    } else {
      const meta = getActiveVolumeMeta();
      volId = meta.volumeId;
      volTitle = meta.volumeTitle;
    }

    // ✅ gating controls
    const isVisible = $("chapter-visible-input") ? !!$("chapter-visible-input").checked : true;
    const isFree = $("chapter-free-input") ? !!$("chapter-free-input").checked : true;

    const payload = {
      code,
      name: name || null,
      order,
      content,
      volumeId: volId,
      volumeTitle: volTitle,

      // ✅ new fields
      isVisible,
      isFree,

      updatedAt: nowServerTs()
    };

    const db = requireDb();
    const colRef = db.collection("books").doc(currentBook.id).collection("chapters");

    try {
      let idToUse = selectedId;

      if (selectedId) {
        await colRef.doc(selectedId).set(payload, { merge: true });
      } else {
        const docRef = await colRef.add({
          ...payload,
          createdAt: nowServerTs()
        });
        idToUse = docRef.id;
      }

      if (msgEl) { msgEl.style.color = "#bbf7d0"; msgEl.textContent = "Chapter saved."; }

      await loadChapters(currentBook.id);
      $("chapter-select") && ($("chapter-select").value = idToUse);
      selectChapter(idToUse);

    } catch (e) {
      console.error(e);
      if (msgEl) msgEl.textContent = e.message || "Save failed.";
    }
  }

  async function deleteCurrentChapter() {
    if (!currentBook) return;
    const id = $("chapter-select")?.value || null;
    if (!id) return alert("Select a chapter first.");

    const yes = confirm("Delete this chapter?");
    if (!yes) return;

    const db = requireDb();
    await db.collection("books").doc(currentBook.id).collection("chapters").doc(id).delete();

    await loadChapters(currentBook.id);
    $("chapter-select") && ($("chapter-select").value = "");
    selectChapter(null);
  }

  async function applyFreeLessonsToChapters(bookId, freeCount) {
    const db = requireDb();
    const snap = await db.collection("books").doc(bookId).collection("chapters").orderBy("order", "asc").get();
    if (snap.empty) return;

    const docs = snap.docs;
    const batch = db.batch();

    docs.forEach((d, idx) => {
      const isFree = idx < freeCount;
      batch.set(d.ref, { isFree, updatedAt: nowServerTs() }, { merge: true });
    });

    await batch.commit();
  }

  // -------------------- Random Texts --------------------
  function setupRandomTextsUI() {
    $("rt-advanced-toggle")?.addEventListener("click", () => {
      $("rt-advanced-wrap")?.classList.toggle("hidden");
    });

    $("rt-add-btn")?.addEventListener("click", async () => {
      const rtMsgEl = $("rt-message");
      if (rtMsgEl) { rtMsgEl.textContent = ""; rtMsgEl.style.color = "#fca5a5"; }

      const title = ($("rt-title")?.value || "").trim();
      const language = $("rt-language")?.value || "english";
      const text = ($("rt-text")?.value || "").trim();

      const code = ($("rt-code")?.value || "").trim();
      const isFree = !!$("rt-free")?.checked;

      if (!title) return rtMsgEl && (rtMsgEl.textContent = "Title required.");
      if (!text) return rtMsgEl && (rtMsgEl.textContent = "Text required.");

      const payload = {
        title,
        language,
        text,
        code: code || null,
        isFree,
        updatedAt: nowServerTs(),
      };

      try {
        const db = requireDb();
        const colRef = db.collection("randomTexts");

        if (editingRandomTextId) {
          await colRef.doc(editingRandomTextId).set(payload, { merge: true });
          rtMsgEl && (rtMsgEl.style.color = "#bbf7d0", rtMsgEl.textContent = "Random text updated.");
        } else {
          await colRef.add({ ...payload, createdAt: nowServerTs() });
          rtMsgEl && (rtMsgEl.style.color = "#bbf7d0", rtMsgEl.textContent = "Random text added.");
        }

        clearRandomForm();
        await loadRandomTextsList(true);
        await loadKpisAndStats();

      } catch (e) {
        console.error(e);
        rtMsgEl && (rtMsgEl.textContent = e.message || "Save failed.");
      }
    });

    $("rt-cancel-btn")?.addEventListener("click", () => clearRandomForm());
    $("rt-load-more")?.addEventListener("click", async () => loadRandomTextsList(false));
  }

  function setupRandomFiltersUI() {
    const reload = () => loadRandomTextsList(true);
    $("rt-filter-language")?.addEventListener("change", reload);
    $("rt-filter-free")?.addEventListener("change", reload);
    $("rt-search")?.addEventListener("input", reload);
  }

  function setupRandomListUI() {
    const containerEl = $("rt-list");
    if (!containerEl) return;

    containerEl.addEventListener("click", async (e) => {
      // toggle open
      const head = e.target.closest("[data-rt-toggle='1']");
      if (head) {
        const item = head.closest(".rt-item");
        if (!item) return;

        containerEl.querySelectorAll(".rt-item.open").forEach((x) => { if (x !== item) x.classList.remove("open"); });
        item.classList.toggle("open");
        return;
      }

      // action buttons
      const btn = e.target.closest("button");
      if (!btn) return;

      const action = btn.getAttribute("data-rt-action");
      const id = btn.getAttribute("data-rt-id");
      if (!action || !id) return;

      const db = requireDb();
      const docRef = db.collection("randomTexts").doc(id);
      const snap = await docRef.get();
      const rt = snap.data() || {};

      if (action === "delete") {
        const yes = confirm("Delete this random text?");
        if (!yes) return;
        await docRef.delete();
        await loadRandomTextsList(true);
        await loadKpisAndStats();
      }

      if (action === "toggle-free") {
        await docRef.update({ isFree: !rt.isFree, updatedAt: nowServerTs() });
        await loadRandomTextsList(true);
        await loadKpisAndStats();
      }

      if (action === "edit") {
        editingRandomTextId = id;

        if ($("rt-title")) $("rt-title").value = rt.title || "";
        if ($("rt-language")) $("rt-language").value = rt.language || "english";
        if ($("rt-text")) $("rt-text").value = rt.text || "";

        $("rt-advanced-wrap")?.classList.remove("hidden");
        if ($("rt-code")) $("rt-code").value = rt.code || "";
        if ($("rt-free")) $("rt-free").checked = !!rt.isFree;

        if ($("rt-add-btn")) $("rt-add-btn").textContent = "Save Random Text";
        $("rt-cancel-btn")?.classList.remove("hidden");
        $("random-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  async function loadRandomTextsList(reset) {
    const containerEl = $("rt-list");
    if (!containerEl) return;

    if (reset) {
      rtLastDoc = null;
      containerEl.innerHTML = "<p>Loading random texts...</p>";
    }

    const langFilter = $("rt-filter-language")?.value || "all";
    const freeFilter = $("rt-filter-free")?.value || "all";
    const search = ($("rt-search")?.value || "").trim().toLowerCase();

    try {
      const db = requireDb();

      let q = db.collection("randomTexts").orderBy("createdAt", "desc").limit(RT_PAGE_SIZE);
      if (rtLastDoc) q = q.startAfter(rtLastDoc);

      const snap = await q.get();
      if (snap.empty) {
        if (reset) containerEl.innerHTML = "<p>No random texts yet.</p>";
        return;
      }

      rtLastDoc = snap.docs[snap.docs.length - 1];
      if (reset) containerEl.innerHTML = "";

      snap.forEach((doc) => {
        const rt = doc.data() || {};
        const rtLang = rt.language || "english";
        const rtFree = !!rt.isFree;

        // filters
        if (langFilter !== "all" && rtLang !== langFilter) return;
        if (freeFilter === "free" && !rtFree) return;
        if (freeFilter === "locked" && rtFree) return;

        const blob = `${rt.title || ""} ${rt.text || ""}`.toLowerCase();
        if (search && !blob.includes(search)) return;

        const item = document.createElement("div");
        item.className = "rt-item";
        item.dataset.id = doc.id;

        item.innerHTML = `
          <div class="rt-item-head" data-rt-toggle="1">
            <div>
              <div class="rt-title">${escapeHtml(rt.title || "Untitled text")}</div>
              <div class="rt-meta">${escapeHtml(formatLanguage(rtLang))} • ${rtFree ? "Free" : "Locked"} • ID: ${doc.id}</div>
            </div>
            <div class="rt-chevron">▾</div>
          </div>

          <div class="rt-item-body">
            <div class="rt-textbox">${escapeHtml(rt.text || "")}</div>
            <div class="rt-actions">
              <button class="btn small" data-rt-action="edit" data-rt-id="${doc.id}">Edit</button>
              <button class="btn small secondary" data-rt-action="toggle-free" data-rt-id="${doc.id}">
                Mark as ${rtFree ? "Locked" : "Free"}
              </button>
              <button class="btn small secondary" data-rt-action="delete" data-rt-id="${doc.id}">Delete</button>
            </div>
          </div>
        `;

        containerEl.appendChild(item);
      });

      if (reset && !containerEl.children.length) {
        containerEl.innerHTML = "<p>No items match your filters.</p>";
      }
    } catch (e) {
      console.error("Error loading random texts:", e);
      if (reset) containerEl.innerHTML = "<p>Error loading random texts: " + e.message + "</p>";
    }
  }

  function clearRandomForm() {
    editingRandomTextId = null;
    if ($("rt-title")) $("rt-title").value = "";
    if ($("rt-language")) $("rt-language").value = "english";
    if ($("rt-text")) $("rt-text").value = "";

    $("rt-advanced-wrap")?.classList.add("hidden");
    if ($("rt-code")) $("rt-code").value = "";
    if ($("rt-free")) $("rt-free").checked = true;

    if ($("rt-add-btn")) $("rt-add-btn").textContent = "Add Random Text";
    $("rt-cancel-btn")?.classList.add("hidden");

    const msg = $("rt-message");
    if (msg) msg.textContent = "";
  }

})();
