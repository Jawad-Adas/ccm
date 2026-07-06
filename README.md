# ccm — Claude Code account manager

Unlimited named accounts for Claude Code. Launching is switching: every profile is an
isolated `CLAUDE_CONFIG_DIR`, so any number of accounts can run **at the same time**
in different terminals — no swap step, no shared mutable state to corrupt.

```
ccm                     pinned account here? launch it — otherwise interactive picker
ccm work                launch Claude Code on the "work" account
ccm work --resume       extra args pass straight through to claude
ccm status              quota dashboard for every account
```

## Install

```powershell
cd path\to\ccm
npm install -g .
```

Requires Node 18+ and Claude Code on PATH. Zero dependencies.

## Getting started

```powershell
ccm import work        # adopt your current ~/.claude login as profile "work"
ccm add personal       # opens Claude Code once — log in with the second account, then /exit
ccm list
```

Your `~/.claude` and the plain `claude` command are never touched — `ccm` is purely additive.

## Commands

| Command | What it does |
|---|---|
| `ccm` | Launches the pinned account for this folder, or shows the arrow-key picker |
| `ccm <name> [args…]` | Launch that account; args pass through to `claude` |
| `ccm pick` | Force the picker (ignores any pin) |
| `ccm import [name]` | Adopt the current `~/.claude` login as a profile, including session history so `--resume` sees past conversations (`--no-history` to skip) |
| `ccm add <name>` | New profile + first login |
| `ccm list` | Profiles at a glance (email, plan, running/last-used) |
| `ccm remove <name>` | Delete a profile (confirms; refuses if running) |
| `ccm status [--fresh\|--json]` | Usage bars, reset times, severity for every account |
| `ccm pin <name>` / `ccm unpin` | This folder (and subfolders) always uses that account |
| `ccm statusline install` | Show `● work · 5h 43% · wk 12%` inside Claude Code's statusline |

## How it works

```
~/.ccm/
  config.json            profile registry
  cache/usage.json       cached quota data
  profiles/<name>/       a full CLAUDE_CONFIG_DIR: credentials, sessions, history
  shared/                settings.json, CLAUDE.md, agents/, skills/, commands/, hooks/
```

- **Shared config**: directories are junction-linked into every profile (no admin needed
  on Windows); `settings.json` / `CLAUDE.md` are copied in on each launch when the shared
  copy is newer. Configure once in `~/.ccm/shared`, all accounts see it.
- **Quota data** comes from the same undocumented OAuth usage endpoint Claude Code's own
  `/usage` uses. If Anthropic changes it, only the quota columns degrade.
- **Pinning**: `ccm pin work` writes a `.ccmrc` file; `ccm` walks up from the current
  folder and auto-launches the nearest pin.
- **No auto-rotation**: ccm deliberately does not auto-switch accounts when quota runs
  out — rotating accounts to evade rate limits is against Anthropic's ToS. Switching is
  always your explicit choice.
