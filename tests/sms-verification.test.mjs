import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSmsVerification, normalizeSmsPhone, smsVerificationConfiguration } from '../server/sms-verification.mjs';

// Synthetic provider fixtures. No test calls a carrier or sends a message.
const env = { TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'b'.repeat(32), TWILIO_VERIFY_SERVICE_SID: `VA${'c'.repeat(32)}` };
const phone = '+919876543210', verificationId = `VE${'d'.repeat(32)}`;
const record = (overrides = {}) => ({ sid: verificationId, to: phone, account_sid: env.TWILIO_ACCOUNT_SID, service_sid: env.TWILIO_VERIFY_SERVICE_SID, channel: 'sms', status: 'pending', ...overrides });
const input = { phone, verificationId, code: '012345' };
const errorCode = code => error => error.code === code;
const fake = (data, init) => async () => Response.json(data, init);

test('normalizes explicit country codes and rejects ambiguous or malformed numbers', () => {
  assert.equal(normalizeSmsPhone('+91 (98765) 43210'), phone);
  assert.equal(normalizeSmsPhone('+1 202-555-0123'), '+12025550123');
  for (const value of ['9876543210', '00919876543210', '+0919876543210', '+91+9876543210', '+91 98765 43210 ext 1', '+९१९८७६५४३२१०', '+123', '+1234567890123456', null, {}, 919876543210]) {
    assert.throws(() => normalizeSmsPhone(value), errorCode('INVALID_PHONE'));
  }
});

test('missing or malformed configuration prevents any network request and exposes no secret', async () => {
  assert.deepEqual(smsVerificationConfiguration(env), { configured: true, missing: [] });
  for (const key of Object.keys(env)) {
    let calls = 0;
    const malformed = { ...env, [key]: 'secret-invalid-value' };
    assert.deepEqual(smsVerificationConfiguration(malformed), { configured: false, missing: [key] });
    const sms = createSmsVerification(malformed, { fetch: async () => { calls++; throw Error('Unexpected call'); } });
    await assert.rejects(sms.start(phone), errorCode('SMS_NOT_CONFIGURED'));
    await assert.rejects(sms.check(input), errorCode('SMS_NOT_CONFIGURED'));
    assert.equal(calls, 0);
    assert.ok(!JSON.stringify(smsVerificationConfiguration(malformed)).includes('secret-invalid-value'));
  }
});

