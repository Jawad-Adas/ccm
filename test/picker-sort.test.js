import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-psort-'));
const { sortByHeadroom } = await import('../src/picker.js');

test('sortByHeadroom puts most available quota first, unknowns last in stable order', () => {
  const profiles = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
  const cache = {
    a: { windows: [{ label: 's', percent: 90 }] },
    b: { windows: [{ label: 's', percent: 10 }] },
    d: { windows: [{ label: 's', percent: 50 }] },
  };
  assert.deepEqual(sortByHeadroom(profiles, cache).map((p) => p.name), ['b', 'd', 'a', 'c']);
});
