/**
 * Barcode SVG rendering and bounded-cache regressions.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type BarcodeService = typeof import('../../src/services/barcode.service');

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function loadRealService(): Promise<BarcodeService> {
  vi.resetModules();
  vi.doUnmock('../../src/services/barcode-renderer');
  return import('../../src/services/barcode.service');
}

async function loadMockedService(toSVG: ReturnType<typeof vi.fn>): Promise<BarcodeService> {
  vi.resetModules();
  vi.doMock('../../src/services/barcode-renderer', () => ({ toSVG }));
  return import('../../src/services/barcode.service');
}

function getSvg(service: BarcodeService, value: string, barcodeType = 'code128'): Promise<string> {
  return new Promise((resolve) => {
    const cached = service.getCachedBarcodeSvg(value, barcodeType, resolve);
    if (cached !== null) resolve(cached);
  });
}

afterEach(() => {
  vi.doUnmock('../../src/services/barcode-renderer');
  vi.restoreAllMocks();
});

describe('renderBarcodeSvg', () => {
  it('renders real Code128 and QR SVGs without falling back', async () => {
    const service = await loadRealService();

    const code128 = await service.renderBarcodeSvg({ value: 'ABC-123', barcodeType: 'code128' });
    const qr = await service.renderBarcodeSvg({ value: 'https://example.test/123', barcodeType: 'qrcode' });

    expect(code128).toMatch(/^<svg\b/);
    expect(qr).toMatch(/^<svg\b/);
    expect(code128).not.toContain('Invalid barcode');
    expect(qr).not.toContain('Invalid barcode');
    expect(code128).toContain('<path');
    expect(qr).toContain('<path');
  });

  it.each([
    ['code39', 'ABC123'],
    ['ean13', '5901234123457'],
    ['ean8', '96385074'],
    ['upca', '012345678905'],
    ['itf14', '10012345000017'],
    ['datamatrix', 'ABC-123'],
    ['pdf417', 'ABC-123'],
  ])('renders the supported %s adapter without fallback', async (barcodeType, value) => {
    const service = await loadRealService();
    const svg = await service.renderBarcodeSvg({ value, barcodeType });

    expect(svg).toMatch(/^<svg\b/);
    expect(svg).not.toContain('Invalid barcode');
    expect(svg).toContain('<path');
  });

  it('omits width for linear formats and supplies it only to matrix formats', async () => {
    const toSVG = vi.fn(() => '<svg></svg>');
    const service = await loadMockedService(toSVG);

    await service.renderBarcodeSvg({ value: 'ABC-123', barcodeType: 'code128' });
    await service.renderBarcodeSvg({ value: 'ABC-123', barcodeType: 'qrcode' });

    expect(toSVG).toHaveBeenCalledTimes(2);
    expect(toSVG.mock.calls[0][0]).not.toHaveProperty('width');
    expect(toSVG.mock.calls[1][0]).toHaveProperty('width', 10);
  });

  it.each(['unknown', 'toString', '__proto__'])(
    'shows an error for %s instead of silently rendering Code128', async (barcodeType) => {
      const toSVG = vi.fn(() => '<svg></svg>');
      const service = await loadMockedService(toSVG);
      const direct = await service.renderBarcodeSvg({ value: 'QA-123', barcodeType });
      const cached = await getSvg(service, 'QA-123', barcodeType);
      expect(direct).toContain('Unsupported barcode type');
      expect(cached).toContain('Unsupported barcode type');
      expect(toSVG).not.toHaveBeenCalled();
    },
  );

  it('rejects oversized values before allocating a cache key or calling bwip', async () => {
    const toSVG = vi.fn(() => '<svg></svg>');
    const service = await loadMockedService(toSVG);
    const oversized = 'x'.repeat(4097);

    const direct = await service.renderBarcodeSvg({ value: oversized, barcodeType: 'code128' });
    const cached = service.getCachedBarcodeSvg(oversized, 'code128', vi.fn());

    expect(direct).toContain('Invalid barcode');
    expect(cached).toContain('Invalid barcode');
    expect(toSVG).not.toHaveBeenCalled();
  });
});

describe('getCachedBarcodeSvg', () => {
  it('deduplicates identical renders that are already in flight', async () => {
    const render = deferred<string>();
    const toSVG = vi.fn(() => render.promise);
    const service = await loadMockedService(toSVG);
    const first = vi.fn();
    const second = vi.fn();

    expect(service.getCachedBarcodeSvg('same', 'code128', first)).toBeNull();
    expect(service.getCachedBarcodeSvg('same', 'code128', second)).toBeNull();
    await vi.waitFor(() => expect(toSVG).toHaveBeenCalledTimes(1));

    render.resolve('<svg id="same"></svg>');
    await vi.waitFor(() => {
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });
    expect(service.getCachedBarcodeSvg('same', 'code128', vi.fn())).toBe('<svg id="same"></svg>');
  });

  it('evicts least-recently-used entries when the entry limit is exceeded', async () => {
    const toSVG = vi.fn((options: { text: string }) => `<svg>${options.text}</svg>`);
    const service = await loadMockedService(toSVG);

    for (let index = 0; index < 128; index++) {
      await getSvg(service, `value-${index}`);
    }
    // Promote value-0 so value-1 becomes the least-recently-used entry.
    expect(service.getCachedBarcodeSvg('value-0', 'code128', vi.fn())).not.toBeNull();
    await getSvg(service, 'value-128');

    expect(service.getCachedBarcodeSvg('value-0', 'code128', vi.fn())).not.toBeNull();
    expect(service.getCachedBarcodeSvg('value-1', 'code128', vi.fn())).toBeNull();
    await vi.waitFor(() => expect(toSVG).toHaveBeenCalledTimes(130));
  });

  it('evicts least-recently-used entries when the byte limit is exceeded', async () => {
    const payload = 'x'.repeat(600_000);
    const toSVG = vi.fn((options: { text: string }) => `<svg id="${options.text}">${payload}</svg>`);
    const service = await loadMockedService(toSVG);

    await getSvg(service, 'large-a');
    await getSvg(service, 'large-b');

    expect(service.getCachedBarcodeSvg('large-b', 'code128', vi.fn())).not.toBeNull();
    expect(service.getCachedBarcodeSvg('large-a', 'code128', vi.fn())).toBeNull();
    await vi.waitFor(() => expect(toSVG).toHaveBeenCalledTimes(3));
  });

  it('generation-fences a pending completion after clearBarcodeCache', async () => {
    const stale = deferred<string>();
    const current = deferred<string>();
    const toSVG = vi.fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const service = await loadMockedService(toSVG);
    const staleReady = vi.fn();
    const currentReady = vi.fn();

    service.getCachedBarcodeSvg('pending', 'code128', staleReady);
    await vi.waitFor(() => expect(toSVG).toHaveBeenCalledTimes(1));
    service.clearBarcodeCache();
    stale.resolve('<svg id="stale"></svg>');
    await Promise.resolve();
    await Promise.resolve();
    expect(staleReady).not.toHaveBeenCalled();

    expect(service.getCachedBarcodeSvg('pending', 'code128', currentReady)).toBeNull();
    await vi.waitFor(() => expect(toSVG).toHaveBeenCalledTimes(2));
    current.resolve('<svg id="current"></svg>');
    await vi.waitFor(() => expect(currentReady).toHaveBeenCalledTimes(1));

    expect(service.getCachedBarcodeSvg('pending', 'code128', vi.fn())).toBe('<svg id="current"></svg>');
  });

  it('bounds subscribers waiting for one pending barcode', async () => {
    const render = deferred<string>();
    const toSVG = vi.fn(() => render.promise);
    const service = await loadMockedService(toSVG);
    const callbacks = Array.from({ length: 100 }, () => vi.fn());

    const results = callbacks.map((callback) =>
      service.getCachedBarcodeSvg('same-pending', 'code128', callback));
    expect(results.filter((result) => result?.includes('Barcode preview busy'))).toHaveLength(84);
    await vi.waitFor(() => expect(toSVG).toHaveBeenCalledTimes(1));
    render.resolve('<svg id="done"></svg>');
    await vi.waitFor(() => expect(callbacks.filter((callback) => callback.mock.calls.length > 0)).toHaveLength(16));
  });

  it('bounds the number of distinct in-flight renders', async () => {
    const toSVG = vi.fn(() => new Promise<string>(() => undefined));
    const service = await loadMockedService(toSVG);
    const results = Array.from({ length: 65 }, (_, index) =>
      service.getCachedBarcodeSvg(`pending-${index}`, 'code128', vi.fn()));

    expect(results.slice(0, 64)).toEqual(Array(64).fill(null));
    expect(results[64]).toContain('Barcode preview busy');
    await vi.waitFor(() => expect(toSVG).toHaveBeenCalledTimes(64));
    service.clearBarcodeCache();
  });
});
