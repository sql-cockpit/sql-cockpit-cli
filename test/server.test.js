import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { KEY, TENANT, tempHome } from './helpers.js';
import { configPath } from '../src/config.js';

const BIN = fileURLToPath(new URL('../bin/sqlcockpit.js', import.meta.url));
let server;
let baseUrl;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { ok: false, error: { code: 'unauthenticated', message: 'Invalid key.' } });
    if (req.url === '/api/portal/v1/account') return send(200, { ok: true, data: { name: 'Ada', email: 'ada@example.com' } });
    if (req.url === '/api/portal/v1/tenants') return send(200, { ok: true, data: { tenants: [{ id: TENANT, name: 'Acme', slug: 'acme', your_role: 'owner', status: 'active', agents_count: 1 }] } });
    if (req.url === '/api/portal/v1/usage') return send(302, '', { location: 'https://example.com/' });
    if (req.url === '/api/portal/v1/agents') return send(200, `{"ok":true,"data":{"pad":"${'x'.repeat(3 * 1024 * 1024)}"}}`);
    return send(404, { ok: false, error: { code: 'not_found', message: 'Not found.' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function runBin(args, { env = {}, input } = {}) {
  const home = env.HOME ?? tempHome();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, HOME: home, USERPROFILE: home, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end(input ?? '');
    child.on('close', (code) => resolve({ code, stdout, stderr, home }));
  });
}

test('end to end against a local server: tenant list', async () => {
  const r = await runBin(['tenant', 'list', '--portal-url', baseUrl], { env: { SQL_COCKPIT_API_KEY: KEY } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Acme\s+acme\s+owner/);
  assert.equal(seen.at(-1).url, '/api/portal/v1/tenants');
});

test('end to end: login from a pipe writes the config, then account uses it', async () => {
  const home = tempHome();
  const login = await runBin(['login', '--portal-url', baseUrl], { env: { HOME: home }, input: `${KEY}\n` });
  assert.equal(login.code, 0, login.stderr);
  assert.ok(fs.readFileSync(configPath(home), 'utf8').includes(`portal_url = ${baseUrl}`));
  const account = await runBin(['account', '-o', 'json'], { env: { HOME: home } });
  assert.equal(account.code, 0, account.stderr);
  assert.equal(JSON.parse(account.stdout).name, 'Ada');
  assert.ok(!account.stdout.includes(KEY) && !account.stderr.includes(KEY));
});

test('end to end: wrong key exits 3, redirect and oversized responses exit 1', async () => {
  const wrong = await runBin(['account', '--portal-url', baseUrl], { env: { SQL_COCKPIT_API_KEY: 'sco_wrong_key_000000000000000' } });
  assert.equal(wrong.code, 3);
  const redirect = await runBin(['usage', '--portal-url', baseUrl], { env: { SQL_COCKPIT_API_KEY: KEY } });
  assert.equal(redirect.code, 1);
  assert.match(redirect.stderr, /redirect/);
  const big = await runBin(['agent', 'list', '--portal-url', baseUrl], { env: { SQL_COCKPIT_API_KEY: KEY } });
  assert.equal(big.code, 1);
  assert.match(big.stderr, /too large/);
});

test('end to end: team remove without a TTY and without --yes exits 2 and sends nothing', async () => {
  const before = seen.length;
  const r = await runBin(['team', 'remove', TENANT, TENANT, '--portal-url', baseUrl], { env: { SQL_COCKPIT_API_KEY: KEY } });
  assert.equal(r.code, 2);
  assert.equal(seen.length, before);
});
