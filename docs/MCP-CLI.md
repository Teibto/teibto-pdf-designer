# PDF automation through MCP and CLI

<!-- @author Wichit Wongta @since 2026-09-13 -->

Issue #203 adds a local automation adapter for the existing NetSuite PDF product.
AI clients use MCP tools; operators use a CLI. Both read canonical XML from
`templates/master/` and call the deployed render Suitelet. PDF generation remains
in `pld_lib_render.js` through `N/render`; no new generator or server deployment is required.

## Delivery plan and boundaries

1. Isolate the change from ongoing designer work in an issue-numbered worktree.
2. Build a shared service, MCP stdio/CLI interfaces and registered-session transport
   in parallel with non-overlapping file ownership.
3. Verify the protocol using a real SDK client subprocess; test account checks,
   response validation, output confinement, copy handling and failure cleanup.
4. Confirm the sandbox account, claim an owned browser target, render synthetic
   documents using both CLI and MCP, inspect Thai text/layout/copies and record evidence.
5. Independently review, run repository gates and open a PR. Merge remains subject
   to repository review protection. Production deployment is a separate decision.

This release supports attended **sandbox** use through the machine's registered
NetSuite session. It does not expose an HTTP listener. Production accounts are rejected.
Unattended/fleet use needs a separately designed authenticated server transport,
least-privilege integration role, durable job limits and account-level audit logging;
the browser session is not an unattended service credential.

## Install and configure

Requirements: Node.js 22.12+ (24 LTS recommended), Python and PowerShell on Windows,
the tested shared coordinator installed beside `cdp.py`, and a deployed designer/render
Suitelet with configured File Cabinet Thai fonts. Run from the repository checkout:

```powershell
npm ci --prefix automation
node automation/src/cli.mjs templates
node automation/src/cli.mjs --help
```

Read `C:\Users\wichi\.teibto\ns-qa\README.md` before using the shared session.
Confirm the sandbox account and authorized data with the operator first. For the
registered SB2 lane:

```powershell
$qa = 'C:\Users\wichi\.teibto\ns-qa\ns-qa.ps1'
& $qa -Action status -Account 4089685_SB2
$ownedTarget = & $qa -Action tab -Account 4089685_SB2
if ($LASTEXITCODE -ne 0) { throw 'Cannot claim tab' }
$ownedTarget = $ownedTarget.Trim()
# Navigate only this owned tab to the deployed designer Suitelet URL.
# Obtain the exact deployment URL from the account administrator/deployment record.
& $qa -Action command -Account 4089685_SB2 -TargetId $ownedTarget -CommandArgs @('nav', $designerUrl)
$env:PLD_ACCOUNT = '4089685_SB2'
$env:PLD_TARGET_ID = $ownedTarget
$env:PLD_COORDINATOR = $qa
$env:PLD_OUTPUT_DIR = Join-Path (Get-Location) 'automation/output'
node automation/src/cli.mjs status
```

`PLD_RENDER_URL` is optional: normally the verified designer page supplies
`__NS_RENDER_URL__`. An override must still be a same-origin Suitelet URL.
The adapter checks registry binding and the designer's account/environment/role
before every render. `status` also makes a bounded authenticated `action=version`
request so cached page context cannot mask a login page. It never claims tabs, logs in, changes role, copies cookies,
or restarts Chrome. If the owned tab is lost, claim a new one and update configuration.
Session recovery uses the coordinator's `-Action login`, under its shared lock.
Close only your owned tab when the client has finished; never close others' tabs.

## CLI operations

```powershell
node automation/src/cli.mjs templates
node automation/src/cli.mjs status
node automation/src/cli.mjs render --template invoice --output invoice-sample.pdf --copies 2
```

Available IDs: `invoice`, `tax-invoice`, `quotation`, `purchase-order`, `receipt`,
`delivery-note`. Record types come from each master XML's `pld:rectype` marker.
Omitting `--record-id` uses engine-generated synthetic transaction data. Runtime
company configuration still supplies branding and fonts: inspect/redact artifacts
before sharing them, even when the transaction data is synthetic.

