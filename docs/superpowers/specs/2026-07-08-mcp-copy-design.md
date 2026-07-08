# MCP copy across accounts — design

**Date:** 2026-07-08
**Status:** approved

## Problem

MCP servers a user configures in one ccm account do not appear in another. Two
causes:

1. **ccm reads the wrong file.** `src/mcp.js` only inspects a `.mcp.json` inside
   each profile dir. Claude Code actually stores user- and local-scoped MCP
   servers in **`.claude.json`** (the `CLAUDE_CONFIG_DIR`), which ccm never
   reads. So `ccm mcp list` / `share` are blind to exactly the servers users
   have.
2. **Scope is per-profile.** Even once surfaced, a server configured in account
   A's `.claude.json` is invisible to account B because each profile is its own
   config dir. There is no way to copy one across.

Observed on this machine: the `gasable` profile has user-scoped `netlify`,
`notion`, `cloudflare`, `playwright` and **local-scoped** `supabase-staging`,
`supabase-production`, `supabase-corporate`, `corporate-staging` (under the
`supplier-supabase-v2-main` project path). `personal` and `jka` have none.

## Where Claude Code stores MCP servers

Inside a `CLAUDE_CONFIG_DIR` (= a ccm profile dir), `.claude.json` holds:

- **User scope** → top-level `mcpServers` (available in every folder).
- **Local scope** → `projects[<path>].mcpServers` (only in that one project).

Plus **project scope** → a `.mcp.json` in the actual project working directory
(checked into the repo, already shared across accounts — out of scope here).

Project keys on Windows are **forward-slash absolute paths**
(`C:/Users/Thinkpad/Documents/Projects/...`). Local-scoped writes MUST normalize
to this form (`path.resolve(p).replace(/\\/g, '/')`) or Claude Code will not
match the running cwd to the stored key.

## Design

### 1. Core logic — `src/mcp.js` (pure, unit-tested)

- `readClaudeJson(dir)` — safe read of a profile's `.claude.json`.
- `listAccountServers(profileName)` → array of
  `{ name, def, scope, project? }` where `scope` is one of:
  - `'user'` — from `.claude.json` top-level `mcpServers`
  - `'local'` — from `.claude.json` `projects[path].mcpServers`; `project` set
  - `'shared'` — ccm-injected (from `SHARED_MCP`); shown, not a copy source
  When the same name exists at multiple scopes, all are listed (scope
  disambiguates them).
- `copyServer({ from, name, sourceScope, sourceProject, to, targetScope, targetProject })`
  → resolves the server def from the source, writes it into the **target's
  `.claude.json`** at the chosen scope:
  - `targetScope === 'user'` → top-level `mcpServers[name]`
  - `targetScope === 'local'` → `projects[normalize(targetProject)].mcpServers[name]`
    (creating the project entry if absent)
  - Atomic write (temp file + rename), preserving all other `.claude.json` keys.
  - Returns `{ replaced: boolean }` when the target already had that name at
    that scope.
- Fix `mcpList()` to read `.claude.json` locations too, so `ccm mcp list` stops
  being blind.

### 2. CLI — `ccm mcp copy`

`ccm mcp copy <server> --from <A> --to <B> [--scope user|local] [--project <path>]`

Thin wrapper over `copyServer`. Gives an independently useful, unit-testable
entry point that both boards reuse (the boards themselves are not unit-tested).
Defaults: scope follows the source (`local` if the source is local, else
`user`); `--project` defaults to the source's project path (local source) or the
current cwd (user source).

### 3. Copy flow (both boards, identical logic)

1. Open MCP view — accounts with their servers, each tagged
   `[user]` / `[proj: <basename>]` / `[shared]`.
2. Select a server (a `user`/`local` one; `shared` is not a source).
3. Choose **target account**.
4. Choose **scope** — `user` (everywhere) or `local` to a project. Default
   project = the source's project (local source) or current cwd (user source);
   editable.
5. Write + confirm: `COPIED supabase-staging → personal (local: supplier-…)` or
   `REPLACED …` on collision.

### 4. TUI — `src/tui/app.js`

- New `view: 'mcp'`, reached from the board with **`x`** (`m`/`s` are the
  sessions view; `a`, `r`, `d` taken). Footer help updated.
- MCP view renders accounts as grouped rows with server + scope tag, reusing the
  sessions-view row/selection machinery.
- `enter` on a server → **target overlay** (pick account) → **scope overlay**
  (user vs local-to-project). Mirrors the existing `transfer` overlay.
- On confirm, call `copyServer`, set a status `msg`, return to the MCP view.

### 5. Web — `src/ui/server.js` + `src/ui/board.html`

- `/api/state` already returns profiles; add MCP data (or a dedicated
  `/api/mcp` GET) listing `listAccountServers` per profile.
- New `POST /api/mcp/copy` → `copyServer`, returns `{ ok, replaced }`.
- Dashboard gets an MCP section: servers grouped by account with scope tags and
  a copy control (target select + scope toggle) matching the TUI flow.

## Edge cases

- **Name collision** in target at the chosen scope → overwrite, reported as
  `REPLACED` (never silent).
- **Secrets:** MCP defs often carry tokens in `env`. Copy is verbatim between
  the user's own accounts on the same machine — expected; no masking. Noted in
  the confirmation text.
- **Single target per copy** — repeat for more, matching `move-session`.
- **Missing source `.claude.json`** or unknown server/profile → clear error, no
  partial write.

## Testing

Unit tests (node --test) against a temp `CCM_HOME`:

- `listAccountServers` surfaces user + local + shared scopes with correct tags
  and project paths.
- `copyServer` user→user, user→local, local→local; project key normalized to
  forward slashes; other `.claude.json` keys preserved; `replaced` flag correct.
- `mcpList` now includes `.claude.json` servers.
- CLI arg parsing for `ccm mcp copy` (scope/project defaulting).

Board wiring is verified by running the app; core behavior is covered by the
pure-function tests.
