# Connected sandbox delivery

## Candidate and baseline

Read the target account before overlaying files. A sandbox may be newer than `main`; match its live
source/version manifest first and integrate the corresponding repository baseline so a targeted
change does not remove already-deployed safeguards.

Prepare a private local rollback bundle before deployment. It is complete only when its version
manifest and every affected asset hash match the live account. Keep live source, URLs, logs, PDFs,
IDs, and account data outside version control in a private external or explicitly ignored local
directory; committed evidence is synthetic or redacted.

Build the canonical NetSuite bundle through the repository's provenance flow. Stage, seal, and stamp
generated output with source and asset digests, then verify the digest of the JavaScript actually
served by NetSuite. Do not hand-edit generated `dist` files, deployment stamps, or staged artifacts.

## SDF validation and deploy

- A minimal SDF project still needs an `Objects` directory plus this deploy scope, even when it has
  no object files:

  ```xml
  <objects>
    <path>~/Objects/*</path>
  </objects>
  ```

- Run server validation before deploy. Inspect the semantic command output as well as the exit code;
  SuiteCloud can exit zero while printing validation failure text.
- After deploy, inspect the exact deploy log and read back version data, file attributes, and hashes.
  Do not infer success from a submission message.
- Exercise the saved-template and normal print routes through the shared `N/render` core. Check
  endpoint bodies because HTTP 200 can carry a structured JSON error.

## Shared browser coordinator

Follow the current user-selected shared-session instructions (including applicable user/global
`AGENTS.md` instructions) and read the coordinator README
before browser QA. Start with registry status, claim one owned tab for the run, and preserve that
exact target ID for later commands. Use the coordinator's login recovery only.

Verify native clicks by the resulting UI state. The tested coordinator's `@ref` click path reads
the node's box without scrolling it into view, even though its CSS-selector path does scroll.
For a card inside a scrollable dialog, explicitly scroll that visible UI element into view, then
click its current reference and assert the intended result. A successful command alone does not
prove the click reached the control; do not silently substitute a DOM `.click()` as clickability
evidence. Bring the owned tab to the foreground when diagnosing input that did not land.

Never kill or restart the shared browser, log out, change roles or preferences, close another
worker's tab, copy cookies, or create a second profile to bypass session errors. Close only the tab
owned by this run. Reusable commands and evidence must not contain active target IDs, record IDs,
credentials, private URLs, or unredacted customer values.

## Authorization and host review

The skill is a procedure, not authorization. Use authorization already established for the exact
sandbox workflow and do not repeatedly ask for it. If sandbox or host auto-review rejects an action,
provide the existing authorization and low-risk target evidence once when that evidence is valid.
Otherwise report the rejected action and reason, finish safe local work, and ask for the exact
missing scope; do not bypass the control.
