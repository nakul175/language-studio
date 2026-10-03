# Guided AI sessions

The main learner screen uses open-source models on the adult's device: Qwen2.5-0.5B-Instruct for response feedback and practice generation, Whisper-base for English/Hindi transcription, and local speech voices with an eSpeak-NG fallback. No paid model key is required for this workflow. Seven language checks lead to two targeted practice activities; each step saves to the authenticated workspace database. Model downloads and sufficient browser memory are required. **Qwen/Whisper inference is not yet verified in the development environment; model downloads timed out.** See [AI workflow and limitations](docs/ai-workflow.md) and [open-source notices](THIRD_PARTY.md).

# Language Studio

An adult-guided foundational language learning website with ChatGPT sign-in,
private learning workspaces, user management, and a Sites D1 database.

Mobile SMS is the selected next login channel. A server-only verification
connector and automated tests are prepared; **SMS login is not enabled**. Hosting
authentication support and a configured SMS provider are still required. See
[SMS login integration status](docs/sms-login.md) for the exact boundary and
remaining integration work.

## Start using it

1. Open the website and choose **Sign in with ChatGPT** using your adult account.
2. Name a learning space for your classroom or family. You become its administrator.
3. Add a learner using a nickname, then choose **Start AI session**. Existing adult-led activities remain available.
4. Open **Account → Manage users** to invite another adult. Choose a role, create
   an invitation link and share it yourself. No invitation email is sent by the app.
5. To move records from the earlier version, open **Saved work → Import records
   from this browser**. Import is explicit and keeps the original browser copy.

## Access

| Role | Learners and results | Manage users | Delete learner records |
| --- | --- | --- | --- |
| Administrator | All in their workspace; add and rename learners | Invite, change roles, assign learners, remove access | Yes |
| Teacher | All in their workspace; add and rename learners | No | No |
| Parent | Read and record activities for assigned learners only | No | No |

Every adult may also create a separate private family/classroom workspace. This
does not grant access to anyone else's workspace. There is no site-wide first-user
administrator. The workspace owner remains an active administrator. Removing a
member's access preserves completed learner records.

Invitations are bound to the recipient's ChatGPT email, expire after seven days,
and work once. Only a SHA-256 hash of the random 256-bit token is stored. An
administrator can revoke a pending invitation; links from former administrators
cannot grant access. Parent invitations require at least one assigned learner.
Reissuing an invitation replaces earlier unused links for that email. Access
changes advance a membership version and invalidate prior recipient grants.
Previously removed members need a fresh invitation; legacy unused links cannot
restore their earlier role. Demoting an administrator revokes their pending grants.

## Learning features

- English and Hindi across three activity levels.
- Sound awareness, word reading, vocabulary, listening, oral reading, comprehension,
  speaking and writing.
- One-question-at-a-time checks, alternate rechecks, guided practice and remediation.
- Adult-reviewed oral-reading word scores and optional microphone recording.
- Evidence, teaching notes, progress reports, print, CSV and JSON backup/restore.
- Saved learners and results available across devices after sign-in.
- Paused activities saved per adult and workspace, with conflict protection.
- Completed results are staged privately in D1 before insertion into progress.
- Saved work includes per-result retry, recovery export and explicit discard.
- Delayed result/draft callbacks cannot replace a newer activity or draft revision.
- Progress loads for the selected learner, language and level, with 20 activities per history page.
- Optional encrypted device recovery for completed results interrupted before online saving.
- Automatic recovery retries on reconnect, request deadlines and account-change protection.

## Progress and result saves

Completing an activity sends only that result, using its immutable activity ID as
an idempotency key. Two adults can save independent results without downloading
or resending the workspace history. The database transaction checks current
learner access, duplicate IDs and both workspace quotas, then inserts the result,
updates the workspace revision, records an audit event and clears matching drafts
and recovery copies. A conflicting payload for an existing ID is rejected.

Opening a workspace fetches its authorized learner list, private draft/recovery
and counts. Progress then fetches one learner/language/level at a time. The
interface holds the current 20-result history page, three recent activities and
the latest two scored checks for each skill: at most 39 distinct completed records.
Totals, oral-reading check counts and repeated-question exposure include the full
selected context. Practice and skipped-only checks cannot replace scored evidence.
Changing learner, language or level shows a loading state and ignores outdated
responses. Older/Newer history controls preserve these skill comparisons. A
changed workspace revision resets history to the first page with a notice.

