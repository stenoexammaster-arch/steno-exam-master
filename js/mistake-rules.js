// js/mistake-rules.js
(function () {
  "use strict";

  /**
   * Global mistake rules object.
   * - normalize: text ko pre-process karne ke liye (III vs 3, dup spaces, etc.)
   * - afterStats: engine ke stats ko modify karne ke liye (kuch mistakes ignore, kuch half, etc.)
   *
   * Abhi dono NO-OP hain => behavior pura same rahega.
   */
  window.mistakeRules = {
    /**
     * @param {Object} payload
     * @param {string} payload.expected - Original passage text
     * @param {string} payload.typed    - User typed text
     * @param {string} payload.language - "english" | "hindi"
     * @param {string} payload.examKey  - e.g. "HSSC_C"
     * @returns {{expected:string, typed:string}}
     */
    normalize(payload) {
      // FUTURE TODO: yahan pe:
      //  - Hindi me kuch equivalent words ko normalize karo
      //  - English me III vs 3, commas ignore, etc.
      // Abhi ke liye: text bilkul same wapas bhej rahe hain.
      return {
        expected: payload.expected,
        typed: payload.typed
      };
    },

    /**
     * @param {Object} stats - computeStatsDetailed ka result
     * @param {Object} ctx   - { expected, typed, language, examKey }
     * @returns {Object} stats
     */
    afterStats(stats, ctx) {
      // FUTURE TODO: yahan pe:
      //  - Kuch operations ko ignore ya re-weight karo
      //  - Full/Half mistakes ko custom logic se adjust karo
      //  - HSSC ke special comma/grammar rules apply karo
      // Abhi ke liye: stats jaisa aaya, waisa hi return.
      return stats;
    }
  };
})();