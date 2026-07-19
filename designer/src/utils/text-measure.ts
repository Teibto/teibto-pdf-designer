/**
 * Text Measurement Utilities
 * Estimates text width and line count for pagination calculations.
 *
 * Uses per-character width estimation based on Unicode range,
 * with special handling for Thai combining marks (zero-width vowels,
 * tone marks, and other above/below diacritics).
 *
 * Thai rendering model:
 *   ภาษาไทยมี "combining characters" ที่ไม่กินความกว้าง เช่น
 *   สระบน (ิ ี ึ ื), สระล่าง (ุ ู), วรรณยุกต์ (่ ้ ๊ ๋),
 *   การันต์ (์), นิคหิต (ํ), ไม้ไต่คู้ (็), สระอั (ั)
 *   ตัวเหล่านี้ซ้อนอยู่บนหรือใต้พยัญชนะ ไม่ควรนับเป็นความกว้าง
 *
 * @author Wichit Wongta
 */
import type { TableColumn } from '../models/element';

/** Cell padding in points (left + right, matching jsPDF-AutoTable defaults) */
const CELL_PADDING_PT = 8;

// ═══════════════════════════════════════
// THAI COMBINING CHARACTER DETECTION
// ═══════════════════════════════════════

/**
 * Thai zero-width combining characters (U+0E00–U+0E7F).
 * These render above or below the base consonant and contribute
 * zero horizontal advance width.
 */
const THAI_COMBINING = new Set([
  // สระบน (above vowels)
  0x0e31, // ั   MAI HAN AKAT (สระอั)
  0x0e34, // ิ   SARA I
  0x0e35, // ี   SARA II
  0x0e36, // ึ   SARA UE
  0x0e37, // ื   SARA UEE

  // สระล่าง (below vowels)
  0x0e38, // ุ   SARA U
  0x0e39, // ู   SARA UU

  // วรรณยุกต์ (tone marks)
  0x0e48, // ่   MAI EK
  0x0e49, // ้   MAI THO
  0x0e4a, // ๊   MAI TRI
  0x0e4b, // ๋   MAI CHATTAWA

  // เครื่องหมายอื่นๆ (other diacritics)
  0x0e47, // ็   MAITAIKHU (ไม้ไต่คู้)
  0x0e4c, // ์   THANTHAKHAT (การันต์)
  0x0e4d, // ํ   NIKHAHIT (นิคหิต)
  0x0e4e, // ๎   YAMAKKAN
]);

/**
 * Check if a Thai code point is a combining (zero-width) character.
 */
function isThaiCombining(code: number): boolean {
  return THAI_COMBINING.has(code);
}

// ═══════════════════════════════════════
// LATIN CHARACTER WIDTH CLASSES
// ═══════════════════════════════════════

/**
 * Width factor lookup for Latin characters (proportional font).
 * Groups based on typical glyph widths in Sarabun/Helvetica:
 *   Narrow:  i l 1 | ! . , ; : ' " () []   → ~0.30
 *   Medium:  most lowercase + digits          → ~0.50
 *   Wide:    M W m w @                        → ~0.75
 *   Space:   standard word separator          → ~0.30
 */
const LATIN_NARROW = new Set([
  0x21, // !
  0x27, // '
  0x28, // (
  0x29, // )
  0x2c, // ,
  0x2e, // .
  0x3a, // :
  0x3b, // ;
  0x49, // I
  0x5b, // [
  0x5d, // ]
  0x69, // i
  0x6a, // j
  0x6c, // l
  0x7c, // |
]);

const LATIN_WIDE = new Set([
  0x40, // @
  0x4d, // M
  0x57, // W
  0x6d, // m
  0x77, // w
]);

// ═══════════════════════════════════════
// CHARACTER WIDTH ESTIMATION
// ═══════════════════════════════════════

/**
 * Estimate the horizontal advance width factor for a single character.
 * Returns a multiplier relative to fontSize (in em-like units).
 *
 * Zero-width Thai combining marks return 0.
 */
