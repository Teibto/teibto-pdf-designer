<!-- @author Wichit Wongta -->
<!-- @since 2026-09-11 -->

# Oracle Redwood UX contract

The designer adopts the interaction structure and visual language from the private
`Teibto/teibto-ui-workspace` reference while retaining this repository's Lit and
shadow-DOM architecture. The reference is a design contract, not a runtime dependency.

## Workspace structure

```text
56 px application top bar
40 px template context bar
┌──────────────────┬────────────────────────────┬──────────────────┐
│ 280 px tool rail │ band/flow design workspace │ 280 px inspector │
└──────────────────┴────────────────────────────┴──────────────────┘
```

- The top bar carries brand, Design/Flow navigation, one primary Preview action,
  Save, theme and an overflow menu for less frequent actions.
- The left rail owns Elements, Layers, Data and Settings. The right rail owns the
  selected element's properties.
- At `1023px` and below, both rails become mutually exclusive drawers with a scrim.
  Their top-bar triggers remain at least 40px and Escape closes either drawer.
- The center canvas is the only flexible column and must never introduce document-level
  horizontal scrolling.

## Token ownership

`designer/src/tokens/` is the only palette, typography, spacing, radius and elevation
source. Canonical Redwood variables use `--c-*`, `--t-*`, `--s-*`, `--r-*` and `--sh-*`.
Existing `--color-*`, `--text-*`, `--space-*` and `--radius-*` names are compatibility
aliases to the same values; they do not define a second theme.

The light theme is the product default. The optional dark theme changes semantic
values only, so components must not branch on theme or embed legacy palette values.
Oracle Sans is preferred with Thai-capable and system fallbacks; server-rendered PDF
fonts remain governed separately by File Cabinet configuration.

## Component behavior

- Controls use 32px visual height and 40px touch targets where space permits.
- Primary, neutral and destructive actions use semantic tokens; state is never
  communicated by colour alone.
- Every keyboard-operable control has a visible focus ring. Tabs expose `tablist`,
  `tab` and `aria-selected`; toggle choices expose their selected state.
- Dialogs use the native modal primitive already provided by `pld-modal`, warm surfaces,
  a restrained scrim and focus-visible close action.
- Toasts use neutral surfaces with a semantic leading border, remain screen-reader
  status messages, and can be dismissed with the keyboard.
- Motion is brief and functional. `prefers-reduced-motion` removes drawer, modal,
  toast and global decorative animation.

## Verification

Changes to this contract require lint, unit tests, production and NetSuite builds,
Storybook build, responsive Playwright coverage, and browser screenshots at desktop
and narrow viewports. Connected NetSuite rendering is not required for style-only
work because this contract does not alter the BFO render path.
