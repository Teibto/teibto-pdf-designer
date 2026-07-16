/**
 * Stories for Toast Notification system.
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import '../components/shared/toast-notification';
import { showToast } from '../components/shared/toast-notification';

const meta: Meta = {
  title: 'Components/ToastNotification',
  component: 'pld-toast-notification',
};

export default meta;

export const AllTypes: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px; flex-wrap: wrap; padding: 20px;">
      <button @click=${() => showToast('Template saved successfully!', 'success')}>
        Success Toast
      </button>
      <button @click=${() => showToast('Something went wrong.', 'error')}>
        Error Toast
      </button>
      <button @click=${() => showToast('Please check your data.', 'warning')}>
        Warning Toast
      </button>
      <button @click=${() => showToast('PDF export started...', 'info')}>
        Info Toast
      </button>
    </div>
    <pld-toast-notification></pld-toast-notification>
  `,
};
