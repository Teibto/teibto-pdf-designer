/**
 * Stories for sidebar components — element palette and property inspector.
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import './_helpers';
import '../components/layout/sidebar-left';
import '../components/layout/sidebar-right';

const meta: Meta = {
  title: 'Layout/Sidebars',
};

export default meta;

export const LeftSidebar: StoryObj = {
  name: 'Left Sidebar (Element Palette)',
  render: () => html`
    <story-store-provider>
      <div style="width: 280px; height: 600px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-lg); overflow: hidden;">
        <pld-sidebar-left></pld-sidebar-left>
      </div>
    </story-store-provider>
  `,
};

export const RightSidebar: StoryObj = {
  name: 'Right Sidebar (Property Inspector)',
  render: () => html`
    <story-store-provider>
      <div style="width: 280px; height: 600px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-lg); overflow: hidden;">
        <pld-sidebar-right></pld-sidebar-right>
      </div>
    </story-store-provider>
  `,
};
