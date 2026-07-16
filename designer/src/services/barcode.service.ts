/**
 * Barcode Rendering Service
 * Wraps bwip-js for SVG (canvas preview) and PNG (PDF export) generation.
 * Supports code128, code39, ean13, qrcode, and many more.
 *
 * @author Wichit Wongta
 */

/** bwip-js barcode type mapping from our model to bwip-js encoder names */
const BARCODE_TYPE_MAP: Record<string, string> = {
  code128: 'code128',
  code39: 'code39',
  ean13: 'ean13',
  qrcode: 'qrcode',
  ean8: 'ean8',
  upca: 'upca',
  itf14: 'itf14',
  datamatrix: 'datamatrix',
  pdf417: 'pdf417',
};

/** Lazy-loaded bwip-js module */
let _bwipjs: any = null;

async function loadBwipJs() {
  if (!_bwipjs) {
    _bwipjs = await import('bwip-js');
  }
  return _bwipjs as typeof import('bwip-js');
}

export interface BarcodeRenderOptions {
  value: string;
  barcodeType: string;
  width?: number;   // desired width in px
  height?: number;  // desired height in px
  includeText?: boolean;
}

/**
 * Render a barcode as SVG string (for canvas preview and BFO export).
 */
export async function renderBarcodeSvg(opts: BarcodeRenderOptions): Promise<string> {
  const bwipjs = await loadBwipJs();
  const bcid = BARCODE_TYPE_MAP[opts.barcodeType] || 'code128';
  const isQR = bcid === 'qrcode' || bcid === 'datamatrix';

  try {
    const svg = bwipjs.toSVG({
      bcid,
      text: opts.value || ' ',
      includetext: opts.includeText !== false && !isQR,
      scale: 2,
      height: isQR ? 10 : 8,
      width: isQR ? 10 : undefined,
      backgroundcolor: 'ffffff',
    });
    return svg;
  } catch (err) {
    console.warn('[barcode] SVG render failed:', err);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width || 180}" height="${opts.height || 80}"><text x="10" y="30" font-size="12" fill="red">Invalid barcode</text></svg>`;
  }
}

/**
 * Render a barcode as PNG data URL (for PDF export via jsPDF.addImage).
 */
export async function renderBarcodeDataUrl(opts: BarcodeRenderOptions): Promise<string | null> {
  const bwipjs = await loadBwipJs();
  const bcid = BARCODE_TYPE_MAP[opts.barcodeType] || 'code128';
  const isQR = bcid === 'qrcode' || bcid === 'datamatrix';

  try {
    // Create offscreen canvas
    const canvas = document.createElement('canvas');
    bwipjs.toCanvas(canvas, {
      bcid,
      text: opts.value || ' ',
      includetext: opts.includeText !== false && !isQR,
      scale: 3,
      height: isQR ? 10 : 8,
      width: isQR ? 10 : undefined,
      backgroundcolor: 'ffffff',
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[barcode] Canvas render failed:', err);
    return null;
  }
}

/** SVG cache to avoid re-rendering on every Lit render cycle */
const _svgCache = new Map<string, string>();

/**
 * Get cached SVG for a barcode. Returns cached result synchronously if available,
 * otherwise returns null and triggers async generation.
 */
export function getCachedBarcodeSvg(
  value: string,
  barcodeType: string,
  onReady: (svg: string) => void,
): string | null {
  const key = `${barcodeType}:${value}`;
  const cached = _svgCache.get(key);
  if (cached) return cached;

  // Trigger async render
  renderBarcodeSvg({ value, barcodeType }).then((svg) => {
    _svgCache.set(key, svg);
    onReady(svg);
  });

  return null;
}

/** Clear SVG cache (e.g., when element value changes) */
export function clearBarcodeCache(): void {
  _svgCache.clear();
}
