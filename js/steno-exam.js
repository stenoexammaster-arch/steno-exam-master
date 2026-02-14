(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    examType: $("exam-type"),
    examLanguage: $("exam-language"),
    candidateName: $("candidate-name"),
    examTime: $("exam-time"),

    bookSelect: $("book-select"),
    volumeSelect: $("volume-select"),
    lessonSelect: $("lesson-select"),

    // Multiple / random ke liye checkbox list
    lessonCheckboxGroup: $("lesson-checkbox-group"),
    lessonCheckboxList: $("lesson-checkbox-list"),

    exerciseMode: $("exercise-mode"),
    exerciseModeHint: $("exercise-mode-hint"),

    rulesBox: $("rules-box"),
    textArea: $("steno-text"),
    editorLock: $("editor-lock"),

    fontDisplay: $("exam-font-display"),
    metaSelected: $("meta-selected"),
    timerDisplay: $("timer-display"),
    timerStatus: $("timer-status"),

    btnStart: $("btn-start"),
    btnCheck: $("btn-check"),
    btnReset: $("btn-reset"),
    btnAgain: $("btn-again"),
    btnPrint: $("btn-print"),

    resultSection: $("result-section"),
    resultTitle: $("result-title"),
    diffTitle: $("diff-title"),
    resultSheet: $("result-sheet"),
    diffOutput: $("diff-output"),

    timeHint: $("time-hint"),

    // panel height sync
    topstrip: $("topstrip"),
    notepadWrap: $("notepad-wrap"),
    leftActions: $("left-actions"),
    examPanel: $("exam-panel"),
  };

  // -------------- EXAM PROFILES (time options extended) --------------
  const EXAM_PROFILES = {
    HSSC_C: { name: "HSSC Steno Group C", level: "senior", timeOptionsMin: [5, 10, 15, 30, 45, 60] },
    SSC_C:  { name: "SSC Steno Group C",  level: "senior", timeOptionsMin: [10, 15, 30, 45, 60] },
    SSC_D:  { name: "SSC Steno Group D",  level: "junior", timeOptionsMin: [10, 15, 30, 45, 60] },
  };

  const LEVEL_RULES = {
    junior: {
      allowedPercent: 0.08,
      speeds: {
        english: "80 wpm shorthand, 15 wpm transcription (≤ 8%)",
        hindi:   "64 wpm shorthand, 11 wpm transcription (≤ 8%)"
      }
    },
    senior: {
      allowedPercent: 0.04,
      speeds: {
        english: "100 wpm shorthand, 20 wpm transcription (≤ 4%)",
        hindi:   "80 wpm shorthand, 15 wpm transcription (≤ 4%)"
      }
    }
  };

  const RES = {
    title: "Result & Analysis",
    diff: "Error Highlighting",
    name: "Name",
    test: "Test",
    time: "Time",
    words: "Words typed",
    full: "Full mistakes",
    half: "Half mistakes",
    ignored: "Ignored",
    weighted: "Total mistakes",
    allowed: "Allowed",
    final: "Final Result",
    pass: "PASS",
    fail: "FAIL",
    timeUp: "(TIME UP)"
  };

  const state = {
    examKey: "",
    language: "",
    timeSec: 0,
    bookId: "",
    chapterId: "",
    expectedText: "",
    armed: false,
    started: false,
    startTs: 0,
    endTs: 0,
    timerId: null,

    volumeKey: "",
    exerciseMode: "single",     // "single" | "multiple" | "random"
    selectedChapterIds: [],

    hasVolumes: false,
  };

  // ✅ booksMap now includes isPaid
  const booksMap = {};      // bookId -> {title, language, isPaid}
  const chaptersCache = {}; // bookId -> [chapterObj]
  const chaptersById  = {}; // bookId -> { chapterId: chapterObj }

  // chapterObj: { id, code, name, volumeKey, volumeLabel, isPaid, isFree, text }

  // ---------- USER / LOGIN / SUBSCRIPTION (TRIAL REMOVED) ----------
  let userAccess = {
    loggedIn: false,
    subscribed: false,
    loaded: false
  };

  function evaluateAccess(userData) {
    const now = new Date();

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

    return { subscribed };
  }

  function getAuthObj() {
    try {
      if (window.auth && typeof window.auth.onAuthStateChanged === "function") return window.auth;
      if (typeof firebase !== "undefined" && firebase.auth) return firebase.auth();
    } catch {}
    return null;
  }

  async function refreshUserAccess(firebaseUser) {
    if (!firebaseUser || !window.db) {
      userAccess = {
        loggedIn: !!firebaseUser,
        subscribed: false,
        loaded: true
      };
      applyAccessToLessonUI();
      return;
    }

    try {
      const userRef = window.db.collection("users").doc(firebaseUser.uid);
      const snap = await userRef.get();
      const data = snap.data() || {};

      const access = evaluateAccess(data);

      userAccess = {
        loggedIn: true,
        subscribed: !!access.subscribed,
        loaded: true
      };
    } catch (e) {
      console.error("User access load failed (exam):", e);
      userAccess = {
        loggedIn: true,
        subscribed: false,
        loaded: true
      };
    }

    applyAccessToLessonUI();
  }

  function setupAuthListener() {
    const authObj = getAuthObj();
    if (!authObj || typeof authObj.onAuthStateChanged !== "function") {
      userAccess = {
        loggedIn: false,
        subscribed: false,
        loaded: true
      };
      applyAccessToLessonUI();
      return;
    }

    authObj.onAuthStateChanged((user) => {
      refreshUserAccess(user);
    });
  }

  function isLoggedIn() {
    return !!userAccess.loggedIn;
  }

  // ✅ Paid access = subscribed only (trial removed)
  function hasFullPaidAccess() {
    return !!userAccess.loggedIn && !!userAccess.subscribed;
  }

  // ---------- Misc utils ----------
  function getExerciseMode() {
    if (state.exerciseMode) return state.exerciseMode;
    if (el.exerciseMode && el.exerciseMode.value) return el.exerciseMode.value;
    return "single";
  }

  function buildCombinedTextFromChapters(ids) {
    if (!ids || !ids.length || !state.bookId) return "";
    const byId = chaptersById[state.bookId] || {};
    const chunks = [];
    ids.forEach((id) => {
      const txt = byId[id]?.text;
      if (txt) chunks.push(txt);
    });
    return chunks.join("\n\n").trim();
  }

  function formatMMSS(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function escapeHTML(s) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return String(s).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  function setLocked(locked) {
    el.textArea.disabled = locked;
    el.editorLock.style.display = locked ? "grid" : "none";
  }

  function isPaidLessonObj(ch) {
    // ch.isPaid already computed in loadChaptersForBook with book-level isPaid support.
    return !!ch?.isPaid;
  }

  // ---------- Copy/Paste rules ----------
  function setupTextPermissions() {
    el.textArea.addEventListener("paste", (e) => e.preventDefault());
    ["drop", "dragover"].forEach((evt) =>
      el.textArea.addEventListener(evt, (e) => e.preventDefault())
    );

    el.textArea.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      const ctrlLike = e.ctrlKey || e.metaKey;
      const blocked = ["a", "x", "c", "v", "z", "y", "s", "p"];
      if (ctrlLike && blocked.includes(k)) e.preventDefault();
      if ((e.shiftKey && k === "insert") || (ctrlLike && k === "insert")) e.preventDefault();
    });

    el.textArea.addEventListener("copy", (e) => {
      if (state.armed || state.started) {
        e.preventDefault();
        return;
      }
      if (!hasFullPaidAccess()) e.preventDefault();
    });

    el.textArea.addEventListener("cut", (e) => {
      if (state.armed || state.started) {
        e.preventDefault();
        return;
      }
      if (!hasFullPaidAccess()) e.preventDefault();
    });

    el.textArea.addEventListener("contextmenu", (e) => {
      if (state.armed || state.started) e.preventDefault();
    });
  }

  // ---------- Caret lock ----------
  function caretToEnd() {
    const len = el.textArea.value.length;
    try {
      el.textArea.selectionStart = len;
      el.textArea.selectionEnd = len;
    } catch {}
  }

  function shouldLockCaret() {
    return state.started === true;
  }

  function preventBackwardNavKeys(e) {
    if (!shouldLockCaret()) return;

    const key = e.key;
    const ctrlLike = e.ctrlKey || e.metaKey;

    const blockKeys = new Set(["ArrowLeft", "ArrowUp", "Home", "PageUp"]);
    if (blockKeys.has(key)) {
      e.preventDefault();
      caretToEnd();
      return;
    }
    if (
      e.shiftKey &&
      (key.startsWith("Arrow") ||
        key === "Home" ||
        key === "End" ||
        key === "PageUp" ||
        key === "PageDown")
    ) {
      e.preventDefault();
      caretToEnd();
      return;
    }
    if (ctrlLike) {
      e.preventDefault();
      caretToEnd();
      return;
    }
  }

  function preventMouseReposition(e) {
    if (!shouldLockCaret()) return;
    e.preventDefault();
    el.textArea.focus();
    caretToEnd();
  }

  function wireCaretLockEvents() {
    el.textArea.addEventListener("keydown", preventBackwardNavKeys);
    ["mousedown", "mouseup", "click", "dblclick", "select", "selectstart"].forEach((evt) => {
      el.textArea.addEventListener(evt, preventMouseReposition);
    });
    el.textArea.addEventListener("input", () => {
      if (shouldLockCaret()) caretToEnd();
    });
    document.addEventListener("selectionchange", () => {
      if (!shouldLockCaret()) return;
      if (document.activeElement === el.textArea) caretToEnd();
    });
  }

  // ---------- Typography ----------
  function currentLevelKey() {
    const p = EXAM_PROFILES[state.examKey];
    return p?.level || "junior";
  }

  function applyTypography() {
    if (!state.examKey || !state.language) return;
    const p = EXAM_PROFILES[state.examKey];

    el.textArea.classList.remove("hindi-view");
    el.textArea.style.removeProperty("--hindiViewSize");

    if (state.language === "hindi") {
      el.textArea.style.fontFamily =
        `"Kruti Dev 010","Kruti Dev 10",Mangal,"Noto Sans Devanagari",sans-serif`;
      el.textArea.style.fontSize = "14pt";
      el.textArea.style.lineHeight = "1.5";
      el.fontDisplay.textContent = `${p.name} • Hindi • Kruti Dev 10 • 14 • Line 1.5`;

      el.textArea.classList.add("hindi-view");
      el.textArea.style.setProperty("--hindiViewSize", "18pt");
    } else {
      el.textArea.style.fontFamily = `Arial, sans-serif`;
      el.textArea.style.fontSize = "12pt";
      el.textArea.style.lineHeight = "1.5";
      el.fontDisplay.textContent = `${p.name} • English • Arial • 12 • Line 1.5`;
    }
  }

  function renderRules() {
    if (!state.examKey) {
      el.rulesBox.textContent = "Select test to load rules…";
      return;
    }
    const level = currentLevelKey();
    const lr = LEVEL_RULES[level];
    const speedLine = state.language ? lr.speeds[state.language] : "Select language to view speeds";
    el.rulesBox.innerHTML = `
      <div><b>Level:</b> ${level.toUpperCase()}</div>
      <div><b>Allowed mistakes:</b> ${(lr.allowedPercent * 100).toFixed(0)}% of words typed</div>
      <div><b>Expected speed:</b> ${speedLine}</div>
      <div><b>Paste:</b> Blocked</div>
      <div><b>Copy/Cut:</b> Disabled during exam</div>
    `;
  }

  function updateMetaLine() {
    const testName = state.examKey ? EXAM_PROFILES[state.examKey].name : "—";
    const lang = state.language || "—";
    const book = state.bookId ? (booksMap[state.bookId]?.title || state.bookId) : "—";

    let lessonLabel = "—";
    const mode = getExerciseMode();
    if ((mode === "multiple" || mode === "random") && state.selectedChapterIds.length > 1) {
      lessonLabel = `${mode === "random" ? "Random pool" : "Multiple"} (${state.selectedChapterIds.length})`;
    } else if (state.chapterId) {
      lessonLabel = state.chapterId;
    }

    el.metaSelected.textContent = `Test: ${testName} | Lang: ${lang} | Book: ${book} | Lesson: ${lessonLabel}`;
  }

  function populateTimeOptions() {
    el.examTime.innerHTML = `<option value="" selected disabled>Select time</option>`;
    if (!state.examKey) {
      el.examTime.disabled = true;
      el.timeHint.textContent = "Select test first.";
      return;
    }
    const p = EXAM_PROFILES[state.examKey];
    p.timeOptionsMin.forEach((min) => {
      const opt = document.createElement("option");
      opt.value = String(min);
      opt.textContent = `${min} min`;
      el.examTime.appendChild(opt);
    });
    el.examTime.disabled = false;
    el.timeHint.textContent = "Timer starts on first typed character.";
  }

  // ---------- Checkbox list for multiple/random ----------
  function renderLessonCheckboxesForScope() {
    if (!el.lessonCheckboxGroup || !el.lessonCheckboxList || !state.bookId) return;

    const mode = getExerciseMode();
    if (mode === "single") {
      el.lessonCheckboxGroup.style.display = "none";
      el.lessonCheckboxGroup.hidden = true;
      el.lessonCheckboxList.innerHTML = "";
      return;
    }

    el.lessonCheckboxGroup.style.display = "";
    el.lessonCheckboxGroup.hidden = false;

    const all = chaptersCache[state.bookId] || [];
    let filtered = all;
    if (state.volumeKey) {
      filtered = all.filter((ch) => ch.volumeKey === state.volumeKey);
    }

    el.lessonCheckboxList.innerHTML = "";

    if (!filtered.length) {
      el.lessonCheckboxList.textContent = "No lessons available for this selection.";
      return;
    }

    const selectedSet = new Set(state.selectedChapterIds || []);
    const loggedIn = isLoggedIn();
    const fullPaid = hasFullPaidAccess();

    filtered.forEach((ch) => {
      const row = document.createElement("label");
      row.className = "lesson-checkbox-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = ch.id;

      const isPaid = isPaidLessonObj(ch);

      let suffix = "";
      let disabled = false;

      if (isPaid) {
        if (!loggedIn) {
          suffix = " (Login required)";
          disabled = true;
        } else if (!fullPaid) {
          suffix = " (Paid plan required)";
          disabled = true;
        } else {
          suffix = " (Paid)";
        }
      }

      let label = `${(ch.code || "").trim()} ${(ch.name || "").trim()}`.trim() || "Lesson";
      label += suffix;

      cb.disabled = disabled;
      cb.checked = selectedSet.has(ch.id);

      const span = document.createElement("span");
      span.textContent = label;

      row.appendChild(cb);
      row.appendChild(span);
      el.lessonCheckboxList.appendChild(row);
    });
  }

  function applyLessonModeUI() {
    const mode = getExerciseMode();
    const lessonSelectGroup = el.lessonSelect ? el.lessonSelect.parentElement : null;

    if (mode === "single") {
      if (lessonSelectGroup) lessonSelectGroup.style.display = "";
      el.lessonSelect.multiple = false;
      el.lessonSelect.size = 1;
      renderLessonCheckboxesForScope();
    } else {
      if (lessonSelectGroup) lessonSelectGroup.style.display = "none";
      renderLessonCheckboxesForScope();
    }

    if (el.exerciseModeHint) {
      if (mode === "single") {
        el.exerciseModeHint.textContent = "Single: ek hi lesson select karein.";
      } else if (mode === "multiple") {
        el.exerciseModeHint.textContent =
          "Multiple: neeche list me tick karke kaun kaun se lessons ek sath check karne hain, select karein.";
      } else {
        el.exerciseModeHint.textContent =
          "Random: neeche list me tick karke pool banayein; Start par unme se koi 1 lesson random choose hoga.";
      }
    }
  }

  // ---------- Ready check ----------
  function isReadySelections() {
    if (!state.examKey || !state.language || !state.timeSec || !state.bookId) return false;

    const mode = getExerciseMode();
    if (mode === "random") {
      return !!(state.selectedChapterIds && state.selectedChapterIds.length);
    }
    return !!(state.selectedChapterIds && state.selectedChapterIds.length && state.expectedText);
  }

  function refreshUIState() {
    applyTypography();
    renderRules();
    updateMetaLine();

    el.btnStart.disabled = !isReadySelections() || state.armed;
    el.btnCheck.disabled = !state.started;
    el.btnReset.disabled = false;
    if (el.btnPrint) el.btnPrint.disabled = el.resultSection.hidden;

    if (!isReadySelections()) {
      setLocked(true);
      el.timerStatus.textContent = "INACTIVE";
      el.timerDisplay.textContent = "--:--";
      return;
    }

    if (!state.armed) {
      setLocked(true);
      el.timerStatus.textContent = "SELECTED";
      el.timerDisplay.textContent = formatMMSS(state.timeSec);
      return;
    }

    if (!state.started) {
      setLocked(false);
      el.timerStatus.textContent = "READY";
      el.timerDisplay.textContent = formatMMSS(state.timeSec);
    }
  }

  // ---------- Timer ----------
  function startTimerIfNeeded() {
    if (!state.armed) return;
    if (state.started) return;
    if (!el.textArea.value || el.textArea.value.length < 1) return;

    state.started = true;
    state.startTs = Date.now();
    el.timerStatus.textContent = "RUNNING";
    el.btnCheck.disabled = false;

    caretToEnd();

    state.timerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.startTs) / 1000);
      const remaining = Math.max(0, state.timeSec - elapsed);
      el.timerDisplay.textContent = formatMMSS(remaining);

      if (remaining <= 0) {
        clearInterval(state.timerId);
        state.timerId = null;
        state.endTs = Date.now();
        el.timerStatus.textContent = "TIME UP";
        lockAndEvaluate(true);
      }
    }, 250);
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
    if (state.started && !state.endTs) state.endTs = Date.now();
  }

  // ---------- Firestore: books / chapters ----------
  function clearBooksMap() {
    for (const k of Object.keys(booksMap)) delete booksMap[k];
  }

  function matchesLanguage(bookLang) {
    const bl = String(bookLang || "").toLowerCase();
    if (state.language === "english") return bl === "english";
    if (state.language === "hindi") return bl.startsWith("hindi");
    return true;
  }

  function rebuildBookOptions() {
    el.bookSelect.innerHTML = `<option value="" selected disabled>Select book</option>`;
    const ids = Object.keys(booksMap).filter((id) => matchesLanguage(booksMap[id].language));
    ids.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = booksMap[id].title;
      el.bookSelect.appendChild(opt);
    });
    if (!ids.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.disabled = true;
      opt.textContent = "No books for selected language";
      el.bookSelect.appendChild(opt);
    }
  }

  async function loadBooksFromAdmin() {
    el.bookSelect.disabled = true;
    el.bookSelect.innerHTML = `<option value="" selected disabled>Loading…</option>`;

    if (!window.db) {
      el.bookSelect.innerHTML = `<option value="" selected disabled>Firestore not connected</option>`;
      return;
    }

    const snap = await window.db.collection("books").orderBy("title", "asc").get();
    clearBooksMap();
    snap.forEach((doc) => {
      const b = doc.data() || {};
      booksMap[doc.id] = {
        title: b.title || "Untitled book",
        language: b.language || "english",
        isPaid: !!b.isPaid
      };
    });

    el.bookSelect.disabled = false;
    rebuildBookOptions();
  }

  function rebuildLessonOptionsNoVolume() {
    if (!el.lessonSelect || !state.bookId) return;

    const chapters = chaptersCache[state.bookId] || [];
    const loggedIn = isLoggedIn();
    const fullPaid = hasFullPaidAccess();

    if (!chapters.length) {
      el.lessonSelect.innerHTML = `<option value="" selected disabled>No lessons added yet</option>`;
      el.lessonSelect.disabled = true;
      renderLessonCheckboxesForScope();
      return;
    }

    el.lessonSelect.innerHTML = `<option value="" selected disabled>Select lesson</option>`;
    chapters.forEach((ch) => {
      const opt = document.createElement("option");
      opt.value = ch.id;

      let label = `${(ch.code || "").trim()} ${(ch.name || "").trim()}`.trim() || "Lesson";
      if (ch.isPaid) {
        if (!loggedIn) {
          label += " (Login required)";
          opt.disabled = true;
        } else if (!fullPaid) {
          label += " (Paid plan required)";
          opt.disabled = true;
        } else {
          label += " (Paid)";
        }
      }

      opt.textContent = label;
      el.lessonSelect.appendChild(opt);
    });

    el.lessonSelect.disabled = false;
    renderLessonCheckboxesForScope();
  }

  function rebuildLessonOptionsForVolume() {
    if (!el.lessonSelect || !state.bookId) return;

    const all = chaptersCache[state.bookId] || [];
    let filtered = all;
    if (state.volumeKey) {
      filtered = all.filter((ch) => ch.volumeKey === state.volumeKey);
    }

    const loggedIn = isLoggedIn();
    const fullPaid = hasFullPaidAccess();

    if (!filtered.length) {
      el.lessonSelect.innerHTML = `<option value="" selected disabled>No lessons for this volume</option>`;
      el.lessonSelect.disabled = true;
      renderLessonCheckboxesForScope();
      return;
    }

    el.lessonSelect.innerHTML = `<option value="" selected disabled>Select lesson</option>`;
    filtered.forEach((ch) => {
      const opt = document.createElement("option");
      opt.value = ch.id;

      let label = `${(ch.code || "").trim()} ${(ch.name || "").trim()}`.trim() || "Lesson";

      if (ch.isPaid) {
        if (!loggedIn) {
          label += " (Login required)";
          opt.disabled = true;
        } else if (!fullPaid) {
          label += " (Paid plan required)";
          opt.disabled = true;
        } else {
          label += " (Paid)";
        }
      }

      opt.textContent = label;
      el.lessonSelect.appendChild(opt);
    });

    el.lessonSelect.disabled = false;
    renderLessonCheckboxesForScope();
  }

  async function loadChaptersForBook(bookId) {
    el.lessonSelect.disabled = true;
    el.lessonSelect.innerHTML = `<option value="" selected disabled>Loading lessons…</option>`;

    if (el.volumeSelect) {
      el.volumeSelect.disabled = true;
      el.volumeSelect.innerHTML = `<option value="" selected disabled>Loading volumes…</option>`;
    }

    state.volumeKey = "";
    state.chapterId = "";
    state.selectedChapterIds = [];
    state.expectedText = "";
    state.hasVolumes = false;

    if (!window.db || !bookId) return;

    const snap = await window.db
      .collection("books")
      .doc(bookId)
      .collection("chapters")
      .orderBy("order", "asc")
      .get();

    if (snap.empty) {
      el.lessonSelect.innerHTML = `<option value="" selected disabled>No lessons added yet</option>`;
      if (el.volumeSelect) {
        el.volumeSelect.disabled = true;
        el.volumeSelect.innerHTML = `<option value="" selected disabled>No volumes</option>`;
      }
      renderLessonCheckboxesForScope();
      return;
    }

    const chapters = [];
    const byId = {};
    const volumeMap = new Map();

    const bookPaid = !!booksMap[bookId]?.isPaid;

    snap.forEach((doc) => {
      const ch = doc.data() || {};
      const text = (ch.text ?? ch.content ?? ch.body ?? ch.chapterText ?? ch.passage ?? "")
        .toString()
        .trim();

      const volumeKey = (
        ch.volume ??
        ch.volumeCode ??
        ch.volumeId ??
        ch.volumeKey ??
        ""
      ).toString().trim();

      const volumeLabel = (
        ch.volumeName ??
        ch.volumeTitle ??
        ch.volumeLabel ??
        ch.volume ??
        volumeKey
      ).toString().trim();

      // ✅ paid detection (chapter-level + book-level)
      // If book is paid => chapter is paid unless explicitly isFree === true
      const chapterPaid =
        ch.isFree === false ||
        ch.isPaid === true ||
        ch.paid === true ||
        ch.requiresSubscription === true;

      const isPaid = chapterPaid || (bookPaid && ch.isFree !== true);

      const obj = {
        id: doc.id,
        code: (ch.code || "").toString().trim(),
        name: (ch.name || "").toString().trim(),
        volumeKey,
        volumeLabel,
        isPaid,
        isFree: ch.isFree,
        text,
      };

      chapters.push(obj);
      byId[doc.id] = obj;

      if (volumeKey) {
        const label = volumeLabel || volumeKey;
        if (!volumeMap.has(volumeKey)) volumeMap.set(volumeKey, label);
      }
    });

    chaptersCache[bookId] = chapters;
    chaptersById[bookId] = byId;

    const hasVolumes = el.volumeSelect && volumeMap.size > 0;
    state.hasVolumes = !!hasVolumes;

    if (!hasVolumes) {
      if (el.volumeSelect) {
        el.volumeSelect.disabled = true;
        el.volumeSelect.innerHTML = `<option value="" selected disabled>No volumes</option>`;
      }
      rebuildLessonOptionsNoVolume();
      return;
    }

    // With volumes
    el.lessonSelect.innerHTML = `<option value="" selected disabled>Select volume first</option>`;
    el.lessonSelect.disabled = true;

    el.volumeSelect.innerHTML = `<option value="" selected disabled>Select volume</option>`;
    volumeMap.forEach((label, key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = label || key;
      el.volumeSelect.appendChild(opt);
    });
    el.volumeSelect.disabled = false;

    renderLessonCheckboxesForScope();
  }

  async function loadChapterText(bookId, chapterId) {
    state.expectedText = "";
    if (!bookId || !chapterId) return;

    const fromCache = chaptersById[bookId]?.[chapterId];
    if (fromCache && fromCache.text) {
      state.expectedText = String(fromCache.text || "").trim();
      return;
    }

    if (!window.db) return;

    const doc = await window.db
      .collection("books")
      .doc(bookId)
      .collection("chapters")
      .doc(chapterId)
      .get();

    const ch = doc.exists ? doc.data() || {} : {};
    const text = ch.text ?? ch.content ?? ch.body ?? ch.chapterText ?? ch.passage ?? "";
    state.expectedText = String(text || "").trim();
  }

  // ---------- Heights ----------
  function computeNotepadMinHeight() {
    const header = document.querySelector("header.navbar");
    const headerH = header ? header.offsetHeight : 0;
    const topstripH = el.topstrip ? el.topstrip.offsetHeight : 0;
    const actionsH = el.leftActions ? el.leftActions.offsetHeight : 0;
    const extras = 56;
    const minH = Math.max(380, window.innerHeight - headerH - topstripH - actionsH - extras);
    if (el.textArea) el.textArea.style.setProperty("--noteH", `${minH}px`);
    return minH;
  }

  function syncPanelHeight() {
    if (!el.examPanel || !el.topstrip || !el.notepadWrap || !el.leftActions) return;

    const noteH = computeNotepadMinHeight();
    const topstripH = el.topstrip.offsetHeight || 0;
    const actionsH = el.leftActions.offsetHeight || 0;
    const leftH = topstripH + noteH + actionsH + 24;

    let panelContentH = 0;
    const prevH = el.examPanel.style.height;
    el.examPanel.style.height = "auto";
    panelContentH = el.examPanel.scrollHeight || 0;
    el.examPanel.style.height = prevH;

    const h = Math.max(leftH, panelContentH);
    el.examPanel.style.setProperty("--panelH", `${h}px`);
  }

  // ---------- Diff ----------
  function buildDiffHTML(ops) {
    const out = [];
    for (const op of (ops || [])) {
      if (op.type === "eq") out.push(escapeHTML(op.typed));
      else if (op.type === "del")
        out.push(`<span class="w-missing">${escapeHTML(op.orig)}</span>`);
      else if (op.type === "ins")
        out.push(`<span class="w-extra">${escapeHTML(op.typed)}</span>`);
      else if (op.type === "sub")
        out.push(
          `<span class="w-wrong">${escapeHTML(
            op.typed
          )}</span><span class="w-suggest">(${escapeHTML(op.orig)})</span>`
        );
    }
    return out.join(" ");
  }

  function applyResultFontSameAsTyping() {
    const cs = window.getComputedStyle(el.textArea);
    el.diffOutput.style.fontFamily = cs.fontFamily;
    el.diffOutput.style.fontSize = cs.fontSize;
    el.diffOutput.style.lineHeight = cs.lineHeight;
  }

  // ---------- Paid safety (final check) ----------
  function anySelectedChapterPaid() {
    if (!state.bookId || !state.selectedChapterIds || !state.selectedChapterIds.length) return false;
    const byId = chaptersById[state.bookId] || {};
    return state.selectedChapterIds.some((id) => !!byId[id]?.isPaid);
  }

  function showPaidBlockMessage(reason) {
    if (reason === "login") {
      alert("Ye paid lesson hai. Practice ke liye pehle login ya signup karein.");
    } else {
      alert("Ye paid lesson hai. Practice ke liye paid subscription chahiye.");
    }
  }

  // ---------- Evaluation ----------
  function lockAndEvaluate(isTimeUp) {
    if (anySelectedChapterPaid() && !hasFullPaidAccess()) {
      showPaidBlockMessage(isLoggedIn() ? "subscription" : "login");
      return;
    }

    stopTimer();
    el.textArea.disabled = true;

    const engine = window.ftEngine;
    if (!engine || !engine.computeStatsDetailed) {
      alert("testEngine.js not loaded");
      return;
    }

    const profile = EXAM_PROFILES[state.examKey];
    if (!profile) {
      alert("Exam profile not selected");
      return;
    }

    let expected = state.expectedText || "";
    let typed = el.textArea.value || "";

    const elapsedSec = state.started
      ? Math.max(1, Math.floor(((state.endTs || Date.now()) - state.startTs) / 1000))
      : 1;

    if (window.mistakeRules && typeof window.mistakeRules.normalize === "function") {
      const norm = window.mistakeRules.normalize({
        expected,
        typed,
        language: state.language,
        examKey: state.examKey,
      }) || {};
      expected = norm.expected != null ? norm.expected : expected;
      typed = norm.typed != null ? norm.typed : typed;
    }

    const rawStats = engine.computeStatsDetailed(
      expected,
      typed,
      elapsedSec,
      state.language,
      { examKey: state.examKey }
    );

    let stats = rawStats;
    if (window.mistakeRules && typeof window.mistakeRules.afterStats === "function") {
      const maybe = window.mistakeRules.afterStats(rawStats, {
        expected,
        typed,
        language: state.language,
        examKey: state.examKey,
      });
      if (maybe) stats = maybe;
    }

    const level = currentLevelKey();
    const allowedPercent = LEVEL_RULES[level].allowedPercent;
    const allowedMax = Math.floor(allowedPercent * stats.wordsTyped);
    const pass = stats.weightedMistakes <= allowedMax;

    el.resultSection.hidden = false;
    el.resultTitle.textContent = RES.title;
    el.diffTitle.textContent = RES.diff;
    if (el.btnPrint) el.btnPrint.disabled = false;

    const name = (el.candidateName.value || "").trim() || "Candidate";
    const timeText = `${formatMMSS(elapsedSec)} / ${formatMMSS(state.timeSec)} ${
      isTimeUp ? RES.timeUp : ""
    }`;

    const gridHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px;">
        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.name}:</b> ${escapeHTML(name)}
        </div>
        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.test}:</b> ${escapeHTML(profile.name)}
        </div>

        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.time}:</b> ${escapeHTML(timeText)}
        </div>
        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.words}:</b> ${stats.wordsTyped}
        </div>

        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.full}:</b> ${stats.fullMistakes}
        </div>
        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.half}:</b> ${stats.halfMistakes}
          <span style="opacity:.8;">(${RES.ignored}: ${stats.ignoredMistakes})</span>
        </div>

        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.weighted}:</b> ${stats.weightedMistakes.toFixed(1)}
        </div>
        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.allowed}:</b> ${(allowedPercent * 100).toFixed(0)}% (≤ ${allowedMax})
        </div>

        <div style="grid-column:1/-1; padding:12px; border-radius:14px; font-weight:900; border:1px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.06);">
          ${RES.final}: ${pass ? RES.pass : RES.fail}
        </div>
      </div>
    `;

    let breakdownHTML = "";
    if (Array.isArray(stats.mistakeDetails) && stats.mistakeDetails.length) {
      breakdownHTML += `<div style="margin-top:14px; padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.04); font-size:13px; line-height:1.5;">`;
      breakdownHTML += `<div style="font-weight:800; margin-bottom:6px;">Mistake breakdown (rule-wise)</div>`;
      breakdownHTML += `<ul style="margin:0; padding-left:18px;">`;
      stats.mistakeDetails.forEach((item, idx) => {
        const t = item.type || "";
        const reason = item.reason || "";
        const count = item.count != null ? item.count : "";
        const weightInfo =
          item.weight != null ? ` (weight: ${escapeHTML(String(item.weight))})` : "";
        breakdownHTML += `<li>#${idx + 1}: <b>${escapeHTML(t)}</b> - ${escapeHTML(
          reason
        )}${count !== "" ? ` (count: ${count})` : ""}${weightInfo}</li>`;
      });
      breakdownHTML += `</ul></div>`;
    } else {
      breakdownHTML += `<div style="margin-top:14px; font-size:12px; opacity:.8;">Full / half / ignored mistakes ka exact reason (exam rules ke hisaab se) yahan future update me dikhega, jab <code>mistake-rules.js</code> me rules define honge.</div>`;
    }

    el.resultSheet.innerHTML = gridHTML + breakdownHTML;

    el.diffOutput.innerHTML = buildDiffHTML(stats.operations);
    applyResultFontSameAsTyping();
    syncPanelHeight();
  }

  function resetAllUI({ keepBooksLoaded = true } = {}) {
    stopTimer();

    state.examKey = "";
    state.language = "";
    state.timeSec = 0;
    state.bookId = "";
    state.chapterId = "";
    state.expectedText = "";
    state.armed = false;
    state.started = false;
    state.startTs = 0;
    state.endTs = 0;

    state.volumeKey = "";
    state.exerciseMode = "single";
    state.selectedChapterIds = [];
    state.hasVolumes = false;

    el.examType.disabled = false;
    el.examLanguage.disabled = false;
    el.examTime.disabled = true;
    el.bookSelect.disabled = true;
    el.lessonSelect.disabled = true;

    el.examType.value = "";
    el.examLanguage.value = "";
    el.examTime.innerHTML = `<option value="" selected disabled>Select time</option>`;

    el.bookSelect.innerHTML = keepBooksLoaded
      ? `<option value="" selected disabled>Select book</option>`
      : `<option value="" selected disabled>Loading…</option>`;
    el.lessonSelect.innerHTML = `<option value="" selected disabled>Select lesson</option>`;

    if (el.volumeSelect) {
      el.volumeSelect.disabled = true;
      el.volumeSelect.innerHTML = `<option value="" selected disabled>Select volume</option>`;
    }

    if (el.lessonCheckboxGroup) {
      el.lessonCheckboxGroup.style.display = "none";
      el.lessonCheckboxGroup.hidden = true;
      el.lessonCheckboxList.innerHTML = "";
    }

    if (el.exerciseMode) {
      el.exerciseMode.disabled = false;
      el.exerciseMode.value = "single";
    }

    el.textArea.value = "";
    el.textArea.style.fontFamily = "";
    el.textArea.style.fontSize = "";
    el.textArea.style.lineHeight = "";
    el.textArea.classList.remove("hindi-view");
    el.textArea.style.removeProperty("--hindiViewSize");

    el.fontDisplay.textContent = "Select settings to enable Start Test…";
    el.metaSelected.textContent = "Test: — | Lang: — | Book: — | Lesson: —";

    el.timerDisplay.textContent = "--:--";
    el.timerStatus.textContent = "INACTIVE";
    setLocked(true);

    el.btnStart.disabled = true;
    el.btnCheck.disabled = true;
    el.btnReset.disabled = false;
    if (el.btnPrint) el.btnPrint.disabled = true;

    el.resultSection.hidden = true;
    el.resultSheet.innerHTML = "";
    el.diffOutput.innerHTML = "";

    el.timeHint.textContent = "Select test first.";
    syncPanelHeight();
  }

  // ✅ When subscription/login state changes, re-apply locks
  function applyAccessToLessonUI() {
    try {
      if (!state.bookId) return;

      // If chapters already loaded for selected book, rebuild options from cache
      if (chaptersCache[state.bookId] && chaptersCache[state.bookId].length) {
        if (state.hasVolumes) {
          if (state.volumeKey) rebuildLessonOptionsForVolume();
          renderLessonCheckboxesForScope();
        } else {
          rebuildLessonOptionsNoVolume();
        }
      }

      refreshUIState();
      syncPanelHeight();
    } catch (e) {
      console.error("applyAccessToLessonUI error:", e);
    }
  }

  function wireEvents() {
    el.examType.addEventListener("change", () => {
      state.examKey = el.examType.value;
      populateTimeOptions();
      refreshUIState();
      syncPanelHeight();
    });

    el.examLanguage.addEventListener("change", () => {
      state.language = el.examLanguage.value;

      state.bookId = "";
      state.chapterId = "";
      state.expectedText = "";
      state.volumeKey = "";
      state.selectedChapterIds = [];
      state.hasVolumes = false;

      rebuildBookOptions();
      el.bookSelect.disabled = false;

      el.lessonSelect.innerHTML = `<option value="" selected disabled>Select lesson</option>`;
      el.lessonSelect.disabled = true;

      if (el.volumeSelect) {
        el.volumeSelect.disabled = true;
        el.volumeSelect.innerHTML = `<option value="" selected disabled>Select volume</option>`;
      }

      renderLessonCheckboxesForScope();
      refreshUIState();
      syncPanelHeight();
    });

    el.examTime.addEventListener("change", () => {
      const min = Number(el.examTime.value);
      state.timeSec = Number.isFinite(min) ? min * 60 : 0;
      el.timerDisplay.textContent = state.timeSec ? formatMMSS(state.timeSec) : "--:--";
      refreshUIState();
      syncPanelHeight();
    });

    el.bookSelect.addEventListener("change", async () => {
      state.bookId = el.bookSelect.value;
      state.chapterId = "";
      state.expectedText = "";
      state.volumeKey = "";
      state.selectedChapterIds = [];
      state.hasVolumes = false;

      if (el.volumeSelect) {
        el.volumeSelect.disabled = true;
        el.volumeSelect.innerHTML = `<option value="" selected disabled>Loading volumes…</option>`;
      }

      await loadChaptersForBook(state.bookId);
      applyLessonModeUI();
      refreshUIState();
      syncPanelHeight();
    });

    if (el.volumeSelect) {
      el.volumeSelect.addEventListener("change", () => {
        state.volumeKey = el.volumeSelect.value || "";
        state.chapterId = "";
        state.selectedChapterIds = [];
        state.expectedText = "";
        rebuildLessonOptionsForVolume();
        applyLessonModeUI();
        refreshUIState();
        syncPanelHeight();
      });
    }

    if (el.exerciseMode) {
      el.exerciseMode.addEventListener("change", () => {
        state.exerciseMode = el.exerciseMode.value || "single";
        state.selectedChapterIds = [];
        state.chapterId = "";
        state.expectedText = "";
        applyLessonModeUI();
        refreshUIState();
        syncPanelHeight();
      });
    }

    el.lessonSelect.addEventListener("change", async () => {
      const mode = getExerciseMode();
      if (mode === "single") {
        const id = el.lessonSelect.value;
        state.selectedChapterIds = id ? [id] : [];
        state.chapterId = id || "";
        await loadChapterText(state.bookId, state.chapterId);
      }
      refreshUIState();
      syncPanelHeight();
    });

    if (el.lessonCheckboxList) {
      el.lessonCheckboxList.addEventListener("change", () => {
        const ids = Array.from(
          el.lessonCheckboxList.querySelectorAll('input[type="checkbox"]:checked')
        )
          .map((cb) => cb.value)
          .filter(Boolean);

        state.selectedChapterIds = ids;
        if (!ids.length) {
          state.chapterId = "";
          state.expectedText = "";
        } else {
          const mode = getExerciseMode();
          state.chapterId = ids[0];
          if (mode === "multiple") {
            state.expectedText = buildCombinedTextFromChapters(ids);
          } else if (mode === "random") {
            state.expectedText = "";
          }
        }

        refreshUIState();
        syncPanelHeight();
      });
    }

    el.btnStart.addEventListener("click", () => {
      const mode = getExerciseMode();

      if (mode === "random") {
        const pool = state.selectedChapterIds.slice();
        if (!pool.length) {
          alert("Random mode ke liye list me se kam se kam 1 lesson tick karein.");
          return;
        }
        const idx = Math.floor(Math.random() * pool.length);
        const chosenId = pool[idx];
        state.selectedChapterIds = [chosenId];
        state.chapterId = chosenId;
        state.expectedText = buildCombinedTextFromChapters([chosenId]);
      }

      if (!isReadySelections()) return;

      if (anySelectedChapterPaid() && !hasFullPaidAccess()) {
        showPaidBlockMessage(isLoggedIn() ? "subscription" : "login");
        return;
      }

      state.armed = true;
      setLocked(false);
      el.timerStatus.textContent = "READY";
      el.textArea.focus();

      el.examType.disabled = true;
      el.examLanguage.disabled = true;
      el.examTime.disabled = true;
      el.bookSelect.disabled = true;
      el.lessonSelect.disabled = true;
      if (el.volumeSelect) el.volumeSelect.disabled = true;
      if (el.exerciseMode) el.exerciseMode.disabled = true;

      refreshUIState();
      syncPanelHeight();
    });

    el.textArea.addEventListener("input", startTimerIfNeeded);

    el.btnCheck.addEventListener("click", () => {
      if (!state.started) return;
      lockAndEvaluate(false);
    });

    if (el.btnPrint) {
      el.btnPrint.addEventListener("click", () => {
        window.print();
      });
    }

    el.btnReset.addEventListener("click", async () => {
      if (!confirm("Reset test?")) return;
      resetAllUI({ keepBooksLoaded: true });
      await loadBooksFromAdmin();
      refreshUIState();
      syncPanelHeight();
    });

    el.btnAgain.addEventListener("click", async () => {
      resetAllUI({ keepBooksLoaded: true });
      await loadBooksFromAdmin();
      refreshUIState();
      syncPanelHeight();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("resize", syncPanelHeight);

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => syncPanelHeight());
      ro.observe(el.textArea);
      ro.observe(el.topstrip);
      ro.observe(el.leftActions);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    setupAuthListener();
    setupTextPermissions();
    wireCaretLockEvents();
    wireEvents();

    resetAllUI({ keepBooksLoaded: false });

    await loadBooksFromAdmin();

    refreshUIState();
    syncPanelHeight();
  });
})();
