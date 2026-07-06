import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-wt-'));
const { buildFragment } = await import('../src/wt.js');

test('buildFragment maps profiles to WT entries with tab colors', () => {
  const frag = buildFragment([
    { name: 'work', color: 'cyan' },
    { name: 'personal', color: 'nonsense' },
  ]);
  assert.equal(frag.profiles.length, 2);
  assert.equal(frag.profiles[0].name, 'Claude — work');
  assert.equal(frag.profiles[0].commandline, 'ccm work');
  assert.equal(frag.profiles[0].tabColor, '#06B6D4');
  assert.equal(frag.profiles[1].tabColor, '#7C3AED');
});
