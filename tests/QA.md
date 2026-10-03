# Functional verification — 12 September 2026

## SMS verification connector preparation

The server-only connector is tested with synthetic Twilio Verify responses.
Coverage includes explicit international number normalization, malformed input
and missing credentials without network calls, fixed HTTPS endpoints, SMS-only
requests, leading-zero codes, account/service/number/SID binding, wrong and
expired codes, exhausted attempts, consumed provider challenges, bounded retry
delays, provider failures without sensitive error text, oversized/malformed
responses, and deadlines covering headers and body. A boundary check confirms
the connector and its secret setting are absent from the app's runtime entry
points and compiled browser/Worker output.

These tests do not establish working SMS login. The connector has no public
endpoint, user-session integration or database-backed challenge/rate-limit layer.
No real SMS, carrier delivery, phone linking or new authentication session was
tested. Sites external login support and provider configuration remain unresolved.

## Activity-focused redesign

Verified on 12 September 2026 with synthetic learner records in the managed Chromium preview.

- Desktop activity hub: all three activity types are visible; Start reading opens the reader directly.
- Passage settings: language, passage and time are visible without opening an advanced panel.
- Explicit word tools: set a five-word endpoint, mark one word incorrect, and enter 30 seconds. The result is 8 correct words/minute and 80% accuracy.
- Reading save: acknowledgement is required; saving exposes See learner progress, which closes the reader and opens the correct language/level report.
- Focused sounds check: scoring guidance is visible; completing two questions saves one independent and one supported response.
- Responsive layout: inspected the live app inside a 390 × 844 CSS-pixel iframe. The effective viewport and content width were both 375 pixels, with no horizontal overflow. This is a viewport test, not a physical-phone test.
- Practice at phone width: teaching steps, both feedback screens and completion work; the result saves two independent responses and offers a recheck.
- Final browser logs filtered to the app origin showed no application errors; unrelated browser-extension messages were excluded.

`npm test` passes the existing content/controller suites and all 136 deep regressions. The old word-cycle test now checks explicit score selection, repeat-click stability, boundary shortening, edits outside the boundary, and review invalidation.

Physical microphone/audio, real mobile browsers and assistive technologies were not retested. These results establish functional and layout checks, not measured usability with teachers or parents.

## Earlier simplified interface update

The redesigned interface was checked with the existing engine tests and an in-memory DOM controller harness, not a new browser session. The harness covers learner setup, 13-question checks, pause/resume, practice feedback, unchanged diagnostic evidence after practice, result summaries, report rendering, saved-data reload, language/level persistence, Hindi prompts, export contents, and the manual Read → Review words → Save controller flow.

The harness is not a visual-layout or browser integration test. Microphone capture, audio playback, mobile layout and physical-device interactions need device testing after this redesign.

## Earlier v2.1 browser workflows checked

- Create a learner; rename the learner while retaining records.
- Complete the 13-task English baseline across all seven task domains.
- Record an adult observation, go back, pause, reload and resume without losing the response or note.
- Complete guided practice with feedback, then an alternate-form recheck; skip a task and keep it unassessed.
- Inspect the previous/latest diagnostic comparison and the session history.
- Complete a Hindi sound-awareness check with independent and supported responses.
- Open the embedded reading tool, enter a transcript, align it, change reading duration, review and save.
- Confirm a 5-word attempt with 4 correct words at 30 seconds yields 8 correct words/minute and 80% accuracy.
- Confirm saved reading scores appear in the wider learner report.
- Generate CSV and JSON exports; inspect their contents. Restore the generated JSON through the paste interface without duplicating records.

## Automated checks

The 156 generated content items across both languages, three levels and two forms pass structure and answer-index checks. Tests cover scoring, partial-passage English/Hindi alignment, reading-practice exclusion from diagnostics, reading arithmetic, backup duplicate/conflict rejection, CSV formula-prefix neutralisation, and standalone JavaScript syntax.

## Boundaries

