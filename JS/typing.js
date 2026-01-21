// js/typing.js (Advanced UX)
// - Word-level alignment: missing words show (tt-missing), later words can still become correct
// - Only correct blue / wrong red (no active highlight)
// - Timer progress ring
// - Next word preview
// - Locked lesson overlay + Subscribe button
// - Auto-scroll only inside passage box (no page scroll)

(function () {
  "use strict";

  const AFTER_TEST_REDIRECT = "result.html";
  const PRICING_URL = "pricing.html";

  // DOM
  const typingTextEl = document.getElementById("typing-text");
  const typingInputEl = document.getElementById("typing-input");
  const sessionLabelEl = document.getElementById("session-label");

  const timeEl = document.getElementById("time");
  const wpmEl = document.getElementById("wpm");
  const accuracyEl = document.getElementById("accuracy");
  const errorsEl = document.getElementById("errors");
  const wordsCountEl = document.getElementById("words-count");

  const restartBtn = document.getElementById("restart-btn");
  const autoScrollCheckbox = document.getElementById("auto-scroll-enabled");
  const backspaceAllowedCheckbox = document.getElementById("backspace-allowed");

  const timeButtons = Array.from(document.querySelectorAll(".time-buttons .time-btn"));
  const timeLimitSelect = document.getElementById("time-limit-select");

  const userNameEl = document.getElementById("practice-user-name");
  const modePillEl = document.getElementById("px-mode-pill");
  const layoutPillEl = document.getElementById("px-layout-pill");

  if (!typingTextEl || !typingInputEl) return;

  // Keyboard highlight (English only)
  const keyboardKeyEls = {};
  document.querySelectorAll(".practice-keyboard [data-key]").forEach((el) => {
    const key = el.dataset.key;
    if (key) keyboardKeyEls[key] = el;
  });

  // State
  const state = {
    running: false,
    elapsedSeconds: 0,
    timeLimitSeconds: 300,
    timerId: null,

    lang: "english",
    targetText: "",

    // tokenization
    targetTokens: [],   // [{type:'ws'|'word', text, wordIndex?}]
    targetWords: [],    // ['The','fox',...]
    wordEls: [],        // span elements per word index

    locked: false,

    // ui
    ring: null,
    nextWordEl: null,
    progressEl: null,
    alignTimer: null
  };

  let activeConfig = null;

  // ------- utilities -------
  function isPremiumUser() {
    try {
      const u = JSON.parse(localStorage.getItem("sm_user") || "null");
      return !!u?.loggedIn && String(u.plan || "").toLowerCase() === "premium";
    } catch { return false; }
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateTimeUI(seconds) {
    if (timeEl) timeEl.textContent = formatTime(seconds);
  }

  function normalizeKeyChar(ch) {
    if (!ch) return null;
    if (/[a-zA-Z]/.test(ch)) return ch.toLowerCase();
    if (ch === " ") return " ";
    return null;
  }

  function clearKeyboardHighlight() {
    Object.values(keyboardKeyEls).forEach((el) => el.classList.remove("kbd-next", "kbd-correct", "kbd-error"));
  }

  function updateKeyboardHighlight(expectedChar, typedChar) {
    clearKeyboardHighlight();
    if (state.lang !== "english") return;

    const expKey = normalizeKeyChar(expectedChar);
    const typedKey = normalizeKeyChar(typedChar);

    if (expKey && keyboardKeyEls[expKey]) keyboardKeyEls[expKey].classList.add("kbd-next");
    if (typedKey && keyboardKeyEls[typedKey]) {
      keyboardKeyEls[typedKey].classList.add(expKey && typedKey === expKey ? "kbd-correct" : "kbd-error");
    }
  }

  // basic stats (fast)
  function computeBasicStats(targetText, typedText, elapsedSeconds) {
    const target = Array.from(targetText || "");
    const typed = Array.from(typedText || "");

    const charsTyped = typed.length;
    const compareLen = Math.min(target.length, typed.length);

    let correctChars = 0;
    for (let i = 0; i < compareLen; i++) {
      if (typed[i] === target[i]) correctChars++;
    }

    const errorChars = Math.max(charsTyped - correctChars, 0);
    const accuracy = charsTyped > 0 ? (correctChars / charsTyped) * 100 : 100;

    const trimmed = (typedText || "").trim();
    const wordsTyped = trimmed ? trimmed.split(/\s+/).length : 0;

    const safeSeconds = Math.max(elapsedSeconds || 1, 1);
    const minutes = safeSeconds / 60;

    const grossWpm = minutes > 0 ? (charsTyped / 5) / minutes : 0;
    const netWpm = minutes > 0 ? Math.max((charsTyped - errorChars) / 5, 0) / minutes : 0;

    return { timeSeconds: safeSeconds, charsTyped, correctChars, errorChars, accuracy, wordsTyped, grossWpm, netWpm };
  }

  function updateStatsUI(stats) {
    if (!stats) return;
    if (wpmEl) wpmEl.textContent = stats.netWpm.toFixed(1);
    if (accuracyEl) accuracyEl.textContent = `${stats.accuracy.toFixed(1)}%`;
    if (errorsEl) errorsEl.textContent = String(stats.errorChars);

    const totalWords = state.targetWords.length || 0;
    if (wordsCountEl) wordsCountEl.textContent = `${stats.wordsTyped} / ${totalWords}`;
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem("ft-active-test");
      activeConfig = raw ? JSON.parse(raw) : null;
    } catch {
      activeConfig = null;
    }
  }

  function resolveTextField(obj) {
    return String(obj?.content ?? obj?.text ?? obj?.body ?? obj?.chapterText ?? obj?.passage ?? "").trim();
  }

  function setFontForLanguage(lang) {
    [typingTextEl, typingInputEl].forEach((el) => {
      el.classList.remove("font-english", "font-hindi", "font-kruti");
      if (lang === "english") el.classList.add("font-english");
      else if (lang === "hindi-kruti") el.classList.add("font-kruti");
      else el.classList.add("font-hindi");
    });
    state.lang = lang;

    if (layoutPillEl) {
      layoutPillEl.textContent =
        lang === "english" ? "English" :
        lang === "hindi-kruti" ? "Hindi (Kruti)" : "Hindi (Mangal)";
    }
  }

  // ------- Timer ring injection -------
  function setupTimerRing() {
    if (!timeEl) return;

    const box = timeEl.parentElement;
    if (!box) return;

    // already added?
    if (box.querySelector(".px-ring")) return;

    const ringWrap = document.createElement("div");
    ringWrap.className = "px-ring";
    ringWrap.style.display = "grid";
    ringWrap.style.placeItems = "center";
    ringWrap.style.position = "relative";

    // move timeEl into ringWrap
    timeEl.style.position = "relative";
    timeEl.style.zIndex = "2";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "86");
    svg.setAttribute("height", "86");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.margin = "auto";
    svg.style.zIndex = "1";

    const r = 36;
    const cx = 43;
    const cy = 43;
    const c = 2 * Math.PI * r;

    const bg = document.createElementNS(svgNS, "circle");
    bg.setAttribute("cx", cx);
    bg.setAttribute("cy", cy);
    bg.setAttribute("r", r);
    bg.setAttribute("fill", "none");
    bg.setAttribute("stroke", "rgba(255,255,255,.18)");
    bg.setAttribute("stroke-width", "8");

    const fg = document.createElementNS(svgNS, "circle");
    fg.setAttribute("cx", cx);
    fg.setAttribute("cy", cy);
    fg.setAttribute("r", r);
    fg.setAttribute("fill", "none");
    fg.setAttribute("stroke", "rgba(79,140,255,.95)");
    fg.setAttribute("stroke-width", "8");
    fg.setAttribute("stroke-linecap", "round");
    fg.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
    fg.style.strokeDasharray = String(c);
    fg.style.strokeDashoffset = String(c);

    svg.appendChild(bg);
    svg.appendChild(fg);

    ringWrap.appendChild(svg);
    ringWrap.appendChild(timeEl);

    box.appendChild(ringWrap);

    state.ring = { fg, c };
  }

  function setRingProgress(pct) {
    if (!state.ring) return;
    const v = Math.max(0, Math.min(1, pct));
    const off = state.ring.c * (1 - v);
    state.ring.fg.style.strokeDashoffset = String(off);
  }

  // ------- Next word preview injection -------
  function setupNextWordPreview() {
    const top = document.querySelector(".typing-stats-top");
    if (!top) return;

    if (top.querySelector("#px-next-word")) return;

    const el = document.createElement("div");
    el.id = "px-next-word";
    el.className = "px-pill";
    el.textContent = "Next: —";
    top.querySelector(".px-badges")?.appendChild(el);

    state.nextWordEl = el;
  }

  function setNextWord(text) {
    if (!state.nextWordEl) return;
    state.nextWordEl.textContent = "Next: " + (text ? text : "—");
  }

  // ------- Tokenize/render target as word spans (to allow missing-word alignment) -------
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
    state.targetText = text || "";
    state.targetTokens = tokenizeTarget(state.targetText);
    state.targetWords = [];
    state.wordEls = [];

    typingTextEl.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const t of state.targetTokens) {
      if (t.type === "ws") {
        frag.appendChild(document.createTextNode(t.text));
      } else {
        state.targetWords.push(t.text);

        const span = document.createElement("span");
        span.className = "tt-word";
        span.textContent = t.text;

        state.wordEls[t.wordIndex] = span;
        frag.appendChild(span);
      }
    }

    typingTextEl.appendChild(frag);
  }

  // ------- Word diff (DP) -------
  function tokenizeTypedWords(typed) {
    return String(typed || "").trim().split(/\s+/).filter(Boolean);
  }

  function computeWordOps(origWords, typedWords) {
    const n = origWords.length;
    const m = typedWords.length;

    // DP (edit distance)
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const same = origWords[i - 1] === typedWords[j - 1];
        const costSub = same ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + costSub
        );
      }
    }

    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
        ops.push({ type: "del", origIndex: i - 1, typedIndex: j, orig: origWords[i - 1], typed: null });
        i--;
      } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
        ops.push({ type: "ins", origIndex: i, typedIndex: j - 1, orig: null, typed: typedWords[j - 1] });
        j--;
      } else {
        const same = origWords[i - 1] === typedWords[j - 1];
        ops.push({ type: same ? "eq" : "sub", origIndex: i - 1, typedIndex: j - 1, orig: origWords[i - 1], typed: typedWords[j - 1] });
        i--; j--;
      }
    }
    ops.reverse();
    return ops;
  }

  // Apply ops to UI
  function clearWordClasses() {
    for (const el of state.wordEls) {
      if (!el) continue;
      el.classList.remove("tt-ok", "tt-bad", "tt-missing", "tt-caret");
    }
  }

  function scrollWordIntoBox(wordIndex) {
    const el = state.wordEls[wordIndex];
    if (!el || !autoScrollCheckbox?.checked) return;

    const box = typingTextEl;
    const boxRect = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();

    const topDiff = r.top - boxRect.top;
    const bottomDiff = r.bottom - boxRect.bottom;

    if (topDiff < 0) box.scrollTop += topDiff - 16;
    else if (bottomDiff > 0) box.scrollTop += bottomDiff + 16;
  }

  function setCaretWord(wordIndex) {
    state.wordEls.forEach((x) => x && x.classList.remove("tt-caret"));
    const i = Math.max(0, Math.min(wordIndex, state.wordEls.length - 1));
    const el = state.wordEls[i];
    if (el) el.classList.add("tt-caret");
    setNextWord(state.targetWords[i] || "");
    scrollWordIntoBox(i);
  }

  // throttled align update
  function scheduleAlignUpdate() {
    if (state.alignTimer) return;
    state.alignTimer = setTimeout(() => {
      state.alignTimer = null;
      applyWordAlignment();
    }, 120);
  }

  function applyWordAlignment() {
    if (state.locked) return;

    const typed = typingInputEl.value || "";
    const typedWords = tokenizeTypedWords(typed);
    const ops = computeWordOps(state.targetWords, typedWords);

    clearWordClasses();

    // statuses
    for (const op of ops) {
      if (op.type === "eq") state.wordEls[op.origIndex]?.classList.add("tt-ok");
      else if (op.type === "sub") state.wordEls[op.origIndex]?.classList.add("tt-bad");
      else if (op.type === "del") state.wordEls[op.origIndex]?.classList.add("tt-missing");
      // ins has no target word to mark
    }

    // caret: next word after last op that consumed a typed word
    let lastOrig = -1;
    for (const op of ops) {
      if (op.type === "eq" || op.type === "sub") lastOrig = op.origIndex;
    }
    const caret = Math.min(lastOrig + 1, state.targetWords.length);
    if (caret >= state.targetWords.length && typedWords.length > 0) {
      // completed (word aligned)
      endPractice("Completed");
      return;
    }
    setCaretWord(caret);
  }

  // ------- Load text based on config (includes lock overlay) -------
  function showLockedOverlay(message) {
    state.locked = true;
    typingInputEl.disabled = true;
    typingTextEl.innerHTML = `
      <div class="px-overlay">
        <h3>Locked lesson</h3>
        <p>${escapeHtml(message || "This lesson is locked. Please subscribe to unlock more lessons.").replaceAll("\n","<br>")}</p>
        <div class="px-actions">
          <button class="px-btn" type="button" onclick="location.href='${PRICING_URL}'">View plans</button>
          <button class="px-btn secondary" type="button" onclick="location.href='typing-test.html'">Back to setup</button>
        </div>
      </div>
    `;
  }

  async function getPracticeText() {
    const cfg = activeConfig || {};
    let lang = cfg.lang || "english";

    if (cfg.source === "custom") {
      return { text: String(cfg.customText || "").trim(), label: "Practice", langUsed: lang, locked: false };
    }

    if (cfg.source === "book" && cfg.bookId && cfg.chapterId && window.db) {
      const bookRef = window.db.collection("books").doc(cfg.bookId);
      const bookSnap = await bookRef.get();
      const book = bookSnap.data() || {};
      lang = book.language || lang;

      const chSnap = await bookRef.collection("chapters").doc(cfg.chapterId).get();
      if (!chSnap.exists) return { text: "Chapter not found. Go back and reselect.", label: "Book", langUsed: lang, locked: false };

      const ch = chSnap.data() || {};
      const premium = isPremiumUser();

      if (ch.isVisible === false) {
        return { text: "This lesson is hidden by admin.", label: book.title || "Book", langUsed: lang, locked: true };
      }
      if (!premium && ch.isFree === false) {
        return { text: "This lesson is locked.\n\nPlease subscribe to unlock more lessons.", label: book.title || "Book", langUsed: lang, locked: true };
      }

      const text = resolveTextField(ch);
      const chLabel = `${(ch.code || "").trim()} ${(ch.name || "").trim()}`.trim() || "Chapter";
      return { text, label: `${chLabel} • ${book.title || "Book"}`, langUsed: lang, locked: false };
    }

    // fallback
    return { text: "Please go back and start again from typing test setup.", label: "Practice", langUsed: lang, locked: false };
  }

  // ------- Timer + progress ring -------
  function startTimerIfNeeded() {
    if (state.running) return;
    state.running = true;

    if (state.timerId) clearInterval(state.timerId);

    state.timerId = setInterval(() => {
      state.elapsedSeconds += 1;

      if (state.timeLimitSeconds > 0) {
        const remaining = Math.max(0, state.timeLimitSeconds - state.elapsedSeconds);
        updateTimeUI(remaining);

        // ring progress = remaining/total
        setRingProgress(remaining / state.timeLimitSeconds);

        if (remaining <= 0) endPractice("Time up");
      } else {
        updateTimeUI(state.elapsedSeconds);
        setRingProgress(1);
      }
    }, 1000);
  }

  function endPractice(reason) {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    state.running = false;

    if (state.locked) return;

    typingInputEl.disabled = true;

    // final detailed stats (optional)
    let stats = null;
    try {
      stats = window.ftEngine?.computeStatsDetailed
        ? window.ftEngine.computeStatsDetailed(state.targetText, typingInputEl.value || "", Math.max(1, state.elapsedSeconds), state.lang)
        : computeBasicStats(state.targetText, typingInputEl.value || "", Math.max(1, state.elapsedSeconds));
    } catch {
      stats = computeBasicStats(state.targetText, typingInputEl.value || "", Math.max(1, state.elapsedSeconds));
    }

    updateStatsUI(stats);

    const summary = {
      reason,
      stats,
      lang: state.lang,
      timeLimit: state.timeLimitSeconds,
      elapsed: state.elapsedSeconds,
      typedText: typingInputEl.value || "",
      targetText: state.targetText,
      config: activeConfig || null
    };

    try { localStorage.setItem("ft-last-result", JSON.stringify(summary)); } catch {}

    setTimeout(() => (window.location.href = AFTER_TEST_REDIRECT), 250);
  }

  function setTimeLimit(seconds) {
    state.timeLimitSeconds = Number.isFinite(seconds) ? seconds : 300;
    if (timeLimitSelect) timeLimitSelect.value = String(state.timeLimitSeconds);
    updateTimeUI(state.timeLimitSeconds > 0 ? state.timeLimitSeconds : 0);
    setRingProgress(1);
  }

  // ------- Input events -------
  function handleTypingInput() {
    if (state.locked) return;
    if (!state.running) startTimerIfNeeded();

    scheduleAlignUpdate();

    // stats live (basic)
    const st = computeBasicStats(state.targetText, typingInputEl.value || "", Math.max(1, state.elapsedSeconds));
    updateStatsUI(st);

    // keyboard hint: expected char at approx position of typed words (fallback)
    const typedChars = Array.from(typingInputEl.value || "");
    const idx = Math.min(typedChars.length - 1, Array.from(state.targetText).length - 1);
    updateKeyboardHighlight(state.targetText[idx] || null, typedChars[idx] || null);
  }

  function handleKeyDown(e) {
    if (e.key === "Backspace" && typingInputEl.dataset.backspaceAllowed === "0") e.preventDefault();
  }

  async function preparePractice() {
    loadConfig();
    const cfg = activeConfig || {};

    if (userNameEl) userNameEl.textContent = cfg.userName || "Guest";
    if (modePillEl) modePillEl.textContent = (cfg.mode === "exam") ? "Exam" : "Practice";

    setTimeLimit(Number.isFinite(cfg.seconds) ? cfg.seconds : 300);

    state.elapsedSeconds = 0;
    state.running = false;
    state.locked = false;

    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }

    // backspace
    const allowBackspace = (cfg.mode === "exam") ? false : (cfg.backspaceAllowed !== false);
    typingInputEl.dataset.backspaceAllowed = allowBackspace ? "1" : "0";
    if (backspaceAllowedCheckbox) backspaceAllowedCheckbox.checked = allowBackspace;

    const info = await getPracticeText();

    setFontForLanguage(info.langUsed || "english");
    if (sessionLabelEl) sessionLabelEl.textContent = info.label || "Practice";

    if (!info.text) info.text = "No text available.";

    if (info.locked) {
      showLockedOverlay(info.text);
      return;
    }

    // render
    renderTarget(info.text);
    typingTextEl.scrollTop = 0;

    typingInputEl.value = "";
    typingInputEl.disabled = false;
    typingInputEl.focus({ preventScroll: true });

    setNextWord(state.targetWords[0] || "");
    setCaretWord(0);

    // initial stats
    updateStatsUI(computeBasicStats(state.targetText, "", 1));

    clearKeyboardHighlight();
  }

  function restartPractice() {
    preparePractice();
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem("ft-active-test");
      activeConfig = raw ? JSON.parse(raw) : null;
    } catch { activeConfig = null; }
  }

  // init
  async function init() {
    setupTimerRing();
    setupNextWordPreview();

    timeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        timeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const sec = parseInt(btn.dataset.seconds, 10);
        if (timeLimitSelect) timeLimitSelect.value = String(sec);
        setTimeLimit(sec);
        preparePractice();
      });
    });

    restartBtn?.addEventListener("click", restartPractice);
    backspaceAllowedCheckbox?.addEventListener("change", preparePractice);

    typingInputEl.addEventListener("input", handleTypingInput);
    typingInputEl.addEventListener("keydown", handleKeyDown);

    await preparePractice();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();