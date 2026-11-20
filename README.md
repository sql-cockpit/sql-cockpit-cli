# SQL Cockpit CLI

`sqlcockpit` is the official command-line tool for your SQL Cockpit portal account. Use it to check your plan, manage who is on each tenant's team, list Agents and instances, and open support tickets.

It talks to the portal API (`https://portal.sql-cockpit.com/api/portal/v1`) with a portal API key. It needs Node.js 20 or later and has no other dependencies.

## Install

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/sql-cockpit/sql-cockpit-cli/main/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/sql-cockpit/sql-cockpit-cli/main/install.ps1 | iex
```

Or with npm directly:

```sh
npm install -g github:sql-cockpit/sql-cockpit-cli
```

The scripts check for Node.js 20+ and then run that same npm command. While the repository is private, you need GitHub access to it for any of these to work; you can also clone it and run `sh install.sh` or `.\install.ps1` from the clone.

## Log in

Create an API key in the portal under **Settings > Developer access**, then:

```sh
sqlcockpit login
```

You paste the key at a prompt that does not echo it. The CLI checks it against the portal before saving it. To log in without a terminal, pipe the key in: `printf '%s\n' "$KEY" | sqlcockpit login`.

`sqlcockpit logout` removes the saved key. To revoke the key itself, delete it in the portal.

## Config file and environment

Keys are saved in `~/.sqlcockpit.conf` (on Windows, `%USERPROFILE%\.sqlcockpit.conf`), written with mode 0600 where the system supports it.

```ini
[default]
profile = work

[profile work]
api_key = sco_...
portal_url = https://portal.sql-cockpit.com
```

Use `--profile <name>` with `login` to save more than one account. `sqlcockpit config` shows which file, profile, portal URL and key (last four characters only) are in use, and where each one came from.

Environment variables override the file, and flags override environment variables:

| Variable | What it does |
| --- | --- |
| `SQL_COCKPIT_API_KEY` | API key to use instead of the saved one |
| `SQL_COCKPIT_PORTAL_URL` | Portal address (overridden by `--portal-url`) |
| `SQL_COCKPIT_PROFILE` | Profile to use (overridden by `--profile`) |

There is no flag for the API key, so it never lands in your shell history.

## Examples

| Task | Command |
| --- | --- |
| See your plan and subscription | `sqlcockpit account` |
| Check how much of your plan you've used | `sqlcockpit usage` |
| Find your tenant IDs | `sqlcockpit tenant list` |
| See who is on a team | `sqlcockpit team list <tenant-id>` |
| Invite someone | `sqlcockpit team add <tenant-id> --name "Ada Lovelace" --email ada@example.com --role developer` |
| Make someone an admin | `sqlcockpit team role <tenant-id> <membership-id> --role admin` |
| Remove someone in a script | `sqlcockpit team remove <tenant-id> <membership-id> --yes` |
| Resend a set-password email | `sqlcockpit team resend <tenant-id> <membership-id>` |
| List the active Agents of one tenant | `sqlcockpit agent list --tenant <tenant-id> --status active` |
| List instances as JSON | `sqlcockpit instance list -o json` |
| See tickets waiting on you | `sqlcockpit ticket list --status waiting_on_customer` |
| Read a ticket and its replies | `sqlcockpit ticket get <ticket-id>` |
| Open a ticket about an Agent | `sqlcockpit ticket create --subject "Agent offline" --message "db01 stopped reporting at 09:00." --tenant <tenant-id> --agent <agent-id>` |
| Open a ticket from a file | `sqlcockpit ticket create --subject "Slow sync" --message - < notes.txt` |
| Use a second account once | `sqlcockpit --profile staging account` |
| Turn on tab completion (bash) | `source <(sqlcockpit completion bash)` |

## Commands

| Command | What it does |
| --- | --- |
| `login` | Save a portal API key for the active profile |
| `logout` | Remove the saved API key from the active profile |
| `account` | Show your account, plan and subscription |
| `usage` | Show plan usage for this billing period |
| `tenant list` | List your tenants and your role in each |
| `team list <tenant-id>` | List the owner and members of a tenant |
| `team add <tenant-id> --name --email --role` | Add someone to a tenant |
| `team role <tenant-id> <membership-id> --role [--yes]` | Change a member's role |
| `team remove <tenant-id> <membership-id> [--yes]` | Remove a member from a tenant |
| `team resend <tenant-id> <membership-id>` | Resend the set-password email to a pending member |
| `agent list [--tenant] [--status]` | List Agents paired with your tenants |
| `instance list [--tenant]` | List hosted and self-hosted instances |
| `ticket list [--status]` | List your support tickets, newest first |
| `ticket get <ticket-id>` | Show a ticket with its replies |
| `ticket create --subject --message [--tenant] [--agent]` | Open a support ticket |
| `config` | Show the config file path and active profile (key redacted) |
| `version` | Show the CLI version |
| `completion <bash\|zsh\|powershell>` | Print a shell completion script |
| `help [command]` | Show help for a command |

Roles you can assign: `admin`, `developer`, `operator`, `read-only`. Agent statuses: `pending`, `active`, `revoked`, `suspended`. Ticket statuses: `open`, `pending`, `sent`, `waiting_on_customer`, `resolved`, `closed`.

`team role` and `team remove` ask before they change anything. With no terminal to ask (CI, scripts), they refuse unless you pass `--yes`.

All IDs are UUIDs. The CLI checks them before sending anything.

## Global options

| Option | What it does |
| --- | --- |
| `-o, --output table\|json\|yaml` | Output format. `table` is the default; `json` and `yaml` print the API's `data` object |
| `--profile <name>` | Use this profile from the config file |
| `-d, --debug` | Log each request's method, URL and status to stderr. Headers and the key are never logged |
| `--portal-url <url>` | Portal address. Must be `https://`; `http://` is allowed only for localhost |
| `-h, --help` | Show help |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | The portal returned an error, could not be reached, or you said no at a confirmation |
| 2 | Usage error: unknown command or flag, missing argument, malformed ID |
| 3 | Auth error: not logged in, or the portal refused the key |

With `-o json`, errors are written to stderr as `{"ok":false,"error":{"code","message","fields"}}`.

## Safety

The CLI only calls the portal over HTTPS (or http on localhost), does not follow redirects, stops reading any response over 2 MiB, strips control characters from what it prints, and never prints your API key.

## Development

```sh
npm test
```

Tests use `node:test` with a fake `fetch` and a local HTTP server. No install step is needed.

## License

MIT. See [LICENSE](LICENSE).
