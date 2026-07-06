# ccm — Claude Code account manager (design spec)

Date: 2026-07-06 · Status: approved by user, implemented same day

## Problem

Claude Code supports one login per config directory and has no built-in multi-account
support. The user wants: unlimited accounts, easy switching, per-account status, and
simultaneous sessions on different accounts. Per-prompt switching inside one session is
technically impossible (credentials bind at process launch), so per-session switching is
the design granularity.

## Decision: profile-launcher architecture

Chosen over a credential swapper (claude-swap style) and a hybrid. Every account is a
named profile owning a full `CLAUDE_CONFIG_DIR` under `~/.ccm/profiles/<name>`. Launching
is switching (`ccm work` sets `CLAUDE_CONFIG_DIR` and spawns `claude`), so simultaneous
sessions need no special mode and there is no global mutable state (no swap races with
token refresh). `~/.claude` and plain `claude` remain untouched.

## Components

- **registry** (`~/.ccm/config.json`): profile metadata (email, plan, org, color,
  lastUsed). Identity is refreshed after each launch from the profile's own
  `.claude.json` (`oauthAccount`) and `.credentials.json` (`claudeAiOauth`). Corrupt or
  missing registry is rebuilt by scanning the profiles directory.
- **shared layer** (`~/.ccm/shared/`): one source of truth for config. Directories
  (`agents`, `skills`, `commands`, `hooks`) junction-linked into each profile (junctions
  need no admin on Windows); files (`settings.json`, `CLAUDE.md`) copied in on each
  launch when the shared copy is newer (file symlinks would need admin). Seeded from
  `~/.claude` on first use.
- **launcher**: syncs shared layer, writes a `ccm.lock` (pid) into the profile for
  running-detection, spawns `claude` with `stdio: inherit`, passes through extra args,
  refreshes identity on exit.
- **usage**: GET `https://api.anthropic.com/api/oauth/usage` with the profile's Bearer
  token (undocumented; same endpoint as Claude Code's `/usage`). Parses the `limits`
  array (kind/percent/severity/resets_at/scope) with legacy `five_hour`/`seven_day`
  fallback. 5-minute cache in `~/.ccm/cache/usage.json`; expired tokens are reported,
  never refreshed by ccm (auth stays Claude Code's job).
- **status dashboard**: per-account usage bars, reset countdowns, severity colors,
  running markers.
- **picker**: raw-mode arrow-key TUI (cache-only quota inline); non-TTY falls back to a
  plain list.
- **pinning**: `.ccmrc` file (first line = profile name); `ccm` walks up from cwd,
  nearest pin wins and launches directly. `ccm pick` overrides.
- **statusline**: `ccm statusline` detects the session's profile via the inherited
  `CLAUDE_CONFIG_DIR`, prints name/email/short quota from cache, and fires a detached
  background refresh when stale. `ccm statusline install` sets it in shared
  settings.json only.

## Explicitly excluded

Auto-switching accounts on quota exhaustion (ToS risk — Anthropic's clarification
targeted rate-limit evasion; switching must remain a user choice), mid-session account
changes (impossible), and any token-refresh logic.

## Error handling

Unknown profile → list names; `claude` missing → install hint; junction failure → copy
fallback with warning; corrupt registry → rebuild; remove-while-running → refuse;
usage-API failure → stale cache preferred, labeled hints (expired / unauthorized /
network); statusline never throws.

## Testing

`node --test` unit suites: registry CRUD/validation, pin walk-up resolution, usage
parsing (live-captured sample) + cache TTL, statusline profile detection and rendering,
formatting helpers. Launch/junction paths verified end-to-end manually on Windows 11.
