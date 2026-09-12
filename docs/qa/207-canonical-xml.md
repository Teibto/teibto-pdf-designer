<!-- @author Wichit Wongta -->
<!-- @since 2026-09-13 -->

# Canonical XML Designer acceptance

Candidate implementation: `8969fd5`. Connected checks used the explicitly authorized sandbox and an owned shared-coordinator browser tab. Private account records, screenshots, responses, and deployment logs remain in local evidence and are not committed.

## Local and CI validation

- Full Designer suite before the final two fidelity fixes: 63 files / 839 tests passed.
- Focused fidelity regressions after those fixes: 12 tests passed, including CRLF preservation and empty raw draft recovery.
- Lint: zero errors; 31 existing warnings. TypeScript, standard build, and NetSuite build passed.
- CI functional browser suite: 121 tests passed. Cold-start performance gate remains failed: 103 ms against a limit below 100 ms. The preceding Designer baseline also failed at 108 ms and 125 ms. This is an unresolved gate, not a passing release claim.

## Connected deployment and acceptance

A minimal overlay deployed only the generated application JavaScript, build manifest, and version stamp after successful semantic server validation. Rollback assets were matched to the previously served manifest. The served application SHA-256 matched the built candidate:

`9f1643a889131f6f27fdf90299436881c71cf8f14f8abdd48ff754bdd3d1afb3`

The live browser run verified:

1. Loading an XML-only saved reference opens Canonical XML mode with no invented visual elements.
2. Native textarea input changes the source and displays Unsaved state.
3. Preview renders the edited remark through BFO with the logo, real bindings, correct settlement amount, and Original/Copy pages.
4. Save reaches Saved state. Read-back XML exactly matches the submitted source; Designer data stays empty and the template stays non-default.
5. A full page reload and loading the template again preserves the complete edited source (14,874 characters; one temporary marker).
6. Removing the marker with native keyboard input and saving restores the canonical source. Read-back confirms no marker, no Designer JSON, and no default-template change.

Native Long Text storage removes the final newline after the closing PDF tag. Every preceding character matched. This storage normalization is recorded separately from editor fidelity.

The BFO export modal's complete source was subsequently compared with fresh saved-template read-back: all 14,863 characters match, no test marker remains, Designer data is empty, and the template remains non-default. A supplementary read initially returned HTML rather than JSON; the shared coordinator recovered the session, and the repeated semantic check passed. The export modal was closed, leaving the restored source open in Designer.

## Cold-start correction

The CI trace attributes the long task primarily to the initial style/layout pass together with module evaluation. The workspace now mounts in a second task after shell chrome. `updateComplete` still waits for the complete workspace, and readiness measurement still includes fonts and subsequent paints. No timing budget was increased and no work was excluded from measurement.

Local production performance passed 20 cold and 30 warm runs: cold app-ready p95 369.4 ms, maximum 375.6 ms, and maximum long task/TBT zero for both sets. Full unit/component tests passed 63 files / 842 tests before the final reconnect edge fix; the final focused lifecycle suite passed 5/5. Related browser E2E passed 24/24. Build and lint passed (31 existing lint warnings). The final candidate still requires its CI and connected bundle verification.
