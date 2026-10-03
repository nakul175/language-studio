# Guided AI learning workflow

The main learner screen starts a guided session. Adults select the learner, English or Hindi, and starting activity level, then confirm permission. They do not select models, write AI prompts, or grade each response.

## Default open-source workflow

1. The browser downloads Qwen2.5-0.5B-Instruct through Transformers.js and confirms that it loaded before creating a session.
2. Seven checks cover oral reading, decoding, vocabulary, comprehension, listening, speaking and typed writing. Initial questions come from the original prepared curriculum, with alternate forms on subsequent sessions.
3. Recorded/uploaded speech is decoded to 16 kHz mono and transcribed locally by Whisper-base. The passage is never supplied as a transcription prompt. Reading, decoding and speaking require speech; writing requires typed text. Silent or invalid audio is rejected before inference.
4. Qwen assesses each response against the activity and rubric. Unknown or malformed model output never becomes a fabricated grade. Adult help caps the provisional score. Speech-to-text cannot assess individual speech sounds, pronunciation or prosody: reading/decoding stay unscored, with separate provisional transcript alignment metrics.
5. The server selects the lowest scored check for two practice activities. Qwen generates practice for that skill; a malformed generation falls back to a prepared activity. This fallback affects activity content, never assessment scores.
6. Questions and listening passages use an installed local system voice, or eSpeak-NG English/Hindi synthesis. The final report shows responses, feedback, provisional strengths/gaps, unassessed areas and transcript estimates. It downloads as printable HTML or session JSON.

This is an instructional workflow, not a validated diagnostic or placement test. The small language model has no demonstrated accuracy for this curriculum or children's Hindi responses. There is no phoneme assessment, handwriting recognition or OCR workflow. Adult supervision remains necessary; prompts cannot guarantee safe or correct model output.

## Runtime and privacy

Transformers.js 3.8.1 uses WASM with one CPU thread. Qwen uses q4 weights; Whisper uses q8. Model repositories are on Hugging Face; JavaScript/WASM and the eSpeak data package load from pinned jsDelivr package versions. Model repository revisions currently track their default branch. A first download is several hundred MB and can take minutes. A capable desktop browser is recommended; low-memory phones may fail. Dependencies and public model files may be cached by the browser, but the app is not fully offline.

Audio is decoded/transcribed on the device and is never included in the `/open-session` request. Text responses, transcripts and feedback are saved in D1. Public file hosts receive ordinary download connection metadata, not learner recordings. Recordings remain in memory until cleared or the session closes. There is no model training or fine-tuning workflow.

Each session belongs to its creating adult within an authorized learner/workspace context. Other adults do not automatically see that session. Reads and atomic writes recheck current membership and learner assignment. Expected-account and same-origin JSON checks protect mutations. Clients cannot write these model scores into adult-confirmed learning records. Client inference is not remotely attested; stored outputs are explicitly marked `device-model-output-unverified`.

Each step has an idempotency key and session version. A failed save retains the exact response/feedback payload in the current tab, with **Retry saving feedback** / **Save waiting result**, without rerunning a model. Pending work is isolated by adult, workspace, learner, language and level. Closing the browser before a save loses that pending payload; there is a close warning. Pending feedback can also be downloaded or explicitly discarded. This queue is not the legacy encrypted completed-result recovery feature. Saved steps can be resumed after reopening.

The interface loads the latest 50 AI sessions for this adult and learner, then filters to language/level. Older sessions have no paging UI yet. The workspace allows 500 AI sessions. Users can delete their own completed or unfinished sessions; administrator deletion of a learner cascades all related sessions. AI reports/JSON downloads are separate from legacy workspace backups and currently have no bulk restore/import. Automated retention, operational dashboards and full workspace AI exports remain work to do.

## Optional cloud implementation

The prior `/ai-session` endpoint remains available in source with its existing tests and server-only OpenAI configuration. The default UI calls `/open-session` and does not require or send an OpenAI key. Existing cloud sessions remain stored but do not appear in the device-session list. No server GPU or hosted open-model endpoint has been provisioned.

## Verification boundary — 14 September 2026

The API tests run complete nine-response English/Hindi session flows against a real SQLite database, with simulated client model outputs. They cover ownership, parent assignments, consent, same-origin and expected-account checks, revocation at the write, idempotency, stale versions, source validation, practice targeting and deletion. Controller checks cover cancellation and save recovery. These are orchestration checks, not model-quality evidence.

The actual eSpeak-NG 0.3.5 runtime generated non-silent English and Hindi PCM audio at 22050 Hz in Node. Transformers.js package assets were inspected. Fetching Hugging Face model files from the development environment timed out, so **actual Qwen and Whisper inference, full browser model downloads, microphone behavior, end-to-end classroom use and mobile performance remain unverified**. Do not describe this as fully functional in every aspect or production ready until those gates and representative educator/child validation have been completed.
