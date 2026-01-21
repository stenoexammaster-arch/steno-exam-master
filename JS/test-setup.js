// js/test-setup.js (Fixed + Advanced)
// Fixes:
// 1) Volume selection bug fixed (volume selection no longer resets)
// 2) Random option shown per language (English => only English random, Hindi => only Hindi random)
// 3) Hard Words option appears below books, custom remains last

window.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const form = $("test-setup-form");
  if (!form) return;

  const backBtn = $("ts-back-btn");
  const langButtonsWrap = $("ts-lang-buttons");
  const timeButtonsWrap = $("ts-time-buttons");

  const sourceSelect = $("ts-source");
  const modeSelect = $("ts-mode");
  const msgEl = $("ts-message");

  const customWrap = $("ts-custom-wrap");
  const customText = $("ts-custom-text");

  const lessonRow = $("ts-book-lesson-row");
  const lessonSelect = $("ts-book-lesson");
  const chapterHint = $("ts-chapter-hint");

  const volumeRow = $("ts-book-volume-row");
  const volumeSelect = $("ts-book-volume");

  const backspaceAllowed = $("ts-backspace-allowed");

  const hwRow = $("ts-hardwords-row");
  const hwDifficulty = $("ts-hw-difficulty");
  const hwCount = $("ts-hw-count");

  const booksMap = {}; // bookId -> { title, language, isVisible, isPaid }
  const bookCache = {
    bookId: "",
    hasVolumes: false,
    volumes: [],    // [{id,title,order}]
    chapters: []    // [{id, code, name, order, volumeId, isFree, isVisible}]
  };

  let volumeListenerBound = false;

  function setMessage(text, isError = true) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.style.color = isError ? "#fca5a5" : "#9ca3af";
  }

  function getActiveLang() {
    const activeBtn = langButtonsWrap?.querySelector(".lang-btn.active");
    return activeBtn ? activeBtn.dataset.lang : "english";
  }

  function getSelectedTimeSeconds() {
    const activeBtn = timeButtonsWrap?.querySelector(".time-btn.active");
    const sec = activeBtn ? parseInt(activeBtn.dataset.seconds, 10) : 180;
    return Number.isFinite(sec) ? sec : 180;
  }

  function isBookOption(value) {
    return typeof value === "string" && value.startsWith("book:");
  }
  function extractBookId(value) {
    return isBookOption(value) ? value.slice("book:".length) : "";
  }

  function matchesSelectedLanguage(bookLang, selectedLang) {
    const bl = String(bookLang || "").toLowerCase().trim();
    const sl = String(selectedLang || "").toLowerCase().trim();
    if (sl === "english") return bl === "english";
    if (sl.startsWith("hindi")) return bl.startsWith("hindi");
    return false;
  }

  function makeOption(value, text, { disabled = false } = {}) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    if (disabled) opt.disabled = true;
    return opt;
  }

  function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem("sm_user") || "null") || {}; }
    catch { return {}; }
  }
  function isPremiumUser() {
    const u = getCurrentUser();
    return !!u.loggedIn && String(u.plan || "").toLowerCase() === "premium";
  }

  function pickRandom(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function chapterLabel(ch) {
    const code = (ch.code || "").trim();
    const name = (ch.name || "").trim();
    return `${code} ${name}`.trim() || "Lesson";
  }

  // --- UI sync ---
  backBtn?.addEventListener("click", () => (window.location.href = "index.html"));

  langButtonsWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest(".lang-btn");
    if (!btn) return;

    langButtonsWrap.querySelectorAll(".lang-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    rebuildSourceOptionsPreserve();
    syncSourceUI();
    setMessage("");
  });

  timeButtonsWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest(".time-btn");
    if (!btn) return;
    timeButtonsWrap.querySelectorAll(".time-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });

  function rebuildSourceOptionsPreserve() {
    if (!sourceSelect) return;

    const prev = sourceSelect.value;
    const lang = getActiveLang();

    sourceSelect.innerHTML = "";

    // Random option based on language
    if (lang === "english") {
      sourceSelect.appendChild(makeOption("random-en", "Random passage"));
    } else {
      sourceSelect.appendChild(makeOption("random-hi", "Random passage"));
    }

    // Books filtered by language
    const ids = Object.keys(booksMap)
      .filter((id) => matchesSelectedLanguage(booksMap[id].language, lang))
      .sort((a, b) => (booksMap[a].title || "").localeCompare(booksMap[b].title || ""));

    ids.forEach((id) => {
      const b = booksMap[id];
      if (b.isVisible === false) return;
      sourceSelect.appendChild(makeOption("book:" + id, b.title || "Untitled book"));
    });

    // Hard words BELOW books (second last)
    sourceSelect.appendChild(makeOption("hardwords", "Hard Words practice"));

    // Custom LAST
    sourceSelect.appendChild(makeOption("custom", "Custom text (paste your own)"));

    // preserve value if exists, else set first
    const exists = Array.from(sourceSelect.options).some((o) => o.value === prev);
    sourceSelect.value = exists ? prev : (lang === "english" ? "random-en" : "random-hi");
  }

  function syncSourceUI() {
    const val = sourceSelect?.value || "random-en";

    // custom
    if (customWrap) {
      if (val === "custom") customWrap.classList.remove("hidden");
      else customWrap.classList.add("hidden");
    }

    // hardwords
    if (hwRow) {
      if (val === "hardwords") hwRow.classList.remove("hidden");
      else hwRow.classList.add("hidden");
    }

    // book controls
    if (lessonRow) {
      if (isBookOption(val)) lessonRow.classList.remove("hidden");
      else lessonRow.classList.add("hidden");
    }
    if (volumeRow) {
      if (!isBookOption(val)) volumeRow.classList.add("hidden");
    }

    if (isBookOption(val)) {
      loadBookStructure(extractBookId(val));
    } else {
      // reset book cache view
      if (volumeRow) volumeRow.classList.add("hidden");
      if (lessonSelect) {
        lessonSelect.innerHTML = "";
        lessonSelect.appendChild(makeOption("", "Random chapter"));
      }
      if (chapterHint) chapterHint.textContent = "";
    }
  }

  sourceSelect?.addEventListener("change", syncSourceUI);

  // ---------------- Firestore loads ----------------
  async function loadBooksFromAdmin() {
    if (!window.db) {
      setMessage("Firestore not connected. Check firebase-config.js", true);
      return;
    }
    const snap = await window.db.collection("books").orderBy("title", "asc").get();
    snap.forEach((doc) => {
      const b = doc.data() || {};
      booksMap[doc.id] = {
        title: b.title || "Untitled book",
        language: b.language || "english",
        isVisible: b.isVisible !== false,
        isPaid: !!b.isPaid
      };
    });
  }

  async function loadBookStructure(bookId) {
    if (!window.db || !bookId) return;

    bookCache.bookId = bookId;
    bookCache.volumes = [];
    bookCache.chapters = [];
    bookCache.hasVolumes = false;

    // UI loading states
    if (volumeSelect) {
      volumeSelect.innerHTML = "";
      volumeSelect.appendChild(makeOption("", "Loading…"));
    }
    if (lessonSelect) {
      lessonSelect.innerHTML = "";
      lessonSelect.appendChild(makeOption("", "Loading…"));
    }
    if (chapterHint) chapterHint.textContent = "";

    // volumes
    const volSnap = await window.db.collection("books").doc(bookId).collection("volumes").orderBy("order", "asc").get();
    volSnap.forEach((d) => {
      const v = d.data() || {};
      if (v.isVisible === false) return;
      bookCache.volumes.push({ id: d.id, title: v.title || "Volume", order: v.order ?? 999999 });
    });
    bookCache.hasVolumes = bookCache.volumes.length > 0;

    // chapters
    const chSnap = await window.db.collection("books").doc(bookId).collection("chapters").orderBy("order", "asc").get();
    chSnap.forEach((doc) => {
      const ch = doc.data() || {};
      if (ch.isVisible === false) return;
      bookCache.chapters.push({
        id: doc.id,
        code: ch.code || "",
        name: ch.name || "",
        order: Number.isFinite(ch.order) ? ch.order : 999999,
        volumeId: (ch.volumeId || "").toString().trim(),
        isFree: ch.isFree !== false,
        isVisible: ch.isVisible !== false
      });
    });

    renderVolumeUI();     // build volume select ONCE
    renderChaptersUI();   // build chapters list based on current volume selection
  }

  // FIX: Volume select no longer rebuilds itself on change -> only chapters rebuild
  function renderVolumeUI() {
    if (!volumeRow || !volumeSelect) return;

    if (!bookCache.hasVolumes) {
      volumeRow.classList.add("hidden");
      volumeSelect.innerHTML = "";
      volumeSelect.appendChild(makeOption("", "No volumes"));
      return;
    }

    volumeRow.classList.remove("hidden");

    // preserve selected volume if possible
    const prev = volumeSelect.value || "";

    volumeSelect.innerHTML = "";
    volumeSelect.appendChild(makeOption("", "Select volume"));

    bookCache.volumes.forEach((v) => {
      volumeSelect.appendChild(makeOption(v.id, v.title));
    });

    // restore selection if still exists
    const exists = Array.from(volumeSelect.options).some(o => o.value === prev);
    volumeSelect.value = exists ? prev : "";

    // bind listener only once
    if (!volumeListenerBound) {
      volumeListenerBound = true;
      volumeSelect.addEventListener("change", () => {
        renderChaptersUI(); // ONLY chapters update
      });
    }
  }

  function renderChaptersUI() {
    if (!lessonSelect) return;

    const premium = isPremiumUser();
    const selectedVol = bookCache.hasVolumes ? (volumeSelect?.value || "") : "";

    lessonSelect.innerHTML = "";
    lessonSelect.appendChild(makeOption("", "Random chapter"));

    if (bookCache.hasVolumes && !selectedVol) {
      lessonSelect.appendChild(makeOption("", "Select a volume to choose a chapter", { disabled: true }));
      if (chapterHint) chapterHint.textContent = "Select a volume to see its chapters.";
      return;
    }

    let list = bookCache.chapters.slice();

    // filter by volume
    if (bookCache.hasVolumes && selectedVol) {
      list = list.filter(c => c.volumeId === selectedVol);
      if (chapterHint) chapterHint.textContent = "Chapters filtered by selected volume.";
    } else {
      if (chapterHint) chapterHint.textContent = "";
    }

    // premium gating
    const visible = list;
    const free = list.filter(c => c.isFree !== false);

    const showList = premium ? visible : free;

    if (!showList.length) {
      lessonSelect.appendChild(makeOption("", premium ? "No lessons found" : "No free lessons available", { disabled: true }));
      if (!premium) lessonSelect.appendChild(makeOption("", "Subscribe to unlock more lessons", { disabled: true }));
      return;
    }

    showList
      .sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999))
      .forEach((c) => {
        lessonSelect.appendChild(makeOption(c.id, chapterLabel(c)));
      });

    if (!premium) {
      const lockedCount = visible.length - free.length;
      if (lockedCount > 0) {
        lessonSelect.appendChild(makeOption("", "More lessons locked — Subscribe", { disabled: true }));
      }
    }
  }

  // ---------------- Random / HardWords fetching (no composite index) ----------------
  async function getRandomText({ wanted, lang }) {
    if (!window.db) throw new Error("Firestore not connected.");
    const premium = isPremiumUser();

    if (wanted === "english") {
      const snap = await window.db.collection("randomTexts").where("language", "==", "english").get();
      const list = [];
      snap.forEach(d => {
        const x = d.data() || {};
        if (!premium && x.isFree === false) return;
        const t = String(x.text || "").trim();
        if (t) list.push(t);
      });
      return pickRandom(list);
    }

    // hindi: prefer selected layout
    const priority = (lang === "hindi-kruti") ? ["hindi-kruti", "hindi-mangal"] : ["hindi-mangal", "hindi-kruti"];
    for (const hLang of priority) {
      const snap = await window.db.collection("randomTexts").where("language", "==", hLang).get();
      const list = [];
      snap.forEach(d => {
        const x = d.data() || {};
        if (!premium && x.isFree === false) return;
        const t = String(x.text || "").trim();
        if (t) list.push(t);
      });
      if (list.length) return pickRandom(list);
    }
    return null;
  }

  async function getHardWordsText({ lang, difficulty, count }) {
    if (!window.db) throw new Error("Firestore not connected.");

    const hwLang = (lang === "english") ? "english" : (lang === "hindi-kruti" ? "hindi-kruti" : "hindi-mangal");
    const snap = await window.db.collection("hardWords").where("language", "==", hwLang).get();

    const words = [];
    snap.forEach(d => {
      const x = d.data() || {};
      if (x.isActive === false) return;
      if (difficulty && difficulty !== "all" && x.difficulty !== difficulty) return;
      const w = String(x.word || "").trim();
      if (w) words.push(w);
    });

    if (!words.length) return null;

    // shuffle
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }

    const n = Math.max(5, Math.min(parseInt(count, 10) || 30, 200));
    return words.slice(0, n).join("\n");
  }

  // ---------------- Init ----------------
  (async function init() {
    await loadBooksFromAdmin();
    rebuildSourceOptionsPreserve();
    syncSourceUI();
  })();

  // ---------------- Submit ----------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("");

    const nameInput = $("ts-name");
    const userName = nameInput ? nameInput.value.trim() : "";
    if (!userName) {
      setMessage("Please enter your name to start the test.");
      nameInput?.focus();
      return;
    }

    const selectedSource = sourceSelect ? sourceSelect.value : "random-en";
    const lang = getActiveLang();
    const seconds = getSelectedTimeSeconds();
    const mode = modeSelect ? modeSelect.value : "practice";
    const allowBackspace = backspaceAllowed ? !!backspaceAllowed.checked : true;

    let source = selectedSource;
    let bookId = null;
    let chapterId = null;
    let custom = "";

    try {
      // Random (language-specific)
      if (selectedSource === "random-en") {
        const text = await getRandomText({ wanted: "english", lang });
        if (!text) return setMessage("No random English texts found. Please add in Admin panel.");
        source = "custom";
        custom = text;
      }

      if (selectedSource === "random-hi") {
        const text = await getRandomText({ wanted: "hindi", lang });
        if (!text) return setMessage("No random Hindi texts found. Please add in Admin panel.");
        source = "custom";
        custom = text;
      }

      // Hard words
      if (selectedSource === "hardwords") {
        const diff = hwDifficulty ? hwDifficulty.value : "all";
        const cnt = hwCount ? hwCount.value : "30";
        const text = await getHardWordsText({ lang, difficulty: diff, count: cnt });
        if (!text) return setMessage("No hard words found for selected language. Please add in Admin panel.");
        source = "custom";
        custom = text;
      }

      // Custom
      if (selectedSource === "custom") {
        custom = customText ? customText.value.trim() : "";
        if (!custom) {
          setMessage("Please paste some custom text for practice.");
          customText?.focus();
          return;
        }
        source = "custom";
      }

      // Book
      if (isBookOption(selectedSource)) {
        bookId = extractBookId(selectedSource);
        if (!bookId) return setMessage("Please select a valid book.");

        const chosen = lessonSelect ? (lessonSelect.value || "") : "";

        if (chosen) {
          chapterId = chosen;
        } else {
          // random chapter from allowed list
          const premium = isPremiumUser();
          const selectedVol = bookCache.hasVolumes ? (volumeSelect?.value || "") : "";

          let candidates = bookCache.chapters.filter(c => c.isVisible !== false);
          if (!premium) candidates = candidates.filter(c => c.isFree !== false);

          if (bookCache.hasVolumes) {
            if (!selectedVol) return setMessage("Please select a volume to continue.");
            candidates = candidates.filter(c => c.volumeId === selectedVol);
          }

          if (!candidates.length) return setMessage("No available lessons. Subscribe to unlock more lessons.");
          chapterId = pickRandom(candidates).id;
        }

        source = "book";
      }

      const config = {
        userName,
        lang,
        source,          // custom | book
        seconds,
        mode,
        customText: custom,
        backspaceAllowed: allowBackspace,
        bookId,
        chapterId,
        bookRandom: false
      };

      localStorage.setItem("ft-active-test", JSON.stringify(config));
      window.location.href = "practice.html";

    } catch (err) {
      console.error(err);
      setMessage(err.message || "Something went wrong. Please try again.");
    }
  });
});