# Batch reliability and scale — implementation contract

<!-- @author Wichit Wongta -->
<!-- @since 2026-09-09 -->

Issue #199 remains open. Schema v5 implements authenticated PART/CHUNK publication, per-document
rendering, metadata-only planning/finalization, a separate bounded merge reduce phase and guarded
PDF-byte downloads. Owner-triggered merge recovery verifies the prior task is terminal and claims
the job atomically. These are local implementations, not native-account security or capacity proof.
Owner-triggered render recovery before plan publication is implemented locally. Failed sequences after a sealed plan can create a linked child job locally.
Age-based retention and native capacity QA remain unfinished.
Bounded orphan adoption is implemented locally for PART and CHUNK retries.
Owner-triggered cleanup of published XML inputs is bounded and implemented locally.

## Enqueue acceptance boundary

Preparation can mark the caller-owned job FAILED and clean verified private files only before
calling `task.submit()`. Once that call begins, an exception or missing task-ID response may hide
acceptance. Preserve the snapshot and show uncertainty plus job/error references. Set
RENDER_SUBMIT_UNKNOWN only if the original QUEUED/RENDER_QUEUED state and immutable storage still
match; an advanced worker or published result wins. A returned task ID proves acceptance, so later
metadata failures retain the accepted job with a warning. None of these ambiguous outcomes permits
an automatic resubmit. A failed cleanup/state update must not hide the original failure; loss of
record access requires structured logs for operator reconciliation, not an invented transition.

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
snapshot generation, kind PART/CHUNK, ordinal, state and signed bounded payload. Workers reserve a
signed WRITING row before saving a file, then transition that same row to COMMITTED with native
optimistic locking. Only authenticated COMMITTED payloads count toward planning/finalization.
Reads authenticate incomplete rows before excluding them; no unsigned intermediate row is success.
Existing committed payloads and legacy PART filenames remain readable.

The WRITING payload binds intended producer metadata and a positive revision; CHUNK also binds
the current signed plan digest. Changed intent increments the revision, including A-to-B-to-A
rotations. The commit token binds the complete authenticated reservation. A stale token cannot
publish over a newer reservation; a committed winner is preserved. Physical files are verified
before commit. The artifact CAS is atomic on its own row, not across the parent job and file;
parent plan/output publication retains its separate guarded transition.

PART metadata identifies the request sequence, transaction and render time. Sequence is the
identity: repeated occurrences of one transaction must remain distinct. CHUNK metadata contains
ordered committed part references and their authenticated digests. Validate unique
`(job, generation, kind, ordinal)` keys in sandbox before relying on them. Parent authorization
precedes every artifact access; permissions start deny-by-default.

Reservations are created per map/reduce key, avoiding up to 500 record creations in the Suitelet. For competing recovery claims, use load/check/change/`record.save()`
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

