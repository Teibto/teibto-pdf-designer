# Batch reliability and scale — implementation contract

<!-- @author Wichit Wongta -->
<!-- @since 2026-09-09 -->

Issue #199 remains open. Schema v5 implements authenticated PART/CHUNK publication, per-document
rendering, metadata-only planning/finalization, a separate bounded merge reduce phase and guarded
PDF-byte downloads. Owner-triggered merge recovery verifies the prior task is terminal and claims
the job atomically. These are local implementations, not native-account security or capacity proof.
Owner-triggered render recovery before plan publication is implemented locally. Recovery after
an immutable plan is sealed, orphan adoption, age-based retention and deployment pools remain unfinished.
Owner-triggered cleanup of published XML inputs is bounded and implemented locally.

## Enqueue acceptance boundary

The boundary is the return of a task ID from `task.submit()`. Before that return, failures should
mark the caller-owned durable job FAILED when possible and clean only verified private files.
After that return, failures while recording the task ID must preserve the accepted job and its
snapshot. Show its tracking reference and a warning; do not describe the request as rejected,
delete worker inputs or encourage a second submission. A failed cleanup/state update must not
hide the original failure. Account-level loss of record access can prevent persisting FAILED;
retain a structured log for operator reconciliation instead of inventing a successful transition.

## Trust boundaries

The Suitelet and worker execute with the caller's identity and permissions. Every read/write
continues to validate exact requester, role and native owner, plus private folder owner/parent
and offline file state. The same shared BFO render library remains the only render path.

Caller-editable custom fields and files are not trusted identity or content anchors. Hashes detect
accidental changes only when the expected hash has independent protection. Protecting only the
initial snapshot leaves resolved XML parts and final result pointers open to substitution.
Authenticated envelopes must bind the complete input, each part and the published result.
Signing does not encrypt files, revoke native File Cabinet ownership or prevent replay of an old
valid state in storage the caller can roll back. Those need separate policy and authoritative
storage decisions; they cannot be claimed solved by application routes or optimistic locking.

Use a deployment-controlled versioned keyring and an account-local API secret restricted to the
approved batch entry scripts. The supported server API is `crypto.createSecretKey({secret,
encoding})`, then `crypto.createHmac({algorithm: crypto.HashAlg.SHA256, key})`, `update` with
UTF-8 canonical input and `digest` as hex. Unknown keys, denied secrets and unsigned legacy jobs
must fail closed. No arbitrary-message signing endpoint is permitted.
[Secret-key API](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4358653390.html),
[HMAC API](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4358647613.html).

Use separate signature domains for job, part, state and result. Bind account/environment, schema,
key version, native job owner, requester/role, folder/parent, document type, ordered IDs, exact
XML and copy labels. Bind the saved snapshot ID through authenticated durable identity. Part
signatures also bind sequence, transaction, file ID/name, bytes and XML digest. Published results
bind PDF bytes, file identity, counts and ordered successful sequences. Transitions must start
from authenticated prior state, never simply sign whatever editable fields currently contain.

Approved scripts and their loaded libraries must be protected from callers. Employee secret-use
access is separate from secret-management access. Domain restrictions address HTTPS/SFTP
disclosure, not script authorization; Oracle documents an invalid-domain restriction for keys
used only by crypto. Account setup and propagation need explicit validation before enabling the
feature. [Secret access](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160337298977.html),
[Secret creation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160216498405.html).

Verify a PDF's authenticated contents before serving those same verified bytes. File content
reads have a 10 MB limit; the XML budget alone does not bound PDF size. Do not bypass verification
for larger PDFs. Chunking or an independently protected streaming path needs measured evidence.
[File.getContents](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4229269811.html).

Replaying a valid input repeats rendering with current-role transaction reads; it does not mutate
the transaction. It can still duplicate computation, publication or email. Signing cannot prove
latest-state or exactly-once behavior in caller-editable storage. Native owners' access to older
files remains a separate retention/revocation policy. Rotate by deploying old/new verification
support, validating the new restricted secret, switching signing, then retiring the old key only
after dependent jobs expire or migrate.

## Durable storage contract

