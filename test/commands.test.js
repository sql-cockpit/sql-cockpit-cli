import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cli, ok, KEY, TENANT, MEMBER, TICKET, AGENT, tempHome } from './helpers.js';
import { configPath, readConfig } from '../src/config.js';

const BASE = 'https://portal.sql-cockpit.com/api/portal/v1';

const member = { id: MEMBER, name: 'Ada Lovelace', email: 'ada@example.com', role: 'developer', role_label: 'Developer', status: 'pending_password', joined_at: null, added_at: '2026-11-01T10:00:00Z' };
const ticket = {
  id: TICKET, subject: 'Agent offline', status: 'open', status_label: 'Open', priority: 'high',
  tenant: { id: TENANT, name: 'Acme' }, created_at: '2026-11-19T08:00:00Z', updated_at: '2026-11-20T09:30:00Z',
  portal_url: 'https://portal.sql-cockpit.com/support/1', message: 'It stopped\nreporting.',
  agent: { id: AGENT, name: 'db01', hostname: 'db01.local' }, team_response: 'Looking now.', responded_at: '2026-11-20T09:00:00Z',
  replies: [{ from: 'sql_cockpit_team', body: 'Fixed.', created_at: '2026-11-20T09:30:00Z' }],
};

const routes = {
  'GET /account': ok({ name: 'Ada', email: 'ada@example.com', email_verified: true, billing_account: true, team_member: false, plan: { name: 'Team' }, subscription: { status: 'active', cycle: 'month' }, connected_via: { type: 'api_key', name: 'laptop', scopes: ['portal:read', 'team:write'] }, portal_url: 'https://portal.sql-cockpit.com' }),
  'GET /usage': ok({ plan: 'Team', period: { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' }, allowances: [{ key: 'agents', label: 'Agents', used: 3, limit: 5, remaining: 2, at_limit: false }, { key: 'seats', label: 'Seats', used: 10, unlimited: true }] }),
  'GET /tenants': ok({ tenants: [{ id: TENANT, name: 'Acme', slug: 'acme', your_role: 'owner', status: 'active', agents_count: 2 }] }),
  [`GET /tenants/${TENANT}/members`]: ok({ tenant: { id: TENANT, name: 'Acme' }, owner: { name: 'Owner', email: 'o@example.com' }, members: [member], you_can_manage: true, seats: { used: 2, limit: 5 } }),
  [`POST /tenants/${TENANT}/members`]: ok({ member, message: 'We emailed Ada a link to set a password.' }, 201),
  [`PATCH /tenants/${TENANT}/members/${MEMBER}`]: ok({ member: { ...member, role: 'admin', role_label: 'Admin' } }),
  [`DELETE /tenants/${TENANT}/members/${MEMBER}`]: ok({ removed: true, email: 'ada@example.com', tenant_id: TENANT }),
  [`POST /tenants/${TENANT}/members/${MEMBER}/resend`]: ok({ sent: true, email: 'ada@example.com' }),
  'GET /agents': ok({ agents: [{ id: AGENT, name: 'db01', tenant_name: 'Acme', hostname: 'db01.local', status: 'active', connection: 'online', last_seen_at: '2026-11-20T09:00:00Z' }] }),
  'GET /instances': ok({ instances: [{ id: TENANT, tenant_name: 'Acme', hostname: 'acme.sql-cockpit.com', hosting_mode: 'hosted', status: 'running', revision: 4, applied_revision: 3 }] }),
  'GET /support-tickets': ok({ tickets: [ticket] }),
  [`GET /support-tickets/${TICKET}`]: ok({ ticket }),
  'POST /support-tickets': ok({ ticket }, 201),
};

const requestCases = [
  { argv: ['account'], method: 'GET', url: `${BASE}/account`, out: /Plan:\s+Team/ },
  { argv: ['usage'], method: 'GET', url: `${BASE}/usage`, out: /Agents\s+3\s+5\s+2/ },
  { argv: ['tenant', 'list'], method: 'GET', url: `${BASE}/tenants`, out: /ID\s+NAME\s+SLUG\s+ROLE\s+STATUS\s+AGENTS\n.*Acme\s+acme\s+owner/ },
  { argv: ['team', 'list', TENANT], method: 'GET', url: `${BASE}/tenants/${TENANT}/members`, out: /Seats:\s+2 of 5[\s\S]*ada@example\.com/ },
  {
    argv: ['team', 'add', TENANT, '--name', 'Ada Lovelace', '--email', 'ada@example.com', '--role', 'developer'],
    method: 'POST', url: `${BASE}/tenants/${TENANT}/members`,
    body: { name: 'Ada Lovelace', email: 'ada@example.com', role: 'developer' }, out: /We emailed Ada/,
  },
  {
    argv: ['team', 'role', TENANT, MEMBER, '--role', 'admin', '--yes'], method: 'PATCH', url: `${BASE}/tenants/${TENANT}/members/${MEMBER}`,
    body: { role: 'admin', confirm: true }, out: /Role:\s+Admin/,
  },
  {
    argv: ['team', 'remove', TENANT, MEMBER, '--yes'], method: 'DELETE', url: `${BASE}/tenants/${TENANT}/members/${MEMBER}`,
    body: { confirm: true }, out: /Removed ada@example\.com/,
  },
  { argv: ['team', 'resend', TENANT, MEMBER], method: 'POST', url: `${BASE}/tenants/${TENANT}/members/${MEMBER}/resend`, out: /Sent the set-password email/ },
  { argv: ['agent', 'list'], method: 'GET', url: `${BASE}/agents`, out: /db01\s+Acme\s+db01\.local\s+active\s+online/ },
  { argv: ['agent', 'list', '--tenant', TENANT, '--status', 'active'], method: 'GET', url: `${BASE}/agents?tenant_id=${TENANT}&status=active`, out: /db01/ },
  { argv: ['instance', 'list'], method: 'GET', url: `${BASE}/instances`, out: /hosted\s+running\s+3\/4/ },
  { argv: ['instance', 'list', '--tenant', TENANT], method: 'GET', url: `${BASE}/instances?tenant_id=${TENANT}`, out: /acme\.sql-cockpit\.com/ },
  { argv: ['ticket', 'list'], method: 'GET', url: `${BASE}/support-tickets`, out: /Agent offline\s+open\s+high\s+Acme/ },
  { argv: ['ticket', 'list', '--status', 'waiting_on_customer'], method: 'GET', url: `${BASE}/support-tickets?status=waiting_on_customer`, out: /Agent offline/ },
  { argv: ['ticket', 'get', TICKET], method: 'GET', url: `${BASE}/support-tickets/${TICKET}`, out: /Message:\n {2}It stopped\n {2}reporting\.[\s\S]*Reply from the SQL Cockpit Team/ },
  {
    argv: ['ticket', 'create', '--subject', 'Agent offline', '--message', 'It stopped reporting.'], method: 'POST', url: `${BASE}/support-tickets`,
    body: { subject: 'Agent offline', message: 'It stopped reporting.' }, out: /Opened ticket bbbbbbbb/,
  },
  {
    argv: ['ticket', 'create', '--subject', 'Agent offline', '--message', 'It stopped reporting.', '--tenant', TENANT, '--agent', AGENT], method: 'POST', url: `${BASE}/support-tickets`,
    body: { subject: 'Agent offline', message: 'It stopped reporting.', tenant_id: TENANT, agent_id: AGENT }, out: /Opened ticket/,
  },
];

for (const c of requestCases) {
  test(`request: ${c.argv.join(' ')}`, async () => {
    const r = await cli(c.argv, { routes });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].method, c.method);
    assert.equal(r.calls[0].url, c.url);
    assert.equal(r.calls[0].headers.Authorization, `Bearer ${KEY}`);
    assert.deepEqual(r.calls[0].body, c.body);
    assert.match(r.stdout, c.out);
    assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
  });
}

test('ticket create --message - reads the message from stdin', async () => {
  const r = await cli(['ticket', 'create', '--subject', 'Agent offline', '--message', '-'], { routes, stdin: 'From a pipe, long enough.\n' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls[0].body.message, 'From a pipe, long enough.');
});

test('json and yaml output carry the data, not the envelope', async () => {
  const json = await cli(['tenant', 'list', '-o', 'json'], { routes });
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), routes['GET /tenants'].body.data);
  const yaml = await cli(['tenant', 'list', '--output', 'yaml'], { routes });
  assert.equal(yaml.code, 0);
  assert.match(yaml.stdout, /^tenants:\n- id: 11111111-2222-4333-8444-555555555555\n {2}name: Acme\n/);
  assert.match(yaml.stdout, / {2}agents_count: 2\n/);
});

