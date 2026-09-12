# SB2 transaction loading and PDF parity — issue 213

<!-- @author Wichit Wongta @since 2026-09-13 -->

The authorized SB2 run verified real transaction loading in the Designer data-entry
screen and the shared PDF render path. Query fusion saved 10 governance units per
measured request compared with the instrumented request-reuse candidate. Invoice
form loading showed a modest observed median change from 2.204 to 2.112 seconds.
Native latency remained variable; this does not establish a general speedup or SLA.

## Scope and method

The sequential comparison used the same existing Invoice, Purchase Order, Item
Fulfillment and Customer Payment records and unchanged XML/copy selections. Each
selected record had one item/apply row. Nine inspected Invoice candidates also had
one row; larger live-record performance remains an explicit coverage gap. Local
50/1,000/10,000-row tests provide separate synthetic scale evidence, not live proof.
No transaction or saved template was changed to manufacture test data.

Stages were the pre-existing live source (`7bd667b+dirty`, verified by source and
asset hashes), request reuse (`ae582ce`), and shared header/summary query fusion
(`3c0d69f`). The latter leaves arithmetic, line/custcol mapping and font/config
resolution unchanged. Differential tests distinguish an absent summary from an
authoritative zero. Source-level query counts drop from four to three for ordinary
curated transactions and two to one for payment/fulfillment; these are not native
query profiler results.

Each form stage has ten completed repetitions. Canonical rendering has five
ordinary one-copy Invoice requests and three for each other case, 23 per stage.
Tables use arithmetic median and nearest-rank p95 (the maximum at these sample
sizes). All samples in each defined repetition series, including first-request outliers, are included.
Shared account/cache state was not reset. Timing stages were not interleaved or
randomized, so differences cannot be attributed solely to the code change.

## Designer form results

Milliseconds, request initiation through observed form paint; paint includes two
animation frames after store/Lit updates. Editing changes and restores one visible
item-cell value in the temporary Designer draft.

| Metric, median / p95 | Baseline | Request reuse | Query fusion |
| --- | ---: | ---: | ---: |
| Request to form paint | 2203.7 / 9220.4 | 2211.8 / 9210.4 | 2112.0 / 8895.6 |
| Response to form paint | 25.8 / 59.2 | 21.2 / 61.6 | 14.9 / 38.1 |
| Visible item-cell edit | 39.8 / 40.5 | 39.8 / 39.9 | 39.9 / 40.3 |
| Governance units | unavailable | 80 | 70 |

No long tasks were observed in these measured form/edit intervals. The missing
baseline telemetry stays unavailable; the 80-to-70 reduction compares the two
instrumented candidates, not an inferred baseline. Request/server wait dominates
the observed form latency. The roughly 4% lower total median is an observation,
not a controlled causal estimate.

One earlier form measurement timed out with insufficient phase markers to locate
the delay. Its evidence was retained separately, not counted as a successful run.
The harness was instrumented with request/response/store/Lit/frame markers and a
request-relative deadline; a diagnostic run and the subsequent ten-run series all
passed. This instrumentation does not replace an animation-frame paint with a timer.

## Canonical PDF results

Fetch through complete PDF bytes, excluding coordinator transport, disk writes and
iframe paint. All 23 requests at each stage produced valid PDFs.

| Layout / copies | n | Baseline median / p95 ms | Query fusion median / p95 ms | Candidate governance, reuse → fusion |
| --- | ---: | ---: | ---: | ---: |
| Invoice / 1 | 5 | 9233 / 41132 | 2551.2 / 15366.6 | 90 → 80 |
| Invoice / 2 | 3 | 2579.5 / 2976.4 | 3095.6 / 4668.1 | 90 → 80 |
| Reference Invoice / 1 | 3 | 4585.5 / 10630.1 | 4473.7 / 8529.8 | 110 → 100 |
| Reference Invoice / 2 | 3 | 3407.2 / 3414.7 | 2481.9 / 2515.1 | 110 → 100 |
| Purchase Order / 1 | 3 | 3303.1 / 15367.1 | 2344.8 / 3176.7 | 90 → 80 |
| Delivery Note / 1 | 3 | 1582.3 / 18792.3 | 1148.7 / 1572.6 | 70 → 60 |
| Receipt / 1 | 3 | 2449.6 / 33928.3 | 1576.1 / 2552.6 | 70 → 60 |

Two-copy Invoice was slower in the final observed series. The initial post-fusion
single data probes were also slow: 19.718 s Invoice, 13.347 s Purchase Order,
9.141 s fulfillment and 17.419 s payment in the server data phase. These observations
are retained; neither they nor the first render requests are verified cold-cache
measurements. Native first-request latency is not resolved by this change.

## Data, layout and interaction verification

- All four complete real-record JSON payloads matched the original baseline except
  `document.printedDate`, including financial, item/custcol and payment apply data.
- All 23 canonical PDF pairs (29 pages) matched the baseline in text, geometry,
  font names and 2x raster pixels after masking only the Printed Date line.
  Thai text, totals, Original/Copy labels and representative layouts were inspected.
- Actual Designer-generated Invoice Preview retained byte-identical XML and matched
  both baseline PDF pages under the same comparison. Existing saved-template Print
  and Preview routes also matched each other on both pages.
