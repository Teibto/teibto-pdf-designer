# Production readiness — issue #199

<!-- @author Wichit Wongta -->
<!-- @since 2026-09-09 -->

Status: **not approved for production**. This plan preserves the full goal: secure NetSuite
operation, Thai UX and PDFs, reliable editing, measured performance, fleet delivery and live QA.
Local test doubles do not execute FreeMarker/BFO or establish NetSuite role permissions.

## Review and implementation sequence

| Priority | Work | State / acceptance evidence required |
|---|---|---|
| P1 | Save race, duplicate POST retries, nested-input keyboard shortcuts | Implemented locally; deferred-response, double-save and editable/IME regressions. Preserve new edits and document identity, including a new template saved while editing. |
| P1 | Download differs from current preview; stale responses after reopen | Implemented locally; download displayed blob and discard superseded responses. Three component regressions. Live save/reload/print parity still required. |
| P1 | Wrong subsidiary config and unusable Thai fonts silently print | Implemented locally; require matching/global config and valid File Cabinet fonts for render, retain setup inspection. Live missing-font and subsidiary tests required. |
| P1 | All-role Suitelets execute as Administrator | Candidate emits empty runasrole and disables anonymous Suitelet access. User-facing overrides need SDF/readback; MR caller-role inheritance depends on programmatic submission, not its fixed Administrator UI field. Restricted-user execution matrix remains a release blocker; XML tests alone do not prove runtime authorization. |
| P1 | Shared batch folder exposes job JSON/XML and other users' output | Local candidate adds durable requester/role/owner identity, per-job private folder readback and job-authorized download. My Files now isolates loaded unsigned/corrupt rows without disclosing them or masking an account-wide crypto outage. Native record/file permissions, direct URLs, weaker-role access and retention remain release blockers; local stubs cannot establish account privacy. |
| P1 | Batch input/merge errors skip cleanup and notification | Authenticated PART/CHUNK commits survive lost MR output and successful chunks are reused. Failure notifications include the job reference. Owner-triggered cleanup verifies terminal tasks and published PDFs, then deletes committed XML inputs in bounded signed continuations. Snapshot/orphans/unpublished inputs remain retained; bounded PART/CHUNK orphan adoption is implemented locally; age-based retention remains open. |
| P1 | Accepted queue task reported as rejected after metadata failure | Enqueue separates preparation failure cleanup from the submit boundary. Once submit is attempted, thrown/empty responses retain snapshot/status and report uncertainty; a guarded update cannot downgrade an advanced worker. Accepted-task ID/link failures preserve work and show tracking. Connected task/role behavior remains required. |
| P2 | Repeated transaction reads per copy | Implemented request-local frozen snapshot; copy titles/labels remain independent. Measure real governance and latency before capacity claims. |
| P2 | Queue reads mutable templates | Schema v5 authenticates job state, enqueue snapshots, ledger artifacts, chunk plans and output manifests. Guarded downloads verify actual PDF bytes. Bounds: 1,000,000 XML characters / 8 MiB job, 8 MiB XML per chunk and 10 MiB PDF per chunk. Native secret/script access and historical/replay policy remain live gates. |
| P2 | Unbounded batch merge | Schema v5 uses a separate reduce-stage merge, at most 25 documents / 8 MiB framed XML per chunk, within 500-document and 20-copy input limits. Planning/finalization read metadata. Native selection uses two packaged deployments per stage; exact documented rejection supports signed manual retry, while ambiguous submissions stay fenced. Bounded orphan adoption is implemented locally; native governance/capacity and age-based retention remain open. |
| P2 | Modal accessibility / keyboard-only workflows | Native named dialog implemented with background inertness, browser focus containment/restoration, topmost Escape, local cheatsheet toggle and inline save errors. Real Chromium regressions cover slotted/shadow inputs and narrow screen. Remaining dialog-specific errors/toasts and live Thai UX need QA. |
| P2 | Save dialog metadata/draft consistency | Implemented omitted metadata preservation, explicit false default removal and atomic session-owned draft acknowledgement across saves. Corrected original review: server previously ignored false rather than unsetting on quick-save. Durable content/default-cleanup warning retains ID/version; conflicting defaults now block print. Cross-record default updates still require live permission/concurrency QA. |
| P2 | Dependency security | Full dependency audit now reports zero findings after Vite 6.4.3, Vitest 3.2.7, Storybook 9.1.20 and ESLint 10 migration. Lockfile/runtime upgrades verified with unit tests, builds and Chromium. Continue monitoring advisories. |
| P2 | Build / deployment provenance | Local manifest seals complete designer inputs/environment hashes and assets; stale/tampered --no-build reuse fails before SuiteCloud. Stamp includes staged/untracked dirty state and scoped engine payload hash. CI now requires provenance tests and all three builds. This detects consistency, not artifact signing or live deployment parity; runner policy remains separate in PR #198. |
| P2 | Startup size and large-designer interaction | Fixed sampled pagination cache missing arbitrary row/column changes; immutable store inputs use reference hits, mutable inputs use complete keys. Synthetic 100/1,000/10,000-row regressions pass. Current NetSuite JS is 1,320.04 kB / 354.65 kB gzip; real startup, drag/edit/undo and server capacity remain unmeasured. |

