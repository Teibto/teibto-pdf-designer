/**
 * Page Configuration Model
 * @author Wichit Wongta
 */

export type PageSizeName = 'A4' | 'Letter' | 'A3' | 'A5' | 'Custom';
export type Orientation = 'portrait' | 'landscape';

export interface PageConfig {
  size: PageSizeName;
  orientation: Orientation;
  width: number;   // Resolved width in points
  height: number;  // Resolved height in points
  customWidth: number;
  customHeight: number;
}

/** Standard page sizes in points (1 pt = 1/72 inch) */
export const PAGE_SIZES: Record<PageSizeName, { w: number; h: number }> = {
  A4:     { w: 595, h: 842 },
  Letter: { w: 612, h: 792 },
  A3:     { w: 842, h: 1191 },
  A5:     { w: 420, h: 595 },
  Custom: { w: 595, h: 842 },
};

/** Resolve actual page dimensions accounting for orientation */
export function resolvePageDimensions(config: PageConfig): { width: number; height: number } {
  let baseW: number;
  let baseH: number;

  if (config.size === 'Custom') {
    baseW = config.customWidth;
    baseH = config.customHeight;
  } else {
    const base = PAGE_SIZES[config.size];
    baseW = base.w;
    baseH = base.h;
  }

  return config.orientation === 'portrait'
    ? { width: baseW, height: baseH }
    : { width: baseH, height: baseW };
}

/** Default page configuration */
export function createDefaultPage(): PageConfig {
  return {
    size: 'A4',
    orientation: 'portrait',
    width: 595,
    height: 842,
    customWidth: 595,
    customHeight: 842,
  };
}
