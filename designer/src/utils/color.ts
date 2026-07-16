/**
 * Color Utilities
 * @author Wichit Wongta
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Convert hex color string to RGB object */
export function hexToRgb(hex: string): RGB {
  if (!hex) return { r: 0, g: 0, b: 0 };

  hex = hex.replace(/^#/, '');

  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const num = parseInt(hex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** Convert RGB to hex string */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Determine if text should be light or dark on a given background */
export function contrastText(bgHex: string): string {
  const { r, g, b } = hexToRgb(bgHex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}
