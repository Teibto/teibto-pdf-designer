---
name: pdf-template-delivery
description: Prepare, run, or diagnose connected NetSuite sandbox validation and render-parity QA for this PDF engine and template pack. Use for validate, deploy, render, or save-parity work; do not use for ordinary local implementation or unit tests.
---

# PDF template delivery

Use this workflow only when the requested outcome depends on a connected NetSuite sandbox or on
proving parity between canonical template XML, generated BFO, and server rendering.

1. Read `AGENTS.md`, `CLAUDE.md`, and the relevant architecture and deployment documentation.
2. Identify the source of truth and affected layer. Confirm that no competing BFO generator or
   render path is being introduced.
3. Run local secret scan, template validation, engine checks, and designer lint/tests/build as
   applicable. Stop on failure; do not replace unavailable validation with a pass.
4. Before using SuiteCloud, a browser session, or account data, confirm explicit sandbox intent,
   exact account, synthetic/redacted test data, expected side effects, and rollback or cleanup.
5. Validate before deploy. After deploy, exercise the real `N/render` path and compare meaningful
   content, Thai fonts, pagination, and failure behavior rather than checking only for a PDF file.
6. When designer save/export is in scope, verify that saved output still comes from the canonical
   generator and matches server rendering. Do not hand-edit customer-account templates.
7. Return commands, artifact identities, redacted evidence, observed gaps, and a clear pass, fail,
   or blocked result. Keep production deployment outside this skill unless separately authorized.
