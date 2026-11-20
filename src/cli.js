import { parseArgs } from 'node:util';
import { COMMANDS, GLOBAL_OPTIONS, COMMAND_OPTIONS } from './spec.js';
import { HANDLERS } from './commands.js';
import { helpFor, mainHelp } from './help.js';
import { PortalClient } from './client.js';
import { resolveSettings, configPath } from './config.js';
import { checkOutputFormat, toJson, toYaml } from './output.js';
import { UsageError, AuthError, ApiError, EXIT_OK, EXIT_API, EXIT_USAGE } from './errors.js';

const PARSE_OPTIONS = Object.fromEntries(
  Object.entries({ ...GLOBAL_OPTIONS, ...COMMAND_OPTIONS }).map(([name, def]) => [
    name,
    def.short ? { type: def.type, short: def.short } : { type: def.type },
  ]),
);

/**
 * Parses argv into { path, leaf, args, flags }. Throws UsageError for anything malformed.
 * Global flags may appear anywhere; command flags must belong to the command.
 */
export function parseCommandLine(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: PARSE_OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message.replace(/\. To specify a positional argument starting with a '-'.*$/s, '.'));
  }
  const flags = parsed.values;
  const positionals = parsed.positionals;
  const result = { flags, path: [], leaf: null, args: [] };

  if (!positionals.length) return result;
  const [name] = positionals;
  const cmd = COMMANDS[name];
  if (!cmd) throw new UsageError(`Unknown command "${name}".`);
  if (cmd.subcommands) {
    if (positionals.length < 2) {
      result.path = [name];
      return result;
    }
    const sub = positionals[1];
    const leaf = cmd.subcommands[sub];
    if (!leaf) throw new UsageError(`Unknown command "${name} ${sub}". Try: ${Object.keys(cmd.subcommands).map((s) => `${name} ${s}`).join(', ')}.`);
    result.path = [name, sub];
    result.leaf = leaf;
    result.args = positionals.slice(2);
  } else {
    result.path = [name];
    result.leaf = cmd;
    result.args = positionals.slice(1);
  }
  return result;
}

function checkLeaf({ path, leaf, args, flags }) {
  const label = path.join(' ');
  for (const name of Object.keys(flags)) {
    if (name in GLOBAL_OPTIONS) continue;
    if (!leaf.flags.includes(name)) throw new UsageError(`Unknown option --${name} for "${label}".`);
  }
  const min = leaf.args.length;
  const max = min + (leaf.optionalArgs?.length || 0);
  if (args.length < min) throw new UsageError(`"${label}" needs ${leaf.args.map((a) => `<${a}>`).join(' ')}.`);
  if (args.length > max) throw new UsageError(`Too many arguments for "${label}": ${args.slice(max).join(' ')}.`);
  for (const name of leaf.required || []) {
    if (flags[name] === undefined || flags[name] === '') throw new UsageError(`"${label}" needs --${name}.`);
  }
  if (leaf.choices && !leaf.choices.includes(args[0])) {
    throw new UsageError(`"${label}" takes one of: ${leaf.choices.join(', ')}.`);
  }
}

function writeError(io, format, error) {
  if (format === 'json') {
    const payload = { ok: false, error: { code: error.code || (error instanceof UsageError ? 'usage' : 'error'), message: error.message } };
    if (error.fields) payload.error.fields = error.fields;
    io.stderr.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  io.stderr.write(`error: ${error.message}\n`);
  if (error.fields && typeof error.fields === 'object') {
    for (const [field, messages] of Object.entries(error.fields)) {
      for (const message of [].concat(messages)) io.stderr.write(`  ${field}: ${message}\n`);
    }
  }
}

/**
 * Runs the CLI. io supplies everything from outside so tests can drive it:
 * { env, stdout, stderr, fetch, homedir, stdinIsTTY, secretPrompt, confirmPrompt, readStdin }
 * Returns the exit code.
 */
export async function run(argv, io) {
  let format = 'table';
  let parsed;
  try {
    parsed = parseCommandLine(argv);
    format = checkOutputFormat(parsed.flags.output);
  } catch (error) {
    // Keep json errors when -o json was clearly asked for, even if parsing failed elsewhere.
    writeError(io, argv.includes('json') ? 'json' : 'table', error);
    io.stderr.write('Run `sqlcockpit help` for usage.\n');
    return EXIT_USAGE;
  }

  const { flags, path, leaf, args } = parsed;
  const out = (text) => io.stdout.write(text.endsWith('\n') ? text : `${text}\n`);

  // help, --help, bare command and bare group
  if (path[0] === 'help' || flags.help) {
    const target = path[0] === 'help' ? args.slice(0, 2) : path;
    const text = helpFor(target);
    if (text === null) {
      writeError(io, format, new UsageError(`Unknown command "${target.join(' ')}".`));
      return EXIT_USAGE;
    }
    out(text);
    return EXIT_OK;
  }
  if (!leaf) {
    if (!path.length) {
      out(mainHelp());
      return EXIT_OK;
    }
    io.stderr.write(`${helpFor(path)}\n`);
    return EXIT_USAGE;
  }

  const env = io.env || {};
  const debug = flags.debug ? (line) => io.stderr.write(`debug: ${line}\n`) : null;
  let settingsCache;
  const ctx = {
    flags,
    args,
    env,
    io,
    settings() {
      settingsCache ??= resolveSettings({ flags, env, file: configPath(io.homedir) });
      return settingsCache;
    },
    client(overrides = {}) {
      const s = ctx.settings();
      return new PortalClient({
        portalUrl: s.portalUrl,
        apiKey: overrides.apiKey ?? s.apiKey,
        fetchImpl: io.fetch,
        debug,
      });
    },
  };

  try {
    checkLeaf(parsed);
    const handler = HANDLERS[path.join(' ')];
    const result = await handler(ctx);
    if (result.cancelled) {
      io.stderr.write('Cancelled. Nothing was changed.\n');
      return EXIT_API;
    }
    if (result.raw !== undefined) {
      io.stdout.write(result.raw);
      return EXIT_OK;
    }
    if (format === 'json') out(toJson(result.data));
    else if (format === 'yaml') out(toYaml(result.data));
    else out(result.table());
    return EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError || error instanceof AuthError || error instanceof ApiError) {
      writeError(io, format, error);
      if (error instanceof UsageError) io.stderr.write(`Run \`sqlcockpit help ${path.join(' ')}\` for usage.\n`);
      return error.exitCode;
    }
    writeError(io, format, { message: error?.message || String(error), code: 'error' });
    return EXIT_API;
  }
}
