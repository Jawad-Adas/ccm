import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-prof-'));
process.env.CCM_CLAUDE_DIR = path.join(process.env.CCM_HOME, 'fake-claude');
const { prepareProfileDir, hasDefaultLogin, importDefaultInto } = await import('../src/profiles.js');
const { profileDir } = await import('../src/paths.js');
const { registerProfile } = await import('../src/registry.js');

test('prepareProfileDir creates the config dir with the shared layer', () => {
  registerProfile('t1');
  prepareProfileDir('t1');
  const dir = profileDir('t1');
  assert.ok(fs.existsSync(dir));
  for (const d of ['agents', 'skills', 'commands', 'hooks']) {
    assert.ok(fs.lstatSync(path.join(dir, d)), `${d} present`);
  }
});

test('importDefaultInto copies credentials and history', () => {
  const fake = process.env.CCM_CLAUDE_DIR;
  fs.mkdirSync(path.join(fake, 'projects', 'C--x'), { recursive: true });
  fs.writeFileSync(path.join(fake, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"t"}}');
  fs.writeFileSync(path.join(fake, 'history.jsonl'), '{}');
  fs.writeFileSync(path.join(fake, 'projects', 'C--x', 'ab.jsonl'), '{}');

  assert.ok(hasDefaultLogin());
  registerProfile('t2');
  prepareProfileDir('t2');
  importDefaultInto('t2');
  const dir = profileDir('t2');
  assert.ok(fs.existsSync(path.join(dir, '.credentials.json')));
  assert.ok(fs.existsSync(path.join(dir, 'history.jsonl')));
  assert.ok(fs.existsSync(path.join(dir, 'projects', 'C--x', 'ab.jsonl')));

  registerProfile('t3');
  prepareProfileDir('t3');
  importDefaultInto('t3', { withHistory: false });
  assert.ok(fs.existsSync(path.join(profileDir('t3'), '.credentials.json')));
  assert.ok(!fs.existsSync(path.join(profileDir('t3'), 'history.jsonl')));
});