## Architecture decisions

Keep canonical templates in `templates/master/`, one BFO exporter in the designer and one shared
`pld_lib_render` server pipeline. Cache transaction data only inside one render request. Preserve
copy-specific bindings through immutable overlays. Keep runtime font resolution in company config.
Do not turn missing configuration, access failures or incomplete batches into successful empty PDFs.

Permission design should use the caller's restrictions wherever possible, with explicit minimum
template/config/File Cabinet permissions. Oracle recommends current-role execution to avoid
unwanted access in its [Suitelet button example](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157169557654.html).
The exact deployment XML, account permissions and queued-worker boundary still need validation;
changing a deployment field alone is insufficient sign-off.

## Local verification

The candidate at `d1b4705` passed the full
[quality gate](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34268340825), including
secret scanning, ShellCheck, templates, engine/designer tests, provenance, all three builds and
Chromium E2E. Independent reviews identified failure-state, notification and folder-validation
defects that were fixed with regressions. No live NetSuite validation, deployment or PDF inspection
has run. Later commits still require their own CI evidence.

Run from repository root unless a command starts with `cd designer`:

```sh
node --test "engine/tests/**/*.test.js"
node --test scripts/build-provenance.test.mjs
bash scripts/validate-templates.sh
bash scripts/secret-scan.sh
cd designer
npm ci
npm audit --audit-level=high
npm run lint
npm test -- --run
npm run build
npm run build:netsuite
npm run storybook:build
npx playwright test --workers=2 --reporter=line
```

Windows restricted process environments may require approved child-process execution. Engine tests
can use `node --test --test-isolation=none "engine/tests/**/*.test.js"`. On this workstation the
`python3` Store alias is broken; the validator passed using a shell function forwarding `python3`
to the installed `python`, without modifying the validator.

Historical round-three evidence for the earlier candidate: **175/175** engine tests, **631/631** designer unit tests,
**87/87** Chromium tests and **6/6**
build-provenance tests. Full dependency audit is zero (including development dependencies).
Storybook exported 12 stories from the six story files at that milestone.
The dependency findings recorded in earlier rounds were resolved; they are not current blockers.

The synthetic row-mode pagination probe covers 100/1,000/10,000 Thai rows with complete,
non-overlapping slices (4/40/400 pages) and 1,000 identical cache hits per fixture. One local Node
run measured cold computation 0.664/0.203/0.625 ms and all 1,000 cache hits 0.465/0.271/0.287 ms.
These small timings verify the local cache path only: there is no wall-clock pass threshold,
browser rendering measurement, BFO glyph inspection or NetSuite throughput claim.

Schema v4 below is a **historical milestone, not the current batch contract**. Current code uses
schema v5 authenticated jobs, artifact ledger, bounded render/merge stages and guarded downloads.
Drain v4/older workers before upgrade and resubmit legacy requests; never add an unsigned fallback
that promotes old job fields into v5 authority. Native historical file access, replay of authentic
old state, permission revocation, secret/script restrictions and retention policy still require
account tests and policy decisions. No local implementation establishes production readiness.

