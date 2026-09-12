/**
 * PDF Layout Designer v2.0
 * Main entry point — imports styles and registers the root component.
 *
 * @author Wichit Wongta
 */

// ─── Global Styles ───
import './styles/tailwind.css';
import './styles/fonts.css';

// ─── Theme (#121) — apply saved Dark/Light before first render (กัน flash) ───
import { initTheme } from './services/theme.service';
initTheme();

// ─── Root Component (registers <pld-app-shell> and all children) ───
import './components/app-shell';

// ─── Keyboard Shortcuts ───
// Note: Shortcuts need store reference, so they're registered inside app-shell.
// This import ensures the service module is available.
export { registerKeyboardShortcuts } from './services/keyboard.service';

// ─── Console Banner ───
console.log(
  '%c◇ PDF Layout Designer v2.0 %c Lit + Tailwind + TypeScript ',
  'background: #36677d; color: #fff; padding: 4px 8px; border-radius: 4px 0 0 4px; font-weight: bold;',
  'background: #f1efed; color: #4f4b47; padding: 4px 8px; border-radius: 0 4px 4px 0;',
);