- Real microphone recording, online speech recognition, audible playback and device-specific voice availability were not verified against physical hardware. The manual scoring path was exercised.
- The cloud browser's automated download event timed out. Exports also expose a normal Save file link and copyable contents, and backup restore was verified through the paste interface.
- WebMCP registrations are feature-detected, but the browser reports modelContext unavailable; runtime WebMCP verification is unavailable.
- Responsive CSS is implemented; this run did not cover every mobile browser or assistive technology.
- This is an adult-facilitator review release, not a clinically or psychometrically validated assessment or a production child-facing service. Website access follows the owner's current sharing settings.

## Account and database release — 12 September 2026

- Migrated production from a static page to a Sites Worker with the logical D1
  binding `DB`. Generated and inspected the initial 10-table Drizzle migration.
- Existing content/scoring/controller tests and 136 deep regressions pass.
- 21 backend integration scenarios pass against real SQLite with foreign keys.
  Coverage includes anonymous denial, workspace isolation, teacher/parent roles,
  assignment filtering, invitation email binding/hash/expiry/revocation/reuse,
  owner protection, CSRF, malformed/oversized requests, immutable scores, retry
  receipts, simultaneous writes, atomic rollback, Unicode codes, a 1,000-result
  import, per-adult drafts, draft conflicts, completion and deletion cascades.
- 10 connected interface scenarios pass using the actual controller and API with
  synthetic identities. Coverage includes workspace/learner creation, a completed
  check, another-device reload, pause/resume, failed-save retry, dropped responses,
  concurrent additions, explicit browser import, parent UI and draft conflicts.
- Browser preview: anonymous gate renders with a clear top-level ChatGPT sign-in
  link; old synthetic browser records are not exposed before sign-in. Desktop
  and 390 × 844 layouts visually inspected. No production learner data was used for testing.
- Actual hosted ChatGPT login/logout and two real-account invitation acceptance
  are not verified by the managed preview, which deliberately has no mock sign-in.
  Physical microphone and browser speech checks retain their earlier limitations.


## Incremental results and paged progress — 12 September 2026

Verified using the actual compiled interface, API handlers and real SQLite with
synthetic identities. The content/controller suites, 136 deep regressions, 43
backend scenarios and 24 connected cloud controller scenarios pass.

- Compact bootstrap excludes history and counts only authorized records.
- A 250-result fixture opens and completes an activity without `/data` or
  `/changes`; the completion request contains only its new session.
- Concurrent independent saves both succeed. Duplicate finishes create one
  record and one audit event. Changed evidence cannot overwrite an existing ID.
- Concurrent saves at 9,999 results admit one final result and keep the other
  result's recovery copy. Byte quota rejection and restoration of a near-10-MiB
  backup are also exercised. An injected transaction failure rolls back revision
  and history while retaining recovery.
- Parent assignments, workspace isolation and revocation immediately before a
  write or between progress metadata/evidence reads deny unauthorized access.
- Page traversal covers every ID once, including equal timestamps, UTC offsets
  and legacy date strings. Stale revisions reset the interface to page one.
- Latest/previous skill evidence matches the full-history engine. Newer practice
  and skipped-only checks do not replace it. Oral-reading totals and historical
  exposure remain complete while full-record caches stay at or below 39 records.
- Report totals, older session details, full JSON/CSV exports across contexts,
  and learner edits/imports retain records beyond the visible page.
- Out-of-order learner responses cannot replace the selected profile. Losing
  access during the post-save refresh does not relabel a committed result as
  unsaved or reopen its dialog. File and paste limits use UTF-8 bytes.

No schema migration is required for this update. Existing migrations are unchanged.
No new browser, physical-device, real-account sign-in, accessibility or production
load test was performed. The fixtures establish functional behavior and bounded
record transfer, not latency at production scale. Metadata scans, quota aggregates,
and full-snapshot bulk operations remain documented limits.


## Encrypted device recovery — 12 September 2026

