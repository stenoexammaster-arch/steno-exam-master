(function () {
  "use strict";

  /* ===============================
     LANGUAGE DETECTION
  =============================== */
  function detectLanguage(text) {
    return /[\u0900-\u097F]/.test(text) ? "hindi" : "english";
  }

  /* ===============================
     ENGLISH HELPERS
  =============================== */
  function normalizeEnglish(word) {
    return word.replace(/[,\-–—:;"'“”‘’]/g, "");
  }

  /* ===============================
     HINDI HELPERS (SAFE)
  =============================== */
  function stripHindiPunctuation(word) {
    return word.replace(/[,\-–—;'"“”‘’]/g, "");
  }

  function removeFinalHalant(word) {
    return word.endsWith("्") ? word.slice(0, -1) : word;
  }

  function isAnusvaraEquivalent(a, b) {
    const nasal = ["न्", "म्", "ङ्", "ञ्", "ण्"];
    if (a.includes("ं")) {
      return nasal.some(n => a.replace("ं", n) === b);
    }
    if (b.includes("ं")) {
      return nasal.some(n => b.replace("ं", n) === a);
    }
    return false;
  }

  function isConjunctEquivalent(a, b) {
    const map = {
      "द्व": "द्‍व",
      "त्र": "त्‍र",
      "ज्ञ": "ज्‍ञ",
      "श्र": "श्‍र"
    };
    return map[a] === b || map[b] === a;
  }

  function hindiEquivalent(a, b) {
    let w1 = removeFinalHalant(stripHindiPunctuation(a));
    let w2 = removeFinalHalant(stripHindiPunctuation(b));

    if (w1 === w2) return true;
    if (isAnusvaraEquivalent(w1, w2)) return true;
    if (isConjunctEquivalent(w1, w2)) return true;

    return false;
  }

  /* ===============================
     CORE COMPARISON
  =============================== */
  function compare(expectedWords, typedWords, language) {
    const results = [];
    const ignored = [];
    let i = 0, j = 0;

    while (i < expectedWords.length || j < typedWords.length) {
      const exp = expectedWords[i] || "";
      const typ = typedWords[j] || "";

      // Omission
      if (exp && !typ) {
        results.push({ type: "full", reason: "Word omitted", expected: exp, typed: "" });
        i++; continue;
      }

      // Addition
      if (!exp && typ) {
        results.push({ type: "full", reason: "Extra word added", expected: "", typed: typ });
        j++; continue;
      }

      // Hindi
      if (language === "hindi") {
        if (hindiEquivalent(exp, typ)) {
          if (exp !== typ) {
            ignored.push({
              index: i,
              expected: exp,
              typed: typ,
              reason: "Hindi permitted equivalence"
            });
            results.push({ type: "ignored", expected: exp, typed: typ });
          } else {
            results.push({ type: "correct", expected: exp, typed: typ });
          }
          i++; j++; continue;
        }
      }

      // English
      if (language === "english") {
        const ne = normalizeEnglish(exp);
        const nt = normalizeEnglish(typ);

        if (ne === nt) {
          if (exp !== typ) {
            results.push({
              type: "full",
              reason: "Capitalization mismatch",
              expected: exp,
              typed: typ
            });
          } else {
            results.push({ type: "correct", expected: exp, typed: typ });
          }
          i++; j++; continue;
        }

        if (ne + "s" === nt || nt + "s" === ne) {
          results.push({
            type: "half",
            reason: "Singular / plural interchange",
            expected: exp,
            typed: typ
          });
          i++; j++; continue;
        }
      }

      // Substitution
      results.push({
        type: "full",
        reason: "Word substitution",
        expected: exp,
        typed: typ
      });
      i++; j++;
    }

    return { results, ignored };
  }

  /* ===============================
     PUBLIC API
  =============================== */
  window.mistakeRules = {
    normalize(payload) {
      return { expected: payload.expected, typed: payload.typed };
    },

    afterStats(stats, ctx) {
      const language = ctx.language || detectLanguage(ctx.expected);
      const expectedWords = ctx.expected.trim().split(/\s+/);
      const typedWords = ctx.typed.trim().split(/\s+/);

      const { results, ignored } = compare(expectedWords, typedWords, language);

      let full = 0, half = 0;
      results.forEach(r => {
        if (r.type === "full") full++;
        if (r.type === "half") half++;
      });

      stats.fullMistakesCount = full;
      stats.halfMistakesCount = half;
      stats.ignoredMistakes = ignored;
      stats.wordResults = results;
      return stats;
    }
  };
})();
