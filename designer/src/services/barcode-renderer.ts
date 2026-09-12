/**
 * Tree-shakeable bwip-js adapter for the barcode types exposed by the designer.
 * Kept separate so barcode.service can lazy-load one small preview-only chunk.
 *
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import {
  code128,
  code39,
  datamatrix,
  drawingSVG,
  ean13,
  ean8,
  itf14,
  pdf417,
  qrcode,
  upca,
} from 'bwip-js/generic';

type RenderOptions = Parameters<typeof code128>[0];
type Encoder = (options: RenderOptions, drawing: ReturnType<typeof drawingSVG>) => string;

const ENCODERS: Record<string, Encoder> = {
  code128,
  code39,
  ean13,
  qrcode,
  ean8,
  upca,
  itf14,
  datamatrix,
  pdf417,
};

export function toSVG(options: RenderOptions): string {
  const encoder = ENCODERS[options.bcid];
  if (!encoder) throw new Error(`Unsupported barcode type: ${options.bcid}`);
  return encoder(options, drawingSVG());
}
