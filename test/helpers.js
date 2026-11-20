import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.js';

export const KEY = 'sco_test_0123456789abcdefSECRET';
export const TENANT = '11111111-2222-4333-8444-555555555555';
export const MEMBER = '66666666-7777-4888-9999-aaaaaaaaaaaa';
export const TICKET = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
export const AGENT = '12345678-1234-4234-8234-123456789012';

export function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sqlcockpit-test-'));
}

function sink() {
  let text = '';
  return { write: (chunk) => { text += chunk; return true; }, get text() { return text; } };
}

/** A fake fetch that records requests and answers from a route table: { 'GET /account': { status, body, headers } }. */
export function fakeFetch(routes = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const call = {
      method: init.method,
      url: u.toString(),
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      headers: init.headers,
      redirect: init.redirect,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    const key = `${init.method} ${u.pathname.replace('/api/portal/v1', '')}`;
    let route = routes[key];
    if (typeof route === 'function') route = route(call);
    if (!route) route = { status: 404, body: { ok: false, error: { code: 'not_found', message: 'Not found.' } } };
    if (route.throw) throw new TypeError('fetch failed');
    const status = route.status ?? 200;
    const body = route.raw !== undefined ? route.raw : JSON.stringify(route.body ?? { ok: true, data: route.data ?? {} });
    return new Response(status === 204 ? null : body, { status, headers: { 'content-type': 'application/json', ...(route.headers || {}) } });
  };
  return { fetch, calls };
}

/** Runs the CLI with a fake environment and returns { code, stdout, stderr, calls, home }. */
export async function cli(argv, options = {}) {
  const home = options.home ?? tempHome();
  const stdout = sink();
  const stderr = sink();
  const { fetch, calls } = options.fetch ? { fetch: options.fetch, calls: [] } : fakeFetch(options.routes);
  const prompts = [];
  const code = await run(argv, {
    env: options.env ?? { SQL_COCKPIT_API_KEY: KEY },
    stdout,
    stderr,
    fetch,
    homedir: home,
    stdinIsTTY: options.tty ?? false,
    secretPrompt: async (q) => { prompts.push(q); return options.secret ?? ''; },
    confirmPrompt: async (q) => { prompts.push(q); return options.confirm ?? false; },
    readStdin: async () => options.stdin ?? '',
  });
  return { code, stdout: stdout.text, stderr: stderr.text, calls, home, prompts };
}

export function ok(data, status = 200) {
  return { status, body: { ok: true, data } };
}