CSV and JSON exports explicitly fetch all currently authorized records, across
languages and levels. Printing includes the current history page and full skill
summary; use CSV for the complete activity history. Hosted JSON backups use compact
formatting and a 12 MiB upload envelope so a workspace near its 10 MiB result quota
can be restored with its learner metadata. The database quota remains 10 MiB.

The compatible `/data` and `/changes` routes remain available. Learner edits and
explicit imports fetch and reconcile a fresh full snapshot before using them;
they never submit the paged cache as the complete history. Normal result saves,
progress loading and draft autosaves do not use that full-history protocol.

This is a reduction in history transfer and browser memory, not a demonstrated
large-scale performance guarantee. Progress still scans metadata for the selected
context, and quota checks still aggregate workspace payload sizes. Bulk imports,
exports and learner administration remain full-snapshot operations. Larger quotas
need measured database load, indexed summary data and further operational work.

## Completed-result recovery

If a workspace reaches capacity or final insertion fails, **Review results** opens
the recovery controls in **Saved work**. A result marked **Recovery copy saved in
your account** survives a reload and is available to the same adult on another
device, subject to current learner access. It stays separate from progress until
successfully added. Retry is idempotent. **Export recovery copy** produces a normal
one-result JSON backup that can be restored into a space with capacity; it does not
delete the original. **Discard** requires confirmation.

The recovery buffer permits 10 results per adult and 100 per workspace. Successful
insertion clears matching recovery copies in the same transaction. Removing access
does not erase these completed recovery records, but they remain inaccessible until
the adult is authorized for that learner again. Deleting a learner cascades their
recovery records. Account recovery copies can remain while switching spaces or
signing out; unacknowledged work still blocks those actions.

With Device recovery off, an interrupted connection **before the recovery copy
reaches D1** leaves the result in the current tab only. Export it before closing.
The interface distinguishes tab-only work, a device copy, an account recovery copy,
and a result added to progress.

## Optional device recovery

Open **Account → Device recovery** and enable **Keep unsent completed results on
this device** while online. This setting is off by default and belongs to this
browser and adult account. Enabling it also protects any visible completed,
unsent results that can be copied successfully.

A completed result is encrypted before the first online save attempt. The interface
only acknowledges a device copy after its storage write has been checked. When
online saving succeeds, the copy is removed. The app retries pending copies when
reopened online with the same adult account or when the browser reports that its
connection has returned. **Saved work → Retry** remains available if the network
service recovers without a browser connectivity event. Capacity and conflict errors
require attention instead of an automatic retry loop.

The temporary queue permits 10 results per workspace and 20 per adult in this
browser, with a 2 MiB budget for its encoded values. Browser storage can have a lower
available quota. Blocked storage, corruption and unavailable keys do not fall back
to plaintext or produce a false saved acknowledgement. Removing or changing a
stored copy withdraws its device-saved status and restores the close warning when
no account copy is known. Corrupt copies are retained until explicitly cleared.

**Clear device copies and turn off** requires confirmation and affects only this
adult's copies in this browser. Saving or clearing pending copies is required before
disabling protection. Account and workspace switching can continue when all completed
results have confirmed device or account copies; in-progress drafts and pending
requests still block switching.

Implementation: standard AES-256-GCM with a random 96-bit IV and the full storage
key as authenticated additional data, binding ciphertext to its account, workspace
and result ID. The account key is created lazily in D1, fetched through an
authenticated, non-cacheable same-origin endpoint, and held as a non-extractable
Web Crypto key in memory. It is never written to browser storage or included in
workspace exports. Short storage transactions use the existing cross-tab lock;
conflicting same-ID copies cannot overwrite each other. The expected adult ID is
checked against the real Sites identity on API calls, so an old tab cannot save or
obtain keys after the sign-in changes. It does not grant access by itself.
See the [Web Crypto encryption documentation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt).

This protects temporary copies at rest, not against code executing inside an
already authenticated page or an account compromise. Current learner authorization
is still enforced when loading workspaces and saving recovered results. Prior
exports or device copies cannot be remotely retracted from an adult's device.