test('empty lists say so in table output', async () => {
  const r = await cli(['agent', 'list'], { routes: { 'GET /agents': ok({ agents: [] }) } });
  assert.equal(r.stdout, 'No Agents.\n');
});

test('team role and remove refuse without a TTY and without --yes', async () => {
  for (const argv of [['team', 'role', TENANT, MEMBER, '--role', 'admin'], ['team', 'remove', TENANT, MEMBER]]) {
    const r = await cli(argv, { routes, tty: false });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Pass --yes/);
    assert.equal(r.calls.length, 0);
  }
});

test('team remove asks on a TTY; "no" changes nothing', async () => {
  const r = await cli(['team', 'remove', TENANT, MEMBER], { routes, tty: true, confirm: false });
  assert.equal(r.code, 1);
  assert.match(r.prompts[0], /Remove member .* \[y\/N\]/);
  assert.match(r.stderr, /Cancelled/);
  assert.equal(r.calls.length, 0);
});

test('team role asks on a TTY; "yes" sends the change', async () => {
  const r = await cli(['team', 'role', TENANT, MEMBER, '--role', 'operator'], { routes, tty: true, confirm: true });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.prompts[0], /to operator\?/);
  assert.deepEqual(r.calls[0].body, { role: 'operator', confirm: true });
});