Current branch local evidence (2026-09-11): **328/328 engine tests passed** with
`node --test --test-isolation=none "engine/tests/**/*.test.js"`. This is current local Node evidence
only: no SDF validation, NetSuite deployment, native crypto/file/search execution, role matrix or
BFO/PDF inspection was performed by this run.

The current engine candidate also fixes two live-observed gaps. Synthetic customer-payment rows now
carry paid amounts that sum exactly to the receipt payment while keeping document totals distinct.
My Files returns authenticated jobs even when another successfully loaded row is unsigned or corrupt,
counts that row only in a generic safety warning, and logs its identity internally. A fixed HMAC
readiness probe runs before search/load so missing secret or native crypto access still fails globally;
direct status/download access to an invalid row remains rejected.

Current designer evidence: **634/634 unit tests passed**, both production and NetSuite builds
completed, Storybook 10.6.0 built successfully and `npm audit` reports zero vulnerabilities after
upgrading Vitest/UI to 5.0.0. The local Chromium suite passed **87/87** tests. Connected NetSuite
evidence is recorded separately and must not be inferred from these local toolchain checks.

Connected SB2 evidence (2026-09-11, synthetic/redacted data only): server SDF validation passed
against account `4089685_SB2`; the only remaining validator warnings state that `allroles` selects
internal rather than external roles, which is intentional. A clean candidate deployment completed
and version readback returned SHA `be8ac6d`, bundle SHA-256
`58f4c0cc81c15192bf9cd3d90cca653bd9cd78438126d741158c039219d58208` and engine-payload SHA-256
`99cb785f50e0157dc0d5aef9b16c4b30d122c118a5cc261aeb0e02c0e5ab4281`. All six canonical
masters returned `%PDF-` through `preview-live` with synthetic sample data. The canonical invoice
showed readable Thai glyphs and two copies; a temporary non-default QA template saved/reloaded as
record 42, both live and saved previews rendered two visually matching pages, and the record was
deleted after an identity/default guard. An intentionally broken existing QA template failed with
a visible correlated error rather than a false-success PDF.

Live BFO scale probes rendered 100, 1,000 and 10,000 synthetic Thai/XML-sensitive rows as 6, 54
and 527 pages. Observed request/output/latency for the largest probe was 4,821,820 JSON characters,
1,614,759 PDF bytes and 19,664 ms; these are one-run SB2 observations, not fleet capacity promises.
The deployed designer loaded with no captured console errors, both font weights resolved to File
Cabinet URLs, Thai text input round-tripped through the accessibility tree, and the named shortcuts
dialog closed with Escape and restored focus. Live QA also exposed the batch search form dropping
Suitelet routing parameters. Clean deployment `b0a641e` and runtime readback passed; replaying the
GET filter retained `script=3359&deploy=1`, returned the result controls and no longer produced
NetSuite's missing-parameter Notice. The later receipt/My Files candidate still requires its own
deployment/readback evidence in the PR record. Restricted-role/subsidiary A/B, native batch
privacy/queue/cleanup and retention policy remain release blockers.

Redacted local screenshots: [live unsaved preview](../qa-evidence/issue-199/be8ac6d-live-unsaved-template42.png),
[saved/reloaded preview](../qa-evidence/issue-199/be8ac6d-saved-template42.png),
[viewer diff](../qa-evidence/issue-199/be8ac6d-preview-parity-diff.png), and
[existing multipage invoice](../qa-evidence/issue-199/be8ac6d-invoice-preview.png). The 0.6229%
whole-viewport diff is confined to PDF-viewer chrome/thumbnail timing; the document page itself is
visually identical.

## Connected acceptance and evidence

Primary agent only; exact sandbox account and side effects must be authorized before connecting.
Use synthetic/redacted records. Record source commit, deployed hashes, account alias, role,
document/template IDs, timestamp, error IDs and redacted artifact paths.

