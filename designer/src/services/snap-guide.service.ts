/**
 * Snap Guide Service
 * Computes alignment guides and snapping for element positioning.
 * Shows visual guides when elements align with page center, edges, or other elements.
 *
 * @author Wichit Wongta
 */
import type { CanvasElement } from '../models/element';

export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number; // x for vertical, y for horizontal
  label?: string;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

const SNAP_THRESHOLD = 5; // Pixels within which to snap

/**
 * Calculate snapped position and active guides for an element being moved.
 */
export function computeSnap(
  movingId: string,
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number,
  allElements: readonly CanvasElement[],
  pageW: number,
  pageH: number,
): SnapResult {
  const guides: SnapGuide[] = [];

  // Track best snap per axis (closest distance wins)
  interface SnapCandidate { value: number; distance: number; guide: SnapGuide }
  const bestSnap: { x: SnapCandidate | null; y: SnapCandidate | null } = { x: null, y: null };

  function trySnapX(distance: number, snappedX: number, guide: SnapGuide) {
    const abs = Math.abs(distance);
    if (abs < SNAP_THRESHOLD && (!bestSnap.x || abs < bestSnap.x.distance)) {
      bestSnap.x = { value: snappedX, distance: abs, guide };
    }
  }

  function trySnapY(distance: number, snappedY: number, guide: SnapGuide) {
    const abs = Math.abs(distance);
    if (abs < SNAP_THRESHOLD && (!bestSnap.y || abs < bestSnap.y.distance)) {
      bestSnap.y = { value: snappedY, distance: abs, guide };
    }
  }

  // Element edges
  const left = targetX;
  const right = targetX + targetW;
  const top = targetY;
  const bottom = targetY + targetH;
  const centerX = targetX + targetW / 2;
  const centerY = targetY + targetH / 2;

  // ─── Page Guides ───

  const pageCX = pageW / 2;
  trySnapX(centerX - pageCX, pageCX - targetW / 2, { type: 'vertical', position: pageCX, label: 'Page Center' });

  const pageCY = pageH / 2;
  trySnapY(centerY - pageCY, pageCY - targetH / 2, { type: 'horizontal', position: pageCY, label: 'Page Center' });

  trySnapX(left, 0, { type: 'vertical', position: 0, label: 'Left Edge' });
  trySnapX(right - pageW, pageW - targetW, { type: 'vertical', position: pageW, label: 'Right Edge' });
  trySnapY(top, 0, { type: 'horizontal', position: 0, label: 'Top Edge' });
  trySnapY(bottom - pageH, pageH - targetH, { type: 'horizontal', position: pageH, label: 'Bottom Edge' });

  // ─── Element-to-Element Guides ───

  for (const el of allElements) {
    if (el.id === movingId) continue;

    const elLeft = el.x;
    const elRight = el.x + el.w;
    const elTop = el.y;
    const elBottom = el.y + el.h;
    const elCX = el.x + el.w / 2;
    const elCY = el.y + el.h / 2;

    // X-axis snaps
    trySnapX(left - elLeft, elLeft, { type: 'vertical', position: elLeft });
    trySnapX(right - elRight, elRight - targetW, { type: 'vertical', position: elRight });
    trySnapX(left - elRight, elRight, { type: 'vertical', position: elRight });
    trySnapX(right - elLeft, elLeft - targetW, { type: 'vertical', position: elLeft });
    trySnapX(centerX - elCX, elCX - targetW / 2, { type: 'vertical', position: elCX });

    // Y-axis snaps
    trySnapY(top - elTop, elTop, { type: 'horizontal', position: elTop });
    trySnapY(bottom - elBottom, elBottom - targetH, { type: 'horizontal', position: elBottom });
    trySnapY(top - elBottom, elBottom, { type: 'horizontal', position: elBottom });
    trySnapY(bottom - elTop, elTop - targetH, { type: 'horizontal', position: elTop });
    trySnapY(centerY - elCY, elCY - targetH / 2, { type: 'horizontal', position: elCY });
  }

  let snappedX = targetX;
  let snappedY = targetY;

  if (bestSnap.x) {
    snappedX = bestSnap.x.value;
    guides.push(bestSnap.x.guide);
  }
  if (bestSnap.y) {
    snappedY = bestSnap.y.value;
    guides.push(bestSnap.y.guide);
  }

  return { x: snappedX, y: snappedY, guides };
}
