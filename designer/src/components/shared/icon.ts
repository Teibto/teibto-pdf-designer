/**
 * Decorative, dependency-free Redwood icons on a 24px grid.
 * Accessible names belong on the containing control, never on these SVGs.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { svg } from 'lit';

const paths = {
  'overview': svg`<path d="M4 4h7v7H4z"/><path d="M13 4h7v4h-7z"/><path d="M13 10h7v10h-7z"/><path d="M4 13h7v7H4z"/>`,
  'items': svg`<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>`,
  'settings': svg`<path d="M4 6h9"/><path d="M17 6h3"/><path d="M4 12h3"/><path d="M11 12h9"/><path d="M4 18h9"/><path d="M17 18h3"/><path d="M15 4v4"/><path d="M9 10v4"/><path d="M15 16v4"/>`,
  'menu': svg`<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>`,
  'grid': svg`<path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/>`,
  'board': svg`<path d="M4 5h4.5v14H4z"/><path d="M9.75 5h4.5v9h-4.5z"/><path d="M15.5 5H20v12h-4.5z"/>`,
  'table': svg`<path d="M4 5h16v14H4z"/><path d="M4 9.5h16"/><path d="M9.5 9.5V19"/><path d="M15 9.5V19"/>`,
  'calendar': svg`<path d="M4 6.5h16V20H4z"/><path d="M4 10.5h16"/><path d="M8 4v4"/><path d="M16 4v4"/>`,
  'chart': svg`<path d="M4.5 19.5V9"/><path d="M9.5 19.5V4.5"/><path d="M14.5 19.5v-7"/><path d="M19.5 19.5v-11"/>`,
  'trend': svg`<path d="M4 16.5 9 11l3.5 3.5L20 7"/><path d="M15 7h5v5"/>`,
  'donut': svg`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>`,
  'plus': svg`<path d="M12 5v14"/><path d="M5 12h14"/>`,
  'edit': svg`<path d="M5 19h3l9.5-9.5a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M14 6.5l3.5 3.5"/>`,
  'trash': svg`<path d="M5 7h14"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 12h9l1-12"/>`,
  'copy': svg`<path d="M9 9h10v10H9z"/><path d="M15 9V5H5v10h4"/>`,
  'download': svg`<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19h15"/>`,
  'upload': svg`<path d="M12 20V9"/><path d="M7.5 13.5 12 9l4.5 4.5"/><path d="M4.5 5h15"/>`,
  'refresh': svg`<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4h-4"/>`,
  'search': svg`<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>`,
  'filter': svg`<path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6z"/>`,
  'sort': svg`<path d="M7 5v14"/><path d="M4 8l3-3 3 3"/><path d="M17 19V5"/><path d="M14 16l3 3 3-3"/>`,
  'print': svg`<path d="M7 9V4h10v5"/><path d="M4.5 9h15v7h-3"/><path d="M7 14h10v6H7z"/>`,
  'external': svg`<path d="M13 5h6v6"/><path d="M19 5l-8 8"/><path d="M18 14v5H5V6h5"/>`,
  'close': svg`<path d="M6 6l12 12"/><path d="M18 6L6 18"/>`,
  'more': svg`<circle cx="12" cy="5.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18.5" r="1.2"/>`,
  'drag': svg`<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>`,
  'left': svg`<path d="M14.5 5 7.5 12l7 7"/>`,
  'right': svg`<path d="M9.5 5l7 7-7 7"/>`,
  'up': svg`<path d="M5 14.5 12 7.5l7 7"/>`,
  'down': svg`<path d="M5 9.5 12 16.5l7-7"/>`,
  'check': svg`<path d="M5 12.5 10 17.5 19 6.5"/>`,
  'alert': svg`<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>`,
  'info': svg`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6"/><path d="M12 7.6h.01"/>`,
  'error': svg`<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>`,
  'success': svg`<circle cx="12" cy="12" r="8.5"/><path d="M8 12.4l2.8 2.8L16.2 9.8"/>`,
  'clock': svg`<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.4 2"/>`,
  'lock': svg`<path d="M6.5 10.5h11V20h-11z"/><path d="M8.75 10.5V7.75a3.25 3.25 0 0 1 6.5 0v2.75"/>`,
  'user': svg`<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5a7 7 0 0 1 14 0"/>`,
  'file': svg`<path d="M13 4H7v16h10V8z"/><path d="M13 4v4h4"/>`,
  'mail': svg`<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>`,
  'language': svg`<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5s-1.1 6.1-3.3 8.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z"/>`,
  'sun': svg`<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>`,
  'moon': svg`<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>`,
  'more-horizontal': svg`<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`,
  'play': svg`<path d="m8 5 11 7-11 7z"/>`,
  'layers': svg`<path d="m3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4"/>`,
  'database': svg`<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>`,
  'shapes': svg`<circle cx="16" cy="16" r="5"/><path d="M3 3h10v10H3z"/>`,
  'text': svg`<path d="M4 5h16M12 5v15M8 20h8"/>`,
  'heading': svg`<path d="M5 4v16M19 4v16M5 12h14"/>`,
  'image': svg`<path d="M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5"/><circle cx="16" cy="8" r="1.5"/>`,
  'square': svg`<rect x="4" y="4" width="16" height="16" rx="1"/>`,
  'minus': svg`<path d="M4 12h16"/>`,
  'barcode': svg`<path d="M3 4v16M6 4v16M10 4v16M12 4v16M17 4v16M21 4v16"/>`,
  'arrow-left-right': svg`<path d="M3 8h18M7 4 3 8l4 4M21 16H3m14-4 4 4-4 4"/>`,
  'eye': svg`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  'eye-off': svg`<path d="m3 3 18 18M9 5c6-2 11 4 13 7l-3 4M6 6l-4 6s4 7 10 7l4-1"/>`,
  'unlock': svg`<path d="M6 11h12v10H6zM9 11V7a4 4 0 0 1 8-1"/>`,
  'save': svg`<path d="M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8"/>`,
  'undo': svg`<path d="M4 5v6h6M4 11c3-8 15-6 15 2v5"/>`,
  'redo': svg`<path d="M20 5v6h-6M20 11C17 3 5 5 5 13v5"/>`,
  'list': svg`<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>`,
  'arrow-up-down': svg`<path d="M7 5v14"/><path d="M4 8l3-3 3 3"/><path d="M17 19V5"/><path d="M14 16l3 3 3-3"/>`,
} as const;

export type IconName = keyof typeof paths;

export function icon(name: IconName, size: 'md' | 'lg' = 'md') {
  const dimension = size === 'lg' ? 'var(--icon-lg, 20px)' : 'var(--icon, 18px)';
  return svg`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"
    width=${size === 'lg' ? 20 : 18} height=${size === 'lg' ? 20 : 18}
    style="width:${dimension};height:${dimension};flex-shrink:0;vertical-align:middle"
    fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
  >${paths[name]}</svg>`;
}
