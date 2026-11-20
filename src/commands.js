import { UsageError, AuthError, ApiError } from './errors.js';
import { requireUuid, normalizeApiKey, DEFAULT_PORTAL_URL } from './client.js';
import { writeConfig, redactKey } from './config.js';
import { table, keyValue, when, yesNo, cleanBlock, clean } from './output.js';
import { ASSIGNABLE_ROLES, AGENT_STATUSES, TICKET_STATUSES } from './spec.js';
import { completionScript } from './completion.js';
import { VERSION } from './version.js';
import fs from 'node:fs';

function choice(value, allowed, label) {
  if (!allowed.includes(value)) throw new UsageError(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function optionalUuid(value, label) {
  return value === undefined ? undefined : requireUuid(value, label);
}

const seg = (id) => encodeURIComponent(id);

/** Asks before a change, or refuses when there is nobody to ask. Returns false when the user says no. */
async function confirm(ctx, question) {
  if (ctx.flags.yes) return true;
  if (!ctx.io.stdinIsTTY) {
    throw new UsageError('This change needs confirmation and there is no terminal to ask. Pass --yes to go ahead.');
  }
  return ctx.io.confirmPrompt(`${question} [y/N] `);
}

function memberView(data) {
  const m = data.member || {};
  return [
    keyValue([
      ['ID', m.id],
      ['Name', m.name],
      ['Email', m.email],
      ['Role', m.role_label || m.role],
      ['Status', m.status],
      ['Joined', m.joined_at === undefined ? undefined : when(m.joined_at)],
    ]),
    data.message ? `\n${clean(data.message)}` : '',
  ].join('');
}

function ticketSummaryRows(t) {
  return [
    ['ID', t.id],
    ['Subject', t.subject],
    ['Status', t.status_label || t.status],
    ['Priority', t.priority],
    ['Tenant', t.tenant === undefined ? undefined : t.tenant?.name ?? null],
    ['Created', t.created_at === undefined ? undefined : when(t.created_at)],
    ['Updated', t.updated_at === undefined ? undefined : when(t.updated_at)],
    ['Portal', t.portal_url],
  ];
}

function indent(text) {
  return cleanBlock(text).split('\n').map((l) => `  ${l}`.trimEnd()).join('\n');
}

export const HANDLERS = {
  async login(ctx) {
    const settings = ctx.settings();
    let key;
    if (ctx.io.stdinIsTTY) {
      ctx.io.stderr.write('Create a key in the portal under Settings > Developer access.\n');
      key = await ctx.io.secretPrompt('Portal API key: ');
    } else {
      key = String(await ctx.io.readStdin()).split(/\r?\n/)[0];
    }
    try {
      key = normalizeApiKey(key);
    } catch (error) {
      throw new UsageError(error.code === 'not_logged_in' ? 'No API key was given.' : error.message);
    }
    let account;
    try {
      account = await ctx.client({ apiKey: key }).get('/account');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new AuthError('The portal refused that key. Check it has not been revoked or expired.');
      }
      throw error;
    }
    const { config } = settings;
    const section = { ...(config.profiles[settings.profile] || {}), api_key: key };
    if (settings.portalUrlSource !== 'config file' && settings.portalUrl !== DEFAULT_PORTAL_URL) section.portal_url = settings.portalUrl;
    config.profiles[settings.profile] = section;
    if (!config.default.profile) config.default.profile = settings.profile;
    writeConfig(settings.file, config);
    const data = { profile: settings.profile, name: account?.name ?? null, email: account?.email ?? null, config_file: settings.file };
    if (ctx.env.SQL_COCKPIT_API_KEY) {
      ctx.io.stderr.write('Note: SQL_COCKPIT_API_KEY is set and takes precedence over the saved key.\n');
    }
    return { data, table: () => `Logged in as ${clean(data.name)} <${clean(data.email)}> (profile ${data.profile}).\nSaved to ${data.config_file}.` };
  },

  async logout(ctx) {
    const settings = ctx.settings();
    const { config } = settings;
    const section = config.profiles[settings.profile];
    const had = Boolean(section?.api_key);
    if (had) {
      delete section.api_key;
      writeConfig(settings.file, config);
    }
    if (ctx.env.SQL_COCKPIT_API_KEY) {
      ctx.io.stderr.write('Note: SQL_COCKPIT_API_KEY is still set in your environment.\n');
    }
    const data = { profile: settings.profile, removed: had, config_file: settings.file };
    return {
      data,
      table: () => (had
        ? `Removed the API key for profile ${data.profile} from ${data.config_file}.\nTo revoke the key itself, delete it in the portal under Settings > Developer access.`
        : `No saved API key for profile ${data.profile}.`),
    };
  },

  async account(ctx) {
    const d = await ctx.client().get('/account');
    return {
      data: d,
      table: () => keyValue([
        ['Name', d.name],
        ['Email', d.email],
        ['Email verified', d.email_verified === undefined ? undefined : yesNo(d.email_verified)],
        ['Plan', d.plan === undefined ? undefined : d.plan?.name ?? null],
        ['Subscription', d.subscription === undefined ? undefined : d.subscription ? [d.subscription.status, d.subscription.cycle && `billed per ${d.subscription.cycle}`].filter(Boolean).join(', ') : null],
        ['Trial ends', d.subscription?.trial_ends_at ? when(d.subscription.trial_ends_at) : undefined],
        ['Ends', d.subscription?.ends_at ? when(d.subscription.ends_at) : undefined],
        ['Billing account', d.billing_account === undefined ? undefined : yesNo(d.billing_account)],
        ['Team member', d.team_member === undefined ? undefined : yesNo(d.team_member)],
        ['Connected via', d.connected_via ? `${d.connected_via.type}${d.connected_via.name ? ` (${d.connected_via.name})` : ''}` : undefined],
        ['Scopes', Array.isArray(d.connected_via?.scopes) ? d.connected_via.scopes.join(', ') : undefined],
        ['Portal', d.portal_url],
      ]),
    };
  },

  async usage(ctx) {
    const d = await ctx.client().get('/usage');
    return {
      data: d,
      table: () => {
        const parts = [keyValue([
          ['Plan', d.plan === undefined ? undefined : d.plan],
          ['Period', d.period ? `${when(d.period.start)} to ${when(d.period.end)}` : undefined],
        ])];
        if (d.message) parts.push(clean(d.message));
        const rows = Array.isArray(d.allowances) ? d.allowances : [];
        if (rows.length) {
          parts.push(table(rows, [
            { header: 'ALLOWANCE', value: (a) => a.label || a.key },
            { header: 'USED', value: (a) => a.used },
            { header: 'LIMIT', value: (a) => (a.unlimited ? 'unlimited' : a.included === false ? 'not included' : a.limit) },
            { header: 'REMAINING', value: (a) => (a.unlimited ? '-' : a.remaining) },
            { header: 'STATUS', value: (a) => (a.at_limit ? 'at limit' : '') },
          ]));
        } else if (!d.message) {
          parts.push('No allowances to show.');
        }
        return parts.filter(Boolean).join('\n\n');
      },
    };
  },

  async 'tenant list'(ctx) {
    const d = await ctx.client().get('/tenants');
    const rows = d?.tenants || [];
    return {
      data: d,
      table: () => (rows.length ? table(rows, [
        { header: 'ID', value: (t) => t.id },
        { header: 'NAME', value: (t) => t.name },
        { header: 'SLUG', value: (t) => t.slug },
        { header: 'ROLE', value: (t) => t.your_role },
        { header: 'STATUS', value: (t) => t.status },
        { header: 'AGENTS', value: (t) => t.agents_count },
      ]) : 'No tenants.'),
    };
  },

  async 'team list'(ctx) {
    const tenant = requireUuid(ctx.args[0], 'tenant-id');
    const d = await ctx.client().get(`/tenants/${seg(tenant)}/members`);
    const rows = d?.members || [];
    return {
      data: d,
      table: () => {
        const head = keyValue([
          ['Tenant', d.tenant ? `${d.tenant.name} (${d.tenant.id})` : undefined],
          ['Owner', d.owner ? `${d.owner.name} <${d.owner.email}>` : undefined],
          ['Seats', d.seats ? `${d.seats.used} of ${d.seats.limit ?? 'unlimited'}` : undefined],
          ['You can manage', d.you_can_manage === undefined ? undefined : yesNo(d.you_can_manage)],
        ]);
        const body = rows.length ? table(rows, [
          { header: 'ID', value: (m) => m.id },
          { header: 'NAME', value: (m) => m.name },
          { header: 'EMAIL', value: (m) => m.email },
          { header: 'ROLE', value: (m) => m.role },
          { header: 'STATUS', value: (m) => m.status },
          { header: 'JOINED', value: (m) => when(m.joined_at) },
        ]) : 'No members yet.';
        return [head, body].filter(Boolean).join('\n\n');
      },
    };
  },

  async 'team add'(ctx) {
    const tenant = requireUuid(ctx.args[0], 'tenant-id');
    const body = {
      name: ctx.flags.name,
      email: ctx.flags.email,
      role: choice(ctx.flags.role, ASSIGNABLE_ROLES, '--role'),
    };
    const d = await ctx.client().request('POST', `/tenants/${seg(tenant)}/members`, { body });
    return { data: d, table: () => memberView(d) };
  },

  async 'team role'(ctx) {
    const tenant = requireUuid(ctx.args[0], 'tenant-id');
    const member = requireUuid(ctx.args[1], 'membership-id');
    const role = choice(ctx.flags.role, ASSIGNABLE_ROLES, '--role');
    const client = ctx.client();
    if (!(await confirm(ctx, `Change the role of member ${member} in tenant ${tenant} to ${role}?`))) return { cancelled: true };
    const d = await client.request('PATCH', `/tenants/${seg(tenant)}/members/${seg(member)}`, { body: { role, confirm: true } });
    return { data: d, table: () => memberView(d) };
  },

  async 'team remove'(ctx) {
    const tenant = requireUuid(ctx.args[0], 'tenant-id');
    const member = requireUuid(ctx.args[1], 'membership-id');
    const client = ctx.client();
    if (!(await confirm(ctx, `Remove member ${member} from tenant ${tenant}? Their SQL Cockpit account stays.`))) return { cancelled: true };
    const d = await client.request('DELETE', `/tenants/${seg(tenant)}/members/${seg(member)}`, { body: { confirm: true } });
    return { data: d, table: () => `Removed ${clean(d?.email || member)} from tenant ${tenant}.` };
  },

  async 'team resend'(ctx) {
    const tenant = requireUuid(ctx.args[0], 'tenant-id');
    const member = requireUuid(ctx.args[1], 'membership-id');
    const d = await ctx.client().request('POST', `/tenants/${seg(tenant)}/members/${seg(member)}/resend`);
    return { data: d, table: () => `Sent the set-password email to ${clean(d?.email || member)}.` };
  },

  async 'agent list'(ctx) {
    const query = {
      tenant_id: optionalUuid(ctx.flags.tenant, '--tenant'),
      status: ctx.flags.status === undefined ? undefined : choice(ctx.flags.status, AGENT_STATUSES, '--status'),
    };
    const d = await ctx.client().get('/agents', query);
    const rows = d?.agents || [];
    return {
      data: d,
      table: () => (rows.length ? table(rows, [
        { header: 'ID', value: (a) => a.id },
        { header: 'NAME', value: (a) => a.name },
        { header: 'TENANT', value: (a) => a.tenant_name },
        { header: 'HOSTNAME', value: (a) => a.hostname },
        { header: 'STATUS', value: (a) => a.status },
        { header: 'CONNECTION', value: (a) => a.connection },
        { header: 'LAST SEEN', value: (a) => when(a.last_seen_at) },
      ]) : 'No Agents.'),
    };
  },

  async 'instance list'(ctx) {
    const d = await ctx.client().get('/instances', { tenant_id: optionalUuid(ctx.flags.tenant, '--tenant') });
    const rows = d?.instances || [];
    return {
      data: d,
      table: () => (rows.length ? table(rows, [
        { header: 'ID', value: (i) => i.id },
        { header: 'TENANT', value: (i) => i.tenant_name },
        { header: 'HOSTNAME', value: (i) => i.hostname },
        { header: 'MODE', value: (i) => i.hosting_mode },
        { header: 'STATUS', value: (i) => i.status },
        { header: 'REVISION', value: (i) => (i.applied_revision === undefined ? i.revision : `${i.applied_revision ?? '-'}/${i.revision}`) },
        { header: 'LAST SEEN', value: (i) => when(i.last_seen_at) },
      ]) : 'No instances.'),
    };
  },

  async 'ticket list'(ctx) {
    const status = ctx.flags.status === undefined ? undefined : choice(ctx.flags.status, TICKET_STATUSES, '--status');
    const d = await ctx.client().get('/support-tickets', { status });
    const rows = d?.tickets || [];
    return {
      data: d,
      table: () => (rows.length ? table(rows, [
        { header: 'ID', value: (t) => t.id },
        { header: 'SUBJECT', value: (t) => t.subject },
        { header: 'STATUS', value: (t) => t.status },
        { header: 'PRIORITY', value: (t) => t.priority },
        { header: 'TENANT', value: (t) => t.tenant?.name },
        { header: 'UPDATED', value: (t) => when(t.updated_at) },
      ]) : 'No tickets.'),
    };
  },

  async 'ticket get'(ctx) {
    const id = requireUuid(ctx.args[0], 'ticket-id');
    const d = await ctx.client().get(`/support-tickets/${seg(id)}`);
    const t = d?.ticket || {};
    return {
      data: d,
      table: () => {
        const parts = [keyValue([
          ...ticketSummaryRows(t),
          ['Agent', t.agent === undefined ? undefined : t.agent ? `${t.agent.name}${t.agent.hostname ? ` (${t.agent.hostname})` : ''}` : null],
        ])];
        if (t.message) parts.push(`Message:\n${indent(t.message)}`);
        if (t.team_response) parts.push(`Team response${t.responded_at ? ` (${when(t.responded_at)})` : ''}:\n${indent(t.team_response)}`);
        for (const r of t.replies || []) {
          parts.push(`Reply from ${r.from === 'you' ? 'you' : 'the SQL Cockpit Team'} (${when(r.created_at)}):\n${indent(r.body)}`);
        }
        return parts.join('\n\n');
      },
    };
  },

  async 'ticket create'(ctx) {
    let message = ctx.flags.message;
    if (message === '-') {
      if (ctx.io.stdinIsTTY) throw new UsageError('--message - reads the message from stdin, but stdin is a terminal.');
      message = String(await ctx.io.readStdin()).trim();
    }
    const body = { subject: ctx.flags.subject, message };
    const tenant = optionalUuid(ctx.flags.tenant, '--tenant');
    const agent = optionalUuid(ctx.flags.agent, '--agent');
    if (agent && !tenant) throw new UsageError('--agent needs --tenant (the tenant the Agent belongs to).');
    if (tenant) body.tenant_id = tenant;
    if (agent) body.agent_id = agent;
    const d = await ctx.client().request('POST', '/support-tickets', { body });
    const t = d?.ticket || {};
    return { data: d, table: () => `Opened ticket ${clean(t.id)}.\n\n${keyValue(ticketSummaryRows(t))}` };
  },

  async config(ctx) {
    const s = ctx.settings();
    const data = {
      config_file: s.file,
      config_file_exists: fs.existsSync(s.file),
      profile: s.profile,
      profile_source: s.profileSource,
      portal_url: s.portalUrl,
      portal_url_source: s.portalUrlSource,
      api_key: s.apiKey ? redactKey(s.apiKey) : null,
      api_key_source: s.apiKeySource,
      profiles: Object.keys(s.config.profiles),
    };
    return {
      data,
      table: () => keyValue([
        ['Config file', `${data.config_file}${data.config_file_exists ? '' : ' (not created yet)'}`],
        ['Profile', `${data.profile} (from ${data.profile_source})`],
        ['Portal URL', `${data.portal_url} (from ${data.portal_url_source})`],
        ['API key', data.api_key ? `${data.api_key} (from ${data.api_key_source})` : 'not set'],
        ['Profiles', data.profiles.length ? data.profiles.join(', ') : 'none'],
      ]),
    };
  },

  async version() {
    const data = { version: VERSION, node: process.versions.node };
    return { data, table: () => `sqlcockpit ${VERSION}` };
  },

  async completion(ctx) {
    return { raw: completionScript(ctx.args[0]) };
  },
};
