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

The BFO export modal opens in Canonical XML mode; exact live export-text comparison was not completed. Source passthrough is covered by local contract tests. After the completed save/reload/restore run, a supplementary read returned HTML rather than JSON and was not counted as additional evidence.
