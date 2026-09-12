# Transaction data loading and PDF layout performance

<!-- @author Wichit Wongta @since 2026-09-13 -->

Issue #213 uses Invoice and `invoice-reference.xml` to verify the shared data-to-form
and data-to-PDF paths. “Layout form” means the PDF Designer layout/data-entry screen
and the rendered PDF layout; it does not introduce NetSuite Custom Form routing.

## Candidate and measured scope

The isolated candidate starts at integration commit `320277e`, which includes the
Invoice reference layout and canonical XML editing. Engine work owns the shared
transaction snapshot and render context; Designer work owns request lifecycle and
form responsiveness. Canonical XML and financial arithmetic are unchanged.

The engine regression harness loads the actual AMD module graph with synthetic
NetSuite dependencies. It counts transaction loads and company resolution calls:

| Real-record render path | Before | Candidate |
| --- | --- | --- |
| Ordinary curated transaction, one copy | 2 transaction loads | 1 |
| Reference Invoice, one copy | 3 transaction loads | 1 |
| Reference Invoice, multiple copies | 2 transaction loads | 1 |
| Curated company config, N copies | N + 1 resolutions | 1 |

These are deterministic call counts, **not measured NetSuite latency reductions**.
Tests cover every supported curated type and raw binding at 1/2/20 copies,
reference Invoice, next-request freshness, subsidiary fallback, denied record
access and missing fonts. Reuse ends with each document request; transactions
and company config are read again on the next request. BFO still generates each
copy and combines a copy set through the existing single render library.

## Measurements

`load-record` returns numeric `Server-Timing` phases `data` and `serialize` without
changing its JSON body. PDF responses expose `total`, `data`, `reference`,
`binding`, `bfo` and `combine` where executed. `X-PLD-Usage` is the governance
delta; an unavailable getter leaves the header absent. Native render logs also
record per-phase governance, item/copy counts and PDF bytes when available.

The `data` phase includes native record load, curated mapping and its initial
company config resolution. `reference` is the optional reference enrichment.
`binding` creates renderer/data-source bindings; `bfo` performs FreeMarker/render
passes and `combine` performs the final multi-copy `xmlToPdf`. Phases accumulate
across copies without overlapping. PDF `total` includes template lookup and
request preparation, but ends before writing response bytes. Template lookup is
not separately timed. No record values, IDs or URLs are added to timing headers.

From an explicitly authorized, registered sandbox session and owned Designer tab:

```powershell
# Set PLD_ACCOUNT, PLD_TARGET_ID and PLD_COORDINATOR for that owned session.
# PLD_OUTPUT_DIR must be a private directory outside version control.
node automation/src/cli.mjs render --template invoice-reference --output reference-measured.pdf --copies 2 --measure

# Default uses synthetic server data. Real records additionally require operator
# opt-in PLD_ALLOW_RECORDS=true and --record-id <authorized-record-id>.
node automation/scripts/benchmark.mjs --template invoice --copies 1 --runs 20
node automation/scripts/benchmark.mjs --template invoice-reference --copies 2 --runs 20
```

The benchmark is serial and saves each PDF under a unique filename for private
content inspection. Its output contains numeric aggregates, a run ID, template,
copy count and synthetic/record mode; it omits record IDs and private file paths.
It reports nearest-rank p50/p95, sample counts, maxima, UTF-8 request bytes and
failures over **all** attempts. Missing phase or usage observations remain missing, never zero. The
first request is reported separately from subsequent requests; it is not called
a cold server measurement because the shared account/cache state is not reset.

Browser `elapsedMs` runs from fetch to complete PDF bytes and excludes local
coordinator overhead, base64 transport, disk publication and iframe paint. The
benchmark does not inspect pages or prove financial/layout parity. Session,
context, configuration and transport failures stop immediately; three consecutive
render failures also stop the run. Unattempted requests remain separate from the
failure denominator. `plannedRuns`, `notAttempted` and `stoppedReason` identify an
incomplete run; `failureCategories` contains only allowlisted category counts. A nonzero
failure count exits nonzero. A small successful sample does not establish a
production failure rate below 1%.

