/**
 * Tailwind CSS Mixin for Lit Web Components
 *
 * Adopts shared Tailwind stylesheet into Shadow DOM so utility classes work.
 * Usage:
 *   export class MyComponent extends TailwindMixin(LitElement) { ... }
 *
 * @author Wichit Wongta
 */
import { type LitElement, type CSSResultGroup, unsafeCSS } from 'lit';

// Import Tailwind CSS as raw string (Vite handles this with ?inline)
import tailwindStyles from '../styles/tailwind.css?inline';

// Create a shared CSSStyleSheet from Tailwind
const tailwindSheet = unsafeCSS(tailwindStyles);

type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Mixin that injects Tailwind CSS into a Lit component's Shadow DOM.
 * Component-specific styles still work alongside Tailwind utilities.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TailwindMixin<T extends Constructor<LitElement>>(Base: T): T {
  class TailwindElement extends Base {
    static styles: CSSResultGroup = [
      tailwindSheet,
      // Subclass styles will be appended via array spread
      ...((Base as any).styles
        ? Array.isArray((Base as any).styles)
          ? (Base as any).styles
          : [(Base as any).styles]
        : []),
    ];
  }
  return TailwindElement as unknown as T;
}