- Editing during a pending record reload aborted the client request and retained
  the new local value. Closing actual Preview aborted its client request and closed
  the modal. This does not cancel BFO work already started on the server.

A final Preview observation exceeded its 45-second observation deadline before a
later successful request. Code review found the new pre-request animation-frame
wait could be unbounded when frame callbacks were suspended. Background-tab
suspension is plausible, not proven for that occurrence. The successful request
itself took 5.957 seconds; this is not click-to-preview latency. The follow-up `7460586` correction races the frame with a 100 ms timer and settles
immediately on abort. Browser timer delivery can still be throttled or suspended.
Two focused regressions cover a frame that never fires and closing before a frame.
The served-hash-verified SB2 bundle passed actual Preview again: the tab was hidden,
pointer-down to request was 1.104 seconds and fetch through bytes was 4.481 seconds.
XML and both PDF pages matched baseline. A fast native Preview/Close sequence
aborted one pending request with zero completed responses. An earlier slower close
occurred after a successful response and was not counted as an abort pass. These
are follow-up smoke checks, not a new ten-run form series.

An additional final form smoke observation timed out after the response and Lit
updates while the tab was hidden, before either form animation frame fired.
Bringing the owned tab forward resumed those frames. A fresh visible-tab run
passed: 3483.0 ms request-to-paint, 12.6 ms response-to-paint and 34.3 ms edit.
The hidden-tab timeout is retained as an observation failure, not a product
request failure or a successful paint measurement.

## Deployment, rollback and privacy

The original live files and all affected bundle assets were captured privately;
every hash matched the original stamp. SuiteCloud import line-ending normalization
in two library files was reconciled only after exact normalized-source proof.
The rollback SDF project passed server validation. Rollback was prepared, not executed.

The initial eight-file candidate and subsequent two-file query-fusion overlay each
passed server validation and installation. All deployed files were read back and
matched byte-for-byte. The JavaScript actually served by NetSuite matched the
candidate build hash. The final three-file scheduler overlay also passed server
validation, installation, byte-exact readback and served-JavaScript verification.
The completed initial SB2 capture used `7460586`, retaining the `3c0d69f` backend.
The later pagination-cache follow-up and current deployment status are tracked on PR #214. The original
rollback covers all affected paths. No production deployment is included.

Private ignored evidence retains source, record selections, PDFs, logs, hashes and
an executable rollback project. Only redacted numerical aggregates and this report
are published. No customer values, transaction/template IDs, account URLs, active
browser targets or authentication aliases are included in version control.

## Validation and limits

Engine tests passed 430/430 after query fusion; Designer and automation baseline
validation and local scale evidence are in [the implementation report](213-transaction-performance.md).
The scheduler follow-up passed 7/7 focused Preview tests, lint (29 existing warnings)
and the canonical NetSuite build. Prior CI passed at `ae582ce`; final-head CI status
is tracked on [PR #214](https://github.com/Teibto/teibto-pdf-designer/pull/214).
Run 34724111890 exposed a current-day dependency in the new synthetic baseline
fixture comparisons. Only the test print-time service was pinned; transaction
date and financial assertions remain unchanged. The focused 40-test suite passed
in both Honolulu and Bangkok timezones; no deployed production source changed.
[Numeric aggregates](213-sb2-performance.json) retain all three stages, sample counts,
first requests, maxima and unavailable telemetry.

The connected small-record data/layout gate passes. Large real-record pagination,
load behavior and production latency remain unverified; repeated single-page records
and Original/Copy page sets do not establish multi-page item-flow behavior. The PR
is stacked on prerequisite #200 and must be retargeted after that prerequisite
merges; these results do not sign off the parent production-readiness scope.

## Subsequent CI performance finding and row-height follow-up

Both attempts of run 34724370277 on `730933c` passed all 121 functional E2E
cases and 13/14 web production performance cases, but Credit Memo 10,000 rows
exceeded an unchanged budget. Attempt 1 recorded a 161 ms edit-phase long task;
attempt 2 recorded edit p95 283.4 ms and a 170 ms long task. The limits remain
250 ms edit p95 and 150 ms long task. Raw observations and traces were retained.
Three unchanged-build local repetitions (30 loads/edits) passed with relevant
long-task maxima 56/0/0 ms, showing that local success did not close the CI finding.

Review identified repeated intrinsic height measurement for all rows after a
single-cell edit. Follow-up `36feb36` reuses measurements for unchanged immutable
rows and columns, keyed by all height inputs. Mutable/accessor/nested values and
primitive/null rows bypass unsafe reuse; grouping and page packing still rerun.
A deterministic test verifies 1,000 initial measurements versus one after a
single-row edit. Cached/cold page-range differential tests and input invalidation
coverage passed in a 91-test focused suite; TypeScript and lint passed.

Three local 10,000-row Credit Memo repetitions after the change passed unchanged
budgets. Edit medians were 23.7/24.4/23.5 ms (previous unchanged-build series
35.6/31.0/35.5 ms); edit p95 values were 43.8/34.1/42.1 ms, with no observed
long tasks in the measured intervals. This is local synthetic evidence. Native
follow-up deployment/parity, the full inline-bundle matrix and final-head CI
results are recorded on [PR #214](https://github.com/Teibto/teibto-pdf-designer/pull/214).
The earlier 10-run native form series remains attributed to its original frontend;
it is not relabeled as a measurement of the row-height cache.
