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
| P1 | All-role Suitelets execute as Administrator | Open release blocker. Establish caller transaction/subsidiary permissions for render, record data, live preview and batch. Do not assume an editor role check protects reads. |
| P1 | Shared batch folder exposes job JSON/XML and other users' output | Open release blocker. Persistent requester ownership, private staging, authorized download and retention cleanup required. Test two users and direct URLs. |
| P1 | Batch input/merge errors skip cleanup and notification | Local hardening underway; inject input, part-load, merge, save and notification failures. Abrupt termination/orphan recovery remains open. |
| P2 | Repeated transaction reads per copy | Implemented request-local frozen snapshot; copy titles/labels remain independent. Measure real governance and latency before capacity claims. |
| P2 | Queue reads mutable templates | Open. Freeze XML/copy configuration at enqueue; changing default/template during processing must not mix versions. |
| P2 | Unbounded batch merge | Local 500-document / 8 MiB resolved UTF-8 XML rejection guard. This is a safety bound, not evidence 500 documents fit or complete. Chunked output/job recovery design and live capacity evidence remain required. |
| P2 | Modal accessibility / keyboard-only workflows | Open. Dialog semantics, focus trap/restore, nested Escape handling; validate Thai input and keyboard navigation in a browser. |
| P2 | Save dialog metadata/draft consistency | Open. Quick-save coerces omitted default flag to false; dialog save bypasses app-shell draft cleanup. Preserve default/record type on quick-save and share session-aware draft acknowledgement across save entrypoints. |
| P2 | Dependency security | Open. Initial npm audit: 20 total findings; production-only audit: one high nanoid finding. Triage exact installed versions, call paths and supported fixes. |
| P2 | Build / deployment provenance | Removed obsolete jsPDF manual chunk that broke normal build. Open: CI production builds, artifact manifest/hash, dirty staged/untracked detection and safe --no-build reuse. Coordinate existing CI PR #198. |
| P2 | Startup size and large-designer interaction | NetSuite bundle baseline approximately 1.235 MB / 335 KB gzip. Profile startup, large tables, drag/edit/undo and pagination before choosing an optimization. |

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

2026-09-09 candidate evidence: engine **145/145**, designer **614/614**, Chromium E2E **83/83**,
six templates and six samples valid, lint **0 errors / 35 warnings**, both production build modes
passed, secret scan passed. Independent agents reviewed render/batch and save/session changes;
identified batch cleanup/link-recovery defects were fixed and regression tested. No live NetSuite
validation, deployment or PDF inspection has run for this candidate.

Run from repository root unless a command starts with `cd designer`:

```sh
node --test "engine/tests/**/*.test.js"
bash scripts/validate-templates.sh
bash scripts/secret-scan.sh
cd designer
npm ci
npm run lint
npm test -- --run
npm run build
npm run build:netsuite
npx playwright test --workers=2 --reporter=line
```

Windows restricted process environments may require approved child-process execution. Engine tests
can use `node --test --test-isolation=none "engine/tests/**/*.test.js"`. On this workstation the
`python3` Store alias is broken; the validator passed using a shell function forwarding `python3`
to the installed `python`, without modifying the validator.

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
