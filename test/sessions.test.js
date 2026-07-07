import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-sess-'));
process.env.CCM_CLAUDE_DIR = path.join(process.env.CCM_HOME, 'fake-claude');
const { slugForPath, listTranscripts, allSessions, listSessions, sessionMeta, isUserFacing } = await import('../src/sessions.js');
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

test('sessionMeta extracts title, cwd and entrypoint from the transcript head', () => {
  const f = path.join(profileDir('t1'), 'projects', 'C--x', 'meta-test.jsonl');
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'summary', summary: 'fix the login bug' }),
    JSON.stringify({ type: 'user', cwd: 'C:\\work\\api', entrypoint: 'cli', message: { role: 'user', content: 'hello' } }),
  ].join('\n'));
  assert.deepEqual(sessionMeta(f), { title: 'fix the login bug', cwd: 'C:\\work\\api', entrypoint: 'cli' });
  assert.deepEqual(sessionMeta(path.join(profileDir('t1'), 'nope.jsonl')), { title: null, cwd: null, entrypoint: null });
});

test('sessionMeta finds entrypoint even behind a huge first line', () => {
  // A big queue-operation blob as the first line must not hide the entrypoint
  // on the following user line (this is how SDK subagents were slipping through).
  const f = path.join(profileDir('t1'), 'projects', 'C--x', 'bigfirst.jsonl');
  const blob = 'x'.repeat(200_000);
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'queue-operation', content: blob }),
    JSON.stringify({ type: 'user', cwd: 'C:\\p', entrypoint: 'sdk-cli', message: { role: 'user', content: 'agent prompt' } }),
  ].join('\n'));
  assert.equal(sessionMeta(f).entrypoint, 'sdk-cli');
});

test('isUserFacing keeps interactive sessions and drops SDK/subagent ones', () => {
  assert.ok(isUserFacing('cli'));
  assert.ok(isUserFacing('vscode'));
  assert.ok(isUserFacing(null));       // unknown → keep (conservative)
  assert.ok(!isUserFacing('sdk-cli'));
  assert.ok(!isUserFacing('sdk-ts'));
});

test('listSessions hides SDK subagents so the count matches /resume', () => {
  const dir = path.join(profileDir('t1'), 'projects', 'C--proj');
  fs.mkdirSync(dir, { recursive: true });
  const write = (id, entrypoint, text) => fs.writeFileSync(path.join(dir, id + '.jsonl'),
    JSON.stringify({ type: 'user', cwd: 'C:\\proj', entrypoint, message: { role: 'user', content: text } }));
  write('real0001', 'cli', 'the real conversation');
  for (let i = 0; i < 20; i++) write(`sub${String(i).padStart(5, '0')}`, 'sdk-cli', 'You are a subagent');
  const shown = listSessions('C--proj');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'the real conversation');
  assert.equal(listSessions('C--proj', { includeSdk: true }).length, 21);
});
