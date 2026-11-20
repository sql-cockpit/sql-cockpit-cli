import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortalClient, normalizePortalUrl, normalizeApiKey, MAX_RESPONSE_BYTES } from '../src/client.js';
import { ApiError, AuthError, UsageError } from '../src/errors.js';
import { fakeFetch, KEY, ok } from './helpers.js';

test('portal URL: https only, localhost http allowed, API suffix trimmed', () => {
  assert.equal(normalizePortalUrl(undefined), 'https://portal.sql-cockpit.com');
  assert.equal(normalizePortalUrl('https://portal.sql-cockpit.com/api/portal/v1'), 'https://portal.sql-cockpit.com');
  assert.equal(normalizePortalUrl('http://localhost:8000/'), 'http://localhost:8000');
  assert.equal(normalizePortalUrl('http://127.0.0.1:9'), 'http://127.0.0.1:9');
  assert.equal(normalizePortalUrl('http://[::1]:9'), 'http://[::1]:9');
  assert.throws(() => normalizePortalUrl('http://portal.sql-cockpit.com'), UsageError);
  assert.throws(() => normalizePortalUrl('ftp://x'), UsageError);
  assert.throws(() => normalizePortalUrl('https://x.com/?a=1'), UsageError);
  assert.throws(() => normalizePortalUrl('not a url'), UsageError);
});

test('API key checks', () => {
  assert.equal(normalizeApiKey(`  ${KEY} `), KEY);
  assert.throws(() => normalizeApiKey(''), AuthError);
  assert.throws(() => normalizeApiKey('short'), AuthError);
  assert.throws(() => normalizeApiKey('has a space in it 12345678901234'), AuthError);
});

test('sends bearer key, refuses redirects, unwraps data', async () => {
  const { fetch, calls } = fakeFetch({ 'GET /account': ok({ name: 'Ada' }) });
  const client = new PortalClient({ portalUrl: 'https://p.example.com', apiKey: KEY, fetchImpl: fetch });
  assert.deepEqual(await client.get('/account'), { name: 'Ada' });
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].headers.Accept, 'application/json');
  assert.equal(calls[0].redirect, 'manual');
  assert.match(calls[0].headers['User-Agent'], /^sqlcockpit-cli\/0\.1\.0/);
});

test('the key is not enumerable, so it never ends up in JSON or inspect', () => {
  const client = new PortalClient({ portalUrl: 'https://p.example.com', apiKey: KEY, fetchImpl: async () => {} });
  assert.ok(!JSON.stringify(client).includes(KEY));
  assert.ok(!Object.keys(client).includes('apiKey'));
});

test('a redirect is an error', async () => {
  const { fetch } = fakeFetch({ 'GET /account': { status: 302, raw: '', headers: { location: 'https://evil.example.com' } } });
  const client = new PortalClient({ portalUrl: 'https://p.example.com', apiKey: KEY, fetchImpl: fetch });
  await assert.rejects(client.get('/account'), (e) => e instanceof ApiError && e.code === 'unexpected_redirect');
});

test('responses over 2 MiB are refused (declared and streamed)', async () => {
  const big = 'x'.repeat(MAX_RESPONSE_BYTES + 10);
  const declared = fakeFetch({ 'GET /account': { raw: '{}', headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } } });
  const streamed = fakeFetch({ 'GET /account': { raw: big } });
  for (const { fetch } of [declared, streamed]) {
    const client = new PortalClient({ portalUrl: 'https://p.example.com', apiKey: KEY, fetchImpl: fetch });
    await assert.rejects(client.get('/account'), (e) => e.code === 'response_too_large');
  }
});

test('error envelopes become ApiError with code, fields and exit code', async () => {
  const { fetch } = fakeFetch({
    'GET /account': { status: 401, body: { ok: false, error: { code: 'unauthenticated', message: 'Bad key.' } } },
    'POST /support-tickets': { status: 422, body: { ok: false, error: { code: 'validation_failed', message: 'Check the fields.', fields: { subject: ['Too short.'] } } } },
    'GET /tenants': { status: 429, headers: { 'retry-after': '30' }, body: { ok: false, error: { code: 'rate_limited', message: 'Slow down.' } } },
    'GET /usage': { status: 500, raw: '<html>oops' },
  });
  const client = new PortalClient({ portalUrl: 'https://p.example.com', apiKey: KEY, fetchImpl: fetch });
  await assert.rejects(client.get('/account'), (e) => e.code === 'unauthenticated' && e.exitCode === 3);
  await assert.rejects(client.request('POST', '/support-tickets', { body: {} }), (e) => e.exitCode === 1 && e.fields.subject[0] === 'Too short.');
  await assert.rejects(client.get('/tenants'), (e) => e.code === 'rate_limited' && /30 seconds/.test(e.message));
  await assert.rejects(client.get('/usage'), (e) => e.code === 'invalid_response');
});

test('network failure and unexpected paths', async () => {
  const { fetch } = fakeFetch({ 'GET /account': { throw: true } });
  const client = new PortalClient({ portalUrl: 'https://p.example.com', apiKey: KEY, fetchImpl: fetch });
  await assert.rejects(client.get('/account'), (e) => e.code === 'unreachable');
  await assert.rejects(client.get('/../admin?x'), (e) => e.code === 'invalid_path');
});

test('debug logs method, URL and status but never headers or the key', async () => {
  const lines = [];
  const { fetch } = fakeFetch({ 'GET /agents': ok({ agents: [] }) });
  const client = new PortalClient({ portalUrl: 'https://p.example.com', apiKey: KEY, fetchImpl: fetch, debug: (l) => lines.push(l) });
  await client.get('/agents', { status: 'active' });
  const text = lines.join('\n');
  assert.match(text, /> GET https:\/\/p\.example\.com\/api\/portal\/v1\/agents\?status=active/);
  assert.match(text, /< 200 GET/);
  assert.ok(!text.includes(KEY));
  assert.ok(!/authorization|bearer/i.test(text));
});