1. Validate SDF, deploy candidate, verify version and asset hashes. Capture rollback candidate.
2. Render all six canonical templates; null fields, XML-sensitive text, long Thai text, combining
   marks, multiple copies and multipage tables. Inspect glyphs, totals and repeated header/footer.
3. Create/edit/save/reload template; preview unsaved changes and download the exact displayed PDF.
   Save before transaction Print and compare meaningful content/layout.
4. Test restricted user and subsidiary A/B across every read/export path. Unauthorized IDs and
   another requester's batch output must not disclose data or downloadable artifacts.
5. Run representative small/medium/large batches and record elapsed time, usage, input bytes,
   pages, memory-related failures and complete/failed/pending counts. Exercise retry/restart,
   template changes during queue processing and cleanup after every failure.
6. Browser QA: Thai typing/IME, keyboard-only dialogs, unsaved drafts, slow network, expired login,
   no-record sample preview and clear recovery messages.
7. Release only after all blockers close, CI passes, reviewer approval and explicit production
   deployment authorization. Retain versioned rollback artifacts and account-by-account checklist.

## Agent goal assignments

Current persistence, merge, authentication, recovery and native pool contracts are documented in
[Batch reliability](architecture/BATCH-RELIABILITY.md). Signing, bounded chunks, pre-plan render and
merge recovery, published-input cleanup and native deployment selection are implemented locally.
Bounded PART/CHUNK orphan adoption is also implemented locally. Age-based retention and
native-account security/capacity/parity evidence remain required. The following entries preserve historical verification counts for their respective slices;
use the latest candidate evidence and current requirement matrix for acceptance.

Historical schema v4 verification: **201/201** engine tests, including real Node crypto adapters,
native field/snapshot/part/result tampering, post-save PDF substitution, missing secrets and
optimistic-write conflicts. All engine syntax checks and six template/sample checks pass.
The same verified XML string reaches BFO; guarded download creates a new file from verified PDF
bytes. These tests do not prove API-secret script restrictions, native role behavior or NetSuite
crypto/file APIs. Secret denial after saving a part can retain a private orphan until the planned
recovery/retention implementation handles it.

Schema v5 local verification: **227/227** engine tests, including 52 job/Suitelet tests, 13 ledger
tests and 40 render/merge tests. The full suite covers ordered chunks, Thai byte budgets, metadata
planning/finalization, authenticated downloads, known-terminal merge recovery and competing claims.
The chunking candidate `8487539` passed
[CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34272435217).

Cleanup candidate local verification: **238/238** engine tests, including 11 cleanup tests with
real job/ledger/HMAC code. Coverage includes signed initial/continuation POSTs, retained PDFs and
snapshots, failed/active jobs, task identity, altered files/references, concurrent deletion,
permission failures, replay and depleted governance. The 20-second deadline is cooperative;
native file search/type/delete behavior and concurrent Cabinet edits require sandbox evidence.
No live account changes have occurred.

Pre-plan render recovery verification: **250/250** engine tests pass. The status-page token flows
through the real Suitelet, job/HMAC modules and both workers to a downloadable completed result.
Tests cover committed-part reuse, immutable snapshot identity, terminal-task checks, stale/forged
tokens, competing claims/plans/results, unknown submit outcomes and metadata acknowledgements that
arrive after the worker starts. Recovery applies only before a plan is sealed; it does not erase
an all-failed plan or promise historical transaction data for previously unrendered documents.
The preceding cleanup candidate `f823f27` passed
[full CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34273933536).
Recovery commit `c849373` also passed
[full CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34275216255).
Connected role/task/BFO evidence remains required.

Initial-submit ambiguity verification: **253/253** engine tests pass, including thrown, empty and
whitespace task-ID responses, concurrent worker progress/publication, failed uncertainty markers
and preparation-only cleanup. Snapshot and advanced worker state survive every injected ambiguous
submit response. Syntax and MR object XML well-formedness pass; this is not native SDF validation.
Deployment documentation now distinguishes MR caller inheritance from its fixed Administrator UI
field and records the documented native deployment-selection option for the next pool integration.

