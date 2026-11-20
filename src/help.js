import { COMMANDS, GLOBAL_OPTIONS, COMMAND_OPTIONS } from './spec.js';
import { VERSION } from './version.js';

function optionLabel(name, def) {
  const long = `--${name}${def.value ? ` <${def.value}>` : ''}`;
  return def.short ? `-${def.short}, ${long}` : `    ${long}`;
}

function optionLines(entries) {
  const labels = entries.map(([name, def]) => optionLabel(name, def));
  const size = Math.max(...labels.map((l) => l.length));
  return entries.map(([, def], i) => `  ${labels[i].padEnd(size)}  ${def.description}`);
}

function globalOptions() {
  return ['Global options:', ...optionLines(Object.entries(GLOBAL_OPTIONS))];
}

export function leafUsage(path, leaf) {
  const args = [...(leaf.args || []).map((a) => `<${a}>`), ...(leaf.optionalArgs || []).map((a) => `[${a}]`)];
  const flags = (leaf.flags || []).map((f) => {
    const def = COMMAND_OPTIONS[f];
    const text = `--${f}${def.value ? ` <${def.value}>` : ''}`;
    return leaf.required?.includes(f) ? text : `[${text}]`;
  });
  return ['sqlcockpit', ...path, ...args, ...flags].join(' ');
}

/** Every leaf command as [path, leaf]. */
export function leaves() {
  const out = [];
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    if (cmd.subcommands) for (const [sub, leaf] of Object.entries(cmd.subcommands)) out.push([[name, sub], leaf]);
    else out.push([[name], cmd]);
  }
  return out;
}

export function mainHelp() {
  const rows = leaves().map(([path, leaf]) => {
    const args = [...(leaf.args || []).map((a) => `<${a}>`), ...(leaf.optionalArgs || []).map((a) => `[${a}]`)];
    return [[...path, ...args].join(' '), leaf.summary];
  });
  const size = Math.max(...rows.map(([l]) => l.length));
  return [
    `sqlcockpit ${VERSION} - the SQL Cockpit command-line tool`,
    '',
    'Usage: sqlcockpit <command> [subcommand] [flags]',
    '',
    'Commands:',
    ...rows.map(([l, s]) => `  ${l.padEnd(size)}  ${s}`),
    '',
    ...globalOptions(),
    '',
    'Environment: SQL_COCKPIT_API_KEY, SQL_COCKPIT_PORTAL_URL, SQL_COCKPIT_PROFILE',
    'Exit codes: 0 ok, 1 API error, 2 usage error, 3 auth error',
    'Run `sqlcockpit help <command>` for details.',
  ].join('\n');
}

export function groupHelp(name) {
  const cmd = COMMANDS[name];
  const rows = Object.entries(cmd.subcommands).map(([sub, leaf]) => [leafUsage([name, sub], leaf).replace(/^sqlcockpit /, ''), leaf.summary]);
  return [
    `${cmd.summary}.`,
    '',
    'Usage:',
    ...rows.map(([u, s]) => `  sqlcockpit ${u}\n      ${s}`),
    '',
    ...globalOptions(),
  ].join('\n');
}

export function leafHelp(path, leaf) {
  const lines = [`${leaf.summary}.`, '', `Usage: ${leafUsage(path, leaf)}`];
  if (leaf.flags?.length) {
    const entries = leaf.flags.map((f) => {
      const def = { ...COMMAND_OPTIONS[f] };
      if (f === 'status' && leaf.statuses) def.description = `Only this status: ${leaf.statuses.join(', ')}`;
      return [f, def];
    });
    lines.push('', 'Options:', ...optionLines(entries));
  }
  if (path[0] === 'team' && (path[1] === 'role' || path[1] === 'remove')) {
    lines.push('', 'Asks for confirmation first. Without a terminal, pass --yes.');
  }
  if (path[0] === 'login') {
    lines.push('', 'Prompts for the key without echoing it. Without a terminal, reads the key from stdin.',
      'Create a key in the portal under Settings > Developer access.');
  }
  lines.push('', ...globalOptions());
  return lines.join('\n');
}

export function helpFor(path) {
  if (!path.length) return mainHelp();
  const cmd = COMMANDS[path[0]];
  if (!cmd) return null;
  if (cmd.subcommands) {
    if (path.length === 1) return groupHelp(path[0]);
    const leaf = cmd.subcommands[path[1]];
    return leaf ? leafHelp(path.slice(0, 2), leaf) : null;
  }
  return leafHelp([path[0]], cmd);
}
