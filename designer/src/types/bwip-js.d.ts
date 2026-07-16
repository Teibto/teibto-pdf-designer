declare module 'bwip-js' {
  interface RenderOptions {
    bcid: string;
    text: string;
    includetext?: boolean;
    scale?: number;
    height?: number;
    width?: number;
    backgroundcolor?: string;
    barcolor?: string;
    textcolor?: string;
    textsize?: number;
    [key: string]: unknown;
  }

  export function toSVG(opts: RenderOptions): string;
  export function toCanvas(canvas: HTMLCanvasElement, opts: RenderOptions): HTMLCanvasElement;
}
