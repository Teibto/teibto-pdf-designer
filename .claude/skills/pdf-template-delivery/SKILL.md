---
name: pdf-template-delivery
description: Prepare, run, or diagnose connected NetSuite sandbox validation and render-parity QA for this PDF engine and template pack. Use for validate, deploy, render, or save-parity work; do not use for ordinary local implementation or unit tests.
---

# PDF template delivery

Use this workflow only when the outcome depends on a connected NetSuite sandbox or on proving
parity between canonical XML, saved templates, and server-rendered PDFs.

1. Read `AGENTS.md`, `CLAUDE.md`, `docs/AGENT-WORKFLOW.md`, and the relevant architecture or
   deployment document. Establish the candidate source, source owner, affected layer, target
   account, acceptance checks, side effects, and rollback before any live mutation.
2. Treat existing authorization in the conversation as valid for its stated scope. This procedure
   does not grant broader access, but it also does not require a broad confirmation when sandbox
   intent, target, and side effects are already clear. Keep production mutation separately gated.
3. Run the smallest meaningful local gate first, then the complete checks for each changed layer.
   A missing or failed check remains missing or failed; intent, an unrelated screenshot, or another
   passing test does not replace it.
4. Keep every SuiteCloud, browser, account-data, and generated-output integration action with the
   primary agent. Validate before deploy, use synthetic or redacted data, and preserve private live
   artifacts outside the repository.
5. Judge commands and endpoints by semantic output. HTTP 200 can contain a JSON error, and a
   zero-exit SuiteCloud command can print a validation failure. Inspect response bodies, command
   text, deployed/read-back digests, rendered content, and failure behavior.
6. Return the candidate identity, exact checks and results, redacted artifact identities, observed
   gaps, rollback state, and a pass, fail, or blocked result.

Read only the reference needed for the requested mode:

- For canonical/raw XML, exact-reference layouts, financial bindings, geometry, or multipage/copy
  parity, read [references/template-parity.md](references/template-parity.md).
- For SDF validation/deploy, baseline matching, provenance, rollback, or shared-browser operation,
  read [references/connected-sandbox.md](references/connected-sandbox.md).
