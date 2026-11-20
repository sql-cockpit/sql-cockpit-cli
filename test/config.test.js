import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseIni, serializeIni, resolveSettings, writeConfig, readConfig, redactKey, configPath } from '../src/config.js';
import { cli, tempHome, KEY, ok } from './helpers.js';

const FILE_KEY = 'sco_file_key_aaaaaaaaaaaaaaaa1111';
const WORK_KEY = 'sco_work_key_bbbbbbbbbbbbbbbb2222';
const ENV_KEY = 'sco_env_key_cccccccccccccccccc3333';

function homeWith(text) {
  const home = tempHome();
  fs.writeFileSync(configPath(home), text);
  return home;
}

const SAMPLE = `# comment
[default]
profile = work

[profile default]
api_key = ${FILE_KEY}

[profile work]
api_key = ${WORK_KEY}
portal_url = https://staging.example.com
`;

test('parses and re-serialises the INI file', () => {
  const config = parseIni(SAMPLE);
  assert.equal(config.default.profile, 'work');
  assert.equal(config.profiles.default.api_key, FILE_KEY);
  assert.equal(config.profiles.work.portal_url, 'https://staging.example.com');
  assert.deepEqual(parseIni(serializeIni(config)), config);
});

test('the config file lives in the home directory', () => {
  assert.equal(configPath('/home/x'), path.join('/home/x', '.sqlcockpit.conf'));
});

test('file default profile is used when nothing overrides it', () => {
  const home = homeWith(SAMPLE);
  const s = resolveSettings({ flags: {}, env: {}, file: configPath(home) });
  assert.equal(s.profile, 'work');
  assert.equal(s.apiKey, WORK_KEY);
  assert.equal(s.portalUrl, 'https://staging.example.com');
  assert.equal(s.profileSource, 'config file');
});

test('env overrides the file, and flags override env', () => {
  const home = homeWith(SAMPLE);
  const file = configPath(home);
  const env = { SQL_COCKPIT_PROFILE: 'default', SQL_COCKPIT_PORTAL_URL: 'https://env.example.com' };
  let s = resolveSettings({ flags: {}, env, file });
  assert.equal(s.profile, 'default');
  assert.equal(s.apiKey, FILE_KEY);
  assert.equal(s.portalUrl, 'https://env.example.com');

  s = resolveSettings({ flags: {}, env: { ...env, SQL_COCKPIT_API_KEY: ENV_KEY }, file });
  assert.equal(s.apiKey, ENV_KEY);
  assert.equal(s.apiKeySource, 'SQL_COCKPIT_API_KEY');

  s = resolveSettings({ flags: { profile: 'work', 'portal-url': 'https://flag.example.com/api/portal/v1/' }, env, file });
  assert.equal(s.profile, 'work');
  assert.equal(s.apiKey, WORK_KEY);
  assert.equal(s.portalUrl, 'https://flag.example.com');
  assert.equal(s.portalUrlSource, '--portal-url');
});

test('the request uses the key and URL picked by precedence', async () => {
  const home = homeWith(SAMPLE);
  const r = await cli(['account', '--profile', 'default', '--portal-url', 'https://flag.example.com'], {
    home,
    env: { SQL_COCKPIT_PROFILE: 'work' },
    routes: { 'GET /account': ok({ name: 'A' }) },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls[0].url, 'https://flag.example.com/api/portal/v1/account');
  assert.equal(r.calls[0].headers.Authorization, `Bearer ${FILE_KEY}`);
});

test('writes the file with mode 0600', { skip: process.platform === 'win32' }, () => {
  const home = tempHome();
  const file = configPath(home);
  writeConfig(file, { default: { profile: 'x' }, profiles: { x: { api_key: KEY } } });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(readConfig(file).profiles.x.api_key, KEY);
});

test('redactKey keeps only the last four characters', () => {
  assert.equal(redactKey(KEY), '****CRET');
  assert.equal(redactKey('short'), '****');
  assert.equal(redactKey(''), '');
});

test('config command shows the path and profile with the key redacted', async () => {
  const home = homeWith(SAMPLE);
  for (const format of ['table', 'json', 'yaml']) {
    const r = await cli(['config', '-o', format], { home, env: {} });
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes(configPath(home)) || r.stdout.includes(JSON.stringify(configPath(home)).slice(1, -1)));
    assert.match(r.stdout, /work/);
    assert.match(r.stdout, /\*\*\*\*2222/);
    assert.ok(!r.stdout.includes(WORK_KEY), 'key never printed');
    assert.ok(!r.stderr.includes(WORK_KEY));
  }
});

test('config works with no file and no key', async () => {
  const r = await cli(['config'], { env: {} });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /not created yet/);
  assert.match(r.stdout, /API key:\s+not set/);
});
