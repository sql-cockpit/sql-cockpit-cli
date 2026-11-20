import { COMMANDS, GLOBAL_OPTIONS, ASSIGNABLE_ROLES, AGENT_STATUSES, TICKET_STATUSES, SHELLS } from './spec.js';
import { UsageError } from './errors.js';

const GLOBAL_FLAGS = Object.keys(GLOBAL_OPTIONS).map((f) => `--${f}`);

function tree() {
  const commands = Object.keys(COMMANDS);
  const subs = {};
  const flags = {};
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    if (cmd.subcommands) {
      subs[name] = Object.keys(cmd.subcommands);
      for (const [sub, leaf] of Object.entries(cmd.subcommands)) flags[`${name} ${sub}`] = leaf.flags.map((f) => `--${f}`);
    } else {
      flags[name] = (cmd.flags || []).map((f) => `--${f}`);
    }
  }
  subs.completion = SHELLS;
  subs.help = commands.filter((c) => c !== 'help');
  return { commands, subs, flags };
}

function bash() {
  const { commands, subs, flags } = tree();
  const subCases = Object.entries(subs).map(([c, s]) => `    ${c}) subs="${s.join(' ')}" ;;`).join('\n');
  const flagCases = Object.entries(flags).map(([k, f]) => `    "${k}") flags="${[...f, ...GLOBAL_FLAGS].join(' ')}" ;;`).join('\n');
  return `# sqlcockpit bash completion. Load with: source <(sqlcockpit completion bash)
_sqlcockpit() {
  local cur prev cmd sub subs flags i w
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd=""; sub=""
  for (( i=1; i<COMP_CWORD; i++ )); do
    w="\${COMP_WORDS[i]}"
    case "$w" in
      -o|--output|--profile|--portal-url|--name|--email|--role|--tenant|--status|--subject|--message|--agent) (( i++ )); continue ;;
      -*) continue ;;
    esac
    if [ -z "$cmd" ]; then cmd="$w"; elif [ -z "$sub" ]; then sub="$w"; fi
  done
  case "$prev" in
    -o|--output) COMPREPLY=( $(compgen -W "table json yaml" -- "$cur") ); return ;;
    --role) COMPREPLY=( $(compgen -W "${ASSIGNABLE_ROLES.join(' ')}" -- "$cur") ); return ;;
    --status)
      if [ "$cmd" = "agent" ]; then COMPREPLY=( $(compgen -W "${AGENT_STATUSES.join(' ')}" -- "$cur") );
      else COMPREPLY=( $(compgen -W "${TICKET_STATUSES.join(' ')}" -- "$cur") ); fi
      return ;;
    --profile|--portal-url|--name|--email|--tenant|--subject|--message|--agent) return ;;
  esac
  if [ -z "$cmd" ]; then
    COMPREPLY=( $(compgen -W "${commands.join(' ')} ${GLOBAL_FLAGS.join(' ')}" -- "$cur") ); return
  fi
  subs=""
  case "$cmd" in
${subCases}
  esac
  if [ -z "$sub" ] && [ -n "$subs" ] && [[ "$cur" != -* ]]; then
    COMPREPLY=( $(compgen -W "$subs" -- "$cur") ); return
  fi
  flags="${GLOBAL_FLAGS.join(' ')}"
  case "$cmd \${sub}" in
${flagCases.replace(/"([a-z]+)"\)/g, '"$1 ")')}
  esac
  COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
}
complete -F _sqlcockpit sqlcockpit
`;
}