The current job stores the immutable snapshot digest, phase, signed chunk plan, merge task and
signed output manifest. The artifact record binds native owner, logical external ID, parent job,
snapshot generation, kind PART/CHUNK, ordinal, COMMITTED state and signed bounded payload. Payloads
include file identity, byte count, digest and producer proof. A single create/save publishes the
complete signed ledger row; no unsigned intermediate record is treated as success.

Attempt tokens, pre-save WRITING rows and orphan adoption described below are still a future
extension. A file saved before a failed ledger commit is retained as uncommitted work and cannot
be inferred successful from its filename. Current recovery reuses committed artifacts only.

PART metadata identifies the request sequence, transaction and render time. Sequence is the
identity: repeated occurrences of one transaction must remain distinct. CHUNK metadata contains
ordered committed part references and their authenticated digests. Validate unique
`(job, generation, kind, ordinal)` keys in sandbox before relying on them. Parent authorization
precedes every artifact access; permissions start deny-by-default.

Any future initialization of pending part rows belongs in worker input preparation rather than
spending Suitelet governance on up to 500 record creations. For competing recovery claims, use load/check/change/`record.save()`
with optimistic-lock conflict handling, not separate load and `submitFields()` as a pretend
compare-and-set. Generation tokens fence stale workers for ordinary crash recovery; editable
tokens are not protection against malicious rollback.
[Custom-record optimistic locking](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2877583.html).

## Processing phases

1. Enqueue captures server-selected XML and copy labels, document order and caller identity.
2. Render workers persist one part outcome per job/generation/sequence. A part becomes usable
   only after file readback and durable outcome publication. A crash before publication leaves
   an orphan file, not an implicitly successful document.
3. Planning reads committed part metadata in original order and creates a deterministic chunk
   manifest. Bound both XML bytes and document count per chunk. A single oversized document is
   an explicit per-document failure. Do not load all XML just to discover chunk boundaries.
4. A separate merge phase processes one bounded chunk per reduce invocation through `combinePdfDocs`.
   Revalidate part identity, size and authenticated digest before rendering. Publish each PDF
   only after private-file readback and durable result commit.
5. Finalization publishes an ordered result manifest with requested/succeeded/failed counts and
   missing sequence details. COMPLETE requires accounting for every requested document;
   PARTIAL must be prominent in the UI. Downloads address authorized job/chunk references.
6. Retention removes only unreferenced private artifacts after committed results are safe and
   the recovery window has elapsed. A failed deletion is tracked for retry; it does not turn a
   successfully published PDF into a failed print.

Sequentially calling the existing full merge several times from summarize is insufficient:
total summarize governance would still grow with the whole job. Separate deployments/phases
must preserve caller execution; a global administrator dispatcher is not an acceptable shortcut.
On-demand workers inherit the submitting identity and role; prove that for both phases in the
target account. Use a distinct merge deployment and reconcile its returned task ID.
[On-demand submission](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1508887826.html).

Future orphan adoption must persist an attempt's intended filename/hash before saving. After a crash between file save and
record commit, search only the authorized job folder and reuse a file only if the expected
identity/size/digest matches. After artifact commit, reuse the committed artifact even when
`context.write()` was lost. Resume incomplete chunks after planning/publication interruptions;
do not downgrade a terminal job. Preserve a RECOVERY_REQUIRED state for ambiguous infrastructure
outcomes rather than resubmitting because a timer expired. Map/Reduce restarts do not roll back
external side effects, so these boundaries require application idempotency.
[Restart behavior](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1491509438.html).

## Recovery acceptance tests

The status page offers render recovery only for FAILED/DONE jobs with a snapshot, its digest,
a recorded render task, and no plan, outputs or merge task. Recovery POSTs for both render and
merge require a signed action token bound to the current job state and caller. Render recovery
verifies the immutable snapshot and a terminal prior task, then atomically claims submission and
clears the old task ID. An ambiguous submission remains RENDER_SUBMIT_UNKNOWN; it never authorizes
a blind retry. Accepted-task metadata failures retain the worker's current state and warn the user.
The same snapshot and committed PART ledger are reused. Missing parts are rendered from current
transaction records, so recovery does not promise a historical transaction snapshot across keys.

