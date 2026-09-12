# Template and render parity

## Source contract

- `templates/master/` is the canonical template pack. BFO through the shared `N/render` core is the
  only server render path. `designer/src/services/bfo-export.service.ts` is the only visual-state
  generator.
- In Designer XML mode, the raw BFO/FreeMarker text is the source. Preview and Save must pass it
  through verbatim. Do not invent visual elements JSON or round-trip raw XML through a lossy visual
  conversion. A raw save omits designer data.
- Preserve line endings and draft state. Editing CRLF- or CR-based source must not normalize
  untouched text, and an empty raw draft must remain an explicit empty draft rather than silently
  restoring generated XML.
- NetSuite native Long Text storage has been observed to remove the final newline immediately after
  the closing `</pdf>` tag while retaining every preceding character. Classify that exact result as
  native normalization. Any other missing or changed character is content loss until proved
  otherwise.

## Exact-reference contracts

Treat an account-selected reference form as its own opt-in source contract. Do not universalize its
arithmetic into generic invoices. The verified reference invoice requires all of these together:

- saved-search row types 0, 1, and 2 print, while type 2 advances are excluded from gross;
- a blank advance rate yields zero rather than falling back to a generic foreign-currency amount;
- signed discounts, advances, withholding tax, and cash coupons feed the documented settlement
  totals and amount words.

Implement such behavior behind an explicit template/reference marker or helper. Keep the generic
invoice path unchanged and add synthetic regressions for each financial rule.

## Measure before changing geometry

Do not assume browser CSS conversions describe BFO. In the observed invoice reference, one BFO
pixel measured approximately 0.8 point; `0.75pt` per CSS pixel is not a universal BFO rule. Render
the real candidate PDF and measure its fonts, text/image bounds, colors, baselines, and leading
nonbreaking spaces before adjusting XML geometry.

## Multipage and copy acceptance

For the issue-205 reference layout and its verified 50-row fixture, first prove one copy renders five pages. Then prove two copies
render Original pages 1/5 through 5/5 followed by Copy pages 1/5 through 5/5. Extract and check that
every row appears exactly once and in order in each copy, and that page counts reset for the second
copy. A ten-page total alone is insufficient. These page counts belong to that specific layout;
for another layout, derive expected pagination from its reference and acceptance criteria rather
than imposing five pages on every 50-row document.

Inspect every rendered page through real BFO output. Verify amounts and amount words, Thai glyphs
and embedded fonts, logo, repeated headers/footers, colors, clipping, footer overlap, and the single
final totals block. `docs/qa/205-invoice-reference.md` records the redacted reference evidence and
its practical limits.
