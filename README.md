# ccm — Claude Code account manager

Unlimited named accounts for Claude Code. Launching is switching: every profile is an
isolated `CLAUDE_CONFIG_DIR`, so any number of accounts can run **at the same time**
in different terminals — no swap step, no shared mutable state to corrupt.

The interface is a **split-flap departure board** (think Solari airport board): your
accounts are rows, quota windows are tile meters with amber reset clocks, and cells
flip and settle when data changes. It ships twice — as a full-screen terminal app
(`ccm`) and as a local web page (`ccm ui`) that launches accounts into Windows
Terminal tabs.

```
ccm                     pinned account here? launch it — otherwise the account board:
                        pick an account (sorted by headroom), press a to add an
                        account right there (fresh login or adopt ~/.claude),
                        jump to departures
                        (sessions to resume/transfer — press a to switch between this
                        folder and ALL folders, with each session's directory shown;
                        resuming opens Claude Code in that session's own folder),
                        run doctor — all in one screen
ccm ui                  the same board in your browser (local only, 127.0.0.1)
ccm work                launch Claude Code on the "work" account directly
ccm work --resume       extra args pass straight through to claude
ccm status              quota dashboard for every account (plain output)
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
| `ccm move-session <to> [id]` | Copy the latest session for this folder (or a given id) to another account and resume it there — the original stays put (`--no-launch` to skip launching) |
| `ccm override <name> [key=value…]` | Per-profile settings merged over the shared layer at launch (e.g. `model=opus theme=dark env.FOO=1`); `--unset key`, `--clear`. `~/.ccm/overrides/<name>.CLAUDE.md` is appended to the shared CLAUDE.md the same way |
| `ccm mcp list / share <name> / unshare <name>` | Shared MCP servers are injected into every profile; servers a profile adds itself always win and are never touched |
| `ccm doctor` | Health check: claude binary, tokens, junctions (auto-repairs), stale locks, integrations |
| `ccm notify on\|off\|test` | Windows toasts on crossing 80%/95% of any limit and when a limit resets ("fresh again") |
| `ccm wt install` | One Windows Terminal profile per account with colored tabs (via WT fragments; auto-synced on add/remove) |
| `ccm pin <name>` / `ccm unpin` | This folder (and subfolders) always uses that account |
| `ccm statusline install` | Show `● work · 5h 43% · wk 12%` inside Claude Code's statusline — and a `→ ccm move-session <best>` hint when you near a limit and another account has headroom |

## How it works

```
~/.ccm/
  config.json            profile registry
  cache/usage.json       cached quota data
  profiles/<name>/       a full CLAUDE_CONFIG_DIR: credentials, sessions, history
  shared/                settings.json, CLAUDE.md, agents/, skills/, commands/, hooks/
```

- **Shared config**: directories are junction-linked into every profile (no admin needed
  on Windows); `settings.json` / `CLAUDE.md` / MCP servers are *composed* into each
  profile at launch: shared base + per-profile overrides from `~/.ccm/overrides/`.
  A newer-mtime rule means changes made inside a session (`/config`) survive until the
  shared or override sources actually change. Configure once, override per account.
- **Quota-aware picker**: accounts are listed most-headroom-first with a ✦ marker, so
  picking the account with room is the default gesture — switching stays your choice.
- **Shared auto-memory**: what Claude learns about a project (`projects/<slug>/memory`)
  is pooled in `~/.ccm/shared/memory` and junction-linked into every profile at launch —
  the memory follows the repo, not the account. Originals are kept as `memory.bak` when
  first pooled; the untouched `~/.claude` is seeded from but never linked. Opt an
  account out with `ccm override <name> memory=private` (it forks the pool and keeps
  its own from there; `memory=shared` re-pools it).
- **Quota data** comes from the same undocumented OAuth usage endpoint Claude Code's own
  `/usage` uses, and is fetched **live when the board opens** (`ccm` and `ccm ui` both
  refresh on launch). ccm refreshes each profile's access token the same way Claude Code
  does (via the stored refresh token) so the numbers are accurate even for accounts that
  aren't currently running. If a profile's own token can't be refreshed (e.g. the same
  account is also the `~/.claude` login and rotated it away), ccm **borrows a valid token
  from any other source on the same account** — usage is per-account, so the number is
  identical; borrowed tokens are used read-only and never rotated. Only if no live token
  exists anywhere for that account does the board fall back to the last reading, clearly
  marked **stale** ("as of Xh ago" + re-login hint) — never a stale number dressed up as
  live. If Anthropic changes the endpoint, only the quota columns degrade.
- **Pinning**: `ccm pin work` writes a `.ccmrc` file; `ccm` walks up from the current
  folder and auto-launches the nearest pin.
- **No auto-rotation**: ccm deliberately does not auto-switch accounts when quota runs
  out — rotating accounts to evade rate limits is against Anthropic's ToS. Switching is
  always your explicit choice.
