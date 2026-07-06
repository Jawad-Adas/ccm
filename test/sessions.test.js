import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-sess-'));
const { slugForPath, listTranscripts } = await import('../src/sessions.js');
const { profileDir } = await import('../src/paths.js');
const { registerProfile } = await import('../src/registry.js');

test('slugForPath matches Claude Code project-folder naming', () => {
  assert.equal(slugForPath('C:\\Users\\Thinkpad'), 'C--Users-Thinkpad');
  assert.equal(slugForPath('C:\\Users\\Thinkpad\\projects\\ccm'), 'C--Users-Thinkpad-projects-ccm');
  assert.equal(slugForPath('C:\\a b\\c.d'), 'C--a-b-c-d');
});

test('listTranscripts finds jsonl sessions with ids and mtimes', () => {
  registerProfile('t1');
  const dir = path.join(profileDir('t1'), 'projects', 'C--x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'aaaa-bbbb.jsonl'), '{}');
  fs.writeFileSync(path.join(dir, 'not-a-session.txt'), '');
  const list = listTranscripts(profileDir('t1'), 'C--x');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'aaaa-bbbb');
  assert.ok(list[0].mtime > 0);
  assert.deepEqual(listTranscripts(profileDir('t1'), 'C--missing'), []);
});
