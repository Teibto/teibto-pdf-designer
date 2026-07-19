/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Thai word-breaking for BFO PDFs (#87) — inserts U+200B (zero-width space)
 * at word boundaries so BFO breaks lines between words instead of anywhere.
 *
 * Why: BFO has no Thai dictionary line-breaker — long Thai strings break
 * mid-word/mid-syllable — but it DOES honor ZWSP as a break opportunity
 * (proven by the baht-text fix, #35). The only correct place to add breaks
 * is server-side where the data is built (both Preview and Print consume it).
 *
 * Method: forward longest-matching against a Thai wordlist
 * (pld_lib_thai_words.js, from the PyThaiNLP corpus, Apache-2.0), the same
 * principle ICU-style Thai breakers use. Runs the dictionary over THAI RUNS
 * only; Latin/digits/codes are never touched. Unknown stretches get a
 * conservative syllable fallback (break before leading vowels เแโใไ only) —
 * not breaking beats breaking wrong.
 *
 * Orthographic guards on every candidate break (also protects against
 * dictionary mis-splits):
 *   - never break BEFORE a combining mark / trailing vowel (ะ ั า ำ ิ-ๅ
 *     ็ ่-๎ ๆ ฯ) — they must stay glued to their base
 *   - never break AFTER a leading vowel (เ แ โ ใ ไ) — it belongs to the
 *     next syllable
 *
 * @author Wichit Wongta
 */
define(['./pld_lib_thai_words'], function (thaiWords) {

  var ZWSP = '​';

  var dict = null;
  var maxLen = 2;

  function ensureDict() {
    if (dict) return;
    var arr = thaiWords.words.split(',');
    dict = new Set(arr);
    maxLen = thaiWords.maxWordLen || 25;
  }

  // Trailing/combining marks that must not start a line (สระหลัง/บน/ล่าง,
  // วรรณยุกต์, การันต์, ไม้ไต่คู้, นิคหิต, ยามักการ, ไม้ยมก, ฯ)
  function noBreakBefore(ch) {
    var c = ch.charCodeAt(0);
    return (c >= 0x0e30 && c <= 0x0e3a) || // ะ ั า ำ ิ ี ึ ื ุ ู ฺ
           (c >= 0x0e45 && c <= 0x0e4e) || // ๅ ๆ ็ ่ ้ ๊ ๋ ์ ํ ๎
           c === 0x0e2f;                    // ฯ
  }

  // Leading vowels that must not end a line (เ แ โ ใ ไ)
  function noBreakAfter(ch) {
    var c = ch.charCodeAt(0);
    return c >= 0x0e40 && c <= 0x0e44;
  }

  function canBreakBetween(prev, next) {
    return !noBreakAfter(prev) && !noBreakBefore(next);
  }

  /** Longest-match segment one pure-Thai run into tokens */
  function segmentRun(run) {
    var tokens = [];
    var unknown = '';
    var i = 0;
    while (i < run.length) {
      var found = '';
      var lim = Math.min(maxLen, run.length - i);
      for (var len = lim; len >= 2; len--) {
        var cand = run.substr(i, len);
        if (dict.has(cand)) { found = cand; break; }
      }
      if (found) {
        if (unknown) { tokens.push({ text: unknown, known: false }); unknown = ''; }
        tokens.push({ text: found, known: true });
        i += found.length;
      } else {
        unknown += run.charAt(i);
        i += 1;
      }
    }
    if (unknown) tokens.push({ text: unknown, known: false });
    return tokens;
  }

  /** Conservative syllable fallback inside an unknown stretch:
   *  allow a break before a leading vowel (a syllable always starts there). */
  function breakUnknown(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var isLeadingVowel = ch.charCodeAt(0) >= 0x0e40 && ch.charCodeAt(0) <= 0x0e44;
      if (i > 0 && isLeadingVowel && canBreakBetween(text.charAt(i - 1), ch)) {
        out += ZWSP;
      }
      out += ch;
    }
    return out;
  }

  /**
   * Insert ZWSP word breaks into the Thai runs of a string.
   * Non-Thai content (codes, numbers, Latin) passes through untouched;
   * strings without Thai return as-is (fast path, no dictionary load).
   *
   * @param {string} text
   * @returns {string}
   */
  function breakThai(text) {
    if (text == null || text === '') return text;
    var s = String(text);
    if (!/[ก-๛]/.test(s)) return s;
    ensureDict();

    return s.replace(/[ก-๛]+/g, function (run) {
      var tokens = segmentRun(run);
      var out = '';
      for (var t = 0; t < tokens.length; t++) {
        var piece = tokens[t].known ? tokens[t].text : breakUnknown(tokens[t].text);
        if (t > 0 && canBreakBetween(tokens[t - 1].text.slice(-1), tokens[t].text.charAt(0))) {
          out += ZWSP;
        }
        out += piece;
      }
      return out;
    });
  }

  return { breakThai: breakThai };
});
