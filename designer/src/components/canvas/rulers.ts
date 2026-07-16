/**
 * <pld-rulers>
 * Canvas rulers (horizontal + vertical) that show tick marks
 * in points/pixels and respond to zoom level and scroll position.
 *
 * @author Wichit Wongta
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

const RULER_SIZE = 20;      // ruler thickness in px
const MAJOR_TICK = 50;      // major tick every N units
const MINOR_TICK = 10;      // minor tick every N units

@customElement('pld-rulers')
export class PldRulers extends LitElement {
  /** Current zoom factor 0-300 */
  @property({ type: Number }) zoom = 100;

  /** Canvas scroll offset X */
  @property({ type: Number }) scrollX = 0;

  /** Canvas scroll offset Y */
  @property({ type: Number }) scrollY = 0;

  /** Page width in points */
  @property({ type: Number }) pageWidth = 595;

  /** Page height in points */
  @property({ type: Number }) pageHeight = 842;

  /** Whether rulers are visible */
  @property({ type: Boolean }) visible = true;

  @query('.h-canvas') private hCanvas!: HTMLCanvasElement;
  @query('.v-canvas') private vCanvas!: HTMLCanvasElement;

  @state() private _width = 800;
  @state() private _height = 600;

  private _resizeObs: ResizeObserver | null = null;

  static styles = css`
    :host {
      display: contents;
      pointer-events: none;
    }

    .ruler-corner {
      position: absolute;
      top: 0;
      left: 0;
      width: ${RULER_SIZE}px;
      height: ${RULER_SIZE}px;
      background: var(--color-bg-panel);
      border-right: 1px solid var(--color-border);
      border-bottom: 1px solid var(--color-border);
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      color: var(--color-text-muted);
    }

    .ruler-h {
      position: absolute;
      top: 0;
      left: ${RULER_SIZE}px;
      right: 0;
      height: ${RULER_SIZE}px;
      z-index: 15;
      overflow: hidden;
    }

    .ruler-v {
      position: absolute;
      top: ${RULER_SIZE}px;
      left: 0;
      bottom: 0;
      width: ${RULER_SIZE}px;
      z-index: 15;
      overflow: hidden;
    }

    canvas {
      display: block;
    }

    :host([hidden]) {
      display: none !important;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._resizeObs = new ResizeObserver(() => this._measure());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObs?.disconnect();
  }

  firstUpdated() {
    const parent = this.parentElement;
    if (parent) this._resizeObs?.observe(parent);
    this._measure();
  }

  updated() {
    this._draw();
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div class="ruler-corner">pt</div>
      <div class="ruler-h">
        <canvas class="h-canvas" width=${this._width} height=${RULER_SIZE}></canvas>
      </div>
      <div class="ruler-v">
        <canvas class="v-canvas" width=${RULER_SIZE} height=${this._height}></canvas>
      </div>
    `;
  }

  private _measure() {
    const parent = this.parentElement;
    if (!parent) return;
    this._width = parent.clientWidth - RULER_SIZE;
    this._height = parent.clientHeight - RULER_SIZE;
  }

  private _draw() {
    if (!this.visible) return;
    requestAnimationFrame(() => {
      this._drawHorizontal();
      this._drawVertical();
    });
  }

  private _drawHorizontal() {
    const canvas = this.hCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const scale = this.zoom / 100;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = getComputedStyle(this).getPropertyValue('--color-bg-panel').trim() || '#1e1f2e';
    ctx.fillRect(0, 0, w, h);

    // Bottom border
    ctx.strokeStyle = getComputedStyle(this).getPropertyValue('--color-border').trim() || '#2d2e3f';
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    // Tick marks
    const textColor = getComputedStyle(this).getPropertyValue('--color-text-muted').trim() || '#8a8ca0';
    const tickColor = getComputedStyle(this).getPropertyValue('--color-border').trim() || '#2d2e3f';
    ctx.font = '8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Calculate visible range in page units
    const startUnit = Math.floor(-this.scrollX / scale / MINOR_TICK) * MINOR_TICK;
    const endUnit = Math.ceil((w - this.scrollX) / scale / MINOR_TICK) * MINOR_TICK;

    for (let unit = startUnit; unit <= endUnit; unit += MINOR_TICK) {
      const px = unit * scale + this.scrollX;
      if (px < -10 || px > w + 10) continue;

      const isMajor = unit % MAJOR_TICK === 0;

      ctx.strokeStyle = tickColor;
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, isMajor ? 0 : h - 6);
      ctx.lineTo(Math.round(px) + 0.5, h);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = textColor;
        ctx.fillText(String(unit), Math.round(px), 2);
      }
    }

    // Page boundary indicators
    const pageEnd = this.pageWidth * scale + this.scrollX;
    if (pageEnd > 0 && pageEnd < w) {
      ctx.strokeStyle = 'rgba(79, 110, 247, 0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(pageEnd) + 0.5, 0);
      ctx.lineTo(Math.round(pageEnd) + 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private _drawVertical() {
    const canvas = this.vCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const scale = this.zoom / 100;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = getComputedStyle(this).getPropertyValue('--color-bg-panel').trim() || '#1e1f2e';
    ctx.fillRect(0, 0, w, h);

    // Right border
    ctx.strokeStyle = getComputedStyle(this).getPropertyValue('--color-border').trim() || '#2d2e3f';
    ctx.beginPath();
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
    ctx.stroke();

    // Ticks
    const textColor = getComputedStyle(this).getPropertyValue('--color-text-muted').trim() || '#8a8ca0';
    const tickColor = getComputedStyle(this).getPropertyValue('--color-border').trim() || '#2d2e3f';

    const startUnit = Math.floor(-this.scrollY / scale / MINOR_TICK) * MINOR_TICK;
    const endUnit = Math.ceil((h - this.scrollY) / scale / MINOR_TICK) * MINOR_TICK;

    for (let unit = startUnit; unit <= endUnit; unit += MINOR_TICK) {
      const py = unit * scale + this.scrollY;
      if (py < -10 || py > h + 10) continue;

      const isMajor = unit % MAJOR_TICK === 0;

      ctx.strokeStyle = tickColor;
      ctx.beginPath();
      ctx.moveTo(isMajor ? 0 : w - 6, Math.round(py) + 0.5);
      ctx.lineTo(w, Math.round(py) + 0.5);
      ctx.stroke();

      if (isMajor) {
        ctx.save();
        ctx.fillStyle = textColor;
        ctx.font = '8px -apple-system, sans-serif';
        ctx.translate(2, Math.round(py) + 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(String(unit), 0, 0);
        ctx.restore();
      }
    }

    // Page boundary
    const pageEnd = this.pageHeight * scale + this.scrollY;
    if (pageEnd > 0 && pageEnd < h) {
      ctx.strokeStyle = 'rgba(79, 110, 247, 0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(pageEnd) + 0.5);
      ctx.lineTo(w, Math.round(pageEnd) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-rulers': PldRulers;
  }
}
