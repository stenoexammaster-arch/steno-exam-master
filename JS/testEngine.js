(function () {
  // ---------------- CHAR-LEVEL BASE STATS ----------------
  function basicCharStats(targetText, typedText, elapsedSeconds) {
    function toChars(str) { return Array.from(str || ""); }

    const target = toChars(targetText);
    const typed = toChars(typedText);

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

  // ---------------- WORD TOKENIZATION ----------------
  function tokenizeWords(text) {
    if (!text) return [];
    return text.trim().split(/\s+/).filter(Boolean);
  }

  // -------- HSSC ignore mappings (limited, safe list only) --------
  function normalizeKnownEquivalents(word) {
    const w = String(word || "").trim();

    // Remove surrounding punctuation
    const base = w.replace(/^[("'“”‘’]+|[)"'“”‘’]+$/g, "");

    const lower = base.toLowerCase();

    // common equivalences
    const map = new Map([
      ["%", "percent"],
      ["percent", "percent"],

      ["&", "and"],
      ["and", "and"],

      ["₹", "rupees"],
      ["rs", "rupees"],
      ["rs.", "rupees"],
      ["rupees", "rupees"],

      ["ld.", "learned"],
      ["ld", "learned"],
      ["learned", "learned"],

      ["v/s", "versus"],
      ["vs", "versus"],
      ["vs.", "versus"],
      ["versus", "versus"],

      ["u/s", "undersection"],
      ["u/s.", "undersection"],
      ["under", "under"], // keep normal
    ]);

    if (map.has(lower)) return map.get(lower);

    return lower;
  }

  function looksLikeDateToken(s) {
    s = String(s || "").toLowerCase();
    // rough detection: contains digits and either separators or month names
    const hasDigit = /\d/.test(s);
    const hasSep = /[\/.\-]/.test(s);
    const hasMonth = /(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)/.test(s);
    return hasDigit && (hasSep || hasMonth);
  }

  function normalizeForIgnore(word, lang, examKey) {
    let w = String(word || "");

    // Hindi unicode: treat chandrabindu/anusvara similar (basic)
    if (lang === "hindi") {
      w = w.replace(/\u0901/g, "\u0902"); // chandrabindu -> anusvara (basic normalize)
      // Hindi hyphen ignore (basic): remove hyphen variants
      w = w.replace(/[-–—]/g, "");
    }

    // Remove punctuation symbols for compare
    let cleaned = w.replace(/[.,\-/%]/g, "");

    // HSSC: known equivalents
    if (examKey === "HSSC_C") {
      cleaned = normalizeKnownEquivalents(cleaned);
    } else {
      cleaned = cleaned.toLowerCase();
    }

    return cleaned;
  }

  // English singular/plural half mistake detect
  function isSingularPluralVariant(a, b) {
    a = (a || "").toLowerCase();
    b = (b || "").toLowerCase();
    if (a === b) return false;
    if (a + "s" === b || b + "s" === a) return true;
    if (a + "es" === b || b + "es" === a) return true;
    function yToIes(x) { return x.replace(/y$/, "ies"); }
    if (yToIes(a) === b || yToIes(b) === a) return true;
    return false;
  }

  function buildSentenceStartFlags(words) {
    const flags = new Array(words.length).fill(false);
    if (!words.length) return flags;
    flags[0] = true;
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      if (/[.?!]$/.test(prev)) flags[i] = true;
    }
    return flags;
  }

  // -------- HSSC: detect extra space before full stop "word ." --------
  function countSpaceBeforeFullStopMistakes(origText, typedText) {
    // mistake when typed has " \." but orig has "\."
    // count occurrences of " \." in typed, but only where orig does not have it
    const typedMatches = typedText.match(/\s+\./g) || [];
    if (!typedMatches.length) return 0;

    // if orig already contains space before dot in same way, ignore (rare)
    const origMatches = origText.match(/\s+\./g) || [];
    const typedCount = typedMatches.length;
    const origCount = origMatches.length;

    return Math.max(typedCount - origCount, 0);
  }

  // -------- DP word-level edit distance operations --------
  function computeWordOps(origWords, typedWords) {
    const n = origWords.length;
    const m = typedWords.length;

    const dp = Array(n + 1).fill(0).map(() => Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const same = origWords[i - 1] === typedWords[j - 1];
        const costSub = same ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,        // del
          dp[i][j - 1] + 1,        // ins
          dp[i - 1][j - 1] + costSub // sub/eq
        );
      }
    }

    const ops = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
        ops.push({ type: "del", orig: origWords[i - 1], typed: null, origIndex: i - 1, typedIndex: j });
        i--;
      } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
        ops.push({ type: "ins", orig: null, typed: typedWords[j - 1], origIndex: i, typedIndex: j - 1 });
        j--;
      } else {
        const same = origWords[i - 1] === typedWords[j - 1];
        ops.push({ type: same ? "eq" : "sub", orig: origWords[i - 1], typed: typedWords[j - 1], origIndex: i - 1, typedIndex: j - 1 });
        i--; j--;
      }
    }
    ops.reverse();
    return ops;
  }

  // -------- HSSC: "no space between two words" merge detection --------
  function applyMergeNoSpaceRule(ops, lang, examKey) {
    if (examKey !== "HSSC_C") return ops;

    const out = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];

      // Pattern: sub (typed has merged) + del (next expected word missing)
      // Example expected: ["new","york"] typed:["newyork"]
      if (op.type === "sub" && ops[i + 1] && ops[i + 1].type === "del") {
        const a = String(op.orig || "");
        const b = String(ops[i + 1].orig || "");
        const typed = String(op.typed || "");

        const normTyped = normalizeForIgnore(typed, lang, examKey);
        const normMerged = normalizeForIgnore(a + b, lang, examKey);

        if (normTyped && normTyped === normMerged) {
          // collapse into one substitution-like op (counts 1 full mistake)
          out.push({ type: "sub", orig: `${a} ${b}`, typed: typed, origIndex: op.origIndex, typedIndex: op.typedIndex, meta: "merge_no_space" });
          i++; // skip next del
          continue;
        }
      }

      out.push(op);
    }

    return out;
  }

  // ---------------- WORD-LEVEL MISTAKE ANALYSIS (with HSSC options) ----------------
  function computeWordMistakes(origText, typedText, lang, options) {
    const examKey = options?.examKey || "";

    const origWords = tokenizeWords(origText);
    const typedWords = tokenizeWords(typedText);

    let ops = computeWordOps(origWords, typedWords);

    // Apply HSSC merge rule
    ops = applyMergeNoSpaceRule(ops, lang, examKey);

    let fullMistakes = 0;
    let halfMistakes = 0;
    let ignoredMistakes = 0;

    const sentenceStarts = buildSentenceStartFlags(origWords);

    function markFull() { fullMistakes++; }
    function markHalf() { halfMistakes++; }
    function markIgnored() { ignoredMistakes++; }

    for (let idx = 0; idx < ops.length; idx++) {
      const op = ops[idx];

      if (op.type === "eq") continue;

      if (op.type === "ins") { markFull(); continue; } // addition
      if (op.type === "del") { markFull(); continue; } // omission

      // substitution classification
      const a = op.orig || "";
      const b = op.typed || "";

      // HSSC: ignore dates writing style (very rough)
      if (examKey === "HSSC_C" && (looksLikeDateToken(a) && looksLikeDateToken(b))) {
        markIgnored();
        continue;
      }

      const normA = normalizeForIgnore(a, lang, examKey);
      const normB = normalizeForIgnore(b, lang, examKey);

      // ignore known equivalent forms (%/percent etc.)
      if (normA && normA === normB) {
        markIgnored();
        continue;
      }

      // case error full mistake (English only / but HSSC says capital/small full)
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      if (aLower === bLower && a !== b) {
        markFull();
        continue;
      }

      // half: sentence-start small letter (English only)
      if (lang === "english") {
        const isStart = op.origIndex != null && sentenceStarts[op.origIndex] === true;
        if (isStart) {
          const origFirst = a.charAt(0);
          const typedFirst = b.charAt(0);
          if (/[A-Z]/.test(origFirst) && /[a-z]/.test(typedFirst)) {
            markHalf();
            continue;
          }
        }
      }

      // half: singular/plural (English only)
      if (lang === "english" && isSingularPluralVariant(a, b)) {
        markHalf();
        continue;
      }

      // otherwise full
      markFull();
    }

    // HSSC: space before full stop counts 1 mistake each occurrence
    let spaceBeforeDotMistakes = 0;
    if (examKey === "HSSC_C") {
      spaceBeforeDotMistakes = countSpaceBeforeFullStopMistakes(origText, typedText);
      fullMistakes += spaceBeforeDotMistakes;
    }

    return {
      fullMistakes,
      halfMistakes,
      ignoredMistakes,
      weightedMistakes: fullMistakes + halfMistakes * 0.5,
      operations: ops,
      meta: { spaceBeforeDotMistakes }
    };
  }

  // ---------------- PUBLIC API ----------------
  function computeStatsDetailed(targetText, typedText, elapsedSeconds, lang, options) {
    const base = basicCharStats(targetText, typedText, elapsedSeconds);
    const wordStats = computeWordMistakes(targetText, typedText, lang || "english", options || {});
    return { ...base, ...wordStats };
  }

  function computeStats(targetText, typedText, elapsedSeconds) {
    return basicCharStats(targetText, typedText, elapsedSeconds);
  }

  window.ftEngine = { computeStats, computeStatsDetailed };
})();