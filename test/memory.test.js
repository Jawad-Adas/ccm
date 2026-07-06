import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-mem-'));
process.env.CCM_CLAUDE_DIR = path.join(process.env.CCM_HOME, 'fake-claude');
const { syncMemory, seedFromDefault, memoryStatus, SHARED_MEMORY_DIR } = await import('../src/memory.js');
const { profileDir } = await import('../src/paths.js');
const { registerProfile } = await import('../src/registry.js');

const memFile = (dir, slug, f) => path.join(dir, 'projects', slug, 'memory', f);

function mkMemory(dir, slug, files) {
  fs.mkdirSync(path.join(dir, 'projects', slug, 'memory'), { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(memFile(dir, slug, name), content);
}

registerProfile('a');
registerProfile('b');
const A = profileDir('a');
const B = profileDir('b');

test('local memory is pooled: merged, backed up, junctioned', () => {
  mkMemory(A, 'C--repo', { 'MEMORY.md': 'facts from a' });
  const warnings = syncMemory(A);
  assert.deepEqual(warnings, []);
  assert.equal(fs.readFileSync(path.join(SHARED_MEMORY_DIR, 'C--repo', 'MEMORY.md'), 'utf8'), 'facts from a');
  assert.ok(fs.lstatSync(path.join(A, 'projects', 'C--repo', 'memory')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(A, 'projects', 'C--repo', 'memory.bak', 'MEMORY.md')));
  // reading through the junction sees the pool
  assert.equal(fs.readFileSync(memFile(A, 'C--repo', 'MEMORY.md'), 'utf8'), 'facts from a');
});

test('another profile that visited the project gets linked to the pool', () => {
  fs.mkdirSync(path.join(B, 'projects', 'C--repo'), { recursive: true });
  syncMemory(B);
  assert.equal(fs.readFileSync(memFile(B, 'C--repo', 'MEMORY.md'), 'utf8'), 'facts from a');
  // writes through profile B land in the pool → visible to profile A
  fs.writeFileSync(memFile(B, 'C--repo', 'new-fact.md'), 'learned on b');
  assert.equal(fs.readFileSync(memFile(A, 'C--repo', 'new-fact.md'), 'utf8'), 'learned on b');
});

test('unvisited projects and memory-less projects are left alone', () => {
  fs.mkdirSync(path.join(B, 'projects', 'C--no-memory-anywhere'), { recursive: true });
  syncMemory(B);
  assert.ok(!fs.existsSync(path.join(B, 'projects', 'C--no-memory-anywhere', 'memory')));
  assert.ok(!fs.existsSync(path.join(A, 'projects', 'C--never-visited')));
});

test('newer local files win the merge', () => {
  mkMemory(A, 'C--two', { 'x.md': 'old' });
  syncMemory(A);
  const past = new Date(Date.now() - 1e6);
  fs.utimesSync(path.join(SHARED_MEMORY_DIR, 'C--two', 'x.md'), past, past);
  // b has a NEWER local copy of the same project memory
  mkMemory(B, 'C--two', { 'x.md': 'newer from b', 'extra.md': 'only b' });
  syncMemory(B);
  assert.equal(fs.readFileSync(path.join(SHARED_MEMORY_DIR, 'C--two', 'x.md'), 'utf8'), 'newer from b');
  assert.equal(fs.readFileSync(path.join(SHARED_MEMORY_DIR, 'C--two', 'extra.md'), 'utf8'), 'only b');
});

test('private mode forks the pool into a real directory', () => {
  syncMemory(A, 'private');
  const st = fs.lstatSync(path.join(A, 'projects', 'C--repo', 'memory'));
  assert.ok(!st.isSymbolicLink());
  assert.ok(st.isDirectory());
  // fork carries the pooled content but new pool writes no longer arrive
  assert.equal(fs.readFileSync(memFile(A, 'C--repo', 'new-fact.md'), 'utf8'), 'learned on b');
  fs.writeFileSync(path.join(SHARED_MEMORY_DIR, 'C--repo', 'later.md'), 'after fork');
  assert.ok(!fs.existsSync(memFile(A, 'C--repo', 'later.md')));
  // going shared again re-pools (the fork merges back)
  syncMemory(A);
  assert.ok(fs.lstatSync(path.join(A, 'projects', 'C--repo', 'memory')).isSymbolicLink());
});

test('seedFromDefault pools the default ~/.claude memories once', () => {
  mkMemory(process.env.CCM_CLAUDE_DIR, 'C--seeded', { 'MEMORY.md': 'from default' });
  seedFromDefault();
  assert.equal(fs.readFileSync(path.join(SHARED_MEMORY_DIR, 'C--seeded', 'MEMORY.md'), 'utf8'), 'from default');
  // default dir itself is untouched (no junction)
  assert.ok(!fs.lstatSync(path.join(process.env.CCM_CLAUDE_DIR, 'projects', 'C--seeded', 'memory')).isSymbolicLink());
});

test('memoryStatus counts pooled vs local', () => {
  const s = memoryStatus(A);
  assert.ok(s.linked >= 2);
  assert.equal(s.local, 0);
});