test('exit codes: 401 is 3, other API errors are 1, field errors are printed', async () => {
  const unauth = await cli(['account'], { routes: { 'GET /account': { status: 401, body: { ok: false, error: { code: 'unauthenticated', message: 'The key was revoked.' } } } } });
  assert.equal(unauth.code, 3);
  assert.match(unauth.stderr, /error: The key was revoked\./);

  const forbidden = await cli(['team', 'resend', TENANT, MEMBER], { routes: {} });
  assert.equal(forbidden.code, 1);
  assert.match(forbidden.stderr, /Not found/);

  const invalid = await cli(['ticket', 'create', '--subject', 'Hi', '--message', 'short'], {
    routes: { 'POST /support-tickets': { status: 422, body: { ok: false, error: { code: 'validation_failed', message: 'Check the fields.', fields: { subject: ['At least 4 characters.'] } } } } },
  });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /subject: At least 4 characters\./);

  const json = await cli(['account', '-o', 'json'], { routes: { 'GET /account': { status: 429, body: { ok: false, error: { code: 'rate_limited', message: 'Slow down.' } } } } });
  assert.equal(json.code, 1);
  assert.equal(JSON.parse(json.stderr).error.code, 'rate_limited');
});

test('no key at all is an auth error (exit 3) and sends nothing', async () => {
  const r = await cli(['tenant', 'list'], { env: {} });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Not logged in/);
  assert.equal(r.calls.length, 0);
});

test('debug writes method, URL and status to stderr without the key', async () => {
  const r = await cli(['-d', 'account'], { routes });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /debug: > GET https:\/\/portal\.sql-cockpit\.com\/api\/portal\/v1\/account/);
  assert.match(r.stderr, /debug: < 200 GET/);
  assert.ok(!r.stderr.includes(KEY));
  assert.ok(!/bearer/i.test(r.stderr));
});

test('login prompts with hidden input, verifies with GET /account and saves the key', async () => {
  const home = tempHome();
  const r = await cli(['login', '--profile', 'work'], { home, env: {}, tty: true, secret: KEY, routes });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.prompts[0], /API key/);
  assert.equal(r.calls[0].url, `${BASE}/account`);
  assert.equal(r.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.match(r.stdout, /Logged in as Ada <ada@example\.com> \(profile work\)/);
  assert.ok(!r.stdout.includes(KEY));
  const config = readConfig(configPath(home));
  assert.equal(config.profiles.work.api_key, KEY);
  assert.equal(config.default.profile, 'work');
  assert.equal(config.profiles.work.portal_url, undefined);
});

test('login saves a non-default portal URL and reads a piped key', async () => {
  const home = tempHome();
  const r = await cli(['login', '--portal-url', 'https://staging.example.com'], { home, env: {}, stdin: `${KEY}\n`, routes });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls[0].url, 'https://staging.example.com/api/portal/v1/account');
  const config = readConfig(configPath(home));
  assert.equal(config.profiles.default.portal_url, 'https://staging.example.com');
});

test('login refuses a rejected key (exit 3) and saves nothing', async () => {
  const home = tempHome();
  const r = await cli(['login'], { home, env: {}, tty: true, secret: KEY, routes: { 'GET /account': { status: 401, body: { ok: false, error: { code: 'unauthenticated', message: 'Invalid key.' } } } } });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /refused that key/);
  assert.equal(fs.existsSync(configPath(home)), false);
});

test('login with an empty or malformed key is a usage error', async () => {
  const empty = await cli(['login'], { env: {}, tty: true, secret: '' });
  assert.equal(empty.code, 2);
  const bad = await cli(['login'], { env: {}, tty: true, secret: 'nope' });
  assert.equal(bad.code, 2);
  assert.equal(bad.calls.length, 0);
});

test('logout removes the saved key from the active profile', async () => {
  const home = tempHome();
  fs.writeFileSync(configPath(home), `[default]\nprofile = work\n\n[profile work]\napi_key = ${KEY}\nportal_url = https://staging.example.com\n`);
  const r = await cli(['logout'], { home, env: {} });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Removed the API key for profile work/);
  const config = readConfig(configPath(home));
  assert.equal(config.profiles.work.api_key, undefined);
  assert.equal(config.profiles.work.portal_url, 'https://staging.example.com');
  const again = await cli(['logout'], { home, env: {} });
  assert.match(again.stdout, /No saved API key/);
});

test('version and completion', async () => {
  const v = await cli(['version'], { env: {} });
  assert.equal(v.stdout, 'sqlcockpit 0.1.0\n');
  for (const shell of ['bash', 'zsh', 'powershell']) {
    const c = await cli(['completion', shell], { env: {} });
    assert.equal(c.code, 0);
    assert.match(c.stdout, /sqlcockpit/);
    assert.match(c.stdout, /resend/);
    assert.match(c.stdout, /waiting_on_customer/);
  }
});
