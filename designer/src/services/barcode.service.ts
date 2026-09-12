/**
 * Barcode Rendering Service
 * Wraps bwip-js for SVG generation (HTML sim preview).
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

/** Lazy-loaded, tree-shakeable subset of bwip-js used by the designer. */
let _bwipjs: typeof import('./barcode-renderer') | null = null;
let _bwipPromise: Promise<typeof import('./barcode-renderer')> | null = null;
const MAX_BARCODE_VALUE_CHARS = 4096;

async function loadBwipJs() {
  if (_bwipjs) return _bwipjs;
  if (!_bwipPromise) _bwipPromise = import('./barcode-renderer');
  try {
    _bwipjs = await _bwipPromise;
    return _bwipjs;
  } catch (err) {
    _bwipPromise = null;
    throw err;
  }
}

export interface BarcodeRenderOptions {
  value: string;
  barcodeType: string;
  width?: number;   // desired width in px
  height?: number;  // desired height in px
  includeText?: boolean;
}

function fallbackSvg(opts: BarcodeRenderOptions, message = 'Invalid barcode'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width || 180}" height="${opts.height || 80}"><text x="10" y="30" font-size="12" fill="red">${message}</text></svg>`;
}

/**
 * Render a barcode as an SVG string for the simulated HTML preview only.
 * Authoritative PDF export remains in bfo-export.service.ts / N/render.
 */
export async function renderBarcodeSvg(opts: BarcodeRenderOptions): Promise<string> {
  if (opts.value.length > MAX_BARCODE_VALUE_CHARS) return fallbackSvg(opts);
  if (typeof opts.barcodeType !== 'string' || !Object.hasOwn(BARCODE_TYPE_MAP, opts.barcodeType)) {
    return fallbackSvg(opts, 'Unsupported barcode type');
  }
  const bcid = BARCODE_TYPE_MAP[opts.barcodeType];
  const needsSquareDimensions = bcid === 'qrcode' || bcid === 'datamatrix';

  try {
    const bwipjs = await loadBwipJs();
    const renderOptions: Parameters<typeof bwipjs.toSVG>[0] = {
      bcid,
      text: opts.value || ' ',
      includetext: opts.includeText !== false && !needsSquareDimensions,
      scale: 2,
      height: needsSquareDimensions ? 10 : 8,
      backgroundcolor: 'ffffff',
    };
    // bwip-js validates even present-but-undefined options. Linear encoders
    // reject `width: undefined`, so only matrix formats receive this option.
    if (needsSquareDimensions) renderOptions.width = 10;
    const svg = bwipjs.toSVG(renderOptions);
    return svg;
  } catch (err) {
    console.warn('[barcode] SVG render failed:', err);
    return fallbackSvg(opts);
  }
}

/** SVG cache to avoid re-rendering on every Lit render cycle. */
const MAX_CACHE_ENTRIES = 128;
const MAX_CACHE_BYTES = 1024 * 1024;
const MAX_PENDING_RENDERS = 64;
const MAX_PENDING_CALLBACKS_PER_KEY = 16;

interface CacheEntry {
  svg: string;
  bytes: number;
}

interface PendingRender {
  generation: number;
  callbacks: Array<(svg: string) => void>;
}

const _svgCache = new Map<string, CacheEntry>();
const _pendingRenders = new Map<string, PendingRender>();
let _cacheBytes = 0;
let _cacheGeneration = 0;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function readCached(key: string): string | null {
  const entry = _svgCache.get(key);
  if (!entry) return null;
  // Map iteration order is the LRU queue: a read promotes the entry to newest.
  _svgCache.delete(key);
  _svgCache.set(key, entry);
  return entry.svg;
}

function storeCached(key: string, svg: string): void {
  const existing = _svgCache.get(key);
  if (existing) {
    _cacheBytes -= existing.bytes;
    _svgCache.delete(key);
  }

  const entry = { svg, bytes: utf8Bytes(key) + utf8Bytes(svg) };
  // An individual oversize result is still delivered to its callers, but is
  // not retained because it can never fit within the cache byte budget.
  if (entry.bytes > MAX_CACHE_BYTES) return;

  _svgCache.set(key, entry);
  _cacheBytes += entry.bytes;
  while (_svgCache.size > MAX_CACHE_ENTRIES || _cacheBytes > MAX_CACHE_BYTES) {
    const oldest = _svgCache.entries().next().value as [string, CacheEntry] | undefined;
    if (!oldest) break;
    _svgCache.delete(oldest[0]);
    _cacheBytes -= oldest[1].bytes;
  }
}

/**
 * Get cached SVG for a barcode. Returns cached result synchronously if available,
 * otherwise returns null and triggers async generation.
 */
export function getCachedBarcodeSvg(
  value: string,
  barcodeType: string,
  onReady: (svg: string) => void,
): string | null {
  const fallbackOptions = { value, barcodeType };
  if (value.length > MAX_BARCODE_VALUE_CHARS) return fallbackSvg(fallbackOptions);
  const key = `${barcodeType}:${value}`;
  const cached = readCached(key);
  if (cached !== null) return cached;

  const pending = _pendingRenders.get(key);
  if (pending && pending.generation === _cacheGeneration) {
    if (pending.callbacks.length < MAX_PENDING_CALLBACKS_PER_KEY) {
      pending.callbacks.push(onReady);
      return null;
    }
    return fallbackSvg(fallbackOptions, 'Barcode preview busy');
  }

  if (_pendingRenders.size >= MAX_PENDING_RENDERS) {
    return fallbackSvg(fallbackOptions, 'Barcode preview busy');
  }

  // Coalesce all consumers waiting for the same barcode into one bwip render.
  const request: PendingRender = {
    generation: _cacheGeneration,
    callbacks: [onReady],
  };
  _pendingRenders.set(key, request);
  void renderBarcodeSvg({ value, barcodeType }).then((svg) => {
    // clearBarcodeCache invalidates pending work as well as completed entries.
    // An obsolete completion must neither repopulate the cache nor notify a
    // component belonging to the cleared document generation.
    if (request.generation !== _cacheGeneration) return;
    storeCached(key, svg);
    for (const callback of request.callbacks) {
      try {
        callback(svg);
      } catch (err) {
        console.warn('[barcode] onReady callback failed:', err);
      }
    }
  }).finally(() => {
    if (_pendingRenders.get(key) === request) _pendingRenders.delete(key);
  });

  return null;
}

/** Clear SVG cache (e.g., when element value changes) */
export function clearBarcodeCache(): void {
  ++_cacheGeneration;
  _svgCache.clear();
  _pendingRenders.clear();
  _cacheBytes = 0;
}
