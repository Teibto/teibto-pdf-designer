/**
 * Canonical BFO/FreeMarker source editor for XML-only NetSuite templates.
 *
 * @author Wichit Wongta
 * @since 2026-09-13
 */
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { AppStore, StateChangedEvent, storeContext } from '../state/store';
import { updateRawXml } from '../state/actions';

@customElement('pld-canonical-xml-editor')
export class PldCanonicalXmlEditor extends LitElement {
  @consume({ context: storeContext })
  private store!: AppStore;

  @state() private xml = '';
  @state() private currentLine = 1;
  @state() private totalLines = 1;

  private readonly _onStateChanged = (event: Event) => {
    const state = (event as StateChangedEvent).state;
    if (state.rawXml === this.xml) return;
    this.xml = state.rawXml;
    this.totalLines = countLines(this.xml);
  };

  static styles = css`
    :host {
      flex: 1;
      display: flex;
      min-width: 0;
      min-height: 0;
      background: var(--c-bg);
      color: var(--c-text);
    }

    .editor {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      padding: var(--s-5);
      gap: var(--s-3);
    }

    .heading { display: flex; align-items: baseline; gap: var(--s-3); flex-wrap: wrap; }
    h2 { margin: 0; font-size: var(--t-lg); }
    .mode { color: var(--c-text-muted); font-size: var(--t-sm); }
    label { font-size: var(--t-sm); font-weight: var(--w-semibold); }
    .help { margin: 0; color: var(--c-text-muted); font-size: var(--t-sm); }

    textarea {
      box-sizing: border-box;
      flex: 1;
      width: 100%;
      min-height: 280px;
      resize: none;
      border: 1px solid var(--c-border-control);
      border-radius: var(--r-md);
      padding: var(--s-4);
      background: var(--c-surface);
      color: var(--c-text);
      font: 13px/1.55 var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
      tab-size: 2;
      white-space: pre;
      overflow: auto;
    }

    textarea:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    textarea[aria-invalid='true'] { border-color: var(--c-danger); }
    .status { display: flex; justify-content: space-between; gap: var(--s-3); color: var(--c-text-muted); font-size: var(--t-xs); }
    .error { color: var(--c-danger); }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.xml = this.store.state.rawXml;
    this.totalLines = countLines(this.xml);
    this.store.addEventListener('state-changed', this._onStateChanged);
  }

  disconnectedCallback() {
    this.store.removeEventListener('state-changed', this._onStateChanged);
    super.disconnectedCallback();
  }

  render() {
    const empty = !this.xml.trim();
    return html`
      <main class="editor" aria-labelledby="canonical-xml-heading">
        <div class="heading">
          <h2 id="canonical-xml-heading">Canonical XML</h2>
          <span class="mode">BFO + FreeMarker source mode</span>
        </div>
        <p class="help" id="canonical-xml-help">
          Source is saved, previewed, and exported exactly as entered. Visual conversion is not applied.
        </p>
        <label for="canonical-xml-source">BFO XML source</label>
        <textarea id="canonical-xml-source" .value=${this.xml} wrap="off" spellcheck="false"
          aria-describedby="canonical-xml-help canonical-xml-status"
          aria-invalid=${empty}
          @input=${this._onInput}
          @click=${this._updateLine}
          @keyup=${this._updateLine}
          @select=${this._updateLine}></textarea>
        <div class="status" id="canonical-xml-status" role="status">
          <span>Line ${this.currentLine} of ${this.totalLines}</span>
          <span class=${empty ? 'error' : ''}>${empty ? 'XML is empty' : `${this.xml.length.toLocaleString()} characters`}</span>
        </div>
      </main>
    `;
  }

  private _onInput(event: InputEvent) {
    const textarea = event.currentTarget as HTMLTextAreaElement;
    // HTML textareas expose every line break as LF. Apply the user's edit to
    // the original source so untouched CRLF/CR line endings remain exact.
    this.xml = applyTextareaEdit(this.xml, textarea.value);
    this.totalLines = countLines(this.xml);
    this._setCurrentLine(textarea);
    updateRawXml(this.store, this.xml);
  }

  private _updateLine(event: Event) {
    this._setCurrentLine(event.currentTarget as HTMLTextAreaElement);
  }

  private _setCurrentLine(textarea: HTMLTextAreaElement) {
    this.currentLine = countLines(textarea.value.slice(0, textarea.selectionStart));
  }
}

function countLines(value: string): number {
  let lines = 1;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 13) {
      lines++;
      if (value.charCodeAt(index + 1) === 10) index++;
    } else if (code === 10) lines++;
  }
  return lines;
}

function applyTextareaEdit(rawBefore: string, normalizedAfter: string): string {
  const normalizedBefore = normalizeLineEndings(rawBefore);
  if (normalizedBefore === normalizedAfter) return rawBefore;

  let prefix = 0;
  const prefixLimit = Math.min(normalizedBefore.length, normalizedAfter.length);
  while (prefix < prefixLimit && normalizedBefore[prefix] === normalizedAfter[prefix]) prefix++;

  let suffix = 0;
  const suffixLimit = Math.min(normalizedBefore.length - prefix, normalizedAfter.length - prefix);
  while (suffix < suffixLimit
    && normalizedBefore[normalizedBefore.length - 1 - suffix] === normalizedAfter[normalizedAfter.length - 1 - suffix]) {
    suffix++;
  }

  const rawStart = rawOffsetForNormalizedIndex(rawBefore, prefix);
  const rawEnd = rawOffsetForNormalizedIndex(rawBefore, normalizedBefore.length - suffix);
  const inserted = normalizedAfter.slice(prefix, normalizedAfter.length - suffix)
    .replace(/\n/g, preferredLineEnding(rawBefore));
  return rawBefore.slice(0, rawStart) + inserted + rawBefore.slice(rawEnd);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r/g, '\n');
}

function preferredLineEnding(value: string): '\r\n' | '\r' | '\n' {
  const match = /\r\n|\r|\n/.exec(value);
  return (match?.[0] as '\r\n' | '\r' | '\n' | undefined) ?? '\n';
}

function rawOffsetForNormalizedIndex(raw: string, target: number): number {
  let rawIndex = 0;
  let normalizedIndex = 0;
  while (rawIndex < raw.length && normalizedIndex < target) {
    if (raw.charCodeAt(rawIndex) === 13 && raw.charCodeAt(rawIndex + 1) === 10) rawIndex += 2;
    else rawIndex++;
    normalizedIndex++;
  }
  return rawIndex;
}

declare global {
  interface HTMLElementTagNameMap {
    'pld-canonical-xml-editor': PldCanonicalXmlEditor;
  }
}
