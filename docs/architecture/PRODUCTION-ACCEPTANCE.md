<!-- @author Wichit Wongta -->
<!-- @since 2026-09-12 -->

# Integrated production acceptance

The user goal includes usable features, architecture, complete Redwood styling and live
NetSuite evidence. A successful deployment or a PDF response alone does not close this goal.
Issues #199 and #201 remain the tracking scope. The integrated candidate combines the
reliability/performance changes with the Redwood workspace; the original worktrees remain intact.

## Product and architecture contract

| User task | Responsible layer | Required outcome |
|---|---|---|
| Start a document, insert/select/edit elements | Lit workspace and state/actions | Mouse, touch and keyboard reach the same features; insertion destination is explicit; undo restores the complete document state |
| Supply and inspect data | Engine binding contract; designer data editor | Sample and real records provide the documented raw and curated shapes; large-data rendering is bounded without truncating export data |
| Save and resume work | One exporter, template API, audit/history, draft storage | Saved XML/JSON matches acknowledged document session; failed/stale responses cannot overwrite newer intent; default choice and record type survive reload |
| Preview, download and print | Shared `pld_lib_render` through BFO/N/render | Same XML/copy/font contract; downloaded preview bytes match the displayed PDF; Thai and all business fields render correctly |
| Print a batch and follow progress | Authenticated job/artifact ledger and bounded MR stages | Complete/partial/failure/unknown outcomes are distinguishable; accepted work is not blindly resubmitted; outputs are ordered and requester-authorized |
| Maintain templates across accounts | Canonical masters, provenance and SDF | One generator; no host PDF font assumption; account-specific secrets/data excluded from source; deployed assets and payload match candidate |

Keep `templates/master/` canonical, `bfo-export.service.ts` the sole designer generator and
`pld_lib_render` the shared server pipeline. Never solve a sample-binding defect by adding a
second generator or making raw numeric `item`/`apply` fields formatted strings. Native sample
`items` must match the legacy curated `items` shape of real data independently of raw rows.

## Redwood completion boundary

- Tokens own UI color, type, spacing, elevation, radius and icon sizes. Document formatting is
  user content and must not be recolored when UI tokens change.
- One 24px SVG icon vocabulary replaces platform-dependent UI glyphs; icon-only controls have
  names, and decorative glyphs do not pollute names. Font loading must work through NetSuite
  File Cabinet delivery; naming Oracle Sans in CSS does not prove the font is installed.
- Drawer layout and its triggers share the same 1023px boundary. Test 860, 861, 1023 and 1024px,
  not only a narrow phone and wide desktop. Closed panels must leave the keyboard focus order.
- Tabs, insertion controls, layer selection/reordering, inspector fields, pagination and copies
  are reachable by keyboard with meaningful labels and visible focus.
- Preserve generation-fenced async loads, image upload checks, history/session isolation,
  listener cleanup, structural sharing and bounded pagination/data-form work from #199.

## Portable UI font performance contract

The UI ships six SIL-licensed Sarabun Latin/Thai WOFF2 faces (400/600/700) inline in CSS
so File Cabinet delivery does not depend on host fonts or relative asset URLs. The original
110KiB compressed executable-JS limit remains. Total compressed resources allow the original
120KiB application budget plus a separate 70KiB portable-font allowance (190KiB total).
Startup readiness must load and verify all six faces. Fixed-runner cold 750ms/warm 400ms p95,
long-task 100ms and TBT 150ms limits remain unchanged. These are local production-preview
gates; SB2 delivery latency needs separate measured evidence.

## Retention decision

**User decision, 2026-09-12: keep output files until the user explicitly requests deletion.**
Do not introduce age-based PDF/snapshot/job deletion. Do not describe existing XML-input cleanup
as output deletion: it removes only authenticated published PART XML and preserves PDFs and
snapshots. Any future output deletion must be an explicit owner-authorized action, identify the
exact terminal job/results, preserve audit evidence, reject active/unknown workers and handle
partial deletion truthfully. Its UX and native permission behavior require separate verification.
This decision does not grant permission to delete existing account records or artifacts during QA.

## Acceptance matrix

### Verification status

The committed integration `6119e27` passed 827 local Designer tests, full 115-case E2E
and production startup gates. Coverage was 83.79% statements, 78.63% branches, 86.32%
functions and 84.96% lines. Current source changes must identify their own follow-up
validation rather than inheriting these results. Sandbox validation/deployment and actual
asset readback matched that candidate. Its remote CI did not execute because of account
billing/spending restrictions; the preceding committed candidate passed complete remote CI.

