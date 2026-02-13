// js/test-setup.js
// Typing Test setup with:
// - Books + Volumes + Chapters
// - HardWords / Random texts
// - Paid lessons gating based on Firebase Auth + Firestore users:
//   * Guest  -> sirf free lessons
//   * Logged-in + subscribed plan -> sab lessons open
//   * Logged-in + no plan        -> paid lessons locked
// ✅ Trial removed

window.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const form = $("test-setup-form");
  if (!form) return;

  // ---- UI refs ----
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

  // ---- Data state ----
  const booksMap = {}; // bookId -> { title, language, isVisible, isPaid }
  const bookCache = {
    bookId: "",
    hasVolumes: false,
    volumes: [],    // [{id,title,order}]
    chapters: []    // [{id, code, name, order, volumeId, isFree, isVisible}]
  };

  let volumeListenerBound = false;

  // ---- User access state (TRIAL REMOVED) ----
  const TRIAL_DAYS = 0;

  let userAccess = {
    loggedIn: false,
    subscribed: false,
    trialExpired: true,
    daysLeft: 0,
    loaded: false
  };

  function evaluateTrialAndPlan(userData) {
    const now = new Date();

    // Plan-based subscription (same as book.js)
    let planActive = false;
    if (
      userData.plan &&
      userData.plan !== "none" &&
      userData.planExpiresAt &&
      userData.planExpiresAt.toDate
    ) {
      const exp = userData.planExpiresAt.toDate();
      planActive = exp > now;
    }

    const subscribed = !!userData.subscribed || planActive;

    return {
      subscribed,
      trialExpired: true,
      daysLeft: 0
    };
  }

  async function refreshUserAccess(firebaseUser) {
    if (!firebaseUser || !window.db) {
      userAccess = {
        loggedIn: !!firebaseUser,
        subscribed: false,
        trialExpired: true,
        daysLeft: 0,
        loaded: true
      };
      renderChaptersUI();
      return;
    }

    try {
      const userRef = window.db.collection("users").doc(firebaseUser.uid);
      const snap = await userRef.get();
      const data = snap.data() || {};

      const access = evaluateTrialAndPlan(data);

      userAccess = {
        loggedIn: true,
        subscribed: !!access.subscribed,
        trialExpired: true,
        daysLeft: 0,
        loaded: true
      };
    } catch (e) {
      console.error("User access load failed:", e);
      userAccess = {
        loggedIn: true,
        subscribed: false,
        trialExpired: true,
        daysLeft: 0,
        loaded: true
      };
    }

    renderChaptersUI();
  }

  function setupAuthListener() {
    // Use window.auth if available, else fallback to firebase.auth()
    let authObj = window.auth;
    try {
      if (!authObj && window.firebase && window.firebase.auth) authObj = window.firebase.auth();
      if (!authObj && window.firebase && window.firebase.auth) authObj = window.firebase.auth();
      if (!authObj && typeof firebase !== "undefined" && firebase.auth) authObj = firebase.auth();
    } catch {}

    if (!authObj || typeof authObj.onAuthStateChanged !== "function") {
      userAccess = {
        loggedIn: false,
        subscribed: false,
        trialExpired: true,
        daysLeft: 0,
        loaded: true
      };
      renderChaptersUI();
      return;
    }

    authObj.onAuthStateChanged((user) => {
      refreshUserAccess(user);
    });
  }

  function isLoggedIn() {
    return !!userAccess.loggedIn;
  }

  // Paid content access: logged-in AND subscribed
  function hasFullPaidAccess() {
    return !!userAccess.loggedIn && !!userAccess.subscribed;
  }

  // ---- UI helpers ----
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

    if (lang === "english") {
      sourceSelect.appendChild(makeOption("random-en", "Random passage"));
    } else {
      sourceSelect.appendChild(makeOption("random-hi", "Random passage"));
    }

    const ids = Object.keys(booksMap)
      .filter((id) => matchesSelectedLanguage(booksMap[id].language, lang))
      .sort((a, b) => (booksMap[a].title || "").localeCompare(booksMap[b].title || ""));

    ids.forEach((id) => {
      const b = booksMap[id];
      if (b.isVisible === false) return;
      sourceSelect.appendChild(makeOption("book:" + id, b.title || "Untitled book"));
    });

    sourceSelect.appendChild(makeOption("hardwords", "Hard Words practice"));
    sourceSelect.appendChild(makeOption("custom", "Custom text (paste your own)"));

    const exists = Array.from(sourceSelect.options).some((o) => o.value === prev);
    sourceSelect.value = exists ? prev : (lang === "english" ? "random-en" : "random-hi");
  }

  function syncSourceUI() {
    const val = sourceSelect?.value || "random-en";

    if (customWrap) {
      if (val === "custom") customWrap.classList.remove("hidden");
      else customWrap.classList.add("hidden");
    }

    if (hwRow) {
      if (val === "hardwords") hwRow.classList.remove("hidden");
      else hwRow.classList.add("hidden");
    }

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

    if (volumeSelect) {
      volumeSelect.innerHTML = "";
      volumeSelect.appendChild(makeOption("", "Loading…"));
    }
    if (lessonSelect) {
      lessonSelect.innerHTML = "";
      lessonSelect.appendChild(makeOption("", "Loading…"));
    }
    if (chapterHint) chapterHint.textContent = "";

    const volSnap = await window.db.collection("books").doc(bookId).collection("volumes").orderBy("order", "asc").get();
    volSnap.forEach((d) => {
      const v = d.data() || {};
      if (v.isVisible === false) return;
      bookCache.volumes.push({ id: d.id, title: v.title || "Volume", order: v.order ?? 999999 });
    });
    bookCache.hasVolumes = bookCache.volumes.length > 0;

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

    renderVolumeUI();
    renderChaptersUI();
  }

  function renderVolumeUI() {
    if (!volumeRow || !volumeSelect) return;

    if (!bookCache.hasVolumes) {
      volumeRow.classList.add("hidden");
      volumeSelect.innerHTML = "";
      volumeSelect.appendChild(makeOption("", "No volumes"));
      return;
    }

    volumeRow.classList.remove("hidden");

    const prev = volumeSelect.value || "";

    volumeSelect.innerHTML = "";
    volumeSelect.appendChild(makeOption("", "Select volume"));

    bookCache.volumes.forEach((v) => {
      volumeSelect.appendChild(makeOption(v.id, v.title));
    });

    const exists = Array.from(volumeSelect.options).some(o => o.value === prev);
    volumeSelect.value = exists ? prev : "";

    if (!volumeListenerBound) {
      volumeListenerBound = true;
      volumeSelect.addEventListener("change", () => {
        renderChaptersUI();
      });
    }
  }

  function renderChaptersUI() {
    if (!lessonSelect) return;

    const loggedIn = isLoggedIn();
    const fullPaid = hasFullPaidAccess();
    const selectedVol = bookCache.hasVolumes ? (volumeSelect?.value || "") : "";

    lessonSelect.innerHTML = "";
    lessonSelect.appendChild(makeOption("", "Random chapter"));

    if (bookCache.hasVolumes && !selectedVol) {
      lessonSelect.appendChild(
        makeOption("", "Select a volume to choose a chapter", { disabled: true })
      );
      if (chapterHint) chapterHint.textContent = "Select a volume to see its chapters.";
      return;
    }

    let list = bookCache.chapters.slice();

    if (bookCache.hasVolumes && selectedVol) {
      list = list.filter(c => c.volumeId === selectedVol);
      if (chapterHint) chapterHint.textContent = "Chapters filtered by selected volume.";
    } else {
      if (chapterHint) chapterHint.textContent = "";
    }

    const visible = list;

    if (!visible.length) {
      lessonSelect.appendChild(makeOption("", "No lessons found", { disabled: true }));
      if (!loggedIn) {
        lessonSelect.appendChild(makeOption("", "Log in to access locked lessons", { disabled: true }));
      }
      return;
    }

    const paidCount = visible.filter(c => c.isFree === false).length;

    visible
      .sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999))
      .forEach((c) => {
        const isPaidLesson = c.isFree === false;
        let isLocked = false;
        let extra = "";

        if (isPaidLesson) {
          if (!loggedIn) {
            isLocked = true;
            extra = " (Login required)";
          } else if (!fullPaid) {
            isLocked = true;
            extra = " (Paid plan required)";
          }
        }

        const label = chapterLabel(c) + extra;
        const opt = makeOption(c.id, label, { disabled: isLocked });
        lessonSelect.appendChild(opt);
      });

    if (!loggedIn && paidCount > 0) {
      const msg = paidCount === 1
        ? "Log in to practice 1 paid lesson"
        : `Log in to practice ${paidCount} paid lessons`;
      lessonSelect.appendChild(makeOption("", msg, { disabled: true }));
    } else if (loggedIn && !fullPaid && paidCount > 0) {
      const msg = paidCount === 1
        ? "Subscribe to practice 1 locked lesson"
        : `Subscribe to practice ${paidCount} locked lessons`;
      lessonSelect.appendChild(makeOption("", msg, { disabled: true }));
    }
  }

  // ---------------- Random / HardWords fetching ----------------
  async function getRandomText({ wanted, lang }) {
    if (!window.db) throw new Error("Firestore not connected.");
    const fullPaid = hasFullPaidAccess();

    if (wanted === "english") {
      const snap = await window.db.collection("randomTexts").where("language", "==", "english").get();
      const list = [];
      snap.forEach(d => {
        const x = d.data() || {};
        if (!fullPaid && x.isFree === false) return;
        const t = String(x.text || "").trim();
        if (t) list.push(t);
      });
      return pickRandom(list);
    }

    const priority = (lang === "hindi-kruti") ? ["hindi-kruti", "hindi-mangal"] : ["hindi-mangal", "hindi-kruti"];
    for (const hLang of priority) {
      const snap = await window.db.collection("randomTexts").where("language", "==", hLang).get();
      const list = [];
      snap.forEach(d => {
        const x = d.data() || {};
        if (!fullPaid && x.isFree === false) return;
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

    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }

    const n = Math.max(5, Math.min(parseInt(count, 10) || 30, 200));
    return words.slice(0, n).join("\n");
  }

  // ---------------- Init ----------------
  (async function init() {
    setupAuthListener();
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
    const loggedIn = isLoggedIn();
    const fullPaid = hasFullPaidAccess();

    let source = selectedSource;
    let bookId = null;
    let chapterId = null;
    let custom = "";

    try {
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

      if (selectedSource === "hardwords") {
        const diff = hwDifficulty ? hwDifficulty.value : "all";
        const cnt = hwCount ? hwCount.value : "30";
        const text = await getHardWordsText({ lang, difficulty: diff, count: cnt });
        if (!text) return setMessage("No hard words found for selected language. Please add in Admin panel.");
        source = "custom";
        custom = text;
      }

      if (selectedSource === "custom") {
        custom = customText ? customText.value.trim() : "";
        if (!custom) {
          setMessage("Please paste some custom text for practice.");
          customText?.focus();
          return;
        }
        source = "custom";
      }

      if (isBookOption(selectedSource)) {
        bookId = extractBookId(selectedSource);
        if (!bookId) return setMessage("Please select a valid book.");

        const chosen = lessonSelect ? (lessonSelect.value || "") : "";

        if (chosen) {
          const selectedChapter = bookCache.chapters.find(c => c.id === chosen);
          if (!selectedChapter) {
            setMessage("Selected lesson not found.");
            return;
          }

          if (selectedChapter.isFree === false) {
            if (!loggedIn) {
              setMessage("Please log in to practice this paid lesson.");
              return;
            }
            if (!fullPaid) {
              setMessage("Subscription required to access paid lessons.");
              return;
            }
          }

          chapterId = chosen;
        } else {
          const selectedVol = bookCache.hasVolumes ? (volumeSelect?.value || "") : "";

          let candidates = bookCache.chapters.filter(c => c.isVisible !== false);

          if (!loggedIn || !fullPaid) {
            candidates = candidates.filter(c => c.isFree !== false);
          }

          if (bookCache.hasVolumes) {
            if (!selectedVol) return setMessage("Please select a volume to continue.");
            candidates = candidates.filter(c => c.volumeId === selectedVol);
          }

          if (!candidates.length) {
            if (!loggedIn) {
              return setMessage("No available free lessons. Please log in to access paid lessons.");
            }
            return setMessage("No available free lessons. Subscribe to access paid lessons.");
          }
          chapterId = pickRandom(candidates).id;
        }

        source = "book";
      }

      const config = {
        userName,
        lang,
        source,
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
