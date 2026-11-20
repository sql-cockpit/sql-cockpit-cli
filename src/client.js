import { ApiError, UsageError, AuthError } from './errors.js';
import { VERSION } from './version.js';

export const DEFAULT_PORTAL_URL = 'https://portal.sql-cockpit.com';
export const API_PREFIX = '/api/portal/v1';
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 20000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new UsageError(`${label} must be a UUID, like 3f2b1c4d-0000-4000-8000-000000000000.`);
  return value.toLowerCase();
}

/**
 * HTTPS only, except loopback addresses for local development. No credentials, query or fragment.
 * Accepts the portal origin (https://portal.sql-cockpit.com) or the full API base ending in /api/portal/v1.
 */
export function normalizePortalUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_PORTAL_URL).trim());
  } catch {
    throw new UsageError('The portal URL is not a valid URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new UsageError('The portal URL must not contain credentials, a query string or a fragment.');
  }
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new UsageError('The portal URL must use https:// (http:// is only allowed for localhost).');
  }
  let text = url.toString().replace(/\/+$/, '');
  if (text.toLowerCase().endsWith(API_PREFIX)) text = text.slice(0, -API_PREFIX.length);
  return text;
}

export function normalizeApiKey(value) {
  const key = String(value ?? '').trim();
  if (!key) {
    throw new AuthError('Not logged in. Run `sqlcockpit login` or set SQL_COCKPIT_API_KEY.', 'not_logged_in');
  }
  if (key.length < 20 || key.length > 200 || /\s/.test(key)) {
    throw new AuthError('The API key does not look like a SQL Cockpit portal API key.', 'invalid_key');
  }
  return key;
}

/** Talks to /api/portal/v1 with a portal API key. Never logs or serialises the key. */
export class PortalClient {
  constructor({ portalUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, debug = null }) {
    this.baseUrl = normalizePortalUrl(portalUrl);
    Object.defineProperty(this, 'apiKey', { value: normalizeApiKey(apiKey), enumerable: false });
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.debug = typeof debug === 'function' ? debug : null;
  }

  url(path, query) {
    if (!/^\/[a-z0-9/_-]*$/i.test(path)) {
      throw new ApiError('invalid_path', 'Refusing to call an unexpected portal path.');
    }
    const url = new URL(`${this.baseUrl}${API_PREFIX}${path}`);
    for (const [name, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    return url;
  }

  async request(method, path, { query, body } = {}) {
    const url = this.url(path, query);
    const started = Date.now();
    this.debug?.(`> ${method} ${url.toString()}`);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response;
    try {
      response = await this.fetch(url, {
        method,
        redirect: 'manual',
        signal: timeout,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'User-Agent': `sqlcockpit-cli/${VERSION} node/${process.versions.node}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      if (timeout.aborted) {
        this.debug?.(`< timeout after ${Date.now() - started} ms`);
        throw new ApiError('timeout', 'The SQL Cockpit portal did not answer in time. Try again shortly.');
      }
      this.debug?.('< network error');
      throw new ApiError('unreachable', 'Could not reach the SQL Cockpit portal. Check the portal URL and your connection.');
    }
    this.debug?.(`< ${response.status} ${method} ${url.toString()} (${Date.now() - started} ms)`);

    if (response.status >= 300 && response.status < 400) {
      await discard(response);
      throw new ApiError('unexpected_redirect', 'The portal answered with a redirect, which sqlcockpit does not follow. Check the portal URL.', response.status);
    }

    const text = await readLimited(response);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('invalid_response', `The portal returned an unexpected response (HTTP ${response.status}).`, response.status);
    }

    if (!response.ok || payload?.ok !== true) {
      const error = payload?.error && typeof payload.error === 'object' ? payload.error : {};
      let message = typeof error.message === 'string' ? error.message : `The portal request failed (HTTP ${response.status}).`;
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retry) && retry > 0) message += ` Try again in ${retry} seconds.`;
      }
      throw new ApiError(
        typeof error.code === 'string' ? error.code : 'request_failed',
        message,
        response.status,
        error.fields && typeof error.fields === 'object' ? error.fields : undefined,
      );
    }
    return payload.data;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }
}

async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {
    // ignore
  }
}

/** Reads the body up to MAX_RESPONSE_BYTES and stops reading as soon as it goes over. */
export async function readLimited(response, limit = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) {
    await discard(response);
    throw new ApiError('response_too_large', 'The portal response was too large.', response.status);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) throw new ApiError('response_too_large', 'The portal response was too large.', response.status);
    return buffer.toString('utf8');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new ApiError('response_too_large', 'The portal response was too large.', response.status);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}
