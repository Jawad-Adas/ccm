import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-reg-'));
const {
  registerProfile, getProfile, listProfiles, updateProfile,
  unregisterProfile, validName,
} = await import('../src/registry.js');

test('validName accepts sane names and rejects junk', () => {
  assert.ok(validName('work'));
  assert.ok(validName('my-Org_2'));
  assert.ok(!validName(''));
  assert.ok(!validName('-leading'));
  assert.ok(!validName('has space'));
  assert.ok(!validName('a'.repeat(40)));
  assert.ok(!validName('../escape'));
});

test('register, get, update, list, unregister roundtrip', () => {
  const p = registerProfile('work');
  assert.equal(p.email, null);
  assert.ok(p.color);
  assert.ok(getProfile('work'));
  assert.equal(getProfile('nope'), null);

  updateProfile('work', { email: 'a@b.c' });
  assert.equal(getProfile('work').email, 'a@b.c');

  registerProfile('personal');
  assert.notEqual(getProfile('personal').color, getProfile('work').color);
  assert.deepEqual(listProfiles().map((x) => x.name).sort(), ['personal', 'work']);

  assert.throws(() => registerProfile('work'), /already exists/);
  assert.throws(() => registerProfile('bad name!'), /invalid/);

  unregisterProfile('work');
  assert.equal(getProfile('work'), null);
});
