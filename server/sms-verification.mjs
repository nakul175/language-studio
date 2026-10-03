// Server-only SMS delivery/check adapter. It does not authenticate an app user,
// grant workspace access, create a session, or expose an HTTP route.
// Keep disconnected until the hosting authentication path is confirmed.
const VERIFY_ORIGIN = 'https://verify.twilio.com';
const MAX_RESPONSE_BYTES = 32 * 1024;
const sid = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}[a-fA-F0-9]{32}$`).test(value);

export class SmsVerificationError extends Error {
  constructor(code, message, status = 503, retryAfter = null) {
    super(message);
    this.name = 'SmsVerificationError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const unavailable = () => new SmsVerificationError('SMS_UNAVAILABLE', 'SMS verification is unavailable. Try again later.');

export function normalizeSmsPhone(value) {
  if (typeof value !== 'string' || value.length > 48 || !/^[+\d ()-]+$/.test(value)) {
    throw new SmsVerificationError('INVALID_PHONE', 'Enter a mobile number with its country code.', 400);
  }
  const phone = value.replace(/[ ()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new SmsVerificationError('INVALID_PHONE', 'Enter a mobile number with its country code.', 400);
  }
  return phone;
}

export function smsVerificationConfiguration(env = {}) {
  const missing = [];
  if (!sid(env.TWILIO_ACCOUNT_SID, 'AC')) missing.push('TWILIO_ACCOUNT_SID');
  if (typeof env.TWILIO_AUTH_TOKEN !== 'string' || !/^[a-fA-F0-9]{32}$/.test(env.TWILIO_AUTH_TOKEN)) missing.push('TWILIO_AUTH_TOKEN');
  if (!sid(env.TWILIO_VERIFY_SERVICE_SID, 'VA')) missing.push('TWILIO_VERIFY_SERVICE_SID');
  return { configured: missing.length === 0, missing };
}

async function readJson(response) {
  if (!response.body || Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) throw unavailable();
  const reader = response.body.getReader();
  let size = 0;
  const parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw unavailable();
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
  return data;
}

export function createSmsVerification(env = {}, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) throw new TypeError('Invalid SMS request timeout.');
  // Copy configuration so later mutation cannot redirect or rebind a request.
  const config = {
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_VERIFY_SERVICE_SID: env.TWILIO_VERIFY_SERVICE_SID,
  };

  async function request(resource, fields) {
    if (!smsVerificationConfiguration(config).configured) {
      throw new SmsVerificationError('SMS_NOT_CONFIGURED', 'SMS verification has not been configured.');
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SmsVerificationError('SMS_TIMEOUT', 'The SMS service did not respond in time. Try again later.'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(`${VERIFY_ORIGIN}/v2/Services/${config.TWILIO_VERIFY_SERVICE_SID}/${resource}`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: {
            Authorization: `Basic ${btoa(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
          },
          body: new URLSearchParams(fields).toString(),
        });
        if (response.status === 429) {
          const raw = response.headers.get('Retry-After');
          const delay = raw && /^\d{1,4}$/.test(raw) ? Math.max(1, Math.min(3600, Number(raw))) : 60;
          void response.body?.cancel().catch(() => {});
          throw new SmsVerificationError('SMS_RATE_LIMITED', 'Too many attempts. Wait before trying again.', 429, delay);
        }
        if (response.status === 404 && resource === 'VerificationCheck') {
          void response.body?.cancel().catch(() => {});
          return { expiredOrUsed: true };
        }
        if (!response.ok || response.redirected) {
          void response.body?.cancel().catch(() => {});
          throw unavailable();
        }
        return await readJson(response);
      })()]);
    } catch (error) {
      // Provider bodies/errors can contain phone numbers, codes or credentials.
      // Never expose the original message, response body, URL or error cause.
      if (error instanceof SmsVerificationError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  function matches(data, phone, verificationId) {
    return sid(data.sid, 'VE') && (!verificationId || data.sid === verificationId)
      && data.account_sid === config.TWILIO_ACCOUNT_SID
      && data.service_sid === config.TWILIO_VERIFY_SERVICE_SID
      && data.to === phone && data.channel === 'sms';
  }

  return Object.freeze({
    async start(phoneInput) {
      const phone = normalizeSmsPhone(phoneInput);
      const data = await request('Verifications', { To: phone, Channel: 'sms' });
      if (!matches(data, phone) || data.status !== 'pending') throw unavailable();
      // Pending means the provider accepted a request, not that an SMS arrived.
      return { verificationId: data.sid, phone, status: 'pending' };
    },
    async check({ phone: phoneInput, verificationId, code } = {}) {
      const phone = normalizeSmsPhone(phoneInput);
      if (!sid(verificationId, 'VE')) throw new SmsVerificationError('INVALID_VERIFICATION', 'Request a new SMS code.', 400);
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new SmsVerificationError('INVALID_CODE', 'Enter the six-digit SMS code.', 400);
      const data = await request('VerificationCheck', { VerificationSid: verificationId, Code: code });
      if (data.expiredOrUsed === true) return { approved: false, reason: 'expired_or_used' };
      if (!matches(data, phone, verificationId)) throw unavailable();
      if (data.status === 'approved') return { approved: true, phone, verificationId };
      if (data.status === 'pending') return { approved: false, reason: 'incorrect_code' };
      if (data.status === 'max_attempts_reached') return { approved: false, reason: 'attempts_exhausted' };
      if (['expired', 'canceled', 'deleted', 'failed'].includes(data.status)) return { approved: false, reason: 'expired_or_used' };
      throw unavailable();
    },
  });
}
