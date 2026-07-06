import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-sl-'));
process.env.NO_COLOR = '1';
const { detectProfile, buildLine } = await import('../src/statusline.js');
const { PROFILES_DIR } = await import('../src/paths.js');

test('detectProfile maps CLAUDE_CONFIG_DIR to a profile name', () => {
  assert.equal(detectProfile({ CLAUDE_CONFIG_DIR: path.join(PROFILES_DIR, 'work') }), 'work');
  assert.equal(detectProfile({ CLAUDE_CONFIG_DIR: path.join(os.homedir(), '.claude') }), null);
  assert.equal(detectProfile({}), null);
  assert.equal(detectProfile({ CLAUDE_CONFIG_DIR: path.dirname(PROFILES_DIR) }), null);
});

test('buildLine shows profile, email and short quota', () => {
  const usage = {
    windows: [
      { label: 'session (5h)', percent: 43 },
      { label: 'week (all models)', percent: 12 },
      { label: 'week (Fable)', percent: 7 },
    ],
  };
  const line = buildLine('work', { color: 'cyan', email: 'a@b.c' }, usage);
  assert.match(line, /● work/);
  assert.match(line, /a@b\.c/);
  assert.match(line, /5h 43%/);
  assert.match(line, /wk 12%/);
  assert.match(line, /wk·Fable 7%/);
});

test('buildLine degrades without profile or usage', () => {
  assert.match(buildLine(null, null, null), /default account/);
  assert.match(buildLine('work', null, null), /usage: n\/a/);
});
