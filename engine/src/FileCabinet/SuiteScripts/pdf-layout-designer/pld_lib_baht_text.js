/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Thai baht-text — spell a number as Thai currency words (จำนวนเงินเป็นตัวอักษร),
 * for the Thai tax invoice summary (#73). e.g. 118609.82 →
 * "หนึ่งแสนหนึ่งหมื่นแปดพันหกร้อยเก้าบาทแปดสิบสองสตางค์".
 *
 * @author Wichit Wongta
 */
define([], function () {

  var DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  // Spell an integer of at most 6 digits (0..999,999) with Thai place-value rules.
  function spellUpToMillion(n) {
    n = Math.floor(n);
    if (n === 0) return '';
    var s = '';
    var str = String(n);
    var len = str.length;
    for (var i = 0; i < len; i++) {
      var d = Number(str.charAt(i));
      var pos = len - i - 1; // 0 = units
      if (d === 0) continue;
      if (pos === 1 && d === 1) {
        s += 'สิบ';                 // 10..19 → "สิบ" not "หนึ่งสิบ"
      } else if (pos === 1 && d === 2) {
        s += 'ยี่สิบ';               // 20.. → "ยี่สิบ"
      } else if (pos === 0 && d === 1 && len > 1) {
        s += 'เอ็ด';                // trailing 1 after tens → "เอ็ด"
      } else {
        s += DIGITS[d] + POS[pos];
      }
    }
    return s;
  }

  // Spell a non-negative integer of any size (million grouping recurses with "ล้าน").
  function spellInt(n) {
    n = Math.floor(n);
    if (n === 0) return DIGITS[0];
    var out = '';
    var millions = Math.floor(n / 1000000);
    var rest = n % 1000000;
    if (millions > 0) {
      out += spellInt(millions) + 'ล้าน';
    }
    out += spellUpToMillion(rest);
    return out;
  }

  /**
   * @param {number|string} amount
   * @returns {string} Thai baht text, e.g. "...บาทถ้วน" or "...บาท...สตางค์"
   */
  function bahtText(amount) {
    var v = Number(amount);
    if (isNaN(v)) return '';
    var negative = v < 0;
    v = Math.abs(v);

    // round to 2 decimals, split baht / satang
    var baht = Math.floor(v);
    var satang = Math.round((v - baht) * 100);
    if (satang === 100) { baht += 1; satang = 0; }

    var words = '';
    if (baht === 0 && satang === 0) {
      words = 'ศูนย์บาทถ้วน';
    } else {
      if (baht > 0) words += spellInt(baht) + 'บาท';
      if (satang > 0) {
        words += spellUpToMillion(satang) + 'สตางค์';
      } else {
        words += 'ถ้วน';
      }
    }
    return (negative ? 'ลบ' : '') + words;
  }

  // Currency-aware words for the reference invoice; do not label foreign totals as baht.
  function amountInWords(value, currency) {
    var code = String(currency || '').toUpperCase();
    if (!code) return '';
    if (code === 'THB') return bahtText(value);
    var v = Number(value);
    if (!isFinite(v) || Math.abs(v) > 999999999999.99) throw new Error('Amount exceeds supported currency-word range');
    var small = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
    var tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
    function spell(n) {
      if (n < 20) return small[n];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + small[n % 10] : '');
      if (n < 1000) return small[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + spell(n % 100) : '');
      var scales = [[1000000000, 'BILLION'], [1000000, 'MILLION'], [1000, 'THOUSAND']];
      for (var i = 0; i < scales.length; i++) {
        var scale = scales[i][0];
        if (n >= scale) return spell(Math.floor(n / scale)) + ' ' + scales[i][1] + (n % scale ? ' ' + spell(n % scale) : '');
      }
    }
    var cents = Math.round(Math.abs(v) * 100);
    var major = Math.floor(cents / 100), minor = cents % 100;
    var names = { USD: ['DOLLAR', 'CENT'], EUR: ['EURO', 'CENT'], GBP: ['POUND', 'PENNY'] };
    var units = names[code] || [code, 'CENT'];
    return (v < 0 ? 'MINUS ' : '') + spell(major) + ' ' + units[0] +
      (minor ? ' AND ' + spell(minor) + ' ' + units[1] : ' ONLY');
  }

  return { bahtText: bahtText, amountInWords: amountInWords };
});
