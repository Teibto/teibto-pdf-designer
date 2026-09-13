/**
 * Oracle Redwood design-system reference states used by the PDF designer.
 *
 * @author Wichit Wongta
 * @since 2026-09-11
 */
import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';

const meta: Meta = {
  title: 'Design System/Oracle Redwood',
};

export default meta;

export const TokensAndControls: StoryObj = {
  render: () => html`
    <style>
      .rdw-demo { font-family: var(--f-sans); color: var(--c-text); padding: var(--s-6); background: var(--c-bg); }
      .rdw-demo h2 { margin: 0 0 var(--s-4); font-size: var(--t-xl); }
      .swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--s-3); }
      .swatch { padding: var(--s-4); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); }
      .swatch i { display: block; height: 40px; margin-bottom: var(--s-2); border-radius: var(--r-sm); }
      .controls { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-6); }
      .controls button, .controls input { min-height: var(--btn-h); border: 1px solid var(--c-border-control); border-radius: var(--r-md); padding: 0 var(--btn-px); background: var(--c-surface); color: var(--c-text); font: inherit; }
      .controls .primary { background: var(--c-brand); border-color: var(--c-brand); color: var(--c-brand-on); }
      .controls .danger { color: var(--c-danger); border-color: var(--c-danger); }
      .controls :focus-visible { outline: none; box-shadow: var(--focus-ring); }
    </style>
    <section class="rdw-demo">
      <h2>Oracle Redwood workspace primitives</h2>
      <div class="swatches">
        <div class="swatch"><i style="background:var(--c-brand)"></i>Brand</div>
        <div class="swatch"><i style="background:var(--c-sidebar)"></i>Navigation rail</div>
        <div class="swatch"><i style="background:var(--c-surface-3)"></i>Neutral surface</div>
        <div class="swatch"><i style="background:var(--c-success)"></i>Success</div>
        <div class="swatch"><i style="background:var(--c-warning)"></i>Warning</div>
        <div class="swatch"><i style="background:var(--c-danger)"></i>Danger</div>
      </div>
      <div class="controls">
        <button class="primary">Primary action</button>
        <button>Secondary action</button>
        <button class="danger">Destructive action</button>
        <button disabled>Disabled</button>
        <input aria-label="Example field" value="Editable field" />
      </div>
    </section>
  `,
};
