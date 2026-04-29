'use strict';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

function getSiteKey() {
  return process.env.TURNSTILE_SITE_KEY || null;
}

function getSecretKey() {
  return process.env.TURNSTILE_SECRET_KEY || null;
}

function isConfigured() {
  return Boolean(getSiteKey() && getSecretKey());
}

async function verify(token, remoteIp) {
  if (!isConfigured()) {
    return { ok: true, skipped: true };
  }

  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'captcha_failed' };
  }

  const body = new URLSearchParams();
  body.set('secret', getSecretKey());
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, reason: 'captcha_unavailable' };
    }
    const data = await res.json();
    if (data && data.success === true) {
      return { ok: true };
    }
    return { ok: false, reason: 'captcha_failed' };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: 'captcha_unavailable' };
  }
}

module.exports = {
  isConfigured,
  getSiteKey,
  verify,
};
