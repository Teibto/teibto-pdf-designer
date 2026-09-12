# Reference invoice pagination QA

<!-- @author Wichit Wongta @since 2026-09-13 -->

Issue #205 reproduces the user-selected SB2 invoice layout as
`templates/master/invoice-reference.xml`. The transaction reference and downloaded
account source remain private local evidence and are not included here.

## Data and rendering

- The shared BFO renderer remains the only rendering path.
- A `pld:reference-layout` metadata line opts real invoices into a read-only
  transaction-branch company lookup and Thai print-form setup selection.
- Company logo is loaded from File Cabinet without changing file availability.
  Regular and bold Thai fonts remain runtime company configuration.
- Ref. SO, raw branch code, currency and settlement amount words are exposed as
  curated bindings. Cash-coupon deductions are included in customer paid.
- Supplied-data preview preserves requested copies and one immutable data snapshot.
- The fixture has 50 ordered Thai rows, including multiline descriptions at rows
  17, 34 and 50, and coherent gross/VAT/payment totals.

## Observed evidence

The single-copy 50-row fixture was rendered on SB2 with the existing deployed
`preview-live` endpoint. All five page images were inspected. A PDF extraction
check found precisely rows 1 through 50 once, in order, Thai embedded fonts and
one logo image on every page. Header pixels were identical across all pages.

| Page | Item rows | Printed count | Summary |
| --- | --- | --- | --- |
| 1 | 1-14 | 1 / 5 | No |
| 2 | 15-26 | 2 / 5 | No |
| 3 | 27-38 | 3 / 5 | No |
| 4 | 39-50 | 4 / 5 | No |
| 5 | None | 5 / 5 | One final totals block |

The first probe exposed missing repeated headers and unstable column widths.
The current template uses one outer header table, fixed cell widths, explicit
BFO alignment and a full-width page-count table. The revised five-page result
passed the checks above.

Local verification: 358 engine tests, seven templates and seven samples,
JavaScript syntax, AI workspace validation and secret scan passed.
The engine suite used `--test-isolation=none` because the Windows sandbox blocked
Node child-process creation; this is local evidence, not a replacement for CI.

A separate one-item synthetic probe confirmed the reference A4 MediaBox, logo
size, title position and black/blue text colors. Measured party-band edges differ
by less than 0.02pt and the first totals label baseline by about 0.05pt. This
is layout evidence with synthetic content, not proof of real-record data parity.

## Remaining acceptance gates

- Server validation and targeted installation of the five changed engine files.
- Real invoice render verifies currency SuiteQL and branch/setup field access.
- Compare the real short invoice to the selected reference for exact geometry,
  text, totals, logo and original/copy behavior.
- Render both copies of the 50-row fixture and verify page numbering resets,
  complete rows and per-copy totals.
- Publish final local PDF artifacts and finish PR review/CI.

The current SB2 engine source matched integration #199, not main. That branch was
merged into this work to preserve its deployed safeguards and snapshot behavior.
Four existing engine files were backed up locally; the fifth is a new helper.
Rollback restores the four original files, leaving the unreferenced helper inert.
No transaction edits or production deployment are part of this work.
