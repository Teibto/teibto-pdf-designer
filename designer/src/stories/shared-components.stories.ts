/**
 * Stories for shared UI components (Error Boundary).
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '../components/shared/error-boundary';

// ═══════════════════════════════════════
// Error Boundary
// ═══════════════════════════════════════

const meta: Meta = {
  title: 'Components/ErrorBoundary',
  component: 'pld-error-boundary',
};

export default meta;

export const ErrorBoundary: StoryObj = {
  render: () => html`
    <pld-error-boundary>
      <div style="padding: 20px; color: #e8e9f0;">
        Content inside error boundary renders normally.
      </div>
    </pld-error-boundary>
  `,
};
