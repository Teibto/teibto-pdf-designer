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

Local verification: 365 engine tests, seven templates and seven samples,
JavaScript syntax, AI workspace validation and secret scan passed.
The engine suite used `--test-isolation=none` because the Windows sandbox blocked
Node child-process creation; this is local evidence, not a replacement for CI.

A separate one-item synthetic probe confirmed the reference A4 MediaBox, logo
size, title position and black/blue text colors. Measured party-band edges differ
by less than 0.02pt and the first totals label baseline by about 0.05pt. This
is layout evidence with synthetic content, not proof of real-record data parity.

## Remaining acceptance gates

- Publish final local PDF artifacts and finish PR review/CI.

## Connected validation

Explicitly authorized server validation and targeted five-file deployment passed
on SB2. Readback hashes matched all five candidate files; the four pre-existing
files retained identical File Cabinet attributes. The new helper was subsequently
updated within the same scope and verified by readback again.

The first real-record probe exposed a material mismatch with the reference form's
advance-item arithmetic. The reference-only helper now consumes the same scoped
transaction and summary searches: types 0/1/2 print, only 0/1 contribute to gross,
contiguous discount rows modify their preceding item, and signed deductions feed
customer-paid totals. A blank advance rate produces zero instead of falling back
to the generic invoice line amount. The corrected live two-copy render matches
the reference financial values and amount words. Generic invoice data stays
unchanged outside the opt-in reference path. Focused synthetic tests cover these
rules; no actual transaction values are stored in this report.

The supplied 50-row fixture rendered as ten pages: Original pages 1/5 through
5/5, then Copy pages 1/5 through 5/5. Each copy contains precisely rows 001-050
once, in order, with one totals block; every page has a logo and embedded Thai
fonts. All ten page images were inspected for clipping and footer overlap.

The initial CI run passed engine tests, Designer lint/unit/build and all 121
functional E2E tests, but failed the existing cold-start performance budget:
one longest task measured 125ms against a less-than-100ms limit. A subsequent
run must establish CI status; this result is not recorded as a pass.

The final real invoice comparison matches content on Original and Copy except
the runtime printed timestamp. Logo and title bounds match exactly. Party text
baselines match within 0.01pt, memo and amount words within 0.01pt; remaining
measured layout differences are below 0.5pt. The reference's leading nonbreaking
spaces are retained in metadata values. The VAT rate has exactly one percent
suffix, with a regression for the native percent-field string.

The canonical XML was saved as a new nondefault template through the existing
versioned API, then rendered through the normal saved-template route as two
pages. Native Long Text storage removes the final newline after the closing PDF
tag; all preceding XML characters are retained. No existing default or invoice
record was changed. Designer XML editing is tracked separately in issue #207.

The current SB2 engine source matched integration #199, not main. That branch was
merged into this work to preserve its deployed safeguards and snapshot behavior.
Four existing engine files were backed up locally; the fifth is a new helper.
Rollback restores the four original files, leaving the unreferenced helper inert.
No transaction edits or production deployment are part of this work.
