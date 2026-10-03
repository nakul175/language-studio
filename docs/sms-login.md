# Mobile SMS login — integration preparation

## Current status

SMS is the selected delivery channel. **Independent SMS login is not enabled.**
The public website still identifies adults through Sites ChatGPT sign-in.

`server/sms-verification.mjs` prepares a server-only Twilio Verify connector. It
is deliberately not imported by the Worker, exposed through an API, or included
in browser code. Adding credentials alone does not enable login. No SMS has been
sent, no provider account has been created, and no live carrier test has run.

The Sites authentication reference requires confirmation of the supported
platform path before implementing app-owned public sign-in or external identity
providers. The currently available reference documents dispatch-owned ChatGPT
sign-in; external SMS authentication support has not been confirmed. A public
Site audience does not by itself establish support for a second login system.

## Prepared connector

- Sends `To` and `Channel=sms` to Twilio Verify over HTTPS from the server.
- Accepts explicit international numbers; the eventual form will default its
  country-code field to India (+91). National-only numbers are not silently
  converted by the connector.
- Checks six-digit codes against the exact provider verification SID.
- Requires an `approved` status bound to the expected account, service, phone
  number, SID and SMS channel. Request acceptance is not delivery or login.
- Rejects wrong, expired, exhausted, canceled, reused and mismatched challenges.
- Preserves code leading zeros; rejects malformed inputs before network calls.
- Applies a ten-second deadline covering response headers and body, limits
  response size, blocks redirects and does not automatically retry SMS sends.
- Returns safe errors without provider messages, phone numbers or credentials.
- Does not implement user identity, rate-limit storage, sessions or permissions.

## External configuration required

Use an organization-controlled Twilio Verify service with six-digit codes and
SMS enabled. Store the following only as protected server runtime settings:

| Setting | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Owning Twilio account |
| `TWILIO_AUTH_TOKEN` | Server authentication secret |
| `TWILIO_VERIFY_SERVICE_SID` | Selected Verify service |

Provider provisioning, billing, allowed destinations and any carrier/sender
requirements for the chosen delivery route must be resolved before activation.
This preparation makes no claim about Indian carrier delivery, registration,
pricing or the availability of a particular sender route.

## Remaining implementation after platform support is confirmed

1. Add an adult phone-number screen, a single accessible code input with numeric
   keyboard/autofill, change-number and bounded resend controls, and honest
   loading/error states. Keep the six-digit code out of URLs and browser storage.
2. Add server-owned challenge records with a random browser-bound identifier,
   phone, provider SID, purpose, expiry, attempt count and consumed state. Consume
   an approved challenge atomically; a provider approval alone grants no access.
3. Enforce persistent per-number and aggregate send/check limits before calling
   the provider. Add a resend cooldown, destination controls and a daily send
   ceiling. Configure provider fraud controls. This connector alone does not
   protect an anonymous endpoint from SMS abuse or repeated code guessing.
4. Create sessions through the confirmed hosting authentication path, with
   expiry, revocation, logout, CSRF protection and account-change handling.
5. Preserve current adult IDs, workspace membership and device-recovery keys.
   Link a verified phone only after proof of both the existing account and the
   phone. Never merge accounts from a supplied email/name or phone text alone.
6. Add phone-bound invitations without weakening the existing email-bound
   invitation, revocation and learner-assignment rules. A phone number being
   verified does not grant access to a classroom or learner.
7. Test duplicate verification, concurrent consumption, wrong-browser use,
   replay, expiry, resend limits, account linking collisions, logout, old tabs,
   parent access and invitation revocation against real database transactions.
8. Run real SMS and hosted session tests on supported phones with a configured
   provider and explicitly authorized test recipients before enabling login.

## Provider documentation

- [Start an SMS verification](https://www.twilio.com/docs/verify/api/verification)
- [Check a verification](https://www.twilio.com/docs/verify/api/verification-check)
- [Service rate limits](https://www.twilio.com/docs/verify/api/service-rate-limits)

The automated connector tests use synthetic provider responses and never contact
Twilio. They establish adapter behavior, not live SMS or login readiness.
