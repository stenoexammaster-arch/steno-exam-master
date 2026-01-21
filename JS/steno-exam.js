(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    examType: $("exam-type"),
    examLanguage: $("exam-language"),
    candidateName: $("candidate-name"),
    examTime: $("exam-time"),

    bookSelect: $("book-select"),
    lessonSelect: $("lesson-select"),

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

    resultSection: $("result-section"),
    resultTitle: $("result-title"),
    diffTitle: $("diff-title"),
    resultSheet: $("result-sheet"),
    diffOutput: $("diff-output"),

    timeHint: $("time-hint"),

    // for panel height sync
    topstrip: $("topstrip"),
    notepadWrap: $("notepad-wrap"),
    leftActions: $("left-actions"),
    examPanel: $("exam-panel"),
  };

  // Group C => Senior (4%), Group D => Junior (8%)
  const EXAM_PROFILES = {
    HSSC_C: { name: "HSSC Steno Group C", level: "senior", timeOptionsMin: [5, 10, 15] },
    SSC_C:  { name: "SSC Steno Group C",  level: "senior", timeOptionsMin: [10, 15] },
    SSC_D:  { name: "SSC Steno Group D",  level: "junior", timeOptionsMin: [10, 15] },
  };

  const LEVEL_RULES = {
    junior: {
      allowedPercent: 0.08, // 8%
      speeds: {
        english: "80 wpm shorthand, 15 wpm transcription (≤ 8%)",
        hindi:   "64 wpm shorthand, 11 wpm transcription (≤ 8%)"
      }
    },
    senior: {
      allowedPercent: 0.04, // 4%
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
    language: "", // "english" | "hindi"
    timeSec: 0,
    bookId: "",
    chapterId: "",
    expectedText: "",
    armed: false,
    started: false,
    startTs: 0,
    endTs: 0,
    timerId: null,
  };

  const booksMap = {}; // bookId -> {title, language}

  // ---------- Utils ----------
  function formatMMSS(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function escapeHTML(s) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return String(s).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  function setLocked(locked) {
    el.textArea.disabled = locked;
    el.editorLock.style.display = locked ? "grid" : "none";
  }

  // ---------- Copy/Paste rules ----------
  function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem("sm_user") || "null") || { loggedIn:false, plan:"free" }; }
    catch { return { loggedIn:false, plan:"free" }; }
  }
  function isPremiumUser() {
    const u = getCurrentUser();
    return !!u.loggedIn && String(u.plan).toLowerCase() === "premium";
  }

  function setupTextPermissions() {
    // Paste/drop: always blocked
    el.textArea.addEventListener("paste", (e) => e.preventDefault());
    ["drop","dragover"].forEach(evt => el.textArea.addEventListener(evt, (e) => e.preventDefault()));

    // Shortcuts block (during exam stricter)
    el.textArea.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      const ctrlLike = e.ctrlKey || e.metaKey;
      const blocked = ["a","x","c","v","z","y","s","p"]; // select all, cut, copy, paste, undo, redo, save, print
      if (ctrlLike && blocked.includes(k)) e.preventDefault();
      if ((e.shiftKey && k === "insert") || (ctrlLike && k === "insert")) e.preventDefault();
    });

    // Copy/Cut: block when exam armed/started, else premium rule
    el.textArea.addEventListener("copy", (e) => {
      if (state.armed || state.started) { e.preventDefault(); return; }
      if (!isPremiumUser()) e.preventDefault();
    });
    el.textArea.addEventListener("cut", (e) => {
      if (state.armed || state.started) { e.preventDefault(); return; }
      if (!isPremiumUser()) e.preventDefault();
    });

    // Right-click off during exam
    el.textArea.addEventListener("contextmenu", (e) => {
      if (state.armed || state.started) e.preventDefault();
    });
  }

  // ---------- Caret lock (after typing starts) ----------
  function caretToEnd() {
    const len = el.textArea.value.length;
    try {
      el.textArea.selectionStart = len;
      el.textArea.selectionEnd = len;
    } catch {}
  }
  function shouldLockCaret() {
    // Lock after first typed char. If you want from READY, return state.armed;
    return state.started === true;
  }
  function preventBackwardNavKeys(e) {
    if (!shouldLockCaret()) return;

    const key = e.key;
    const ctrlLike = e.ctrlKey || e.metaKey;

    // Block backward/selection navigation
    const blockKeys = new Set(["ArrowLeft","ArrowUp","Home","PageUp"]);
    if (blockKeys.has(key)) {
      e.preventDefault();
      caretToEnd();
      return;
    }
    if (e.shiftKey && (key.startsWith("Arrow") || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown")) {
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
    ["mousedown","mouseup","click","dblclick","select","selectstart"].forEach(evt => {
      el.textArea.addEventListener(evt, preventMouseReposition);
    });
    el.textArea.addEventListener("input", () => { if (shouldLockCaret()) caretToEnd(); });
    document.addEventListener("selectionchange", () => {
      if (!shouldLockCaret()) return;
      if (document.activeElement === el.textArea) caretToEnd();
    });
  }

  // ---------- Typography (Hindi on-screen bigger, print stays 14pt) ----------
  function applyTypography() {
    if (!state.examKey || !state.language) return;
    const p = EXAM_PROFILES[state.examKey];

    // reset classes
    el.textArea.classList.remove("hindi-view");
    el.textArea.style.removeProperty("--hindiViewSize");

    if (state.language === "hindi") {
      el.textArea.style.fontFamily = `"Kruti Dev 010","Kruti Dev 10",Mangal,"Noto Sans Devanagari",sans-serif`;
      el.textArea.style.fontSize = "14pt"; // base for print
      el.textArea.style.lineHeight = "1.5";
      el.fontDisplay.textContent = `${p.name} • Hindi • Kruti Dev 10 • 14 • Line 1.5`;

      // On-screen only: bigger font
      el.textArea.classList.add("hindi-view");
      el.textArea.style.setProperty("--hindiViewSize", "18pt"); // adjust to 17pt/18pt if you want bigger
    } else {
      el.textArea.style.fontFamily = `Arial, sans-serif`;
      el.textArea.style.fontSize = "12pt";
      el.textArea.style.lineHeight = "1.5";
      el.fontDisplay.textContent = `${p.name} • English • Arial • 12 • Line 1.5`;
    }
  }

  function currentLevelKey() {
    const p = EXAM_PROFILES[state.examKey];
    return p?.level || "junior";
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
      <div><b>Allowed mistakes:</b> ${(lr.allowedPercent*100).toFixed(0)}% of words typed</div>
      <div><b>Expected speed:</b> ${speedLine}</div>
      <div><b>Paste:</b> Blocked</div>
      <div><b>Copy/Cut:</b> Disabled during exam</div>
    `;
  }

  function updateMetaLine() {
    const testName = state.examKey ? EXAM_PROFILES[state.examKey].name : "—";
    const lang = state.language || "—";
    const book = state.bookId ? (booksMap[state.bookId]?.title || state.bookId) : "—";
    const lesson = state.chapterId || "—";
    el.metaSelected.textContent = `Test: ${testName} | Lang: ${lang} | Book: ${book} | Lesson: ${lesson}`;
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

  function isReadySelections() {
    return !!(state.examKey && state.language && state.timeSec && state.bookId && state.chapterId && state.expectedText);
  }

  function refreshUIState() {
    applyTypography();
    renderRules();
    updateMetaLine();

    // Buttons state
    el.btnStart.disabled = !isReadySelections() || state.armed;
    el.btnCheck.disabled = !state.started; // enable after typed
    el.btnReset.disabled = false;          // always available

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

  // ---------- Firestore books/chapters ----------
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
    const ids = Object.keys(booksMap).filter(id => matchesLanguage(booksMap[id].language));
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

    const snap = await window.db.collection("books").orderBy("title","asc").get();
    clearBooksMap();
    snap.forEach((doc) => {
      const b = doc.data() || {};
      booksMap[doc.id] = { title: b.title || "Untitled book", language: b.language || "english" };
    });

    el.bookSelect.disabled = false;
    rebuildBookOptions();
  }

  async function loadChaptersForBook(bookId) {
    el.lessonSelect.disabled = true;
    el.lessonSelect.innerHTML = `<option value="" selected disabled>Loading lessons…</option>`;
    if (!window.db || !bookId) return;

    const snap = await window.db
      .collection("books")
      .doc(bookId)
      .collection("chapters")
      .orderBy("order","asc")
      .get();

    if (snap.empty) {
      el.lessonSelect.innerHTML = `<option value="" selected disabled>No lessons added yet</option>`;
      return;
    }

    el.lessonSelect.innerHTML = `<option value="" selected disabled>Select lesson</option>`;
    snap.forEach((doc) => {
      const ch = doc.data() || {};
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = `${(ch.code || "").trim()} ${(ch.name || "").trim()}`.trim() || "Lesson";
      el.lessonSelect.appendChild(opt);
    });

    el.lessonSelect.disabled = false;
  }

  async function loadChapterText(bookId, chapterId) {
    state.expectedText = "";
    if (!window.db || !bookId || !chapterId) return;

    const doc = await window.db
      .collection("books")
      .doc(bookId)
      .collection("chapters")
      .doc(chapterId)
      .get();

    const ch = doc.exists ? (doc.data() || {}) : {};
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

    // Measure panel content height
    let panelContentH = 0;
    const prevH = el.examPanel.style.height;
    el.examPanel.style.height = "auto";
    panelContentH = el.examPanel.scrollHeight || 0;
    el.examPanel.style.height = prevH;

    const h = Math.max(leftH, panelContentH);
    el.examPanel.style.setProperty("--panelH", `${h}px`);
  }

  // ---------- Diff rendering ----------
  function buildDiffHTML(ops) {
    const out = [];
    for (const op of (ops || [])) {
      if (op.type === "eq") out.push(escapeHTML(op.typed));
      else if (op.type === "del") out.push(`<span class="w-missing">${escapeHTML(op.orig)}</span>`);
      else if (op.type === "ins") out.push(`<span class="w-extra">${escapeHTML(op.typed)}</span>`);
      else if (op.type === "sub") out.push(
        `<span class="w-wrong">${escapeHTML(op.typed)}</span><span class="w-suggest">(${escapeHTML(op.orig)})</span>`
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

  function lockAndEvaluate(isTimeUp) {
    stopTimer();
    el.textArea.disabled = true;

    const engine = window.ftEngine;
    if (!engine || !engine.computeStatsDetailed) {
      alert("testEngine.js not loaded");
      return;
    }

    const profile = EXAM_PROFILES[state.examKey];
    const expected = state.expectedText || "";
    const typed = el.textArea.value || "";

    const elapsedSec = state.started
      ? Math.max(1, Math.floor(((state.endTs || Date.now()) - state.startTs) / 1000))
      : 1;

    const stats = engine.computeStatsDetailed(expected, typed, elapsedSec, state.language, { examKey: state.examKey });

    // Percent-based allowed mistakes
    const level = currentLevelKey();
    const allowedPercent = LEVEL_RULES[level].allowedPercent;
    const allowedMax = Math.floor(allowedPercent * stats.wordsTyped);
    const pass = stats.weightedMistakes <= allowedMax;

    el.resultSection.hidden = false;
    el.resultTitle.textContent = RES.title;
    el.diffTitle.textContent = RES.diff;

    const name = (el.candidateName.value || "").trim() || "Candidate";
    const timeText = `${formatMMSS(elapsedSec)} / ${formatMMSS(state.timeSec)} ${isTimeUp ? RES.timeUp : ""}`;

    el.resultSheet.innerHTML = `
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
          <b>${RES.half}:</b> ${stats.halfMistakes} <span style="opacity:.8;">(${RES.ignored}: ${stats.ignoredMistakes})</span>
        </div>

        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.weighted}:</b> ${stats.weightedMistakes.toFixed(1)}
        </div>
        <div style="padding:12px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:rgba(255,255,255,0.04);">
          <b>${RES.allowed}:</b> ${(allowedPercent*100).toFixed(0)}% (≤ ${allowedMax})
        </div>

        <div style="grid-column:1/-1; padding:12px; border-radius:14px; font-weight:900; border:1px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.06);">
          ${RES.final}: ${pass ? RES.pass : RES.fail}
        </div>
      </div>
    `;

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

    // Buttons
    el.btnStart.disabled = true;
    el.btnCheck.disabled = true;
    el.btnReset.disabled = false;

    el.resultSection.hidden = true;
    el.resultSheet.innerHTML = "";
    el.diffOutput.innerHTML = "";

    el.timeHint.textContent = "Select test first.";
    syncPanelHeight();
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

      rebuildBookOptions();
      el.bookSelect.disabled = false;

      el.lessonSelect.innerHTML = `<option value="" selected disabled>Select lesson</option>`;
      el.lessonSelect.disabled = true;

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
      await loadChaptersForBook(state.bookId);
      refreshUIState();
      syncPanelHeight();
    });

    el.lessonSelect.addEventListener("change", async () => {
      state.chapterId = el.lessonSelect.value;
      await loadChapterText(state.bookId, state.chapterId);
      refreshUIState();
      syncPanelHeight();
    });

    el.btnStart.addEventListener("click", () => {
      if (!isReadySelections()) return;
      state.armed = true;
      setLocked(false);
      el.timerStatus.textContent = "READY";
      el.textArea.focus();

      // lock settings after Start
      el.examType.disabled = true;
      el.examLanguage.disabled = true;
      el.examTime.disabled = true;
      el.bookSelect.disabled = true;
      el.lessonSelect.disabled = true;

      refreshUIState();
      syncPanelHeight();
    });

    // Typing starts timer
    el.textArea.addEventListener("input", startTimerIfNeeded);

    // Check Dictation / Show Result
    el.btnCheck.addEventListener("click", () => {
      if (!state.started) return;
      lockAndEvaluate(false);
    });

    // Reset (always available)
    el.btnReset.addEventListener("click", async () => {
      if (!confirm("Reset test?")) return;
      resetAllUI({ keepBooksLoaded: true });
      await loadBooksFromAdmin();
      refreshUIState();
      syncPanelHeight();
    });

    // Test Again (from result)
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
    setupTextPermissions();
    wireCaretLockEvents();
    wireEvents();

    resetAllUI({ keepBooksLoaded: false });

    await loadBooksFromAdmin();

    const u = getCurrentUser();
    if (u?.name && !el.candidateName.value) el.candidateName.value = u.name;

    refreshUIState();
    syncPanelHeight();
  });

})();