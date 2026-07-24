/**
 * Guard against discarding unsaved work (#141).
 *
 * The beforeunload handler only covers full-page unload — loading a template,
 * sample, or JSON import overwrites the in-memory design directly, so those
 * paths need their own dirty check or a consultant silently loses work.
 *
 * @author Wichit Wongta
 * @since 2026-07-24
 */
import type { AppStore } from '../state/store';

/**
 * Returns true if it is safe to overwrite the current design. When there are
 * unsaved changes, asks the user to confirm; a clean design proceeds silently.
 */
export function confirmDiscardUnsaved(store: AppStore): boolean {
  if (!store.state.template.isDirty) return true;
  return confirm(
    'งานปัจจุบันยังไม่ได้บันทึก — การโหลดทับจะทำให้งานที่ค้างอยู่หาย\nต้องการโหลดต่อหรือไม่?',
  );
}
