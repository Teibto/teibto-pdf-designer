/**
 * Thai Font Service
 * Lazy-loads Sarabun font files and registers them with jsPDF.
 * Supports both Regular (400) and Bold (700) weights.
 *
 * Font: Sarabun — Google Fonts (OFL license)
 * Coverage: Latin + Latin Extended + Thai unicode ranges
 *
 * @author Wichit Wongta
 */

/** Cached base64 font data to avoid re-fetching */
let _regularBase64: string | null = null;
let _boldBase64: string | null = null;
let _loadPromise: Promise<void> | null = null;

/** Font family name used in jsPDF */
export const THAI_FONT_FAMILY = 'Sarabun';

/**
 * Load Sarabun font files and convert to base64.
 * Called once; subsequent calls return cached data.
 */
export async function loadThaiFonts(): Promise<void> {
  if (_regularBase64 && _boldBase64) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      const [regularBuf, boldBuf] = await Promise.all([
        fetchFontAsArrayBuffer('fonts/Sarabun-Regular.ttf'),
        fetchFontAsArrayBuffer('fonts/Sarabun-Bold.ttf'),
      ]);

      _regularBase64 = arrayBufferToBase64(regularBuf);
      _boldBase64 = arrayBufferToBase64(boldBuf);
    } catch (err) {
      console.warn('[thai-font] Failed to load Sarabun fonts:', err);
      // Non-fatal: PDF will fall back to Helvetica
      _regularBase64 = null;
      _boldBase64 = null;
    }
  })();

  return _loadPromise;
}

/**
 * Register Sarabun fonts with a jsPDF document instance.
 * Must call loadThaiFonts() first.
 *
 * @returns true if fonts were registered successfully
 */
export function registerThaiFonts(doc: any): boolean {
  if (!_regularBase64 || !_boldBase64) return false;

  try {
    // Add font files to jsPDF virtual file system
    doc.addFileToVFS('Sarabun-Regular.ttf', _regularBase64);
    doc.addFileToVFS('Sarabun-Bold.ttf', _boldBase64);

    // Register font with jsPDF
    doc.addFont('Sarabun-Regular.ttf', THAI_FONT_FAMILY, 'normal');
    doc.addFont('Sarabun-Bold.ttf', THAI_FONT_FAMILY, 'bold');

    return true;
  } catch (err) {
    console.warn('[thai-font] Failed to register fonts with jsPDF:', err);
    return false;
  }
}

/**
 * Check if Thai fonts are loaded and ready.
 */
export function isThaiFontLoaded(): boolean {
  return _regularBase64 !== null && _boldBase64 !== null;
}

/**
 * Get cached base64 font data for transfer to Web Worker.
 * Returns null if fonts haven't been loaded yet.
 */
export function getFontData(): { regular: string; bold: string } | null {
  if (!_regularBase64 || !_boldBase64) return null;
  return { regular: _regularBase64, bold: _boldBase64 };
}

// ═══════════════════════════════════════
// INTERNALS
// ═══════════════════════════════════════

/** Fetch a font file as ArrayBuffer from the public directory */
async function fetchFontAsArrayBuffer(path: string): Promise<ArrayBuffer> {
  // Use import.meta.url-relative path for Vite compatibility
  const baseUrl = import.meta.url
    ? new URL(path, import.meta.url).href
    : path;

  // Try Vite public directory first, then relative path
  const urls = [
    `/${path}`,      // Vite dev server (public/)
    `./${path}`,     // Relative fallback
    baseUrl,         // ESM-relative fallback
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return res.arrayBuffer();
      }
    } catch {
      // Try next URL
    }
  }

  throw new Error(`Could not load font: ${path}`);
}

/** Convert ArrayBuffer to base64 string (jsPDF format) */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