test('sends an SMS request only to the fixed provider endpoint and returns minimal pending state', async () => {
  let calls = 0;
  const mutable = { ...env };
  const sms = createSmsVerification(mutable, { fetch: async (url, options) => {
    calls++;
    assert.equal(url, `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), { To: phone, Channel: 'sms' });
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(record({ extra: 'not returned' }));
  } });
  mutable.TWILIO_VERIFY_SERVICE_SID = `VA${'e'.repeat(32)}`;
  assert.deepEqual(await sms.start('+91 98765 43210'), { verificationId, phone, status: 'pending' });
  assert.equal(calls, 1);
});

test('check uses the exact verification SID and preserves a leading zero in the code', async () => {
  const sms = createSmsVerification(env, { fetch: async (url, options) => {
    assert.ok(url.endsWith('/VerificationCheck'));
    assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), { VerificationSid: verificationId, Code: '012345' });
    return Response.json(record({ status: 'approved', valid: false }));
  } });
  assert.deepEqual(await sms.check(input), { approved: true, phone, verificationId });
});

test('rejects malformed codes and challenge identifiers before contacting the provider', async () => {
  let calls = 0;
  const sms = createSmsVerification(env, { fetch: async () => { calls++; } });
  for (const code of [123456, '12345', '1234567', ' 123456', '123 456', '१२३४५६', null]) await assert.rejects(sms.check({ ...input, code }), errorCode('INVALID_CODE'));
  for (const value of ['anything', '../Verifications', `VE${'x'.repeat(32)}`, null]) await assert.rejects(sms.check({ ...input, verificationId: value }), errorCode('INVALID_VERIFICATION'));
  await assert.rejects(sms.start('9876543210'), errorCode('INVALID_PHONE'));
  assert.equal(calls, 0);
});

test('an approval for another phone, service, account, channel or SID cannot verify this challenge', async () => {
  for (const overrides of [
    { to: '+919876543211' }, { service_sid: `VA${'e'.repeat(32)}` },
    { account_sid: `AC${'e'.repeat(32)}` }, { channel: 'email' },
    { sid: `VE${'e'.repeat(32)}` }, { sid: 'invalid' }, { to: null },
  ]) {
    const sms = createSmsVerification(env, { fetch: fake(record({ status: 'approved', ...overrides })) });
    await assert.rejects(sms.check(input), errorCode('SMS_UNAVAILABLE'));
  }
});

test('request acceptance is never treated as code approval and validates the response identity', async () => {
  for (const overrides of [{ status: 'approved' }, { status: 'failed' }, { to: '+919876543211' }, { channel: 'whatsapp' }, { service_sid: null }, { account_sid: null }, { sid: null }]) {
    const sms = createSmsVerification(env, { fetch: fake(record(overrides)) });
    await assert.rejects(sms.start(phone), errorCode('SMS_UNAVAILABLE'));
  }
});

test('incorrect, expired and exhausted codes never pass, including a misleading legacy valid flag', async () => {
  const cases = { pending: 'incorrect_code', expired: 'expired_or_used', canceled: 'expired_or_used', deleted: 'expired_or_used', failed: 'expired_or_used', max_attempts_reached: 'attempts_exhausted' };
  for (const [status, reason] of Object.entries(cases)) {
    const sms = createSmsVerification(env, { fetch: fake(record({ status, valid: true })) });
    assert.deepEqual(await sms.check(input), { approved: false, reason });
  }
  await assert.rejects(createSmsVerification(env, { fetch: fake(record({ status: 'unknown' })) }).check(input), errorCode('SMS_UNAVAILABLE'));
});

test('an expired or consumed provider challenge fails closed', async () => {
  const sms = createSmsVerification(env, { fetch: fake({ message: 'private provider detail' }, { status: 404 }) });
  assert.deepEqual(await sms.check(input), { approved: false, reason: 'expired_or_used' });
  await assert.rejects(sms.start(phone), errorCode('SMS_UNAVAILABLE'));
});

test('rate limiting keeps a bounded retry delay and never automatically resends', async () => {
  for (const [header, expected] of [['90', 90], ['0', 1], ['9999', 3600], ['-1', 60], ['invalid', 60]]) {
    let calls = 0;
    const sms = createSmsVerification(env, { fetch: async () => { calls++; return Response.json({ message: phone }, { status: 429, headers: { 'Retry-After': header } }); } });
    await assert.rejects(sms.start(phone), error => error.code === 'SMS_RATE_LIMITED' && error.status === 429 && error.retryAfter === expected && !error.message.includes(phone));
    assert.equal(calls, 1);
  }
});

test('provider failures never leak phone numbers, codes, credentials or upstream error text', async () => {
  const privateText = `${phone} ${input.code} ${env.TWILIO_AUTH_TOKEN}`;
  const fetches = [async () => { throw Error(privateText); }, ...[400, 401, 403, 500, 502].map(status => fake({ message: privateText }, { status }))];
  for (const fetch of fetches) {
    const sms = createSmsVerification(env, { fetch });
    await assert.rejects(sms.check(input), error => {
      assert.equal(error.code, 'SMS_UNAVAILABLE');
      assert.equal(error.cause, undefined);
      assert.ok(!String(error).includes(phone));
      assert.ok(!String(error).includes(input.code));
      assert.ok(!JSON.stringify(error).includes(env.TWILIO_AUTH_TOKEN));
      return true;
    });
  }
});

test('malformed, empty and oversized responses fail closed', async () => {
  for (const fetch of [fake(null), fake([]), fake('approved'), async () => new Response('not json'), async () => new Response(null, { status: 204 }), fake(record({ extra: 'x'.repeat(40000) })), async () => new Response('{}', { headers: { 'Content-Length': '9999999' } })]) {
    await assert.rejects(createSmsVerification(env, { fetch }).check(input), errorCode('SMS_UNAVAILABLE'));
  }
});

test('deadline covers stalled request headers and a stalled response body', async () => {
  for (const bodyStall of [false, true]) {
    let signal, calls = 0;
    const sms = createSmsVerification(env, { timeoutMs: 15, fetch: async (_url, options) => {
      calls++; signal = options.signal;
      if (bodyStall) return new Response(new ReadableStream({ start() {} }));
      return new Promise(() => {});
    } });
    await assert.rejects(sms.start(phone), errorCode('SMS_TIMEOUT'));
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
  }
});

test('provider preparation is not exposed as login, an anonymous API or browser code', async () => {
  for (const path of ['../server/index.mjs', '../server/api.mjs', '../src/cloud.js', '../dist/index.html', '../dist/server/index.js']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.ok(!source.includes('createSmsVerification'), path);
    assert.ok(!source.includes('TWILIO_AUTH_TOKEN'), path);
  }
});
