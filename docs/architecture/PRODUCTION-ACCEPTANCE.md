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

### Integrated local evidence (2026-09-12)

- Deployed 14:40 UTC candidate recheck: Designer 804 tests passed across 57 files; coverage gates passed
  (statements 83.64%, branches 78.38%, functions 85.93%, lines 84.79%). This includes
  first-save, barcode import rejection, inline import feedback and drawer Escape regressions. Previous full lint
  had no errors and 31 warnings; the test recheck does not establish a fresh lint result.
- Current source recheck: Engine 339 tests passed, including transaction-button SDF coverage.
  Earlier canonical validation: six templates and samples passed.
  Build provenance: six regression tests passed. Source syntax, secret scan and AI workspace passed.
- Earlier integrated candidate: 106 E2E tests passed on a fresh port 5189 server, including keyboard drawers,
  cancel-drag recovery, inspector labels, Layers order and responsive boundaries.
- Earlier integrated candidate, fixed-runner production startup including all six loaded font faces: 20 cold runs p95
  349.6ms (maximum 3021.8ms), 30 warm runs p95 127.8ms (maximum 142.9ms). Cold transfer
  172,959 bytes over three HTTP resources, executable JavaScript 102,122 bytes. The cold
  maximum is an outlier that remains recorded despite the passing p95. These historical
  local preview measurements do not establish current-candidate performance or SB2 latency.
- Large data: 10,000 rows retained with 50 mounted rows/500 inputs; page-switch p95 38ms.
  Resize p95 17.7ms. After 100 Design/Flow switches, live DOM and listener growth were zero.
- Standard production, NetSuite and Storybook builds passed. NetSuite bundles inline
  dynamic imports by design: deployed candidate JS 687.16kB raw/197.34kB gzip;
  CSS 102.26kB raw/69.67kB gzip.
- Independent read-only integration review found no remaining blocker in the reviewed
  ordering/focus/drag/font paths. Duplicate-role imports are rejected by the reorder action.
- Subsequent QR correction: the exporter fits square QR modules inside the original frame,
  centered in a BFO table, while retaining linear barcode dimensions and the complete
  empty-binding guard. Focused exporter/barcode regressions passed 122 tests; unsupported
  formats now fail explicitly rather than silently becoming Code128. Validation/import
  regressions passed 70 tests, modal feedback tests 10 and workspace E2E 14. These scoped
  results do not establish a fresh complete E2E run.

### Connected evidence for the 14:40 UTC deployment

SB2 readback identifies build `2026-09-12T14:40:50.921Z`, source `3973f87+dirty`,
bundle SHA-256 `62bd237a35f5fbae54575d150e4a3ea24af7806c2486f7dbe606c8bfcab9e1e0`.
Actual delivered JS was 687,159 bytes with SHA-256
`48468109baf9d055c2974a3a7a1f1d765468a208806b2939d2f372447030bfcd`.
Validation preceded deployment. This is an uncommitted integration candidate, not a release.

- Real pointer and Escape tests preserve element selection while closing either mobile
  drawer. More → Shortcuts works above an open drawer. Escape closes the modal first,
  then the drawer, and finally deselects when neither overlay is open.
- Preceding deployment evidence verifies persistent, labelled import errors with unchanged
  document/session after invalid JSON; corrected JSON imports successfully. Light/dark
  390px and 1280px modal geometry and primary hover contrast passed.
- Settled workspace screenshots at 390, 860, 861, 1023, 1024 and 1280px show no horizontal
  overflow in both themes. Closed narrow panels are inert and outside the viewport;
  six portable font faces loaded. This does not close all panel/modal accessibility checks.
- Native BFO landscape and portrait QR fixtures retain square modules centered inside
  their frames; an independent decoder recovered the synthetic value on both pages.
  Save/readback preserved exact XML/JSON and template metadata. PNG/JPEG coexist in the fixture.

Synthetic fixtures and raw connected logs/screenshots remain local or in SB2 until the user
explicitly requests deletion. Restricted-role and queued-batch evidence remain outstanding;
queued jobs that email a recipient require the pending explicit notification authorization.

### Subsequent accessibility polish

The next source candidate associates JSON/data form controls with accessible names, makes
JSON expansion a native button, prevents textarea/rename width overflow and completes modal
action SVG migration with brand hover contrast. Full Designer tests pass 809/809 across
59 files with the same coverage percentages recorded above. Full lint has zero errors and
31 existing warnings. Scoped panel browser tests pass 2/2. NetSuite build passes with
688.23kB raw/197.61kB gzip JS and 102.55kB raw/69.73kB gzip CSS.

Validation and deployment passed for build `2026-09-12T14:55:44.403Z`. Actual SB2 JavaScript
readback SHA-256 `615b7ea34010785e90803ae54f9c3e8f1c161e97ae1534fff22e3b7d4fb01e1b`
matches the local artifact. Native data-tab → JSON click exposes textbox name
`ข้อมูล JSON (JSON data)`; clicking Expand produces a native button named Collapse.
This smoke check does not replace the full connected acceptance matrix.

Before the subsequent new-document/reset usability corrections, the complete E2E suite
passed 114/114 on a fresh local port 5193 server. Fixed-runner production startup passed
20 cold runs (p95 326.8ms, max 326.8ms) and 30 warm runs (p95 121.9ms, max 137.6ms).
Cold transfer was 174,012 bytes across three resources; initial JS was 103,115 bytes.
All six font faces loaded, maximum long task was 68ms and TBT 18ms. These measurements
apply to that source snapshot; later changes need their appropriate regression checks.

Independent engine/exporter/validation review found no new actionable source defect in
the reviewed integration. Native AUTH-01/AUTH-02 and queued execution remain unverified.
Workspace validation passed its five tests and four paired agent profiles; build provenance
regressions passed 6/6 after enabling the subprocess permission required by this local runner.

The subsequent usability corrections distinguish New/Unsaved/Saved, detach imported JSON
from prior persisted identity/metadata and require confirmation before rebuilding layout.
Cancel preserves the complete state and one Undo restores edited rows/column widths.
Full Designer regression passes 815/815 in 61 files, with coverage 83.78% statements,
78.58% branches, 86.27% functions and 84.95% lines. Full lint remains zero errors and
31 warnings. The new rebuild browser regression passes; this source has not yet replaced
the 14:55 UTC deployed candidate.

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
| BATCH-03 | Explicit cleanup | Exact signed owner action; terminal and file-integrity checks; reject foreign/active/stale cases; retained PDFs still download |
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
