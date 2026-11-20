#!/usr/bin/env node
import os from 'node:os';
import { run } from '../src/cli.js';
import { secretPrompt, confirmPrompt, readStdin } from '../src/terminal.js';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  process.stderr.write(`sqlcockpit needs Node.js 20 or later (found ${process.versions.node}).\n`);
  process.exit(2);
}

const code = await run(process.argv.slice(2), {
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  fetch: globalThis.fetch,
  homedir: os.homedir(),
  stdinIsTTY: Boolean(process.stdin.isTTY),
  secretPrompt,
  confirmPrompt,
  readStdin,
}).catch((error) => {
  process.stderr.write(`error: ${error?.cancelled ? 'Cancelled.' : error?.message || error}\n`);
  return error?.cancelled ? 2 : 1;
});
process.exitCode = code;
