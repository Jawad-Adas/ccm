import path from 'node:path';
import { SHARED_MCP, profileDir, DEFAULT_CLAUDE_DIR } from './paths.js';
import { readJson, writeJson, bold, dim, colorize } from './util.js';
import { listProfiles } from './registry.js';

function sharedServers() {
  return readJson(SHARED_MCP, {})?.mcpServers ?? {};
}

function profileServers(dir) {
  return readJson(path.join(dir, '.mcp.json'), {})?.mcpServers ?? {};
}

export function mcpList() {
  const shared = sharedServers();
  const out = [bold('Shared (injected into every profile):')];
  const names = Object.keys(shared);
  out.push(names.length ? names.map((n) => `  ${colorize('green', '●')} ${n}`).join('\n') : dim('  (none)'));
  for (const p of listProfiles()) {
    const own = Object.entries(profileServers(profileDir(p.name)))
      .filter(([n]) => !(n in shared)).map(([n]) => n);
    out.push(`${bold(p.name)}: ${own.length ? own.join(', ') : dim('shared only')}`);
  }
  return out.join('\n');
}

// Find a server definition by name: given profile first, then all profiles,
// then the default ~/.claude.
function findServerDef(name, fromProfile) {
  const sources = [
    ...(fromProfile ? [{ label: fromProfile, dir: profileDir(fromProfile) }] : []),
    ...listProfiles().map((p) => ({ label: p.name, dir: profileDir(p.name) })),
    { label: '~/.claude', dir: DEFAULT_CLAUDE_DIR },
  ];
  for (const src of sources) {
    const def = profileServers(src.dir)[name];
    if (def) return { def, from: src.label };
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
