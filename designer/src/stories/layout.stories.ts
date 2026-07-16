/**
 * Stories for layout components — header, template bar.
 * Uses a store provider wrapper for components that consume store context.
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import './_helpers';
import '../components/layout/app-header';
import '../components/layout/template-bar';

const meta: Meta = {
  title: 'Layout/Header',
  component: 'pld-header',
};

export default meta;

export const AppHeader: StoryObj = {
  render: () => html`
    <story-store-provider>
      <pld-header></pld-header>
    </story-store-provider>
  `,
};

export const TemplateBar: StoryObj = {
  render: () => html`
    <story-store-provider>
      <pld-template-bar></pld-template-bar>
    </story-store-provider>
  `,
};
