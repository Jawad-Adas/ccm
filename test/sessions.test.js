import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-sess-'));
process.env.CCM_CLAUDE_DIR = path.join(process.env.CCM_HOME, 'fake-claude');
const { slugForPath, listTranscripts, allSessions, sessionMeta } = await import('../src/sessions.js');
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

test('allSessions(null) sweeps every project folder and tags slugs', () => {
  const dir2 = path.join(profileDir('t1'), 'projects', 'C--y');
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(path.join(dir2, 'cccc-dddd.jsonl'), '{}');
  const here = allSessions('C--x');
  assert.deepEqual(here.map((s) => s.id), ['aaaa-bbbb']);
  const everywhere = allSessions(null);
  assert.deepEqual(everywhere.map((s) => s.id).sort(), ['aaaa-bbbb', 'cccc-dddd']);
  assert.equal(everywhere.find((s) => s.id === 'cccc-dddd').slug, 'C--y');
});

test('sessionMeta extracts title and cwd from the transcript head', () => {
  const f = path.join(profileDir('t1'), 'projects', 'C--x', 'meta-test.jsonl');
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'summary', summary: 'fix the login bug' }),
    JSON.stringify({ type: 'user', cwd: 'C:\\work\\api', message: { role: 'user', content: 'hello' } }),
  ].join('\n'));
  assert.deepEqual(sessionMeta(f), { title: 'fix the login bug', cwd: 'C:\\work\\api' });
  assert.deepEqual(sessionMeta(path.join(profileDir('t1'), 'nope.jsonl')), { title: null, cwd: null });
});
