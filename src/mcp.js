import fs from 'node:fs';
import path from 'node:path';
import { SHARED_MCP, profileDir, DEFAULT_CLAUDE_DIR, HOME_CLAUDE_JSON } from './paths.js';
import { readJson, writeJson, bold, dim, colorize } from './util.js';
import { listProfiles } from './registry.js';

function sharedServers() {
  return readJson(SHARED_MCP, {})?.mcpServers ?? {};
}

// The ccm-injected file inside a profile dir (legacy shared-server view).
function profileServers(dir) {
  return readJson(path.join(dir, '.mcp.json'), {})?.mcpServers ?? {};
}

// Where Claude Code actually stores a config dir's MCP servers. For the default
// ~/.claude account this lives at ~/.claude.json (beside, not inside, the dir).
export function claudeJsonPath(dir) {
  return dir === DEFAULT_CLAUDE_DIR ? HOME_CLAUDE_JSON : path.join(dir, '.claude.json');
}

// Claude Code keys projects by their forward-slash absolute path (even on
// Windows). A local-scoped server only loads when its key matches the running
// cwd in this exact form.
export function normalizeProjectKey(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

function writeClaudeJson(dir, obj) {
  const file = claudeJsonPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.ccm-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file); // atomic: never leave .claude.json half-written
}

// An account's own MCP servers (from its .claude.json), each tagged with the
// scope Claude Code loads it at: 'user' (everywhere) or 'local' (one project,
// with `project` set). Shared/ccm-injected servers are not included here — they
// already exist in every account.
export function listAccountServers(name) {
  const cj = readJson(claudeJsonPath(profileDir(name)), {}) ?? {};
  const out = [];
  for (const [n, def] of Object.entries(cj.mcpServers ?? {})) {
    out.push({ name: n, def, scope: 'user' });
  }
  for (const [project, entry] of Object.entries(cj.projects ?? {})) {
    for (const [n, def] of Object.entries(entry?.mcpServers ?? {})) {
      out.push({ name: n, def, scope: 'local', project });
    }
  }
  return out;
}

// Copy one MCP server from account `from` into account `to`, landing it at the
// chosen scope in the target's .claude.json. Returns { replaced } (true when the
// target already had a server of that name at that scope) or { error }.
export function copyServer({ from, name, sourceScope, sourceProject, to, targetScope, targetProject }) {
  const matches = listAccountServers(from).filter((s) => s.name === name);
  const src = matches.find((s) =>
    (!sourceScope || s.scope === sourceScope) &&
    (sourceScope !== 'local' || !sourceProject || normalizeProjectKey(s.project) === normalizeProjectKey(sourceProject)),
  );
  if (!src) return { error: `no MCP server "${name}" in ${from}` };
  const def = JSON.parse(JSON.stringify(src.def)); // independent clone

  const targetDir = profileDir(to);
  const cj = readJson(claudeJsonPath(targetDir), {}) ?? {};
  let replaced = false;
  let project = null;
  if (targetScope === 'local') {
    project = normalizeProjectKey(targetProject);
    cj.projects = cj.projects ?? {};
    cj.projects[project] = cj.projects[project] ?? {};
    cj.projects[project].mcpServers = cj.projects[project].mcpServers ?? {};
    replaced = name in cj.projects[project].mcpServers;
    cj.projects[project].mcpServers[name] = def;
  } else {
    cj.mcpServers = cj.mcpServers ?? {};
    replaced = name in cj.mcpServers;
    cj.mcpServers[name] = def;
  }
  writeClaudeJson(targetDir, cj);
  return { replaced, scope: targetScope, project };
}

// Default the target scope/project from the source when not explicitly chosen:
// a local server stays local to its own project; a user server stays user-scoped.
export function resolveCopyTarget({ from, name, scope, project }, cwd) {
  const matches = listAccountServers(from).filter((s) => s.name === name);
  const src = matches.find((s) => !scope || s.scope === scope) ?? matches[0];
  const targetScope = scope ?? (src?.scope === 'local' ? 'local' : 'user');
  const targetProject = targetScope === 'local' ? (project ?? src?.project ?? cwd) : null;
  return { sourceScope: src?.scope ?? null, sourceProject: src?.project ?? null, targetScope, targetProject };
}

// `ccm mcp copy <server> --from A --to B [--scope user|local] [--project P]`
export function parseMcpCopy(args) {
  const opts = { name: null, from: null, to: null, scope: null, project: null };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from') opts.from = args[++i];
    else if (a === '--to') opts.to = args[++i];
    else if (a === '--scope') opts.scope = args[++i];
    else if (a === '--project') opts.project = args[++i];
    else rest.push(a);
  }
  opts.name = rest[0] ?? null;
  return opts;
}

export function mcpList() {
  const shared = sharedServers();
  const out = [bold('Shared (injected into every profile):')];
  const names = Object.keys(shared);
  out.push(names.length ? names.map((n) => `  ${colorize('green', '●')} ${n}`).join('\n') : dim('  (none)'));
  for (const p of listProfiles()) {
    const own = listAccountServers(p.name);
    const user = own.filter((s) => s.scope === 'user').map((s) => s.name);
    const local = own.filter((s) => s.scope === 'local');
    const parts = [];
    if (user.length) parts.push(`user: ${user.join(', ')}`);
    if (local.length) parts.push(`local: ${local.map((s) => `${s.name} @ ${path.basename(s.project)}`).join(', ')}`);
    out.push(`${bold(p.name)}: ${parts.length ? parts.join('   ') : dim('shared only')}`);
  }
  return out.join('\n');
}

// Find a server definition by name: given profile first, then all profiles,
// then the default ~/.claude. Searches both the legacy .mcp.json and .claude.json.
function findServerDef(name, fromProfile) {
  const sources = [
    ...(fromProfile ? [{ label: fromProfile, dir: profileDir(fromProfile) }] : []),
    ...listProfiles().map((p) => ({ label: p.name, dir: profileDir(p.name) })),
    { label: '~/.claude', dir: DEFAULT_CLAUDE_DIR },
  ];
  for (const src of sources) {
    const legacy = profileServers(src.dir)[name];
    if (legacy) return { def: legacy, from: src.label };
    const cj = readJson(claudeJsonPath(src.dir), {}) ?? {};
    if (cj.mcpServers?.[name]) return { def: cj.mcpServers[name], from: src.label };
    for (const entry of Object.values(cj.projects ?? {})) {
      if (entry?.mcpServers?.[name]) return { def: entry.mcpServers[name], from: src.label };
    }
  }
  return null;
}

export function mcpShare(name, fromProfile) {
  const found = findServerDef(name, fromProfile);
  if (!found) return { error: `no MCP server "${name}" found in any profile or ~/.claude` };
  const cfg = readJson(SHARED_MCP, {}) ?? {};
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [name]: found.def };
  writeJson(SHARED_MCP, cfg);
  return { from: found.from };
}

export function mcpUnshare(name) {
  const cfg = readJson(SHARED_MCP, {}) ?? {};
  if (!cfg.mcpServers?.[name]) return { error: `"${name}" is not a shared MCP server` };
  delete cfg.mcpServers[name];
  writeJson(SHARED_MCP, cfg);
  return {};
}