Render input claims compare the observed status, phase and task with empty plan/outputs. A
competing planner/finalizer wins without being reopened by stale input initialization. Overlapping
input invocations for the same rendering task can return identical immutable keys; map publication
still verifies/reuses the ledger winner. Jobs with a sealed plan are not reset by render recovery,
including all-document failures with an empty-chunk plan.

- Inject termination after each file save and before/after every durable commit. Resume without
  losing committed work, publishing duplicate chunks or deleting an active generation's inputs.
- Re-deliver map keys and summarize callbacks. Validate exact sequence and generation before
  accepting an existing part; filename reuse alone is insufficient.
- Exercise busy deployments and submission errors without converting accepted work into a
  rejected request. Reconcile only against a specific task ID and authoritative task status.
- Make one document exceed the chunk budget; ensure remaining documents retain their exact
  order and the failed document is explicitly accounted for.
- Tamper with snapshot, part XML, result pointer, caller fields and generation state through
  authorized native APIs. Separate crash-recovery tests from malicious rollback tests.
- On sandbox, measure per-document and per-chunk usage, duration, file size and PDF pages;
  inspect Thai glyphs, totals, repeated headers and order across chunk boundaries.

## Agent ownership for the next implementation

Use these task statements with the repository's agent profiles. Primary integrates generated
outputs, authorizes phase boundaries and performs every connected action.

- `engine-template-implementer`: own durable part/chunk records and the batch storage library
  plus storage tests. Implement publication and generation invariants without modifying rendering.
- `engine-template-implementer`, after the storage contract is fixed: own render/merge workers,
  their deployment objects and worker tests; preserve the shared BFO pipeline.
- `engine-template-implementer`, separately: own the batch Suitelet and its tests for ordered
  chunk downloads, partial-result messaging and owner-triggered recovery controls.
- `pdf-parity-reviewer`: read-only review of identity, native tampering, failure ordering,
  replay, chunk accounting and Thai/BFO parity evidence. Local stubs cannot provide sign-off.

Do not run simultaneous writers against the shared batch library. Schema migration must drain
old tasks and reject incompatible envelopes explicitly. New phases are not enabled on an account
until secret/permission setup, deployment identity and recovery/negative tests are verified there.

Current local evidence includes 51 documents split 25/25/1, Thai byte-boundary chunking, 500-row
planning without XML reads, finalization without PDF reads, lost PART/CHUNK output callbacks,
reused committed chunks, rejected PDF substitutions, complete/partial accounting and concurrent
submission/finalization claims. Publication validates signed metadata; guarded downloads verify
actual current PDF bytes. Cleanup deliberately runs in neither summarize phase.

## Bounded cleanup of published inputs

The status page issues an action-specific signed token for an explicit owner POST. The same
user and role must authorize every continuation, bound to the job, snapshot and output manifest.
Both recorded worker task IDs must be present and report COMPLETE or FAILED. Each request examines
at most three sequence positions, checks a 250-unit reserve and a cooperative 20-second deadline
from request processing entry, and returns a signed next position. The page continues automatically
after the initial click; stopping or losing the response permits a fresh scan safely.

Only committed PART XML referenced by published chunks is eligible. Cleanup verifies exact
sequence/part-ID/hash references, actual PDF bytes once per affected chunk per request, private
folder, plaintext type, filename, size and part hash. Snapshot and published result IDs are excluded.
Authenticated state and folder are rechecked immediately before deletion. The same request never
loads all 500 documents or all PDFs into memory. Native API calls cannot be interrupted mid-call,
so the deadline is cooperative, not a hard execution-time guarantee.

Search absence (including a concurrent cleanup) is reported as unavailable, never counted as a
successful delete. Permission/integrity failures stop visibly. Audit entries record each successful
delete without document contents. Counts are per request, not durable cumulative receipts.
Snapshot, ledger rows, unpublished inputs, orphan files and PDFs remain retained. Age-based
retention still needs a policy and separate implementation. Native file checks and deletion are
not atomic; concurrent Cabinet edits and account permissions require sandbox validation.
