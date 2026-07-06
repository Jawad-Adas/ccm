import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findPin, writePin, removePin } from '../src/pin.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-pin-'));
const deep = path.join(root, 'a', 'b', 'c');
fs.mkdirSync(deep, { recursive: true });

test('findPin walks up from nested folders', () => {
  assert.equal(findPin(deep), null);
  writePin('work', root);
  assert.equal(findPin(deep)?.name, 'work');
  assert.equal(findPin(root)?.name, 'work');
});

test('nearest pin wins', () => {
  writePin('personal', path.join(root, 'a'));
  assert.equal(findPin(deep)?.name, 'personal');
  assert.equal(findPin(root)?.name, 'work');
});

test('removePin deletes and reports', () => {
  assert.ok(removePin(path.join(root, 'a')));
  assert.equal(findPin(deep)?.name, 'work');
  assert.equal(removePin(deep), null);
});

test('blank pin file is ignored', () => {
  const blank = path.join(root, 'a', 'b');
  fs.writeFileSync(path.join(blank, '.ccmrc'), '\n');
  assert.equal(findPin(blank)?.name, 'work');
});
