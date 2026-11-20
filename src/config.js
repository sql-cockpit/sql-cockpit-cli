import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.js';
import { DEFAULT_PORTAL_URL, normalizePortalUrl } from './client.js';

export const CONFIG_FILE_NAME = '.sqlcockpit.conf';
const PROFILE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export function configPath(homedir) {
  return path.join(homedir, CONFIG_FILE_NAME);
}

export function validateProfileName(name) {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new UsageError('A profile name may use letters, digits, dot, dash and underscore (1 to 64 characters).');
  }
  return name;
}

/**
 * Parses the INI config file:
 *   [default]
 *   profile = work
 *   [profile work]
 *   api_key = ...
 *   portal_url = ...
 */
export function parseIni(text) {
  const config = { default: {}, profiles: {} };
  let section = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[\s*(.+?)\s*\]$/.exec(line);
    if (header) {
      const name = header[1];
      if (name === 'default') section = config.default;
      else {
        const match = /^profile\s+(.+)$/.exec(name);
        if (match) {
          const profile = match[1].trim();
          config.profiles[profile] ??= {};
          section = config.profiles[profile];
        } else {
          section = null; // unknown section, ignored
        }
      }
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || !section) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) section[key] = value;
  }
  return config;
}

export function serializeIni(config) {
  const out = ['# SQL Cockpit CLI configuration. Holds API keys: keep it private.'];
  const def = Object.entries(config.default || {}).filter(([, v]) => v !== undefined && v !== '');
  if (def.length) {
    out.push('', '[default]');
    for (const [k, v] of def) out.push(`${k} = ${v}`);
  }
  for (const [name, values] of Object.entries(config.profiles || {})) {
    const entries = Object.entries(values).filter(([, v]) => v !== undefined && v !== '');
    if (!entries.length) continue;
    out.push('', `[profile ${name}]`);
    for (const [k, v] of entries) out.push(`${k} = ${v}`);
  }
  return `${out.join('\n')}\n`;
}

export function readConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { default: {}, profiles: {} };
    throw error;
  }
  return parseIni(text);
}

/** Writes atomically with mode 0600 where the platform supports it. */
export function writeConfig(file, config) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, serializeIni(config), { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // not supported (Windows)
  }
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // not supported (Windows)
  }
}

/**
 * Works out the profile, API key and portal URL. Later sources win:
 * config file < environment variables < command-line flags.
 */
export function resolveSettings({ flags = {}, env = {}, file }) {
  const config = readConfig(file);

  let profile = 'default';
  let profileSource = 'built-in default';
  if (config.default.profile) {
    profile = config.default.profile;
    profileSource = 'config file';
  }
  if (env.SQL_COCKPIT_PROFILE) {
    profile = env.SQL_COCKPIT_PROFILE;
    profileSource = 'SQL_COCKPIT_PROFILE';
  }
  if (flags.profile !== undefined) {
    profile = flags.profile;
    profileSource = '--profile';
  }
  validateProfileName(profile);
  const section = config.profiles[profile] || {};

  let apiKey = section.api_key || '';
  let apiKeySource = apiKey ? 'config file' : null;
  if (env.SQL_COCKPIT_API_KEY) {
    apiKey = env.SQL_COCKPIT_API_KEY;
    apiKeySource = 'SQL_COCKPIT_API_KEY';
  }

  let portalUrl = DEFAULT_PORTAL_URL;
  let portalUrlSource = 'built-in default';
  if (section.portal_url) {
    portalUrl = section.portal_url;
    portalUrlSource = 'config file';
  }
  if (env.SQL_COCKPIT_PORTAL_URL) {
    portalUrl = env.SQL_COCKPIT_PORTAL_URL;
    portalUrlSource = 'SQL_COCKPIT_PORTAL_URL';
  }
  if (flags['portal-url'] !== undefined) {
    portalUrl = flags['portal-url'];
    portalUrlSource = '--portal-url';
  }
  portalUrl = normalizePortalUrl(portalUrl);

  return { file, config, profile, profileSource, apiKey, apiKeySource, portalUrl, portalUrlSource };
}

/** Shows only the last four characters of a key. */
export function redactKey(key) {
  if (!key) return '';
  const text = String(key);
  return text.length <= 8 ? '****' : `****${text.slice(-4)}`;
}
