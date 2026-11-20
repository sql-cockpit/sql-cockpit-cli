# Changelog

## 0.1.0 - 2026-11-20

First release.

- `login` and `logout`, with the key typed at a hidden prompt (or piped on stdin) and checked against the portal before it is saved.
- `account`, `usage`, `tenant list`, `team list|add|role|remove|resend`, `agent list`, `instance list`, `ticket list|get|create`.
- `config`, `version`, `completion bash|zsh|powershell`, `help`.
- Output as aligned tables, JSON or YAML (`-o`).
- Profiles in `~/.sqlcockpit.conf`, overridden by `SQL_COCKPIT_*` environment variables, overridden by flags.
- Role changes and removals ask first; without a terminal they need `--yes`.
- HTTPS only (http allowed for localhost), redirects refused, responses capped at 2 MiB, IDs checked as UUIDs, the key never printed.
- Exit codes: 0 ok, 1 API error, 2 usage error, 3 auth error.
