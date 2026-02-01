// js/typing.js
// FINAL: Word-based errors, Unicode-safe (English + Hindi)
// --------------------------------------------------------
// Gross WPM  = (Total Characters Typed ÷ 5) ÷ Time in Minutes
// Net WPM    = Gross WPM − (ErrorWords ÷ Time in Minutes)
// Accuracy%  ≈ ((TotalChars − ErrorWords*5) ÷ TotalChars) × 100
//
// ErrorWords:
//   - If typed word != reference word at same index => 1 error word
//   - Extra typed word beyond reference             => 1 error word
//   - Missing reference word beyond typed           => 1 error word
//
// 1 wrong word = 1 full penalty, NOT per character.
// Backspace reduces wrong words naturally because we recompute fresh each time.

(function () {
  "use strict";

  const AFTER_TEST_REDIRECT = "result.html";
  const LOGIN_URL           = "login.html";

  // ---------------- DOM references ----------------

  const typingTextEl   = document.getElementById("typing-text");
  const typingInputEl  = document.getElementById("typing-input");
  const sessionLabelEl = document.getElementById("session-label");

  const timeEl    = document.getElementById("time");
  const gwpmTopEl = document.getElementById("gwpm-top");
  const nwpmTopEl = document.getElementById("nwpm-top");
  const accuTopEl = document.getElementById("accu-top");
  const timeTopEl = document.getElementById("time-top");

  const restartBtn              = document.getElementById("restart-btn"); // may be null
  const autoScrollCheckbox      = document.getElementById("auto-scroll-enabled");
  const backspaceAllowedCheckbox= document.getElementById("backspace-allowed");
  const pauseToggle             = document.getElementById("pause-time-toggle");

  const timeButtons    = Array.from(document.querySelectorAll(".time-buttons .time-btn"));
  const timeLimitSelect= document.getElementById("time-limit-select");

  const userNameEl  = document.getElementById("practice-user-name");
  const modePillEl  = document.getElementById("px-mode-pill");
  const layoutPillEl= document.getElementById("px-layout-pill");

  const resetBtn  = document.getElementById("reset-btn");
  const finishBtn = document.getElementById("finish-btn");

  if (!typingTextEl || !typingInputEl) return;

  // On-screen keyboard refs (if present)
  const keyboardKeyEls = {};
  document.querySelectorAll(".practice-keyboard [data-key]").forEach((el) => {
    const key = el.dataset.key;
    if (key) keyboardKeyEls[key] = el;
  });

  // ---------------- Global state ----------------

  const state = {
    running: false,
    finished: false,
    paused: false,
    elapsedSeconds: 0,
    timeLimitSeconds: 300,
    timerId: null,

    lang: "english",
    targetText: "",
    targetTokens: [],
    targetWords: [],
    wordEls: [],

    locked: false,
    allowTimeChange: true,

    ring: null,

    totalKeystrokes: 0,
    backspaceCount: 0
  };

  let activeConfig = null;

  // ---------------- Helpers ----------------

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        default: return ch;
      }
    });
  }

  function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem("sm_user") || "null") || {}; }
    catch { return {}; }
  }

  function isLoggedIn() {
    const u = getCurrentUser();
    return !!u.loggedIn;
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateTimeUI(seconds) {
    const formatted = formatTime(seconds);
    if (timeEl)    timeEl.textContent    = formatted;
    if (timeTopEl) timeTopEl.textContent = formatted;
  }

  function normalizeKeyChar(ch) {
    if (!ch) return null;
    if (/[a-zA-Z]/.test(ch)) return ch.toLowerCase();
    if (ch === " ") return " ";
    return null;
  }

  function clearKeyboardHighlight() {
    Object.values(keyboardKeyEls).forEach((el) =>
      el.classList.remove("kbd-next", "kbd-correct", "kbd-error")
    );
  }

  function updateKeyboardHighlight(expectedChar, typedChar) {
    clearKeyboardHighlight();
    if (state.lang !== "english") return;

    const expKey   = normalizeKeyChar(expectedChar);
    const typedKey = normalizeKeyChar(typedChar);

    if (expKey && keyboardKeyEls[expKey]) {
      keyboardKeyEls[expKey].classList.add("kbd-next");
    }
    if (typedKey && keyboardKeyEls[typedKey]) {
      keyboardKeyEls[typedKey].classList.add(
        expKey && typedKey === expKey ? "kbd-correct" : "kbd-error"
      );
    }
  }

  // ---------------- Unicode-safe segmentation ----------------

  function segmentText(str) {
    if (!str) return [];
    const normalized = String(str).normalize("NFC");

    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(seg.segment(normalized), s => s.segment);
    }

    return Array.from(normalized);
  }

  // ---------------- WORD-BASED EXAM STATS (main fix) ----------------

  function computeBasicStats(targetText, typedText, elapsedSeconds) {
    // Characters (Unicode-safe) for speed
    const typedSeg   = segmentText(typedText);
    const typedChars = typedSeg.length;

    // Words (space-based) for error counting
    const refWords = String(targetText || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const typedWords = String(typedText || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const lenRefW   = refWords.length;
    const lenTypedW = typedWords.length;
    const minW      = Math.min(lenRefW, lenTypedW);

    let errorWords = 0;

    // Wrong/mismatched words
    for (let i = 0; i < minW; i++) {
      if (typedWords[i] !== refWords[i]) {
        errorWords++;
      }
    }

    // Extra words beyond reference
    if (lenTypedW > lenRefW) {
      errorWords += (lenTypedW - lenRefW);
    }
    // Missing reference words beyond typed
    else if (lenRefW > lenTypedW) {
      errorWords += (lenRefW - lenTypedW);
    }

    const elapsed = Math.max(elapsedSeconds || 1, 1); // total time
    const minutes = elapsed / 60;

    // 1 exam word = 5 characters
    const grossWords = typedChars / 5;
    const grossWpm   = minutes > 0 ? grossWords / minutes : 0;

    const errorPerMin = minutes > 0 ? errorWords / minutes : 0;
    let   netWpm      = grossWpm - errorPerMin;
    if (!Number.isFinite(netWpm) || netWpm < 0) netWpm = 0;

    // Approximate correct chars as "words without error" × 5
    const approxCorrectWords = Math.max(grossWords - errorWords, 0);
    let   correctChars       = Math.round(approxCorrectWords * 5);
    if (correctChars > typedChars) correctChars = typedChars;
    const errorChars         = Math.max(typedChars - correctChars, 0);

    const accuracy = typedChars > 0
      ? (correctChars / typedChars) * 100
      : 0;

    return {
      timeSeconds: elapsed,
      charsTyped: typedChars,
      correctChars,
      errorChars,
      accuracy,
      wordsTyped: lenTypedW,
      grossWpm,
      netWpm,
      errorWords
    };
  }

  function updateStatsUI(stats) {
    if (!stats) return;

    const gross = Number.isFinite(stats.grossWpm) ? stats.grossWpm : 0;
    let   net   = Number.isFinite(stats.netWpm)   ? stats.netWpm   : 0;
    if (net < 0) net = 0;

    const acc = Number.isFinite(stats.accuracy) ? stats.accuracy : 0;

    if (gwpmTopEl) gwpmTopEl.textContent = gross.toFixed(2);
    if (nwpmTopEl) nwpmTopEl.textContent = net.toFixed(2);
    if (accuTopEl) accuTopEl.textContent = `${acc.toFixed(0)} %`;
  }

  function computeLiveStats() {
    const elapsed = state.elapsedSeconds;
    const typed   = typingInputEl.value || "";

    const stats = computeBasicStats(
      state.targetText,
      typed,
      elapsed
    );

    stats.totalKeystrokes = state.totalKeystrokes;
    stats.backspaceCount  = state.backspaceCount;

    return stats;
  }

  // ---------------- Config & language ----------------

  function loadConfig() {
    try {
      const raw = localStorage.getItem("ft-active-test");
      activeConfig = raw ? JSON.parse(raw) : null;
    } catch {
      activeConfig = null;
    }
  }

  function resolveTextField(obj) {
    return String(
      obj?.content ??
        obj?.text ??
        obj?.body ??
        obj?.chapterText ??
        obj?.passage ??
        ""
    ).trim();
  }

  function setFontForLanguage(lang) {
    [typingTextEl, typingInputEl].forEach((el) => {
      el.classList.remove("font-english", "font-hindi", "font-kruti");
      if (lang === "english")       el.classList.add("font-english");
      else if (lang === "hindi-kruti") el.classList.add("font-kruti");
      else                           el.classList.add("font-hindi");
    });
    state.lang = lang;

    if (layoutPillEl) {
      layoutPillEl.textContent =
        lang === "english"
          ? "English"
          : lang === "hindi-kruti"
          ? "Hindi (Kruti)"
          : "Hindi (Mangal)";
    }
  }

  // ---------------- Timer ring (no circle) ----------------

  function setupTimerRing() { /* no-op */ }

  function setRingProgress(pct) {
    if (!state.ring) return;
    const v   = Math.max(0, Math.min(1, pct));
    const off = state.ring.c * (1 - v);
    state.ring.fg.style.strokeDashoffset = String(off);
  }

  // ---------------- Target rendering & highlight (unchanged) ----------------

  function tokenizeTarget(text) {
    const tokens = [];
    const re = /(\s+|[^\s]+)/g;
    let m;
    let wordIndex = 0;

    while ((m = re.exec(text)) !== null) {
      const tok = m[0];
      if (/^\s+$/.test(tok)) {
        tokens.push({ type: "ws", text: tok });
      } else {
        tokens.push({ type: "word", text: tok, wordIndex });
        wordIndex++;
      }
    }
    return tokens;
  }

  function renderTarget(text) {
    state.targetText   = text || "";
    state.targetTokens = tokenizeTarget(state.targetText);
    state.targetWords  = [];
    state.wordEls      = [];

    typingTextEl.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const t of state.targetTokens) {
      if (t.type === "ws") {
        frag.appendChild(document.createTextNode(t.text));
      } else {
        state.targetWords.push(t.text);

        const span = document.createElement("span");
        span.className  = "tt-word";
        span.textContent= t.text;

        state.wordEls[t.wordIndex] = span;
        frag.appendChild(span);
      }
    }

    typingTextEl.appendChild(frag);
  }

  function getTypedWordsInfo() {
    const rawText      = typingInputEl.value || "";
    const endsWithSpace= /\s$/.test(rawText);

    const rawParts = rawText.split(/\s+/);
    const words    = rawParts.filter((w) => w.length > 0);

    const finishedCount = endsWithSpace
      ? words.length
      : Math.max(words.length - 1, 0);

    const currentWord =
      !endsWithSpace && words.length > 0 ? words[words.length - 1] : "";

    return { words, finishedCount, currentWord, endsWithSpace };
  }

  function scrollWordIntoBox(wordIndex) {
    const el = state.wordEls[wordIndex];
    if (!el || !autoScrollCheckbox || !autoScrollCheckbox.checked) return;

    const box     = typingTextEl;
    const boxRect = box.getBoundingClientRect();
    const r       = el.getBoundingClientRect();

    const topDiff    = r.top    - boxRect.top;
    const bottomDiff = r.bottom - boxRect.bottom;

    if (topDiff < 0)          box.scrollTop += topDiff - 16;
    else if (bottomDiff > 0) box.scrollTop += bottomDiff + 16;
  }

  function updateWordHighlights() {
    const { words, finishedCount, currentWord, endsWithSpace } =
      getTypedWordsInfo();
    const total = state.targetWords.length;

    for (let i = 0; i < total; i++) {
      const span = state.wordEls[i];
      if (!span) continue;

      span.classList.remove(
        "tt-word-correct",
        "tt-word-wrong",
        "tt-word-current",
        "tt-word-current-error"
      );

      const target = state.targetWords[i];

      if (i < finishedCount) {
        const typedWord = words[i] || "";
        if (typedWord === target) {
          span.classList.add("tt-word-correct");
        } else {
          span.classList.add("tt-word-wrong");
        }
      } else if (i === finishedCount && !endsWithSpace && currentWord) {
        if (target.startsWith(currentWord)) {
          span.classList.add("tt-word-current");
        } else {
          span.classList.add("tt-word-current-error");
        }
      }
    }

    if (total > 0) {
      let nextIdx;
      if (finishedCount >= total) nextIdx = total - 1;
      else                        nextIdx = finishedCount;

      scrollWordIntoBox(nextIdx);
    }
  }

  // ---------------- Locked overlay ----------------

  function showLockedOverlay(message) {
    state.locked = true;
    typingInputEl.disabled = true;
    const safeHtml = escapeHtml(
      message || "This lesson is locked.\n\nPlease log in to practice this lesson."
    ).replace(/\n/g, "<br>");
    typingTextEl.innerHTML = `
      <div class="px-overlay">
        <h3>Locked lesson</h3>
        <p>${safeHtml}</p>
        <div class="px-actions">
          <button class="px-btn" type="button" onclick="location.href='${LOGIN_URL}'">Log in / Sign up</button>
          <button class="px-btn secondary" type="button" onclick="location.href='typing-test.html'">Back to setup</button>
        </div>
      </div>
    `;
  }

  async function getPracticeText() {
    const cfg = activeConfig || {};
    let lang  = cfg.lang || "english";

    if (cfg.source === "custom") {
      return {
        text:  String(cfg.customText || "").trim(),
        label: "Practice",
        langUsed: lang,
        locked: false
      };
    }

    if (cfg.source === "book" && cfg.bookId && cfg.chapterId && window.db) {
      const bookRef = window.db.collection("books").doc(cfg.bookId);
      const bookSnap= await bookRef.get();
      const book    = bookSnap.data() || {};
      lang          = book.language || lang;

      const chSnap = await bookRef
        .collection("chapters")
        .doc(cfg.chapterId)
        .get();
      if (!chSnap.exists) {
        return {
          text:  "Chapter not found. Go back and reselect.",
          label: "Book",
          langUsed: lang,
          locked: false
        };
      }

      const ch         = chSnap.data() || {};
      const loggedIn   = isLoggedIn();
      const isLessonPaid = ch.isFree === false || !!book.isPaid;

      if (ch.isVisible === false) {
        return {
          text:  "This lesson is hidden by admin.",
          label: book.title || "Book",
          langUsed: lang,
          locked: true
        };
      }

      if (!loggedIn && isLessonPaid) {
        return {
          text:  "This lesson is locked.\n\nPlease log in to practice this lesson.",
          label: book.title || "Book",
          langUsed: lang,
          locked: true
        };
      }

      const text = resolveTextField(ch);
      const chLabel =
        `${(ch.code || "").trim()} ${(ch.name || "").trim()}`.trim() ||
        "Chapter";
      return {
        text,
        label: `${chLabel} • ${book.title || "Book"}`,
        langUsed: lang,
        locked: false
      };
    }

    return {
      text:  "Please go back and start again from typing test setup.",
      label: "Practice",
      langUsed: lang,
      locked: false
    };
  }

  // ---------------- Timer + Pause ----------------

  function startTimerIfNeeded() {
    if (state.running || state.finished || state.paused || state.locked) return;
    state.running = true;

    if (state.timerId) clearInterval(state.timerId);

    state.timerId = setInterval(() => {
      state.elapsedSeconds += 1;

      if (state.timeLimitSeconds > 0) {
        const remaining = Math.max(
          0,
          state.timeLimitSeconds - state.elapsedSeconds
        );
        updateTimeUI(remaining);
        setRingProgress(remaining / state.timeLimitSeconds);

        if (remaining <= 0) endPractice("Time up");
      } else {
        updateTimeUI(state.elapsedSeconds);
        setRingProgress(1);
      }

      if (!state.finished && !state.paused && !state.locked) {
        const st = computeLiveStats();
        updateStatsUI(st);
      }
    }, 1000);
  }

  function setPaused(value) {
    if (state.finished || state.locked) {
      if (pauseToggle) pauseToggle.checked = false;
      return;
    }

    if (value) {
      state.paused  = true;
      state.running = false;
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
      typingInputEl.disabled = true;
    } else {
      state.paused  = false;
      if (!state.locked) typingInputEl.disabled = false;
      // timer restarts on next key
    }
  }

  // ---------------- Save summary & end ----------------

  function saveSummary(reason, stats) {
    const summary = {
      reason,
      stats,                    // includes grossWpm, netWpm, accuracy, errorWords etc.
      lang: state.lang,
      timeLimit: state.timeLimitSeconds,
      elapsed: state.elapsedSeconds,
      typedText: typingInputEl.value || "",
      targetText: state.targetText,
      config: activeConfig || null
    };

    try {
      localStorage.setItem("ft-last-result", JSON.stringify(summary));
    } catch {}
    return summary;
  }

  function endPractice(reason) {
    if (state.finished) return;
    state.finished = true;

    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    state.running = false;

    if (state.locked) return;

    state.paused = false;
    if (pauseToggle) pauseToggle.checked = false;

    typingInputEl.disabled = true;

    const stats = computeLiveStats();
    updateStatsUI(stats);
    saveSummary(reason, stats);

    let msg = "";
    if (reason === "Time up") {
      msg = "Your time is over.\nClick OK to see your result.";
    } else if (reason === "Lesson completed") {
      msg = "You have completed this lesson.\nClick OK to see your result.";
    } else {
      msg = "Your test is finished.\nClick OK to see your result.";
    }

    if (msg) alert(msg);
    window.location.href = AFTER_TEST_REDIRECT;
  }

  function goToResultManual() {
    if (state.locked) return;

    if (state.finished) {
      window.location.href = AFTER_TEST_REDIRECT;
      return;
    }

    const stats = computeLiveStats();
    updateStatsUI(stats);
    saveSummary("Manual finish", stats);

    window.location.href = AFTER_TEST_REDIRECT;
  }

  function setTimeLimit(seconds) {
    state.timeLimitSeconds = Number.isFinite(seconds) ? seconds : 300;
    if (timeLimitSelect)
      timeLimitSelect.value = String(state.timeLimitSeconds);
    updateTimeUI(state.timeLimitSeconds > 0 ? state.timeLimitSeconds : 0);
    setRingProgress(1);
  }

  // ---------------- End condition: full passage attempted ----------------

  function checkLessonCompletion() {
    if (state.finished || !state.targetText) return;

    const refLen   = segmentText(state.targetText).length;
    const typedLen = segmentText(typingInputEl.value || "").length;

    if (refLen > 0 && typedLen >= refLen) {
      endPractice("Lesson completed");
    }
  }

  // ---------------- Input events ----------------

  function handleTypingInput() {
    if (state.locked || state.finished) return;
    if (state.paused) return;

    startTimerIfNeeded();

    updateWordHighlights();

    const st = computeLiveStats();
    updateStatsUI(st);

    const typedChars = Array.from(typingInputEl.value || "");
    const idx = Math.min(
      typedChars.length - 1,
      Array.from(state.targetText).length - 1
    );
    updateKeyboardHighlight(
      state.targetText[idx] || null,
      typedChars[idx]      || null
    );

    checkLessonCompletion();
  }

  function moveCaretToEnd() {
    const len = typingInputEl.value.length;
    try {
      typingInputEl.setSelectionRange(len, len);
    } catch {}
  }

  function handleKeyDown(e) {
    if (state.finished || state.locked) return;

    startTimerIfNeeded();

    const key = e.key;

    if (key === "Backspace") {
      state.totalKeystrokes++;
      state.backspaceCount++;
    } else if (key.length === 1 || key === "Enter" || key === " ") {
      state.totalKeystrokes++;
    }

    if (
      key === "Backspace" &&
      typingInputEl.dataset.backspaceAllowed === "0"
    ) {
      e.preventDefault();
      return;
    }

    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown"
      ].includes(key)
    ) {
      e.preventDefault();
      moveCaretToEnd();
      return;
    }
  }

  // ---------------- Prepare / restart ----------------

  async function preparePractice() {
    loadConfig();
    const cfg = activeConfig || {};

    if (userNameEl) userNameEl.textContent = cfg.userName || "Guest";
    if (modePillEl)
      modePillEl.textContent = cfg.mode === "exam" ? "Exam" : "Practice";

    let chosenSeconds;
    if (Number.isFinite(cfg.seconds)) {
      chosenSeconds        = cfg.seconds;
      state.allowTimeChange= false;
    } else {
      chosenSeconds        = 300;
      state.allowTimeChange= true;
    }
    setTimeLimit(chosenSeconds);

    timeButtons.forEach((btn) => {
      const btnSec = parseInt(btn.dataset.seconds || "0", 10);
      if (btnSec === chosenSeconds) btn.classList.add("active");
      else                          btn.classList.remove("active");
      btn.disabled = !state.allowTimeChange;
    });

    state.elapsedSeconds  = 0;
    state.running         = false;
    state.locked          = false;
    state.finished        = false;
    state.paused          = false;
    state.totalKeystrokes = 0;
    state.backspaceCount  = 0;
    if (pauseToggle) pauseToggle.checked = false;

    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }

    const allowBackspace =
      cfg.mode === "exam" ? false : cfg.backspaceAllowed !== false;
    typingInputEl.dataset.backspaceAllowed = allowBackspace ? "1" : "0";
    if (backspaceAllowedCheckbox) {
      backspaceAllowedCheckbox.checked  = allowBackspace;
      backspaceAllowedCheckbox.disabled = (cfg.mode === "exam");
    }

    const info = await getPracticeText();

    setFontForLanguage(info.langUsed || "english");
    if (sessionLabelEl)
      sessionLabelEl.textContent = info.label || "Practice";

    if (!info.text) info.text = "No text available.";

    if (info.locked) {
      showLockedOverlay(info.text);
      return;
    }

    renderTarget(info.text);
    typingTextEl.scrollTop = 0;

    typingInputEl.value    = "";
    typingInputEl.disabled = false;
    typingInputEl.focus({ preventScroll: true });

    updateWordHighlights();

    updateStatsUI({
      timeSeconds: 0,
      charsTyped: 0,
      correctChars: 0,
      errorChars: 0,
      accuracy: 0,
      wordsTyped: 0,
      grossWpm: 0,
      netWpm: 0
    });

    updateTimeUI(state.timeLimitSeconds > 0 ? state.timeLimitSeconds : 0);
    clearKeyboardHighlight();
  }

  function restartPractice() {
    preparePractice();
  }

  // ---------------- Init ----------------

  async function init() {
    setupTimerRing();

    timeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!state.allowTimeChange) return;

        timeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const sec = parseInt(btn.dataset.seconds || "0", 10);
        if (timeLimitSelect) timeLimitSelect.value = String(sec);
        setTimeLimit(sec);
        preparePractice();
      });
    });

    if (restartBtn) {
      restartBtn.addEventListener("click", restartPractice);
    }

    if (backspaceAllowedCheckbox) {
      backspaceAllowedCheckbox.addEventListener("change", () => {
        typingInputEl.dataset.backspaceAllowed =
          backspaceAllowedCheckbox.checked ? "1" : "0";
      });
    }

    if (pauseToggle) {
      pauseToggle.addEventListener("change", () => {
        setPaused(pauseToggle.checked);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }

    if (finishBtn) {
      finishBtn.addEventListener("click", () => {
        goToResultManual();
      });
    }

    typingInputEl.addEventListener("input", handleTypingInput);
    typingInputEl.addEventListener("keydown", handleKeyDown);

    typingInputEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      typingInputEl.focus();
      moveCaretToEnd();
    });
    typingInputEl.addEventListener("mouseup", () => {
      moveCaretToEnd();
    });
    typingInputEl.addEventListener("click", () => {
      moveCaretToEnd();
    });

    await preparePractice();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