function zsh() {
  const { commands, subs, flags } = tree();
  const subCases = Object.entries(subs).map(([c, s]) => `    ${c}) subs=(${s.join(' ')}) ;;`).join('\n');
  const flagCases = Object.entries(flags).map(([k, f]) => `    "${k}") flags+=(${f.join(' ')}) ;;`).join('\n');
  return `#compdef sqlcockpit
# sqlcockpit zsh completion. Load with: source <(sqlcockpit completion zsh)
_sqlcockpit() {
  local -a subs flags rest
  local cmd sub prev i w
  prev="\${words[CURRENT-1]}"
  rest=()
  for (( i=2; i<CURRENT; i++ )); do
    w="\${words[i]}"
    case "$w" in
      -o|--output|--profile|--portal-url|--name|--email|--role|--tenant|--status|--subject|--message|--agent) (( i++ )); continue ;;
      -*) continue ;;
    esac
    rest+=("$w")
  done
  cmd="\${rest[1]}"; sub="\${rest[2]}"
  case "$prev" in
    -o|--output) compadd -- table json yaml; return ;;
    --role) compadd -- ${ASSIGNABLE_ROLES.join(' ')}; return ;;
    --status)
      if [[ "$cmd" == agent ]]; then compadd -- ${AGENT_STATUSES.join(' ')}; else compadd -- ${TICKET_STATUSES.join(' ')}; fi
      return ;;
    --profile|--portal-url|--name|--email|--tenant|--subject|--message|--agent) return ;;
  esac
  if [[ -z "$cmd" ]]; then
    compadd -- ${commands.join(' ')} ${GLOBAL_FLAGS.join(' ')}; return
  fi
  subs=()
  case "$cmd" in
${subCases}
  esac
  if [[ -z "$sub" && \${#subs} -gt 0 && "$PREFIX" != -* ]]; then
    compadd -- $subs; return
  fi
  flags=(${GLOBAL_FLAGS.join(' ')})
  case "$cmd \${sub}" in
${flagCases.replace(/"([a-z]+)"\)/g, '"$1 ")')}
  esac
  compadd -- $flags
}
if (( $+functions[compdef] )); then compdef _sqlcockpit sqlcockpit; fi
`;
}

function powershell() {
  const { commands, subs, flags } = tree();
  const psList = (items) => `@(${items.map((i) => `'${i}'`).join(', ')})`;
  const subMap = Object.entries(subs).map(([c, s]) => `    '${c}' = ${psList(s)}`).join('\n');
  const flagMap = Object.entries(flags).map(([k, f]) => `    '${k}' = ${psList(f)}`).join('\n');
  return `# sqlcockpit PowerShell completion. Load with: sqlcockpit completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName sqlcockpit -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = ${psList(commands)}
  $globalFlags = ${psList(GLOBAL_FLAGS)}
  $subs = @{
${subMap}
  }
  $flags = @{
${flagMap}
  }
  $valueFlags = @('-o', '--output', '--profile', '--portal-url', '--name', '--email', '--role', '--tenant', '--status', '--subject', '--message', '--agent')
  $elements = @($commandAst.CommandElements | Select-Object -Skip 1 | Where-Object { $_.Extent.EndOffset -lt $cursorPosition -or ($_.Extent.EndOffset -eq $cursorPosition -and $wordToComplete -eq '') } | ForEach-Object { $_.ToString() })
  $words = @()
  $prev = ''
  for ($i = 0; $i -lt $elements.Count; $i++) {
    $w = $elements[$i]
    if ($valueFlags -contains $w) { $i++; continue }
    if ($w.StartsWith('-')) { continue }
    $words += $w
  }
  if ($elements.Count -gt 0) { $prev = $elements[-1] }
  $candidates = switch ($prev) {
    { $_ -in '-o', '--output' } { @('table', 'json', 'yaml'); break }
    '--role' { ${psList(ASSIGNABLE_ROLES)}; break }
    '--status' { if ($words.Count -gt 0 -and $words[0] -eq 'agent') { ${psList(AGENT_STATUSES)} } else { ${psList(TICKET_STATUSES)} }; break }
    default { $null }
  }
  if ($null -eq $candidates) {
    if ($words.Count -eq 0) { $candidates = $commands + $globalFlags }
    elseif ($words.Count -eq 1 -and $subs.ContainsKey($words[0]) -and -not $wordToComplete.StartsWith('-')) { $candidates = $subs[$words[0]] }
    else {
      $key = if ($words.Count -ge 2 -and $flags.ContainsKey("$($words[0]) $($words[1])")) { "$($words[0]) $($words[1])" } else { $words[0] }
      $candidates = $globalFlags
      if ($flags.ContainsKey($key)) { $candidates = $flags[$key] + $globalFlags }
    }
  }
  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
}

export function completionScript(shell) {
  if (shell === 'bash') return bash();
  if (shell === 'zsh') return zsh();
  if (shell === 'powershell') return powershell();
  throw new UsageError(`Unknown shell "${shell}". Use one of: ${SHELLS.join(', ')}.`);
}