Native evidence verifies saved-template sample-type precedence, exact template XML/JSON
readback and reload, and all six unmodified canonical masters rendered through the existing
BFO pipeline with embedded Thai fonts. Payment samples preserve partial-payment amounts;
delivery samples show quantities and units without prices. Canonical first pages were
visually inspected; this does not establish every multipage feature case.

Earlier integrated native evidence verifies:

- Built-in Invoice padding corrected from 14 to 6, producing one page per copy.
- Real synthetic invoice Print and a one-document synchronous batch.
- PNG/JPEG, Code128 and corrected QR rendering, including independent decoding.
- Native save/reload, keyboard drawers, modal Escape and responsive font delivery.

Earlier results remain regression evidence, not fresh execution of every case on the
current commit. Raw identifiers, hashes, reports, PDFs and screenshots remain local.
Fixtures and outputs are retained until the user explicitly requests deletion.

### Remaining acceptance

- AUTH-01/AUTH-02 require suitable least-privileged identities, subsidiary contexts and
  direct native private-artifact access checks.
- BATCH-01/BATCH-02 positive queued and recovery cases await notification authorization;
  the successful synchronous single-document batch does not close them.
- BATCH-03 covers authenticated published XML-input cleanup. PDF/snapshot/output deletion
  is deferred until explicitly requested by the user.
- Complete native multipage/feature and displayed-download parity evidence.
- Restore current remote CI after account-owner billing resolution, then satisfy required
  review and release policy. Production deployment requires separate authorization.

Connected acceptance below remains open until the integrated deployment is verified. Native
restricted-role/private-file checks and positive batch runs cannot be replaced by local mocks.

Status starts UNVERIFIED for the integrated candidate; evidence from earlier builds is context,
not a pass. Update each item using authoritative results.

| ID | Acceptance item | Required proof |
|---|---|---|
| UX-01 | Complete Redwood shell/panels/modals, both themes | Token/icon review plus real screenshots, computed font evidence and all rail/inspector states |
| UX-02 | Keyboard and responsive features | Native keyboard insert/select/edit/save path; drawer boundary, focus exclusion/restoration and labelled form assertions |
| DATA-01 | Sample/real binding parity | Engine raw/curated schema tests and native sample Preview with populated sequence/unit/unit price/amount, payment and non-priced cases |
| SAVE-01 | Session-safe persistence | Deferred/error/race regressions plus native save/readback/reload, exact XML and metadata comparisons |
| PDF-01 | Renderer and displayed download parity | Real BFO Thai/multipage/copies/image/barcode renders; inspect content and layout; exact preview-download bytes |
| PERF-01 | Editing/startup stability | Full large-data/resize/listener gates on exact candidate; font/asset bytes and actual startup timing; no stale dev-server reuse |
| AUTH-01 | Least-privileged synchronous caller | Native editor/viewer and subsidiary A/B checks on every data/render/template endpoint; effective caller identity proof |
| AUTH-02 | Private batch output | Two users plus same employee weaker role; application and direct native record/File Cabinet access; trusted code cannot be modified by callers |
| BATCH-01 | Positive bounded execution | Synthetic 1/26/51-document jobs with ordered complete outputs, both MR stages, counts/pages/bytes/usage/time |
| BATCH-02 | Recovery and partial outcome | Partial-failure/linked retry, duplicate POST, native pool rejection, terminal recovery and ambiguous-submit fencing |
| BATCH-03 | Authenticated XML-input cleanup | Published XML inputs only; terminal and file-integrity checks; reject foreign/active/stale cases; retained PDFs/snapshots still download. Output deletion is deferred until explicitly requested. |
| DELIVERY-01 | Provenance and reproducibility | Fresh lockfile install, relevant complete gates, SDF validation before deployment, version plus actual asset/payload readback |
| RELEASE-01 | Release decision | All mandatory items evidenced; branch/CI/review policy met; no production deployment without its separate authorization |

Administrator-only QA cannot prove AUTH-01 or AUTH-02. Do not grant broad write access to the
engine SuiteScripts directory to make private child-folder creation pass. Test whether minimal
permissions can satisfy both private storage and trusted-code immutability. A native permission
conflict is an architecture finding, not a reason to weaken the trust boundary.

## Agent handoff contract

Each delegated goal states its exact worktree, owned files, acceptance result and tests. Agents
must preserve others' edits, avoid external actions and report proven defects separately from
unverified behavior. The primary owns integration, generated assets, deployment and every live
browser/SuiteCloud action. Child-goal completion does not complete this acceptance matrix.

Current bounded assignments: workspace interaction (shell/header/palette), shared design system
(tokens/icons/fonts/panels/modals), and engine sample-shape correction. Independent read-only
reviews supplied source-backed integration and security findings. Required next reviews include
integrated diff correctness and all native acceptance gaps after these changes land.
