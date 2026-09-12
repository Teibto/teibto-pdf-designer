# Issue 203 — MCP / CLI verification

<!-- @author Wichit Wongta @since 2026-09-13 -->

Status: local and connected synthetic PDF acceptance passed; self-hosted CI passed.
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

## Connected acceptance — passed (2026-09-13)

The user explicitly confirmed SB2 `4089685_SB2` with synthetic data. The shared
registry reported a running browser with matching binding. One task-owned tab
was claimed using the coordinator and navigated to the designer. The CLI's
authenticated status reported account `4089685_SB2`, environment `SANDBOX`, role 3.
No template or transaction was saved, no engine was deployed, and no other
worker's tab, login, role or preferences were changed.

- [x] Confirm SB2 `4089685_SB2` and synthetic render intent.
- [x] Check shared registry; claim one owned target and verify designer context.
- [x] Execute CLI render with two copies and verify returned bytes/hash.
- [x] Execute `node automation/scripts/live-smoke.mjs` (real MCP `pdf_render`).
- [x] Parse both PDFs and inspect rendered pages: Thai glyphs, content, layout,
  page numbering and Original/Copy labels. Compare CLI and MCP meaningful output.
- [x] Verify all six advertised templates produce usable synthetic PDFs.
- [x] Verify failure output: local session/response rejection tests plus live invalid
  deployment response returned exit 1 and produced no final PDF. The valid
  session remained ready afterward. Shared-session logout/role changes were not tested.
- [x] Connect the local server to the user's AI client and verify tool discovery.
- [x] Record artifact hashes and results; preserve PDF/account branding locally.

Each of the six CLI PDFs contains two pages: Original and Copy 1, with synthetic
`SAMPLE-` document identifiers. Embedded fonts are THSarabunPSK regular and bold.
Primary visual review covered every original and invoice copy; an independent
reviewer inspected the other five copies. No visible glyph loss, clipping, table,
signature or footer defects were found. Page numbering resets per copy as
expected. These are short sample documents; long-table pagination is not claimed.

Invoice PDF generation also passed through the real MCP SDK client and a fresh
Codex AI client calling `pdf_render` once with
`{"template":"invoice","outputName":"invoice-ai-sb2.pdf","copies":2}`.
CLI, SDK and AI outputs each contain 105,868 bytes. File hashes differ, but rendered
pixel SHA-256 values are identical for both pages across all three paths.
The AI invocation reported successful tool completion and exited 0.

Machine-readable artifact identities and per-page hashes are in
[`203-mcp-artifacts.json`](203-mcp-artifacts.json). PDF/PNG files remain in the
gitignored `automation/output/` directory. They were not committed or uploaded.

Mock transport byte fixtures are not evidence of BFO rendering; the connected
checks above use actual N/render output. Optional actual-record mode has local
contract/gate tests only; no real record ID was used in the live test.

## Actual AI-client connection (2026-09-13)

Registered `teibto_pdf` in the user's Codex MCP configuration using the tested
Node executable and this issue's worktree server. After sandbox confirmation,
configuration was updated with the confirmed account and the task-owned designer
target. Tool timeout is 180 seconds. Record mode remains disabled. No credentials
were stored in the repository.

A fresh `codex exec --ephemeral --sandbox read-only --json` client discovered
the registered tool and called `teibto_pdf.pdf_list_templates` exactly once with
`{}`. The observed MCP event completed successfully with all six IDs:
`delivery-note`, `invoice`, `purchase-order`, `quotation`, `receipt`, `tax-invoice`.
The client made no shell, browser, status, render or other MCP calls. It exited 0.
This proves actual AI-host discovery and invocation, in addition to the SDK
subprocess tests. It does not prove authenticated PDF rendering.

Keep the issue worktree while its server path is registered. After merge, repoint
the registration to the final checkout and verify it before removing the worktree.
Restart/reconnect clients to load the updated server configuration. The owned
designer tab is intentionally retained for the delivered MCP connection; do not
close it while using the server. A browser restart/lost target requires claiming
a fresh owned tab through the coordinator and updating the registration.

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

## CI runner migration

[Actions run 34709444618](https://github.com/Teibto/teibto-pdf-designer/actions/runs/34709444618)
failed before any job steps started. Its check annotation says account payments
failed or the spending limit must be increased. This is not a test result; no CI
checks executed on that GitHub-hosted run. The user clarified that the team now
uses Teibto dev-tools self-hosted runners. The organization exposes online Linux
ARM64 runners with the `teibto-devtools` label; its Default group allows this
private repository.

The workflow now targets `[self-hosted, Linux, teibto-devtools]`, uses the central
template's architecture-aware per-job gitleaks install, and installs Playwright
browsers per job without changing runner system packages. All existing quality
checks remain enabled. Run `34710145857` started on `teibto-devtools-3`, proving
actual routing beyond the old billing failure. That run completed successfully,
including both secret scans, shellcheck, template validation, all engine tests,
MCP protocol/service tests, designer lint/unit tests and Playwright E2E.
No billing settings or runner registrations were changed by this task.
