/**
 * jsdom has dialog elements but no native dialog lifecycle methods.
 * Only model open/close for component wiring tests. Focus, inertness, nesting,
 * cancellation and keyboard behavior must be verified in real Chromium E2E.
 * @author Wichit Wongta
 * @since 2026-09-09
 */
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}
