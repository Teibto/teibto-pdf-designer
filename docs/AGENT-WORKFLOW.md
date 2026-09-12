<!-- @author Wichit Wongta -->
<!-- @since 2026-09-13 -->

# AI agent workflow

This is the shared execution contract for AI agents working in this repository. Architecture and
product rules remain in `CLAUDE.md` and `docs/architecture/OVERVIEW.md`; connected NetSuite delivery
details remain in the [`pdf-template-delivery`](../.claude/skills/pdf-template-delivery/SKILL.md)
skill.

## Preserve the task and evidence

- Carry the user's full goal, accepted corrections, constraints, and unfinished work across handoffs
  and context compaction. Do not restart or silently narrow the outcome.
- Inspect the working tree first. Use the issue-numbered branch and worktree selected for the task,
  and preserve unrelated or concurrent changes. Do not edit generated artifacts by hand.
- Define success as observable behavior. A plan, implementation intent, passing unrelated tests, a
  screenshot of the wrong surface, or an uninspected command status is not completion.
- Keep real account source, customer data, private URLs, logs, PDFs, credentials, active browser
  target IDs, and record IDs in private local evidence. Repository fixtures and reports must be
  synthetic or redacted.

## Assign work by layer

Use multiple agents only when the user or repository workflow authorizes it and independent work
will reduce risk or elapsed time. Assign each writing agent one layer, explicit files, and an output
contract. Never overlap Designer ownership with engine/template ownership. The primary agent owns
generated-output integration and all SuiteCloud, browser, deploy, and other live actions.

Choose agent capability in proportion to the work: bounded mapping can use an inexpensive explorer,
and a separate read-only pass can review a finished candidate. Complex BFO/FreeMarker or financial
implementation needs stronger implementation reasoning. Inherit the session's default model unless
an explicit model choice is authorized; do not encode temporary model names, prices, or rankings in
repository instructions.

Trust a completed explorer map and inspect further only where implementation or new evidence needs
it. This avoids spending tokens on duplicate repository discovery. An independent reviewer should
challenge the completed candidate without editing it.

## Authority and stopping conditions

Repository implementation authorization covers the normal issue/worktree/branch/PR flow described
by `AGENTS.md` and `CONTRIBUTING.md`. Existing authorization persists for the scope in which it was
given. A skill supplies procedure and does not create new authority, but it should not trigger broad
repeat confirmation either.

Ask only for a real missing gate such as production mutation, force-push/history rewrite, deletion
of unmerged work, secrets/access, billing, external communication, or a material scope expansion.
If sandbox or host auto-review rejects an action, state the exact action and reason. Retry only when
the existing authorization and evidence support a compliant lower-risk request, and provide that
evidence once. Otherwise complete safe local work and ask for the exact permission or scope still
required.

## Handoff contract

Every delegated result or final handoff states, concisely:

- task and source owner;
- inputs and assumptions used;
- files or private artifact identities produced;
- tests or live checks run with exact outcomes;
- remaining risks, failures, or missing authorization.

The primary agent verifies integration and does not report success until the evidence satisfies the
user's acceptance criteria.
