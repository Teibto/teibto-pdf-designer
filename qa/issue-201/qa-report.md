<!-- @author Wichit Wongta -->
<!-- @since 2026-09-11 -->

# Issue #201 — Oracle Redwood designer QA

Verdict: **PASS** for the local UX/UI scope. Connected NetSuite render QA is not
applicable because this change does not alter the BFO generator or render path.

## Environment

- Vite local app: `http://127.0.0.1:4174/?qa=issue-201-redwood`
- Chrome 152, direct CDP via the team `cdp.py`
- Isolated QA ports/profiles: `9441` desktop and `9442` narrow-screen interaction
- Date/timezone: 2026-09-11, Asia/Bangkok

## Results

| Check | Result | Evidence |
|---|---|---|
| Desktop light workspace | PASS | `shots/desktop-light.png` |
| Responsive layout at 390, 800, 1024 and 1440px | PASS | `lens responsive`: zero findings |
| Horizontal overflow and minimum lens checks | PASS | `lens layout`: zero findings |
| Left drawer opens through a trusted click | PASS | class becomes `workspace-panel left open`; scrim present; `shots/mobile-left-drawer.png` |
| Right drawer replaces left drawer | PASS | left closes, right becomes `workspace-panel right open`; `shots/mobile-right-drawer.png` |
| Escape closes a drawer | PASS | both panels lose `open`; scrim count returns to zero |
| Dark theme through the real UI action | PASS | `data-theme=dark`, body `rgb(22,21,19)` / `rgb(245,244,242)`; `shots/desktop-dark.png` |
| Keyboard focus visibility | PASS (manual deep-shadow verification) | focused inner header button has `0 0 0 2px` visible box shadow |
| Console | PASS | no application errors; only Lit's expected dev-mode warning |

The generic focus lens reported the outer `pld-app-shell` host as stuck because focus
is delegated through nested shadow roots. A recursive active-element inspection reached
`PLD-APP-SHELL → PLD-HEADER → BUTTON` and confirmed the visible focus ring on the actual
control, so this lens result is a documented false positive rather than a product defect.

## Contrast probes

Calculated WCAG contrast ratios for the canonical semantic pairs:

| Pair | Ratio |
|---|---:|
| Light text / surface | 18.25:1 |
| Light text / warm background | 16.60:1 |
| White / brand | 6.19:1 |
| White / navigation rail | 7.22:1 |
| Danger / surface | 6.22:1 |
| Warning / surface | 6.21:1 |
| Information / surface | 6.25:1 |
| Dark text / dark surface | 15.12:1 |
| Dark on dark-theme brand | 8.63:1 |

All tested canonical text/control pairs exceed WCAG AA for normal text.

## Automated gates

- ESLint: passed with the repository's existing `no-explicit-any` warnings only.
- Vitest: 41 files, 634 tests passed.
- Playwright Chromium: 89 tests passed, including the new drawer and overflow checks.
- Vite production build: passed.
- Vite NetSuite-mode build: passed.
- Storybook production build: passed.
- Gitleaks 8.30.1 working-tree and staged-snapshot scan: passed.
