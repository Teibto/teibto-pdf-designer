/**
 * Theme service (#121) — Dark / Light toggle for the designer UI.
 *
 * ตั้ง data-theme บน <html> → token ใน tokens/colors.css (`:root[data-theme="light"]`)
 * cascade เข้า shadow DOM ของทุก component ผ่าน CSS custom property inheritance.
 * จำค่าที่เลือกใน localStorage · default = dark (ของเดิม)
 *
 * @author Wichit Wongta
 * @since 2026-07-20
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'pld-theme';

export function getTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage อาจถูกปิด — ธีมยัง apply บนหน้านี้ได้ แค่ไม่จำข้ามครั้ง */
  }
}

/** เรียกครั้งเดียวตอน boot ก่อน render กัน flash ของธีมผิด */
export function initTheme(): void {
  applyTheme(getTheme());
}

/** สลับธีมแล้วคืนค่าธีมใหม่ */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