## Acceptance evidence and remaining work

- Engine integrated tests: 425/425 passed using
  `node --test --test-isolation=none "engine/tests/**/*.test.js"` on Windows.
- Automation tests: 25/25 passed, including real local CLI/MCP subprocess tests,
  timing allowlisting, missing measurements and failure denominator handling.
- Template validator: all 7 masters and 7 synthetic samples passed.
- Designer lint: 0 errors, 29 existing warnings; 851 unit/component tests passed.
  Production build passed. The new production Chromium benchmark passed 12/12
  cases (120 mocked loads) using the engine's synthetic sample builder and the
  built-in Invoice layout across Invoice, Sales Order, Purchase Order and Credit Memo.
- The inline NetSuite bundle passed the same 12/12 cases with unchanged budgets;
  `build:netsuite` and provenance staging passed. Existing web-build startup
  benchmarks passed 2/2 and focused pagination browser tests passed 7/7.
- Connected real-record baseline/candidate timing and PDF inspection: pending
  sandbox authorization for this task; no new account action has been performed.

Local Windows Invoice results (Node 24.18.0; configured Chromium 153.0.8010.12,
revision 1243; 10 repetitions per size, milliseconds):

| Item rows | Request-to-observed-form paint p50 / p95 | Item-cell edit p50 / p95 |
| --- | --- | --- |
| 50 | 330.2 / 382.3 | 32.5 / 33.8 |
| 1,000 | 351.8 / 420.8 | 32.9 / 34.2 |
| 10,000 | 606.8 / 658.0 | 33.9 / 47.0 |

Across all four types/sizes, the highest observed load p95 was 776.5 ms, edit p95
75.7 ms, and longest observed long task 63 ms. The configured regression budgets
are 1,500 / 250 / 150 ms respectively. Full captured console aggregates are in
[`213-local-performance.json`](213-local-performance.json); raw individual runs
were not retained. The load metric includes test layout setup and tab automation,
and the edit metric includes parent store/pagination and two animation frames.
These are current-candidate local observations, not a before/after speedup claim
or live NetSuite/BFO latency. The benchmark checks nonempty multi-page layout and
bounded form controls, and exposed the header-table pagination bug fixed here.

The deployment build combines JavaScript into one file, so it is also tested
separately through `playwright.netsuite-performance.config.ts` (port 4175 serving
`dist-netsuite`, after `npm run build:netsuite`). Invoice p95 load/edit times were
421.5/57.2 ms for 50 rows, 432.7/67.8 ms for 1,000, and 714.7/50.1 ms for 10,000.
Across that 12-case run the maximum observed load p95/edit p95/long task were
714.7/67.8/59 ms. Parsed console aggregates are in
[`213-netsuite-bundle-performance.json`](213-netsuite-bundle-performance.json).
This serves the exact built bundle locally with mocked account responses; it
still cannot measure native Suitelet, SuiteQL, File Cabinet or BFO latency.

For connected acceptance, use identical record/template/copy selections before
and after deployment. Cover ordinary Invoice and reference Invoice with small,
medium and large available line counts, one/two copies, then representative
purchase-order, item-fulfillment and customer-payment item/apply shapes. Record
actual line counts privately; do not substitute supplied synthetic JSON for a
real-record loading measurement. Repeat the same Designer fetch-to-form and
visible-cell edit measurement, and inspect preview/download layout, totals,
copy labels, Thai glyphs, pagination, repeated headers and footers. Retain PDF
page counts and redacted comparison results separately. Mark unavailable types
or sizes as gaps. Do not change transactions to manufacture a benchmark.

The full objective remains open until connected evidence verifies real loading
performance and PDF layout parity. Local mock tests cannot close that gate.
