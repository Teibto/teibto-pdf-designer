# Issue 203 — MCP / CLI verification

<!-- @author Wichit Wongta @since 2026-09-13 -->

Status: local implementation verified; connected PDF acceptance remains pending.
Draft PR: https://github.com/Teibto/teibto-pdf-designer/pull/204

## Implemented acceptance scope

- Local MCP stdio server using the official SDK and matching CLI.
- Six canonical XML templates with record type metadata read from source.
- Existing NetSuite `preview-live` / `N/render` path, synthetic by default.
- Optional sandbox record mode requires operator configuration.
- Registered coordinator, owned tab and account/environment/role checks.
- Bounded PDF response, sanitized failures, output name validation and atomic,
  exclusive publication without overwriting existing files.
- Setup, operations, limitations and delivery plan in `docs/MCP-CLI.md`.
- Parallel interface/transport implementation and independent read-only review.

## Executed local checks (2026-09-13)

| Check | Result | What it proves |
| --- | --- | --- |
| `npm test --prefix automation` | PASS: 18 tests | Real MCP/CLI subprocess protocol, catalog, input gates, authenticated status probe, browser function under VM, PDF bounds, queue, output and failure cleanup |
| `node --test engine/tests/render-suitelet.test.js engine/tests/sample-data.test.js` | PASS: 24 tests | Existing Suitelet/sample/copy contracts under NetSuite stubs |
| `bash scripts/validate-templates.sh` | PASS: 6 XML + 6 sample files | Existing canonical template syntax and binding contract |
| `bash scripts/secret-scan.sh` | PASS | Working tree and staged snapshot at scan time |
| `node --check automation/scripts/live-smoke.mjs` | PASS | Live client script syntax only |
| `git diff --check` | PASS | Patch whitespace |

On this Windows host, subprocess tests and Git Bash require sandbox execution
approval because the default sandbox reports `spawn EPERM` / mapping errors.
The approved runs passed. Template validation used the installed Python 3.12
through a shell `python3` function because the host's `python3` alias points at
the Microsoft Store. No validation scripts were changed.

The initial secret scan flagged five patterns in downloaded npm cache content.
That generated cache was moved outside the worktree and the canonical scan
passed without a suppression or rule change. Dependency audit at installation
reported zero vulnerabilities.

## Connected acceptance — not yet executed

User confirmation of the exact sandbox account is pending. No account records,
templates, shared browser tabs or session state were changed for this work.

- [ ] Confirm SB2 `4089685_SB2` and synthetic render intent.
- [ ] Check shared registry; claim one owned target and verify designer context.
- [ ] Execute CLI render with two copies and verify returned bytes/hash.
- [ ] Execute `node automation/scripts/live-smoke.mjs` (real MCP `pdf_render`).
- [ ] Parse both PDFs and inspect rendered pages: Thai glyphs, content, layout,
  page numbering and Original/Copy labels. Compare CLI and MCP meaningful output.
- [ ] Verify all six advertised templates produce usable synthetic PDFs.
- [ ] Confirm session/permission failures do not produce a successful artifact.
- [x] Connect the local server to the user's AI client and verify tool discovery.
- [ ] Record redacted artifact identities and results; preserve company data locally.

Mock transport byte fixtures are deliberately not valid deliverable PDFs and do
not prove BFO output. Optional actual-record mode has local contract/gate tests;
no real record ID is authorized as a live QA target in this task yet.

## Actual AI-client connection (2026-09-13)

Registered `teibto_pdf` in the user's Codex MCP configuration using the tested
Node executable and this issue's worktree server. Configuration contains only
the coordinator and local output paths; account and owned target remain unset
pending sandbox confirmation. No credentials were stored in the repository.

A fresh `codex exec --ephemeral --sandbox read-only --json` client discovered
the registered tool and called `teibto_pdf.pdf_list_templates` exactly once with
`{}`. The observed MCP event completed successfully with all six IDs:
`delivery-note`, `invoice`, `purchase-order`, `quotation`, `receipt`, `tax-invoice`.
The client made no shell, browser, status, render or other MCP calls. It exited 0.
This proves actual AI-host discovery and invocation, in addition to the SDK
subprocess tests. It does not prove authenticated PDF rendering.

Keep the issue worktree while its server path is registered. After merge, repoint
the registration to the final checkout and verify it before removing the worktree.
Restart/reconnect clients to load the newly registered server. Complete the
account/target configuration and live render acceptance after sandbox confirmation.

## Review

Independent review identified early final-file visibility on interruption and a
schema mismatch. The implementation now uses atomic hard-link publication from
a private temporary file, and MCP validation matches the service. The failure
and concurrent-writer tests verify these corrections.
Final review also identified cached-page status and post-publication cleanup
ambiguity. Status now makes an authenticated, bounded `action=version` request;
cleanup failure after publication returns success with a cleanup warning.

Connected acceptance, CI and repository review protection must be recorded
separately; local checks are not a release or production sign-off.

## CI infrastructure blocker

[Actions run 34709444618](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34709444618)
failed before any job steps started. Its check annotation says account payments
failed or the spending limit must be increased. This is not a test result; no CI
checks executed. The repository billing administrator must resolve the account
condition before rerunning. No billing settings were changed by this task.
