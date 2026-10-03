# GitHub import — 3 October 2026

This repository contains the Language Studio source published as Sites version 11 on 14 September 2026.

- Original source commit: `c8af7360a70a7b7d60ce3290fc3f9e88668fef4d`.
- Original source tree: `00c4d0e558877ca3a04e705197e7e441124d53ea`.
- All 75 original tracked files were copied byte-for-byte; the uploaded source tree matched that Git tree hash before adding this note and the history archive.
- The original 11-commit Git history is preserved in `archive/language-studio-history.bundle`. GitHub's main branch starts with a new import commit; original commit IDs are inside the bundle.
- The original history was checked for common private-key and API-token patterns before upload. This is not a comprehensive security audit.
- No production database, learner records, credentials, model weights or installed dependencies were copied.
- The public application remains at https://language-studio.nakul1729233.chatgpt.site. Copying source to GitHub does not configure GitHub deployment or migrate the Sites-owned D1 database.

## Restore the original history

From a clone of this GitHub repository:

```sh
git clone archive/language-studio-history.bundle ../language-studio-original-history
```

## Build and tests

Follow README.md. Use Node 24 or newer, then `npm ci`, `npm run build`, and `npm test`. No code or schema changes were made as part of this import, and tests were not rerun for the byte-identical copy.

The last recorded run passed 129 Node scenarios, 136 deep regression checks and curriculum/controller checks. These are historical results, not a new run on 3 October.

## Known incomplete capabilities

See docs/ai-workflow.md, docs/sms-login.md and tests/QA.md. Qwen and Whisper real inference was not verified in the earlier environment because model downloads timed out. Actual eSpeak English/Hindi synthesis was verified. SMS login, specialist pronunciation/handwriting assessment, validated diagnostics and several operational controls remain incomplete. Hosting authentication currently requires the Sites dispatcher; an arbitrary host must not trust incoming identity headers.

Model/runtime licenses and source links are in THIRD_PARTY.md.
