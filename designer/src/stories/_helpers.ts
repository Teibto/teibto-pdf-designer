/**
 * Storybook helpers — shared utilities for story decorators.
 *
 * @author Wichit Wongta
 */
import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { provide } from '@lit/context';
import { AppStore, storeContext } from '../state/store';

/**
 * Minimal provider wrapper that injects the store context
 * so child components can @consume it.
 */
@customElement('story-store-provider')
export class StoryStoreProvider extends LitElement {
  @provide({ context: storeContext })
  store = new AppStore();

  render() {
    return html`<slot></slot>`;
  }
}

/** Wrap a story template with the store provider */
export function withStore(template: unknown) {
  return html`<story-store-provider>${template}</story-store-provider>`;
}
