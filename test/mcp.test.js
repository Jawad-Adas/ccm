import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-mcp-'));
process.env.CCM_CLAUDE_DIR = path.join(process.env.CCM_HOME, 'fake-claude');
const {
  listAccountServers, copyServer, normalizeProjectKey, parseMcpCopy, mcpList,
} = await import('../src/mcp.js');
const { profileDir, SHARED_MCP } = await import('../src/paths.js');
const { registerProfile } = await import('../src/registry.js');

function writeClaude(name, obj) {
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(obj, null, 2));
}
function readClaude(name) {
  return JSON.parse(fs.readFileSync(path.join(profileDir(name), '.claude.json'), 'utf8'));
}

// A gasable-like source: user-scoped + local-scoped servers, plus unrelated keys.
registerProfile('src');
registerProfile('dst');
writeClaude('src', {
  numStartups: 42,
  mcpServers: { netlify: { command: 'netlify-mcp' }, cloudflare: { url: 'https://cf' } },
  projects: {
    'C:/proj/supplier': { mcpServers: { 'supabase-staging': { command: 'sb', env: { TOKEN: 'secret' } } } },
    'C:/proj/other': { history: [] },
  },
});
writeClaude('dst', { numStartups: 7, projects: { 'C:/proj/existing': { history: [1] } } });

test('normalizeProjectKey uses forward-slash absolute paths', () => {
  assert.equal(normalizeProjectKey('C:\\a\\b'), 'C:/a/b');
  assert.equal(normalizeProjectKey('C:/a/b'), 'C:/a/b');
});

test('listAccountServers surfaces user + local scopes from .claude.json', () => {
  const servers = listAccountServers('src');
  const user = servers.filter((s) => s.scope === 'user').map((s) => s.name).sort();
  assert.deepEqual(user, ['cloudflare', 'netlify']);
  const local = servers.filter((s) => s.scope === 'local');
  assert.equal(local.length, 1);
  assert.equal(local[0].name, 'supabase-staging');
  assert.equal(local[0].project, 'C:/proj/supplier');
  assert.deepEqual(listAccountServers('dst'), []); // no mcpServers anywhere
});

test('copyServer user -> user writes target top-level and preserves other keys', () => {
  const r = copyServer({ from: 'src', name: 'netlify', to: 'dst', targetScope: 'user' });
  assert.equal(r.replaced, false);
  const cj = readClaude('dst');
  assert.deepEqual(cj.mcpServers.netlify, { command: 'netlify-mcp' });
  assert.equal(cj.numStartups, 7);                    // untouched
  assert.ok(cj.projects['C:/proj/existing']);         // untouched
});

test('copyServer user -> local normalizes project key and creates the entry', () => {
  const r = copyServer({
    from: 'src', name: 'cloudflare', to: 'dst',
    targetScope: 'local', targetProject: 'C:\\proj\\new',
  });
  assert.equal(r.replaced, false);
  const cj = readClaude('dst');
  assert.deepEqual(cj.projects['C:/proj/new'].mcpServers.cloudflare, { url: 'https://cf' });
});

test('copyServer local -> local carries env (secrets) verbatim', () => {
  const r = copyServer({
    from: 'src', name: 'supabase-staging', sourceScope: 'local', sourceProject: 'C:/proj/supplier',
    to: 'dst', targetScope: 'local', targetProject: 'C:/proj/supplier',
  });
  assert.equal(r.replaced, false);
  const cj = readClaude('dst');
  assert.deepEqual(cj.projects['C:/proj/supplier'].mcpServers['supabase-staging'],
    { command: 'sb', env: { TOKEN: 'secret' } });
});

test('copyServer reports replaced on name collision at same scope', () => {
  const r = copyServer({ from: 'src', name: 'netlify', to: 'dst', targetScope: 'user' });
  assert.equal(r.replaced, true);
});

test('copyServer errors clearly when the server is not in the source', () => {
  const r = copyServer({ from: 'src', name: 'nope', to: 'dst', targetScope: 'user' });
  assert.ok(r.error);
  assert.match(r.error, /nope/);
});

test('copied server is an independent clone, not a shared reference', () => {
  copyServer({ from: 'src', name: 'netlify', to: 'dst', targetScope: 'user' });
  const cj = readClaude('dst');
  cj.mcpServers.netlify.command = 'mutated';
  // mutating the copy must not affect the source
  assert.equal(listAccountServers('src').find((s) => s.name === 'netlify').def.command, 'netlify-mcp');
});

test('parseMcpCopy pulls server name and flags', () => {
  const o = parseMcpCopy(['supabase-staging', '--from', 'src', '--to', 'dst', '--scope', 'local', '--project', 'C:/p']);
  assert.deepEqual(o, { name: 'supabase-staging', from: 'src', to: 'dst', scope: 'local', project: 'C:/p' });
});

test('mcpList now reflects .claude.json user + local servers', () => {
  fs.mkdirSync(path.dirname(SHARED_MCP), { recursive: true });
  fs.writeFileSync(SHARED_MCP, JSON.stringify({ mcpServers: { playwright: {} } }));
  const out = mcpList();
  assert.match(out, /playwright/);       // shared section
  assert.match(out, /netlify/);          // src user scope
  assert.match(out, /supabase-staging/); // src local scope
});
