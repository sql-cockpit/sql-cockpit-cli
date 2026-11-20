import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandLine } from '../src/cli.js';
import { cli, TENANT } from './helpers.js';

test('parses a command, subcommand, positionals and flags', () => {
  const p = parseCommandLine(['team', 'add', TENANT, '--name', 'Ada', '--email', 'ada@example.com', '--role', 'admin', '-o', 'json']);
  assert.deepEqual(p.path, ['team', 'add']);
  assert.deepEqual(p.args, [TENANT]);
  assert.equal(p.flags.name, 'Ada');
  assert.equal(p.flags.role, 'admin');
  assert.equal(p.flags.output, 'json');
});

test('global flags work before the command', () => {
  const p = parseCommandLine(['-d', '--profile', 'work', '--portal-url', 'https://example.com', 'account']);
  assert.deepEqual(p.path, ['account']);
  assert.equal(p.flags.debug, true);
  assert.equal(p.flags.profile, 'work');
  assert.equal(p.flags['portal-url'], 'https://example.com');
});

test('short -y and --flag=value forms', () => {
  const p = parseCommandLine(['team', 'remove', TENANT, TENANT, '-y', '--output=yaml']);
  assert.equal(p.flags.yes, true);
  assert.equal(p.flags.output, 'yaml');
});

test('--message - is accepted as a value', () => {
  const p = parseCommandLine(['ticket', 'create', '--subject', 'Hello', '--message', '-']);
  assert.equal(p.flags.message, '-');
});

const usageCases = [
  [['nope'], /Unknown command "nope"/],
  [['team', 'nope'], /Unknown command "team nope"/],
  [['account', '--bogus'], /Unknown option '--bogus'/],
  [['account', '--role', 'admin'], /Unknown option --role for "account"/],
  [['team', 'list'], /needs <tenant-id>/],
  [['account', 'extra'], /Too many arguments/],
  [['team', 'add', TENANT, '--name', 'A', '--email', 'a@b.c'], /needs --role/],
  [['ticket', 'create', '--subject', 'Hello'], /needs --message/],
  [['account', '-o', 'xml'], /--output must be one of/],
  [['completion', 'fish'], /takes one of: bash, zsh, powershell/],
  [['team', 'list', 'not-a-uuid'], /tenant-id must be a UUID/],
  [['team', 'role', TENANT, 'x', '--role', 'admin', '--yes'], /membership-id must be a UUID/],
  [['team', 'role', TENANT, TENANT, '--role', 'owner', '--yes'], /--role must be one of/],
  [['agent', 'list', '--status', 'dead'], /--status must be one of: pending/],
  [['agent', 'list', '--tenant', '123'], /--tenant must be a UUID/],
  [['ticket', 'list', '--status', 'nope'], /--status must be one of: open/],
  [['ticket', 'get', '../../etc'], /ticket-id must be a UUID/],
  [['ticket', 'create', '--subject', 'Hello', '--message', 'Long enough message', '--agent', TENANT], /--agent needs --tenant/],
  [['--profile', 'bad name', 'account'], /profile name/],
  [['--portal-url', 'http://example.com', 'account'], /must use https/],
  [['--portal-url', 'https://user:pw@example.com', 'account'], /must not contain credentials/],
];

for (const [argv, pattern] of usageCases) {
  test(`usage error exits 2: ${argv.join(' ')}`, async () => {
    const r = await cli(argv);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, pattern);
    assert.equal(r.calls.length, 0, 'no request is sent');
  });
}

test('no arguments prints help and exits 0', async () => {
  const r = await cli([]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: sqlcockpit <command>/);
});

test('help, --help and help <command>', async () => {
  for (const argv of [['help'], ['--help'], ['-h']]) {
    const r = await cli(argv);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Commands:/);
  }
  const team = await cli(['help', 'team', 'role']);
  assert.match(team.stdout, /sqlcockpit team role <tenant-id> <membership-id> --role <role> \[--yes\]/);
  const flag = await cli(['ticket', 'create', '--help']);
  assert.equal(flag.code, 0);
  assert.match(flag.stdout, /--subject <text>/);
  const unknown = await cli(['help', 'nope']);
  assert.equal(unknown.code, 2);
});

test('a group without a subcommand shows its help on stderr and exits 2', async () => {
  const r = await cli(['team']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /sqlcockpit team list <tenant-id>/);
});

test('usage errors are JSON on stderr with -o json', async () => {
  const r = await cli(['team', 'list', 'bad', '-o', 'json']);
  assert.equal(r.code, 2);
  const line = JSON.parse(r.stderr.split('\n')[0]);
  assert.equal(line.ok, false);
  assert.equal(line.error.code, 'usage');
});