For an explicitly authorized **sandbox record**, the operator can enable the optional
record mode for that process. The adapter sends `recid` to the same `preview-live`
endpoint; it does not save or change the record/template:

```powershell
$env:PLD_ALLOW_RECORDS = 'true'
node automation/src/cli.mjs render --template invoice --record-id 123 --output authorized-invoice.pdf
Remove-Item Env:PLD_ALLOW_RECORDS
```

Replace `123` with a verified sandbox invoice ID; it is an example, not a QA target.
Record mode is disabled by default. Do not commit generated account documents.

Copies are explicitly 1 through 10 (default 1). The service supplies Original and
numbered Copy labels to the existing engine. Output is a basename ending in `.pdf`,
confined to the operator-configured directory. Existing files are never overwritten.
Success JSON contains path, byte count, SHA-256, template, type, mode, copies and account;
PDF bytes are not placed in the AI transcript. CLI failures exit nonzero.

## Connect an AI client

The server uses the official MCP SDK's stdio transport. Clients launch it directly
with Node (avoid `npm run`, whose banners can pollute protocol stdout).
See the [MCP SDK stdio documentation](https://ts.sdk.modelcontextprotocol.io/server)
and [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Example project `.codex/config.toml` for a trusted checkout, replacing paths and
the owned target with the exact values from your session:

```toml
[mcp_servers.teibto_pdf]
command = "node"
args = ['D:\path\to\repo\automation\src\mcp.mjs']
startup_timeout_sec = 15
tool_timeout_sec = 180

[mcp_servers.teibto_pdf.env]
PLD_ACCOUNT = "4089685_SB2"
PLD_TARGET_ID = "REPLACE_WITH_OWNED_TARGET_ID"
PLD_COORDINATOR = 'C:\Users\wichi\.teibto\ns-qa\ns-qa.ps1'
PLD_OUTPUT_DIR = 'D:\path\to\repo\automation\output'
```

Keep machine/session configuration local. Restart/reconnect the client after adding
the server. `codex mcp list` checks registration; it does not prove rendering works.
Other MCP hosts use the same command, args and environment values.

Tools:

| Tool | Input | Effect |
| --- | --- | --- |
| `pdf_list_templates` | `{}` | Read local canonical catalog; no session needed |
| `pdf_status` | `{}` | Verify registered sandbox and owned designer page |
| `pdf_render` | `template`, `outputName`, optional `copies`, `recordId` | Render and save one local PDF |

Example AI instruction: “List the PDF templates, check the sandbox session, then
create a synthetic invoice with two copies as `invoice-ai.pdf` and report its path.”
MCP errors return `isError: true`; do not interpret the presence of a text response as success.

## Verification and troubleshooting

```powershell
npm test --prefix automation
# Only after confirming the sandbox and configuring the owned session:
node automation/scripts/live-smoke.mjs
```

Protocol tests initialize an actual child MCP server and call its tools. Transport
tests mock only the coordinator boundary; service tests use clearly synthetic byte
fixtures, not evidence of real PDF rendering. Live checks are deliberately separate
from CI and require an authorized, configured sandbox session.

| Failure | Action |
| --- | --- |
| Missing config | Set account, owned target and absolute coordinator path |
| Registry/browser mismatch | Inspect shared registry; do not create a replacement profile |
| Wrong account or non-sandbox page | Navigate the owned target to the authorized designer |
| Session expired | Recover via the coordinator, then reopen the designer in the same target |
| Non-PDF/redirect/timeout | Inspect the authorized account's render logs and permissions; do not retry blindly |
| Existing output | Choose a new basename |
| Thai glyph/layout problem | Check File Cabinet font configuration and canonical XML; local tests cannot prove BFO layout |

The adapter bounds requests and PDF transfer (20 MiB), validates PDF framing and
sanitizes subprocess/HTML errors. It writes a private temporary file and publishes
the complete PDF using an atomic hard link without overwriting existing files.
Use a local filesystem that supports hard links (for example NTFS or ext4).
A process crash can leave a `.pld-*.partial` file for operator cleanup, but never a
partial PDF under the requested final name. Same-instance operations serialize browser access. Assign distinct
owned target IDs to distinct MCP server processes.