function charWidthFactor(code: number): number {
  // Zero-width space (U+200B) — the engine inserts these as Thai word-break
  // opportunities (#87); they occupy no width
  if (code === 0x200b) return 0;

  // Thai range (U+0E00–U+0E7F)
  if (code >= 0x0e00 && code <= 0x0e7f) {
    // Zero-width combining marks: สระบน/ล่าง, วรรณยุกต์, การันต์ ฯลฯ
    if (isThaiCombining(code)) return 0;
    // Thai leading vowels (เ แ โ ใ ไ) are slightly narrower
    if (code >= 0x0e40 && code <= 0x0e44) return 0.55;
    // Thai digits (๐–๙)
    if (code >= 0x0e50 && code <= 0x0e59) return 0.55;
    // Thai consonants and normal-width vowels (า ำ)
    return 0.60;
  }

  // Space
  if (code === 0x20) return 0.30;

  // Basic Latin (U+0020–U+007F)
  if (code >= 0x0021 && code <= 0x007e) {
    if (LATIN_NARROW.has(code)) return 0.30;
    if (LATIN_WIDE.has(code)) return 0.72;
    // Uppercase letters (A-Z except I, M, W)
    if (code >= 0x41 && code <= 0x5a) return 0.58;
    // Digits 0-9
    if (code >= 0x30 && code <= 0x39) return 0.55;
    // Lowercase and remaining punctuation
    return 0.50;
  }

  // CJK Unified Ideographs and common CJK ranges
  if (code >= 0x3000 && code <= 0x9fff) return 1.0;
  // CJK Extension
  if (code >= 0xf900 && code <= 0xfaff) return 1.0;

  // Other scripts (Arabic, Devanagari, etc.) — reasonable default
  return 0.55;
}

// ═══════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════

/**
 * Estimate the rendered width of a text string in points.
 *
 * Correctly handles Thai combining characters (zero-width) so that
 * text like "สินค้า" (6 code points but only 4 visible glyphs)
 * is measured accurately.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += charWidthFactor(text.charCodeAt(i)) * fontSize;
  }
  return width;
}

/**
 * Count the number of "visible glyphs" in a string.
 * Excludes Thai combining marks that don't contribute to horizontal width.
 * Useful for debugging and testing.
 */
export function countVisibleGlyphs(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x0e00 && code <= 0x0e7f && isThaiCombining(code)) continue;
    count++;
  }
  return count;
}

/**
 * Estimate how many lines a text string will wrap to within a given
 * column width (in points) at a given font size.
 */
export function estimateLineCount(
  text: string,
  columnWidthPt: number,
  fontSize: number,
): number {
  if (!text) return 1;

  const effectiveWidth = columnWidthPt - CELL_PADDING_PT;
  if (effectiveWidth <= 0) return 1;

  // Split by explicit newlines first
  const segments = String(text).split('\n');
  let totalLines = 0;

  for (const segment of segments) {
    if (segment.length === 0) {
      totalLines += 1;
      continue;
    }
    const segWidth = estimateTextWidth(segment, fontSize);
    const wrappedLines = Math.max(1, Math.ceil(segWidth / effectiveWidth));
    totalLines += wrappedLines;
  }

  return totalLines;
}

/**
 * Calculate the effective row height in points for a single data row,
 * considering all columns with wrap enabled.
 * Returns the maximum wrapped height across all columns in the row.
 */
export function calculateRowHeight(
  row: Record<string, unknown>,
  columns: TableColumn[],
  baseFontSize: number,
  baseRowHeight: number,
  lineHeightPt: number,
): number {
  let maxLines = 1;

  for (const col of columns) {
    if (col.hidden) continue;
    if (col.overflow !== 'wrap') continue;

    const cellValue = String(row[col.key] ?? '');
    let lineCount = estimateLineCount(cellValue, col.width, baseFontSize);

    // Clamp by maxLines if set
    if (col.maxLines > 0) {
      lineCount = Math.min(lineCount, col.maxLines);
    }

    maxLines = Math.max(maxLines, lineCount);
  }

  if (maxLines <= 1) return baseRowHeight;
  // 6pt accounts for top + bottom cell padding
  return Math.max(baseRowHeight, maxLines * lineHeightPt + 6);
}