Native-pool candidate verification: **265/265** engine tests pass. The synthetic scheduler accepts
two distinct jobs, defers a third on exact native rejection and permits an explicit signed retry
after a slot is released; generic saturation errors remain unknown. Tests cover repeated rejection,
malformed task IDs, wrong/stale tokens, advanced workers, preserved plans/snapshots and deferred
notification failure. All engine syntax and ten SDF object XML well-formedness checks pass. An
independent read-only review reran 23 focused outcome/retry/race tests without a blocking finding.
The preceding `7f5d85c` candidate passed
[full CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34275862247).
Pool commit `abc171a` passed
[full CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34277508001).
Native deployment readback, mixed-role saturation tests and measured capacity remain required;
no NetSuite account was modified.

Orphan-adoption candidate verification: **280/280** engine tests pass, including 22 artifact tests
and 42 worker integration tests. Fault injection after physical save and before ledger commit
proves PART and CHUNK retries adopt the verified original file without another render or save.
Changed orphan bytes fail before rendering/publication. Tests cover authenticated WRITING rows,
revision ABA fencing, optimistic conflicts, candidate overflow, private access, exact file types,
large numeric IDs, legacy committed compatibility and retained files. Adoption is local evidence;
native search visibility, file types, conflict behavior and stage governance still need sandbox QA.
Drain older workers before rollout: older code does not understand WRITING rows or hashed PART
names. Unreserved legacy orphans, stale-intent files and surplus matching files remain retained.

Failure-selection verification: **291/291** engine tests pass, including nine new selection tests
and 44 worker integration tests. The Thai failure-details page validates the original snapshot,
exact plan/manifest partition, owner/role and terminal state; duplicate record IDs retain their
original positions. Tampered storage, inconsistent partitions and mid-read state changes fail
closed. Opening details performs no render or task submission. This slice established the read-only foundation; the linked-retry implementation is described below. The preceding `09f78a3` orphan candidate passed
[full CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34279116442).

Linked retry candidate: **314/314** engine tests pass, including 14 provisioning tests and 53
worker integration tests. Signed creation reservations survive interrupted saves/promotion/folder
binding, preserve legacy empty-key jobs and fence native key collisions. End-to-end tests produce
downloadable child PDFs from partial/all-failed selections with original template/copies and
repeated IDs, preserve original results, reuse one child on duplicate POSTs and support child chains.
Snapshot/task-preparation interruption, stale/wrong tokens, ambiguous submission claims, advanced
workers and inaccessible lineage are covered. Read-only review found no blocking defect and
requested the now-added lineage-negative regression. Native uniqueness, folder search visibility,
permissions, crash behavior and measured governance remain sandbox gates. Retention policy remains
unanswered; no PDF/snapshot retention deletion is enabled. The preceding `1020917` passed
[full CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34280259094).

Use these as task/objective text when assigning agents; they are not assumed CLI syntax.
Assign non-overlapping file ownership per task, preserve other agents' work, and return exact
tests/evidence plus unresolved risks. Primary owns generated integration and every connected action.

- `designer-implementer`: Complete #199 editing and Thai UX reliability under `designer/**`:
  save session identity, draft recovery, safe mutation behavior, accessible dialogs and preview
  parity. Verify focused component tests and relevant browser flows; no competing PDF generator.
- `engine-template-implementer`: Complete #199 caller authorization, private batch jobs,
  immutable queued template versions, restart recovery and bounded processing under `engine/**`.
  Prove negative permission and failure paths locally; hand connected validation to primary.
- `engine-template-implementer` (separate assignment): Own only `templates/**` for any defects
  proven by live parity QA. Preserve null-safe escaped FreeMarker and File Cabinet Thai fonts.
- `pdf-parity-reviewer`: Independently review candidate diff and evidence for data leakage,
  BFO/Thai correctness, complete batches and gaps between local assertions and live behavior.
  Read-only; do not approve production based on stubs.
- Primary: Close deployment provenance, CI, dependency triage and performance measurements,
  run authorized sandbox QA, publish reviewable PRs, and keep the full goal active until every
  acceptance item has authoritative evidence.
