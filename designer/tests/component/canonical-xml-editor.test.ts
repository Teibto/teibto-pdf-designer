// @vitest-environment jsdom
/**
 * Canonical XML editor state and accessibility regressions (#207).
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AppStore } from '../../src/state/store';
import '../../src/components/canonical-xml-editor';

afterEach(() => { document.body.replaceChildren(); });

describe('canonical XML editor', () => {
  it('exposes a labelled native textarea and preserves exact FreeMarker source while marking dirty', async () => {
    const store = new AppStore();
    const initial = '<?xml version="1.0"?>\n<pdf>${record.tranid!""}</pdf>\n';
    store.dispatch((draft) => {
      draft.editorMode = 'xml';
      draft.rawXml = initial;
      draft.template.isDirty = false;
    });
    const editor = document.createElement('pld-canonical-xml-editor') as any;
    editor.store = store;
    document.body.append(editor);
    await editor.updateComplete;

    const label = editor.shadowRoot.querySelector('label[for="canonical-xml-source"]');
    const textarea = editor.shadowRoot.getElementById('canonical-xml-source') as HTMLTextAreaElement;
    expect(label.textContent).toContain('BFO XML source');
    expect(textarea.value).toBe(initial);
    expect(textarea.getAttribute('aria-describedby')).toContain('canonical-xml-status');

    const edited = `${initial}<#-- exact trailing directive -->\n`;
    textarea.value = edited;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await editor.updateComplete;

    expect(store.state.rawXml).toBe(edited);
    expect(store.state.template.isDirty).toBe(true);
    expect(editor.shadowRoot.getElementById('canonical-xml-status').textContent).toContain('Line 4 of 4');
  });

  it('reports empty XML inline instead of producing an alternate preview', async () => {
    const store = new AppStore();
    store.dispatch((draft) => { draft.editorMode = 'xml'; draft.rawXml = ''; });
    const editor = document.createElement('pld-canonical-xml-editor') as any;
    editor.store = store;
    document.body.append(editor);
    await editor.updateComplete;

    const textarea = editor.shadowRoot.getElementById('canonical-xml-source') as HTMLTextAreaElement;
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(editor.shadowRoot.getElementById('canonical-xml-status').textContent).toContain('XML is empty');
  });

  it('preserves loaded CRLF line endings when the textarea reports normalized LF', async () => {
    const store = new AppStore();
    const initial = '<?xml version="1.0"?>\r\n<pdf>\r\n  <body>Before</body>\r\n</pdf>\r\n';
    store.dispatch((draft) => {
      draft.editorMode = 'xml';
      draft.rawXml = initial;
      draft.template.isDirty = false;
    });
    const editor = document.createElement('pld-canonical-xml-editor') as any;
    editor.store = store;
    document.body.append(editor);
    await editor.updateComplete;

    const textarea = editor.shadowRoot.getElementById('canonical-xml-source') as HTMLTextAreaElement;
    expect(textarea.value).toBe(initial.replace(/\r\n/g, '\n'));
    textarea.value = textarea.value.replace('Before', 'After');
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    expect(store.state.rawXml).toBe(initial.replace('Before', 'After'));
    expect(store.state.rawXml.match(/\r\n/g)).toHaveLength(4);
    expect(store.state.rawXml.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
