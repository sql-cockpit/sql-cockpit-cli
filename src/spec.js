/** The command tree. Help text, argument checks and shell completion all read from here. */

export const ASSIGNABLE_ROLES = ['admin', 'developer', 'operator', 'read-only'];
export const AGENT_STATUSES = ['pending', 'active', 'revoked', 'suspended'];
export const TICKET_STATUSES = ['open', 'pending', 'sent', 'waiting_on_customer', 'resolved', 'closed'];
export const SHELLS = ['bash', 'zsh', 'powershell'];

export const GLOBAL_OPTIONS = {
  output: { type: 'string', short: 'o', value: 'format', description: 'Output format: table (default), json or yaml', choices: ['table', 'json', 'yaml'] },
  profile: { type: 'string', value: 'name', description: 'Use this profile from the config file' },
  debug: { type: 'boolean', short: 'd', description: 'Log each request method, URL and status to stderr' },
  'portal-url': { type: 'string', value: 'url', description: 'Portal address (default https://portal.sql-cockpit.com)' },
  help: { type: 'boolean', short: 'h', description: 'Show help' },
};

export const COMMAND_OPTIONS = {
  name: { type: 'string', value: 'name', description: "The person's name" },
  email: { type: 'string', value: 'email', description: "The person's email address" },
  role: { type: 'string', value: 'role', description: `Role: ${ASSIGNABLE_ROLES.join(', ')}`, choices: ASSIGNABLE_ROLES },
  yes: { type: 'boolean', short: 'y', description: 'Skip the confirmation question' },
  tenant: { type: 'string', value: 'tenant-id', description: 'Only this tenant (UUID)' },
  status: { type: 'string', value: 'status', description: 'Only this status' },
  subject: { type: 'string', value: 'text', description: 'Ticket subject (4 to 160 characters)' },
  message: { type: 'string', value: 'text', description: 'Ticket message (10 to 5000 characters); - reads it from stdin' },
  agent: { type: 'string', value: 'agent-id', description: 'The Agent the ticket is about (UUID, needs --tenant)' },
};

export const COMMANDS = {
  login: { summary: 'Save a portal API key for the active profile', args: [], flags: [] },
  logout: { summary: 'Remove the saved API key from the active profile', args: [], flags: [] },
  account: { summary: 'Show your account, plan and subscription', args: [], flags: [] },
  usage: { summary: 'Show plan usage for this billing period', args: [], flags: [] },
  tenant: {
    summary: 'Tenants you own or belong to',
    subcommands: {
      list: { summary: 'List your tenants and your role in each', args: [], flags: [] },
    },
  },
  team: {
    summary: 'Team members of a tenant',
    subcommands: {
      list: { summary: 'List the owner and members of a tenant', args: ['tenant-id'], flags: [] },
      add: { summary: 'Add someone to a tenant', args: ['tenant-id'], flags: ['name', 'email', 'role'], required: ['name', 'email', 'role'] },
      role: { summary: "Change a member's role", args: ['tenant-id', 'membership-id'], flags: ['role', 'yes'], required: ['role'] },
      remove: { summary: 'Remove a member from a tenant', args: ['tenant-id', 'membership-id'], flags: ['yes'] },
      resend: { summary: 'Resend the set-password email to a pending member', args: ['tenant-id', 'membership-id'], flags: [] },
    },
  },
  agent: {
    summary: 'SQL Cockpit Agents',
    subcommands: {
      list: { summary: 'List Agents paired with your tenants', args: [], flags: ['tenant', 'status'], statuses: AGENT_STATUSES },
    },
  },
  instance: {
    summary: 'SQL Cockpit Server instances',
    subcommands: {
      list: { summary: 'List hosted and self-hosted instances', args: [], flags: ['tenant'] },
    },
  },
  ticket: {
    summary: 'Support tickets',
    subcommands: {
      list: { summary: 'List your support tickets, newest first', args: [], flags: ['status'], statuses: TICKET_STATUSES },
      get: { summary: 'Show a ticket with its replies', args: ['ticket-id'], flags: [] },
      create: { summary: 'Open a support ticket', args: [], flags: ['subject', 'message', 'tenant', 'agent'], required: ['subject', 'message'] },
    },
  },
  config: { summary: 'Show the config file path and active profile (key redacted)', args: [], flags: [] },
  version: { summary: 'Show the CLI version', args: [], flags: [] },
  completion: { summary: 'Print a shell completion script', args: ['shell'], flags: [], choices: SHELLS },
  help: { summary: 'Show help for a command', args: [], optionalArgs: ['command'], flags: [] },
};