This is **completed-result recovery**, not a fully offline application. Reopening
the website and retrieving the account key require connectivity and sign-in.
Unfinished activities, audio and recordings are not included. Browser data deletion,
eviction, private-session cleanup or closing before the copy acknowledgement may
remove work. D1 remains the authority for progress; device copies enter progress
only after server validation and authorization.

API requests have a 20-second deadline that aborts a stalled fetch or response body.
Safe result operations retain their immutable ID when retried after an uncertain
response.

## Runtime and persistence

Production runs `dist/server/index.js` as a Sites Worker. `.openai/hosting.json`
declares the logical `DB` D1 binding. Sites applies generated schema migrations
before publishing. Runtime handlers never create or alter production tables.

The dispatcher owns `/signin-with-chatgpt`, `/signout-with-chatgpt` and `/callback`.
The Worker trusts the Sites-supplied user ID/email headers, then independently
enforces workspace membership and learner assignments on every database route.
Do not deploy this Worker behind an arbitrary proxy that accepts client-supplied
identity headers. Do not implement an app-owned OAuth or password flow.

Structured records use prepared SQLite statements and server-generated mutation
nonces to gate transactional batches. Snapshot edits compare workspace revisions;
individual result inserts recheck access, uniqueness and quotas atomically without
a client revision. Completed results are immutable; result IDs and snapshot retry
receipts prevent duplicate writes after lost responses. Changed membership blocks
unauthorized writes. Imports and scores receive the same
server-side validation used by the learning engine. Protected responses are not
cached, and mutations require same-origin JSON requests with a custom header.

Browser storage holds UI preferences, earlier local records pending explicit
import, and opt-in encrypted temporary recovery copies. It is not the authority
for hosted learner data. Audio remains in the
active tab unless downloaded. Optional browser transcription may use the browser
vendor's online speech service; it is off by default.

## Development and verification

Use Node 24 or newer for the SQLite test adapter.

```sh
npm ci
npm run build
npm test
npm run dev -- --port 4173
```

The managed preview deliberately provides no mock authentication. It displays
the anonymous sign-in gate and strips incoming identity headers. Backend and
connected controller tests inject synthetic identities directly into the handler
with a real SQLite database; no test account or authentication bypass is deployed.
Actual ChatGPT sign-in requires the published Sites dispatcher.

Edit `db/schema.ts` and run `npm run db:generate` for schema changes. Inspect and
commit `drizzle/*.sql` and metadata. Once a migration has been applied, append new
migrations instead of modifying it. Local databases are disposable test fixtures;
the preview never connects to production D1.

`npm test` covers content/scoring, deep regressions, backend integration, connected
cloud controllers, encrypted-device recovery, optional cloud AI and on-device AI
session orchestration. Model outputs in orchestration tests are simulated. Coverage includes
invitations, concurrent removal and saves, delayed callbacks, recovery isolation,
count/byte quotas, near-full backup restore, transaction rollback, bounded progress,
pagination, legacy date ordering, full exports, context races, schema upgrades,
opt-in recovery, encryption/tamper detection, shared-browser isolation, reconnect
retries, request deadlines, account changes and browser-copy removal. See
`tests/QA.md` for the scope and remaining real-device checks.

## Current limits

- Each workspace supports up to 500 learners, 10,000 results and 10 MiB of result
  payloads. Each adult can own up to 10 workspaces. Each workspace can have 100
  pending, unexpired invitations. Hosted backup uploads are limited to 12 MiB
  including metadata; the earlier local-only controller retains its 10 MiB limit.
- Completed results cannot be edited or removed individually. An administrator
  can delete a learner and all related results; export a backup first.
- Backups exclude audio and paused drafts. Access removal does not retract files
  someone previously exported.
- ChatGPT accounts are required for adults. Child accounts, password accounts,
  automated invitation emails, live presence and live push updates are not included.
  Reopen the workspace to fetch other adults' latest work; saves merge concurrent
  changes and preserve completed results.
- The original activity bank is not standardised or validated. Scores support
  adult-guided instruction, not clinical diagnosis or high-stakes placement.
- Physical microphone behavior, browser speech services and installed Hindi
  voices depend on device permissions and capabilities.