The actual compiled interface and API pass the existing content/controller suites,
136 deep regressions and 88 additional scenarios: 46 backend, 34 connected cloud
controller and 8 device-recovery cases. Fixtures use synthetic identities, real
SQLite and Node's standards-based Web Crypto implementation.

- Opt-in is off by default. Enabling it fetches only the current adult's key;
  keys are stable under concurrent requests and absent from storage and exports.
- Completed work during a connection failure is encrypted and survives a new
  controller instance sharing browser storage. Reconnecting automatically inserts
  it once, clears the device copy and preserves server-authorized progress.
- A different account sees no copies. Reassignment hides the retained result and
  blocks upload until learner access is restored. A changed sign-in rejects old-tab
  reads/writes and cannot bind an old account's ciphertext to the new adult's key.
- Encryption rejects changed ciphertext, moved workspace/account entries and wrong
  keys. Duplicate saves are idempotent and conflicting same-ID evidence is retained.
- Concurrent tabs obey per-workspace and per-adult limits. Storage write failures
  retain existing copies, show tab-only status for the failed result and preserve
  the page-close warning. Corrupted and unavailable-key copies remain for retry.
- Online events do not duplicate concurrent retries. Confirmed device/account copies
  permit closing, while deleting a browser copy revokes its local acknowledgement.
- Turning off with unsent copies is blocked until saving or explicit clearing.
  Cancellation keeps copies; confirmed clearing affects only this adult's device
  copies, disables protection and keeps still-visible unsaved work in memory.
- A hung request is aborted at its deadline, exposes a retryable timeout, clears
  its timer and does not prevent a subsequent successful request.
- The generated migration adds one nullable key column. Upgrade testing preserves
  user identities and leaves keys null until the user enables the feature. Existing
  applied migrations are unchanged.

No browser preview, physical-device, real-account login or production load test was
performed in this update. The recovery tests exercise real cryptography with a DOM
harness, not a browser's persistence or eviction guarantees. Full offline reopening,
unfinished drafts and audio remain outside device recovery. Clearing browser data or
closing before acknowledgement can still lose an unsent result.


## Guided AI workflow

13 integration checks in `tests/learning-ai.test.mjs` cover the complete seven-response workflow, private persistence, permission and account boundaries, revocation during inference, idempotency and stale versions, quota persistence after deletion, generated voice, Hindi transcription, malformed inputs and responses, and the main UI controller. Model replies are simulated. Live model inference and mobile audio were not tested; see `docs/ai-workflow.md`.


## Open-source device workflow — 14 September 2026

- The default workflow now uses device inference with Qwen2.5-0.5B-Instruct,
  Whisper-base and local/eSpeak-NG voices. No paid model key is required.
- 14 additional automated tests cover a nine-response/seven-skill flow, private
  storage, authorization, same-origin/account protection, idempotency, stale
  operations, write-time revocation, supported/uncertain answers, Hindi forms,
  generated practice focus, deletion, cancellation, retry without re-inference,
  context-isolated pending saves, escaped printable reports and silent audio.
- The complete suite passes 129 Node scenarios and 136 deep regression checks,
  plus curriculum/scoring coverage over 156 content items and controller checks.
  Session model outputs are simulated; these results do not prove model quality.
- Actual eSpeak-NG 0.3.5 generated non-silent English and Hindi audio at 22050 Hz
  (30924 and 44962 samples for the respective test sentences). This was a Node
  synthesis check, not browser playback or a listening-quality study.
- Actual Qwen and Whisper inference was not verified: model downloads from
  Hugging Face timed out in this environment. Browser model loading, cold/warm
  caching, microphone capture and phone memory/performance still need real-device
  testing. A successful publication does not close these verification gaps.
- Reading/decoding transcript estimates remain unscored, explicit and separate
  from adult-confirmed outcomes. Speaking now requires a recorded response.
- Remaining product gaps include phoneme/prosody/handwriting models, live SMS
  authentication, validated diagnostics, bulk AI backup/restore, older-history
  paging and operational monitoring/retention. See docs/ai-workflow.md.