Orphan adoption searches only the authorized private folder and exact intended filename. New
PART/CHUNK names include the full content hash, so late writes with different bytes use different
names. Fetch at most four candidates to detect overflow above three; overflow, unreadable files,
or any metadata/content mismatch fails visibly. Validate actual folder, offline state, file type,
name, size and hash for every candidate before selecting the lowest numeric internal ID and
committing with the reservation token. No candidate means unfinished work may render again; a
filename alone is never evidence of success. No orphan files are deleted. The file search uses
NetSuite folder/name filters and verification uses the native file type property.
[File search fields](https://www.netsuite.com/help/helpcenter/en_US/srbrowser/Browser2017_1/script/record/file.html),
[N/file properties](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4205693274.html). After artifact commit, reuse the committed artifact even when
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

### Native deployment pool and deferred submission

The package has two render and two merge deployments. Each is Not Scheduled with concurrency and
buffer size explicitly set to one and Audit logging. Initial queue, recovery and render-to-merge
handoff supply fixed stage script/parameter identities and omit the deployment ID. Oracle documents native selection when
`deploymentId` is omitted: an eligible deployment is deployed, Not Scheduled, and has no unfinished
instance. Programmatic submission inherits the calling script's user/role. This provides a native
pool option without an administrator dispatcher; four deployments do not establish throughput or
guarantee four simultaneously executing tasks. Account processor allocation remains authoritative.
[On-demand submission](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1508887826.html).

Audit account-added eligible deployments because native selection may use them as well. Do not try
another slot after an unknown submit outcome. The exact native error `FAILED_TO_SUBMIT_JOB_REQUEST_1`
is documented as a task that cannot be submitted. Only this name/code authorizes a guarded WAITING
state with no stage task ID: QUEUED/RENDER_WAITING or RUNNING/MERGE_WAITING. A current signed POST
can explicitly retry that deferred submission, without a prior task-status lookup because native
nonacceptance is already recorded. Repeated rejection remains deferred. Ordinary failed-worker
recovery still requires the previous task to be terminal. Message text, generic exceptions and
missing task IDs never authorize this path. No automatic retries/timers are introduced.
[Submit API error contract](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_453639770507.html).

The WAITING transition must compare the original submitting state, stage task ID and storage/plan
identity. It cannot overwrite an advanced worker. Missing permission or invalid configuration can
also cause definite rejection; WAITING does not assert that pool saturation was the cause. An elapsed
timer is not evidence that no task was accepted.
After a merge handoff enters WAITING, the worker attempts a requester-only email with the job
reference and status route. It rechecks the waiting state before notification and avoids a false
completion claim. Delivery failure is logged and leaves the deferred job/inputs intact; users can
always return to their job list. This notification is best-effort, not an exactly-once receipt.
MR UI Execute As Role is fixed Administrator, while effective programmatic execution inherits its
caller; the blank XML field is not the runtime authorization mechanism. Validate all stages under
the intended restricted role and do not use Save and Execute or scheduled System-user dispatch.
[MR deployment fields](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1509578980.html),
[UI execution identity](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1509579025.html).

Current local evidence includes 51 documents split 25/25/1, Thai byte-boundary chunking, 500-row
planning without XML reads, finalization without PDF reads, lost PART/CHUNK output callbacks,
reused committed chunks, rejected PDF substitutions, complete/partial accounting and concurrent
submission/finalization claims. Publication validates signed metadata; guarded downloads verify
actual current PDF bytes. Cleanup deliberately runs in neither summarize phase.

## Failed-selection verification and linked-retry boundary

`pld_lib_batch_selection.read(jobId)` is read-only. It authorizes the original user/role, checks
the private bounded snapshot and its exact digest, validates the immutable XML/copy labels, and
checks the complete ordered plan partition. PARTIAL/DONE requires an exact match between planned
chunks and published manifest sequences. FAILED/DONE requires an all-failed plan with no results.
Failures must match original snapshot IDs and supported producer codes. Duplicate transaction IDs
remain separate sequence occurrences. A final authenticated job reread rejects concurrent changes.

The status page links to Thai failure details for these jobs. Details expose the original position,
record ID and bounded reason label; request parameters cannot choose IDs or files. Opening details
reads no transactions or PDF bytes, resolves no current template and submits no work. Submission
requires the separate signed POST from its retry button.
Snapshot/plan integrity failures stop the details view without changing the original result.

Linked retry is now implemented locally. The explicit signed POST creates one deterministic child
per source job, immutable snapshot/plan/output digests and failed sequence set. The key excludes
transient task metadata and signing-key identity. Repeated POSTs return the existing child; failed
children can create their own children. The source job and its PDFs remain unchanged. Child
snapshots retain source positions and template/copy labels; transactions are read again at render
time, as the UI explains. Dedicated child status shows authorized parent lineage; inaccessible or
invalid lineage shows a notice while independently verified child PDF links remain available.

Reserved creation atomically saves native external ID, owner, strict initial fields and a
`job-init` seal before the native ID is known. Same-record optimistic promotion binds the returned
ID in a normal job seal. Ordinary job reads reject initialization seals. The job list authenticates
and counts pending initialization rows without mutating them or discarding corrupt rows. Normal
job seals now bind native external ID; older seals are accepted only when both stored and sealed
external IDs were absent/empty. Drain old workers before upgrading or rolling back this contract.

Provisioning resumes exact private folders and JSON snapshots with bounded searches and actual
owner/privacy/name/size/hash verification. Folder names are not assumed unique: ambiguous matches
stop visibly, and surplus folders/files remain retained. A snapshot is attached by guarded save.
The submit claim is guarded separately, then uses fixed render script parameters and native
selection. Definite native rejection becomes WAITING; generic or missing responses stay UNKNOWN.
A crash after the submit claim but before the call cannot be distinguished from accepted work:
repeat POST returns the same pending child and the UI requests operator reconciliation. No timer
or retry action treats that window as proof of nonacceptance.
[Folder fields and filters](https://www.netsuite.com/help/helpcenter/en_US/srbrowser/Browser2016_2/script/record/folder.html),
[Native optimistic locking](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2877583.html).

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
