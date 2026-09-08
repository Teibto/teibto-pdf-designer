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
| P1 | All-role Suitelets execute as Administrator | Candidate now explicitly clears role elevation in four deployments and disables anonymous Suitelet access. SDF/readback and restricted-user role matrix remain release blockers; no claim of runtime authorization based on XML tests. |
| P1 | Shared batch folder exposes job JSON/XML and other users' output | Local candidate adds durable requester/role/owner identity, per-job private folder readback and job-authorized download. Native record/file permissions, direct URLs, weaker-role access and retention remain release blockers; local stubs cannot establish account privacy. |
| P1 | Batch input/merge errors skip cleanup and notification | Durable job tracking and injected failure tests implemented, including corrupt snapshots and terminal commit failure. Failed jobs retain private recovery inputs; successful commits precede cleanup. Abrupt termination/orphan recovery and retention remain open. |
| P1 | Accepted queue task reported as rejected after metadata failure | Enqueue now separates pre-submit failure cleanup from accepted-task warnings. Once submit returns, preserve snapshot/status and show job tracking even when saving task ID or resolving the link fails. Fresh folder identity/privacy validation precedes snapshot save. Local failure injections pass; connected task/role behavior remains required. |
| P2 | Repeated transaction reads per copy | Implemented request-local frozen snapshot; copy titles/labels remain independent. Measure real governance and latency before capacity claims. |
| P2 | Queue reads mutable templates | Schema v4 authenticates job state, enqueue snapshots, XML parts and PDF result bytes with an account-restricted HMAC key. Rejects unsigned/tampered artifacts; preserves immutable template selection and guarded download bytes. Bounds remain 1,000,000 XML characters / 8 MiB job and resolved XML; PDF verification adds a 10 MiB local guard. Native secret/script access and historical/replay policy remain live gates. |
| P2 | Unbounded batch merge | Local 500-document / 8 MiB resolved UTF-8 XML guard, plus shared 20-copy limit before render work. These are safety bounds, not capacity evidence. Chunked output/job recovery design and live measurements remain required. |
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

Round-three local evidence: **175/175** engine tests, **631/631** designer unit tests,
**87/87** Chromium tests and **6/6**
build-provenance tests. Full dependency audit is zero (including development dependencies).
Storybook still exports 12 stories from the six existing story files. Current local logs include
`designer/.unit-final.log`, `.e2e-toolchain.log` and `.build-netsuite-final.log` (ignored).
The dependency findings recorded in earlier rounds were resolved; they are not current blockers.

The synthetic row-mode pagination probe covers 100/1,000/10,000 Thai rows with complete,
non-overlapping slices (4/40/400 pages) and 1,000 identical cache hits per fixture. One local Node
run measured cold computation 0.664/0.203/0.625 ms and all 1,000 cache hits 0.465/0.271/0.287 ms.
These small timings verify the local cache path only: there is no wall-clock pass threshold,
browser rendering measurement, BFO glyph inspection or NetSuite throughput claim.

Batch schema v4 requires authenticated durable job records and snapshots. Drain old tasks
before upgrade and resubmit legacy requests. Job result/count persistence precedes temporary-file
cleanup; failed merges retain private inputs for operator recovery. Automatic recovery, deployment
pool scheduling, chunked output, retention and permission-revocation behavior remain open.
Custom fields remain editable through authorized native APIs; their authenticated envelopes now
detect forgery using a script-restricted API secret. Part/result verification covers the actual
bytes passed to BFO or streamed to the caller, including post-save substitution tests. Native
historical file access, replay of old authentic state and secret/script restrictions still require
account tests and policy decisions. No local implementation establishes production readiness.

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

The next persistence, merge-phase, authentication and recovery contracts are documented in
[Batch reliability](architecture/BATCH-RELIABILITY.md). Signing and byte verification are implemented
locally; chunking/recovery remain planned work. The enqueue candidate `9fcc8c3` passed
[CI](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34269318029); signing additions require
their own full checks and account evidence.

Schema v4 local verification: **201/201** engine tests, including real Node crypto adapters,
native field/snapshot/part/result tampering, post-save PDF substitution, missing secrets and
optimistic-write conflicts. All engine syntax checks and six template/sample checks pass.
The same verified XML string reaches BFO; guarded download creates a new file from verified PDF
bytes. These tests do not prove API-secret script restrictions, native role behavior or NetSuite
crypto/file APIs. Secret denial after saving a part can retain a private orphan until the planned
recovery/retention implementation handles it.

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
