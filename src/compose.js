import fs from 'node:fs';
import path from 'node:path';
import {
  SHARED_DIR, SHARED_MCP, MCP_RECORD_DIR,
  overrideSettingsPath, overrideClaudeMdPath,
} from './paths.js';
import { readJson, writeJson, deepMerge } from './util.js';
import { getProfile } from './registry.js';
import { seedFromDefault, syncMemory } from './memory.js';

function newestMtime(...files) {
  let m = 0;
  for (const f of files) {
    try { m = Math.max(m, fs.statSync(f).mtimeMs); } catch {}
  }
  return m;
}

function mtimeOf(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// Compose a profile's config from the shared layer + per-profile overrides.
// Settings and CLAUDE.md use a newer-mtime rule so edits made inside a session
// (/config) survive until the shared/override sources actually change.
export function composeProfile(name, dir) {
  composeSettings(name, dir);
  composeClaudeMd(name, dir);
  const warnings = composeMcp(name, dir);
  seedFromDefault();
  warnings.push(...syncMemory(dir, getProfile(name)?.memory === 'private' ? 'private' : 'shared'));
  return warnings;
}

function composeSettings(name, dir) {
  const sharedFile = path.join(SHARED_DIR, 'settings.json');
  const ovFile = overrideSettingsPath(name);
  const src = newestMtime(sharedFile, ovFile);
  if (!src || src <= mtimeOf(path.join(dir, 'settings.json'))) return;
  writeJson(path.join(dir, 'settings.json'), deepMerge(readJson(sharedFile, {}), readJson(ovFile, {})));
}

function composeClaudeMd(name, dir) {
  const sharedFile = path.join(SHARED_DIR, 'CLAUDE.md');
  const fragFile = overrideClaudeMdPath(name);
  const src = newestMtime(sharedFile, fragFile);
  if (!src || src <= mtimeOf(path.join(dir, 'CLAUDE.md'))) return;
  let content = '';
  try { content = fs.readFileSync(sharedFile, 'utf8'); } catch {}
  let frag = '';
  try { frag = fs.readFileSync(fragFile, 'utf8'); } catch {}
  if (frag.trim()) {
    content = content.trimEnd() + `\n\n<!-- ccm: profile "${name}" additions -->\n` + frag.trim() + '\n';
  }
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), content);
}

// Pure merge of shared MCP servers into a profile's .mcp.json.
// `injected` records which server names ccm owns in this profile; servers the
// profile added itself always win over a same-named shared server.
export function mergeMcpServers(current, shared, injected) {
  const next = { ...current, mcpServers: { ...(current.mcpServers ?? {}) } };
  const warnings = [];
  const record = [];
  const injectedSet = new Set(injected);
  for (const name of injected) {
    if (!(name in shared)) delete next.mcpServers[name];
  }
  for (const [name, def] of Object.entries(shared)) {
    if (name in next.mcpServers && !injectedSet.has(name)) {
      warnings.push(`mcp server "${name}" exists in this profile; keeping the profile's own version`);
      continue;
    }
    next.mcpServers[name] = def;
    record.push(name);
  }
  const changed = JSON.stringify(next) !== JSON.stringify({ ...current, mcpServers: current.mcpServers ?? {} });
  return { next, record, warnings, changed };
}

function composeMcp(name, dir) {
  const shared = readJson(SHARED_MCP, {})?.mcpServers ?? {};
  const recordFile = path.join(MCP_RECORD_DIR, `${name}.json`);
  const injected = readJson(recordFile, []);
  if (!Object.keys(shared).length && !injected.length) return [];
  const mcpFile = path.join(dir, '.mcp.json');
  const current = readJson(mcpFile, {}) ?? {};
  const { next, record, warnings, changed } = mergeMcpServers(current, shared, injected);
  if (changed) writeJson(mcpFile, next);
  if (JSON.stringify(record) !== JSON.stringify(injected)) writeJson(recordFile, record);
  return warnings;
}
