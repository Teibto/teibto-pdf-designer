/**
 * Stories for Modal components.
 * Demonstrates the reusable modal shell and application modals.
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '../components/shared/modal';

const meta: Meta = {
  title: 'Components/Modal',
  component: 'pld-modal',
};

export default meta;

export const SmallModal: StoryObj = {
  render: () => html`
    <pld-modal .open=${true} modalTitle="Small Modal" size="sm">
      <div slot="body" style="color: #e8e9f0; padding: 8px;">
        <p>This is a small modal for simple confirmations.</p>
      </div>
    </pld-modal>
  `,
};

export const MediumModal: StoryObj = {
  render: () => html`
    <pld-modal .open=${true} modalTitle="📋 Template Settings" size="md">
      <div slot="body" style="color: #e8e9f0; padding: 8px;">
        <p>This is the default medium size modal used for most dialogs.</p>
        <p>It provides enough room for forms and configuration panels.</p>
      </div>
    </pld-modal>
  `,
};

export const LargeModal: StoryObj = {
  render: () => html`
    <pld-modal .open=${true} modalTitle="▶ PDF Preview" size="xl">
      <div slot="body" style="color: #e8e9f0; padding: 8px;">
        <div style="width: 100%; height: 300px; background: #1a1b25; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #8a8ca0;">
          Extra-large modal — used for preview and complex editors
        </div>
      </div>
    </pld-modal>
  `,
};
