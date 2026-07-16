/**
 * Stories for panel components.
 * Layers, Grid, Alignment, Pagination, JSON Editor.
 *
 * @author Wichit Wongta
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import './_helpers';
import '../components/panels/layers-panel';
import '../components/panels/grid-panel';
import '../components/panels/alignment-panel';
import '../components/panels/pagination-panel';
import '../components/panels/json-editor';

const meta: Meta = {
  title: 'Panels',
};

export default meta;

export const LayersPanel: StoryObj = {
  name: 'Layers Panel',
  render: () => html`
    <story-store-provider>
      <div style="width: 260px; height: 400px; background: var(--color-bg-panel, #14151e); border: 1px solid #2a2c3a; border-radius: 8px; overflow: hidden;">
        <pld-layers-panel></pld-layers-panel>
      </div>
    </story-store-provider>
  `,
};

export const GridPanel: StoryObj = {
  name: 'Grid & Snap Panel',
  render: () => html`
    <story-store-provider>
      <div style="width: 260px; background: var(--color-bg-panel, #14151e); border: 1px solid #2a2c3a; border-radius: 8px; overflow: hidden;">
        <pld-grid-panel></pld-grid-panel>
      </div>
    </story-store-provider>
  `,
};

export const AlignmentPanel: StoryObj = {
  name: 'Alignment & Distribution',
  render: () => html`
    <story-store-provider>
      <div style="width: 260px; background: var(--color-bg-panel, #14151e); border: 1px solid #2a2c3a; border-radius: 8px; overflow: hidden;">
        <pld-alignment-panel></pld-alignment-panel>
      </div>
    </story-store-provider>
  `,
};

export const PaginationPanel: StoryObj = {
  name: 'Pagination Panel',
  render: () => html`
    <story-store-provider>
      <div style="width: 260px; background: var(--color-bg-panel, #14151e); border: 1px solid #2a2c3a; border-radius: 8px; overflow: hidden;">
        <pld-pagination-panel></pld-pagination-panel>
      </div>
    </story-store-provider>
  `,
};

export const JsonEditor: StoryObj = {
  name: 'JSON Editor',
  render: () => html`
    <story-store-provider>
      <div style="width: 320px; height: 400px; background: var(--color-bg-panel, #14151e); border: 1px solid #2a2c3a; border-radius: 8px; overflow: hidden;">
        <pld-json-editor></pld-json-editor>
      </div>
    </story-store-provider>
  `,
};
