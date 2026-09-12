<!-- @author Wichit Wongta -->
<!-- @since 2026-08-21 -->

# Repository agent instructions

This repository contains the PDF engine, canonical BFO template pack, and Lit designer described
in `CLAUDE.md`. Keep those layers distinct when splitting work across agents.

## Start here

- Read `CLAUDE.md` and `docs/architecture/OVERVIEW.md`, then inspect only the relevant layer.
- Inspect the working tree before editing and preserve unrelated user changes.
- Treat `templates/master/` as the template source of truth and
  `designer/src/services/bfo-export.service.ts` as the only BFO generator.

## Repository invariants

- BFO through `N/render` is the single server render path. Do not add a competing generator or a
  fallback that returns an empty or divergent PDF.
- Keep every FreeMarker binding null-safe and use FreeMarker syntax, not JavaScript ternaries.
- Server Thai fonts come from File Cabinet font links; do not assume host fonts exist.
- Never commit real customer data, credentials, `.env`, `.qa-profiles/`, or a real SuiteCloud authid.
- Samples and QA evidence use synthetic or redacted Internal data.
- New or substantially rewritten source files follow the authorship rule in `CLAUDE.md`.

## Change workflow

- Follow the issue, branch, PR, and squash flow in `CONTRIBUTING.md`. Do not create external state
  unless the user asks for it.
- Assign a writing agent one layer and an explicit file set. Do not edit generated artifacts by
  hand or let designer and engine/template agents overlap.
- Run `python scripts/validate-ai-workspace.py` after changing agents or skills.
- Connected NetSuite validation, deploy, render, and browser QA require explicit sandbox intent and
  stay with the primary agent.

## Multi-agent coordination

- `pdf-explorer` maps data flow, template ownership, and affected tests without editing.
- `designer-implementer` owns an explicitly assigned change under `designer/**`.
- `engine-template-implementer` owns either `engine/**` or `templates/**` for one assignment, never
  both unless the primary agent establishes a non-overlapping integration plan.
- `pdf-parity-reviewer` independently reviews BFO/FreeMarker correctness, security, data leakage,
  render parity, and missing tests without editing.
- The primary agent owns generated-output integration and every live SuiteCloud/browser action.

Codex discovers profiles in `.codex/agents/`; Claude Code discovers matching profiles in
`.claude/agents/`.

## Skills and validation

Use `pdf-template-delivery` only for connected sandbox delivery, render-parity QA, or diagnosis of
a failed validate/deploy/render path. It is not the default procedure for ordinary local edits.

Run the checks relevant to the changed layer:

```sh
bash scripts/secret-scan.sh
bash scripts/validate-templates.sh
node --check engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/*.js
node --test "engine/tests/**/*.test.js"
cd designer && npm ci && npm run lint && npm test -- --run && npm run build
```

Run designer E2E and live NetSuite checks only when their environment and authorization are present.
