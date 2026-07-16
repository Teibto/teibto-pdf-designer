/**
 * Stories for shared UI components (Context Menu, Error Boundary).
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '../components/shared/context-menu';
import '../components/shared/error-boundary';

// ═══════════════════════════════════════
// Context Menu
// ═══════════════════════════════════════

const contextMenuMeta: Meta = {
  title: 'Components/ContextMenu',
  component: 'pld-context-menu',
};

export default contextMenuMeta;

export const Closed: StoryObj = {
  render: () => html`
    <div style="position: relative; width: 400px; height: 200px; background: #1a1b25; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #8a8ca0;">
      Right-click on canvas to open context menu
    </div>
  `,
};

// ═══════════════════════════════════════
// Error Boundary
// ═══════════════════════════════════════

export const ErrorBoundary: StoryObj = {
  render: () => html`
    <pld-error-boundary>
      <div style="padding: 20px; color: #e8e9f0;">
        Content inside error boundary renders normally.
      </div>
    </pld-error-boundary>
  `,
};
